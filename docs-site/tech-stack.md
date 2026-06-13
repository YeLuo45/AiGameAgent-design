# 技术栈

AiGameAgent 刻意保持精简：**Node.js 服务端，全栈 TypeScript，前端用 Phaser，主打本地优先的大模型**。没有 React，没有数据库，没有 Redis——只有文件、WebSocket 和一套强类型的事件总线。

## 核心技术栈

| 层 | 技术 | 版本 | 原因 |
|------|------|---------|-----|
| 运行时 | Node.js | ≥ 20 | 原生 `node:http`、`node:fs/promises`、`node:child_process`、ESM 模块 |
| 语言 | TypeScript | ^5.8.3 | `strict: true`、`target: ES2022`、`moduleResolution: Bundler` |
| 工作区 | npm workspaces | （内置） | 避免在 monorepo 中出现 pnpm / yarn lockfile 漂移 |
| 进程编排 | `concurrently` | ^9.2.1 | 在一个终端里同时跑 `dev:server` + `dev:web` |
| 服务端 | `node:http` + `ws` | ws ^8.18.3 | 零依赖 HTTP，约 3,630 LOC 的单体 |
| 文件监听 | `chokidar` | ^4.0.3 | 用于仓库根目录的 `fs.change` 事件 |
| YAML frontmatter | `gray-matter` | ^4.0.3 | 解析 `.claude/agents/*.md` |
| 图像管线 | `sharp` | ^0.34.1 | 雪碧图打包与归一化 |
| 视频 | `ffmpeg`（CLI） | 外部依赖 | 可选；仅在转码资源时使用 |
| 前端 | Phaser | ^3.90.0 | 等距 Kairo 风格办公室渲染 |
| 前端工具链 | Vite | ^6.2.3 | Web 应用的 dev server + ESM 构建 |
| 开发运行器 | `tsx` | ^4.20.5 | 服务端的 TypeScript watch 模式 |
| 开发（Win 兼容） | `cross-env` | ^7.0.3 | 在 Windows shell 下使用 `STUDIO_REPO_ROOT=../..` |

## 工作区清单

| 包 | 名称 | 角色 |
|---------|------|------|
| 根 | `aiGameGongfang` | npm workspaces，dev / build 编排 |
| `apps/studio-server` | `@aigongfang/studio-server` | Node.js HTTP + WS（端口 8787） |
| `apps/studio-web` | `@aigongfang/studio-web` | Phaser + Vite（dev 端口 5173） |
| `packages/shared` | `@aigongfang/shared` | Studio 事件类型 + reducer |

## TypeScript 配置

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

shared 包把 `./studio-events` 导出为**裸路径**——消费方必须以 `@aigongfang/shared/studio-events` 导入（而不是 `@aigongfang/shared`）。

## 大模型兼容性矩阵

AiGameAgent 不内置模型——它对接**任何** OpenAI 兼容端点。

| 提供方 | Base URL | 备注 |
|----------|----------|-------|
| Ollama | `http://127.0.0.1:11434/v1` | 默认 `STUDIO_UPSTREAM_BASE_URL`；可选 `llama3.2` 或任何 chat 模型 |
| vLLM | `http://127.0.0.1:8000/v1` | 高吞吐本地 |
| LM Studio | `http://127.0.0.1:1234/v1` | GUI 友好 |
| OpenAI | `https://api.openai.com/v1` | "高质量"档位的云端默认 |
| DeepSeek / Doubao / 自托管 | 任意 `/v1` 根 | 通过环境变量接入 |

能力按提供方打标：

```ts
type Capability = "text" | "image" | "music";

type Provider = {
  id: string;
  label: string;
  kind: "local" | "lan" | "cloud";
  baseUrl: string;       // OpenAI 兼容 /v1
  model: string;
  capabilities: Capability[];
  pricing: { inputPer1k: number; outputPer1k: number; currency: string };
};
```

## 推荐模型档位（自动推导）

| 显存 | 内存 | 推荐 |
|------|-----|-------------|
| ≥ 24 GB | 任意 | 32B Q4 quant · 14B 全精度 · 7B 全精度 |
| ≥ 16 GB | 任意 | 14B Q4/Q5 · 7B 全精度 |
| ≥ 8 GB | 任意 | 7B Q4/Q5 · 3B/4B |
| 任意 | ≥ 16 GB | 3B/4B CPU · 7B Q4（较慢） |
| 任意 | < 16 GB | 3B Q4 仅 CPU |

检测方式：在 Windows 上通过 `Get-CimInstance Win32_VideoController`；`os.totalmem()` 总是检测。推荐结果会反馈到 `/api/advice`，使 secretary HUD 能在老板挑模型之前先提示 "32B Q4 适配你的 24GB GPU"。

## 存储模型

**一切皆文件**——没有数据库：

| 路径 | 所有者 | 格式 | Gitignore？ |
|------|-------|--------|-------------|
| `production/policy.json` | 服务端 | JSON | ✅ |
| `production/model-routing.json` | 服务端 | JSON | ✅ |
| `production/studio-hired.json` | 服务端 | JSON | ✅ |
| `production/studio-providers.json` | 服务端 | JSON | ✅ |
| `production/charter/state.json` | 服务端 | JSON | ✅ |
| `production/preview/<pid>/index.html` | UI | HTML | ✅ |
| `production/preview/<pid>/history/*.html` | UI | HTML | ✅ |
| `production/preview/<pid>/assets/gen/<runId>/*.png` | asset-pipeline | PNG | ✅ |
| `production/session-logs/` | 服务端 | JSONL | ✅ |
| `studio_events.jsonl`（根） | 服务端 | JSONL | ✅ |
| `.claude/agents/*.md` | 手工维护 | Markdown + YAML frontmatter | ❌ 提交 |
| `openspec/specs/*/spec.md` | 手工维护 | Markdown | ❌ 提交 |
| `openspec/changes/<id>/*` | 手工维护 | Markdown | ❌ 提交 |

## Lint / 格式化 / 测试

AiGameAgent **没有**在根目录内置 ESLint 或 Prettier 配置——约定写在项目的 CLAUDE-local-template.md 与 `.claude/rules/` 里，团队文化是"规则装在 AI 脑子里，而不是工具链里"。也没有 `npm test`；唯一的自动检查是 `npm run check:studio-e2e`（在 dev server 启动后命中若干 `/api/*` 路由的冒烟测试）。

## 运行时端口

| 端口 | 服务 | 绑定 |
|------|---------|------|
| 8787 | Studio 服务端（HTTP + WS `/ws`） | `127.0.0.1`（默认） |
| 5173 | Studio Web（Vite dev） | `127.0.0.1` |
| 11434 | Ollama（外部） | `127.0.0.1` |
| 8000 | vLLM（可选外部） | `127.0.0.1` |

> 默认的 Studio 绑定是 `127.0.0.1`，而不是 `0.0.0.0`——把 Studio 留在 loopback，由反向代理（或 SSH 隧道）对外暴露。

## 环境变量

| 变量 | 默认 | 使用方 |
|-----|---------|---------|
| `STUDIO_PORT` | `8787` | 服务端监听端口 |
| `STUDIO_HOST` | `127.0.0.1` | 服务端绑定 host |
| `STUDIO_REPO_ROOT` | `process.cwd()` | 服务端文件根（章程、预览、策略） |
| `STUDIO_LOG_PATH` | `<repo>/studio_events.jsonl` | 事件日志路径 |
| `STUDIO_UPSTREAM_BASE_URL` | `http://127.0.0.1:11434/v1` | OpenAI 兼容上游 |
| `STUDIO_MODEL` | `llama3.2` | 默认基准模型 |
| `STUDIO_IMAGE_BASE_URL` | （未设置 → 使用 upstream） | DALL-E / SD 兼容 |
| `STUDIO_IMAGE_MODEL` | `dall-e-2` | 图像生成模型 |
| `STUDIO_IMAGE_API_KEY` | （未设置） | 与 upstream key 区分 |
| `STUDIO_DEBUG_PROXY_HEADERS` | `0` | 记录转发的 header（鉴权信息已脱敏） |
| `FFMPEG_PATH` | （未设置 → PATH 上的 `ffmpeg`） | 视频转码器 |

## 构建命令

```bash
# 安装（npm workspaces 自动链接 apps/* 与 packages/*）
npm install

# 开发（一个终端同时跑 server + web）
npm run dev                  # 两者
npm run dev:server           # 仅 server
npm run dev:web              # 仅 web

# 构建（server 用 tsc，web 用 vite build）
npm run build

# 冒烟测试
npm run check:studio-e2e
```

## 接下来

- 服务端的接线方式：[Studio Server](/docs/01-studio-server)
- Phaser 办公室如何渲染：[Studio Web](/docs/02-studio-web)
- 25 种事件类型如何接入：[共享事件总线](/docs/03-events-bus)
