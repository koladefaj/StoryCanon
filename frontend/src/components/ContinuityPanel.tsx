"use client";

import { useEffect, useRef, useState } from "react";
import type { Contradiction, ContradictionStatus } from "@/lib/types";
import { FactCard } from "./FactCard";
import { StoryBible } from "./StoryBible";
import { Cast } from "./Cast";
import { cn } from "@/lib/utils";

export function ContinuityPanel({
  bookId,
  canonRefreshKey = 0,
  contradictions,
  activeContradictionId,
  focusNonce = 0,
  checking,
  checkPhase,
  checked,
  onJump,
  onResolve,
}: {
  bookId: string;
  // Bumped by the parent when canon changes, so the Story Bible re-fetches.
  canonRefreshKey?: number;
  contradictions: Contradiction[];
  activeContradictionId: string | null;
  // Bumped by the parent on each editor-mark click to re-trigger the vibrate.
  focusNonce?: number;
  checking: boolean;
  checkPhase: string | null;
  checked: boolean;
  onJump: (contradictionId: string, chapterId: string) => void;
  onResolve: (contradictionId: string, status: ContradictionStatus) => void;
}) {
  const [tab, setTab] = useState<"issues" | "bible" | "cast">("issues");
  const unresolved = contradictions.filter((c) => c.status === "unresolved");
  const resolved = contradictions.filter((c) => c.status !== "unresolved");

  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const setCardRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  };

  // Scroll the clicked mark's card into view and give it a mini vibrate.
  useEffect(() => {
    if (!activeContradictionId) return;
    const el = cardRefs.current.get(activeContradictionId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    el.classList.remove("card-shake");
    void el.offsetWidth; // restart the animation when re-clicked
    el.classList.add("card-shake");
  }, [activeContradictionId, focusNonce]);

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border">
      <div className="border-b border-border-soft px-5 pt-4 pb-0">
        <p className="text-sm font-medium text-ink">
          {tab === "issues"
            ? "Continuity"
            : tab === "bible"
              ? "Story Bible"
              : "Cast"}
        </p>
        <p className="mt-0.5 text-xs text-ink-faint">
          {tab === "cast"
            ? "Who's who and how they connect"
            : tab === "bible"
              ? "Everything the story has established"
              : checking
                ? "Checking manuscript"
                : !checked
                  ? "Not checked yet"
                  : unresolved.length === 0
                    ? "No open contradictions"
                    : `${unresolved.length} awaiting a decision`}
        </p>
        <div className="mt-3 flex gap-4">
          {(
            [
              ["issues", "Issues"],
              ["bible", "Story Bible"],
              ["cast", "Cast"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "cursor-pointer border-b-2 pb-2 text-xs font-medium transition-colors",
                tab === key
                  ? "border-ink text-ink"
                  : "border-transparent text-ink-faint hover:text-ink-soft",
              )}
            >
              {label}
              {key === "issues" && unresolved.length > 0 && (
                <span className="ml-1 rounded-full bg-flag-soft px-1.5 text-[10px] font-semibold text-flag">
                  {unresolved.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "cast" ? (
          <Cast key={bookId} bookId={bookId} />
        ) : tab === "bible" ? (
          <StoryBible key={bookId} bookId={bookId} refreshKey={canonRefreshKey} />
        ) : checking ? (
          <div className="mt-16 flex flex-col items-center px-6 text-center">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint" />
            <p className="mt-3 animate-pulse text-[13px] text-ink-faint">
              {checkPhase}
            </p>
          </div>
        ) : contradictions.length === 0 ? (
          <div className="mt-16 px-6 text-center">
            <p className="text-[13px] font-medium text-ink-soft">
              {checked ? "No contradictions found" : "No contradictions yet"}
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-faint">
              {checked
                ? "This manuscript agrees with everything StoryCanon has on record."
                : "Run a check to compare this manuscript against established canon."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border-soft">
            {unresolved.map((c) => (
              <div key={c.id} ref={setCardRef(c.id)}>
                <FactCard
                  contradiction={c}
                  isActive={c.id === activeContradictionId}
                  onJump={onJump}
                  onResolve={onResolve}
                />
              </div>
            ))}

            {resolved.length > 0 && (
              <div>
                <p className="px-5 pt-4 text-xs font-medium text-ink-faint">
                  Resolved
                </p>
                {resolved.map((c) => (
                  <div key={c.id} ref={setCardRef(c.id)}>
                    <FactCard
                      contradiction={c}
                      isActive={c.id === activeContradictionId}
                      onJump={onJump}
                      onResolve={onResolve}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-border-soft px-5 py-3">
        <p className="text-[11px] leading-relaxed text-ink-faint">
          StoryCanon never overwrites a fact on its own — every contradiction
          waits for your decision.
        </p>
      </div>
    </aside>
  );
}
