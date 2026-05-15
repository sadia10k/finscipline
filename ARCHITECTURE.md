# ARCHITECTURE.md

## Project: Finscipline (Local Prototype)

An app you can just chat with to set up a budget and keep your spending on track — no spreadsheets required. The app uses natural language to set up budgets, perform "Intent vs. Reality" audits, and track debt goals using deterministic math combined with LLM reasoning.

**Scope:** Local deployment only. No external bank integrations in v1. Single SQLite file, single local user protected by a bcrypt passphrase. Future iterations will introduce multi-tenancy, a production database, and potentially bank data ingestion.

## Tech Stack & Boundaries

- **Frontend:** React (Vite) + Tailwind CSS + Recharts (for visual dashboards)
- **Backend API:** Python / FastAPI — data broker and privacy proxy
- **Data Analysis:** Pure Python and SQLite queries — exclusively for aggregations (50/30/20 splits) and deterministic math (debt snowball projections)
- **Database:** SQLite
- **AI Engine:** `gpt-4o-mini` (via OpenAI Python SDK)
- **Knowledge Base (RAG):** Local embeddings index (OpenAI `text-embedding-3-small`, stored as `data/rag/chunks.json` + `data/rag/embeddings.npy`)

## Data Model

```text
users         — shadow_id TEXT PRIMARY KEY, password_hash TEXT, income REAL
budgets       — id, shadow_id, category TEXT, monthly_limit REAL
transactions  — id, shadow_id, amount REAL, category TEXT, date TEXT, note TEXT
debt_accounts — id, shadow_id, name TEXT, balance REAL, rate REAL, minimum_payment REAL
```

`budgets` is **intent** (what the user planned). `transactions` is **reality** (what actually happened). The audit compares them. `income` is stored in `users` so `calculate_50_30_20` can compute the recommended split without requiring the user to re-enter it each session.

## Local Auth

Single-user, passphrase-based. No sessions, no tokens, no password reset in v1.

**First launch (setup):**

1. React shows a "Create passphrase" screen
2. `POST /auth/setup` — FastAPI hashes the passphrase with bcrypt, generates a UUID4 `shadow_id`, writes one row to `users`
3. React stores nothing — passphrase is entered fresh each launch

**Subsequent launches (login):**

1. React shows a "Enter passphrase" lock screen
2. `POST /auth/login` — FastAPI calls `bcrypt.checkpw`; returns `200 OK` (with `shadow_id` in a server-side session variable) or `401`
3. React unlocks the UI on 200; all subsequent `/chat` and `/transactions` requests go through normally

**Session lifetime:** In-memory only. FastAPI holds `shadow_id` in a module-level variable for the duration of the process. No JWT, no cookies. If the server restarts, the user re-enters their passphrase.

**Security boundary:** The machine's OS login. This is explicitly a local tool, not a web service.

## Request Flow

```text
User message
    → React (sends full messages[] history + new message)
    → POST /chat  (FastAPI)
        → auth check: get_current_shadow_id() or return 401
        → PII scrubber (regex): strip dollar amounts, SSNs, phone, email
        → attach shadow_id to system context (never to user message)
        → OpenAI gpt-4o-mini  (system prompt + full messages[] + tool definitions)
            → if tool call returned:
                → execute tool locally (Native SQLite query or Python function)
                → append tool result, re-prompt OpenAI  (max 3 iterations)
        → final LLM response
    → React appends response to messages[], displays to user
```

React sends the **full `messages[]` array** with every request — not just the latest message. This gives the LLM conversation context across turns without server-side session storage of chat history.

## Agent System Prompt

Defined in `backend/agent/system_prompt.py`. Injected as the `system` role message on every `/chat` call. Must specify:

- Persona (calm finance mentor, non-judgmental, no investment guarantees)
- Tool-first rule (always call a tool before answering budget/spending/debt questions)
- Math refusal (never compute arithmetic inline — use tools)
- PII awareness (refer to amounts by category, not raw values)
- Onboarding trigger (if no budgets exist, start the budget setup flow)

## Tool Definitions (Function Calling Schema)

All tools live in `backend/tools/`. Each is a Python function with its JSON schema registered for OpenAI function calling. All tools are scoped to `shadow_id` from the server session — never from LLM output.

| Tool | Operation |
| ---- | ---------------- |
| `set_income(shadow_id, income)` | UPDATE users SET income = ? WHERE shadow_id = ? |
| `get_spending_by_category(shadow_id, month)` | GROUP BY category SUM(amount) on transactions |
| `get_budget_summary(shadow_id, month)` | JOIN budgets + transactions, compute delta per category |
| `calculate_50_30_20(shadow_id)` | Apply 50/30/20 ratios to income from users table |
| `run_debt_snowball(shadow_id)` | Order debts by balance ASC, project payoff timeline |
| `log_transaction(shadow_id, amount, category, date, note)` | INSERT into transactions |
| `set_budget(shadow_id, category, monthly_limit)` | UPSERT into budgets |
| `suggest_budget_category(shadow_id, category)` | Check budgets for category existence |
| `delete_transaction(shadow_id, transaction_id)` | DELETE WHERE id = ? AND shadow_id = ? |
| `get_rag_advice(topic)` | Cosine similarity search over pre-built embeddings, returns top-k chunks |

## Data Scoping

Every read, write, and delete — whether triggered by chat, an agentic tool call, or a manual UI action — is scoped to the logged-in user's `shadow_id`.

**The `shadow_id` is never client-supplied.** FastAPI exposes a `get_current_shadow_id` dependency that reads from the in-memory session set at login. This dependency is injected into every protected route and every tool execution. The LLM cannot request data for a different `shadow_id` even if it tries — the session value is always authoritative.

**Every SQL query in `backend/tools/` must include `WHERE shadow_id = ?`.** No exceptions. A tool that queries without this clause must not be merged.

**Unauthenticated requests to any protected endpoint return `401` immediately.** The only unprotected endpoints are `POST /auth/setup` and `POST /auth/login`.

## Core Workflows

### Budget Onboarding

Triggered when a user has no rows in `budgets`. The agent drives a conversational flow:

1. Ask for monthly take-home income
2. Call `set_income` to store it, then call `calculate_50_30_20` and present the recommended split
3. Invite the user to edit any category limit
4. Call `set_budget` for each confirmed category
5. Ask if they want to add more categories
6. Summarize and confirm — no budgets are written without user sign-off

### Transaction Logging & Auto-Categorization

Transactions enter via two paths:

- **Chat:** User says "I spent $47 at Costco" → agent extracts fields, calls `log_transaction`
- **Manual form:** React form POSTs directly to `POST /transactions` on FastAPI

After logging, the agent calls `suggest_budget_category`. If the category has no budget entry, the agent surfaces the gap and asks the user if they want to set one. The user can confirm, skip, or merge it into an existing category.

**Deleting transactions:** Available via chat (agent calls `delete_transaction`) and via a delete button in the manual transaction list view.

### Intent vs. Reality Audit

`get_budget_summary` returns a per-category delta (budget minus actual spend). The agent narrates the result, highlights overruns, and optionally calls `get_rag_advice` to suggest behavioral strategies for categories where spending exceeds intent.

### Debt Snowball

`run_debt_snowball` orders accounts by balance (smallest first), applies minimum payments, and projects the payoff date for each. The agent presents the schedule and can answer follow-up questions like "what if I put an extra $100/month toward debt?"

## Privacy Layer

**Regex-based PII scrubbing in v1.** Named entity recognition is out of scope. Before forwarding to OpenAI, the scrubber strips:

- Dollar amounts (`$1,234.56`)
- Social Security number patterns (`XXX-XX-XXXX`)
- Phone number patterns
- Email addresses

`shadow_id` is attached to the **system context only** — never embedded in the user message. Proper noun scrubbing is not implemented in v1; the Shadow ID pattern provides the primary protection.

## RAG Setup (One-Time Prerequisite)

Before running the app for the first time, run:

```bash
python scripts/ingest_rag.py
```

This script downloads/reads source documents listed in `rag_knowledge_base_sources_v2.csv`, chunks them into passages, embeds each chunk using OpenAI `text-embedding-3-small`, and saves the results to `data/rag/chunks.json` (text) and `data/rag/embeddings.npy` (float32 vectors). The app will not have RAG functionality until this script has completed successfully.

## RAG Integration

The local embeddings index is queried via `get_rag_advice(topic)` when the user asks general finance questions (e.g., "should I invest or pay off debt first?"). The tool embeds the query, computes cosine similarity against the stored vectors using NumPy, and returns the top-k matching chunks. The LLM synthesizes a response grounded in authoritative sources (CFPB, FTC, Investor.gov, Bogleheads).
