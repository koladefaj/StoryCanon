"""Async Supermemory wrapper: search / create / update / forget / list.

Container-tag convention: one tag per book, `book_{bookId}`.
Chapters (documents) live under `book_{bookId}:chapters` so their auto-extracted
memories don't pollute our curated fact schema.
"""
import asyncio
import json
from pathlib import Path
from typing import Any, Optional

import httpx
from supermemory import AsyncSupermemory

from .config import resolve_supermemory_key, settings

client = AsyncSupermemory(
    api_key=resolve_supermemory_key(),
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
    """Search curated canon. `chapter_index_lt` enforces 'earlier chapters are canon'."""
    return await _search_container(
        q,
        book_tag(book_id),
        "curated",
        chapter_index_lt=chapter_index_lt,
        threshold=threshold,
        limit=limit,
    )


async def search_derived(
    q: str,
    book_id: str,
    *,
    chapter_index_lt: Optional[int] = None,
    threshold: float = 0.4,
    limit: int = 4,
) -> list[dict]:
    """Search what Supermemory derived from the prose — a second, independent
    reading of the same manuscript.

    Our extraction is structured but brittle: it names the same man `Elias`,
    `Elias Reyes` and `Reyes`, and a fact it simply misses is canon we never had.
    Supermemory's reading resolves references consistently and has higher recall,
    so it covers exactly those gaps. Derived memories carry the same numeric
    chapterIndex, so the 'earlier chapters are canon' filter applies identically.

    Evidence, not canon: these carry no entity/attribute (so they are never
    revision targets) and no verbatim excerpt, and they are deleted and re-derived
    on every prose sync — so a contradiction against one can only be advisory.
    """
    return await _search_container(
        q,
        chapters_tag(book_id),
        "derived",
        chapter_index_lt=chapter_index_lt,
        threshold=threshold,
        limit=limit,
    )


async def _search_container(
    q: str,
    tag: str,
    source: str,
    *,
    chapter_index_lt: Optional[int] = None,
    threshold: float = 0.4,
    limit: int = 8,
) -> list[dict]:
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
        container_tag=tag,
        search_mode="memories",
        threshold=threshold,
        limit=limit,
        # Workers-AI-only binding; throws on the self-hosted server (0.0.5).
        rerank=False,
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
                # Which reading of the manuscript this came from. Drives whether a
                # contradiction against it can be resolved or is advisory only.
                "source": source,
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


# /v4/memories/list paginates and defaults to 10 per page. Passing no limit
# silently truncated every caller to the first 10 memories: the Story Bible
# under-reported canon, the relationship graph was built from a slice of it, and
# deleting a chapter or book left everything past the 10th orphaned rather than
# forgotten. Page through instead of trusting one response.
_LIST_PAGE_SIZE = 100


async def _list_container(tag: str) -> list[dict]:
    out: list[dict] = []
    page = 1
    while True:
        resp = await client.post(
            "/v4/memories/list",
            body={"containerTags": [tag], "limit": _LIST_PAGE_SIZE, "page": page},
            cast_to=httpx.Response,
        )
        data = resp.json()
        out.extend(data.get("memoryEntries", []))
        pagination = data.get("pagination") or {}
        if page >= (pagination.get("totalPages") or 1):
            return out
        page += 1


async def list_memories(book_id: str) -> list[dict]:
    """Story Bible source: every curated entry for the book, with history."""
    return await _list_container(book_tag(book_id))


async def list_derived(book_id: str) -> list[dict]:
    """Memories Supermemory derived from the prose itself (see sync_chapter_prose)."""
    return await _list_container(chapters_tag(book_id))


# --- Book & chapter PROSE stored in a local JSON library ---------------------
# Supermemory documents are effectively write-once on the local server (re-adding
# or updating a customId does NOT replace content — verified), which loses every
# edit after the first save. Per BUILD_PLAN §3.6, manuscript prose falls back to a
# JSON file; Supermemory stays the canon/facts database. The file lives under the
# bind-mounted backend dir, so it survives container restarts.

_LIBRARY_PATH = Path(__file__).resolve().parent.parent / "data" / "library.json"
_library_lock = asyncio.Lock()


def _read_library() -> dict:
    try:
        data = json.loads(_LIBRARY_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {"books": {}}
    data.setdefault("books", {})
    return data


def _write_library(data: dict) -> None:
    _LIBRARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _LIBRARY_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(_LIBRARY_PATH)  # atomic swap


def _ensure_book(data: dict, book_id: str, title: str | None = None) -> dict:
    book = data["books"].setdefault(
        book_id, {"title": title or "Untitled Book", "chapters": {}}
    )
    book.setdefault("chapters", {})
    return book


async def save_book(book_id: str, title: str) -> str:
    async with _library_lock:
        data = _read_library()
        book = _ensure_book(data, book_id, title)
        if title:
            book["title"] = title
        _write_library(data)
    return book_id


async def list_books() -> list[dict]:
    async with _library_lock:
        data = _read_library()
    return [
        {"id": bid, "title": b.get("title") or "Untitled Book"}
        for bid, b in data["books"].items()
    ]


async def save_chapter(
    book_id: str, chapter_id: str, title: str, content: str, index: int
) -> str:
    """Upsert a chapter's prose. Auto-creates the book entry, so writing survives
    even before the book is given a title."""
    async with _library_lock:
        data = _read_library()
        book = _ensure_book(data, book_id)
        book["chapters"][chapter_id] = {
            "title": title,
            "index": index,
            "content": content,
        }
        _write_library(data)
    return chapter_id


async def sync_chapter_prose(
    book_id: str, chapter_id: str, title: str, index: int, text: str
) -> Optional[str]:
    """Hand raw chapter prose to Supermemory and let IT derive the memories.

    This is the memory layer doing the reading, not us: given the prose it
    resolves references on its own ("His daughter Mira" -> "Mira, daughter of
    Captain Elias Reyes"), which our own extraction fragments into `Elias`,
    `Elias Reyes` and `Reyes`.

    Kept in a SEPARATE container from curated canon (`book_x:chapters` vs
    `book_x`) for two reasons: derived memories must never reach the
    contradiction judge — they carry no entity/attribute/chapterIndex metadata,
    so the numeric chapter filter can't order them — and the two extractions
    would otherwise flag each other as duplicates forever.

    Documents are write-once locally (re-adding a customId does not replace), so
    a re-sync deletes the previous document first; the delete cascades to the
    memories derived from it. Returns the new document id, or None for prose too
    short to be worth a model call.
    """
    if len(text.split()) < 20:
        return None

    old_id = await _read_prose_doc_id(book_id, chapter_id)
    if old_id:
        try:
            await client.delete(f"/v3/documents/{old_id}", cast_to=httpx.Response)
        except Exception:
            # Already gone (volume reset, manual delete) — the add below still
            # has to happen, so a failed cleanup must not block it.
            pass

    resp = await client.post(
        "/v3/documents",
        body={
            "content": text,
            "containerTags": [chapters_tag(book_id)],
            "metadata": {
                "bookId": book_id,
                "chapterId": chapter_id,
                "chapterTitle": title,
                "chapterIndex": index,
            },
        },
        cast_to=httpx.Response,
    )
    doc_id = resp.json().get("id")
    if doc_id:
        await _write_prose_doc_id(book_id, chapter_id, str(doc_id))
    return doc_id


async def _read_prose_doc_id(book_id: str, chapter_id: str) -> Optional[str]:
    async with _library_lock:
        data = _read_library()
    book = data["books"].get(book_id) or {}
    ch = (book.get("chapters") or {}).get(chapter_id) or {}
    return ch.get("proseDocId")


async def _write_prose_doc_id(book_id: str, chapter_id: str, doc_id: str) -> None:
    # Read-modify-write under the lock: save_chapter concurrently rewrites the
    # same file, and an unlocked pass here would drop whichever landed second.
    async with _library_lock:
        data = _read_library()
        book = data["books"].get(book_id)
        if not book:
            return
        ch = (book.get("chapters") or {}).get(chapter_id)
        if ch is None:
            return
        ch["proseDocId"] = doc_id
        _write_library(data)


async def save_contradictions(book_id: str, contradictions: list[dict]) -> None:
    """Persist the book's detected contradictions so a refresh restores the panel
    and inline highlights WITHOUT re-running any LLM extraction/judging."""
    async with _library_lock:
        data = _read_library()
        book = _ensure_book(data, book_id)
        book["contradictions"] = contradictions
        _write_library(data)


async def list_contradictions(book_id: str) -> list[dict]:
    async with _library_lock:
        data = _read_library()
    book = data["books"].get(book_id)
    return book.get("contradictions", []) if book else []


async def list_chapters(book_id: str) -> list[dict]:
    async with _library_lock:
        data = _read_library()
    book = data["books"].get(book_id)
    if not book:
        return []
    out = [
        {
            "id": cid,
            "title": c.get("title") or "Untitled",
            "index": int(c.get("index") or 0),
            "content": c.get("content") or "",
        }
        for cid, c in book.get("chapters", {}).items()
    ]
    out.sort(key=lambda c: c["index"])
    return out


# --- Deletion ----------------------------------------------------------------


async def _forget_memories(book_id: str, entries: list[dict], reason: str) -> None:
    """Forget with a reason that survives as an audit trail.

    Supermemory keeps a forgotten memory as a tombstone carrying `forgetReason`,
    so "why isn't this canon any more?" is answerable months later. A generic
    "deleted" throws that away — the reason should name what the author actually
    did to the manuscript.
    """
    await asyncio.gather(
        *[forget(book_id, e["id"], reason) for e in entries if e.get("id")],
        return_exceptions=True,
    )


async def delete_chapter(book_id: str, chapter_id: str) -> None:
    """Remove a chapter's prose and forget the canon facts it established, so a
    deleted chapter can't keep flagging (or being flagged by) other chapters."""
    title = ""
    async with _library_lock:
        data = _read_library()
        book = data["books"].get(book_id)
        if book and chapter_id in book.get("chapters", {}):
            title = book["chapters"][chapter_id].get("title") or ""
            del book["chapters"][chapter_id]
            _write_library(data)
    entries = await list_memories(book_id)
    where = f'"{title}"' if title else chapter_id
    await _forget_memories(
        book_id,
        [e for e in entries
         if str((e.get("metadata") or {}).get("chapterId") or "") == chapter_id],
        f"Chapter {where} was cut in revision",
    )


async def delete_book(book_id: str) -> None:
    """Remove a book entirely: its prose from the library and all its canon facts."""
    title = ""
    async with _library_lock:
        data = _read_library()
        if book_id in data["books"]:
            title = data["books"][book_id].get("title") or ""
            del data["books"][book_id]
            _write_library(data)
    await _forget_memories(
        book_id,
        await list_memories(book_id),
        f'Book "{title or book_id}" was deleted',
    )
