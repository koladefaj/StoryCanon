# Upstream issues — Supermemory Local

Bugs found in **Supermemory Local (self-hosted)** while building StoryCanon on it
during the hackathon. These are in the prebuilt server binary, not in our code —
filed here so they can be reported upstream. Each follows a standard report
template (summary → environment → repro → evidence → impact → workaround).

**Environment (shared by all issues)**

| | |
|---|---|
| Supermemory Server | `0.0.5` (self-hosted, official installer) |
| Runtime | Bun `v1.3.4` (5eb2145b), Linux x64 |
| Deployment | Docker (`debian:bookworm-slim`), single container, `docker compose` |
| Host | Windows 11 + Docker Desktop, 8 GB RAM available to the engine |
| Embeddings | local, `Xenova/bge-base-en-v1.5`, 768d, native backend |
| Endpoints used | `/v3/documents`, `/v4/memories`, `/v4/memories/list`, `/v4/search` |

---

## Issue 1 — Server segfaults under concurrent local-embedding load

**Severity:** high (takes down the whole memory server; data survives on disk)

### Summary
The server process crashes with a native segmentation fault (a Bun panic) when
several embedding operations run concurrently against the local embedding engine
— e.g. ingesting multiple documents while also issuing search queries. The crash
is in native code, not recoverable in-process, and `restart: unless-stopped`
does not revive it because the panicked process does not exit cleanly.

### Environment
As above. Local embeddings via `Xenova/bge-base-en-v1.5`. The server logs its own
ingest limit as **"2 concurrent"**; the crash occurs when that is exceeded.

### Steps to reproduce
1. Self-host Supermemory `0.0.5` with local embeddings (no cloud embedding key).
2. In a short window, drive concurrent embedding work against one container:
   - `POST /v3/documents` for several documents at once (each triggers ingest +
     embedding), **and**
   - a burst of `POST /v4/search` (`searchMode: "memories"`) queries.
   In our case: syncing 4 chapter documents in parallel, immediately followed by
   ~8 paragraph checks each issuing 1–2 similarity searches.
3. Observe the server process panic and stop responding (`connection refused` on
   `:6767`).

### Expected
The engine bounds or queues embedding work to its stated concurrency limit and
stays up; excess load waits rather than crashing the process.

### Actual
Native segfault on the main thread; server dies.

```
[ingest] memory limit 1.0 GB above baseline (1.8 GB) · 2 concurrent
panic(main thread): Segmentation fault at address 0x755A46505845
oh no: Bun has crashed. This indicates a bug in Bun, not your code.
https://bun.report/1.3.4/l_15eb2145kwGuhooCkyo8vE+kgP__________________A2016BqkshqmC
```

Peak memory at crash was ~1.9 GB of 8 GB available, so this is **not** an OOM —
it is a memory-safety fault in the native embedding path under concurrency.

### Impact
Any client that parallelises ingestion + search (a reasonable pattern) can crash
the server. For us it interrupted work twice, including near a demo recording.

### Workaround
Client-side, cap concurrent embedding-touching requests at the engine's limit
(2). We added semaphores around both document sync and search-heavy work. This
stops *provoking* the bug but does not fix it. `docker compose restart
supermemory` recovers in ~5s with data intact (the on-disk volume is not
corrupted by the crash).

### Suggested fix
Bound/queue embedding jobs to the configured concurrency inside the engine so
overload backpressures instead of segfaulting; surface a Bun crash report to the
Bun team via the emitted `bun.report` URL if the fault is in the runtime itself.

---

## Issue 2 — Reranker crashes on self-hosted: `undefined is not an object (evaluating 'b.AI.run')`

**Severity:** medium (feature unusable self-hosted; falls back silently)

### Summary
Passing `rerank: true` to `/v4/search` throws on the self-hosted server because
the reranker calls a Cloudflare Workers AI binding (`env.AI.run`) that only
exists in the Workers runtime. Outside Workers the binding is `undefined`, so
every rerank attempt throws and the search silently returns unranked results.

### Steps to reproduce
1. Self-host `0.0.5`.
2. `POST /v4/search` with `{ "q": "...", "searchMode": "memories", "rerank": true }`.
3. Observe the error in the server log on every call.

### Expected
Either rerank works self-hosted, or the server no-ops it with a clear signal
(the binary already contains a sibling code path that checks the binding and
returns `skipped: "missing_ai_binding"` — the reranker path lacks that guard).

### Actual
```
Reranking failed: TypeError: undefined is not an object (evaluating 'b.AI.run')
```
The hardcoded model is `@cf/baai/bge-reranker-base`, a Workers-AI-only model.

### Impact
Rerank is entirely unavailable self-hosted, and the failure is only visible in
logs — callers think they got reranked results. Noisy logs, silent quality loss.

### Workaround
Do not pass `rerank: true` when self-hosted.

### Suggested fix
Guard the reranker path with the same `missing_ai_binding` check the sibling path
already uses, or provide a local reranker for self-hosted deployments.

---

## Issue 3 — `/v4/memories/list` silently truncates: default `limit` 10, no total surfaced to naive callers

**Severity:** medium (silent data loss for consumers that don't paginate)

### Summary
`POST /v4/memories/list` defaults to `limit: 10` per page. A caller that omits
`limit`/`page` receives only the first 10 memories with no obvious indication
that more exist unless it inspects the `pagination` object. This silently
truncated our canon (we saw 10 of 23) and corrupted anything built from "all"
memories — a relationship graph built from a slice, and deletes that only
forgot the first page.

### Steps to reproduce
1. Store >10 memories under one container tag.
2. `POST /v4/memories/list` with `{ "containerTags": ["..."] }` and no `limit`.
3. Receive exactly 10 `memoryEntries`; `pagination.totalItems` reveals the rest.

### Expected
A safer default (e.g. a large default limit), or at minimum prominent
documentation that "list" is paginated and defaults to 10 — the endpoint name
reads as "give me the memories," not "give me a page."

### Actual
```json
{ "memoryEntries": [ /* 10 */ ],
  "pagination": { "currentPage": 1, "limit": 10, "totalItems": 23, "totalPages": 3 } }
```

### Impact
Any "load all memories" flow that trusts one response is silently wrong past the
10th memory. Easy to miss because small test datasets fit in one page.

### Workaround
Always pass an explicit `limit` and page through `pagination.totalPages` to
exhaustion.

---

## Issue 4 — Forgotten memories are unretrievable, even with `include.forgottenMemories`

**Severity:** low (feature gap; blocks building an audit/tombstone view)

### Summary
After `memories.forget(id, reason)`, the memory disappears from `/v4/memories/list`
entirely and cannot be retrieved — not via list, and not via `/v4/search` with
`include: { forgottenMemories: true }`. The `forgetReason` is accepted on write
but there is no read path that returns it, so a "why was this forgotten?" audit
view can't be built.

### Steps to reproduce
1. Create a memory, then `forget` it with a reason.
2. `POST /v4/memories/list` (and `/v4/search` with `include.forgottenMemories:
   true`) for its container.
3. The forgotten memory is absent from both; `forgetReason` is never returned.

### Expected
`include.forgottenMemories: true` returns forgotten entries with `isForgotten:
true` and `forgetReason` populated, so clients can display a soft-delete history.

### Actual
Forgotten entries are omitted from every read path tested; `forgetReason` is
write-only in practice.

### Impact
Forget-with-reason can be written but never shown. Blocks audit/tombstone UIs.

### Workaround
None found. We removed our tombstone UI and treat forget as a hard removal from
the user's perspective.

---

*Filed from the StoryCanon hackathon build. Happy to provide the full crash log,
container config, or a minimal repro on request.*
