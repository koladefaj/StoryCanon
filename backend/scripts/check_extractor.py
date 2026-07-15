"""Verify the extractor prompt on the cases that mattered

Run:  uv run python scripts/check_extractor.py
Requires a working EXTRACTOR_MODEL + provider key in backend/.env.

Confirms:
  #1  Voss's RANK lands in facts (not claims)
      legs -> FACT, walked -> CLAIM (the load-bearing entailment case).
"""
import asyncio

from app.llm import extract

CASES = [
    ("Voss rank -> must be a FACT (attribute=rank)",
     "Behind her, Sergeant Voss cursed the heat and the flies in equal measure, though "
     "never loud enough for the captain to hear. He was young for a sergeant, barely older "
     "than Elara herself, but he wore the rank like it had been stitched to his skin."),
    ("legs -> must be a FACT",
     "Elara lost both her legs in the mill accident that spring, and the healers said she "
     "would never walk again."),
    ("walked -> must be a CLAIM (presupposedState 'can walk')",
     "Elara walked across the room and poured herself a drink, her boots loud on the stone floor."),
]


async def main():
    for name, para in CASES:
        res = await extract(para)
        print(f"\n### {name}")
        print("  facts: ", [(f.entity, f.attribute) for f in res.facts])
        print("  claims:", [(c.entity, c.presupposedState) for c in res.claims])

    # Assertion for #1 on the first case.
    voss = await extract(CASES[0][1])
    has_rank_fact = any(f.entity.lower().startswith("voss") or "voss" in f.entity.lower()
                        for f in voss.facts if "rank" in f.attribute.lower() or "sergeant" in f.statement.lower())
    print(f"\n#1 FIX — Voss rank stored as a FACT? {'PASS ✓' if has_rank_fact else 'FAIL ✗'}")


if __name__ == "__main__":
    asyncio.run(main())
