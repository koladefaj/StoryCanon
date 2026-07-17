"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import type { Book } from "@/lib/types";
import { cn } from "@/lib/utils";

type SaveState = "saved" | "saving";

function IconButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-ink/5 hover:text-ink"
    >
      {children}
    </button>
  );
}

function PanelIcon({ side }: { side: "left" | "right" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
    >
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
      <path d={side === "left" ? "M6 2.75v10.5" : "M10 2.75v10.5"} />
    </svg>
  );
}

function BookSwitcher({
  books,
  activeBookId,
  onSelectBook,
  onAddBook,
  onRenameBook,
  onDeleteBook,
}: {
  books: Book[];
  activeBookId: string;
  onSelectBook: (id: string) => void;
  onAddBook: () => void;
  onRenameBook: (id: string, title: string) => void;
  onDeleteBook: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = books.find((b) => b.id === activeBookId);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[13px] text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="truncate">{active?.title}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-ink-faint"
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div className="animate-fade-in absolute left-0 top-full z-20 mt-1 w-60 rounded-lg border border-border bg-paper-raised p-1 shadow-lg shadow-black/5">
          {active && (
            <>
              <input
                value={active.title}
                onChange={(e) => onRenameBook(active.id, e.target.value)}
                aria-label="Book title"
                className="w-full rounded-md bg-paper-sunken px-2 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint"
                placeholder="Book title"
              />
              <div className="my-1 border-t border-border-soft" />
            </>
          )}
          {books.map((b) => (
            <div
              key={b.id}
              className={cn(
                "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-ink/5",
                b.id === activeBookId ? "font-medium text-ink" : "text-ink-soft",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  onSelectBook(b.id);
                  setOpen(false);
                }}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
              >
                <span className="truncate">{b.title}</span>
                {b.id === activeBookId && (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0"
                  >
                    <path d="M2.5 6.5l2.5 2.5 4.5-5" />
                  </svg>
                )}
              </button>
              {books.length > 1 && (
                <button
                  type="button"
                  onClick={() => onDeleteBook(b.id)}
                  aria-label={`Delete book ${b.title}`}
                  title="Delete book"
                  className="shrink-0 cursor-pointer rounded p-0.5 text-ink-faint opacity-0 transition-opacity hover:text-flag-red focus:opacity-100 group-hover:opacity-100"
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                    <path d="M3 4.5h10M6.5 4.5V3.5a1 1 0 011-1h1a1 1 0 011 1v1M5 4.5l.5 8a1 1 0 001 1h3a1 1 0 001-1l.5-8" />
                  </svg>
                </button>
              )}
            </div>
          ))}
          <div className="my-1 border-t border-border-soft" />
          <button
            type="button"
            onClick={() => {
              onAddBook();
              setOpen(false);
            }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink-faint transition-colors hover:bg-ink/5 hover:text-ink-soft"
          >
            <span className="w-3 text-center">+</span>
            New book
          </button>
        </div>
      )}
    </div>
  );
}

export function TopBar({
  books,
  activeBookId,
  onSelectBook,
  onAddBook,
  onRenameBook,
  onDeleteBook,
  chapterTitle,
  saveState,
  unresolvedCount,
  onCheckContinuity,
  checking,
  onToggleSidebar,
  onTogglePanel,
}: {
  books: Book[];
  activeBookId: string;
  onSelectBook: (id: string) => void;
  onAddBook: () => void;
  onRenameBook: (id: string, title: string) => void;
  onDeleteBook: (id: string) => void;
  chapterTitle: string;
  saveState: SaveState;
  unresolvedCount: number;
  onCheckContinuity: () => void;
  checking: boolean;
  onToggleSidebar: () => void;
  onTogglePanel: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
      <div className="flex min-w-0 items-center gap-1">
        <IconButton onClick={onToggleSidebar} label="Toggle chapter list">
          <PanelIcon side="left" />
        </IconButton>
        <div className="flex min-w-0 items-center gap-1 pl-1.5">
          <Link
            href="/"
            title="Back to landing page"
            className="rounded-md text-sm font-semibold tracking-tight text-ink transition-colors hover:text-ink-soft"
          >
            StoryCanon
          </Link>
          <span className="px-0.5 text-ink-faint">/</span>
          <BookSwitcher
            books={books}
            activeBookId={activeBookId}
            onSelectBook={onSelectBook}
            onAddBook={onAddBook}
            onRenameBook={onRenameBook}
            onDeleteBook={onDeleteBook}
          />
          <span className="px-0.5 text-ink-faint">/</span>
          <span className="min-w-0 truncate text-[13px] text-ink-soft">
            {chapterTitle}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-ink-faint">
          {saveState === "saving" ? "Saving…" : "Saved"}
        </span>

        {unresolvedCount > 0 && !checking && (
          <span className="text-xs font-medium text-flag">
            {unresolvedCount} unresolved
          </span>
        )}

        <button
          type="button"
          onClick={onCheckContinuity}
          disabled={checking}
          className="cursor-pointer rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper transition-colors hover:bg-ink/85 disabled:cursor-wait disabled:opacity-60"
        >
          {checking ? "Checking…" : "Check continuity"}
        </button>

        <div className="flex items-center gap-0.5">
          <IconButton onClick={onTogglePanel} label="Toggle continuity panel">
            <PanelIcon side="right" />
          </IconButton>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
