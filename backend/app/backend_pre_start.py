import logging
import time
from sqlalchemy import text
from app.db.session import SessionLocal

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

max_tries = 60 * 5  # 5 minutes
wait_seconds = 1

def init() -> None:
    for attempt in range(max_tries):
        try:
            with SessionLocal() as db:
                # Try to create session to check if DB is awake
                db.execute(text("SELECT 1"))
            logger.info("Database is alive!")
            return
        except Exception as e:
            logger.warning("DB not ready (attempt %d/%d): %s", attempt + 1, max_tries, e)
            time.sleep(wait_seconds)
    raise RuntimeError("Database did not become ready in time")

def main() -> None:
    logger.info("Initializing service")
    init()
    logger.info("Service finished initializing")

if __name__ == "__main__":
    main()
