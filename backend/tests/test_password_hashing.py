from app.core.security import get_password_hash, verify_password

# Written by passlib's pbkdf2_sha256 before passlib was dropped; existing users' hashes look like this.
PASSLIB_HASH = "$pbkdf2-sha256$29000$uXdOCQEgxPh/b00pBYAwRg$oUp99xiSxj5.W1lt/iJzjWNtv0s3HGuDiNLpszXu0Hs"


def test_passlib_era_hash_still_verifies():
    assert verify_password("legacy-pass", PASSLIB_HASH)
    assert not verify_password("wrong", PASSLIB_HASH)


def test_new_hash_round_trips_and_rejects_garbage():
    h = get_password_hash("secret")
    assert h.startswith("$pbkdf2-sha256$") and verify_password("secret", h)
    assert not verify_password("secret", "not-a-hash")
