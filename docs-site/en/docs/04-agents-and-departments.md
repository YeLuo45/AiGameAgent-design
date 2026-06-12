# 04 · Agent Roster & Departments

The "studio" in AiGameAgent is staffed by **30 named AI agents**, each declared as a `.claude/agents/<id>.md` manifest. The first time the server boots, all 30 are auto-hired; the boss can toggle them off via the hire roster.

**Source:** `.claude/agents/*.md` (30 files) · parsed at runtime by `listAgents(repoRoot)` in `studio-server/src/index.ts`

## Roster

The current roster (from `production/studio-hired.json` shipped in the repo):

| Agent | Department | What they do |
|-------|-----------|--------------|
| `producer` | leadership | Splits tasks, dispatches to specialists, gates on acceptance |
| `technical-director` | leadership | Routes models, watches first-chunk latency, escalates on stalls |
| `creative-director` | leadership | Gates work on preview, enforces acceptance criteria |
| `game-designer` | design | Core loop, mechanics, win/lose conditions |
| `systems-designer` | design | Economy, progression, formulas |
| `level-designer` | design | Maps, encounters, pacing |
| `economy-designer` | design | Resource curves, sinks/fountains |
| `narrative-director` | narrative | Story arc, characters, branching |
| `writer` | narrative | Dialogue, copy, in-game text |
| `localization-lead` | narrative | Multi-language, glossary |
| `community-manager` | narrative | Player comms, sentiment, FAQ |
| `lead-programmer` | programming | Architecture, code review, decomp risks |
| `gameplay-programmer` | programming | Core gameplay code, input, state |
| `engine-programmer` | programming | Engine internals, custom systems |
| `ai-programmer` | programming | NPC AI, pathfinding, behavior trees |
| `network-programmer` | programming | Multiplayer, netcode, replication |
| `tools-programmer` | programming | Editor tools, pipelines, CLI |
| `ui-programmer` | programming | HUD, menus, in-game UI |
| `art-director` | art_audio | Visual style, art bible |
| `audio-director` | art_audio | Music and SFX direction |
| `sound-designer` | art_audio | Per-event SFX, ambience |
| `technical-artist` | art_audio | Shaders, VFX, asset integration |
| `qa-lead` | qa_release | Test plan, regression scope |
| `qa-tester` | qa_release | Test execution, bug filing |
| `release-manager` | qa_release | Store submission, platform rules |
| `devops-engineer` | qa_release | CI/CD, infra |
| `security-engineer` | qa_release | Threat model, anti-cheat |
| `performance-analyst` | qa_release | Profiling, frame budget |
| `prototyper` | other | Throwaway spikes |
| `accessibility-specialist` | other | Subtitles, color-blind, haptics |
| `analytics-engineer` | other | Telemetry, dashboards |
| `live-ops-designer` | other | Events, retention loops |
| `world-builder` | other | Lore, world bible |
| `ux-designer` | other | UI/UX flows |
| `web-h5-specialist` | platform | Web / H5 delivery |
| `wechat-minigame-specialist` | platform | WeChat mini-game |
| `douyin-minigame-specialist` | platform | Douyin mini-game |

That's **37 entries** in the shipped `studio-hired.json` — some (like `web-h5-specialist`) overlap with the spec list. The runtime `listAgents()` enumerates whatever is on disk, so the source of truth is the `.claude/agents/` directory.

## Agent manifest format

Each agent is a Markdown file with YAML frontmatter:

```markdown
---
name: producer
description: Splits tasks, dispatches to specialists, gates on acceptance
---

# Producer

You are the Producer in the AiGameAgent studio. ...

## When to engage

When the boss archives a charter, you ...

## How you work

1. Read the charter (goal / milestones / nodes)
2. For each milestone, enqueue a task via `POST /api/queue/enqueue`
   with `agentId: <specialist>` and `autoSplit: true`
3. ...

## Outputs

A queue of `job.enqueued` events with `source: "producer_chain"` ...
```

The server parses the frontmatter with `gray-matter` and exposes `id + description` over `/api/agents`.

## Department mapping

`deptOf(agentId)` is a hard-coded lookup in `studio-web/src/main.ts`:

```ts
function deptOf(id: string): Dept {
  if (id === "producer" || id === "technical-director" || id === "creative-director") return "leadership";
  if (["game-designer", "systems-designer", "level-designer", "economy-designer", "narrative-director", "writer", "world-builder", "ux-designer"].includes(id)) return "design";
  if (["lead-programmer", "gameplay-programmer", "engine-programmer", "ai-programmer", "network-programmer", "tools-programmer", "ui-programmer"].includes(id)) return "programming";
  if (["art-director", "audio-director", "sound-designer", "technical-artist"].includes(id)) return "art_audio";
  if (["narrative-director", "writer", "localization-lead", "community-manager"].includes(id)) return "narrative";
  if (["qa-lead", "qa-tester", "release-manager", "devops-engineer", "security-engineer", "performance-analyst"].includes(id)) return "qa_release";
  return "other";
}
```

This drives:

- The Phaser desk layout (which cluster a desk appears in)
- The department drawer (which agents contribute to the per-dept KPIs)
- The workorder actions (`POST /api/dept/workorder/action` accepts `deptId`)

## Leadership meeting subset

The first three agents — `producer`, `technical-director`, `creative-director` — form the "leadership" set. They are the **only** agents invoked by the `meeting.start` flow:

```ts
const LEADERSHIP_MEETING_AGENTS = new Set(["producer", "technical-director", "creative-director"]);
```

In a meeting, the three are prompted in turn and produce a transcript. Their replies are then parsed (JSON or loose `Speaker: text`) and the boss decides what to archive into the charter.

## Hire lifecycle

```
agent.yaml exists
    └─> server boot
         └─> listAgents() reads all *.md
              └─> hired = Set of all
                   └─> production/studio-hired.json written
                        └─> /api/hire returns { hired: [...] }
```

The boss can toggle one off via `POST /api/hire { agentId, hired: false }`. The next enqueue check:

```ts
if (hired.size > 0 && !hired.has(agentId)) {
  json(res, 400, { ok: false, error: "agent_not_hired", agentId });
  return;
}
```

`POST /api/hire/sync_all` resets the roster to "everyone".

## Producer chain (the kickoff choreography)

When a meeting decides a charter, the producer's "chain" kicks off a sequence:

```ts
const steps: Array<{ agentId: string; task: string; priority: number }> = [
  { agentId: "producer", task: "Coordinate the first cut", priority: 1 },
  { agentId: "game-designer", task: "Define the core loop", priority: 1 },
  { agentId: "gameplay-programmer", task: "Implement the first-cut core loop", priority: 1 },
  { agentId: "art-director", task: "Visual style and samples", priority: 1 },
  { agentId: "qa-lead", task: "First-cut testing + regression", priority: 1 }
];

const chainId = newId("chain");
producerChainById.set(chainId, { steps, cursor: 0 });
// First step is enqueued immediately; subsequent steps enqueue when the prior finishes.
```

Each step's `Job` carries `source: "producer_chain"` and `producerChainId`. When a chain job finishes, `maybeAdvanceProducerChain()` checks if the next step is ready and pushes it.

## Provider override per agent

```ts
const agentProvider = new Map<string, string>(); // agentId -> providerId
```

If the boss wants `qa-tester` to always use the `cloud` provider (e.g. for better reasoning), they can `POST /api/system/route { agentId: "qa-tester", providerId: "cloud" }`. The next enqueue for `qa-tester` will skip the routing logic and use `cloud` directly.

## Why 30+ agents and not one "AI"?

The studio is **modelled on a real game studio** because:

1. **Specialisation beats generalisation** for small local models — a 7B that gets "you are the producer" outperforms the same 7B with "you are a general AI assistant"
2. **Output bounds are department-shaped** — the producer's output is a queue of jobs, the artist's output is a sprite, the QA's output is a bug list. Constraining the role constrains the output.
3. **The boss can intervene at the right level** — when the artist is off, the boss goes to the art_audio drawer; they don't have to wade through a single thread.
4. **The visualization earns its keep** — 30 desks in 7 clusters *looks like* a studio; one chat bubble doesn't.

## Adding a new agent

Three steps:

1. Drop `my-new-role.md` into `.claude/agents/` with a `name` + `description` in frontmatter
2. (Optional) extend `deptOf()` in `studio-web/src/main.ts` if the new role is in a new department
3. (Optional) wire it into a chain in the producer's manifest

No server restart is needed if the hire list is reloaded — the next `/api/agents` call picks it up. The list is read on demand; there's no in-memory cache to bust.

## Next

- [OpenSpec Change Control](/docs/05-openspec) — how capabilities like `studio-events-bus` are versioned
- [Meeting Room & Project Charter](/docs/06-meeting-and-charter) — the leadership subset in action
- [Monitor & HTML Preview](/docs/07-monitor-and-preview) — the output of any agent
