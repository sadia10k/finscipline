import logging
import secrets
import uuid
import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from backend.database import get_connection
from backend.session import create_session_cookie, COOKIE_NAME, COOKIE_KWARGS
from backend.dependencies import get_current_shadow_id

router = APIRouter()
logger = logging.getLogger("finscipline.auth")


class RegisterRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    passphrase: str = Field(min_length=1)


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    passphrase: str = Field(min_length=1)


class ChangePasswordRequest(BaseModel):
    current_passphrase: str
    new_passphrase: str = Field(min_length=1)


class ResetPasswordRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    recovery_code: str
    new_passphrase: str = Field(min_length=1)


def _hash(value: str) -> str:
    return bcrypt.hashpw(value.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify(value: str, hashed: str) -> bool:
    return bcrypt.checkpw(value.encode("utf-8"), hashed.encode("utf-8"))


@router.post("/register")
def register(body: RegisterRequest, response: Response):
    """Create a new user account. Returns a one-time recovery code — save it."""
    shadow_id = str(uuid.uuid4())
    password_hash = _hash(body.passphrase)
    recovery_code = secrets.token_urlsafe(18)
    recovery_hash = _hash(recovery_code)

    with get_connection() as conn:
        existing = conn.execute(
            "SELECT shadow_id FROM users WHERE username = ?", (body.username,)
        ).fetchone()
        if existing:
            logger.warning("register failed (duplicate username): username=%s", body.username)
            raise HTTPException(status_code=409, detail="Username already taken.")
        conn.execute(
            "INSERT INTO users (shadow_id, username, password_hash, recovery_hash) "
            "VALUES (?, ?, ?, ?)",
            (shadow_id, body.username, password_hash, recovery_hash),
        )

    # Set signed session cookie — isolated per browser
    cookie_value = create_session_cookie(shadow_id)
    response.set_cookie(value=cookie_value, **COOKIE_KWARGS)
    logger.info("register success: username=%s", body.username)
    return {"status": "ok", "recovery_code": recovery_code, "username": body.username}


@router.post("/login")
def login(body: LoginRequest, response: Response):
    """Verify username + passphrase and set a signed session cookie."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT shadow_id, password_hash FROM users WHERE username = ?",
            (body.username,),
        ).fetchone()

    if not row:
        logger.warning("login failed (unknown user): username=%s", body.username)
        raise HTTPException(status_code=401, detail="Invalid username or passphrase.")
    if not _verify(body.passphrase, row["password_hash"]):
        logger.warning("login failed (wrong passphrase): username=%s", body.username)
        raise HTTPException(status_code=401, detail="Invalid username or passphrase.")

    # Set signed session cookie — each browser gets its own
    cookie_value = create_session_cookie(row["shadow_id"])
    response.set_cookie(value=cookie_value, **COOKIE_KWARGS)
    logger.info("login success: username=%s", body.username)
    return {"status": "ok", "username": body.username}


@router.post("/logout")
def logout(response: Response):
    """Clear the session cookie."""
    response.delete_cookie(key=COOKIE_NAME, samesite="lax")
    logger.info("logout")
    return {"status": "ok"}


@router.post("/change-password")
def change_password(
    body: ChangePasswordRequest,
    shadow_id: str = Depends(get_current_shadow_id),
):
    """Change passphrase for the currently logged-in user."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT password_hash FROM users WHERE shadow_id = ?", (shadow_id,)
        ).fetchone()

    if not row or not _verify(body.current_passphrase, row["password_hash"]):
        logger.warning("change-password failed (wrong passphrase)")
        raise HTTPException(status_code=401, detail="Current passphrase is incorrect.")

    new_hash = _hash(body.new_passphrase)
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE shadow_id = ?",
            (new_hash, shadow_id),
        )
    logger.info("change-password success")
    return {"status": "ok"}


@router.post("/reset-password")
def reset_password(body: ResetPasswordRequest):
    """Reset passphrase using the recovery code issued at registration."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT shadow_id, recovery_hash FROM users WHERE username = ?",
            (body.username,),
        ).fetchone()

    if not row or not row["recovery_hash"] or not _verify(body.recovery_code, row["recovery_hash"]):
        logger.warning("reset-password failed (invalid code): username=%s", body.username)
        raise HTTPException(status_code=401, detail="Invalid username or recovery code.")

    new_hash = _hash(body.new_passphrase)
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE shadow_id = ?",
            (new_hash, row["shadow_id"]),
        )
    logger.info("reset-password success: username=%s", body.username)
    return {"status": "ok"}


@router.get("/me")
def get_me(shadow_id: str = Depends(get_current_shadow_id)):
    """Check if the user is authenticated and return their username."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT username FROM users WHERE shadow_id = ?",
            (shadow_id,),
        ).fetchone()

    if not row:
        raise HTTPException(status_code=401, detail="Unauthorized")

    return {"status": "ok", "username": row["username"]}
