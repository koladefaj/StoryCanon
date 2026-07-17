"""Pydantic models: the LLM I/O schema, the frontend contract, and API bodies."""
from typing import Literal, Optional
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# LLM extraction schema ("Fact representation")
# ---------------------------------------------------------------------------


class Fact(BaseModel):
    """A durable, canonical story fact — STORED in Supermemory."""

    entity: str = Field(description="Canonical entity name, singular, pronouns resolved")
    attribute: str = Field(description="Short attribute slug, e.g. 'eye color', 'rank'")
    statement: str = Field(description="One self-contained sentence stating the fact")
    excerpt: str = Field(description="Verbatim substring of the paragraph")


class Claim(BaseModel):
    """A transient assertion that presupposes a state — CHECKED, never stored."""

    entity: str
    presupposedState: str = Field(description="The state/capability the claim assumes true")
    excerpt: str = Field(description="Verbatim substring of the paragraph")


class ExtractionResult(BaseModel):
    facts: list[Fact] = Field(default_factory=list)
    claims: list[Claim] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Judge schema — one batched verdict array per paragraph
# ---------------------------------------------------------------------------


class ItemVerdict(BaseModel):
    itemIndex: int = Field(description="Index into the judged-items array sent to the judge")
    verdict: Literal["consistent", "contradiction", "duplicate"]
    conflictingMemoryId: Optional[str] = None
    reason: Optional[str] = None


class JudgeResult(BaseModel):
    verdicts: list[ItemVerdict] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Frontend contract
# ---------------------------------------------------------------------------


class FactRef(BaseModel):
    chapterId: str
    chapterTitle: str
    excerpt: str


class Contradiction(BaseModel):
    id: str
    entity: str
    oldFact: FactRef
    newFact: FactRef
    status: Literal["unresolved", "kept-new", "kept-old"] = "unresolved"


class PendingContradiction(Contradiction):
    """Contradiction plus everything `resolve` needs to act without re-deriving."""

    pendingId: str
    oldMemoryId: str
    newFactContent: str
    # Whether the new item was a durable fact or a transient claim — resolve differs.
    kind: Literal["fact", "claim"] = "fact"
    # Provenance the frontend must echo back on kept-new so the new memory version
    # keeps a numeric chapterIndex (else future chapterIndex-filtered searches miss it).
    attribute: Optional[str] = None
    chapterIndex: Optional[int] = None
    # The judge's short explanation of the conflict — shown on hover in the editor.
    reason: Optional[str] = None
    # Which paragraph produced this. A re-check of the same paragraph supersedes
    # every earlier finding for it, so editing prose can clear a stale flag
    # instead of stacking a second one beside it.
    paragraphIndex: Optional[int] = None


# ---------------------------------------------------------------------------
# API request/response bodies
# ---------------------------------------------------------------------------


class ParagraphCheckRequest(BaseModel):
    chapterId: str
    chapterIndex: int
    chapterTitle: str
    paragraphText: str
    # Immediately preceding text — used only to resolve pronouns/entities.
    precedingContext: Optional[str] = None
    # Position of this paragraph in the chapter; scopes supersession (see
    # PendingContradiction.paragraphIndex).
    paragraphIndex: Optional[int] = None


class ParagraphCheckResponse(BaseModel):
    facts: list[Fact] = Field(default_factory=list)  # facts stored this call
    contradictions: list[PendingContradiction] = Field(default_factory=list)
    # Echoed back so the client knows which paragraph's findings this response
    # replaces — an empty `contradictions` means "this paragraph is clean now",
    # which is indistinguishable from "no news" without it.
    paragraphIndex: Optional[int] = None


class ResolveRequest(BaseModel):
    pendingId: Optional[str] = None
    oldMemoryId: Optional[str] = None
    choice: Literal["kept-new", "kept-old"]
    newFactContent: Optional[str] = None
    # Provenance for the new version when kept-new.
    chapterId: Optional[str] = None
    chapterIndex: Optional[int] = None
    chapterTitle: Optional[str] = None
    entity: Optional[str] = None
    attribute: Optional[str] = None


class ResolveResponse(BaseModel):
    ok: bool
    newMemoryId: Optional[str] = None


class ChapterSaveRequest(BaseModel):
    title: str
    content: str
    index: int


class ChapterOut(BaseModel):
    id: str
    title: str
    index: int
    content: str


class ChaptersResponse(BaseModel):
    chapters: list[ChapterOut] = Field(default_factory=list)


class ContradictionsPayload(BaseModel):
    # Frontend Contradiction records, stored verbatim so a refresh restores the
    # panel + inline marks without re-running the LLM.
    contradictions: list[dict] = Field(default_factory=list)


class BookOut(BaseModel):
    id: str
    title: str
    chapters: list[ChapterOut] = Field(default_factory=list)


class BooksResponse(BaseModel):
    books: list[BookOut] = Field(default_factory=list)


class BookSaveRequest(BaseModel):
    title: str


class ContinuityCheckResponse(BaseModel):
    contradictions: list[PendingContradiction] = Field(default_factory=list)


class CanonVersion(BaseModel):
    content: str
    version: Optional[int] = None
    updatedAt: Optional[str] = None


class MemoryMeta(BaseModel):
    """Supermemory's own bookkeeping, passed through verbatim.

    The Story Bible is a view of the memory layer, not a panel we drew beside
    it — surfacing these lets an author (or a judge) audit exactly what
    Supermemory is holding and why.
    """

    memoryId: str
    containerTag: str
    version: Optional[int] = None
    isLatest: Optional[bool] = None
    # Every version of a fact shares the root id — this is what makes the
    # version chain a chain rather than unrelated rows.
    rootMemoryId: Optional[str] = None
    createdAt: str = ""
    updatedAt: str = ""
    sourceCount: Optional[int] = None


class CanonEntry(BaseModel):
    id: str
    content: str
    entity: str
    attribute: str = ""
    chapterTitle: str = ""
    chapterIndex: Optional[int] = None
    updatedAt: str = ""
    version: Optional[int] = None
    # Older versions, newest first (empty until a memory has been updated).
    history: list[CanonVersion] = Field(default_factory=list)
    raw: Optional[MemoryMeta] = None


class CanonResponse(BaseModel):
    entries: list[CanonEntry] = Field(default_factory=list)


class ForgetRequest(BaseModel):
    memoryId: str
    reason: str = "Removed from canon by the author"


class GraphEdge(BaseModel):
    source: str
    relation: str
    target: str


class GraphNode(BaseModel):
    id: str
    label: str


class GraphLLMResult(BaseModel):
    """Raw LLM output for relationship extraction."""

    edges: list[GraphEdge] = Field(default_factory=list)


class GraphResponse(BaseModel):
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
