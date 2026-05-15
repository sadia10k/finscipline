import os
import random
import time
from contextlib import asynccontextmanager
from datetime import date as _date

from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI as _OpenAI
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()  # must run before logging_config reads LOG_LEVEL

from backend.logging_config import setup_logging
from backend.database import init_db, get_connection
from backend.auth.router import router as auth_router
from backend.agent.loop import run_agent
from backend.dependencies import get_current_shadow_id
from backend.tools.transactions import log_transaction, delete_transaction
from backend.tools.budget import get_budget_summary, set_budget
from backend.tools.debt import run_debt_snowball, set_extra_debt_payment
from backend.tools.rag import get_rag_advice

_log = setup_logging()
_http_log = _log.getChild("http")

# ── RAG tip pool cache (warmed at startup, refreshed every hour) ───────────
_rag_tip_pool: list[str] = []
_rag_tip_pool_ts: float = 0.0
_RAG_TIP_TTL: float = 3600.0


_TIP_VALIDATE_PROMPT = """\
You are a financial literacy assistant. I will give you a raw text chunk from a personal finance knowledge base.
Your job: decide if it contains a clear, actionable financial tip a person can apply to budgeting, saving, debt, or spending.

Rules:
- If YES: rewrite it as 1-2 complete, friendly sentences (max 200 chars). Do NOT mention specific brand names, apps, or products. Return ONLY the rewritten tip, no prefix.
- If NO (navigation text, legal boilerplate, article titles, citations, URLs, gov disclaimers, product lists, legal rights info): reply with exactly the word NO.

Raw chunk:
\"\"\"
{chunk}
\"\"\"
"""


def _validate_tip_with_model(chunk: str) -> str | None:
    """Ask gpt-4o-mini to validate and rewrite a RAG chunk as a clean tip. Returns None if not usable."""
    try:
        client = _OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": _TIP_VALIDATE_PROMPT.format(chunk=chunk[:800])}],
            max_tokens=80,
            temperature=0.3,
        )
        result = resp.choices[0].message.content.strip()
        if result.upper() == "NO" or not result:
            return None
        return result
    except Exception as exc:
        _log.warning("Tip validation failed for chunk: %s", exc)
        return None


def _warm_rag_tip_pool() -> None:
    global _rag_tip_pool, _rag_tip_pool_ts
    try:
        res = get_rag_advice(
            "general financial advice budgeting savings tips debt emergency fund", n_results=15
        )
        raw_chunks = res.get("chunks", [])
        validated: list[str] = []
        for chunk in raw_chunks:
            tip = _validate_tip_with_model(chunk)
            if tip:
                validated.append(tip)
        _rag_tip_pool = validated
        _rag_tip_pool_ts = time.time()
        _log.info("RAG tip pool warmed: %d/%d chunks validated", len(validated), len(raw_chunks))
    except Exception as exc:
        _log.error("Failed to warm RAG tip pool: %s", exc)


def _get_rag_tip() -> str | None:
    global _rag_tip_pool, _rag_tip_pool_ts
    if not _rag_tip_pool or time.time() - _rag_tip_pool_ts > _RAG_TIP_TTL:
        _warm_rag_tip_pool()
    if not _rag_tip_pool:
        return None
    return random.choice(_rag_tip_pool)

# Hardcoded BLS-based subcategory suggestions (percentages of income)
_BUDGET_SUGGESTIONS = {
    "needs": [
        {"category": "Rent/Mortgage", "pct": 0.28, "description": "~28% of income"},
        {"category": "Groceries",     "pct": 0.10, "description": "~10% of income"},
        {"category": "Utilities",     "pct": 0.05, "description": "~5% of income"},
        {"category": "Transportation","pct": 0.07, "description": "~7% of income"},
    ],
    "wants": [
        {"category": "Dining Out",    "pct": 0.07, "description": "~7% of income"},
        {"category": "Entertainment", "pct": 0.05, "description": "~5% of income"},
        {"category": "Subscriptions", "pct": 0.03, "description": "~3% of income"},
        {"category": "Shopping",      "pct": 0.05, "description": "~5% of income"},
    ],
    "savings": [
        {"category": "Emergency Fund","pct": 0.10, "description": "~10% of income"},
        {"category": "Retirement",    "pct": 0.05, "description": "~5% of income"},
        {"category": "Debt Payments", "pct": 0.05, "description": "~5% of income"},
    ],
}


def _compute_notifications(summary_rows: list, budgets: list, income: float | None, debts: list = None, extra_payment: float = 0) -> list:
    notifications = []
    for row in summary_rows:
        if row["delta"] < 0:
            notifications.append({
                "type": "over_budget",
                "category": row["category"],
                "message": f"You're ${abs(row['delta']):.2f} over budget on {row['category']} this month.",
                "severity": "warning",
            })
        elif row["monthly_limit"] > 0:
            pct = row["actual"] / row["monthly_limit"]
            if 0.80 <= pct < 1.0:
                notifications.append({
                    "type": "approaching_limit",
                    "category": row["category"],
                    "message": f"Heads up — you've used {pct*100:.0f}% of your {row['category']} budget.",
                    "severity": "info",
                })

    # Rent > 30% of income advice
    if income:
        for b in budgets:
            if b["category"].lower() in ("rent", "rent/mortgage", "mortgage"):
                rent_pct = b["monthly_limit"] / income
                if rent_pct > 0.30:
                    notifications.append({
                        "type": "high_rent",
                        "category": b["category"],
                        "message": f"Your housing cost is {rent_pct*100:.0f}% of income — above the recommended 30%. Consider reviewing your Needs budget.",
                        "severity": "info",
                    })

    # ── Cross-tab: Extra debt payment vs. budget alignment ──────────────────
    if extra_payment > 0 and budgets:
        total_budgeted = sum(b["monthly_limit"] for b in budgets)
        unallocated = (income or 0) - total_budgeted

        # Find Debt Payments category budget
        debt_budget_limit = next(
            (b["monthly_limit"] for b in budgets
             if b["category"].lower() in ("debt payments", "debt payment")),
            None
        )

        if debt_budget_limit is not None:
            total_debt_commitment = (debt_budget_limit or 0)
            # Total minimum payments
            min_payments = sum(d.get("minimum_payment", 0) for d in (debts or []))
            total_needed = min_payments + extra_payment

            if total_needed > total_debt_commitment:
                gap = total_needed - total_debt_commitment
                if unallocated >= gap:
                    notifications.append({
                        "type": "debt_budget_gap",
                        "category": "Debt Payments",
                        "message": (
                            f"⚠️ Your extra debt payment of ${extra_payment:.0f}/mo + minimums (${min_payments:.0f}/mo) "
                            f"total ${total_needed:.0f}/mo but your Debt Payments budget is only ${debt_budget_limit:.0f}/mo. "
                            f"You have ${unallocated:.0f} unallocated — consider raising your Debt Payments budget by ${gap:.0f} to cover this."
                        ),
                        "severity": "warning",
                    })
                else:
                    notifications.append({
                        "type": "debt_budget_gap",
                        "category": "Debt Payments",
                        "message": (
                            f"⚠️ Your extra debt payment of ${extra_payment:.0f}/mo puts your total debt commitment at "
                            f"${min_payments + extra_payment:.0f}/mo but your Debt Payments budget allows only ${debt_budget_limit:.0f}/mo. "
                            f"Consider reducing another budget category by ${gap - max(unallocated, 0):.0f} or lowering extra payments."
                        ),
                        "severity": "warning",
                    })
        elif unallocated < extra_payment:
            # No debt budget category but extra payment exceeds unallocated income
            notifications.append({
                "type": "debt_budget_gap",
                "category": "Debt Payments",
                "message": (
                    f"⚠️ Your extra debt payment of ${extra_payment:.0f}/mo exceeds your unallocated income (${max(unallocated,0):.0f}). "
                    f"Consider adding a 'Debt Payments' budget category or reducing extra payments to ${max(unallocated,0):.0f}."
                ),
                "severity": "warning",
            })

    # ── RAG advice tip (served from cached pool — no per-request OpenAI call) ─
    tip = _get_rag_tip()
    if tip:
        notifications.append({
            "type": "rag_advice",
            "category": "Advice",
            "message": f"Coach Tip: {tip}",
            "severity": "info",
        })

    if debts:
        target_debt = next((d for d in debts if d["balance"] > 0), None)
        if target_debt:
            extra = extra_payment or 0
            extra_str = f" with ${extra:.0f}/mo extra" if extra > 0 else ""
            notifications.append({
                "type": "debt_strategy",
                "category": "Debt Strategy",
                "message": f"🎯 Snowball Focus: Put your extra payments on **{target_debt['name']}**{extra_str}. Paid off in ~{target_debt.get('months_to_payoff', '?')} months!",
                "severity": "info",
            })

    # ── Smart agentic alerts ─────────────────────────────────────────────────

    # Low savings rate
    if income and income > 0 and budgets:
        savings_total = sum(b["monthly_limit"] for b in budgets if b.get("type") == "savings")
        savings_rate = savings_total / income
        if savings_rate < 0.15:
            notifications.append({
                "type": "low_savings_rate",
                "category": "Savings",
                "message": (
                    f"📈 Your savings allocation is {savings_rate * 100:.0f}% of income "
                    f"(${savings_total:.0f}/mo) — below the recommended 20%. "
                    "Even small increases to Emergency Fund or Retirement compound significantly over time."
                ),
                "severity": "info",
            })

    # High debt burden (total minimum payments > 20% of income)
    if debts and income and income > 0:
        total_min = sum(d.get("minimum_payment", 0) for d in debts)
        burden_pct = total_min / income
        if burden_pct > 0.20:
            notifications.append({
                "type": "high_debt_burden",
                "category": "Debt",
                "message": (
                    f"⚠️ Your minimum debt payments total ${total_min:.0f}/mo "
                    f"— {burden_pct * 100:.0f}% of your income. "
                    "The recommended ceiling is 20%. "
                    "Consider the debt snowball strategy to eliminate the smallest balance first and free up cash flow."
                ),
                "severity": "warning",
            })

    # Unallocated income (>10% sitting unused)
    if income and income > 0 and budgets:
        total_budgeted_all = sum(b["monthly_limit"] for b in budgets)
        unallocated_income = income - total_budgeted_all
        has_debt_gap = any(n["type"] == "debt_budget_gap" for n in notifications)
        if not has_debt_gap and unallocated_income > income * 0.10:
            notifications.append({
                "type": "unallocated_income",
                "category": "Budget",
                "message": (
                    f"💰 You have ${unallocated_income:.0f}/mo unallocated "
                    f"({unallocated_income / income * 100:.0f}% of income). "
                    "Put it to work — add it to savings, accelerate debt payoff, or create a new budget category."
                ),
                "severity": "info",
            })

    return notifications



@asynccontextmanager
async def lifespan(app: FastAPI):
    _log.info("Finscipline starting up")
    if not os.getenv("OPENAI_API_KEY"):
        _log.critical("OPENAI_API_KEY is not set — chat and RAG features will not work. Set it in .env.")
    if os.getenv("SESSION_SECRET", "") in ("", "dev-insecure-secret-change-in-production"):
        _log.warning("SESSION_SECRET is not set or using the insecure dev default. Set a strong random value in .env before sharing this app.")
    init_db()
    _warm_rag_tip_pool()  # pre-cache RAG tips so /state never blocks on OpenAI embeddings
    yield
    _log.info("Finscipline shutting down")


app = FastAPI(title="Finscipline", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/auth")


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    ms = (time.perf_counter() - start) * 1000
    msg = "%s %s → %d (%.0fms)"
    args = (request.method, request.url.path, response.status_code, ms)
    if response.status_code >= 500:
        _http_log.error(msg, *args)
    else:
        _http_log.debug(msg, *args)
    return response


# --- Request models ---

class ChatRequest(BaseModel):
    messages: list[dict]
    active_tab: str = "dashboard"


class TransactionRequest(BaseModel):
    amount: float = Field(gt=0, le=999_999, description="Transaction amount in dollars")
    category: str
    date: str
    note: str = ""
    merchant: str = ""


class UpdateTransactionRequest(BaseModel):
    amount: float = Field(gt=0, le=999_999)
    category: str
    date: str
    note: str = ""
    merchant: str = ""


class UpdateBudgetRequest(BaseModel):
    monthly_limit: float = Field(ge=0, le=999_999)
    type: str = "needs"


class DebtRequest(BaseModel):
    name: str
    balance: float = Field(gt=0, le=9_999_999)
    rate: float = Field(ge=0, le=100)
    minimum_payment: float = Field(gt=0, le=999_999)


# --- Routes ---

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/chat")
def chat(body: ChatRequest, shadow_id: str = Depends(get_current_shadow_id)):
    result = run_agent(body.messages, shadow_id, body.active_tab)
    return {"reply": result["reply"], "tools_called": result["tools_called"]}


@app.get("/state")
def app_state(shadow_id: str = Depends(get_current_shadow_id)):
    """Single endpoint for all right-panel data. Frontend calls this after every chat exchange."""
    month = _date.today().strftime("%Y-%m")
    with get_connection() as conn:
        user_row = conn.execute(
            "SELECT income FROM users WHERE shadow_id = ?", (shadow_id,)
        ).fetchone()
        budget_rows = conn.execute(
            "SELECT category, monthly_limit, type FROM budgets WHERE shadow_id = ? ORDER BY type, category",
            (shadow_id,),
        ).fetchall()
        has_debt = conn.execute(
            "SELECT 1 FROM debt_accounts WHERE shadow_id = ? LIMIT 1", (shadow_id,)
        ).fetchone() is not None
        has_transactions = conn.execute(
            "SELECT 1 FROM transactions WHERE shadow_id = ? LIMIT 1", (shadow_id,)
        ).fetchone() is not None
        recent_txn_rows = conn.execute(
            "SELECT id, amount, category, date, note FROM transactions "
            "WHERE shadow_id = ? ORDER BY date DESC LIMIT 5",
            (shadow_id,),
        ).fetchall()

    income = user_row["income"] if user_row else None
    budgets = [dict(r) for r in budget_rows]
    has_budget = len(budgets) > 0

    summary = get_budget_summary(shadow_id, month)["rows"] if has_budget else []
    # Always run snowball so Debts tab is always available and cross-checks work
    debt_result = run_debt_snowball(shadow_id)
    debts = debt_result["rows"]
    extra_payment = debt_result.get("extra_payment", 0)
    notifications = _compute_notifications(summary, budgets, income, debts, extra_payment)
    recent_transactions = [dict(r) for r in recent_txn_rows]

    return {
        "month": month,
        "income": income,
        "has_budget": has_budget,
        "has_transactions": has_transactions,
        "has_debts": has_debt,
        "budgets": budgets,
        "summary": summary,
        "debts": debts,
        "extra_debt_payment": extra_payment,
        "total_debt_months": debt_result.get("total_months", 0),
        "total_debt_interest": debt_result.get("total_interest", 0.0),
        "recent_transactions": recent_transactions,
        "notifications": notifications,
    }


@app.get("/transactions")
def list_transactions(shadow_id: str = Depends(get_current_shadow_id)):
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, amount, category, date, note FROM transactions "
            "WHERE shadow_id = ? ORDER BY date DESC",
            (shadow_id,),
        ).fetchall()
    return {"transactions": [dict(r) for r in rows]}


@app.post("/transactions")
def add_transaction(body: TransactionRequest, shadow_id: str = Depends(get_current_shadow_id)):
    note = body.merchant if body.merchant else body.note
    return log_transaction(shadow_id, body.amount, body.category, body.date, note)


@app.patch("/transactions/{transaction_id}")
def edit_transaction(transaction_id: int, body: UpdateTransactionRequest, shadow_id: str = Depends(get_current_shadow_id)):
    note = body.merchant if body.merchant else body.note
    with get_connection() as conn:
        conn.execute(
            "UPDATE transactions SET amount=?, category=?, date=?, note=? WHERE id=? AND shadow_id=?",
            (body.amount, body.category, body.date, note, transaction_id, shadow_id),
        )
    return {"status": "ok"}


@app.delete("/transactions/{transaction_id}")
def remove_transaction(transaction_id: int, shadow_id: str = Depends(get_current_shadow_id)):
    return delete_transaction(shadow_id, transaction_id)


@app.get("/budget/suggestions")
def budget_suggestions(shadow_id: str = Depends(get_current_shadow_id)):
    return _BUDGET_SUGGESTIONS


@app.patch("/budget/{category}")
def update_budget(category: str, body: UpdateBudgetRequest, shadow_id: str = Depends(get_current_shadow_id)):
    return set_budget(shadow_id, category, body.monthly_limit, body.type)


@app.delete("/budget/{category}")
def remove_budget_category(category: str, shadow_id: str = Depends(get_current_shadow_id)):
    with get_connection() as conn:
        conn.execute(
            "DELETE FROM budgets WHERE shadow_id = ? AND category = ?",
            (shadow_id, category),
        )
    return {"status": "ok"}


@app.get("/budget/summary")
def budget_summary(month: str | None = None, shadow_id: str = Depends(get_current_shadow_id)):
    if not month:
        month = _date.today().strftime("%Y-%m")
    return get_budget_summary(shadow_id, month)


@app.get("/budget")
def list_budgets(shadow_id: str = Depends(get_current_shadow_id)):
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT category, monthly_limit, type FROM budgets WHERE shadow_id = ? ORDER BY type, category",
            (shadow_id,),
        ).fetchall()
    return {"budgets": [dict(r) for r in rows]}


@app.get("/debts")
def list_debts(shadow_id: str = Depends(get_current_shadow_id)):
    return run_debt_snowball(shadow_id)


@app.post("/debts")
def add_debt(body: DebtRequest, shadow_id: str = Depends(get_current_shadow_id)):
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO debt_accounts (shadow_id, name, balance, rate, minimum_payment) VALUES (?, ?, ?, ?, ?)",
            (shadow_id, body.name, body.balance, body.rate, body.minimum_payment),
        )
    return {"status": "ok"}


@app.patch("/debts/{debt_id}")
def update_debt(debt_id: int, body: DebtRequest, shadow_id: str = Depends(get_current_shadow_id)):
    with get_connection() as conn:
        result = conn.execute(
            "UPDATE debt_accounts SET name=?, balance=?, rate=?, minimum_payment=? "
            "WHERE id=? AND shadow_id=?",
            (body.name, body.balance, body.rate, body.minimum_payment, debt_id, shadow_id),
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Debt not found.")
    return {"status": "ok"}


@app.delete("/debts/{debt_id}")
def delete_debt(debt_id: int, shadow_id: str = Depends(get_current_shadow_id)):
    with get_connection() as conn:
        result = conn.execute(
            "DELETE FROM debt_accounts WHERE id=? AND shadow_id=?",
            (debt_id, shadow_id),
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Debt not found.")
    return {"status": "ok"}


_DEBT_ADVICE_FALLBACK = (
    "The debt snowball method focuses on paying off debts in order of smallest to largest balance. "
    "Gaining momentum as you knock out each balance keeps you motivated!"
)

@app.get("/debts/advice")
def debt_advice():
    try:
        rag_res = get_rag_advice("debt snowball method strategy payoff", n_results=5)
        chunks = rag_res.get("chunks", [])
        for chunk in chunks:
            validated = _validate_tip_with_model(chunk)
            if validated:
                return {"advice": validated}
    except Exception:
        pass
    return {"advice": _DEBT_ADVICE_FALLBACK}


class ExtraPaymentRequest(BaseModel):
    amount: float


@app.patch("/debts/extra")
def update_extra_payment(body: ExtraPaymentRequest, shadow_id: str = Depends(get_current_shadow_id)):
    return set_extra_debt_payment(shadow_id, body.amount)


@app.get("/status")
def user_status(shadow_id: str = Depends(get_current_shadow_id)):
    with get_connection() as conn:
        has_budget = conn.execute(
            "SELECT 1 FROM budgets WHERE shadow_id = ? LIMIT 1", (shadow_id,)
        ).fetchone() is not None
        has_transactions = conn.execute(
            "SELECT 1 FROM transactions WHERE shadow_id = ? LIMIT 1", (shadow_id,)
        ).fetchone() is not None
        has_debts = conn.execute(
            "SELECT 1 FROM debt_accounts WHERE shadow_id = ? LIMIT 1", (shadow_id,)
        ).fetchone() is not None
    return {"has_budget": has_budget, "has_transactions": has_transactions, "has_debts": has_debts}
