from app.models import Claim, Fact
from app.pipeline import _dedupe_claims, _dedupe_facts


def test_dedupe_facts_keeps_most_specific():
    facts = [
        Fact(entity="Voss", attribute="age", statement="Voss is young.", excerpt="young"),
        Fact(entity="Voss", attribute="age", statement="Voss is young for a sergeant.", excerpt="young for a sergeant"),
    ]
    out = _dedupe_facts(facts)
    assert len(out) == 1
    assert out[0].statement == "Voss is young for a sergeant."


def test_dedupe_facts_case_insensitive_key_but_keeps_distinct_attrs():
    facts = [
        Fact(entity="Voss", attribute="Rank", statement="Voss is a sergeant.", excerpt="Sergeant"),
        Fact(entity="voss", attribute="rank", statement="Voss holds the rank of sergeant.", excerpt="rank"),
        Fact(entity="Voss", attribute="age", statement="Voss is young.", excerpt="young"),
    ]
    out = _dedupe_facts(facts)
    assert len(out) == 2  # rank (merged) + age
    ranks = [f for f in out if f.attribute.lower() == "rank"]
    assert ranks[0].statement == "Voss holds the rank of sergeant."


def test_dedupe_claims_drops_exact_repeats():
    claims = [
        Claim(entity="Elara", presupposedState="Elara can walk", excerpt="walked"),
        Claim(entity="Elara", presupposedState="Elara can walk", excerpt="strode"),
    ]
    assert len(_dedupe_claims(claims)) == 1
