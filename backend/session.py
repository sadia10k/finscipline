"""
Per-request session management using signed HTTP cookies.

Each browser carries an HttpOnly, SameSite=Lax cookie named `finscipline_session`
whose value is a Fernet-signed JSON payload `{"sid": "<shadow_id>"}`.

The secret is loaded from the SESSION_SECRET environment variable (set in .env).
Signing ensures the value cannot be forged or tampered with by the client.
"""

import json
import os
from itsdangerous import URLSafeSerializer, BadSignature

_SECRET = os.getenv("SESSION_SECRET", "dev-insecure-secret-change-in-production")
_COOKIE_NAME = "finscipline_session"
_signer = URLSafeSerializer(_SECRET, salt="session")


def create_session_cookie(shadow_id: str) -> str:
    """Return a signed cookie value encoding the given shadow_id."""
    return _signer.dumps({"sid": shadow_id})


def read_session_cookie(cookie_value: str) -> str | None:
    """Verify and decode a session cookie. Returns shadow_id or None if invalid."""
    try:
        data = _signer.loads(cookie_value)
        return data.get("sid")
    except (BadSignature, Exception):
        return None


COOKIE_NAME = _COOKIE_NAME
COOKIE_KWARGS = dict(
    key=_COOKIE_NAME,
    httponly=True,
    samesite="lax",
    secure=False,   # set True in production with HTTPS
    max_age=60 * 60 * 24 * 30,  # 30 days
)
