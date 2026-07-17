"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { ManuscriptEditor } from "./ManuscriptEditor";
import { ContinuityPanel } from "./ContinuityPanel";
import type { Book, Chapter, Contradiction, ContradictionStatus } from "@/lib/types";
import {
  continuityCheck,
  continuityCheckStream,
  deleteBook,
  deleteChapter,
  getBooks,
  getContradictions,
  resolveContradiction,
  saveBook,
  saveChapter,
  saveContradictions,
} from "@/lib/api";

const RESULT_STAGGER = 240;

function countWords(html: string): number {
  const text = html.replace(/<[^>]+>/g, " ").trim();
  return text ? text.split(/\s+/).length : 0;
}

/** Identity of a conflict for dedupe: same canon memory challenged by the same
 *  excerpt is the same conflict, whatever id the detection got. Mock/local
 *  entries (no oldMemoryId) keep id identity. */
// Backend ids are derived from what the conflict IS (chapter + entity +
// attribute + the new statement), so the same conflict re-detected under a
// bumped canon version reproduces the same id. That makes the id the conflict
// key — keying on oldMemoryId used to fork one conflict into two cards whenever
// the challenged memory was version-updated between checks.
function conflictKey(c: Contradiction): string {
  return c.id;
}

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
  // The library lives in Supermemory; empty until the mount effect loads it.
  const [books, setBooks] = useState<Book[]>([]);
  const [activeBookId, setActiveBookId] = useState("");
  const [activeChapterId, setActiveChapterId] = useState("");
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
  // Bumped on every mark click so the panel re-vibrates the card even when the
  // same contradiction is clicked twice.
  const [panelFocusNonce, setPanelFocusNonce] = useState(0);
  // Bumped whenever canon changes (facts stored/updated/forgotten) so the
  // Story Bible re-fetches instead of showing a stale snapshot.
  const [canonNonce, setCanonNonce] = useState(0);
  const bumpCanon = useCallback(() => setCanonNonce((n) => n + 1), []);

  // A mark click hands off to the Continuity panel: open it if closed, then
  // vibrate the matching card.
  const handleMarkClick = useCallback((id: string) => {
    setActiveContradictionId(id);
    setShowPanel(true);
    setPanelFocusNonce((n) => n + 1);
  }, []);

  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chapterSaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bookSaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contradictionsSaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Last-persisted contradictions per book (serialized), to skip redundant saves.
  const savedContradictions = useRef<Record<string, string>>({});

  // Debounced durable autosave of a whole chapter to Supermemory documents.
  const scheduleChapterSave = useCallback(
    (bookId: string, chapter: Chapter) => {
      if (chapterSaveTimeout.current) clearTimeout(chapterSaveTimeout.current);
      chapterSaveTimeout.current = setTimeout(() => {
        saveChapter(bookId, chapter.id, {
          title: chapter.title,
          content: chapter.content,
          index: chapter.index,
        }).catch(() => {
          // Offline / transient — session state still holds the text.
        });
        // 3s: each save re-queues Supermemory document processing, so don't
        // fire one on every brief typing pause.
      }, 3000);
    },
    [],
  );

  const activeBook = useMemo(
    () => books.find((b) => b.id === activeBookId) ?? books[0],
    [books, activeBookId],
  );
  const chapters = useMemo(() => activeBook?.chapters ?? [], [activeBook]);
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
    },
    [activeChapterId, updateActiveBookChapters],
  );

  // Write the manuscript text back into app state so switching chapters keeps it.
  // (Durable autosave to Supermemory documents is layered on top of this.)
  const handleContentChange = useCallback(
    (content: string) => {
      if (!activeChapter) return;
      updateActiveBookChapters((prev) =>
        prev.map((c) =>
          c.id === activeChapterId ? { ...c, content } : c,
        ),
      );
      setSaveState("saving");
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => setSaveState("saved"), 600);
      scheduleChapterSave(activeBookId, { ...activeChapter, content });
    },
    [
      activeChapterId,
      activeBookId,
      activeChapter,
      updateActiveBookChapters,
      scheduleChapterSave,
    ],
  );

  const handleCheckContinuity = useCallback(async () => {
    const bookId = activeBookId;
    if (!bookId || checking) return;
    const book = books.find((b) => b.id === bookId);
    setChecking(true);
    setActiveContradictionId(null);
    setShowPanel(true);
    try {
      // The scan reads stored chapters, so push the current manuscript first —
      // otherwise a book that was only loaded (never edited) has nothing to scan.
      if (book) {
        setCheckPhase("Saving chapters…");
        await Promise.all(
          book.chapters.map((ch) =>
            saveChapter(bookId, ch.id, {
              title: ch.title,
              content: ch.content,
              index: ch.index,
            }),
          ),
        );
      }
      setCheckPhase("Scanning manuscript against canon…");
      // SSE first (real per-chapter progress); plain POST as a fallback.
      const contradictions = await continuityCheckStream(
        bookId,
        setCheckPhase,
      ).catch(async () => (await continuityCheck(bookId)).contradictions);
      const res = { contradictions };
      setChecking(false);
      setCheckPhase(null);
      bumpCanon(); // the scan built/updated canon
      // The scan is the fresh source of open conflicts; prior decisions stand.
      setResultsByBook((prev) => ({
        ...prev,
        [bookId]: (prev[bookId] ?? []).filter((c) => c.status !== "unresolved"),
      }));
      res.contradictions.forEach((c, i) => {
        setTimeout(() => {
          setResultsByBook((prev) => {
            const list = prev[bookId] ?? [];
            // Skip conflicts already decided (or somehow already listed).
            if (list.some((x) => conflictKey(x) === conflictKey(c))) return prev;
            return { ...prev, [bookId]: [...list, c] };
          });
        }, i * RESULT_STAGGER);
      });
    } catch {
      // Backend offline / scan failed — keep whatever results we had.
      setChecking(false);
      setCheckPhase(null);
    }
  }, [activeBookId, checking, books, bumpCanon]);

  const handleJump = useCallback(
    (contradictionId: string, chapterId: string) => {
      setActiveChapterId(chapterId);
      setActiveContradictionId(contradictionId);
    },
    [],
  );

  // Live check results. `scope` makes the result authoritative for one paragraph:
  // whatever that paragraph reported before is dropped and replaced by this run,
  // so editing prose to fix a conflict clears its card instead of stacking a
  // second one. Without a scope (mock data) it degrades to a plain merge.
  const handleContradictionsDetected = useCallback(
    (
      detected: Contradiction[],
      scope?: { chapterId: string; paragraphIndex: number },
    ) => {
      if (detected.length === 0 && !scope) return;
      const bookId = activeBookId;
      if (detected.length > 0) setShowPanel(true);
      setResultsByBook((prev) => {
        const list = prev[bookId] ?? [];
        const survivors = scope
          ? list.filter(
              (c) =>
                // Resolved cards are the author's decision, not a detection —
                // a re-check must not silently undo them.
                c.status !== "unresolved" ||
                c.newFact.chapterId !== scope.chapterId ||
                c.paragraphIndex !== scope.paragraphIndex,
            )
          : list;
        const byKey = new Map(survivors.map((c) => [conflictKey(c), c]));
        for (const c of detected) {
          const prior = byKey.get(conflictKey(c));
          // A decided conflict stays decided; an open one is refreshed.
          if (prior && prior.status !== "unresolved") continue;
          byKey.set(conflictKey(c), c);
        }
        const next = Array.from(byKey.values());
        // Same contents in the same order → keep the old array so the effects
        // keyed on `contradictions` don't re-run on every clean re-check.
        if (
          next.length === list.length &&
          next.every((c, i) => c === list[i])
        )
          return prev;
        return { ...prev, [bookId]: next };
      });
    },
    [activeBookId],
  );

  const handleResolve = useCallback(
    (contradictionId: string, status: ContradictionStatus) => {
      const bookId = activeBookId;
      const target = (resultsByBook[bookId] ?? []).find(
        (c) => c.id === contradictionId,
      );
      // Optimistic local update (mock + live both).
      setResultsByBook((prev) => ({
        ...prev,
        [bookId]: (prev[bookId] ?? []).map((c) =>
          c.id === contradictionId ? { ...c, status } : c,
        ),
      }));
      // Persist to Supermemory only for backend-sourced contradictions.
      if (
        target?.oldMemoryId &&
        (status === "kept-new" || status === "kept-old")
      ) {
        resolveContradiction(bookId, {
          oldMemoryId: target.oldMemoryId,
          pendingId: target.pendingId,
          choice: status,
          newFactContent: target.newFactContent,
          entity: target.entity,
          attribute: target.attribute,
          chapterId: target.newFact.chapterId,
          chapterIndex: target.chapterIndex,
          chapterTitle: target.newFact.chapterTitle,
        })
          .then(() => bumpCanon()) // version-bump changed canon
          .catch(() => {
            // Leave the optimistic UI state; a retry path is a later concern.
          });
      }
    },
    [activeBookId, resultsByBook, bumpCanon],
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
    // Persist immediately so an untouched new chapter survives a refresh.
    saveChapter(activeBookId, chapter.id, {
      title: chapter.title,
      content: chapter.content,
      index: chapter.index,
    }).catch(() => {});
  }, [chapters.length, updateActiveBookChapters, activeBookId]);

  const handleRenameChapter = useCallback(
    (id: string, title: string) => {
      updateActiveBookChapters((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title } : c)),
      );
      const chapter = chapters.find((c) => c.id === id);
      if (chapter) scheduleChapterSave(activeBookId, { ...chapter, title });
    },
    [updateActiveBookChapters, chapters, activeBookId, scheduleChapterSave],
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
    saveBook(book.id, book.title).catch(() => {});
    saveChapter(book.id, chapter.id, {
      title: chapter.title,
      content: chapter.content,
      index: chapter.index,
    }).catch(() => {});
  }, [books.length]);

  const handleRenameBook = useCallback(
    (id: string, title: string) => {
      setBooks((prev) =>
        prev.map((b) => (b.id === id ? { ...b, title } : b)),
      );
      // Debounced: rename fires per keystroke.
      if (bookSaveTimeout.current) clearTimeout(bookSaveTimeout.current);
      bookSaveTimeout.current = setTimeout(() => {
        saveBook(id, title).catch(() => {});
      }, 1000);
    },
    [],
  );

  const handleDeleteChapter = useCallback(
    (id: string) => {
      const bookId = activeBookId;
      if (chapters.length <= 1) return; // keep at least one chapter
      const remaining = chapters.filter((c) => c.id !== id);
      updateActiveBookChapters((prev) => prev.filter((c) => c.id !== id));
      if (activeChapterId === id) {
        setActiveChapterId(remaining[0].id);
        setActiveContradictionId(null);
      }
      // Drop any contradictions that referenced the deleted chapter.
      setResultsByBook((prev) => ({
        ...prev,
        [bookId]: (prev[bookId] ?? []).filter(
          (c) => c.newFact.chapterId !== id && c.oldFact.chapterId !== id,
        ),
      }));
      deleteChapter(bookId, id).catch(() => {});
    },
    [activeBookId, activeChapterId, chapters, updateActiveBookChapters],
  );

  const handleDeleteBook = useCallback(
    (id: string) => {
      if (books.length <= 1) return; // keep at least one book
      const remaining = books.filter((b) => b.id !== id);
      setBooks(remaining);
      setResultsByBook((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (activeBookId === id) {
        const next = remaining[0];
        setActiveBookId(next.id);
        setActiveChapterId(next.chapters[0]?.id ?? "");
        setActiveContradictionId(null);
      }
      deleteBook(id).catch(() => {});
    },
    [books, activeBookId],
  );

  // Load the whole library from Supermemory on mount. An empty registry (or an
  // unreachable backend) starts a fresh book — persisted when the backend is up.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getBooks();
        if (cancelled) return;
        if (res.books.length > 0) {
          const loaded: Book[] = res.books.map((b) => ({
            id: b.id,
            title: b.title,
            chapters: b.chapters.length
              ? b.chapters.map((c) => ({
                  ...c,
                  wordCount: countWords(c.content),
                }))
              : [newChapter(1)],
          }));
          setBooks(loaded);
          setActiveBookId(loaded[0].id);
          setActiveChapterId(loaded[0].chapters[0].id);
          return;
        }
      } catch {
        // Backend offline — fall through to a local book; saves below no-op.
      }
      if (cancelled) return;
      const chapter = newChapter(1);
      const book: Book = {
        id: `book-${Date.now()}`,
        title: "Untitled Book",
        chapters: [chapter],
      };
      setBooks([book]);
      setActiveBookId(book.id);
      setActiveChapterId(chapter.id);
      saveBook(book.id, book.title).catch(() => {});
      saveChapter(book.id, chapter.id, {
        title: chapter.title,
        content: chapter.content,
        index: chapter.index,
      }).catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Restore a book's saved contradictions when it becomes active, so refreshing
  // keeps the panel + inline highlights without re-running the LLM.
  useEffect(() => {
    if (!activeBookId) return;
    let cancelled = false;
    getContradictions(activeBookId)
      .then((res) => {
        if (cancelled || res.contradictions.length === 0) return;
        savedContradictions.current[activeBookId] = JSON.stringify(
          res.contradictions,
        );
        setResultsByBook((prev) => {
          // Don't clobber live detections already present for this book.
          if ((prev[activeBookId]?.length ?? 0) > 0) return prev;
          return { ...prev, [activeBookId]: res.contradictions };
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeBookId]);

  // Persist contradictions (debounced) whenever they change for the active book.
  useEffect(() => {
    if (!activeBookId) return;
    const list = resultsByBook[activeBookId];
    if (list === undefined) return;
    const serial = JSON.stringify(list);
    if (savedContradictions.current[activeBookId] === serial) return;
    if (contradictionsSaveTimeout.current)
      clearTimeout(contradictionsSaveTimeout.current);
    contradictionsSaveTimeout.current = setTimeout(() => {
      savedContradictions.current[activeBookId] = serial;
      saveContradictions(activeBookId, list).catch(() => {});
    }, 1200);
  }, [resultsByBook, activeBookId]);

  const unresolvedCount = contradictions.filter(
    (c) => c.status === "unresolved",
  ).length;

  if (!activeBook || !activeChapter) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="animate-pulse text-sm text-ink-faint">
          Opening your library…
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        books={books}
        activeBookId={activeBookId}
        onSelectBook={handleSelectBook}
        onAddBook={handleAddBook}
        onRenameBook={handleRenameBook}
        onDeleteBook={handleDeleteBook}
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
            onDeleteChapter={handleDeleteChapter}
            contradictions={contradictions}
          />
        )}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <ManuscriptEditor
            key={`${activeBook.id}:${activeChapter.id}`}
            chapter={activeChapter}
            bookId={activeBook.id}
            chapterIndex={activeChapter.index}
            contradictions={contradictions}
            activeContradictionId={activeContradictionId}
            onMarkClick={handleMarkClick}
            onWordCountChange={handleWordCountChange}
            onContentChange={handleContentChange}
            onContradictionsDetected={handleContradictionsDetected}
            onCanonChanged={bumpCanon}
            onRename={handleRenameChapter}
            prevChapter={prevChapter}
            nextChapter={nextChapter}
            onSelectChapter={handleSelectChapter}
          />
        </main>
        {showPanel && (
          <ContinuityPanel
            bookId={activeBook.id}
            canonRefreshKey={canonNonce}
            contradictions={contradictions}
            activeContradictionId={activeContradictionId}
            focusNonce={panelFocusNonce}
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
