import json
import logging
import os
from datetime import date as _date
from openai import OpenAI, OpenAIError
from backend.agent.system_prompt import SYSTEM_PROMPT
from backend.tools import TOOL_DEFINITIONS, execute_tool

logger = logging.getLogger("finscipline.agent")

_client: OpenAI | None = None
MAX_ITERATIONS = 6


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _client


def run_agent(messages: list[dict], shadow_id: str, active_tab: str = "dashboard") -> dict:
    """
    Run the agent loop for one user turn.
    - messages: full conversation history from the frontend
    - shadow_id: injected from server session, never from caller
    Returns {"reply": str, "tools_called": list[str]}.
    """
    logger.info("turn start: %d message(s) in history", len(messages))
    today = _date.today().isoformat()
    month = today[:7]
    
    # Inject user context directly to eliminate category hallucinations
    from backend.tools.budget import get_budget_summary
    from backend.tools.debt import run_debt_snowball
    from backend.database import get_connection
    try:
        budget_ctx = get_budget_summary(shadow_id, month)["rows"]
        if not budget_ctx:
            budget_ctx = "No budget set up yet."
        with get_connection() as conn:
            income_row = conn.execute("SELECT income, extra_debt_payment FROM users WHERE shadow_id = ?", (shadow_id,)).fetchone()
            income = income_row["income"] if income_row else None
            extra_debt = float(income_row["extra_debt_payment"]) if income_row else 0.0
        debt_result = run_debt_snowball(shadow_id)
        debt_ctx = debt_result["rows"] if debt_result["rows"] else "No debts on record."
    except Exception as e:
        budget_ctx = f"Error fetching context: {e}"
        income = None
        extra_debt = 0.0
        debt_ctx = "Error loading debt data."

    # Derive actionable alerts inline so the coach is always aware
    issues: list[str] = []
    if isinstance(budget_ctx, list):
        for row in budget_ctx:
            if not isinstance(row, dict):
                continue
            if row.get("delta", 0) < 0:
                issues.append(
                    f"OVER BUDGET: {row['category']} — ${abs(row['delta']):.2f} over limit"
                )
            elif row.get("monthly_limit", 0) > 0:
                pct = row.get("actual", 0) / row["monthly_limit"]
                if pct >= 0.80:
                    issues.append(
                        f"APPROACHING LIMIT: {row['category']} — {pct * 100:.0f}% of budget used"
                    )
    if income and isinstance(budget_ctx, list):
        savings_total = sum(
            r.get("monthly_limit", 0) for r in budget_ctx
            if isinstance(r, dict) and r.get("type") == "savings"
        )
        if income > 0 and savings_total / income < 0.15:
            issues.append(f"LOW SAVINGS RATE: only {savings_total / income * 100:.0f}% of income going to savings (target 20%)")
    issues_str = "\n".join(f"- {i}" for i in issues) if issues else "None"

    system_content = (
        f"[USER CONTEXT START]\n"
        f"Today's date: {today}\n"
        f"Current income: {income}\n"
        f"Active Tab: {active_tab.upper()}\n"
        f"Extra monthly debt payment budget: ${extra_debt:.2f}\n"
        f"Current Budget Summary:\n{json.dumps(budget_ctx, indent=2)}\n"
        f"Current Debts (snowball order):\n{json.dumps(debt_ctx, indent=2)}\n"
        f"Current Alerts (proactively address these if relevant):\n{issues_str}\n"
        f"[USER CONTEXT END]\n\n"
        f"When logging transactions, always use {today} as the date unless the user explicitly mentions a different date.\n\n"
        f"{SYSTEM_PROMPT}"
    )
    # Strip any system-role messages from the frontend to prevent prompt injection
    safe_messages = [m for m in messages if m.get("role") in ("user", "assistant", "tool")]
    history = [{"role": "system", "content": system_content}] + safe_messages
    tools_called: list[str] = []

    for iteration in range(MAX_ITERATIONS):
        logger.debug("iteration %d/%d → OpenAI", iteration + 1, MAX_ITERATIONS)
        try:
            response = _get_client().chat.completions.create(
                model="gpt-4o-mini",
                messages=history,
                tools=TOOL_DEFINITIONS,
                tool_choice="auto",
            )
        except OpenAIError as exc:
            logger.error("OpenAI API error: %s", exc)
            raise

        choice = response.choices[0]

        if choice.finish_reason == "tool_calls":
            assistant_msg = choice.message
            history.append({
                "role": "assistant",
                "content": assistant_msg.content,
                "tool_calls": [tc.model_dump() for tc in assistant_msg.tool_calls],
            })
            for tool_call in assistant_msg.tool_calls:
                fn_name = tool_call.function.name
                fn_args = json.loads(tool_call.function.arguments)
                tools_called.append(fn_name)
                logger.info("tool_call: %s  args=%s", fn_name, list(fn_args.keys()))
                logger.debug("tool_call args detail: %s", fn_args)
                result = execute_tool(fn_name, fn_args, shadow_id)
                logger.debug("tool_result: %s → %s", fn_name, result)
                history.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result),
                })
        else:
            reply = choice.message.content
            logger.info("response: %d chars  tools_called=%s", len(reply or ""), tools_called)
            return {"reply": reply, "tools_called": tools_called}

    logger.error("max iterations (%d) reached without a final response", MAX_ITERATIONS)
    return {
        "reply": "I wasn't able to complete that in a reasonable number of steps. Please try rephrasing.",
        "tools_called": tools_called,
    }
