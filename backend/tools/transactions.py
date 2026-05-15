from backend.database import get_connection


def log_transaction(shadow_id: str, amount: float, category: str, date: str, note: str = "") -> dict:
    """Record a new transaction."""
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO transactions (shadow_id, amount, category, date, note) VALUES (?, ?, ?, ?, ?)",
            (shadow_id, amount, category, date, note),
        )
    return {"status": "ok"}


def get_spending_by_category(shadow_id: str, month: str) -> dict:
    """Return total spend per category for a given month (YYYY-MM)."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT category, SUM(amount) as total FROM transactions WHERE shadow_id = ? AND date LIKE ? GROUP BY category",
            (shadow_id, f"{month}%")
        ).fetchall()
    return {"rows": [dict(r) for r in rows]}


def suggest_budget_category(shadow_id: str, category: str) -> dict:
    """Check whether a budget exists for this category."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT monthly_limit FROM budgets WHERE shadow_id = ? AND category = ?",
            (shadow_id, category),
        ).fetchone()
    if row:
        return {"has_budget": True, "monthly_limit": row["monthly_limit"]}
    return {"has_budget": False, "category": category}


def delete_transaction(shadow_id: str, transaction_id: int) -> dict:
    """Delete a transaction — scoped to the session user."""
    with get_connection() as conn:
        conn.execute(
            "DELETE FROM transactions WHERE id = ? AND shadow_id = ?",
            (transaction_id, shadow_id),
        )
    return {"status": "ok"}
