"""The paragraph-check pipeline and resolve logic.

Worst-case cost per paragraph is exactly 2 LLM calls (extract + one batched judge)
plus 1 batched store, regardless of how many facts the paragraph yields.
"""
import asyncio
import hashlib
import html as html_lib
import re
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
    paragraph_index: int | None = None,
) -> ParagraphCheckResponse:
    # Extraction is pure LLM work on the paragraph — no shared state, so it runs
    # outside the lock and concurrent checks only serialize the canon phase.
    extraction = await extract(paragraph_text, preceding_context)
    facts = _dedupe_facts(extraction.facts)
    claims = _dedupe_claims(extraction.claims)
    async with _book_locks[book_id]:
        return await _check_against_canon(
            book_id, chapter_id, chapter_index, chapter_title, facts, claims,
            paragraph_index,
        )


async def _check_against_canon(
    book_id: str,
    chapter_id: str,
    chapter_index: int,
    chapter_title: str,
    facts: list[Fact],
    claims: list[Claim],
    paragraph_index: int | None = None,
) -> ParagraphCheckResponse:
    # 1. All searches concurrently. Facts search ≤ current chapter in ONE query:
    # earlier-chapter hits are canon (judged), same-chapter hits are dedupe/revision
    # targets — otherwise every re-check of an edited paragraph re-stores its facts.
    #
    # Supermemory's reading of the prose backs our own up, but only where ours is
    # blind. Our extraction is structured (entity + attribute + a verbatim excerpt
    # to highlight) but it drops facts and fragments one character into `Elias`,
    # `Elias Reyes` and `Reyes`; a fact it missed is canon we never had, and no
    # amount of searching finds it. Supermemory's reading resolves references and
    # recalls more, and carries the same numeric chapterIndex, so the same
    # 'earlier chapters are canon' filter applies.
    #
    # Fallback, not merge: derived memories are longer and richer, so when both
    # contain the same fact the derived one wins on similarity and the judge cites
    # it — and a derived memory has no curated counterpart to version-bump, which
    # would silently turn a resolvable contradiction into an advisory one. So it
    # only speaks when curated canon has nothing to say. Searches are local and
    # free; this costs latency, not tokens.
    async def search_fact(f: Fact) -> list[dict]:
        q = f"{f.entity} {f.attribute}: {f.statement}"
        hits = await memory.search_facts(q, book_id, chapter_index_lt=chapter_index + 1)
        if not hits:
            hits = await memory.search_derived(
                q, book_id, chapter_index_lt=chapter_index + 1
            )
        return hits

    async def search_claim(c: Claim) -> list[dict]:
        q = f"{c.entity}: {c.presupposedState}"
        hits = await memory.search_facts(q, book_id, chapter_index_lt=chapter_index)
        if not hits:
            hits = await memory.search_derived(q, book_id, chapter_index_lt=chapter_index)
        if not hits:  # last resort: a plain entity search over curated canon
            hits = await memory.search_facts(
                c.entity, book_id, chapter_index_lt=chapter_index
            )
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
                                   chapter_id, chapter_index, chapter_title, v.reason,
                                   paragraph_index)
                )
            # "duplicate" → canon already says this; skip storing.
        else:  # claim
            if v is not None and v.verdict == "contradiction":
                pending.append(
                    _build_pending(kind, obj, v.conflictingMemoryId, hits_by_id,
                                   chapter_id, chapter_index, chapter_title, v.reason,
                                   paragraph_index)
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
        facts=stored,
        contradictions=_dedupe_pending(pending),
        paragraphIndex=paragraph_index,
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
    # Bound to 2, not for the LLM but for Supermemory's local embedding engine:
    # each paragraph check fires several similarity searches, and overrunning the
    # native embedder's 2-concurrent limit is what segfaulted it mid-scan.
    sem = asyncio.Semaphore(2)

    # Hand the raw prose to Supermemory so it can derive its own memories from it,
    # alongside our curated canon. Extraction happens server-side and async, so
    # this only queues the documents — the scan below doesn't wait on it, and a
    # failure here must never block continuity checking.
    #
    # Bounded to 2: each sync ships a whole chapter to Supermemory's local
    # embedding engine, whose own limit is 2 concurrent ingests. Firing all
    # chapters at once (unbounded gather) flooded the native embedder and
    # segfaulted it mid-scan — the crash that killed a recording session. A small
    # cap keeps the engine inside its own comfort zone.
    if chapters:
        yield {"type": "phase", "label": "Supermemory is reading the prose…"}
        sync_sem = asyncio.Semaphore(2)

        async def sync_one(ch: dict) -> None:
            async with sync_sem:
                await memory.sync_chapter_prose(
                    book_id,
                    ch["id"],
                    ch["title"],
                    ch["index"],
                    "\n\n".join(t for _, t in _html_paragraphs(ch["content"])),
                )

        await asyncio.gather(
            *[sync_one(ch) for ch in chapters], return_exceptions=True
        )

    async def scan_paragraph(ch: dict, text: str, preceding: str | None, index: int):
        async with sem:
            res = await paragraph_check(
                book_id=book_id,
                chapter_id=ch["id"],
                chapter_index=ch["index"],
                chapter_title=ch["title"],
                paragraph_text=text,
                preceding_context=preceding,
                paragraph_index=index,
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
                scan_paragraph(ch, text, paragraphs[j - 1][1] if j > 0 else None, idx)
                for j, (idx, text) in enumerate(paragraphs)
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


def _html_paragraphs(content: str, min_chars: int = 12) -> list[tuple[int, str]]:
    """TipTap chapter HTML → (block index, plain text) per checkable paragraph.

    The index counts ALL <p> blocks, not just the ones long enough to check, so it
    matches the block index the editor sends on a live check. The two must agree:
    they are the key for paragraph-scoped supersession, and a silent mismatch means
    a re-check never clears the finding it replaces.
    """
    blocks = _P_RE.findall(content or "") or ([content] if content else [])
    out: list[tuple[int, str]] = []
    for i, block in enumerate(blocks):
        text = html_lib.unescape(_TAG_RE.sub(" ", block))
        text = " ".join(text.split())
        if len(text) >= min_chars:
            out.append((i, text))
    return out


async def resolve(book_id: str, req: ResolveRequest) -> ResolveResponse:
    if req.choice == "kept-old":
        # Nothing was stored for a pending contradiction, so keeping the original
        # is a no-op server-side; the author just fixes the prose.
        return ResolveResponse(ok=True)

    # kept-new → version-bump the conflicting canon memory (flagship feature).
    if not req.oldMemoryId or not req.newFactContent:
        raise ValueError("kept-new requires oldMemoryId and newFactContent")
    # Belt-and-braces: the card hides "Make canon" for prose-derived memories, but
    # they live in a different container, so update_memory here would either fail
    # or write to the wrong place — and the next sync would re-derive over it.
    if req.oldFactSource == "derived":
        raise ValueError(
            "a prose-derived memory can't be made canon — edit the chapter instead"
        )
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
    paragraph can both flag the same memory. Facts are judged first, so they win.

    Also collapses by id: ids are content-derived, so two findings that differ
    only by which canon version they matched share one id — emitting both would
    put duplicate ids in the panel and race for the same inline mark.
    """
    seen: set[tuple[str, str]] = set()
    seen_ids: set[str] = set()
    out: list[PendingContradiction] = []
    for p in pending:
        key = (p.entity.strip().lower(), p.oldMemoryId)
        if key in seen or p.id in seen_ids:
            continue
        seen.add(key)
        seen_ids.add(p.id)
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


def _pending_id(
    kind: str, chapter_id: str, entity: str, attribute: str | None, new_content: str
) -> str:
    """Stable identity for one logical contradiction.

    Deliberately excludes oldMemoryId: version-bumping the challenged canon
    memory (e.g. resolving a *different* conflict about the same entity) changes
    that id, and hashing it would fork one contradiction into two. Excludes the
    excerpt too — the statement is the claim; the excerpt is just where it was
    found. A re-check of unchanged prose must reproduce this exact id, or the
    frontend re-marks and the panel duplicates.
    """
    key = "|".join(
        [
            kind,
            chapter_id,
            _norm(entity),
            _norm(attribute or ""),
            _norm(new_content),
        ]
    )
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:8]


def _build_pending(
    kind: str,
    obj,
    conflicting_id,
    hits_by_id: dict,
    chapter_id: str,
    chapter_index: int,
    chapter_title: str,
    reason: str | None = None,
    paragraph_index: int | None = None,
) -> PendingContradiction:
    canon = hits_by_id.get(conflicting_id) or next(iter(hits_by_id.values()))
    md = canon["metadata"] or {}
    old_ref = FactRef(
        chapterId=str(md.get("chapterId", "")),
        chapterTitle=str(md.get("chapterTitle", "")),
        # Derived memories are restatements, not substrings, so they have no
        # excerpt — the memory text itself is the most faithful thing to show.
        excerpt=str(md.get("excerpt") or canon["memory"]),
    )
    new_content = obj.statement if kind == "fact" else obj.presupposedState
    new_ref = FactRef(chapterId=chapter_id, chapterTitle=chapter_title, excerpt=obj.excerpt)
    pid = _pending_id(
        kind, chapter_id, obj.entity, getattr(obj, "attribute", None), new_content
    )
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
        paragraphIndex=paragraph_index,
        oldFactSource=canon.get("source") or "curated",  # type: ignore[arg-type]
    )
