"""Async Supermemory wrapper: search / create / update / forget / list.

Container-tag convention: one tag per book, `book_{bookId}`.
Chapters (documents) live under `book_{bookId}:chapters` so their auto-extracted
memories don't pollute our curated fact schema.
"""
from typing import Any, Optional

import httpx
from supermemory import AsyncSupermemory

from .config import settings

client = AsyncSupermemory(
    api_key=settings.supermemory_api_key,
    base_url=settings.supermemory_api_url,
)


def book_tag(book_id: str) -> str:
    return f"book_{book_id}"


def chapters_tag(book_id: str) -> str:
    return f"book_{book_id}:chapters"


async def search_facts(
    q: str,
    book_id: str,
    *,
    chapter_index_lt: Optional[int] = None,
    threshold: float = 0.4,
    limit: int = 8,
) -> list[dict]:
    """Search canon. `chapter_index_lt` enforces 'earlier chapters are canon'."""
    filters = None
    if chapter_index_lt is not None:
        filters = {
            "AND": [
                {
                    "key": "chapterIndex",
                    "value": str(chapter_index_lt),
                    "filterType": "numeric",
                    "numericOperator": "<",
                }
            ]
        }

    # NOTE: no `include={"related_memories": True}` here — nothing consumes the
    # relation context yet and it costs latency on every live keystroke check.
    # Re-add when the Story Bible / version-history UI lands.
    kwargs: dict[str, Any] = dict(
        q=q,
        container_tag=book_tag(book_id),
        search_mode="memories",
        threshold=threshold,
        limit=limit,
        rerank=True,
    )
    if filters:
        kwargs["filters"] = filters

    resp = await client.search.memories(**kwargs)
    out: list[dict] = []
    for r in resp.results:
        out.append(
            {
                "id": r.id,
                "memory": r.memory,
                "metadata": r.metadata or {},
                "similarity": getattr(r, "similarity", None),
                "context": _context_to_dict(getattr(r, "context", None)),
            }
        )
    return out


def _context_to_dict(context: Any) -> Optional[dict]:
    if context is None:
        return None
    if isinstance(context, dict):
        return context
    dump = getattr(context, "model_dump", None)
    return dump() if dump else None


async def create_facts(book_id: str, memories: list[dict]) -> list[dict]:
    """Batched create via raw POST /v4/memories (SDK has no create method).

    `memories[i]` = {"content": str, "metadata": {...}}. Up to 100 per call.
    """
    if not memories:
        return []
    resp = await client.post(
        "/v4/memories",
        body={"containerTag": book_tag(book_id), "memories": memories},
        cast_to=httpx.Response,
    )
    return resp.json().get("memories", [])


async def update_memory(
    book_id: str,
    memory_id: str,
    new_content: str,
    metadata: Optional[dict] = None,
) -> dict:
    """Flagship: version-bump a memory (old kept with isLatest=false)."""
    resp = await client.memories.update_memory(
        container_tag=book_tag(book_id),
        id=memory_id,
        new_content=new_content,
        metadata=metadata or {},
    )
    return resp.model_dump() if hasattr(resp, "model_dump") else dict(resp)


async def forget(book_id: str, memory_id: str, reason: str) -> None:
    await client.memories.forget(
        container_tag=book_tag(book_id), id=memory_id, reason=reason
    )


async def list_memories(book_id: str) -> list[dict]:
    """Story Bible source: latest entries with update history (raw POST)."""
    resp = await client.post(
        "/v4/memories/list",
        body={"containerTags": [book_tag(book_id)]},
        cast_to=httpx.Response,
    )
    return resp.json().get("memoryEntries", [])


# --- Book registry (documents under one global tag) --------------------------
# The book list itself must survive refreshes; chapters alone aren't enumerable
# because container tags can't be listed.

BOOKS_TAG = "books-registry"


async def save_book(book_id: str, title: str) -> str:
    """Upsert a book's metadata (same custom_id → diff-update on rename)."""
    resp = await client.documents.add(
        content=f"Book: {title}",
        custom_id=f"book-meta-{book_id}",
        container_tag=BOOKS_TAG,
        metadata={"kind": "book", "bookId": book_id, "title": title},
    )
    return resp.id


async def list_books() -> list[dict]:
    resp = await client.documents.list(container_tags=[BOOKS_TAG], limit=100)
    out: list[dict] = []
    for doc in resp.memories or []:
        md = doc.metadata if isinstance(doc.metadata, dict) else {}
        if md.get("kind") != "book" or not md.get("bookId"):
            continue
        out.append(
            {"id": str(md["bookId"]), "title": str(md.get("title") or "Untitled Book")}
        )
    return out


# --- Chapter prose stored as Supermemory documents (durable persistence) -----


def _chapter_custom_id(book_id: str, chapter_id: str) -> str:
    # customId charset: alphanumeric + - _ . only. Book/chapter ids are slug-safe.
    return f"{book_id}--{chapter_id}"


async def save_chapter(
    book_id: str, chapter_id: str, title: str, content: str, index: int
) -> str:
    """Upsert a chapter's prose. Re-adding the same custom_id diff-updates it."""
    resp = await client.documents.add(
        content=content or "<p></p>",
        custom_id=_chapter_custom_id(book_id, chapter_id),
        container_tag=chapters_tag(book_id),
        metadata={
            "kind": "chapter",
            "bookId": book_id,
            "chapterId": chapter_id,
            "title": title,
            "index": index,
        },
    )
    return resp.id


async def list_chapters(book_id: str) -> list[dict]:
    """Reconstruct a book's chapters from stored documents, ordered by index."""
    resp = await client.documents.list(
        container_tags=[chapters_tag(book_id)],
        include_content=True,
        limit=100,
    )
    out: list[dict] = []
    for doc in resp.memories or []:
        md = doc.metadata if isinstance(doc.metadata, dict) else {}
        if md.get("kind") != "chapter":
            continue
        out.append(
            {
                "id": str(md.get("chapterId") or ""),
                "title": str(md.get("title") or "Untitled"),
                "index": int(md.get("index") or 0),
                "content": doc.content or "",
            }
        )
    out.sort(key=lambda c: c["index"])
    return out
