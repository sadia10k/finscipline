import logging
import logging.handlers
import os
from pathlib import Path

ROOT = Path(__file__).parent.parent
LOG_DIR = ROOT / "logs"
LOG_FILE = LOG_DIR / "app.log"

_FMT = "%(asctime)s [%(levelname)-8s] %(name)s: %(message)s"
_DATE_FMT = "%Y-%m-%d %H:%M:%S"


def setup_logging() -> logging.Logger:
    """
    Configure the 'finscipline' logger with a rotating file handler and a
    console handler.  Call once at app startup; idempotent on re-import.

    Level is read from the LOG_LEVEL environment variable (default: INFO).
    Set LOG_LEVEL=DEBUG in .env for verbose output.
    """
    logger = logging.getLogger("finscipline")
    if logger.handlers:
        return logger  # already configured

    LOG_DIR.mkdir(parents=True, exist_ok=True)

    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logger.setLevel(level)

    formatter = logging.Formatter(_FMT, datefmt=_DATE_FMT)

    # Rotating file: 5 MB per file, keep 3 backups → logs/app.log
    file_handler = logging.handlers.RotatingFileHandler(
        LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    # Console (mirrors what goes to the file)
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    # Silence noisy third-party loggers so they don't clutter the output
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)

    logger.info("logging initialised — level=%s  file=%s", level_name, LOG_FILE)
    return logger
