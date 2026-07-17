"""LiteLLM glue: two schema-constrained completions (extract, judge) with a
parse-and-retry fallback so we never trust that the structured-output path exists.
"""
import json
import logging
import re
from typing import Type, TypeVar

import litellm
from litellm.exceptions import RateLimitError
from pydantic import BaseModel, ValidationError

from .config import settings
from .models import ExtractionResult, GraphLLMResult, JudgeResult
from .prompts import build_extract_messages, build_graph_messages, build_judge_messages

logger = logging.getLogger("continuity.llm")

T = TypeVar("T", bound=BaseModel)

# LiteLLM is chatty on import; keep our logs clean.
litellm.suppress_debug_info = True

# LiteLLM retries these internally with exponential backoff, honouring the
# provider's Retry-After. Covers the brief per-minute limits; a exhausted daily
# quota survives all retries and surfaces as LLMRateLimited.
_NUM_RETRIES = 2


class LLMRateLimited(Exception):
    """Provider rate limit / quota exhausted, after retries. Becomes a 429."""

    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


def _parse_retry_after(err: Exception) -> float | None:
    """Providers report the wait in the error body ("try again in 1m23.808s")
    rather than a header LiteLLM exposes, so read it back out of the message."""
    text = str(err)
    m = re.search(r"try again in (?:(\d+)m)?([\d.]+)s", text)
    if not m:
        return None
    minutes = float(m.group(1)) if m.group(1) else 0.0
    return minutes * 60 + float(m.group(2))


async def _complete_json(messages: list[dict], schema: Type[T]) -> T:
    """Run one completion, parse into `schema`, retry once feeding back the error."""
    kwargs = {
        "model": settings.extractor_model,
        "messages": messages,
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }
    if settings.extractor_api_base:
        kwargs["api_base"] = settings.extractor_api_base

    text = await _raw_completion(kwargs)
    try:
        return schema.model_validate_json(_strip_fences(text))
    except (ValidationError, json.JSONDecodeError) as err:
        logger.warning("schema parse failed, retrying once: %s", err)
        retry_messages = messages + [
            {"role": "assistant", "content": text},
            {
                "role": "user",
                "content": (
                    f"That did not match the required schema. Error:\n{err}\n"
                    "Return ONLY a corrected JSON object that matches the schema."
                ),
            },
        ]
        text = await _raw_completion({**kwargs, "messages": retry_messages})
        return schema.model_validate_json(_strip_fences(text))


async def _raw_completion(kwargs: dict) -> str:
    try:
        resp = await litellm.acompletion(**kwargs, num_retries=_NUM_RETRIES)
    except RateLimitError as err:
        retry_after = _parse_retry_after(err)
        logger.warning(
            "%s rate limited after %d retries (retry_after=%s)",
            kwargs.get("model"), _NUM_RETRIES, retry_after,
        )
        raise LLMRateLimited(
            f"{kwargs.get('model')} is rate limited or out of quota. "
            "Wait for the limit to reset, or switch EXTRACTOR_MODEL.",
            retry_after,
        ) from err
    return resp.choices[0].message.content or ""


def _strip_fences(text: str) -> str:
    """Some models wrap JSON in ```json fences despite instructions."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        if t.endswith("```"):
            t = t[: -3]
    return t.strip()


async def extract(paragraph: str, preceding_context: str | None = None) -> ExtractionResult:
    return await _complete_json(
        build_extract_messages(paragraph, preceding_context), ExtractionResult
    )


async def judge(judged_items: list[dict]) -> JudgeResult:
    if not judged_items:
        return JudgeResult()
    return await _complete_json(build_judge_messages(judged_items), JudgeResult)


async def extract_graph(facts: list[dict]) -> GraphLLMResult:
    if not facts:
        return GraphLLMResult()
    return await _complete_json(build_graph_messages(facts), GraphLLMResult)
