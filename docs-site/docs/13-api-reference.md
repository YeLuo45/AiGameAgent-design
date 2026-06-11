# 13 · Open API Reference

Every HTTP endpoint exposed by the Studio server. Routes are matched in declaration order; `/v1/*` is the catch-all OpenAI proxy and must remain last.

> All non-`/v1/*` routes return JSON. `404` is `{ "error": "not_found" }`. `500` is `{ "error": "internal_error", "message": "<details>" }`. CORS headers are set on every response (`access-control-allow-origin: *`).

## Health & profile

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/system/profile` | `{ ok, platform, osName, memGB, cpuModel, gpuName?, vramGB? }` |

## Resources

### Agents

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `GET` | `/api/agents` | — | `{ agents: Array<{id, description?}> }` |

### Projects

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `GET` | `/api/projects` | — | `{ projects: Array<{id,title,createdAt}>, currentProjectId }` |
| `POST` | `/api/projects` | `{ title?: string }` | `{ ok, project, projects, currentProjectId }` |
| `POST` | `/api/projects/select` | `{ projectId: string }` | `{ ok, currentProjectId }` |

### Hire

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `GET` | `/api/hire` | — | `{ hired: string[] }` (sorted) |
| `POST` | `/api/hire` | `{ agentId, hired: boolean }` | `{ hired: string[] }` |
| `POST` | `/api/hire/sync_all` | — | `{ ok, hired: string[] }` |

### Queue

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `GET` | `/api/queue` | — | `{ queue: Job[], running: Job[] }` |
| `POST` | `/api/queue/enqueue` | `{ agentId, task, priority?, autoSplit?, providerId?, projectId?, workgroupId? }` | `{ ok, job, providerReason?, split? }` or `{ ok, jobs, providerReason, split: true }` |

`Job` shape: `{ id, agentId, task, priority, createdAt, providerId, projectId, workgroupId, status, source?, producerChainId? }`

### Department workorder

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/api/dept/workorder/action` | `{ deptId, action: "approve"\|"reject"\|"redo", agentId?, projectId?, workgroupId? }` | `{ ok, job, providerReason, task }` |

## Workflows

### Meeting

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/api/meeting/start` | `{ projectId, topic? }` | `{ ok, projectId }` |
| `POST` | `/api/meeting/llm_ping` | `{}` | `{ ok, providerId, model, baseUrl, latencyMs, snippet? }` or `{ ok: false, error, ... }` |

### Charter

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `GET` | `/api/charter?projectId=X` | — | `{ ok, projectId, draft: { goal, milestones[], nodes[] }, archived: {goal, milestones[], nodes[], version, archivedAt}\|null, history: CharterArchived[] }` |
| `POST` | `/api/charter` | `{ projectId, action: "save_draft"\|"archive", draft?: CharterBody }` | `{ ok, ... }` |
| `GET` | `/api/charter/changes?projectId=X` | — | `{ ok, pending: { kinds: string[], count, updatedAt, lastNotifyTs? }\|null }` |
| `POST` | `/api/charter/changes/clear` | `{ projectId }` | `{ ok }` |

### Preview

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `GET` | `/preview?projectId=X[&v=file.html]` | — | HTML (the preview iframe target) |
| `POST` | `/api/preview/save` | `{ projectId, html }` | `{ ok, projectId, file }` |
| `GET` | `/api/preview/history?projectId=X` | — | `{ ok, files: string[] }` |
| `POST` | `/api/preview/restore` | `{ projectId, file }` | `{ ok, projectId }` |

### Asset pipeline (in-server)

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/api/asset/images` | `{ projectId, prompt, n?, size?, model? }` | `{ ok, runId, files[], relPaths[] }` or `{ ok: false, error, status? }` |
| `POST` | `/api/asset/spritesheet` | `{ projectId, sourceDir, outputName, maxWidth? }` | `{ ok, output, json, frameCount }` |
| `POST` | `/api/asset/video` | `{ projectId, input, output, codec? }` | `{ ok, output }` |

## LLM-facing

| Method | Path | Notes |
|--------|------|-------|
| `GET POST` | `/v1/*` | Transparent OpenAI-compatible proxy → `STUDIO_UPSTREAM_BASE_URL` |
| `POST` | `/api/bench` | One-shot first-chunk latency test |
| `POST` | `/api/bench/sweep` | Concurrency sweep; body: `{ concurrencyLevels: number[] }` |
| `GET` | `/api/advice` | Recommended provider + grade + model list for current host |
| `POST` | `/api/system/route` | `{ agentId, providerId }` — per-agent override |

### Headers honoured by `/v1/*`

- `x-studio-agent: <id>` → emitted as `agent.assign` with that agentId
- `x-studio-task: <task>` → emitted as `agent.assign.payload.task`
- `authorization: Bearer <key>` → forwarded to upstream, **redacted** in debug logs

## Operations

### Policy

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `GET` | `/api/policy` | — | `{ ok, policy: StudioPolicy }` |
| `POST` | `/api/policy` | `{ policy: StudioPolicy }` | `{ ok, policy }` |

### Model routing

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `GET` | `/api/model-routing` | — | `{ ok, modelRouting: { tier, executionProviderId, meetingProviderId } }` |
| `POST` | `/api/model-routing` | `{ tier: "save"\|"balance"\|"quality" }` | `{ ok, modelRouting }` |

### Finance

| Method | Path | Query | Returns |
|--------|------|-------|---------|
| `GET` | `/api/finance/summary` | `range=today` (only range in v1) | `{ range, tokensEstimated, requests, cost, failures, failuresByReason, requestsByProvider }` |
| `POST` | `/api/finance/reset` | — | `{ ok }` |
| `GET` | `/api/studio/failures` | `limit?` (default 25) | `{ ok, failures: Array<{ts, type, correlationId, agentId?, payload}> }` |

### Event emit (UI → server)

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/api/emit` | `{ type, agentId?, payload? }` | `{ ok }` |

Allows the UI to push arbitrary `StudioEvent`s into the bus. Used for "user clicked approve" and similar boss actions.

## StudioEvent WebSocket (`/ws`)

Connect to `ws://127.0.0.1:8787/ws`. The server sends JSON-encoded `StudioEventEnvelope` objects. There is no per-client filtering; every connected client sees every event.

To consume:

```ts
const ws = new WebSocket("ws://127.0.0.1:8787/ws");
ws.onmessage = (e) => {
  const ev = JSON.parse(e.data);
  console.log(ev.type, ev.payload);
};
```

The server sends a `heartbeat` event every ~30s — clients can use it as a "still alive" signal.

## Error codes

| Code | Meaning | Where |
|------|---------|-------|
| `bad_json` | Request body is not valid JSON | `/api/queue/enqueue`, `/api/finance/reset`, etc. |
| `unknown_provider` | `providerId` not in roster | `/api/queue/enqueue`, `/api/system/route` |
| `provider_not_supported_for_text` | Provider capability doesn't include "text" | `/api/queue/enqueue` |
| `missing_agent_or_task` | agentId or task is empty | `/api/queue/enqueue` |
| `agent_not_hired` | agentId not in hire roster | `/api/queue/enqueue` |
| `project_limit_reached` | Active projects ≥ grade limit | `/api/queue/enqueue`, `/api/dept/workorder/action` |
| `gate_no_preview` | Creative Director gate blocks because no preview exists | `/api/dept/workorder/action` |
| `not_found` | No route matched | any |
| `internal_error` | Unhandled exception | any |

## StudioPolicy shape

```ts
type StudioPolicy = {
  v: 1;
  producer: {
    mode: "rules" | "llm";
    autoSplit: boolean;
    autoDispatch: boolean;
    maxSubtasks: number;       // 1-12
  };
  technicalDirector: {
    mode: "rules" | "llm";
    autoOutsource: boolean;
    firstChunkMsThreshold: number;  // ms
    pauseOnErrors: boolean;
  };
  creativeDirector: {
    mode: "rules" | "llm";
    gateOnNoPreview: boolean;
    requireAcceptanceCriteria: boolean;
  };
};
```

## Changelog

| Date | Change |
|------|--------|
| 2026-06 | v1 — initial API surface |
| 2026-06 | Added `/api/system/profile` (Windows GPU detection) |
| 2026-06 | Added `/api/bench/sweep` (concurrency sweep) |

## Next

- [Studio Server](/docs/01-studio-server) — code walkthrough
- [Shared Events Bus](/docs/03-events-bus) — events emitted by these endpoints
- [Deployment](/docs/14-deployment) — running the server in different environments
