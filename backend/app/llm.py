"""LiteLLM glue: two schema-constrained completions (extract, judge) with a
parse-and-retry fallback so we never trust that the structured-output path exists.
"""
import json
import logging
from typing import Type, TypeVar

import litellm
from pydantic import BaseModel, ValidationError

from .config import settings
from .models import ExtractionResult, GraphLLMResult, JudgeResult
from .prompts import build_extract_messages, build_graph_messages, build_judge_messages

logger = logging.getLogger("continuity.llm")

T = TypeVar("T", bound=BaseModel)

# LiteLLM is chatty on import; keep our logs clean.
litellm.suppress_debug_info = True


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
    resp = await litellm.acompletion(**kwargs)
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
