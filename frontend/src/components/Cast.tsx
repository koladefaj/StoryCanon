"use client";

import { useEffect, useMemo, useState } from "react";
import { buildGraph, type GraphEdge, type GraphNode } from "@/lib/api";

type Tie = { relation: string; other: string };

// The graph stores directed edges ("A mother of B"). On B's card that edge has
// to be flipped, or it reads backwards. Known inverses are phrased naturally;
// symmetric relations map to themselves so they show on both cards. An unknown
// relation returns null and its incoming side is dropped — it still appears,
// correctly oriented, on the source character's card.
const INVERSE: Record<string, string> = {
  "mother of": "child of",
  "father of": "child of",
  "parent of": "child of",
  "older brother of": "younger sibling of",
  "younger brother of": "older sibling of",
  "older sister of": "younger sibling of",
  "younger sister of": "older sibling of",
  "brother of": "sibling of",
  "sister of": "sibling of",
  "sibling of": "sibling of",
  "married to": "married to",
  "engaged to": "engaged to",
  "friend of": "friend of",
  "enemy of": "enemy of",
};

function inverseRelation(relation: string): string | null {
  return INVERSE[relation.trim().toLowerCase()] ?? null;
}

/** The cast of a book: every character grouped with the relationships canon
 *  established for them. Reads like a character sheet, not a network diagram. */
export function Cast({ bookId }: { bookId: string }) {
  const [data, setData] = useState<{
    nodes: GraphNode[];
    edges: GraphEdge[];
  } | null>(null);
  const [failed, setFailed] = useState(false);

  // Fetch on mount (i.e. when the Cast tab is opened) — this is an LLM pass, so
  // it deliberately does NOT re-run on every keystroke.
  useEffect(() => {
    let cancelled = false;
    buildGraph(bookId)
      .then((res) => !cancelled && setData(res))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const cast = useMemo(() => {
    if (!data) return [];
    const labelOf = new Map(data.nodes.map((n) => [n.id, n.label]));
    const ties = new Map<string, Tie[]>();
    for (const n of data.nodes) ties.set(n.id, []);
    for (const e of data.edges) {
      // Outgoing reads naturally as written: "Elias — older brother of — Corvin".
      ties.get(e.source)?.push({
        relation: e.relation,
        other: labelOf.get(e.target) ?? e.target,
      });
      // Incoming needs the inverse, or it reads as nonsense ("Elias — mother of
      // — Adelia"). Show the inverse when we know it; otherwise skip it — the
      // relationship is already shown, correctly, on the other character's card.
      const inverse = inverseRelation(e.relation);
      if (inverse) {
        ties.get(e.target)?.push({
          relation: inverse,
          other: labelOf.get(e.source) ?? e.source,
        });
      }
    }
    // Characters with relationships first, each alphabetical; then anyone isolated.
    return data.nodes
      .map((n) => ({ name: n.label, ties: ties.get(n.id) ?? [] }))
      .sort(
        (a, b) =>
          b.ties.length - a.ties.length || a.name.localeCompare(b.name),
      );
  }, [data]);

  if (!data && !failed) {
    return (
      <p className="mt-16 animate-pulse text-center text-[13px] text-ink-faint">
        Reading the cast…
      </p>
    );
  }

  if (failed || cast.every((c) => c.ties.length === 0)) {
    return (
      <div className="mt-16 px-6 text-center">
        <p className="text-[13px] font-medium text-ink-soft">
          {failed ? "Couldn’t reach the backend" : "No relationships yet"}
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-faint">
          {failed
            ? "The cast is built from canon — check that the backend is running."
            : "Write scenes that connect your characters — kin, marriages, friendships, jobs — and they’ll appear here."}
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border-soft">
      {cast
        .filter((c) => c.ties.length > 0)
        .map((c) => (
          <div key={c.name} className="px-5 py-4">
            <p className="font-serif text-[15px] font-semibold text-ink">
              {c.name}
            </p>
            <div className="mt-2.5 space-y-1.5">
              {c.ties.map((t, i) => (
                <div key={i} className="flex items-baseline gap-2 text-[13px]">
                  <span className="shrink-0 text-ink-faint">{t.relation}</span>
                  <span className="min-w-0 flex-1 translate-y-[-3px] border-b border-dotted border-border" />
                  <span className="shrink-0 font-medium text-ink-soft">
                    {t.other}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
