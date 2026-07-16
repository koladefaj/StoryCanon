// Tiny fetch client for the Continuity Editor backend (FastAPI).
// Base URL is injected at build/runtime via NEXT_PUBLIC_API_URL.

import type { Contradiction } from "./types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type ExtractedFact = {
  entity: string;
  attribute: string;
  statement: string;
  excerpt: string;
};

// Superset of the frontend Contradiction type — carries the fields `resolve` needs.
export type PendingContradiction = Contradiction & {
  pendingId: string;
  oldMemoryId: string;
  newFactContent: string;
  kind: "fact" | "claim";
  attribute?: string;
  chapterIndex?: number;
};

export type ParagraphCheckResult = {
  facts: ExtractedFact[];
  contradictions: PendingContradiction[];
};

export type ParagraphCheckInput = {
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  paragraphText: string;
  precedingContext?: string;
};

export async function paragraphCheck(
  bookId: string,
  input: ParagraphCheckInput,
): Promise<ParagraphCheckResult> {
  const res = await fetch(
    `${API_BASE}/api/books/${encodeURIComponent(bookId)}/paragraph-check`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) throw new Error(`paragraph-check failed: ${res.status}`);
  return res.json();
}

export type ResolveInput = {
  oldMemoryId?: string;
  pendingId?: string;
  choice: "kept-new" | "kept-old";
  newFactContent?: string;
  entity?: string;
  attribute?: string;
  chapterId?: string;
  chapterIndex?: number;
  chapterTitle?: string;
};

export async function resolveContradiction(
  bookId: string,
  input: ResolveInput,
): Promise<{ ok: boolean; newMemoryId?: string }> {
  const res = await fetch(
    `${API_BASE}/api/books/${encodeURIComponent(bookId)}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) throw new Error(`resolve failed: ${res.status}`);
  return res.json();
}

// --- Books (registry + full-book scan) --------------------------------------

export type SavedBook = {
  id: string;
  title: string;
  chapters: SavedChapter[];
};

export async function getBooks(): Promise<{ books: SavedBook[] }> {
  const res = await fetch(`${API_BASE}/api/books`);
  if (!res.ok) throw new Error(`getBooks failed: ${res.status}`);
  return res.json();
}

export async function saveBook(
  bookId: string,
  title: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/books/${encodeURIComponent(bookId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    },
  );
  if (!res.ok) throw new Error(`saveBook failed: ${res.status}`);
  return res.json();
}

export async function getContradictions(
  bookId: string,
): Promise<{ contradictions: Contradiction[] }> {
  const res = await fetch(
    `${API_BASE}/api/books/${encodeURIComponent(bookId)}/contradictions`,
  );
  if (!res.ok) throw new Error(`getContradictions failed: ${res.status}`);
  return res.json();
}

export async function saveContradictions(
  bookId: string,
  contradictions: Contradiction[],
): Promise<{ ok: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/books/${encodeURIComponent(bookId)}/contradictions`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contradictions }),
    },
  );
  if (!res.ok) throw new Error(`saveContradictions failed: ${res.status}`);
  return res.json();
}

export async function deleteBook(bookId: string): Promise<{ ok: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/books/${encodeURIComponent(bookId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`deleteBook failed: ${res.status}`);
  return res.json();
}

export async function deleteChapter(
  bookId: string,
  chapterId: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`deleteChapter failed: ${res.status}`);
  return res.json();
}

export async function continuityCheck(
  bookId: string,
): Promise<{ contradictions: PendingContradiction[] }> {
  const res = await fetch(
    `${API_BASE}/api/books/${encodeURIComponent(bookId)}/continuity-check`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`continuityCheck failed: ${res.status}`);
  return res.json();
}

/** SSE variant: reports real per-chapter phases, resolves with the result. */
export async function continuityCheckStream(
  bookId: string,
  onPhase: (label: string) => void,
): Promise<PendingContradiction[]> {
  const res = await fetch(
    `${API_BASE}/api/books/${encodeURIComponent(bookId)}/continuity-check/stream`,
    { method: "POST" },
  );
  if (!res.ok || !res.body)
    throw new Error(`continuityCheckStream failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: PendingContradiction[] | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, sep).trim();
      buffer = buffer.slice(sep + 2);
      if (!chunk.startsWith("data: ")) continue;
      const event = JSON.parse(chunk.slice(6));
      if (event.type === "phase") onPhase(event.label);
      else if (event.type === "result") result = event.contradictions;
    }
  }
  if (result === null) throw new Error("stream ended without a result");
  return result;
}

// --- Story Bible + relationship graph ---------------------------------------

export type CanonVersion = {
  content: string;
  version?: number | null;
  updatedAt?: string | null;
};

export type CanonEntry = {
  id: string;
  content: string;
  entity: string;
  attribute: string;
  chapterTitle: string;
  chapterIndex?: number | null;
  updatedAt: string;
  version?: number | null;
  history: CanonVersion[];
};

export async function getCanon(
  bookId: string,
): Promise<{ entries: CanonEntry[] }> {
  const res = await fetch(
    `${API_BASE}/api/books/${encodeURIComponent(bookId)}/canon`,
  );
  if (!res.ok) throw new Error(`getCanon failed: ${res.status}`);
  return res.json();
}

export async function forgetMemory(
  bookId: string,
  memoryId: string,
  reason: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/books/${encodeURIComponent(bookId)}/forget`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memoryId, reason }),
    },
  );
  if (!res.ok) throw new Error(`forgetMemory failed: ${res.status}`);
  return res.json();
}

export type GraphNode = { id: string; label: string };
export type GraphEdge = { source: string; relation: string; target: string };

export async function buildGraph(
  bookId: string,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const res = await fetch(
    `${API_BASE}/api/books/${encodeURIComponent(bookId)}/graph`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`buildGraph failed: ${res.status}`);
  return res.json();
}

// --- Chapter persistence (Supermemory documents) ---------------------------

export type SavedChapter = {
  id: string;
  title: string;
  index: number;
  content: string;
};

export async function saveChapter(
  bookId: string,
  chapterId: string,
  body: { title: string; content: string; index: number },
): Promise<{ ok: boolean; documentId?: string }> {
  const res = await fetch(
    `${API_BASE}/api/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(`saveChapter failed: ${res.status}`);
  return res.json();
}

export async function getChapters(
  bookId: string,
): Promise<{ chapters: SavedChapter[] }> {
  const res = await fetch(
    `${API_BASE}/api/books/${encodeURIComponent(bookId)}/chapters`,
  );
  if (!res.ok) throw new Error(`getChapters failed: ${res.status}`);
  return res.json();
}
