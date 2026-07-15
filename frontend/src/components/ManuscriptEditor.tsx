"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { useEffect, useRef, useState } from "react";
import type { Chapter, Contradiction, ContradictionStatus } from "@/lib/types";
import { ContradictionMark } from "@/lib/contradiction-mark";

const POPOVER_WIDTH = 288;

type PopoverState = { id: string; top: number; left: number };

export function ManuscriptEditor({
  chapter,
  contradictions,
  activeContradictionId,
  onMarkClick,
  onWordCountChange,
  onResolve,
  onRename,
  prevChapter,
  nextChapter,
  onSelectChapter,
}: {
  chapter: Chapter;
  contradictions: Contradiction[];
  activeContradictionId: string | null;
  onMarkClick: (id: string) => void;
  onWordCountChange: (wordCount: number) => void;
  onResolve: (contradictionId: string, status: ContradictionStatus) => void;
  onRename: (chapterId: string, title: string) => void;
  prevChapter?: Chapter;
  nextChapter?: Chapter;
  onSelectChapter: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      ContradictionMark,
      Placeholder.configure({
        placeholder: "Begin writing this chapter…",
      }),
      CharacterCount,
    ],
    content: chapter.content,
    editorProps: {
      attributes: {
        class: "manuscript",
      },
    },
    onUpdate: ({ editor }) => {
      onWordCountChange(editor.storage.characterCount.words());
    },
  });

  // Report the initial word count once the editor mounts.
  // (The parent remounts this component via `key` on chapter switch, so the
  // editor is always freshly created with the right chapter's content.)
  useEffect(() => {
    if (!editor) return;
    onWordCountChange(editor.storage.characterCount.words());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Open the inline popover when a confirmed contradiction mark is clicked.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const mark = target.closest("mark.contradiction") as HTMLElement | null;
      if (!mark || !el.contains(mark)) return;
      const id = mark.getAttribute("data-contradiction-id");
      if (!id) return;
      const known = contradictions.some((c) => c.id === id);
      if (!known) return;
      onMarkClick(id);
      const markRect = mark.getBoundingClientRect();
      const containerRect = el.getBoundingClientRect();
      const left = Math.min(
        Math.max(markRect.left - containerRect.left, 0),
        Math.max(el.clientWidth - POPOVER_WIDTH - 8, 0),
      );
      setPopover({ id, top: markRect.bottom - containerRect.top + 8, left });
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [onMarkClick, contradictions]);

  // Dismiss the popover on outside click or Escape.
  useEffect(() => {
    if (!popover) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (popoverRef.current?.contains(target)) return;
      if (target.closest("mark.contradiction")) return;
      setPopover(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopover(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [popover]);

  // Marks stay inert until a check confirms them: flagged while unresolved,
  // dotted once decided.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.querySelectorAll("mark.contradiction").forEach((m) => {
      const id = m.getAttribute("data-contradiction-id");
      const c = contradictions.find((x) => x.id === id);
      m.classList.toggle("flagged", !!c && c.status === "unresolved");
      m.classList.toggle("resolved", !!c && c.status !== "unresolved");
    });
  }, [contradictions, chapter.id]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const marks = el.querySelectorAll("mark.contradiction");
    marks.forEach((m) => {
      const id = m.getAttribute("data-contradiction-id");
      m.classList.toggle("active", id === activeContradictionId);
      if (id === activeContradictionId) {
        m.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }, [activeContradictionId, chapter.id]);

  const popoverContradiction = popover
    ? contradictions.find((c) => c.id === popover.id)
    : undefined;

  return (
    <div
      ref={containerRef}
      className="relative mx-auto w-full max-w-2xl px-6 py-16"
    >
      <p className="text-xs font-medium text-ink-faint">
        Chapter {chapter.index}
      </p>
      <input
        value={chapter.title}
        onChange={(e) => onRename(chapter.id, e.target.value)}
        placeholder="Untitled"
        aria-label="Chapter title"
        className="mt-2 mb-8 w-full bg-transparent font-serif text-[1.75rem] font-semibold tracking-tight text-ink outline-none placeholder:text-ink-faint"
      />
      <EditorContent editor={editor} />

      <div className="mt-16 flex items-center border-t border-border-soft pt-5">
        <div className="flex-1">
          {prevChapter && (
            <button
              type="button"
              onClick={() => onSelectChapter(prevChapter.id)}
              className="group cursor-pointer text-left"
            >
              <span className="text-[11px] text-ink-faint">← Previous</span>
              <p className="mt-0.5 text-[13px] font-medium text-ink-soft transition-colors group-hover:text-ink">
                {prevChapter.title}
              </p>
            </button>
          )}
        </div>
        <span className="flex-1 text-center text-xs tabular-nums text-ink-faint">
          {chapter.wordCount.toLocaleString()} words
        </span>
        <div className="flex flex-1 justify-end">
          {nextChapter && (
            <button
              type="button"
              onClick={() => onSelectChapter(nextChapter.id)}
              className="group cursor-pointer text-right"
            >
              <span className="text-[11px] text-ink-faint">Next →</span>
              <p className="mt-0.5 text-[13px] font-medium text-ink-soft transition-colors group-hover:text-ink">
                {nextChapter.title}
              </p>
            </button>
          )}
        </div>
      </div>

      {popover && popoverContradiction && (
        <div
          ref={popoverRef}
          style={{ top: popover.top, left: popover.left, width: POPOVER_WIDTH }}
          className="animate-fade-in absolute z-10 rounded-xl border border-border bg-paper-raised p-3 shadow-lg shadow-black/5"
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-medium text-ink">
              {popoverContradiction.entity}
            </p>
            <p className="shrink-0 text-[11px] text-ink-faint">
              vs. {popoverContradiction.oldFact.chapterTitle}
            </p>
          </div>
          <p className="mt-2 font-serif text-[13px] italic leading-snug text-ink-soft">
            &ldquo;{popoverContradiction.oldFact.excerpt}&rdquo;
          </p>

          {popoverContradiction.status === "unresolved" ? (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onResolve(popoverContradiction.id, "kept-old");
                  setPopover(null);
                }}
                className="flex-1 cursor-pointer rounded-md border border-border px-2 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
              >
                Keep original
              </button>
              <button
                type="button"
                onClick={() => {
                  onResolve(popoverContradiction.id, "kept-new");
                  setPopover(null);
                }}
                className="flex-1 cursor-pointer rounded-md bg-ink px-2 py-1.5 text-xs font-medium text-paper transition-colors hover:bg-ink/85"
              >
                Make canon
              </button>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-kept">
                {popoverContradiction.status === "kept-old"
                  ? "Kept original"
                  : "Made canon"}
              </span>
              <button
                type="button"
                onClick={() => onResolve(popoverContradiction.id, "unresolved")}
                className="cursor-pointer text-xs text-ink-faint transition-colors hover:text-ink"
              >
                Undo
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
