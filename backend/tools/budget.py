from backend.database import get_connection


def calculate_50_30_20(shadow_id: str) -> dict:
    """Return recommended 50/30/20 budget split based on stored income."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT income FROM users WHERE shadow_id = ?", (shadow_id,)
        ).fetchone()

    if not row or row["income"] is None:
        return {"error": "Income not set. Call set_income first."}

    income = row["income"]
    return {
        "needs":   round(income * 0.50, 2),
        "wants":   round(income * 0.30, 2),
        "savings": round(income * 0.20, 2),
    }


_CATEGORY_TYPE_MAP = {
    # Type-name keywords (group-level fallback)
    "needs": "needs", "need": "needs",
    "wants": "wants", "want": "wants", "discretionary": "wants",
    "savings": "savings", "saving": "savings",

    # Common Needs subcategories
    "rent": "needs", "mortgage": "needs", "rent/mortgage": "needs",
    "housing": "needs", "rent / mortgage": "needs",
    "groceries": "needs", "grocery": "needs", "food": "needs",
    "utilities": "needs", "utility": "needs", "electric": "needs", "gas": "needs", "water": "needs",
    "transportation": "needs", "transport": "needs", "car payment": "needs",
    "auto insurance": "needs", "health insurance": "needs", "insurance": "needs",
    "phone": "needs", "cell phone": "needs", "internet": "needs",
    "childcare": "needs", "medical": "needs", "healthcare": "needs",
    "student loans": "needs", "student loan": "needs",

    # Common Wants subcategories
    "dining out": "wants", "dining": "wants", "restaurants": "wants", "eating out": "wants",
    "entertainment": "wants", "movies": "wants", "concerts": "wants",
    "subscriptions": "wants", "subscription": "wants", "streaming": "wants",
    "shopping": "wants", "clothing": "wants", "clothes": "wants",
    "travel": "wants", "vacation": "wants", "trips": "wants",
    "hobbies": "wants", "gym": "wants", "fitness": "wants",
    "personal care": "wants", "beauty": "wants",
    "gifts": "wants", "alcohol": "wants", "coffee": "wants",

    # Common Savings subcategories
    "emergency fund": "savings", "emergency": "savings", "rainy day fund": "savings",
    "retirement": "savings", "401k": "savings", "ira": "savings", "roth ira": "savings",
    "debt payments": "savings", "debt payment": "savings", "credit card": "savings",
    "investments": "savings", "investment": "savings", "stocks": "savings", "index funds": "savings",
    "additional savings": "savings", "savings goals": "savings", "savings goal": "savings",
    "college fund": "savings", "education fund": "savings",
    "home down payment": "savings", "down payment": "savings",
}


def set_budget(shadow_id: str, category: str, monthly_limit: float, type: str = "needs") -> dict:
    """Create or update a budget category. type must be 'needs', 'wants', or 'savings'."""
    # Always check the category name against the map first — this corrects the common
    # agent mistake of omitting the type= argument, which causes everything to default to "needs".
    inferred = _CATEGORY_TYPE_MAP.get(category.lower().strip())
    if inferred:
        budget_type = inferred
    else:
        budget_type = type if type in ("needs", "wants", "savings") else "needs"
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO budgets (shadow_id, category, monthly_limit, type)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(shadow_id, category) DO UPDATE SET
                monthly_limit = excluded.monthly_limit,
                type = excluded.type
            """,
            (shadow_id, category, monthly_limit, budget_type),
        )
    return {"status": "ok", "category": category, "monthly_limit": monthly_limit, "type": budget_type}


def get_budget_summary(shadow_id: str, month: str) -> dict:
    """Return intent vs. reality delta per category for a given month (YYYY-MM)."""
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                b.category,
                b.type,
                b.monthly_limit,
                COALESCE(SUM(t.amount), 0) as actual,
                (b.monthly_limit - COALESCE(SUM(t.amount), 0)) as delta
            FROM budgets b
            LEFT JOIN transactions t
                ON b.category = t.category
                AND b.shadow_id = t.shadow_id
                AND t.date LIKE ?
            WHERE b.shadow_id = ?
            GROUP BY b.category
            """,
            (f"{month}%", shadow_id)
        ).fetchall()

    return {"rows": [dict(r) for r in rows]}
