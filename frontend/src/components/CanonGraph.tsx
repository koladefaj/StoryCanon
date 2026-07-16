"use client";

import { useEffect, useMemo, useState } from "react";
import { buildGraph, type GraphEdge, type GraphNode } from "@/lib/api";

const W = 900;
const H = 620;

/** Small deterministic force layout — canon graphs are tiny, O(n²) is fine. */
function layout(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const n = Math.max(nodes.length, 1);
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / n;
    pos.set(node.id, {
      x: W / 2 + (Math.min(W, H) / 3.2) * Math.cos(angle),
      y: H / 2 + (Math.min(W, H) / 3.2) * Math.sin(angle),
    });
  });
  const REPULSION = 22000;
  const SPRING = 0.06;
  const REST = 190;
  const CENTER = 0.012;
  for (let iteration = 0; iteration < 260; iteration++) {
    const force = new Map<string, { x: number; y: number }>();
    for (const node of nodes) force.set(node.id, { x: 0, y: 0 });
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = pos.get(nodes[i].id)!;
        const b = pos.get(nodes[j].id)!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = Math.max(dx * dx + dy * dy, 100);
        const f = REPULSION / d2;
        const d = Math.sqrt(d2);
        const fa = force.get(nodes[i].id)!;
        const fb = force.get(nodes[j].id)!;
        fa.x += (dx / d) * f;
        fa.y += (dy / d) * f;
        fb.x -= (dx / d) * f;
        fb.y -= (dy / d) * f;
      }
    }
    for (const e of edges) {
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const f = SPRING * (d - REST);
      const fa = force.get(e.source)!;
      const fb = force.get(e.target)!;
      fa.x += (dx / d) * f;
      fa.y += (dy / d) * f;
      fb.x -= (dx / d) * f;
      fb.y -= (dy / d) * f;
    }
    const cool = 1 - iteration / 260;
    for (const node of nodes) {
      const p = pos.get(node.id)!;
      const f = force.get(node.id)!;
      f.x += (W / 2 - p.x) * CENTER;
      f.y += (H / 2 - p.y) * CENTER;
      p.x += Math.max(-14, Math.min(14, f.x)) * cool;
      p.y += Math.max(-14, Math.min(14, f.y)) * cool;
      p.x = Math.max(60, Math.min(W - 60, p.x));
      p.y = Math.max(40, Math.min(H - 40, p.y));
    }
  }
  return pos;
}

export function CanonGraph({
  bookId,
  onClose,
}: {
  bookId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<{
    nodes: GraphNode[];
    edges: GraphEdge[];
  } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    buildGraph(bookId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const positions = useMemo(
    () => (data ? layout(data.nodes, data.edges) : null),
    [data],
  );

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-ink/20 p-6 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="animate-fade-in flex h-full max-h-[760px] w-full max-w-5xl flex-col rounded-2xl border border-border bg-paper shadow-2xl shadow-black/10">
        <div className="flex items-center justify-between border-b border-border-soft px-5 py-3.5">
          <div>
            <p className="text-sm font-medium text-ink">Relationship graph</p>
            <p className="mt-0.5 text-xs text-ink-faint">
              Mapped from the canon Supermemory extracted while you wrote
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close graph"
            className="cursor-pointer rounded-md p-1.5 text-ink-faint transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 p-2">
          {failed ? (
            <p className="mt-24 text-center text-[13px] text-ink-faint">
              Couldn&rsquo;t build the graph — is the backend running?
            </p>
          ) : !data ? (
            <p className="mt-24 animate-pulse text-center text-[13px] text-ink-faint">
              Mapping relationships from canon…
            </p>
          ) : data.edges.length === 0 ? (
            <div className="mt-24 px-10 text-center">
              <p className="text-[13px] font-medium text-ink-soft">
                No relationships yet
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-faint">
                Write scenes that connect your characters — marriages, feuds,
                jobs, kinships — and the graph will draw itself from canon.
              </p>
            </div>
          ) : (
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="h-full w-full"
              role="img"
              aria-label="Canon relationship graph"
            >
              {data.edges.map((e, i) => {
                const a = positions?.get(e.source);
                const b = positions?.get(e.target);
                if (!a || !b) return null;
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                return (
                  <g key={i}>
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="var(--color-border)"
                      strokeWidth="1.5"
                    />
                    <text
                      x={mx}
                      y={my - 5}
                      textAnchor="middle"
                      className="fill-[var(--color-ink-faint)]"
                      fontSize="11"
                      paintOrder="stroke"
                      stroke="var(--color-paper)"
                      strokeWidth="4"
                      strokeLinejoin="round"
                    >
                      {e.relation}
                    </text>
                  </g>
                );
              })}
              {data.nodes.map((node) => {
                const p = positions?.get(node.id);
                if (!p) return null;
                return (
                  <g key={node.id}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="9"
                      fill="var(--color-node)"
                      opacity="0.95"
                    />
                    <text
                      x={p.x}
                      y={p.y + 24}
                      textAnchor="middle"
                      className="fill-[var(--color-ink)]"
                      fontSize="13"
                      fontWeight="600"
                      paintOrder="stroke"
                      stroke="var(--color-paper)"
                      strokeWidth="4"
                      strokeLinejoin="round"
                    >
                      {node.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
