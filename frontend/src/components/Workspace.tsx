"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { ManuscriptEditor } from "./ManuscriptEditor";
import { ContinuityPanel } from "./ContinuityPanel";
import {
  books as initialBooks,
  contradictionsByBook as mockResults,
} from "@/lib/mock-data";
import type { Chapter, Contradiction, ContradictionStatus } from "@/lib/types";

const CHECK_PHASES: [string, number][] = [
  ["Reading chapters…", 0],
  ["Extracting facts…", 550],
  ["Comparing against canon…", 1200],
];
const CHECK_DONE_AT = 1900;
const RESULT_STAGGER = 240;

function newChapter(index: number): Chapter {
  return {
    id: `ch-${Date.now()}`,
    index,
    title: "Untitled",
    content: "",
    wordCount: 0,
  };
}

export function Workspace() {
  const [books, setBooks] = useState(initialBooks);
  const [activeBookId, setActiveBookId] = useState(books[0].id);
  const [activeChapterId, setActiveChapterId] = useState(
    books[0].chapters[0].id,
  );
  // Continuity results per book; a book with no entry has never been checked.
  const [resultsByBook, setResultsByBook] = useState<
    Record<string, Contradiction[]>
  >({});
  const [activeContradictionId, setActiveContradictionId] = useState<
    string | null
  >(null);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const [checking, setChecking] = useState(false);
  const [checkPhase, setCheckPhase] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showPanel, setShowPanel] = useState(true);

  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeBook = useMemo(
    () => books.find((b) => b.id === activeBookId) ?? books[0],
    [books, activeBookId],
  );
  const chapters = activeBook.chapters;
  const activeChapter = useMemo(
    () => chapters.find((c) => c.id === activeChapterId) ?? chapters[0],
    [chapters, activeChapterId],
  );
  const contradictions = useMemo(
    () => resultsByBook[activeBookId] ?? [],
    [resultsByBook, activeBookId],
  );
  const checked = activeBookId in resultsByBook;

  const chapterIndex = chapters.findIndex((c) => c.id === activeChapter.id);
  const prevChapter = chapterIndex > 0 ? chapters[chapterIndex - 1] : undefined;
  const nextChapter =
    chapterIndex < chapters.length - 1 ? chapters[chapterIndex + 1] : undefined;

  const updateActiveBookChapters = useCallback(
    (update: (chapters: Chapter[]) => Chapter[]) => {
      setBooks((prev) =>
        prev.map((b) =>
          b.id === activeBookId ? { ...b, chapters: update(b.chapters) } : b,
        ),
      );
    },
    [activeBookId],
  );

  const handleWordCountChange = useCallback(
    (wordCount: number) => {
      updateActiveBookChapters((prev) =>
        prev.map((c) =>
          c.id === activeChapterId ? { ...c, wordCount } : c,
        ),
      );
      setSaveState("saving");
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => setSaveState("saved"), 600);
    },
    [activeChapterId, updateActiveBookChapters],
  );

  const handleCheckContinuity = useCallback(() => {
    const bookId = activeBookId;
    setChecking(true);
    setActiveContradictionId(null);
    setShowPanel(true);
    setResultsByBook((prev) => {
      const next = { ...prev };
      delete next[bookId];
      return next;
    });
    for (const [phase, at] of CHECK_PHASES) {
      setTimeout(() => setCheckPhase(phase), at);
    }
    setTimeout(() => {
      setChecking(false);
      setCheckPhase(null);
      setResultsByBook((prev) => ({ ...prev, [bookId]: [] }));
      (mockResults[bookId] ?? []).forEach((c, i) => {
        setTimeout(
          () =>
            setResultsByBook((prev) => ({
              ...prev,
              [bookId]: [...(prev[bookId] ?? []), c],
            })),
          i * RESULT_STAGGER,
        );
      });
    }, CHECK_DONE_AT);
  }, [activeBookId]);

  const handleJump = useCallback(
    (contradictionId: string, chapterId: string) => {
      setActiveChapterId(chapterId);
      setActiveContradictionId(contradictionId);
    },
    [],
  );

  const handleResolve = useCallback(
    (contradictionId: string, status: ContradictionStatus) => {
      setResultsByBook((prev) => ({
        ...prev,
        [activeBookId]: (prev[activeBookId] ?? []).map((c) =>
          c.id === contradictionId ? { ...c, status } : c,
        ),
      }));
    },
    [activeBookId],
  );

  const handleSelectChapter = useCallback((id: string) => {
    setActiveChapterId(id);
    setActiveContradictionId(null);
  }, []);

  const handleAddChapter = useCallback(() => {
    const chapter = newChapter(chapters.length + 1);
    updateActiveBookChapters((prev) => [...prev, chapter]);
    setActiveChapterId(chapter.id);
    setActiveContradictionId(null);
  }, [chapters.length, updateActiveBookChapters]);

  const handleRenameChapter = useCallback(
    (id: string, title: string) => {
      updateActiveBookChapters((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title } : c)),
      );
    },
    [updateActiveBookChapters],
  );

  const handleSelectBook = useCallback(
    (id: string) => {
      const book = books.find((b) => b.id === id);
      if (!book) return;
      setActiveBookId(id);
      setActiveChapterId(book.chapters[0].id);
      setActiveContradictionId(null);
    },
    [books],
  );

  const handleAddBook = useCallback(() => {
    const chapter = newChapter(1);
    const book = {
      id: `book-${Date.now()}`,
      title: `Book ${books.length + 1}`,
      chapters: [chapter],
    };
    setBooks((prev) => [...prev, book]);
    setActiveBookId(book.id);
    setActiveChapterId(chapter.id);
    setActiveContradictionId(null);
  }, [books.length]);

  const handleRenameBook = useCallback(
    (id: string, title: string) => {
      setBooks((prev) =>
        prev.map((b) => (b.id === id ? { ...b, title } : b)),
      );
    },
    [],
  );

  const unresolvedCount = contradictions.filter(
    (c) => c.status === "unresolved",
  ).length;

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        books={books}
        activeBookId={activeBookId}
        onSelectBook={handleSelectBook}
        onAddBook={handleAddBook}
        onRenameBook={handleRenameBook}
        chapterTitle={activeChapter.title}
        saveState={saveState}
        unresolvedCount={unresolvedCount}
        onCheckContinuity={handleCheckContinuity}
        checking={checking}
        onToggleSidebar={() => setShowSidebar((v) => !v)}
        onTogglePanel={() => setShowPanel((v) => !v)}
      />
      <div className="flex min-h-0 flex-1">
        {showSidebar && (
          <Sidebar
            chapters={chapters}
            activeChapterId={activeChapter.id}
            onSelectChapter={handleSelectChapter}
            onAddChapter={handleAddChapter}
            contradictions={contradictions}
          />
        )}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <ManuscriptEditor
            key={`${activeBook.id}:${activeChapter.id}`}
            chapter={activeChapter}
            contradictions={contradictions}
            activeContradictionId={activeContradictionId}
            onMarkClick={setActiveContradictionId}
            onWordCountChange={handleWordCountChange}
            onResolve={handleResolve}
            onRename={handleRenameChapter}
            prevChapter={prevChapter}
            nextChapter={nextChapter}
            onSelectChapter={handleSelectChapter}
          />
        </main>
        {showPanel && (
          <ContinuityPanel
            contradictions={contradictions}
            activeContradictionId={activeContradictionId}
            checking={checking}
            checkPhase={checkPhase}
            checked={checked}
            onJump={handleJump}
            onResolve={handleResolve}
          />
        )}
      </div>
    </div>
  );
}
