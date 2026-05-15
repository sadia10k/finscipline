import sqlite3
from pathlib import Path

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "finscipline.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")  # safe for concurrent FastAPI requests
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    with get_connection() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                shadow_id          TEXT PRIMARY KEY,
                username           TEXT UNIQUE,
                password_hash      TEXT NOT NULL,
                recovery_hash      TEXT NOT NULL DEFAULT '',
                income             REAL,
                extra_debt_payment REAL NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS budgets (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                shadow_id     TEXT NOT NULL,
                category      TEXT NOT NULL,
                monthly_limit REAL NOT NULL,
                UNIQUE(shadow_id, category)
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                shadow_id TEXT NOT NULL,
                amount    REAL NOT NULL,
                category  TEXT NOT NULL,
                date      TEXT NOT NULL,
                note      TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS debt_accounts (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                shadow_id       TEXT    NOT NULL,
                name            TEXT    NOT NULL,
                balance         REAL    NOT NULL,
                rate            REAL    NOT NULL,
                minimum_payment REAL    NOT NULL
            );
        """)

        # Migrate existing DBs that predate multi-user columns
        for stmt in [
            "ALTER TABLE users ADD COLUMN username TEXT",
            "ALTER TABLE users ADD COLUMN recovery_hash TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE budgets ADD COLUMN type TEXT NOT NULL DEFAULT 'needs'",
            "ALTER TABLE users ADD COLUMN extra_debt_payment REAL NOT NULL DEFAULT 0",
        ]:
            try:
                conn.execute(stmt)
                conn.commit()
            except Exception:
                pass  # column already exists

        try:
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username "
                "ON users(username) WHERE username IS NOT NULL"
            )
            conn.commit()
        except Exception:
            pass

        # Remove group-level category names ("Needs", "Wants", "Savings") when real
        # subcategories already exist for that type — they're redundant and inflate totals.
        for correct_type, group_names in [
            ("needs",   ["needs",   "need"]),
            ("wants",   ["wants",   "want"]),
            ("savings", ["savings", "saving"]),
        ]:
            ph = ",".join("?" * len(group_names))
            row = conn.execute(
                f"SELECT COUNT(*) FROM budgets WHERE type = ? AND LOWER(TRIM(category)) NOT IN ({ph})",
                [correct_type] + group_names,
            ).fetchone()
            if row and row[0] > 0:
                conn.execute(
                    f"DELETE FROM budgets WHERE type = ? AND LOWER(TRIM(category)) IN ({ph})",
                    [correct_type] + group_names,
                )
        conn.commit()

        # Correct rows stored with wrong type because the agent omitted the type= argument.
        # Covers both group-level names and common subcategory names.
        _corrections = {
            "wants": ["wants", "want", "dining out", "dining", "restaurants", "eating out",
                      "entertainment", "subscriptions", "subscription", "streaming",
                      "shopping", "clothing", "clothes", "travel", "vacation", "hobbies",
                      "gym", "fitness", "personal care", "beauty", "gifts", "coffee"],
            "savings": ["savings", "saving", "emergency fund", "emergency", "rainy day fund",
                        "retirement", "401k", "ira", "roth ira", "debt payments", "debt payment",
                        "investments", "investment", "stocks", "additional savings",
                        "savings goals", "savings goal", "college fund", "down payment",
                        "home down payment"],
        }
        for correct_type, names in _corrections.items():
            placeholders = ",".join("?" * len(names))
            conn.execute(
                f"UPDATE budgets SET type = ? WHERE LOWER(TRIM(category)) IN ({placeholders}) AND type != ?",
                [correct_type] + names + [correct_type],
            )
        conn.commit()
