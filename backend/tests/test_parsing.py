from app.llm import _strip_fences
from app.models import ExtractionResult, JudgeResult


def test_strip_fences_plain():
    assert _strip_fences('{"facts":[]}') == '{"facts":[]}'


def test_strip_fences_json_block():
    fenced = '```json\n{"facts":[],"claims":[]}\n```'
    assert _strip_fences(fenced) == '{"facts":[],"claims":[]}'


def test_strip_fences_bare_block():
    fenced = '```\n{"a":1}\n```'
    assert _strip_fences(fenced) == '{"a":1}'


def test_extraction_result_parses():
    raw = '{"facts":[{"entity":"Elara","attribute":"eye color","statement":"Elara has green eyes.","excerpt":"green eyes"}],"claims":[]}'
    res = ExtractionResult.model_validate_json(raw)
    assert res.facts[0].entity == "Elara"
    assert res.claims == []


def test_extraction_result_defaults_missing_arrays():
    # Model may omit an empty array; defaults must fill it.
    res = ExtractionResult.model_validate_json('{"facts":[]}')
    assert res.claims == []


def test_judge_result_parses():
    raw = '{"verdicts":[{"itemIndex":0,"verdict":"contradiction","conflictingMemoryId":"m1"}]}'
    res = JudgeResult.model_validate_json(raw)
    assert res.verdicts[0].verdict == "contradiction"
    assert res.verdicts[0].conflictingMemoryId == "m1"
