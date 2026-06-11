# 01 · Studio Server

The Studio server is a single Node.js process that speaks HTTP + WebSocket on port 8787, hosts the OpenAI-compatible proxy, schedules jobs, tracks finance, persists charter/policy/routing, and broadcasts StudioEvents to every connected UI.

**Source:** `apps/studio-server/src/index.ts` (~3,630 LOC), `src/asset-pipeline.ts` (~280 LOC)

## What it does

| Concern | Where | Why |
|---------|-------|-----|
| HTTP routing | `createServer` + `if (url.pathname === ...)` chain | Hand-rolled; no Express/Fastify — keeps the install footprint tiny |
| OpenAI proxy | `/v1/*` catch-all at the end of the chain | Transparent to any OpenAI-compatible client (Cursor, Cline, Continue, etc.) |
| WebSocket | `ws` 8.x, mounted on `/ws` upgrade | One broadcast → many UIs |
| File watching | `chokidar` on repo root (ignores `node_modules`, `.git`, `dist`, log path) | Produces `fs.change` events for the office |
| Job queue | in-memory `Array<Job>` + `Map<slotId, Job>` for running | Default serial; `ComputeSlots` controls parallelism |
| Hire roster | `Set<agentId>` persisted to `production/studio-hired.json` | Optional gate — only hired agents are enqueued |
| Policy | `production/policy.json` — 3 tiers (producer / TD / CD) | "rules" or "llm" mode per tier |
| Charter | `production/charter/state.json` — per-project draft + archive history | Drift detection on save |
| Model routing | `production/model-routing.json` — `tier: save | balance | quality` | Decides cloud vs local for meeting vs execution |
| Finance | reads `studio_events.jsonl`, rolls up tokens / requests / cost / failures | Per-provider cost attribution |
| Preview storage | `production/preview/<projectId>/index.html` + `history/*.html` | Auto-saved from agent output |
| Asset pipeline | `studioGenerateImages`, `studioPackSpritesheet`, `studioTranscodeVideo` | OpenAI images API + sharp + ffmpeg |

## Boot sequence

```ts
export async function main() {
  const env = getEnv();              // port 8787, host 127.0.0.1, repo root
  // ... open WebSocketServer (noServer: true)
  // ... load policy, model routing, hire roster
  // ... start chokidar watcher
  // ... start HTTP server
  server.listen(env.port, env.host);
  console.log(`[studio-server] listening on http://${env.host}:${env.port}`);
}
```

The function returns the running server; it never exits unless killed.

## HTTP surface (top hits)

> Full reference: [Open API Reference](/docs/13-api-reference). The non-exhaustive highlights:

### Resource endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/agents` | List all agents (parses `.claude/agents/*.md` frontmatter) |
| GET | `/api/projects` | List projects + `currentProjectId` |
| POST | `/api/projects` | Create new project (default title: "默认项目") |
| POST | `/api/projects/select` | Switch current project |
| GET | `/api/hire` | Read hire roster |
| POST | `/api/hire` | Toggle hire for an agent |
| POST | `/api/hire/sync_all` | Restore all agents (reset) |

### Workflow endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/queue/enqueue` | Add a job; `autoSplit: true` → split on newlines |
| GET | `/api/queue` | Read queue + running |
| POST | `/api/dept/workorder/action` | Approve / reject / redo on a department |
| POST | `/api/meeting/start` | Kick off a meeting (producer/TD/CD round) |
| GET | `/api/charter` | Read draft + archived charter for project |
| POST | `/api/charter` | Save draft / archive version |

### LLM-facing endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET POST | `/v1/*` | Transparent proxy to `STUDIO_UPSTREAM_BASE_URL` |
| POST | `/api/bench` | Measure first-chunk latency on upstream |
| POST | `/api/bench/sweep` | Concurrency sweep `[1,2,3]` |
| GET | `/api/advice` | Suggested provider + model tier for current host |
| GET | `/api/system/profile` | Detect host GPU / RAM (Windows uses CIM) |

### Operational endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/policy` POST | Read or write StudioPolicy |
| GET | `/api/model-routing` POST | Read or write tier |
| GET | `/api/finance/summary?range=today` | Token/cost/fail rollup |
| POST | `/api/finance/reset` | Mark a reset (does not truncate log) |
| POST | `/api/emit` | Allow UI to push arbitrary `StudioEvent` (e.g. user actions) |
| GET | `/preview?projectId=X&v=...` | Serve preview HTML (iframe target) |
| GET POST | `/api/preview/save`, `/api/preview/history`, `/api/preview/restore` | Manage preview history |

## The OpenAI proxy (the load-bearing piece)

The `/v1/*` catch-all is what makes AiGameAgent **work with any OpenAI client** — Cursor, Continue, Cline, Aider, even a raw `curl`. The boss can point Cursor at `http://127.0.0.1:8787/v1` and the studio will:

1. Forward the request (minus `Host`, `x-studio-*` headers) to `STUDIO_UPSTREAM_BASE_URL`
2. Stream SSE chunks back, parsing `data:` lines
3. Emit `llm.chunk` events with the text delta
4. Detect `tool_calls` and emit `tool.start` / `tool.end` per tool
5. Emit `llm.message_done` on `[DONE]`
6. Add an `agent.assign` event with the task (from `x-studio-task` header)

Redaction is deliberate — `Authorization` is replaced with `Bearer ***` in any debug log.

## Job scheduler (the queue)

```ts
type Job = {
  id: string;
  agentId: string;
  task: string;
  priority: number;
  createdAt: string;
  providerId: string;
  projectId: string;
  workgroupId: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  source?: string;
  producerChainId?: string;
  producerChainStepIndex?: number;
};
```

**Dispatch rule:** priority desc, FIFO within tier. The scheduler runs `pumpQueue()` after every enqueue.

**Project limit:** graded by host capability (`S` → 3 parallel projects, `A` → 2, `B/C` → 1). Enqueueing a 4th project for an `S`-grade host will respond with `error: project_limit_reached`.

**Auto-outsource:** if `firstChunkMs > 1800` on local and a `cloud` provider is configured, the TD policy can promote the job to cloud.

## Hire roster

```ts
const hired = new Set<string>();            // in-memory
const agentProvider = new Map<string, string>();  // override provider per agent

async function loadHiredInitial() {
  if (existsSync(studioHiredPath)) {
    // load from production/studio-hired.json
  } else {
    // default: hire ALL agents from .claude/agents/
  }
}
```

An enqueue call rejects with `agent_not_hired` if `hired.size > 0` and the agent is not in the roster. (Empty `hired` = no gate.)

## Policy

```ts
type StudioPolicy = {
  v: 1;
  producer: { mode: "rules" | "llm"; autoSplit: boolean; autoDispatch: boolean; maxSubtasks: number };
  technicalDirector: { mode: "rules" | "llm"; autoOutsource: boolean; firstChunkMsThreshold: number; pauseOnErrors: boolean };
  creativeDirector: { mode: "rules" | "llm"; gateOnNoPreview: boolean; requireAcceptanceCriteria: boolean };
};
```

**Default policy** is `rules` mode for all three tiers, `autoSplit: true`, `maxSubtasks: 5`, `gateOnNoPreview: false`, `requireAcceptanceCriteria: true`. LLM mode (e.g. `technicalDirector.mode: "llm"`) is reserved for future LLM-driven decision making.

## Charter & change control

```ts
type CharterBody = { goal: string; milestones: string[]; nodes: string[] };
type CharterArchived = CharterBody & { version: number; archivedAt: string };
type PerProjectCharter = { draft: CharterBody; archived: CharterArchived | null; history: CharterArchived[] };
type PendingChange = { kinds: string[]; count: number; updatedAt: string; lastNotifyTs?: string };
```

When the draft differs from the latest archive, the server computes `driftKinds()` and surfaces them as `change.detected` events. The boss then "clears" pending changes in the meeting room.

## FS watcher

`chokidar` watches the whole repo root, ignoring:

- `**/node_modules/**`
- `**/.git/**`
- `**/dist/**`
- the log path itself
- `**/production/session-logs/**`
- `**/production/session-state/**`

Each event is wrapped in an `fs.change` envelope and broadcast. The office uses this to detect when an agent edits a file (and updates the corresponding agent's "tool" status).

## Asset pipeline (separate file)

`asset-pipeline.ts` exports three async functions:

```ts
studioGenerateImages({ repoRoot, projectId, prompt, n, size, imageBaseUrl, apiKey, model })
  → writes production/preview/<pid>/assets/gen/<runId>/{0..n-1}.png

studioPackSpritesheet({ repoRoot, projectId, sourceDir, outputName, maxWidth })
  → uses sharp to compose, writes <name>.png + <name>.json (frame metadata)

studioTranscodeVideo({ repoRoot, projectId, input, output, codec })
  → spawns ffmpeg (or FFMPEG_PATH), writes result file
```

The image generator hits any OpenAI-compatible `images/generations` endpoint. `n` is clamped 1-10; `size` defaults to `1024x1024`; `model` defaults to `dall-e-2`.

## Security & boundaries

- **Loopback-only by default**: `STUDIO_HOST=127.0.0.1`. LAN exposure requires an explicit env var.
- **Path traversal guard**: all project IDs are sanitised to `[a-zA-Z0-9_-]` before any path join.
- **CORS**: `applyCorsHeaders` allows `*` for origin, but the production deployment is expected to live behind a reverse proxy.
- **Redaction**: `Authorization` headers are replaced with `Bearer ***` in debug output.
- **No eval / dynamic require**: all modules are statically imported; no user input is ever passed to `require()` or `eval()`.

## Failure modes the server handles

| Failure | Behaviour |
|---------|-----------|
| Upstream returns 5xx | `job.finished` with `ok: false`, `failureReason`, `upstreamStatus` |
| SSE parse error | Forward raw chunk anyway; emit a generic chunk event |
| LLM returns non-JSON | Try `parseMeetingTranscriptJson` → fall back to `parseMeetingTranscriptLoose` (regex on `秘书：...`) |
| LLM returns JSON wrapped in ```fences``` | Strip the fences first |
| LLM returns prose with embedded JSON | `sliceOutermostJsonObject` extracts the first `{...}` block |
| Chokidar emits for a deleted file | Still emits `fs.change` with `kind: unlink` — UI ignores |
| Charter state.json corrupt | Caught; in-memory state is used; file is not overwritten until next save |
| Invalid provider in queue request | Reject with `error: unknown_provider` (400) |

## Next

- [Studio Web (Isometric Office)](/docs/02-studio-web) — the front-end that consumes all of this
- [Shared Events Bus](/docs/03-events-bus) — the 25 event types the server emits
- [Open API Reference](/docs/13-api-reference) — full route table
