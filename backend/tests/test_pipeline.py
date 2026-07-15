"""Pipeline verdict logic — the load-bearing decisions — with LLM + Supermemory mocked.

No network, no model. Verifies that given an extraction + judge verdict, paragraph_check
stores/pends the right things.
"""
import pytest

from app import pipeline
from app.models import Claim, ExtractionResult, Fact, ItemVerdict, JudgeResult


def _canon_hit(mid="m1", excerpt="her eyes, a startling shade of green"):
    return {
        "id": mid,
        "memory": "Elara's eyes are green.",
        "metadata": {
            "entity": "Elara",
            "attribute": "eye color",
            "chapterId": "ch1",
            "chapterTitle": "The Salt Road",
            "excerpt": excerpt,
            "chapterIndex": 1,
        },
        "similarity": 0.9,
        "context": None,
    }


@pytest.fixture
def wiring(monkeypatch):
    """Install fakes; return a dict of knobs + recorders the test can set/read."""
    state = {
        "extraction": ExtractionResult(),
        "verdicts": [],
        "hits": [],  # returned by every search
        "created": [],  # payloads passed to create_facts
        "updated": [],  # (memory_id, new_content, metadata) passed to update_memory
    }

    async def fake_extract(_paragraph, _preceding_context=None):
        return state["extraction"]

    async def fake_judge(_items):
        return JudgeResult(verdicts=state["verdicts"])

    async def fake_search(*_args, **_kwargs):
        return state["hits"]

    async def fake_create(_book_id, memories):
        state["created"].extend(memories)
        return []

    async def fake_update(_book_id, memory_id, new_content, metadata=None):
        state["updated"].append((memory_id, new_content, metadata))
        return {"id": f"{memory_id}-v2"}

    monkeypatch.setattr(pipeline, "extract", fake_extract)
    monkeypatch.setattr(pipeline, "judge", fake_judge)
    monkeypatch.setattr(pipeline.memory, "search_facts", fake_search)
    monkeypatch.setattr(pipeline.memory, "create_facts", fake_create)
    monkeypatch.setattr(pipeline.memory, "update_memory", fake_update)
    return state


async def _run(**overrides):
    return await pipeline.paragraph_check(
        book_id="b1",
        chapter_id=overrides.get("chapter_id", "ch2"),
        chapter_index=overrides.get("chapter_index", 2),
        chapter_title=overrides.get("chapter_title", "Thane's Gate"),
        paragraph_text="(text)",
    )


VOSS_FACT = Fact(entity="Voss", attribute="rank", statement="Voss holds the rank of captain.", excerpt="Captain Voss")
GREEN_FACT = Fact(entity="Elara", attribute="eye color", statement="Elara has grey eyes.", excerpt="grey eyes")
WALK_CLAIM = Claim(entity="Elara", presupposedState="Elara can walk", excerpt="walked across the room")


async def test_fact_no_canon_is_stored(wiring):
    wiring["extraction"] = ExtractionResult(facts=[VOSS_FACT])
    wiring["hits"] = []  # nothing in canon yet
    res = await _run()
    assert len(wiring["created"]) == 1
    assert wiring["created"][0]["content"] == "Voss holds the rank of captain."
    assert res.contradictions == []


async def test_fact_contradiction_pends_not_stored(wiring):
    wiring["extraction"] = ExtractionResult(facts=[GREEN_FACT])
    wiring["hits"] = [_canon_hit("m1")]
    wiring["verdicts"] = [ItemVerdict(itemIndex=0, verdict="contradiction", conflictingMemoryId="m1")]
    res = await _run()
    assert wiring["created"] == []  # nothing stored
    assert len(res.contradictions) == 1
    pend = res.contradictions[0]
    assert pend.oldMemoryId == "m1"
    assert pend.newFactContent == "Elara has grey eyes."
    assert pend.kind == "fact"
    assert pend.oldFact.excerpt == "her eyes, a startling shade of green"
    assert pend.newFact.excerpt == "grey eyes"


async def test_fact_duplicate_not_stored_no_pending(wiring):
    wiring["extraction"] = ExtractionResult(facts=[GREEN_FACT])
    wiring["hits"] = [_canon_hit("m1")]
    wiring["verdicts"] = [ItemVerdict(itemIndex=0, verdict="duplicate")]
    res = await _run()
    assert wiring["created"] == []
    assert res.contradictions == []


async def test_fact_consistent_is_stored(wiring):
    wiring["extraction"] = ExtractionResult(facts=[GREEN_FACT])
    wiring["hits"] = [_canon_hit("m1")]
    wiring["verdicts"] = [ItemVerdict(itemIndex=0, verdict="consistent")]
    res = await _run()
    assert len(wiring["created"]) == 1
    assert res.contradictions == []


async def test_claim_contradiction_pends_and_is_never_stored(wiring):
    # The legs/walked case: canon says can't walk, claim says walked.
    wiring["extraction"] = ExtractionResult(claims=[WALK_CLAIM])
    wiring["hits"] = [
        {"id": "m9", "memory": "Elara cannot walk.",
         "metadata": {"chapterId": "ch1", "chapterTitle": "The Salt Road", "excerpt": "lost both her legs"},
         "similarity": 0.8, "context": None}
    ]
    wiring["verdicts"] = [ItemVerdict(itemIndex=0, verdict="contradiction", conflictingMemoryId="m9")]
    res = await _run()
    assert wiring["created"] == []  # claims are never stored
    assert len(res.contradictions) == 1
    assert res.contradictions[0].kind == "claim"
    assert res.contradictions[0].newFactContent == "Elara can walk"


async def test_claim_with_no_canon_is_ignored(wiring):
    wiring["extraction"] = ExtractionResult(claims=[WALK_CLAIM])
    wiring["hits"] = []
    res = await _run()
    assert wiring["created"] == []
    assert res.contradictions == []


async def test_fact_and_claim_flagging_same_memory_yield_one_card(wiring):
    # "her three sons" can surface as both a fact and a claim conflicting with the
    # same canon memory — the author needs one decision, not two cards.
    sons_fact = Fact(entity="Zelda", attribute="sons",
                     statement="Zelda has three sons.", excerpt="her three sons")
    sons_claim = Claim(entity="Zelda", presupposedState="All three of Zelda's sons are alive",
                       excerpt="three sons came to hug her")
    canon = {
        "id": "m7", "memory": "Zelda had three sons but one died.",
        "metadata": {"entity": "Zelda", "attribute": "sons", "chapterId": "ch1",
                     "chapterTitle": "The Tagerens", "excerpt": "one died", "chapterIndex": 1},
        "similarity": 0.9, "context": None,
    }
    wiring["extraction"] = ExtractionResult(facts=[sons_fact], claims=[sons_claim])
    wiring["hits"] = [canon]
    wiring["verdicts"] = [
        ItemVerdict(itemIndex=0, verdict="contradiction", conflictingMemoryId="m7"),
        ItemVerdict(itemIndex=1, verdict="contradiction", conflictingMemoryId="m7"),
    ]
    res = await _run()
    assert len(res.contradictions) == 1
    assert res.contradictions[0].kind == "fact"  # facts are judged first, so they win
    assert res.contradictions[0].oldMemoryId == "m7"


async def test_continuity_check_is_read_only_and_dedupes(wiring, monkeypatch):
    async def fake_list_chapters(_book_id):
        return [
            {"id": "ch1", "title": "The Salt Road", "index": 1,
             "content": "<p>Elara's eyes caught the light, a startling green.</p>"},
            {"id": "ch3", "title": "The Archive", "index": 3,
             "content": "<p>Her grey eyes narrowed at the faded entry.</p>"},
        ]

    monkeypatch.setattr(pipeline.memory, "list_chapters", fake_list_chapters)
    wiring["extraction"] = ExtractionResult(facts=[GREEN_FACT])  # every paragraph
    wiring["hits"] = [_canon_hit("m1")]
    wiring["verdicts"] = [
        ItemVerdict(itemIndex=0, verdict="contradiction", conflictingMemoryId="m1")
    ]
    pending = await pipeline.continuity_check("b1")
    assert wiring["created"] == [] and wiring["updated"] == []  # never writes
    # Both paragraphs re-detect the same (entity, memory) conflict → one card.
    assert len(pending) == 1
    assert pending[0].oldMemoryId == "m1"
    assert pending[0].status == "unresolved"


# --- same-chapter re-check behavior (edited paragraphs must not bloat canon) ---


def _same_chapter_hit(mid="m5", statement="Elara has grey eyes."):
    """A memory previously stored from THIS chapter (ch2) for GREEN_FACT's entity+attribute."""
    return {
        "id": mid,
        "memory": statement,
        "metadata": {
            "entity": "Elara",
            "attribute": "eye color",
            "chapterId": "ch2",
            "chapterTitle": "Thane's Gate",
            "excerpt": "grey eyes",
            "chapterIndex": 2,
        },
        "similarity": 0.95,
        "context": None,
    }


async def test_unchanged_rechecked_fact_is_skipped(wiring):
    wiring["extraction"] = ExtractionResult(facts=[GREEN_FACT])
    wiring["hits"] = [_same_chapter_hit(statement="Elara has grey eyes.")]
    res = await _run()
    assert wiring["created"] == []
    assert wiring["updated"] == []
    assert res.contradictions == []
    assert res.facts == []


async def test_edited_fact_updates_same_chapter_memory(wiring):
    # Paragraph was edited: stored "grey", extractor now says "storm-grey".
    edited = Fact(entity="Elara", attribute="eye color",
                  statement="Elara has storm-grey eyes.", excerpt="storm-grey eyes")
    wiring["extraction"] = ExtractionResult(facts=[edited])
    wiring["hits"] = [_same_chapter_hit("m5", statement="Elara has grey eyes.")]
    res = await _run()
    assert wiring["created"] == []  # revised, not duplicated
    assert len(wiring["updated"]) == 1
    mem_id, new_content, metadata = wiring["updated"][0]
    assert mem_id == "m5"
    assert new_content == "Elara has storm-grey eyes."
    assert metadata["chapterIndex"] == 2
    assert res.contradictions == []
    assert res.facts == [edited]


async def test_edited_fact_still_judged_against_earlier_canon(wiring):
    # Same-chapter revision target exists AND earlier-chapter canon contradicts.
    wiring["extraction"] = ExtractionResult(facts=[GREEN_FACT])
    wiring["hits"] = [
        _canon_hit("m1"),  # ch1: green eyes
        _same_chapter_hit("m5", statement="Elara has slate eyes."),
    ]
    wiring["verdicts"] = [ItemVerdict(itemIndex=0, verdict="contradiction", conflictingMemoryId="m1")]
    res = await _run()
    assert wiring["created"] == []
    assert wiring["updated"] == []  # contradiction → nothing written
    assert len(res.contradictions) == 1
    assert res.contradictions[0].oldMemoryId == "m1"
