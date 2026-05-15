import math
from backend.database import get_connection


def _months_to_payoff(balance: float, rate: float, payment: float) -> int | None:
    """
    Compute exact months to pay off a single debt with compound interest.
    Returns None if payment doesn't cover monthly interest.
    Uses the closed-form formula: n = -log(1 - r*P/M) / log(1+r)
    Falls back to iterative simulation if formula breaks (e.g. 0% APR).
    """
    if balance <= 0:
        return 0
    monthly_rate = rate / 100 / 12
    if monthly_rate == 0:
        # No interest — simple division
        return math.ceil(balance / payment) if payment > 0 else None

    min_payment_needed = balance * monthly_rate
    if payment <= min_payment_needed:
        return None  # can never pay off

    try:
        n = -math.log(1 - (monthly_rate * balance) / payment) / math.log(1 + monthly_rate)
        return math.ceil(n)
    except (ValueError, ZeroDivisionError):
        # iterative fallback
        bal = balance
        months = 0
        while bal > 0:
            interest = bal * monthly_rate
            bal = max(0, bal - (payment - interest))
            months += 1
            if months > 600:
                return None
        return months


def _total_interest(balance: float, rate: float, payment: float) -> float:
    """Return total interest paid over the life of a debt."""
    monthly_rate = rate / 100 / 12
    total_paid = 0.0
    bal = balance
    for _ in range(1200):
        if bal <= 0:
            break
        interest = bal * monthly_rate
        actual_payment = min(payment, bal + interest)
        bal = max(0.0, bal - (actual_payment - interest))
        total_paid += actual_payment
    return round(total_paid - balance, 2)


def run_debt_snowball(shadow_id: str, extra_payment: float | None = None) -> dict:
    """
    Proper Debt Snowball calculation:
    - Sort by balance ASC (smallest first)
    - Apply extra monthly payment budget to focus debt
    - Roll freed-up minimums into the next debt after each is paid off
    Returns rows ordered snowball-first with full payoff projections.
    """
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, name, balance, rate, minimum_payment "
            "FROM debt_accounts WHERE shadow_id = ? ORDER BY balance ASC",
            (shadow_id,),
        ).fetchall()


        if extra_payment is None:
            user_row = conn.execute(
                "SELECT extra_debt_payment FROM users WHERE shadow_id = ?", (shadow_id,)
            ).fetchone()
            extra_payment = float(user_row["extra_debt_payment"]) if user_row else 0.0

    if not rows:
        return {"rows": [], "extra_payment": extra_payment, "total_months": 0, "total_interest": 0.0}

    debts = [dict(r) for r in rows]
    results = []
    freed_payment = extra_payment  # start with user's extra budget

    for debt in debts:
        balance = float(debt["balance"])
        rate = float(debt["rate"])
        minimum = float(debt["minimum_payment"])
        effective = minimum + freed_payment

        months = _months_to_payoff(balance, rate, effective)
        interest = _total_interest(balance, rate, effective) if months is not None else None

        results.append({
            "id": debt["id"],
            "name": debt["name"],
            "balance": balance,
            "rate": rate,
            "minimum_payment": minimum,
            "effective_payment": round(effective, 2),
            "extra_applied": round(freed_payment, 2),
            "months_to_payoff": months,
            "interest_paid": interest,
            "payoff_note": (
                "Payment does not cover interest — increase payment to make progress."
                if months is None else None
            ),
        })
        # Snowball: once this debt is paid off, its full payment rolls forward
        freed_payment += minimum

    total_months = max((r["months_to_payoff"] or 0) for r in results) if results else 0
    total_interest = round(sum(r["interest_paid"] or 0 for r in results), 2)

    return {
        "rows": results,
        "extra_payment": extra_payment,
        "total_months": total_months,
        "total_interest": total_interest,
    }


def set_extra_debt_payment(shadow_id: str, amount: float) -> dict:
    """Update the user's extra monthly debt payment budget."""
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET extra_debt_payment = ? WHERE shadow_id = ?",
            (max(0.0, amount), shadow_id),
        )
    return {"status": "ok", "extra_payment": amount}


def log_debt(shadow_id: str, name: str, balance: float, rate: float, minimum_payment: float) -> dict:
    """Record a new debt account directly to the database."""
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO debt_accounts (shadow_id, name, balance, rate, minimum_payment) VALUES (?, ?, ?, ?, ?)",
            (shadow_id, name, balance, rate, minimum_payment),
        )
    return {"status": "ok"}


def update_debt(shadow_id: str, name: str, balance: float | None = None, rate: float | None = None, minimum_payment: float | None = None) -> dict:
    """Update an existing debt account by name. Only provided fields are changed."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, balance, rate, minimum_payment FROM debt_accounts WHERE shadow_id = ? AND LOWER(name) = LOWER(?)",
            (shadow_id, name),
        ).fetchone()
        if not row:
            return {"error": f"No debt named '{name}' found."}
        new_balance = balance if balance is not None else row["balance"]
        new_rate = rate if rate is not None else row["rate"]
        new_min = minimum_payment if minimum_payment is not None else row["minimum_payment"]
        conn.execute(
            "UPDATE debt_accounts SET balance=?, rate=?, minimum_payment=? WHERE id=? AND shadow_id=?",
            (new_balance, new_rate, new_min, row["id"], shadow_id),
        )
    return {"status": "ok", "name": name, "balance": new_balance, "rate": new_rate, "minimum_payment": new_min}


def delete_debt(shadow_id: str, name: str) -> dict:
    """Delete a debt account by name."""
    with get_connection() as conn:
        result = conn.execute(
            "DELETE FROM debt_accounts WHERE shadow_id = ? AND LOWER(name) = LOWER(?)",
            (shadow_id, name),
        )
        if result.rowcount == 0:
            return {"error": f"No debt named '{name}' found."}
    return {"status": "ok", "deleted": name}
