from backend.database import get_connection


def set_income(shadow_id: str, income: float) -> dict:
    """Store user's monthly take-home income."""
    if income <= 0 or income > 999_999:
        return {"error": "Income must be between $1 and $999,999 per month."}
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET income = ? WHERE shadow_id = ?",
            (income, shadow_id),
        )
    return {"status": "ok", "income": income}
