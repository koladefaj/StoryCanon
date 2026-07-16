"""Prompt builders for the two LLM calls: extract and judge.

Kept as pure functions so they're unit-testable without hitting a model.
"""
import json

# ---------------------------------------------------------------------------
# Extraction prompt
# ---------------------------------------------------------------------------

EXTRACT_SYSTEM = """You extract continuity-tracking data from a single paragraph of a fiction manuscript.

Return a JSON object with exactly two arrays: "facts" and "claims".

FACTS = durable, canonical story facts worth remembering as canon. Each is one
self-contained sentence. Store these:
  - physical appearance (eye/hair color, scars, height)
  - RANK, ROLE, TITLE, JOB, or AUTHORITY ("Voss is a sergeant", "Mara is queen") — ALWAYS a fact, never a claim
  - relationships and allegiances
  - world/history facts and dates ("the western wall was sealed 300 years ago")
  - object states and possessions ("the sword is shattered")
  - DURABLE STATE CHANGES — injuries, deaths, things breaking. Store the RESULTING
    state ("Elara lost her legs and cannot walk", "the king is dead").
Each fact: {"entity","attribute","statement","excerpt"}.

CLAIMS = transient assertions that PRESUPPOSE a state or capability. Never stored,
only checked against canon. Emit a claim ONLY where the presupposed state is
something canon might track: body/capability, possession, alive/dead, physical
location constraints, or role/authority being exercised.
Each claim: {"entity","presupposedState","excerpt"}.

RULES:
- One sentence per item. Resolve pronouns to entity names.
- "excerpt" MUST be a verbatim substring copied from the paragraph.
- Durability is the filter, NOT quantity. A plain sentence yields 0-5 facts; a dense
  introduction or info-dump can legitimately yield 15-20 — emit them all.
- Do NOT emit trivia as facts (transient weather, dust, a single gesture) unless it
  is a durable state. Do NOT emit a claim for every verb — only tracked states.
- If the same entity+attribute appears twice, keep the more specific one.

EXAMPLES:

Paragraph: "Behind her, Sergeant Voss cursed the heat. He was young for a sergeant, but he wore the rank like it had been stitched to his skin."
-> {"facts":[{"entity":"Voss","attribute":"rank","statement":"Voss holds the rank of sergeant.","excerpt":"Sergeant Voss"},{"entity":"Voss","attribute":"age","statement":"Voss is young for a sergeant.","excerpt":"young for a sergeant"}],"claims":[]}

Paragraph: "Elara lost both her legs in the mill accident that spring."
-> {"facts":[{"entity":"Elara","attribute":"legs","statement":"Elara lost both her legs in a mill accident and cannot walk.","excerpt":"lost both her legs in the mill accident"}],"claims":[]}

Paragraph: "Elara walked across the room and poured herself a drink."
-> {"facts":[],"claims":[{"entity":"Elara","presupposedState":"Elara can walk","excerpt":"walked across the room"}]}

Paragraph: "Elena shaved her beard and combed her brown hair."
-> {"facts":[{"entity":"Elena","attribute":"hair color","statement":"Elena has brown hair.","excerpt":"her brown hair"}],"claims":[{"entity":"Elena","presupposedState":"Elena has a beard (facial hair)","excerpt":"shaved her beard"}]}

Return ONLY the JSON object, no prose."""


def build_extract_messages(paragraph: str, preceding_context: str | None = None) -> list[dict]:
    user = ""
    if preceding_context:
        user += (
            "CONTEXT — the immediately preceding text. Use it ONLY to resolve "
            "pronouns and entity names in the paragraph below. Do NOT extract any "
            "facts or claims from this context:\n"
            f"{preceding_context}\n\n"
        )
    user += f"Paragraph:\n{paragraph}"
    return [
        {"role": "system", "content": EXTRACT_SYSTEM},
        {"role": "user", "content": user},
    ]


# ---------------------------------------------------------------------------
# Judge prompt — batched: array of items, each paired with retrieved canon
# ---------------------------------------------------------------------------

JUDGE_SYSTEM = """You are a continuity checker for a fiction manuscript. You are given a
JSON array of ITEMS. Each item is either a new FACT or a transient CLAIM the author
just wrote, paired with CANON memories already established in EARLIER chapters.

For each item, decide its verdict against its canon:
  - "duplicate"     : canon already states essentially this same fact. (facts only)
  - "consistent"    : compatible with canon; it extends or refines canon.
  - "contradiction" : it conflicts with canon.

CONTRADICTION INCLUDES ENTAILMENT VIOLATIONS, not just direct opposites. If canon
makes the item IMPOSSIBLE, that is a contradiction even if no single canon sentence
is the literal negation. Example — canon: "Elara lost her legs in the mill accident"
contradicts claim "Elara walked across the room", because losing her legs entails she
cannot walk. Judge state-vs-state, not word-vs-word.

COUNTING RULE: deaths and losses change totals. If canon says one of N children,
members, or items died / was lost / was destroyed, then later text where all N are
alive, present, or intact is a contradiction. Example — canon: "Zelda had three sons
but one died in an accident" contradicts "her three sons came to hug her": only two
sons remain, so all three cannot be present.

COMMONSENSE DEFAULTS: the category canon assigns an entity carries strong real-world
defaults, and violating one is a contradiction — a "young girl" does not have a beard
to shave, a horse does not speak, a newborn does not stride across a room. Example —
canon: "Elena was a beautiful young girl" contradicts claim "Elena has a beard".
EXCEPTION: if any canon memory establishes the exception for this world or entity
(a bearded folk, talking animals, a curse), it is NOT a contradiction — the story's
own rules always outrank real-world defaults. Cite the category-establishing memory
as conflictingMemoryId.

For a CLAIM, "contradiction" means canon makes the presupposed state false/impossible.
Claims are never "duplicate".

When verdict is "contradiction", set "conflictingMemoryId" to the id of the specific
canon memory it conflicts with.

Return JSON: {"verdicts":[{"itemIndex":<int>,"verdict":"...","conflictingMemoryId":<id or null>,"reason":"<short>"}]}
One verdict per input item, matched by itemIndex. Return ONLY the JSON object."""


# ---------------------------------------------------------------------------
# Relationship graph prompt — canon facts -> (source, relation, target) triples
# ---------------------------------------------------------------------------

GRAPH_SYSTEM = """You map a fiction manuscript's canon facts into a relationship graph.

Given a JSON array of FACTS (each with an entity and a statement), return
{"edges":[{"source":"...","relation":"...","target":"..."}]} where source and
target are NAMED entities (characters, places, organizations) and relation is a
short lowercase label read left to right:
  {"source":"John","relation":"married to","target":"Sarah"}
  {"source":"Sarah","relation":"mother of","target":"Emma"}
  {"source":"Emma","relation":"works at","target":"Star House"}
  {"source":"John","relation":"hates","target":"Victor"}
  {"source":"Victor","relation":"boyfriend of","target":"Emma"}

RULES:
- Only relationships between two NAMED entities. Skip pure attributes (eye
  color, rank, age) and states with no second entity.
- Use each entity's canonical name consistently — same spelling and casing in
  every edge it appears in.
- One edge per distinct relationship; deduplicate. Prefer the most specific
  label the facts support.
- Return ONLY the JSON object."""


def build_graph_messages(facts: list[dict]) -> list[dict]:
    """`facts[i]` = {"entity": str, "statement": str}."""
    payload = json.dumps({"facts": facts}, ensure_ascii=False, indent=1)
    return [
        {"role": "system", "content": GRAPH_SYSTEM},
        {"role": "user", "content": f"FACTS:\n{payload}"},
    ]


def build_judge_messages(judged_items: list[dict]) -> list[dict]:
    """`judged_items[i]` = {itemIndex, kind, statement/presupposedState, canon:[{id,memory,metadata}]}."""
    payload = json.dumps({"items": judged_items}, ensure_ascii=False, indent=2)
    return [
        {"role": "system", "content": JUDGE_SYSTEM},
        {"role": "user", "content": f"ITEMS:\n{payload}"},
    ]
