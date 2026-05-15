import logging

from backend.tools.income import set_income
from backend.tools.budget import calculate_50_30_20, set_budget, get_budget_summary
from backend.tools.transactions import (
    log_transaction,
    get_spending_by_category,
    suggest_budget_category,
    delete_transaction,
)
from backend.tools.debt import run_debt_snowball, log_debt, set_extra_debt_payment, update_debt, delete_debt
from backend.tools.rag import get_rag_advice
from backend.tools.calculator import calculate

_logger = logging.getLogger("finscipline.tools")

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "set_income",
            "description": "Store the user's monthly take-home income. Call this before calculate_50_30_20 during budget onboarding.",
            "parameters": {
                "type": "object",
                "properties": {
                    "income": {"type": "number", "description": "Monthly take-home income in dollars."},
                },
                "required": ["income"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_spending_by_category",
            "description": "Return the user's total spending per category for a given month.",
            "parameters": {
                "type": "object",
                "properties": {
                    "month": {"type": "string", "description": "Month in YYYY-MM format, e.g. '2025-03'."},
                },
                "required": ["month"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_budget_summary",
            "description": (
                "Return the user's budget limits vs. actual spending for a given month. "
                "Returns empty rows if no budget has been set up — use this as the onboarding trigger."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "month": {"type": "string", "description": "Month in YYYY-MM format, e.g. '2025-03'."},
                },
                "required": ["month"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_50_30_20",
            "description": "Calculate the recommended 50/30/20 budget split from the user's stored income. Call set_income first if income has not been set.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_debt_snowball",
            "description": "Return a debt payoff schedule using the Snowball method (smallest balance first) with month-by-month projections.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "log_debt",
            "description": "Add a new debt account. Use for debts the user does not already have on record.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "The name of the debt account."},
                    "balance": {"type": "number", "description": "The outstanding balance."},
                    "rate": {"type": "number", "description": "The annual interest rate (APR) in percentage."},
                    "minimum_payment": {"type": "number", "description": "The minimum monthly payment."},
                },
                "required": ["name", "balance", "rate", "minimum_payment"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_debt",
            "description": "Update the balance, rate, or minimum payment of an existing debt by name. Use when the user corrects or updates debt info.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Exact name of the debt to update (e.g. 'Visa', 'Student Loan')."},
                    "balance": {"type": "number", "description": "New outstanding balance (optional)."},
                    "rate": {"type": "number", "description": "New APR in percentage (optional)."},
                    "minimum_payment": {"type": "number", "description": "New minimum monthly payment (optional)."},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_debt",
            "description": "Remove a debt account by name. Use when the user says a debt is paid off or wants to remove it.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Exact name of the debt to delete (e.g. 'Visa')."},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "log_transaction",
            "description": "Record a new financial transaction.",
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {"type": "number", "description": "Transaction amount in dollars (positive)."},
                    "category": {"type": "string", "description": "Spending category, e.g. 'Groceries', 'Dining', 'Rent'."},
                    "date": {"type": "string", "description": "Date in YYYY-MM-DD format."},
                    "note": {"type": "string", "description": "Optional note or merchant name."},
                },
                "required": ["amount", "category", "date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_budget",
            "description": "Create or update a monthly budget limit for a spending category. Always pass the correct type.",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "description": "Spending category name."},
                    "monthly_limit": {"type": "number", "description": "Monthly budget limit in dollars."},
                    "type": {
                        "type": "string",
                        "enum": ["needs", "wants", "savings"],
                        "description": "Budget type: 'needs' (rent, groceries, utilities, transport), 'wants' (dining, entertainment, subscriptions), 'savings' (emergency fund, retirement, debt payments).",
                    },
                },
                "required": ["category", "monthly_limit", "type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "suggest_budget_category",
            "description": "Check whether the user has a budget set for a given category. Returns whether it exists and the limit if so.",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "description": "Spending category to check."},
                },
                "required": ["category"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_transaction",
            "description": "Delete a transaction by its ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "transaction_id": {"type": "integer", "description": "The ID of the transaction to delete."},
                },
                "required": ["transaction_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_rag_advice",
            "description": "Retrieve authoritative personal finance guidance from the local knowledge base (CFPB, FTC, Bogleheads, Investor.gov) on a given topic.",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "Finance topic to look up, e.g. 'debt snowball', 'emergency fund', '50/30/20 rule'."},
                },
                "required": ["topic"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": "Evaluate a simple mathematical expression. Useful for doing math operations like addition, subtraction, division, and multiplication.",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {"type": "string", "description": "The mathematical expression to evaluate, e.g. '12 + 45 * 2' or '2500 / 12'."},
                },
                "required": ["expression"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_extra_debt_payment",
            "description": "Set the user's extra monthly payment amount above minimums for the debt snowball. Call this when the user says they can afford extra money toward debt.",
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {"type": "number", "description": "Extra monthly dollars above minimum payments to apply to the snowball target."},
                },
                "required": ["amount"],
            },
        },
    },
]


def execute_tool(name: str, args: dict, shadow_id: str) -> dict:
    _logger.debug("execute: %s", name)
    try:
        match name:
            case "set_income":
                return set_income(shadow_id, args["income"])
            case "get_spending_by_category":
                return get_spending_by_category(shadow_id, args["month"])
            case "get_budget_summary":
                return get_budget_summary(shadow_id, args["month"])
            case "calculate_50_30_20":
                return calculate_50_30_20(shadow_id)
            case "run_debt_snowball":
                return run_debt_snowball(shadow_id)
            case "set_extra_debt_payment":
                return set_extra_debt_payment(shadow_id, args["amount"])
            case "log_debt":
                return log_debt(
                    shadow_id,
                    args["name"],
                    args["balance"],
                    args["rate"],
                    args["minimum_payment"],
                )
            case "update_debt":
                return update_debt(
                    shadow_id,
                    args["name"],
                    args.get("balance"),
                    args.get("rate"),
                    args.get("minimum_payment"),
                )
            case "delete_debt":
                return delete_debt(shadow_id, args["name"])
            case "log_transaction":
                return log_transaction(
                    shadow_id,
                    args["amount"],
                    args["category"],
                    args["date"],
                    args.get("note", ""),
                )
            case "set_budget":
                return set_budget(shadow_id, args["category"], args["monthly_limit"], args.get("type", "needs"))
            case "suggest_budget_category":
                return suggest_budget_category(shadow_id, args["category"])
            case "delete_transaction":
                return delete_transaction(shadow_id, args["transaction_id"])
            case "get_rag_advice":
                return get_rag_advice(args["topic"])
            case "calculate":
                return calculate(args["expression"])
            case _:
                _logger.error("unknown tool requested: %s", name)
                return {"error": f"Unknown tool: {name}"}
    except Exception as exc:
        _logger.error("tool %s raised %s: %s", name, type(exc).__name__, exc)
        raise
