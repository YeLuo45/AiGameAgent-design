# 05 · OpenSpec 变更控制

AiGameAgent 遵循 **OpenSpec** 工作流：每一项有意义的变更都以一个版本化的 `change/` 目录形式交付，内含 proposal、design、tasks 与一份 delta 规范。归档之后，变更的 delta 会并入 `specs/<capability>/spec.md` 文档。

**Source:** `openspec/`（1 份已归档变更、9 份能力规范）

## 为什么要用 OpenSpec？

项目希望**同时被人类与 AI Agent 阅读**。OpenSpec 通过以下方式，为两者提供了对「系统到底做什么」的稳定答案：

1. **能力**（`specs/<capability>/spec.md`）是规范的「是什么」——以 `### Requirement` / `#### Scenario` 形式撰写
2. **变更**（`changes/<id>/`）描述「改了什么」——`proposal.md`（为什么）、`design.md`（怎么做）、`tasks.md`（工作清单），以及一份 `delta spec` 补丁
3. 每个变更下的 `.openspec.yaml` 链接到受影响的能力

一个新贡献者（或 AI）读一份规范就能准确知道系统在做什么，再读一份变更就能知道刚刚发生了什么调整。

## 当前的 9 项能力

| 能力 | 路径 | 用途 |
|-----------|------|---------|
| `studio-events-bus` | `specs/studio-events-bus/spec.md` | 统一的事件信封，JSONL + WebSocket 广播 |
| `openai-compat-proxy-logging` | `specs/openai-compat-proxy-logging/spec.md` | `/v1/*` 代理 + SSE 分块解析 |
| `local-llm-integration` | `specs/local-llm-integration/spec.md` | Cursor-经代理 + 计算槽的故事 |
| `studio-hiring-queue` | `specs/studio-hiring-queue/spec.md` | ComputeSlots、优先级队列、雇佣花名册 |
| `studio-model-routing` | `specs/studio-model-routing/spec.md` | 三档（省 / 平衡 / 质量）路由 |
| `studio-meeting-room` | `specs/studio-meeting-room/spec.md` | 会议室抽屉 + 领导层轮询 |
| `studio-project-charter` | `specs/studio-project-charter/spec.md` | 每个项目的章程（目标 / 里程碑 / 节点） |
| `studio-change-control` | `specs/studio-change-control/spec.md` | 归档 + 漂移检测 |
| `studio-finance-telemetry` | `specs/studio-finance-telemetry/spec.md` | Token / 成本 / 失败聚合 |
| `studio-web-ui` | `specs/studio-web-ui/spec.md` | 等距办公室 + DOM HUD + 交互 |

（实际上是 10 项，不是 9 ——「9」这个估算漏掉了 `studio-web-ui`。重点是：这套规范才是系统的真相。）

## 能力规范的结构

能力规范是 `spec.md`，结构如下：

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

示例（来自 `studio-events-bus`）：

```markdown
### Requirement: Unified event envelope
The system SHALL use a unified event envelope to express all Studio events (LLM/tool/file change/room/queue/hire, etc.)...

#### Scenario: Events are logged and broadcast
- **WHEN** the system produces any Studio event
- **THEN** the event SHALL be appended as a single line of JSON to the event log (JSONL)
- **AND THEN** the event SHALL be broadcast in real time to all WebSocket subscribers
```

`SHALL` 这个关键词是有意为之——它把这条需求标记为可测试。

## 变更目录结构

```
openspec/changes/
└── <change-id>/
    ├── .openspec.yaml    # machine-readable links to capabilities
    ├── proposal.md       # "Why" + "What Changes" + "Impact"
    ├── design.md         # "How" — technical design notes
    ├── tasks.md          # Ordered checklist (1. 2. 3. ...)
    └── specs/<cap>/spec.md  # delta: ADDED/MODIFIED/REMOVED Requirements
```

已交付的示例：`studio-web-ui-click-through-fix/`（已归档）。

### `proposal.md`（节选）

```markdown
## Why

When the left HUD and drawers overlay the Phaser canvas, some areas fail to register `pointer-events` correctly,
so clicks "pass through" to the canvas below and trigger drag/zoom instead of the intended UI actions.

## What Changes

- Explicitly set `pointer-events: auto` on the `#hud` top-bar `.row`, ...
- Explicitly declare `pointer-events: auto` on the drawer overlay and drawer container, ...

## Capabilities

### New Capabilities
(none — behaviour is folded into `studio-web-ui`.)

### Modified Capabilities
- `studio-web-ui`: add requirements on hit-testing and stacking (see delta spec).

## Impact

- **Code**: `apps/studio-web/src/style.css` only — style tweaks.
- **Behaviour**: top-bar and drawer clicks are more reliable.
```

### `tasks.md`（节选 —— 单行清单风格）

```markdown
## 1. Style completion

- [ ] Explicitly set `pointer-events: auto` on `.hud .row`
- [ ] Explicitly set `pointer-events: auto` on drawer overlay and container

## 2. Verification

- [ ] Drag / zoom / HUD clicks are no longer swallowed by the canvas
```

### `design.md`（自由形式 —— 设计理由）

简短的叙述，解释权衡与所选方案。schema 不强制格式；这里是为人类读者而写。

## 变更如何变成规范

```
1. Author opens openspec/changes/<id>/ with proposal/design/tasks + delta specs
2. .openspec.yaml declares which capabilities are touched
3. Implementation proceeds
4. The change is archived: openspec/changes/<id>/ is removed
5. The delta spec patches fold into openspec/specs/<cap>/spec.md
6. tasks.md items get checked off (or rolled into a new change)
```

归档是**提交时刻**——一旦归档，规范就是真相，变更也会从变更集合中移除。

## 漂移检测（「章程是否改过？」循环）

`studio-change-control` 把这条规则写实：

> The system SHALL in the presence of a "latest archived charter" perform drift detection: if `goal`, `milestones`, or `nodes` change, declare drift.

在服务端，这条规则由 `driftKinds(draft, archived)` 实现：

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

每一种非空的漂移类型都会产生一条带 `kinds: [...]` 的 `change.detected` 事件。会议室会以「待处理漂移：...」的形式呈现，并提供一键清除。

## OpenSpec 配置（`openspec/config.yaml`）

```yaml
schema: spec-driven
```

`context` 字段和各产物的 `rules` 字段被注释掉了——它们是占位符，供希望注入项目级 AI 上下文（例如「技术栈：TypeScript、Node.js」）的项目使用。AiGameAgent 故意把它留空，让项目级上下文落在 `.claude/docs/` 下。

## 完整流程图

```mermaid
flowchart LR
  Boss[👤 Boss in meeting room] -->|edit charter| Draft
  Draft[Charter Draft] -->|save| StateJson[(state.json)]
  Draft -->|archive| Archive[Latest Archive vN]
  Draft -.drift.->|compute| DriftKinds
  DriftKinds -->|non-empty| ChangeDetected[change.detected event]
  ChangeDetected -->|UI shows| Pending[Pending drift]
  Pending -->|click clear| ChangeCleared[change.cleared event]
  Archive -.normArr compare.-> DriftKinds
```

## OpenSpec 工具

项目不内置自定义 CLI——`.cursor/commands/opsx-*.md` 命令是**Cursor 的斜杠命令**绑定，对应 OpenSpec 的 CLI（`opsx`）。使用方法：

1. 安装 OpenSpec CLI（`@open-spec/cli` 或类似）
2. 在 Cursor 中，输入 `/opsx-propose` 来脚手架新变更
3. 该斜杠命令会在 `openspec/changes/<id>/` 下创建所需文件

团队的工作准则是：**propose → review → design → tasks → code → archive**。紧急修复（单行变更）允许跳过步骤，但不鼓励这么做。

## 接下来

- [会议室与项目章程](/docs/06-meeting-and-charter) —— 规范所描述的会议流程
- [智能体花名册与部门](/docs/04-agents-and-departments) —— 领导层会议中提到的 Agent
- [Local LLM 集成](/docs/10-local-llm) —— 把 Cursor-经代理的故事写实的规范
