# StoryCanon — demo script & manuscript

Everything needed to record the 3-minute video. Paste the chapters, follow the
beats, read the script.

---

## Before you hit record

- [ ] `docker compose up -d` — all three containers healthy
- [ ] `/health` reports `openai/gpt-4o` (not groq)
- [ ] **Close any other tab sitting on the editor.** An open editor fires live
      checks in the background and canon will drift between takes.
- [ ] Start a **fresh book** with no chapters. Canon must be empty or chapter 4
      won't light up.
- [ ] **Dry-run the whole thing once**, then reset and record. You want to know
      what you'll get — extraction varies a little run to run.

**Reset between takes** (keeps `node_modules`/`.venv`, so it's seconds not minutes):

```bash
docker compose down
docker volume rm supermemory-hackaton_supermemory-data
rm backend/data/library.json
docker compose up -d
```

---

## The flow

You're pasting all four chapters live so viewers watch canon build up and then
break. Timing per chapter: ~2s debounce + ~6s of checks ≈ **8 seconds** of
watching after each paste. Talk over it — the script is written to fill exactly
that gap.

1. Chapter 1 → paste → canon fills (no flags — it's just learning)
2. Chapter 2 → paste → promotion lands, **still no flags** (that's the point)
3. Chapter 3 → paste → nothing (say so, briefly)
4. Chapter 4 → paste → **everything lights up**
5. Resolve one → version chain in the Story Bible
6. Cast tab → relationships
7. Check Continuity → Derived tab → Supermemory's own extraction
8. Close

> **If it runs long:** chapters 2 and 3 are the cut. Speed them 2× in the edit
> and keep talking over the top — the audio still lands.

---

## The manuscript

### Chapter 1 — The Return

> Captain Elias Reyes came home to Varek in the grey light of morning, and the whole harbour seemed to hold its breath. The war had taken both his legs at Varek Ridge, and the army had sent him back with a medal, a folded flag, and a wheelchair that caught on every cobblestone. His daughter Mira ran to the gate to meet him — she was seven now, all elbows and questions — and stopped short when she saw the chair.
>
> His younger brother Corvin met them at the door, still in the green coat of a common soldier. Corvin had stayed behind to guard the town while Elias marched east, and the brothers had not spoken in three years. "You look terrible," Corvin said, and Elias laughed for the first time in months. Their mother, Adelia, watched from the window with her grey eyes wet, saying nothing. She was sixty-three that winter, and the cold had begun to find her.

### Chapter 2 — The Workshop

> Reyes worked from the chair at his bench, carving toy boats for Mira to sail in the rain barrel. "You never chase me anymore," she said once, and he only smiled, because a man with no legs cannot chase anyone. He had made his peace with the chair, mostly. It was the stairs he hated.
>
> Word came from the capital that Corvin had been promoted — Lieutenant now, with a blue coat to prove it, set to command the harbour watch. Adelia baked to celebrate, though her hands shook more than they used to. Elias raised a cup to his brother and meant it. Whatever the war had taken from him, it had given Corvin a future, and that was something.

### Chapter 3 — The Letter

> A letter came from the capital, sealed in black wax. Reyes read it twice, wheeled himself to the window, and watched the road for a long time. Mira asked what it said. He told her it was nothing, but his hands were tight on the wheels of the chair, and Adelia knew her son well enough to know when he was lying.
>
> Corvin came by that evening in his blue coat, fresh from drilling the harbour watch. The brothers spoke in low voices by the fire while Mira pretended to sleep. "If it comes to it," Corvin said, "you get her out. Promise me." Elias promised. Outside, the first snow of the year began to fall on Varek.

### Chapter 4 — The Alarm

> When the warning bell began to ring, Reyes sprinted across the courtyard and vaulted the low wall, faster than any of the young soldiers, his boots loud on the frozen stones. He shouted for Lena to stay inside, and his daughter pressed her small face to the glass and watched her father run. Across the yard, his brother Corvin was already mounted, the green coat of a common soldier flapping behind him as he wheeled his horse toward the gate.
>
> There was no time to find their mother. Adelia had gone down to the harbour at first light, the way she always did, her sharp blue eyes scanning the water for the boats. She was forty, and she never could sit still, not with a storm coming.

---

## What each contradiction proves

| Chapter 4 says | Canon says | Why it's hard |
|---|---|---|
| "Reyes **sprinted** … **vaulted** the low wall" | ch1: lost both legs at Varek Ridge | **Entailment.** No canon sentence says "cannot sprint." It reasons from losing his legs to the impossibility. Lead with this. |
| "his brother Corvin, **the green coat of a common soldier**" | ch2: promoted to Lieutenant, blue coat | **Reversion vs. progression.** The promotion itself isn't flagged. Going backwards is. |
| "her **sharp blue** eyes" | ch1: grey eyes | **Immutable attribute.** Never supersedes. |
| "She was **forty**" | ch1: sixty-three | **Monotonic age.** Can rise, never fall. |
Deliberately *not* flagged: "Elias raised a cup to his brother" (ch2) presupposes
arms, not legs. A naive system flags that against "lost both legs." This doesn't.

**Don't promise the Lena rename.** It's in the manuscript, but it does *not* get
caught, and I measured why rather than guessing: retrieval works (the Mira memory
surfaces at 0.711 similarity), but the judge rules "Reyes is the father of Lena"
consistent with "Elias Reyes has a daughter named Mira" — because canon never says
he has *exactly one* daughter, and a man can have two. That's a reasoning gap, not
a retrieval one. Leave Lena in the prose as flavour; don't point at it.

---

## The script

**~3:00. Around 400 words — most of the time is showing, not talking.**
Read it out loud once. If a line feels like writing rather than speaking, cut it.

---

### [0:00 – 0:15] — What it is

> "This is StoryCanon. It's a writing app for novelists, and it runs completely locally powered by Supermemory.
>
> Here's the problem. You're eighty thousand words into a book. Back in chapter
> one you gave your captain a wheelchair. By chapter forty you've forgotten, and
> you write him sprinting across a courtyard. Nobody catches it until your editor
> does, six months later."

---

### [0:15 – 0:40] — Chapter 1: it learns

*Action: paste Chapter 1.*

> "So let me just paste a chapter in and show you.
>
> Watch the panel on the right — that's the Story Bible. Every fact you see
> appearing is going into Supermemory, on my machine. He lost both legs. He's got
> a daughter, Mira, she's seven. His brother Corvin is a common soldier, green
> coat. Their mother Adelia has grey eyes.
>
> Nothing's wrong yet. It's just learning the story."

---

### [0:40 – 1:00] — Chapters 2 and 3: what it *doesn't* do

*Action: paste Chapter 2. Then Chapter 3.*

> "Chapter two. Corvin gets promoted — he's a Lieutenant now, blue coat.
>
> And notice: no red. That's not a mistake, that's a promotion. People get
> promoted. Supermemory keeps the old value underneath the new one, so the story
> can move forward without me losing what came before.
>
> Chapter three, nothing new. Fine."

---

### [1:00 – 1:35] — Chapter 4: it breaks

*Action: paste Chapter 4. Let the flags land.*

> "OK. Chapter four. This is where I've made a mess.
>
> *(flags appear)*
>
> There we go. Look at that.
>
> 'Reyes sprinted across the courtyard.' Nothing anywhere in my story says Reyes
> can't sprint. It says he lost his legs at Varek Ridge, in chapter one. It worked
> out the rest on its own."

*Action: hover the red mark.*

> "And it tells me why — *Reyes lost both legs, making sprinting impossible.*
>
> Corvin's back in a green coat, but he's a Lieutenant now. Adelia's eyes went
> from grey to blue. And she's somehow twenty years younger."

---

### [1:35 – 2:00] — Fix it, and the version chain

*Action: click **Make canon** on one. Open the Story Bible.*

> "If I decide the new version's right, I make it canon — and Supermemory bumps
> the memory to version two. The old value doesn't get deleted, it goes
> underneath, as history."

*Action: toggle **Audit**.*

> "That's Supermemory's actual record. Container tag, version number, and the root
> id — which is a different id, because this is a chain, not just a row that got
> overwritten."

---

### [2:00 – 2:20] — Cast: the relationships

*Action: open the **Cast** tab.*

> "It also works out who everyone is to each other — brothers, mother, daughter —
> from the facts in Supermemory. I never filled in a character sheet. It's all
> from the prose."

---

### [2:20 – 2:45] — Derived: the safety net

*Action: click **Check Continuity**. Wait. Open the Story Bible → **Derived**.*

> "Now here's my favourite bit, and this one isn't me.
>
> I also hand Supermemory the raw chapters and let it read them itself.
>
> My chapter says *'His daughter Mira ran to the gate.'* Supermemory wrote:
> *'Captain Elias Reyes has a daughter named Mira, who is seven years old.'*
> I never told it who 'his' was. It read the chapter and figured it out."

*Action (optional, 3s): flip to **Canon** and point at the entity list.*

> "And that matters, because look at mine — I've got Elias, Elias Reyes, and
> Reyes. Three different people, as far as my extractor's concerned. Supermemory
> read the same prose and got one man.
>
> So it's a safety net. When my own extraction comes up empty on something, the
> checker falls back on Supermemory's reading instead. Two passes over the same
> book — mine gives me the exact words to underline, Supermemory's actually knows
> who everyone is."

---

### [2:45 – 3:00] — Close

> "So, quickly — what's Supermemory doing here. Every book gets its own container,
> so stories don't mix. Facts are tagged with their chapter, and I filter on that
> number when I search — so chapter four only ever gets checked against one, two
> and three. Earlier chapters are canon, and that's the database enforcing it, not
> a prompt hoping. Versions keep the whole history. And it reads the prose itself,
> as a second opinion on my own extraction.
>
> The bit that decides something's actually a contradiction — that part's mine,
> sitting on top. All of it, on my laptop."

---

## For the form: "how it uses Supermemory Local"

> StoryCanon stores a novel's canon in Supermemory Local, one container tag per
> book (`book_{id}`), so manuscripts stay isolated. Every fact carries its chapter
> index as metadata, and retrieval uses a numeric filter (`chapterIndex <`) so a
> paragraph is only ever judged against chapters that precede it — the "earlier
> chapters are canon" rule is enforced by the query rather than a prompt. When the
> author accepts a change, we version-bump the memory via `update_memory`, so
> Supermemory keeps the full superseded history and the Story Bible renders it as
> a version chain (root id, version, `isLatest`). We also hand Supermemory the raw
> chapter prose in a second container (`book_{id}:chapters`) and let its own
> extraction derive memories from it unaided — it resolves references our
> extraction doesn't, turning "His daughter Mira" into "Captain Elias Reyes has a
> daughter named Mira". Facts removed from canon are forgotten with a reason
> rather than deleted.

---

## Don't overclaim

Judges may ask "which component did that?" Answers that survive:

- **Supermemory does:** storage, semantic retrieval, the chapter-index numeric
  filter, version chains + history, container scoping, forget-with-reason, and
  extraction-from-prose (including reference resolution) — which the checker
  falls back on when our own extraction returns nothing.
- **You do:** the contradiction judgment — entailment, supersession vs reversion,
  monotonic age. That's your prompt reasoning over what Supermemory returns.

If asked "so does the derived reading actually do anything, or is it a demo?":
it's a **fallback**. Curated canon is consulted first, because it carries the
verbatim excerpt the highlight anchors to and the entity/attribute needed to
version-bump. When curated comes back empty, the checker searches Supermemory's
reading instead — same chapter filter, same rules. Contradictions raised from it
are advisory (`oldFactSource: "derived"`): they have no excerpt, and the next
prose sync re-derives them, so they can't be version-bumped — the card offers
"Dismiss", and the fix is to edit the chapter.

Do **not** say Supermemory detected the contradiction, or that its *search*
resolves "the captain" to Reyes. Search is vector similarity; the reference
resolution happens when it **extracts from prose**. Both are checkable in about
thirty seconds, and the honest version is already strong.
