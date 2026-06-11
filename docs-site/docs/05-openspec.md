# 05 · OpenSpec Change Control

AiGameAgent follows the **OpenSpec** workflow: every meaningful change ships as a versioned `change/` directory with a proposal, design, tasks, and a delta spec. Once archived, the change's deltas fold into a `specs/<capability>/spec.md` document.

**Source:** `openspec/` (1 archived change, 9 capability specs)

## Why OpenSpec?

The project is meant to be read by **both humans and AI agents**. OpenSpec gives both a stable answer to "what does the system do?" by:

1. **Capabilities** (`specs/<capability>/spec.md`) are the canonical "what" — written in `### Requirement` / `#### Scenario` form
2. **Changes** (`changes/<id>/`) describe "what's changing" — `proposal.md` (why), `design.md` (how), `tasks.md` (work), and a `delta spec` patch
3. The `.openspec.yaml` per change links to the affected capabilities

A new contributor (or AI) can read one spec and know exactly what the system does, then read a change to know what just shifted.

## The 9 current capabilities

| Capability | Path | Purpose |
|-----------|------|---------|
| `studio-events-bus` | `specs/studio-events-bus/spec.md` | Unified event envelope, JSONL + WebSocket fan-out |
| `openai-compat-proxy-logging` | `specs/openai-compat-proxy-logging/spec.md` | The `/v1/*` proxy + SSE chunk parsing |
| `local-llm-integration` | `specs/local-llm-integration/spec.md` | The Cursor-via-proxy + compute slot story |
| `studio-hiring-queue` | `specs/studio-hiring-queue/spec.md` | ComputeSlots, priority queue, hire roster |
| `studio-model-routing` | `specs/studio-model-routing/spec.md` | Three-tier (save/balance/quality) routing |
| `studio-meeting-room` | `specs/studio-meeting-room/spec.md` | The meeting drawer + leadership round |
| `studio-project-charter` | `specs/studio-project-charter/spec.md` | Per-project charter (goal / milestones / nodes) |
| `studio-change-control` | `specs/studio-change-control/spec.md` | Archive + drift detection |
| `studio-finance-telemetry` | `specs/studio-finance-telemetry/spec.md` | Tokens / cost / failures rollup |
| `studio-web-ui` | `specs/studio-web-ui/spec.md` | Isometric office + DOM HUD + interactions |

(That's 10, not 9 — the "9" estimate missed `studio-web-ui`. The point is: the spec set is the truth of the system.)

## Capability spec anatomy

A capability spec is a `spec.md` with this structure:

```markdown
# <capability-id> Specification

## Purpose
One sentence on why this capability exists.

## Requirements

### Requirement: <short, declarative, present-tense>
The system SHALL <do this thing>.

#### Scenario: <observable condition>
- **WHEN** <precondition>
- **THEN** <observable outcome>
- **AND THEN** <additional outcome>
```

Example (from `studio-events-bus`):

```markdown
### Requirement: 统一事件 envelope
系统 SHALL 使用统一的事件 envelope 表达所有 Studio 事件（LLM/工具/文件变更/房间/队列/招聘等）...

#### Scenario: 事件被记录并可分发
- **WHEN** 系统产生任意一条 Studio 事件
- **THEN** 事件 SHALL 以单行 JSON 追加写入事件日志（JSONL）
- **AND THEN** 事件 SHALL 被实时分发给所有 WebSocket 订阅者
```

The `SHALL` keyword is deliberate — it marks the requirement as testable.

## Change directory anatomy

```
openspec/changes/
└── <change-id>/
    ├── .openspec.yaml    # machine-readable links to capabilities
    ├── proposal.md       # "Why" + "What Changes" + "Impact"
    ├── design.md         # "How" — technical design notes
    ├── tasks.md          # Ordered checklist (1. 2. 3. ...)
    └── specs/<cap>/spec.md  # delta: ADDED/MODIFIED/REMOVED Requirements
```

The shipped example: `studio-web-ui-click-through-fix/` (already archived).

### `proposal.md` (excerpt)

```markdown
## Why

左侧 HUD 与抽屉叠在 Phaser 画布之上时，部分区域因 `pointer-events` 未正确命中，
导致点击「穿透」到下层画布，触发拖拽/缩放而非预期 UI 操作。

## What Changes

- 为 `#hud` 顶栏 `.row` 显式开启 `pointer-events: auto`，...
- 为抽屉遮罩与抽屉容器显式声明 `pointer-events: auto`，...

## Capabilities

### New Capabilities
（无独立新 capability；行为收敛在 `studio-web-ui`。）

### Modified Capabilities
- `studio-web-ui`：补充交互命中与层叠相关需求（见 delta spec）。

## Impact

- **代码**：`apps/studio-web/src/style.css` 仅样式调整。
- **行为**：顶栏与抽屉区域点击更稳定。
```

### `tasks.md` (excerpt — 1-line checklist style)

```markdown
## 1. 样式补齐

- [ ] 显式开启 `.hud .row` 的 `pointer-events: auto`
- [ ] 抽屉遮罩与容器显式 `pointer-events: auto`

## 2. 验证

- [ ] 拖拽 / 缩放 / 点击 HUD 不再被画布误吞
```

### `design.md` (free-form — design rationale)

A short narrative explaining the trade-offs and the chosen approach. Not enforced by the schema; here for human readers.

## How a change becomes a spec

```
1. Author opens openspec/changes/<id>/ with proposal/design/tasks + delta specs
2. .openspec.yaml declares which capabilities are touched
3. Implementation proceeds
4. The change is archived: openspec/changes/<id>/ is removed
5. The delta spec patches fold into openspec/specs/<cap>/spec.md
6. tasks.md items get checked off (or rolled into a new change)
```

The archive is the **commit moment** — once archived, the spec is the truth, and the change is gone from the change set.

## Drift detection (the "did the charter change?" loop)

`studio-change-control` codifies the rule:

> The system SHALL in the presence of a "latest archived charter" perform drift detection: if `goal`, `milestones`, or `nodes` change, declare drift.

Server-side, the rule is implemented in `driftKinds(draft, archived)`:

```ts
function driftKinds(draft: CharterBody, archived: CharterArchived | null): string[] {
  if (!archived) return draft.goal || draft.milestones.length || draft.nodes.length ? ["first_archive"] : [];
  const out: string[] = [];
  if (normArr(draft.milestones) !== normArr(archived.milestones)) out.push("milestones_changed");
  if (normArr(draft.nodes) !== normArr(archived.nodes)) out.push("nodes_changed");
  if (draft.goal.trim() !== archived.goal.trim()) out.push("goal_changed");
  return out;
}
```

Each non-empty drift kind creates a `change.detected` event with `kinds: [...]`. The meeting room surfaces them as `待确认偏离: ...` and offers a one-click clear.

## OpenSpec config (`openspec/config.yaml`)

```yaml
schema: spec-driven
```

The `context` and per-artifact `rules` fields are commented out — they're placeholders for projects that want to inject project-wide AI context (e.g. "tech stack: TypeScript, Node.js"). AiGameAgent intentionally leaves this blank so the project-wide context lives in `.claude/docs/` instead.

## The full flow in one diagram

```mermaid
flowchart LR
  Boss[👤 Boss in meeting room] -->|edit charter| Draft
  Draft[Charter Draft] -->|save| StateJson[(state.json)]
  Draft -->|archive| Archive[Latest Archive vN]
  Draft -.drift.->|compute| DriftKinds
  DriftKinds -->|non-empty| ChangeDetected[change.detected event]
  ChangeDetected -->|UI shows| Pending[待确认偏离]
  Pending -->|click clear| ChangeCleared[change.cleared event]
  Archive -.normArr compare.-> DriftKinds
```

## OpenSpec tooling

The project doesn't ship a custom CLI — the `.cursor/commands/opsx-*.md` commands are **Cursor slash command** bindings that map to OpenSpec's CLI (`opsx`). To use them:

1. Have OpenSpec CLI installed (`@open-spec/cli` or similar)
2. In Cursor, type `/opsx-propose` to scaffold a new change
3. The slash command will create `openspec/changes/<id>/` with the right files

The team's working rule is: **propose → review → design → tasks → code → archive**. Skipping a step is allowed for hotfixes (one-line changes) but discouraged.

## Next

- [Meeting Room & Project Charter](/docs/06-meeting-and-charter) — the meeting flow that the spec describes
- [Agent Roster & Departments](/docs/04-agents-and-departments) — the agents mentioned in leadership meeting
- [Local LLM Integration](/docs/10-local-llm) — the spec that codifies the Cursor-via-proxy story
