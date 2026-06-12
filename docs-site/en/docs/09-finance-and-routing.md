# 09 · Finance & Model Routing

AiGameAgent is **financially aware**: every token, every request, and every failure is attributed to a provider. The boss can see the cost of a session, the failure rate by reason, and the per-provider request mix. A simple three-tier model routing (save / balance / quality) decides where new requests go.

**Source:** `apps/studio-server/src/index.ts` (finance summary, model routing) + `production/model-routing.json`

## Three tiers

```ts
type ModelRouting = {
  tier: "save" | "balance" | "quality";
  executionProviderId: string;   // for normal agent jobs
  meetingProviderId: string;     // for meeting (leadership) jobs
};
```

| Tier | Execution | Meeting | When to pick |
|------|-----------|---------|--------------|
| `save` | `local` (Ollama) | `local` | "No cloud bill — everything is local" |
| `balance` | `local` (Ollama) | `cloud` | "Default: cheap execution, smart meeting" |
| `quality` | `cloud` | `cloud` | "Money is no object, send everything to the best model" |

The default is `balance`. Switching tier writes to `production/model-routing.json` and emits no event (it's a settings flip, not a state change).

## How a job picks a provider

```ts
function pickQueueProviderId(agentId: string, opts): { providerId: string; providerReason?: string } {
  // 1. Explicit override on the enqueue
  if (opts.providerId) return { providerId: opts.providerId };

  // 2. Per-agent override (set by /api/system/route)
  if (agentProvider.has(agentId)) return { providerId: agentProvider.get(agentId)!, providerReason: "agent_provider_override" };

  // 3. Tier-based routing
  const tier = modelRouting.tier;
  if (opts.usage === "meeting") {
    return { providerId: modelRouting.meetingProviderId, providerReason: `tier_${tier}_meeting` };
  }
  return { providerId: modelRouting.executionProviderId, providerReason: `tier_${tier}_execution` };
}
```

The `providerReason` is emitted as a `policy.decision` event so the boss can audit which path was taken.

## Provider configuration

```ts
type Provider = {
  id: string;
  label: string;
  kind: "local" | "lan" | "cloud";
  baseUrl: string;          // OpenAI-compatible /v1
  model: string;
  capabilities: Array<"text" | "image" | "music">;
  pricing: { inputPer1k: number; outputPer1k: number; currency: string };
};
```

The default providers (hard-coded in `getProviders()`):

| ID | Label | Kind | baseUrl | Pricing |
|----|-------|------|---------|---------|
| `local` | Local (Ollama) | local | `http://127.0.0.1:11434/v1` | `0 / 0` |
| `lan` | LAN (vLLM) | lan | `http://127.0.0.1:8000/v1` | `0 / 0` |
| `cloud` | Cloud (OpenAI) | cloud | `https://api.openai.com/v1` | `0.005 / 0.015` USD |

The `studio-providers.json` (gitignored) overrides the defaults; the boss can add their own (e.g. `deepseek`, `doubao`) without restarting.

## Finance summary endpoint

```http
GET /api/finance/summary?range=today
```

Response:

```json
{
  "range": "today",
  "tokensEstimated": 42310,
  "requests": 47,
  "cost": 0.63,
  "failures": 3,
  "failuresByReason": {
    "upstream_5xx": 2,
    "timeout": 1
  },
  "requestsByProvider": {
    "local": 39,
    "cloud": 8
  }
}
```

### How it's computed

1. Read `studio_events.jsonl`, last 5,000 lines
2. Filter to events with `ts` matching `range` and after the last `finance.reset` of the same range
3. **tokensEstimated** = sum of `llm.chunk.payload.text.length` for events after the last reset, divided by 4 (rough char-to-token ratio)
4. **requests** = count of `job.started`
5. **cost** = `(tokensEstimated / 1000) * cloud.pricing.outputPer1k` (cloud only — local is free)
6. **failures** = count of `job.finished` with `ok === false`
7. **failuresByReason** = group by `payload.failureReason`
8. **requestsByProvider** = group `job.started.payload.providerId`

> The token estimator (chars / 4) is intentionally crude. A future change can swap in a per-model tokenizer.

### Why "last 5,000 lines"?

The events log grows unboundedly. Reading the whole file would eventually be slow; reading only the tail is fast and covers the typical session. The actual budget is 5,000 lines or 24 hours, whichever is shorter.

### Reset semantics

`POST /api/finance/reset` emits a `finance.reset` event into the log; subsequent reads treat events **before** the latest reset as not-counted. The log itself is **not** truncated — the boss can still see the full audit trail in `studio_events.jsonl`.

## Per-failure attribution

Every `job.failed` carries:

```ts
{
  jobId: string;
  stage: string;        // e.g. "upstream", "parse", "policy"
  message: string;
  hint?: string;
  failureReason?: string;  // e.g. "upstream_5xx", "timeout", "cancelled", "policy_block"
  projectId?: string;
  workgroupId?: string;
}
```

Every `job.finished` (success or failure) carries:

```ts
{
  jobId: string;
  ok: boolean;
  failureReason?: string;
  durationMs?: number;
  providerId?: string;
  upstreamStatus?: number;  // HTTP status from upstream
}
```

This is the spec from `studio-finance-telemetry`:

> **Requirement: job.finished MUST carry attributable fields**
> When a task execution fails, the system SHALL include in `job.finished.payload`: `failureReason`, `durationMs`, `providerId`; if the upstream returns an HTTP status code, it MUST include `upstreamStatus`.

## Hardware grade → project limit

The server computes a "grade" for the host (S / A / B / C) and uses it to cap **active parallel projects**:

```ts
const snap = await getAdviceSnapshot();
const projectLimit = snap.grade === "S" ? 3 : snap.grade === "A" ? 2 : 1;
```

The grade is derived from the advice snapshot (memory + GPU + bench latency). A 24GB+ GPU with low first-chunk latency → `S`. A 8GB GPU with ~2s first-chunk → `A`. CPU-only 3B → `B/C`.

If the boss tries to enqueue a job for a new project when `activeProjects.size >= projectLimit`, the request 400s with `error: project_limit_reached`.

## Settings + policy

```ts
const settings = {
  computeSlots: 1,                                  // serial by default
  autoOutsource: true,                              // promote to cloud if first chunk slow
  autoOutsourceFirstChunkMsThreshold: 1800          // 1.8s threshold
};
```

`autoOutsource` reads from the policy at boot:

```ts
settings.autoOutsource = Boolean(policy.technicalDirector?.autoOutsource);
settings.autoOutsourceFirstChunkMsThreshold = Number(
  policy.technicalDirector?.firstChunkMsThreshold ?? settings.autoOutsourceFirstChunkMsThreshold
);
```

The promotion logic is in the `pumpQueue()` worker — if the first chunk doesn't arrive within `autoOutsourceFirstChunkMsThreshold` and a `cloud` provider exists, the worker re-issues the request against `cloud` and emits `policy.decision` with `action: "auto_outsource"`.

## Boss-facing UI: the "Policy" drawer

The "Policy" (策略) drawer exposes:

- Producer mode (rules / llm) + autoSplit + autoDispatch + maxSubtasks
- Technical Director mode + autoOutsource + first-chunk threshold + pause-on-errors
- Creative Director mode + gate-on-no-preview + require-acceptance-criteria
- Model tier radio (save / balance / quality) with a separate save button

Saving the policy writes `production/policy.json`; saving the model tier writes `production/model-routing.json`. Both reload the in-memory state on next request.

## Cost cap (planned, not in v1)

There's a `cost` field in the finance summary but no cap enforcement yet. The expected v2 shape:

```ts
type CostCap = { dailyUSD: number; monthToDateUSD: number; hardBlock: boolean };
```

When set, the server would refuse to enqueue a new `cloud` job if the daily cap is hit. The hook is in place (`pickQueueProviderId` returns a `providerId` — adding a "would this exceed cap?" check is a 5-line patch).

## Next

- [Local LLM Integration](/docs/10-local-llm) — the host-grade detection that drives routing
- [Open API Reference](/docs/13-api-reference) — finance + policy + model-routing endpoints
- [Tech Stack](/tech-stack) — version pins for the libraries involved
