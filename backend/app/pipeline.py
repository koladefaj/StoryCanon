"""The paragraph-check pipeline and resolve logic.

Worst-case cost per paragraph is exactly 2 LLM calls (extract + one batched judge)
plus 1 batched store, regardless of how many facts the paragraph yields.
"""
import asyncio
import html as html_lib
import re
import uuid
from collections import defaultdict

from . import memory
from .llm import extract, extract_graph, judge
from .models import (
    Claim,
    Fact,
    FactRef,
    GraphEdge,
    GraphNode,
    GraphResponse,
    ParagraphCheckResponse,
    PendingContradiction,
    ResolveRequest,
    ResolveResponse,
)


# One lock per book: canon reads/writes for the same book run in arrival order,
# so paragraph N's stored facts are searchable before paragraph N+1's search.
# In-process is sufficient — the backend is a single FastAPI process. Typing is
# never blocked: the frontend fires checks fire-and-forget; contention only
# delays when a warning lands, and only for back-to-back checks on one book.
_book_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


async def paragraph_check(
    book_id: str,
    chapter_id: str,
    chapter_index: int,
    chapter_title: str,
    paragraph_text: str,
    preceding_context: str | None = None,
) -> ParagraphCheckResponse:
    # Extraction is pure LLM work on the paragraph — no shared state, so it runs
    # outside the lock and concurrent checks only serialize the canon phase.
    extraction = await extract(paragraph_text, preceding_context)
    facts = _dedupe_facts(extraction.facts)
    claims = _dedupe_claims(extraction.claims)
    async with _book_locks[book_id]:
        return await _check_against_canon(
            book_id, chapter_id, chapter_index, chapter_title, facts, claims
        )


async def _check_against_canon(
    book_id: str,
    chapter_id: str,
    chapter_index: int,
    chapter_title: str,
    facts: list[Fact],
    claims: list[Claim],
) -> ParagraphCheckResponse:
    # 1. All searches concurrently. Facts search ≤ current chapter in ONE query:
    # earlier-chapter hits are canon (judged), same-chapter hits are dedupe/revision
    # targets — otherwise every re-check of an edited paragraph re-stores its facts.
    async def search_fact(f: Fact) -> list[dict]:
        return await memory.search_facts(
            f"{f.entity} {f.attribute}: {f.statement}",
            book_id,
            chapter_index_lt=chapter_index + 1,
        )

    async def search_claim(c: Claim) -> list[dict]:
        hits = await memory.search_facts(
            f"{c.entity}: {c.presupposedState}", book_id, chapter_index_lt=chapter_index
        )
        if not hits:  # fall back to a plain entity search
            hits = await memory.search_facts(c.entity, book_id, chapter_index_lt=chapter_index)
        return hits

    fact_hits, claim_hits = await asyncio.gather(
        asyncio.gather(*[search_fact(f) for f in facts]) if facts else _empty(),
        asyncio.gather(*[search_claim(c) for c in claims]) if claims else _empty(),
    )

    # 2. Facts with no canon → store immediately. Everything with canon hits → judge.
    # A same-chapter hit for the same entity+attribute means this paragraph was
    # checked before: identical statement → skip; changed statement → version-update
    # that memory instead of creating a duplicate.
    judged_items: list[dict] = []
    # (kind, fact_or_claim, {id: hit}, revise_memory_id or None)
    judged_meta: list[tuple[str, object, dict, str | None]] = []
    to_store: list[Fact] = []
    to_update: list[tuple[str, Fact]] = []  # (memory_id, fact)

    for f, hits in zip(facts, fact_hits):
        canon_hits, same_hits = _split_by_chapter(hits, chapter_id)
        revise_id = None
        prior = _same_fact_hit(same_hits, f)
        if prior is not None:
            if _norm(prior["memory"]) == _norm(f.statement):
                continue  # unchanged re-check — already stored
            revise_id = prior["id"]
        if not canon_hits:
            if revise_id:
                to_update.append((revise_id, f))
            else:
                to_store.append(f)
            continue
        judged_items.append(
            {
                "itemIndex": len(judged_items),
                "kind": "fact",
                "statement": f.statement,
                "canon": _canon_payload(canon_hits),
            }
        )
        judged_meta.append(("fact", f, {h["id"]: h for h in canon_hits}, revise_id))

    for c, hits in zip(claims, claim_hits):
        if not hits:
            continue  # transient claim with no relevant canon → nothing to do
        judged_items.append(
            {
                "itemIndex": len(judged_items),
                "kind": "claim",
                "presupposedState": c.presupposedState,
                "canon": _canon_payload(hits),
            }
        )
        judged_meta.append(("claim", c, {h["id"]: h for h in hits}, None))

    # 3. One batched judge call for the whole paragraph.
    verdicts = (await judge(judged_items)).verdicts if judged_items else []
    verdict_by_index = {v.itemIndex: v for v in verdicts}

    # 4. Apply verdicts.
    pending: list[PendingContradiction] = []
    for i, (kind, obj, hits_by_id, revise_id) in enumerate(judged_meta):
        v = verdict_by_index.get(i)
        keep = v is None or v.verdict == "consistent"  # judge omitted → conservative
        if kind == "fact":
            if keep:
                if revise_id:
                    to_update.append((revise_id, obj))  # type: ignore[arg-type]
                else:
                    to_store.append(obj)  # type: ignore[arg-type]
            elif v.verdict == "contradiction":
                pending.append(
                    _build_pending(kind, obj, v.conflictingMemoryId, hits_by_id,
                                   chapter_id, chapter_index, chapter_title, v.reason)
                )
            # "duplicate" → canon already says this; skip storing.
        else:  # claim
            if v is not None and v.verdict == "contradiction":
                pending.append(
                    _build_pending(kind, obj, v.conflictingMemoryId, hits_by_id,
                                   chapter_id, chapter_index, chapter_title, v.reason)
                )

    # 5. One batched store of new facts + version-updates for revised ones.
    ops = []
    if to_store:
        ops.append(memory.create_facts(book_id, _to_memory_payload(
            to_store, book_id, chapter_id, chapter_index, chapter_title)))
    for mem_id, f in to_update:
        [payload] = _to_memory_payload([f], book_id, chapter_id, chapter_index, chapter_title)
        ops.append(memory.update_memory(book_id, mem_id, f.statement, payload["metadata"]))
    if ops:
        await asyncio.gather(*ops)

    stored = to_store + [f for _, f in to_update]
    return ParagraphCheckResponse(
        facts=stored, contradictions=_dedupe_pending(pending)
    )


async def continuity_check_events(book_id: str):
    """Full-book scan as an event stream: real {'type':'phase'} progress per
    chapter, then one {'type':'result', 'contradictions': [...]}.

    Self-sufficient: processes chapters in index order and builds canon as it
    goes by reusing the live paragraph-check pipeline per paragraph, so it
    surfaces cross-chapter contradictions even on a book that was never
    live-checked. Chapters run sequentially — chapter N's facts must be stored
    before chapter N+1 is judged against them — while paragraphs inside a
    chapter run concurrently (bounded). Re-runs are safe: paragraph-check skips
    unchanged facts and version-updates changed ones instead of duplicating.
    """
    yield {"type": "phase", "label": "Reading chapters…"}
    chapters = sorted(await memory.list_chapters(book_id), key=lambda c: c["index"])
    sem = asyncio.Semaphore(4)  # bound concurrent LLM work (Groq free-tier friendly)

    async def scan_paragraph(ch: dict, text: str, preceding: str | None):
        async with sem:
            res = await paragraph_check(
                book_id=book_id,
                chapter_id=ch["id"],
                chapter_index=ch["index"],
                chapter_title=ch["title"],
                paragraph_text=text,
                preceding_context=preceding,
            )
        return res.contradictions

    all_pending: list[PendingContradiction] = []
    for i, ch in enumerate(chapters, start=1):
        paragraphs = _html_paragraphs(ch["content"])
        if not paragraphs:
            continue
        yield {
            "type": "phase",
            "label": (
                f"Chapter {i}/{len(chapters)} — “{ch['title']}” "
                f"({len(paragraphs)} paragraph{'s' if len(paragraphs) != 1 else ''})…"
            ),
        }
        groups = await asyncio.gather(
            *[
                scan_paragraph(ch, text, paragraphs[j - 1] if j > 0 else None)
                for j, text in enumerate(paragraphs)
            ]
        )
        for group in groups:
            all_pending.extend(group)
    yield {"type": "result", "contradictions": _dedupe_pending(all_pending)}


async def continuity_check(book_id: str) -> list[PendingContradiction]:
    """Non-streaming wrapper over continuity_check_events."""
    out: list[PendingContradiction] = []
    async for ev in continuity_check_events(book_id):
        if ev["type"] == "result":
            out = ev["contradictions"]
    return out


async def build_graph(book_id: str) -> GraphResponse:
    """Canon facts → labeled relationship edges between named entities (one LLM
    call), normalized for the frontend graph: node ids are lowercased names."""
    entries = await memory.list_memories(book_id)
    facts = []
    for e in entries:
        if e.get("isForgotten") or e.get("isLatest") is False:
            continue
        md = e.get("metadata") or {}
        facts.append(
            {"entity": str(md.get("entity") or ""), "statement": str(e.get("memory") or "")}
        )
    result = await extract_graph(facts[:200])

    nodes: dict[str, str] = {}
    edges: list[GraphEdge] = []
    seen: set[tuple[str, str, str]] = set()
    for edge in result.edges:
        s, r, t = edge.source.strip(), edge.relation.strip(), edge.target.strip()
        if not s or not r or not t or s.lower() == t.lower():
            continue
        key = (s.lower(), r.lower(), t.lower())
        if key in seen:
            continue
        seen.add(key)
        nodes.setdefault(s.lower(), s)
        nodes.setdefault(t.lower(), t)
        edges.append(GraphEdge(source=s.lower(), relation=r, target=t.lower()))
    return GraphResponse(
        nodes=[GraphNode(id=k, label=v) for k, v in nodes.items()], edges=edges
    )


_P_RE = re.compile(r"<p[^>]*>(.*?)</p>", re.DOTALL | re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")


def _html_paragraphs(content: str, min_chars: int = 12) -> list[str]:
    """TipTap chapter HTML → plain-text paragraphs (mirrors the live-check gate)."""
    blocks = _P_RE.findall(content or "") or ([content] if content else [])
    out: list[str] = []
    for block in blocks:
        text = html_lib.unescape(_TAG_RE.sub(" ", block))
        text = " ".join(text.split())
        if len(text) >= min_chars:
            out.append(text)
    return out


async def resolve(book_id: str, req: ResolveRequest) -> ResolveResponse:
    if req.choice == "kept-old":
        # Nothing was stored for a pending contradiction, so keeping the original
        # is a no-op server-side; the author just fixes the prose.
        return ResolveResponse(ok=True)

    # kept-new → version-bump the conflicting canon memory (flagship feature).
    if not req.oldMemoryId or not req.newFactContent:
        raise ValueError("kept-new requires oldMemoryId and newFactContent")
    metadata = {
        k: v
        for k, v in {
            "entity": req.entity,
            "attribute": req.attribute,
            "bookId": book_id,
            "chapterId": req.chapterId,
            "chapterIndex": req.chapterIndex,
            "chapterTitle": req.chapterTitle,
        }.items()
        if v is not None
    }
    async with _book_locks[book_id]:
        result = await memory.update_memory(
            book_id, req.oldMemoryId, req.newFactContent, metadata
        )
    return ResolveResponse(ok=True, newMemoryId=result.get("id"))


# --------------------------------------------------------------------------- helpers


def _dedupe_facts(facts: list[Fact]) -> list[Fact]:
    """Collapse repeats of the same (entity, attribute), keeping the most specific
    (longest) statement. Preserves first-seen order."""
    best: dict[tuple[str, str], Fact] = {}
    order: list[tuple[str, str]] = []
    for f in facts:
        key = (f.entity.strip().lower(), f.attribute.strip().lower())
        if key not in best:
            order.append(key)
            best[key] = f
        elif len(f.statement) > len(best[key].statement):
            best[key] = f
    return [best[k] for k in order]


def _dedupe_claims(claims: list[Claim]) -> list[Claim]:
    seen: set[tuple[str, str]] = set()
    out: list[Claim] = []
    for c in claims:
        key = (c.entity.strip().lower(), c.presupposedState.strip().lower())
        if key not in seen:
            seen.add(key)
            out.append(c)
    return out


async def _empty() -> list:
    return []


def _norm(s: str) -> str:
    return " ".join(s.lower().split()).rstrip(".")


def _dedupe_pending(pending: list[PendingContradiction]) -> list[PendingContradiction]:
    """One card per challenged canon memory: a fact and a claim from the same
    paragraph can both flag the same memory. Facts are judged first, so they win."""
    seen: set[tuple[str, str]] = set()
    out: list[PendingContradiction] = []
    for p in pending:
        key = (p.entity.strip().lower(), p.oldMemoryId)
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


def _split_by_chapter(hits: list[dict], chapter_id: str) -> tuple[list[dict], list[dict]]:
    """(canon_hits, same_chapter_hits) — canon is anything from another chapter."""
    canon, same = [], []
    for h in hits:
        md = h.get("metadata") or {}
        (same if str(md.get("chapterId", "")) == chapter_id else canon).append(h)
    return canon, same


def _same_fact_hit(same_hits: list[dict], f: Fact) -> dict | None:
    """The stored memory this fact would duplicate/revise: same entity+attribute."""
    for h in same_hits:
        md = h.get("metadata") or {}
        if (
            str(md.get("entity", "")).strip().lower() == f.entity.strip().lower()
            and str(md.get("attribute", "")).strip().lower() == f.attribute.strip().lower()
        ):
            return h
    return None


def _canon_payload(hits: list[dict]) -> list[dict]:
    return [{"id": h["id"], "memory": h["memory"], "metadata": h["metadata"]} for h in hits]


def _to_memory_payload(
    facts: list[Fact], book_id: str, chapter_id: str, chapter_index: int, chapter_title: str
) -> list[dict]:
    return [
        {
            "content": f.statement,
            "metadata": {
                "entity": f.entity,
                "attribute": f.attribute,
                "bookId": book_id,
                "chapterId": chapter_id,
                "chapterIndex": chapter_index,  # number → numeric filters work
                "chapterTitle": chapter_title,
                "excerpt": f.excerpt,
            },
        }
        for f in facts
    ]


def _build_pending(
    kind: str,
    obj,
    conflicting_id,
    hits_by_id: dict,
    chapter_id: str,
    chapter_index: int,
    chapter_title: str,
    reason: str | None = None,
) -> PendingContradiction:
    canon = hits_by_id.get(conflicting_id) or next(iter(hits_by_id.values()))
    md = canon["metadata"] or {}
    old_ref = FactRef(
        chapterId=str(md.get("chapterId", "")),
        chapterTitle=str(md.get("chapterTitle", "")),
        excerpt=str(md.get("excerpt") or canon["memory"]),
    )
    new_content = obj.statement if kind == "fact" else obj.presupposedState
    new_ref = FactRef(chapterId=chapter_id, chapterTitle=chapter_title, excerpt=obj.excerpt)
    pid = uuid.uuid4().hex[:8]
    return PendingContradiction(
        id=f"c{pid}",
        entity=obj.entity,
        oldFact=old_ref,
        newFact=new_ref,
        status="unresolved",
        pendingId=pid,
        oldMemoryId=canon["id"],
        newFactContent=new_content,
        kind=kind,  # type: ignore[arg-type]
        attribute=getattr(obj, "attribute", None),
        chapterIndex=chapter_index,
        reason=reason,
    )
