export type Book = {
  id: string;
  title: string;
  chapters: Chapter[];
};

export type Chapter = {
  id: string;
  index: number;
  title: string;
  content: string;
  wordCount: number;
};

export type ContradictionStatus = "unresolved" | "kept-new" | "kept-old";

export type FactRef = {
  chapterId: string;
  chapterTitle: string;
  excerpt: string;
};

export type Contradiction = {
  id: string;
  entity: string;
  oldFact: FactRef;
  newFact: FactRef;
  status: ContradictionStatus;
  // Present when the contradiction came from the backend (live check / full scan);
  // absent for purely mock data. Used to drive `resolve`.
  oldMemoryId?: string;
  newFactContent?: string;
  pendingId?: string;
  kind?: "fact" | "claim";
  attribute?: string;
  chapterIndex?: number;
  // The judge's short explanation of the conflict — shown on hover in the editor.
  reason?: string;
  // Which paragraph produced this; a re-check of that paragraph supersedes it.
  paragraphIndex?: number | null;
  // Where the challenged memory came from. "derived" = Supermemory read it out of
  // the prose itself; it's re-derived on every sync and can't be version-bumped,
  // so the author resolves it by fixing the text rather than making it canon.
  oldFactSource?: "curated" | "derived";
};
