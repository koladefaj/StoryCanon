"use client";

import type { Chapter, Contradiction } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Sidebar({
  chapters,
  activeChapterId,
  onSelectChapter,
  onAddChapter,
  onDeleteChapter,
  contradictions,
}: {
  chapters: Chapter[];
  activeChapterId: string;
  onSelectChapter: (id: string) => void;
  onAddChapter: () => void;
  onDeleteChapter: (id: string) => void;
  contradictions: Contradiction[];
}) {
  const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);

  const flagsForChapter = (chapterId: string) =>
    contradictions.filter(
      (c) => c.newFact.chapterId === chapterId && c.status === "unresolved",
    ).length;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border">
      <div className="px-4 pt-4 pb-2">
        <p className="text-xs font-medium text-ink-faint">Chapters</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {chapters.map((chapter) => {
          const active = chapter.id === activeChapterId;
          const flags = flagsForChapter(chapter.id);
          return (
            <div
              key={chapter.id}
              className={cn(
                "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                active
                  ? "bg-ink/[0.06] font-medium text-ink"
                  : "text-ink-soft hover:bg-ink/[0.03] hover:text-ink",
              )}
            >
              <button
                type="button"
                onClick={() => onSelectChapter(chapter.id)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
              >
                <span className="w-4 shrink-0 text-[11px] tabular-nums text-ink-faint">
                  {chapter.index}
                </span>
                <span className="min-w-0 flex-1 truncate">{chapter.title}</span>
              </button>
              {flags > 0 && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-flag"
                  title={`${flags} unresolved contradiction${flags === 1 ? "" : "s"}`}
                />
              )}
              {chapters.length > 1 && (
                <button
                  type="button"
                  onClick={() => onDeleteChapter(chapter.id)}
                  aria-label={`Delete chapter ${chapter.title}`}
                  title="Delete chapter"
                  className="shrink-0 cursor-pointer rounded p-0.5 text-ink-faint opacity-0 transition-opacity hover:text-flag-red focus:opacity-100 group-hover:opacity-100"
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                    <path d="M3 4.5h10M6.5 4.5V3.5a1 1 0 011-1h1a1 1 0 011 1v1M5 4.5l.5 8a1 1 0 001 1h3a1 1 0 001-1l.5-8" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={onAddChapter}
          className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink-faint transition-colors hover:bg-ink/[0.03] hover:text-ink-soft"
        >
          <span className="w-4 shrink-0 text-center">+</span>
          New chapter
        </button>
      </nav>

      <div className="border-t border-border-soft px-4 py-3">
        <p className="text-[11px] tabular-nums text-ink-faint">
          {chapters.length} chapters · {totalWords.toLocaleString()} words
        </p>
      </div>
    </aside>
  );
}
