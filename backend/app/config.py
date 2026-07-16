"""Backend settings, loaded from backend/.env (git-ignored)."""
import logging
import time
from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# Load .env into os.environ so LiteLLM sees provider keys (OPENAI_API_KEY, GROQ_API_KEY, ...).
load_dotenv()

logger = logging.getLogger("continuity.config")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        case_sensitive=False
    )

    # Supermemory (local Docker server). The key can come from either:
    #   - SUPERMEMORY_API_KEY (host development), or
    #   - SUPERMEMORY_API_KEY_FILE (Docker: the server's data volume is mounted
    #     read-only and the key is read from /.supermemory's `api-key` file, so
    #     `docker compose up` needs zero key handling and survives `down -v`).
    supermemory_api_url: str = "http://localhost:6767"
    supermemory_api_key: str = ""
    supermemory_api_key_file: str | None = None

    # LLM for extraction + judging. Any LiteLLM model string:
    #   openai/gpt-4o, groq/llama-3.3-70b-versatile, ollama/gemma3:4b, ...
    extractor_model: str = "openai/gpt-4o"
    # Optional override for custom OpenAI-compatible endpoints (e.g. local Ollama).
    extractor_api_base: str | None = None

    # CORS origin for the Next.js dev server.
    frontend_origin: str = "http://localhost:3000"


settings = Settings()  # type: ignore[call-arg]


def resolve_supermemory_key(timeout_seconds: int = 90) -> str:
    """Explicit env key wins; otherwise read the server-generated key file.

    Waits for the file on a fresh first boot (the server writes it a moment
    after it initializes its data volume — and `depends_on` doesn't wait for
    readiness).
    """
    if settings.supermemory_api_key:
        return settings.supermemory_api_key
    if settings.supermemory_api_key_file:
        path = Path(settings.supermemory_api_key_file)
        deadline = time.monotonic() + timeout_seconds
        logged = False
        while time.monotonic() < deadline:
            if path.exists():
                key = path.read_text().strip()
                if key:
                    logger.info("Supermemory API key auto-discovered from %s", path)
                    return key
            if not logged:
                logger.info("Waiting for Supermemory to generate its API key at %s…", path)
                logged = True
            time.sleep(1)
    raise RuntimeError(
        "No Supermemory API key: set SUPERMEMORY_API_KEY, or SUPERMEMORY_API_KEY_FILE "
        "pointing at the server's api-key file (mounted from the supermemory-data volume)."
    )
