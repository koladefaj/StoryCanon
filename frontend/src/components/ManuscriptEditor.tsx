"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Chapter, Contradiction } from "@/lib/types";
import { ContradictionMark } from "@/lib/contradiction-mark";
import { paragraphCheck } from "@/lib/api";

const TOOLTIP_WIDTH = 288;
// Debounce before checking the paragraph the cursor is in (BUILD_PLAN §6).
const LIVE_CHECK_DELAY = 1800;
const MIN_PARAGRAPH_CHARS = 12;

// --- ProseMirror helpers for the live loop --------------------------------

/** Text of the top-level block the selection is in, its index among the doc's
 *  blocks, plus the previous block's text (used as pronoun-resolution context). */
function currentParagraph(editor: Editor): {
  text: string;
  preceding: string;
  index: number;
} {
  const { $from } = editor.state.selection;
  // node(1) is the top-level block that actually contains the cursor — the
  // authoritative "current paragraph" regardless of index bookkeeping.
  const block = $from.depth >= 1 ? $from.node(1) : null;
  const text = block?.textContent ?? "";
  const doc = editor.state.doc;
  // The preceding sibling supplies pronoun-resolution context. This index is
  // also the supersession key the backend echoes back — it must line up with
  // _html_paragraphs' block index there.
  const blockIndex = $from.index(0);
  const preceding =
    blockIndex > 0 && blockIndex <= doc.childCount
      ? doc.child(blockIndex - 1).textContent
      : "";
  return { text, preceding, index: blockIndex };
}

/** Find the first occurrence of `needle` and return its ProseMirror range. */
function findRange(
  editor: Editor,
  needle: string,
): { from: number; to: number } | null {
  if (!needle) return null;
  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText || !node.text) return !found;
    const idx = node.text.indexOf(needle);
    if (idx !== -1) found = { from: pos + idx, to: pos + idx + needle.length };
    return !found;
  });
  return found;
}

/** Mark the excerpt without moving the caret (no setTextSelection). */
function applyContradictionMark(editor: Editor, excerpt: string, id: string) {
  const range = findRange(editor, excerpt);
  if (!range) return;
  const markType = editor.schema.marks.contradiction;
  editor.view.dispatch(
    editor.state.tr.addMark(range.from, range.to, markType.create({ contradictionId: id })),
  );
}

type TooltipState = { id: string; top: number; left: number };

export function ManuscriptEditor({
  chapter,
  bookId,
  chapterIndex,
  contradictions,
  activeContradictionId,
  onMarkClick,
  onWordCountChange,
  onContentChange,
  onContradictionsDetected,
  onCanonChanged,
  onRename,
  prevChapter,
  nextChapter,
  onSelectChapter,
}: {
  chapter: Chapter;
  bookId: string;
  chapterIndex: number;
  contradictions: Contradiction[];
  activeContradictionId: string | null;
  onMarkClick: (id: string) => void;
  onWordCountChange: (wordCount: number) => void;
  onContentChange: (content: string) => void;
  onContradictionsDetected: (
    detected: Contradiction[],
    scope?: { chapterId: string; paragraphIndex: number },
  ) => void;
  onCanonChanged: () => void;
  onRename: (chapterId: string, title: string) => void;
  prevChapter?: Chapter;
  nextChapter?: Chapter;
  onSelectChapter: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // --- live paragraph-check plumbing --------------------------------------
  const editorRef = useRef<Editor | null>(null);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Every paragraph text already checked in this chapter — a single "last" string
  // would re-check unchanged paragraph A after visiting B and returning to A.
  // (Component remounts per chapter via `key`, so this is naturally per-chapter.)
  const checkedParagraphs = useRef<Set<string>>(new Set());
  // Mirror current props so the stable editor listener never reads stale values.
  const liveProps = useRef({
    bookId,
    chapterId: chapter.id,
    chapterIndex,
    chapterTitle: chapter.title,
    onContradictionsDetected,
    onCanonChanged,
  });
  useEffect(() => {
    liveProps.current = {
      bookId,
      chapterId: chapter.id,
      chapterIndex,
      chapterTitle: chapter.title,
      onContradictionsDetected,
      onCanonChanged,
    };
  });

  const runParagraphCheck = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const { text, preceding, index } = currentParagraph(editor);
    const trimmed = text.trim();
    if (trimmed.length < MIN_PARAGRAPH_CHARS) return;
    if (checkedParagraphs.current.has(trimmed)) return;
    checkedParagraphs.current.add(trimmed);

    const p = liveProps.current;
    try {
      const result = await paragraphCheck(p.bookId, {
        chapterId: p.chapterId,
        chapterIndex: p.chapterIndex,
        chapterTitle: p.chapterTitle,
        paragraphText: trimmed,
        precedingContext: preceding || undefined,
        paragraphIndex: index,
      });
      // Facts were stored/updated → canon changed, refresh the Story Bible.
      if (result.facts.length > 0) p.onCanonChanged();
      for (const c of result.contradictions) {
        try {
          applyContradictionMark(editor, c.newFact.excerpt, c.id);
        } catch {
          // Editor torn down (check was flushed on chapter switch) — the panel
          // entry below still lands; only the inline mark is skipped.
        }
      }
      // Reported even when empty: this result supersedes the paragraph's prior
      // findings, so "no contradictions" is how fixing the prose clears the flag.
      // Only reached on success — a failed check must never clear anything.
      p.onContradictionsDetected(result.contradictions, {
        chapterId: p.chapterId,
        paragraphIndex: index,
      });
    } catch {
      // Backend offline / transient — stay silent, writing must not be blocked.
    }
  }, []);

  const scheduleParagraphCheck = useCallback(() => {
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(runParagraphCheck, LIVE_CHECK_DELAY);
  }, [runParagraphCheck]);

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
      onContentChange(editor.getHTML());
    },
  });

  // Report the initial word count once the editor mounts, wire the live-check
  // listener, and expose the editor via a ref for the debounced checker.
  // (The parent remounts this component via `key` on chapter switch, so the
  // editor is always freshly created with the right chapter's content.)
  useEffect(() => {
    if (!editor) return;
    editorRef.current = editor;
    checkedParagraphs.current = new Set();
    onWordCountChange(editor.storage.characterCount.words());
    const onEditorUpdate = () => scheduleParagraphCheck();
    editor.on("update", onEditorUpdate);
    return () => {
      editor.off("update", onEditorUpdate);
      if (liveTimer.current) {
        clearTimeout(liveTimer.current);
        // Flush, don't discard: cancelling here used to silently drop the
        // pending check for the paragraph the author just left when switching
        // chapters before the debounce fired. Fire-and-forget — never blocks
        // the switch; results merge into the panel whenever they arrive.
        try {
          void runParagraphCheck();
        } catch {
          // Editor already torn down — nothing to flush.
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Clicking a confirmed mark hands off to the Continuity panel (the parent
  // opens it if closed and vibrates the matching card) — resolution lives there.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const mark = target.closest("mark.contradiction") as HTMLElement | null;
      if (!mark || !el.contains(mark)) return;
      const id = mark.getAttribute("data-contradiction-id");
      if (!id) return;
      if (!contradictions.some((c) => c.id === id)) return;
      onMarkClick(id);
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [onMarkClick, contradictions]);

  // Hovering a confirmed mark shows a read-only tooltip: what it conflicts
  // with, where, and the judge's reason.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let currentMark: HTMLElement | null = null;
    const onOver = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const mark = target.closest("mark.contradiction") as HTMLElement | null;
      if (!mark || !el.contains(mark) || mark === currentMark) return;
      const id = mark.getAttribute("data-contradiction-id");
      if (!id || !contradictions.some((c) => c.id === id)) return;
      currentMark = mark;
      const markRect = mark.getBoundingClientRect();
      const containerRect = el.getBoundingClientRect();
      const left = Math.min(
        Math.max(markRect.left - containerRect.left, 0),
        Math.max(el.clientWidth - TOOLTIP_WIDTH - 8, 0),
      );
      setTooltip({ id, top: markRect.bottom - containerRect.top + 8, left });
    };
    const onOut = (event: MouseEvent) => {
      if (!currentMark) return;
      const to = event.relatedTarget as Node | null;
      if (to && currentMark.contains(to)) return;
      currentMark = null;
      setTooltip(null);
    };
    el.addEventListener("mouseover", onOver);
    el.addEventListener("mouseout", onOut);
    return () => {
      el.removeEventListener("mouseover", onOver);
      el.removeEventListener("mouseout", onOut);
    };
  }, [contradictions]);

  // Ensure every known contradiction in THIS chapter has its inline mark —
  // full-book scan results and flushed checks arrive without marks applied.
  // Depends on `editor`: with immediatelyRender:false it is null on the first
  // render, so without it this never re-runs for contradictions that were
  // already in state at mount (i.e. every chapter switch).
  useEffect(() => {
    const editor = editorRef.current;
    const el = containerRef.current;
    if (!editor || !el) return;
    for (const c of contradictions) {
      if (c.newFact.chapterId !== chapter.id) continue;
      if (
        el.querySelector(
          `mark.contradiction[data-contradiction-id="${c.id}"]`,
        )
      )
        continue;
      try {
        applyContradictionMark(editor, c.newFact.excerpt, c.id);
      } catch {
        // Excerpt no longer present in the edited text — nothing to mark.
      }
    }
  }, [contradictions, chapter.id, editor]);

  // Marks stay inert until a check confirms them: flagged while unresolved,
  // dotted once decided. `mark.contradiction` alone renders invisible, so a
  // missed pass here means no red at all — hence the `editor` dep (see above).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.querySelectorAll("mark.contradiction").forEach((m) => {
      const id = m.getAttribute("data-contradiction-id");
      const c = contradictions.find((x) => x.id === id);
      m.classList.toggle("flagged", !!c && c.status === "unresolved");
      m.classList.toggle("resolved", !!c && c.status !== "unresolved");
    });
  }, [contradictions, chapter.id, editor]);

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
  }, [activeContradictionId, chapter.id, editor]);

  const tooltipContradiction = tooltip
    ? contradictions.find((c) => c.id === tooltip.id)
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

      {tooltip && tooltipContradiction && (
        <div
          style={{ top: tooltip.top, left: tooltip.left, width: TOOLTIP_WIDTH }}
          className="animate-fade-in pointer-events-none absolute z-10 rounded-xl border border-border bg-paper-raised p-3 shadow-lg shadow-black/5"
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-medium text-ink">
              {tooltipContradiction.entity}
            </p>
            <p className="shrink-0 text-[11px] text-ink-faint">
              vs. {tooltipContradiction.oldFact.chapterTitle}
            </p>
          </div>
          <p className="mt-2 font-serif text-[13px] italic leading-snug text-ink-soft">
            &ldquo;{tooltipContradiction.oldFact.excerpt}&rdquo;
          </p>
          {tooltipContradiction.reason && (
            <p className="mt-2 text-xs leading-relaxed text-ink-soft">
              {tooltipContradiction.reason}
            </p>
          )}
          <p className="mt-2 text-[11px] text-ink-faint">
            {tooltipContradiction.status === "unresolved"
              ? "Click to review in the Continuity panel"
              : tooltipContradiction.status === "kept-old"
                ? "Resolved — kept the original"
                : "Resolved — made canon"}
          </p>
        </div>
      )}
    </div>
  );
}
