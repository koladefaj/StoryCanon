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
};
