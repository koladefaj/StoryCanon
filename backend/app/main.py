"""FastAPI app: books, chapters, live paragraph-check, resolve, full-book scan."""
import asyncio
import json
import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from . import memory, pipeline
from .config import settings
from .models import (
    BookOut,
    BookSaveRequest,
    BooksResponse,
    CanonEntry,
    CanonResponse,
    CanonVersion,
    ChapterSaveRequest,
    ChaptersResponse,
    ContinuityCheckResponse,
    ContradictionsPayload,
    ForgetRequest,
    GraphResponse,
    ParagraphCheckRequest,
    ParagraphCheckResponse,
    ResolveRequest,
    ResolveResponse,
)

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Continuity Editor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "model": settings.extractor_model}


@app.get("/api/books", response_model=BooksResponse)
async def get_books() -> BooksResponse:
    metas = await memory.list_books()
    chapter_lists = await asyncio.gather(
        *[memory.list_chapters(m["id"]) for m in metas]
    )
    return BooksResponse(
        books=[
            BookOut(id=m["id"], title=m["title"], chapters=chs)
            for m, chs in zip(metas, chapter_lists)
        ]
    )


@app.put("/api/books/{book_id}")
async def save_book(book_id: str, req: BookSaveRequest) -> dict:
    doc_id = await memory.save_book(book_id, req.title)
    return {"ok": True, "documentId": doc_id}


@app.delete("/api/books/{book_id}")
async def delete_book(book_id: str) -> dict:
    await memory.delete_book(book_id)
    return {"ok": True}


@app.delete("/api/books/{book_id}/chapters/{chapter_id}")
async def delete_chapter(book_id: str, chapter_id: str) -> dict:
    await memory.delete_chapter(book_id, chapter_id)
    return {"ok": True}


@app.get("/api/books/{book_id}/contradictions")
async def get_contradictions(book_id: str) -> dict:
    return {"contradictions": await memory.list_contradictions(book_id)}


@app.put("/api/books/{book_id}/contradictions")
async def put_contradictions(book_id: str, req: ContradictionsPayload) -> dict:
    await memory.save_contradictions(book_id, req.contradictions)
    return {"ok": True}


@app.post(
    "/api/books/{book_id}/continuity-check", response_model=ContinuityCheckResponse
)
async def continuity_check(book_id: str) -> ContinuityCheckResponse:
    return ContinuityCheckResponse(
        contradictions=await pipeline.continuity_check(book_id)
    )


@app.post("/api/books/{book_id}/continuity-check/stream")
async def continuity_check_stream(book_id: str) -> StreamingResponse:
    """SSE: real per-chapter phase events, then the result payload."""

    async def gen():
        async for ev in pipeline.continuity_check_events(book_id):
            if ev["type"] == "result":
                payload = {
                    "type": "result",
                    "contradictions": [c.model_dump() for c in ev["contradictions"]],
                }
            else:
                payload = ev
            yield f"data: {json.dumps(payload)}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/books/{book_id}/canon", response_model=CanonResponse)
async def get_canon(book_id: str) -> CanonResponse:
    """Story Bible: latest canon entries with their version history."""
    raw = await memory.list_memories(book_id)
    entries: list[CanonEntry] = []
    for e in raw:
        if e.get("isForgotten") or e.get("isLatest") is False:
            continue
        md = e.get("metadata") or {}
        entries.append(
            CanonEntry(
                id=str(e.get("id") or ""),
                content=str(e.get("memory") or ""),
                entity=str(md.get("entity") or "General"),
                attribute=str(md.get("attribute") or ""),
                chapterTitle=str(md.get("chapterTitle") or ""),
                chapterIndex=(
                    int(md["chapterIndex"])
                    if str(md.get("chapterIndex", "")).lstrip("-").isdigit()
                    else None
                ),
                updatedAt=str(e.get("updatedAt") or ""),
                version=e.get("version"),
                history=[
                    CanonVersion(
                        content=str(h.get("memory") or h.get("content") or ""),
                        version=h.get("version"),
                        updatedAt=str(h.get("updatedAt") or "") or None,
                    )
                    for h in (e.get("history") or [])
                    if isinstance(h, dict)
                ],
            )
        )
    entries.sort(key=lambda x: (x.entity.lower(), x.chapterIndex or 0, x.attribute))
    return CanonResponse(entries=entries)


@app.post("/api/books/{book_id}/forget")
async def forget_memory(book_id: str, req: ForgetRequest) -> dict:
    await memory.forget(book_id, req.memoryId, req.reason)
    return {"ok": True}


@app.post("/api/books/{book_id}/graph", response_model=GraphResponse)
async def build_graph(book_id: str) -> GraphResponse:
    return await pipeline.build_graph(book_id)


@app.post("/api/books/{book_id}/paragraph-check", response_model=ParagraphCheckResponse)
async def paragraph_check(book_id: str, req: ParagraphCheckRequest) -> ParagraphCheckResponse:
    return await pipeline.paragraph_check(
        book_id=book_id,
        chapter_id=req.chapterId,
        chapter_index=req.chapterIndex,
        chapter_title=req.chapterTitle,
        paragraph_text=req.paragraphText,
        preceding_context=req.precedingContext,
    )


@app.post("/api/books/{book_id}/resolve", response_model=ResolveResponse)
async def resolve(book_id: str, req: ResolveRequest) -> ResolveResponse:
    try:
        return await pipeline.resolve(book_id, req)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/books/{book_id}/chapters/{chapter_id}")
async def save_chapter(
    book_id: str, chapter_id: str, req: ChapterSaveRequest
) -> dict:
    doc_id = await memory.save_chapter(
        book_id, chapter_id, req.title, req.content, req.index
    )
    return {"ok": True, "documentId": doc_id}


@app.get("/api/books/{book_id}/chapters", response_model=ChaptersResponse)
async def get_chapters(book_id: str) -> ChaptersResponse:
    chapters = await memory.list_chapters(book_id)
    return ChaptersResponse(chapters=chapters)
