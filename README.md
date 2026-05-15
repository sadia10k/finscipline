# Finscipline

A personal finance coach you talk to. Set up a budget, log spending, manage debt, and get actionable advice: all through natural conversation. No spreadsheets, no cloud sync, no account required beyond a local username.

Built for **CPSC 254 – Applied AI**, Cal State Fullerton, Spring 2026 by Sadia Khan.

---

## What It Does

- **Conversational budget setup**: tell the coach your income; it calculates a 50/30/20 split and creates all subcategories in one turn
- **Spend tracking**: log transactions by talking ("I spent $47 at Costco on groceries") or via the Transactions tab form; edit and delete anytime
- **Smart alerts**: over-budget, approaching-limit, low savings rate, high debt burden, and budget misalignment alerts with one-tap "Ask Coach" and "Auto Fix" actions
- **Debt Snowball**: add debts, set an extra monthly payment, see a live paydown chart and month-by-month projections; edit or delete debts inline
- **Quick-reply chips**: when the coach asks a question, clickable suggestion buttons appear so you rarely have to type
- **RAG-backed advice**: finance tips drawn from a local embeddings index (CFPB, FTC, Investor.gov) validated by GPT before display; no live internet search
- **Charts**: Budget vs. Actual bar chart, Spending by Type donut, Debt paydown line chart
- **Multi-user**: each account's data is fully isolated; password reset via recovery code (no email)

---

## Prerequisites

- Python 3.11+
- Node.js 18+
- An OpenAI API key with access to `gpt-4o-mini` ([get one here](https://platform.openai.com/api-keys))

---

## Quick Start

```bash
git clone <repo-url>
cd finscipline

./finscipline.sh setup   # creates .venv, installs deps, writes .env template
# open .env and set OPENAI_API_KEY=sk-...
./finscipline.sh start   # launches backend (port 8000) + frontend (port 5173)
```

Open <http://localhost:5173> in your browser.

```bash
./finscipline.sh stop    # shut down when done
```

**Windows (PowerShell):**

```powershell
.\finscipline.ps1 setup
# edit .env
.\finscipline.ps1 start
.\finscipline.ps1 stop
```

> If PowerShell blocks scripts: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

---

## Manual Setup

```bash
# 1. Copy env template and add your key
cp .env.example .env
# edit .env → set OPENAI_API_KEY=sk-...

# 2. Backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev
```

---

## Evals

To evaluate the agent's tool-calling accuracy and topic adherence:

```bash
PYTHONPATH=. python3 eval/run_eval.py
```

---

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | Yes | Powers the agent (gpt-4o-mini) and RAG embeddings |
| `SESSION_SECRET` | Yes | Signs session cookies: use a long random string |
| `LOG_LEVEL` | No | `INFO` (default) or `DEBUG` |

Generate a session secret:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

---

## Project Structure

```text
finscipline/
├── finscipline.sh / finscipline.ps1   # Dev helper: setup / start / stop
├── .env.example                        # Template: copy to .env, never commit .env
├── backend/
│   ├── main.py                         # FastAPI app, routes, notification engine
│   ├── database.py                     # SQLite schema + connection pool
│   ├── session.py                      # Signed cookie auth (itsdangerous)
│   ├── dependencies.py                 # FastAPI dependency: get_current_shadow_id
│   ├── auth/router.py                  # /auth/* (register, login, reset, logout)
│   ├── agent/
│   │   ├── loop.py                     # GPT-4o-mini tool-calling loop (MAX_ITER=6)
│   │   └── system_prompt.py            # Coach persona, rules, onboarding flow
│   └── tools/
│       ├── budget.py                   # set_budget, get_budget_summary, 50/30/20
│       ├── transactions.py             # log/delete/update transactions
│       ├── debt.py                     # snowball, log/update/delete debts
│       ├── income.py                   # set_income (validated)
│       ├── rag.py                      # Cosine similarity search over local embeddings
│       └── calculator.py              # AST-based safe expression evaluator
├── frontend/
│   └── src/
│       ├── App.jsx                     # Auth shell, tab routing, coach bridge
│       ├── api/client.js               # Axios API layer
│       └── components/
│           ├── Chat.jsx                # Coach chat + quick-reply chips
│           ├── Dashboard.jsx           # Alerts, charts, coach tips
│           ├── Budget.jsx              # Inline-editable budget categories
│           ├── Spending.jsx            # Transaction list with edit/delete
│           ├── Debts.jsx               # Snowball, paydown chart, debt CRUD
│           ├── LockScreen.jsx          # Login / register / reset
│           ├── NotificationsCard.jsx   # Scrollable alert cards
│           └── BudgetSetup.jsx         # Onboarding placeholder
├── data/rag/
│   ├── chunks.json                     # 239 text chunks (pre-built, committed)
│   └── embeddings.npy                  # Corresponding embeddings (pre-built)
├── scripts/
│   └── ingest_rag.py                   # Rebuild RAG index from source docs
└── tests/                              # Backend test suite
```

---

## Architecture

```text
Browser (React + Vite)
    │
    ├── /api/* ──proxy──► FastAPI (uvicorn, port 8000)
    │                          │
    │                    Session cookie (itsdangerous signed)
    │                    Shadow ID extracted server-side only
    │                          │
    │              ┌───────────┴───────────┐
    │          Agent loop              REST endpoints
    │          (gpt-4o-mini)           (/state, /budgets, /debts, …)
    │              │                       │
    │         Tool calls                SQLite (finscipline.db)
    │         (budget, debt,            per shadow_id
    │          transactions,
    │          RAG, calculator)
    │              │
    │         NumPy cosine search
    │         → chunks.json + embeddings.npy
    │         → GPT validation before display
    │
    └── All financial data stays local (SQLite)
        Only LLM messages reach OpenAI: no raw PII
```

**Privacy design:** Each user gets a random `shadow_id` stored in a signed cookie. Every database query is scoped `WHERE shadow_id = ?`. The shadow_id never appears in LLM context, only in server-side tool calls. Prompt injection from client messages is blocked by stripping `role: system` from history.

---

## Things to Try

### 1. Create an account

Click **Create account** on the lock screen. Save the recovery code: it's shown once.

### 2. Set up your budget

In the chat panel:
> "I take home $4,500 a month after taxes"

The coach calculates a 50/30/20 split and shows a full proposed budget table. Reply "Looks good" to create all categories at once.

### 3. Log spending

> "I spent $67 at Trader Joe's on groceries"  
> "I paid $1,200 for rent"  
> "I bought a $15 book, put it under entertainment"

Or use the **Transactions** tab form directly.

### 4. Check your budget

> "How am I doing this month?"  
> "Am I over budget anywhere?"

The coach retrieves live data and flags overages. When over budget, it lists categories with available funds: click a quick-reply chip to reallocate in one message.

### 5. Add and manage debt

> "I have a credit card: $2,500 balance, 19% APR, $50 minimum payment"  
> "What if I put an extra $100/month toward debt?"

Go to the **Debts** tab to see the snowball order, paydown chart, and coach strategy. Hover any debt card to edit or delete it.

### 6. Explore alerts

The **Dashboard** shows smart alerts:

- Over budget / approaching limit (per category)
- Low savings rate or high debt burden
- Unallocated income sitting idle

Each alert has an **Ask Coach** button that pre-populates a targeted question in the chat.

### 7. Ask finance questions

> "What is the debt snowball method?"  
> "How do I build an emergency fund?"  
> "Explain compound interest"

Answers come from the local RAG index, validated by GPT before display.

### 8. Multi-user isolation

Sign out, create a second account, log different transactions. Sign back into the first account: data is completely isolated.

---

## Privacy & Security

- All financial data is stored locally in `finscipline.db` (gitignored)
- Only chat messages are sent to OpenAI: no account numbers, no raw balances outside of what you explicitly share in chat
- Session cookies are signed with `SESSION_SECRET`; the server never trusts the client to provide a user identity
- Input validation on all API boundaries (amount ranges, income ranges, APR ranges)
- Safe math: all arithmetic goes through an AST-based expression evaluator: no `eval()`
- Designed for local use only: do not expose port 8000 or 5173 to the internet
