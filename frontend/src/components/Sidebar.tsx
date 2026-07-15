"use client";

import type { Chapter, Contradiction } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Sidebar({
  chapters,
  activeChapterId,
  onSelectChapter,
  onAddChapter,
  contradictions,
}: {
  chapters: Chapter[];
  activeChapterId: string;
  onSelectChapter: (id: string) => void;
  onAddChapter: () => void;
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
            <button
              key={chapter.id}
              type="button"
              onClick={() => onSelectChapter(chapter.id)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                active
                  ? "bg-ink/[0.06] font-medium text-ink"
                  : "text-ink-soft hover:bg-ink/[0.03] hover:text-ink",
              )}
            >
              <span className="w-4 shrink-0 text-[11px] tabular-nums text-ink-faint">
                {chapter.index}
              </span>
              <span className="min-w-0 flex-1 truncate">{chapter.title}</span>
              {flags > 0 && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-flag"
                  title={`${flags} unresolved contradiction${flags === 1 ? "" : "s"}`}
                />
              )}
            </button>
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
