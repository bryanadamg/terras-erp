from datetime import datetime, timedelta, timezone
from typing import Any, Union
from jose import jwt
import base64
import hashlib
import hmac
import os

# Configuration
# No default. A fallback string here is a published signing key: anyone reading
# the repo can mint a valid token for any deploy that forgot to set the variable,
# and the deploy comes up looking healthy while it happens. Refusing to start is
# the only failure mode that gets noticed.
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY is not set. Generate one with "
        "`python -c \"import secrets; print(secrets.token_urlsafe(64))\"` "
        "and put it in .env before starting the app."
    )
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 24 hours

# PBKDF2-SHA256 in passlib's modular-crypt format ($pbkdf2-sha256$rounds$salt$hash,
# "adapted" base64: '.' for '+', no padding), so hashes written while passlib was
# a dependency keep verifying and new ones stay readable by it.
_PBKDF2_PREFIX = "$pbkdf2-sha256$"
_PBKDF2_ROUNDS = 29000

def _ab64_encode(data: bytes) -> str:
    return base64.b64encode(data).decode().rstrip("=").replace("+", ".")

def _ab64_decode(data: str) -> bytes:
    data = data.replace(".", "+")
    return base64.b64decode(data + "=" * (-len(data) % 4))

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        rounds, salt, digest = hashed_password.removeprefix(_PBKDF2_PREFIX).split("$")
        expected = _ab64_decode(digest)
        actual = hashlib.pbkdf2_hmac("sha256", plain_password.encode(), _ab64_decode(salt), int(rounds), len(expected))
    except (ValueError, AttributeError):
        return False
    return hashed_password.startswith(_PBKDF2_PREFIX) and hmac.compare_digest(actual, expected)

def get_password_hash(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ROUNDS)
    return f"{_PBKDF2_PREFIX}{_PBKDF2_ROUNDS}${_ab64_encode(salt)}${_ab64_encode(digest)}"

def create_access_token(subject: Union[str, Any], expires_delta: timedelta = None) -> str:
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode = {"sub": str(subject), "exp": expire}
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt
