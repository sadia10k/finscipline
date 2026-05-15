from fastapi import HTTPException, Request
from backend.session import read_session_cookie, COOKIE_NAME


def get_current_shadow_id(request: Request) -> str:
    """
    Extract and verify the signed session cookie from the request.
    Returns the shadow_id for this authenticated user, or raises 401.
    Each request is fully isolated — no shared global state.
    """
    cookie_value = request.cookies.get(COOKIE_NAME)
    if not cookie_value:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    shadow_id = read_session_cookie(cookie_value)
    if not shadow_id:
        raise HTTPException(status_code=401, detail="Session invalid or expired.")
    return shadow_id
