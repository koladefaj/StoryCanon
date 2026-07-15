"""Backend settings, loaded from backend/.env (git-ignored)."""
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# Load .env into os.environ so LiteLLM sees provider keys (OPENAI_API_KEY, GROQ_API_KEY, ...).
load_dotenv()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", 
        extra="ignore", 
        case_sensitive=False
    )

    # Supermemory (local Docker server; key printed on first boot)
    supermemory_api_url: str = "http://localhost:6767"
    supermemory_api_key: str

    # LLM for extraction + judging. Any LiteLLM model string:
    #   openai/gpt-4o, groq/llama-3.3-70b-versatile, ollama/gemma3:4b, ...
    extractor_model: str = "openai/gpt-4o"
    # Optional override for custom OpenAI-compatible endpoints (e.g. local Ollama).
    extractor_api_base: str | None = None

    # CORS origin for the Next.js dev server.
    frontend_origin: str = "http://localhost:3000"


settings = Settings()  # type: ignore[call-arg]
