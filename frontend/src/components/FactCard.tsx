"use client";

import type { Contradiction, ContradictionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

function FactRow({
  label,
  chapterTitle,
  excerpt,
  tone,
  onJump,
}: {
  label: string;
  chapterTitle: string;
  excerpt: string;
  tone: "old" | "new";
  onJump: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onJump}
      className="group block w-full cursor-pointer text-left"
    >
      <span
        className={cn(
          "text-[11px]",
          tone === "old" ? "text-ink-faint" : "font-medium text-flag",
        )}
      >
        {label} · {chapterTitle}
      </span>
      <p className="mt-0.5 font-serif text-[13px] italic leading-snug text-ink-soft transition-colors group-hover:text-ink">
        &ldquo;{excerpt}&rdquo;
      </p>
    </button>
  );
}

export function FactCard({
  contradiction,
  isActive,
  onJump,
  onResolve,
}: {
  contradiction: Contradiction;
  isActive: boolean;
  onJump: (contradictionId: string, chapterId: string) => void;
  onResolve: (contradictionId: string, status: ContradictionStatus) => void;
}) {
  const { id, entity, oldFact, newFact, status, newFactContent } = contradiction;
  const resolved = status !== "unresolved";
  // Supermemory read this one out of the prose. It's re-derived on every sync, so
  // version-bumping it would be wiped — the author fixes the text instead.
  const fromProse = contradiction.oldFactSource === "derived";

  return (
    <div
      className={cn(
        "animate-fade-in px-5 py-4 transition-colors",
        isActive && "bg-flag-soft/40",
        resolved && !isActive && "opacity-60",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            resolved ? "bg-kept" : "bg-flag",
          )}
        />
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          {entity}
        </p>
        <span className="shrink-0 text-[11px] text-ink-faint">
          {status === "unresolved"
            ? "Unresolved"
            : status === "kept-old"
              ? "Kept original"
              : "Made canon"}
        </span>
      </div>

      <div className="mt-2.5 space-y-2.5">
        <FactRow
          label={fromProse ? "Supermemory read" : "Established"}
          chapterTitle={oldFact.chapterTitle}
          excerpt={oldFact.excerpt}
          tone="old"
          onJump={() => onJump(id, oldFact.chapterId)}
        />
        <FactRow
          label="Contradicts"
          chapterTitle={newFact.chapterTitle}
          excerpt={newFact.excerpt}
          tone="new"
          onJump={() => onJump(id, newFact.chapterId)}
        />
      </div>

      {status === "kept-new" && (
        <div className="mt-2.5 rounded-md bg-paper-sunken px-2.5 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Version chain
          </p>
          <p className="mt-1 text-[12px] leading-snug text-ink-faint">
            <span className="line-through">&ldquo;{oldFact.excerpt}&rdquo;</span>
            <span> — {oldFact.chapterTitle} · superseded</span>
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-kept">
            &ldquo;{newFactContent ?? newFact.excerpt}&rdquo; · current
          </p>
        </div>
      )}

      <div className="mt-3">
        {!resolved ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onResolve(id, "kept-old")}
              className="flex-1 cursor-pointer rounded-md border border-border px-2 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
            >
              {fromProse ? "Dismiss" : "Keep original"}
            </button>
            {/* No "Make canon" for a prose-derived memory: it has no curated
                counterpart to version-bump, and the next sync re-derives it from
                the chapter anyway — so the fix is to edit the text. */}
            {!fromProse && (
              <button
                type="button"
                onClick={() => onResolve(id, "kept-new")}
                className="flex-1 cursor-pointer rounded-md bg-ink px-2 py-1.5 text-xs font-medium text-paper transition-colors hover:bg-ink/85"
              >
                Make canon
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onResolve(id, "unresolved")}
            className="cursor-pointer text-xs text-ink-faint transition-colors hover:text-ink"
          >
            Undo
          </button>
        )}
      </div>
    </div>
  );
}
