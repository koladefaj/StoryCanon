import Link from "next/link";

const FEATURES = [
  {
    title: "Continuity, checked as you write",
    body: "Every paragraph is distilled into canonical facts. Give a character grey eyes in chapter three when chapter one said green, and the line is flagged before your editor ever sees it.",
  },
  {
    title: "Canon that remembers its past",
    body: "Decisions version your story's memory instead of overwriting it — green eyes is superseded, not erased. The Story Bible keeps every fact, every chapter it came from, and its full history.",
  },
  {
    title: "A map of who's who",
    body: "Marriages, feuds, workplaces, kinships — StoryCanon draws the relationship graph straight from the facts your chapters establish. No tagging, no upkeep.",
  },
];

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between px-6 sm:px-10">
        <span className="text-sm font-semibold tracking-tight text-ink">
          StoryCanon
        </span>
        <Link
          href="/editor"
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
        >
          Open the editor →
        </Link>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-flag">
          Your story&rsquo;s memory
        </p>
        <h1 className="mt-4 max-w-2xl font-serif text-4xl font-semibold leading-tight tracking-tight text-ink sm:text-5xl">
          Write the story.
          <br />
          It remembers the canon.
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink-soft">
          StoryCanon is a manuscript editor with a memory. It learns every fact
          your chapters establish, warns you the moment new prose contradicts
          them, and keeps a living Story Bible — all running locally on
          Supermemory.
        </p>
        <Link
          href="/editor"
          className="mt-8 rounded-xl bg-ink px-6 py-3 text-sm font-medium text-paper shadow-lg shadow-black/10 transition-all hover:bg-ink/85 hover:shadow-xl"
        >
          Start writing
        </Link>
        <p className="mt-3 text-xs text-ink-faint">
          No account. Everything stays on your machine.
        </p>
      </section>

      <section className="border-t border-border-soft px-6 py-16 sm:px-10">
        <div className="mx-auto grid max-w-4xl gap-10 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title}>
              <h2 className="text-sm font-semibold text-ink">{f.title}</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border-soft px-6 py-5 text-center">
        <p className="text-xs text-ink-faint">
          Built on{" "}
          <span className="font-medium text-ink-soft">Supermemory Local</span> —
          embeddings, storage, and search without leaving your laptop.
        </p>
      </footer>
    </main>
  );
}
