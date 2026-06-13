# 04 · 智能体花名册与部门

AiGameAgent 中的「工作室」由 **30 位具名 AI Agent** 组成，每个 Agent 以 `.claude/agents/<id>.md` 清单文件声明。服务器首次启动时会自动雇佣全部 30 位；老板可以通过雇佣花名册来开关某位 Agent。

**Source:** `.claude/agents/*.md`（30 个文件）· 由 `studio-server/src/index.ts` 中的 `listAgents(repoRoot)` 在运行时解析

## 花名册

当前花名册（来自仓库内置的 `production/studio-hired.json`）：

| Agent | 部门 | 职责 |
|-------|-----------|--------------|
| `producer` | leadership | 拆分任务、分派给专家、把守验收 |
| `technical-director` | leadership | 路由模型、关注首块延迟、卡顿时升级 |
| `creative-director` | leadership | 在预览上把关、执行验收标准 |
| `game-designer` | design | 核心循环、机制、胜负条件 |
| `systems-designer` | design | 经济、成长曲线、公式 |
| `level-designer` | design | 地图、遭遇、节奏 |
| `economy-designer` | design | 资源曲线、消耗/产出 |
| `narrative-director` | narrative | 故事线、角色、分支 |
| `writer` | narrative | 对白、文案、游戏内文本 |
| `localization-lead` | narrative | 多语言、术语表 |
| `community-manager` | narrative | 玩家沟通、舆情、FAQ |
| `lead-programmer` | programming | 架构、代码评审、反编译风险 |
| `gameplay-programmer` | programming | 核心玩法代码、输入、状态 |
| `engine-programmer` | programming | 引擎内部、自定义系统 |
| `ai-programmer` | programming | NPC AI、寻路、行为树 |
| `network-programmer` | programming | 多人、netcode、状态同步 |
| `tools-programmer` | programming | 编辑器工具、管道、CLI |
| `ui-programmer` | programming | HUD、菜单、游戏内 UI |
| `art-director` | art_audio | 视觉风格、艺术圣经 |
| `audio-director` | art_audio | 音乐与音效方向 |
| `sound-designer` | art_audio | 逐事件的 SFX、环境音 |
| `technical-artist` | art_audio | 着色器、VFX、资源集成 |
| `qa-lead` | qa_release | 测试计划、回归范围 |
| `qa-tester` | qa_release | 测试执行、Bug 提交 |
| `release-manager` | qa_release | 商店上架、平台规则 |
| `devops-engineer` | qa_release | CI/CD、基础设施 |
| `security-engineer` | qa_release | 威胁模型、反作弊 |
| `performance-analyst` | qa_release | 性能分析、帧预算 |
| `prototyper` | other | 一次性 spike 试验 |
| `accessibility-specialist` | other | 字幕、色盲、触感反馈 |
| `analytics-engineer` | other | 埋点、仪表板 |
| `live-ops-designer` | other | 活动、留存循环 |
| `world-builder` | other | 世界观、世界圣经 |
| `ux-designer` | other | UI/UX 流程 |
| `web-h5-specialist` | platform | Web / H5 交付 |
| `wechat-minigame-specialist` | platform | 微信小游戏 |
| `douyin-minigame-specialist` | platform | 抖音小游戏 |

仓库内置的 `studio-hired.json` 实际是 **37 条**记录——其中部分（例如 `web-h5-specialist`）与规范列表有重叠。运行时的 `listAgents()` 会枚举磁盘上所有内容，因此 `.claude/agents/` 目录才是真正的真源。

## Agent 清单格式

每个 Agent 都是一份带 YAML frontmatter 的 Markdown 文件：

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

服务器用 `gray-matter` 解析 frontmatter，并通过 `/api/agents` 暴露 `id + description`。

## 部门映射

`deptOf(agentId)` 是 `studio-web/src/main.ts` 中的硬编码查找：

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

它驱动：

- Phaser 工位布局（决定工位出现在哪个集群）
- 部门抽屉（决定哪些 Agent 参与部门 KPI）
- 工单操作（`POST /api/dept/workorder/action` 接收 `deptId`）

## 领导层会议子集

前三位 Agent —— `producer`、`technical-director`、`creative-director` —— 构成「领导层」集合。它们是 `meeting.start` 流程中**唯一**被调用的 Agent：

```ts
const LEADERSHIP_MEETING_AGENTS = new Set(["producer", "technical-director", "creative-director"]);
```

在会议中，三位 Agent 被依次调用并产出会议记录。其回复随后被解析（JSON 或宽松的 `Speaker: text`），老板再决定要把哪些内容归档进章程。

## 雇佣生命周期

```
agent.yaml exists
    └─> server boot
         └─> listAgents() reads all *.md
              └─> hired = Set of all
                   └─> production/studio-hired.json written
                        └─> /api/hire returns { hired: [...] }
```

老板可以通过 `POST /api/hire { agentId, hired: false }` 关闭某位 Agent。下一次入队检查：

```ts
if (hired.size > 0 && !hired.has(agentId)) {
  json(res, 400, { ok: false, error: "agent_not_hired", agentId });
  return;
}
```

`POST /api/hire/sync_all` 会把花名册重置为「全员」。

## Producer 链（开局编排）

当会议敲定一份章程时，producer 的「链」会启动一个序列：

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

每一步的 `Job` 都带 `source: "producer_chain"` 和 `producerChainId`。当链上的 Job 完成时，`maybeAdvanceProducerChain()` 会判断下一步是否就绪并推入。

## 按 Agent 覆盖提供方

```ts
const agentProvider = new Map<string, string>(); // agentId -> providerId
```

如果老板想让 `qa-tester` 始终使用 `cloud` 提供方（比如为了更好的推理能力），可以 `POST /api/system/route { agentId: "qa-tester", providerId: "cloud" }`。`qa-tester` 的下一次入队会跳过路由逻辑，直接使用 `cloud`。

## 为什么要 30+ 个 Agent，而不是一个「AI」？

工作室是**模拟一个真实的游戏工作室**，原因在于：

1. **专业化胜过泛化**——对小型本地模型而言，「你是 producer」这种 7B 模型的表现，比同一 7B 模型扮演「你是通用 AI 助手」要更好
2. **输出边界由部门塑形**——producer 的输出是任务队列，艺术家的输出是精灵图，QA 的输出是 Bug 列表。限定角色就能限定输出
3. **老板可以在合适的层级介入**——艺术家掉链子时，老板去 `art_audio` 抽屉就行，不必在一条长对话里翻找
4. **可视化物有所值**——7 个集群中的 30 个工位**看起来就像一间工作室**；一个聊天气泡则不然

## 新增 Agent

三步搞定：

1. 把 `my-new-role.md` 放到 `.claude/agents/`，在 frontmatter 中填好 `name` + `description`
2.（可选）在 `studio-web/src/main.ts` 中扩展 `deptOf()`，把新角色纳入新部门
3.（可选）把它接到 producer 清单中的某条链上

如果重新加载雇佣列表，无需重启服务器——下一次 `/api/agents` 调用就会拾取它。列表是按需读取的，没有需要击穿的内存缓存。

## 接下来

- [OpenSpec 变更控制](/docs/05-openspec) —— `studio-events-bus` 这类能力是如何版本化的
- [会议室与项目章程](/docs/06-meeting-and-charter) —— 领导层子集的实际运转
- [监控与 H5 预览](/docs/07-monitor-and-preview) —— 任一 Agent 的输出
