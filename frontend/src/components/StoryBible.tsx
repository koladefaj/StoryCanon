"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getCanon,
  getDerived,
  forgetMemory,
  type CanonEntry,
  type DerivedMemory,
  type MemoryMeta,
} from "@/lib/api";

/** Supermemory's own record for one memory — the audit surface. */
function RawRecord({ raw }: { raw: MemoryMeta }) {
  return (
    <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded-md bg-paper-sunken px-2 py-1.5 font-mono text-[10px] leading-relaxed text-ink-faint">
      <dt>memory</dt>
      <dd className="truncate text-ink-soft">{raw.memoryId}</dd>
      <dt>container</dt>
      <dd className="truncate text-ink-soft">{raw.containerTag}</dd>
      <dt>version</dt>
      <dd className="text-ink-soft">
        v{raw.version ?? 1}
        {raw.isLatest ? " · latest" : ""}
      </dd>
      {/* Differs from memoryId once a fact has been superseded — this is the
          link that makes a version chain a chain. */}
      {raw.rootMemoryId && raw.rootMemoryId !== raw.memoryId && (
        <>
          <dt>root</dt>
          <dd className="truncate text-ink-soft">{raw.rootMemoryId}</dd>
        </>
      )}
      <dt>updated</dt>
      <dd className="truncate text-ink-soft">{raw.updatedAt}</dd>
    </dl>
  );
}

/** Canon grouped by entity, with version history and forget-with-reason. */
export function StoryBible({
  bookId,
  refreshKey = 0,
}: {
  bookId: string;
  refreshKey?: number;
}) {
  const [entries, setEntries] = useState<CanonEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // Audit view: Supermemory's own record per memory. The Story Bible is a view
  // of the memory layer — this is the proof.
  const [audit, setAudit] = useState(false);
  // "canon" = facts our extraction curated (entity + attribute + chapter order,
  // what the judge reasons over). "derived" = what Supermemory made of the raw
  // prose on its own. Two different extractions of the same manuscript.
  const [tab, setTab] = useState<"canon" | "derived">("canon");
  const [derived, setDerived] = useState<DerivedMemory[] | null>(null);

  // Bumped to re-fetch (e.g. reconciling after a failed forget).
  const [reloadNonce, setReloadNonce] = useState(0);

  // Parent remounts this component per book via `key`, so `entries === null`
  // is the loading state and no synchronous reset is needed here.
  useEffect(() => {
    let cancelled = false;
    getCanon(bookId)
      .then((res) => {
        if (cancelled) return;
        setEntries(res.entries);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, reloadNonce, refreshKey]);

  // Derived memories arrive whenever Supermemory finishes processing the prose
  // (queued by the full scan), so re-fetch on the same refresh signal as canon.
  useEffect(() => {
    let cancelled = false;
    getDerived(bookId)
      .then((res) => !cancelled && setDerived(res.memories))
      .catch(() => !cancelled && setDerived([]));
    return () => {
      cancelled = true;
    };
  }, [bookId, reloadNonce, refreshKey]);

  const groups = useMemo(() => {
    const byEntity = new Map<string, CanonEntry[]>();
    for (const e of entries ?? []) {
      const list = byEntity.get(e.entity) ?? [];
      list.push(e);
      byEntity.set(e.entity, list);
    }
    return Array.from(byEntity.entries());
  }, [entries]);

  const handleForget = (id: string) => {
    const r = reason.trim() || "Removed from canon by the author";
    setConfirmId(null);
    setReason("");
    // Optimistic removal; reload to reconcile if the call fails. The reason is
    // stored on the memory, but 0.0.5 never returns a forgotten memory from the
    // list endpoint, so there is no tombstone to render here.
    setEntries((prev) => (prev ?? []).filter((e) => e.id !== id));
    forgetMemory(bookId, id, r).catch(() => setReloadNonce((n) => n + 1));
  };

  // Loading only blocks the whole panel before the first canon fetch settles —
  // once it has, an empty canon must still leave the Derived tab reachable.
  if (entries === null) {
    return (
      <p className="mt-16 animate-pulse text-center text-[13px] text-ink-faint">
        Reading the Story Bible…
      </p>
    );
  }

  const header = (
    <div className="border-b border-border-soft px-5 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(["canon", "derived"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              title={
                t === "canon"
                  ? "Facts our extraction curated — what the continuity judge reasons over"
                  : "What Supermemory made of the raw prose, unaided"
              }
              className={`cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                tab === t
                  ? "bg-paper-sunken text-ink"
                  : "text-ink-faint hover:text-ink"
              }`}
            >
              {t === "canon" ? "Canon" : "Derived"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAudit((v) => !v)}
          aria-pressed={audit}
          title="Show Supermemory's raw memory records"
          className={`cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
            audit
              ? "bg-ink text-paper"
              : "text-ink-faint hover:bg-paper-sunken hover:text-ink"
          }`}
        >
          Audit
        </button>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">
        {tab === "canon" ? (
          <>
            {entries.length} curated {entries.length === 1 ? "fact" : "facts"} ·
            container <span className="font-mono">book_{bookId}</span>
          </>
        ) : (
          <>
            {derived?.length ?? 0} derived by Supermemory from the prose itself ·
            container <span className="font-mono">book_{bookId}:chapters</span>
          </>
        )}
      </p>
    </div>
  );

  if (entries.length === 0 && tab === "canon") {
    return (
      <div>
        {header}
        <div className="mt-16 px-6 text-center">
          <p className="text-[13px] font-medium text-ink-soft">
            {failed ? "Couldn’t reach the backend" : "No canon yet"}
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-faint">
            {failed
              ? "The Story Bible loads from Supermemory — check that the backend is running."
              : "Facts are extracted into canon as you write. Start a chapter and they’ll appear here."}
          </p>
        </div>
      </div>
    );
  }

  if (tab === "derived") {
    return (
      <div>
        {header}
        {derived === null ? (
          <p className="mt-10 animate-pulse text-center text-[13px] text-ink-faint">
            Reading…
          </p>
        ) : derived.length === 0 ? (
          <div className="mt-10 px-6 text-center">
            <p className="text-[13px] font-medium text-ink-soft">
              Supermemory hasn’t read the prose yet
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-faint">
              Run a continuity check — the chapters are handed to Supermemory,
              which derives these on its own. Takes a few seconds after the scan.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border-soft">
            {derived.map((m) => (
              <div key={m.id} className="px-5 py-3">
                <p className="font-serif text-[13px] italic leading-snug text-ink-soft">
                  {m.content}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  {m.chapterTitle || "Unknown chapter"}
                </p>
                {audit && m.raw && <RawRecord raw={m.raw} />}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {header}
      <div className="divide-y divide-border-soft">
        {groups.map(([entity, list]) => (
        <div key={entity} className="px-5 py-4">
          <p className="text-[13px] font-medium text-ink">{entity}</p>
          <div className="mt-2 space-y-3">
            {list.map((e) => (
              <div key={e.id} className="group/entry">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-serif text-[13px] italic leading-snug text-ink-soft">
                      {e.content}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-faint">
                      {e.attribute && <span>{e.attribute} · </span>}
                      {e.chapterTitle || "Unknown chapter"}
                      {(e.version ?? 1) > 1 && (
                        <span className="ml-1 rounded bg-kept-soft px-1 font-medium text-kept">
                          v{e.version}
                        </span>
                      )}
                    </p>
                    {e.history.length > 0 && (
                      <div className="mt-1 border-l-2 border-border-soft pl-2">
                        {e.history.map((h, i) => (
                          <p
                            key={i}
                            className="text-[11px] leading-snug text-ink-faint line-through"
                          >
                            {h.content}
                          </p>
                        ))}
                      </div>
                    )}
                    {audit && e.raw && <RawRecord raw={e.raw} />}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setConfirmId(confirmId === e.id ? null : e.id)
                    }
                    aria-label="Remove from canon"
                    title="Remove from canon"
                    className="shrink-0 cursor-pointer rounded p-0.5 text-ink-faint opacity-0 transition-opacity hover:text-flag group-hover/entry:opacity-100"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.25"
                      strokeLinecap="round"
                    >
                      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
                    </svg>
                  </button>
                </div>
                {confirmId === e.id && (
                  <div className="animate-fade-in mt-2 rounded-md bg-paper-sunken p-2">
                    <input
                      value={reason}
                      onChange={(ev) => setReason(ev.target.value)}
                      placeholder="Why is this leaving canon? (optional)"
                      className="w-full rounded bg-paper px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint"
                      autoFocus
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") handleForget(e.id);
                        if (ev.key === "Escape") setConfirmId(null);
                      }}
                    />
                    <div className="mt-1.5 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        className="cursor-pointer text-[11px] text-ink-faint hover:text-ink"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleForget(e.id)}
                        className="cursor-pointer rounded bg-flag px-2 py-0.5 text-[11px] font-medium text-paper hover:opacity-85"
                      >
                        Forget
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        ))}
      </div>
    </div>
  );
}
