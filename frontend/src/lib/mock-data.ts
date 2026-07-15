import type { Book, Chapter, Contradiction } from "./types";

const chapters: Chapter[] = [
  {
    id: "ch1",
    index: 1,
    title: "The Salt Road",
    wordCount: 139,
    content: `
      <p>Elara had walked the Salt Road since dawn, and still the walls of Thane refused to grow any nearer. Dust clung to her boots, and her eyes, a startling shade of green, stayed fixed on the horizon where the city's spires cut into the grey.</p>
      <p>Behind her, Sergeant Voss cursed the heat and the flies in equal measure, though never loud enough for the captain to hear. He was young for a sergeant, barely older than Elara herself, but he wore the rank like it had been stitched to his skin.</p>
      <p>"They say the western wall hasn't been breached in three hundred years," Voss said, kicking a stone off the path. "Not since the old kings sealed it with iron and a promise."</p>
      <p>Elara said nothing. She had her own promises to keep, and none of them involved walls.</p>
    `,
  },
  {
    id: "ch2",
    index: 2,
    title: "Thane's Gate",
    wordCount: 101,
    content: `
      <p><mark class="contradiction" data-contradiction-id="c3">The western wall had crumbled a century ago</mark>, leaving a scar of pale stone that the city never bothered to hide. Elara traced its jagged edge with her gaze as the gate guards waved their column through.</p>
      <p>Captain Voss rode ahead of her now, shoulders squared under the weight of a rank he'd only just earned. The promotion had come through three days past, sealed by a courier who hadn't stopped to explain why.</p>
      <p>"Something's wrong with this place," Elara murmured. "It's too quiet for a city that just crowned a new captain of the guard."</p>
      <p>No one answered. The gate swallowed them whole.</p>
    `,
  },
  {
    id: "ch3",
    index: 3,
    title: "The Archive",
    wordCount: 118,
    content: `
      <p>The archive smelled of tallow and old paper, the kind of smell that meant no one had opened a window in a decade. Elara ran her fingers along the spines until she found the ledger she wanted.</p>
      <p>Her <mark class="contradiction" data-contradiction-id="c1">grey eyes narrowed</mark> at the entry — a record of the sealing, dated three centuries back, signed by a king whose name had been scratched out and rewritten twice.</p>
      <p>"You won't find what you're looking for in there," said a voice from the stacks. Voss stepped into the lamplight, no longer dressed as a soldier at all. "That ledger's been rewritten more times than the wall's been rebuilt."</p>
      <p>Elara closed the book slowly. "Then tell me which version is true."</p>
    `,
  },
  {
    id: "ch4",
    index: 4,
    title: "What the Wall Remembers",
    wordCount: 91,
    content: `
      <p>By midnight they stood where the western wall met the old riverbed, and for the first time since the Salt Road, Elara let herself believe they might be close to an answer.</p>
      <p>Guards atop the western wall paced in slow, bored circles, unaware that the stone beneath their boots had a memory of its own.</p>
      <p><mark class="contradiction" data-contradiction-id="c2">Sergeant Voss</mark> — or whatever he was now — pressed his palm flat against the scar in the stone. "It doesn't forget," he said. "It just waits for someone to ask the right question."</p>
      <p>Elara asked it anyway.</p>
    `,
  },
];

const contradictions: Contradiction[] = [
  {
    id: "c1",
    entity: "Elara's eyes",
    oldFact: {
      chapterId: "ch1",
      chapterTitle: "The Salt Road",
      excerpt: "her eyes, a startling shade of green",
    },
    newFact: {
      chapterId: "ch3",
      chapterTitle: "The Archive",
      excerpt: "Her grey eyes narrowed",
    },
    status: "unresolved",
  },
  {
    id: "c2",
    entity: "Voss's rank",
    oldFact: {
      chapterId: "ch2",
      chapterTitle: "Thane's Gate",
      excerpt: "Captain Voss rode ahead of her now",
    },
    newFact: {
      chapterId: "ch4",
      chapterTitle: "What the Wall Remembers",
      excerpt: "Sergeant Voss — or whatever he was now",
    },
    status: "kept-old",
  },
  {
    id: "c3",
    entity: "The western wall's history",
    oldFact: {
      chapterId: "ch1",
      chapterTitle: "The Salt Road",
      excerpt: "hasn't been breached in three hundred years",
    },
    newFact: {
      chapterId: "ch2",
      chapterTitle: "Thane's Gate",
      excerpt: "crumbled a century ago",
    },
    status: "kept-new",
  },
];

export const books: Book[] = [
  {
    id: "hollow-crown",
    title: "The Hollow Crown",
    chapters,
  },
];

/** Mock continuity results, keyed by book id. Books without an entry are clean. */
export const contradictionsByBook: Record<string, Contradiction[]> = {
  "hollow-crown": contradictions,
};
