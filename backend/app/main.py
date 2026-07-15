"""FastAPI app: books, chapters, live paragraph-check, resolve, full-book scan."""
import asyncio
import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import memory, pipeline
from .config import settings
from .models import (
    BookOut,
    BookSaveRequest,
    BooksResponse,
    ChapterSaveRequest,
    ChaptersResponse,
    ContinuityCheckResponse,
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


@app.post(
    "/api/books/{book_id}/continuity-check", response_model=ContinuityCheckResponse
)
async def continuity_check(book_id: str) -> ContinuityCheckResponse:
    return ContinuityCheckResponse(
        contradictions=await pipeline.continuity_check(book_id)
    )


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
