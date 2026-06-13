# 08 · 资源管道

AiGameAgent 自带一套小巧但完整的资源管道：图像生成、精灵表打包、视频转码。三个都在与服务器相同的 Node.js 进程里跑，都会发 `asset.*` 事件，都会写入同一棵 `production/preview/<projectId>/assets/` 目录树。

**Source:** `apps/studio-server/src/asset-pipeline.ts`（约 280 行）

## 三类操作

| 函数 | 输出 | 用途 |
|----------|--------|----------|
| `studioGenerateImages` | PNG 文件位于 `assets/gen/<runId>/{0..n-1}.png` | 主视觉、角色概念、UI 贴图 |
| `studioPackSpritesheet` | 合成 PNG + JSON 帧元数据位于 `assets/<name>.{png,json}` | 动画帧、Tileset |
| `studioTranscodeVideo` | 编码后的视频文件位于 `assets/<output>` | 宣传片、游戏录屏 |

三者共同点：

- 把 `projectId` 清洗为 `[a-zA-Z0-9_-]`（防路径穿越）
- 路径以 `repoRoot` 为基准计算（用于在事件中展示）
- 失败时返回 `{ ok: false, error, status? }`

## 图像生成

```ts
async function studioGenerateImages(opts: {
  repoRoot: string;
  projectId: string;
  prompt: string;
  n?: number;            // 1-10，默认 1
  size?: string;         // 默认 "1024x1024"
  imageBaseUrl: string;  // OpenAI-compatible /v1
  apiKey?: string;
  model?: string;        // 默认 "dall-e-2"
}): Promise<GenOk | GenErr>;
```

流程：

1. 校验 `projectId`、`prompt`
2. 把 `n` 钳制在 1-10
3. 向 `images/generations` 发送 POST `{ model, prompt, n, size, response_format: "url" }`
4. 对每个返回的 URL，取二进制并写入 `production/preview/<pid>/assets/gen/<runId>/<i>.png`
5. 发出 `asset.image_saved`，载荷为 `{ projectId, runId, files, relPaths }`

如果上游返回的是 base64 而不是 URL，函数也会尝试解码（对返回 `b64_json` 的非 OpenAI 上游提供优雅降级）。

## 精灵表打包

```ts
async function studioPackSpritesheet(opts: {
  repoRoot: string;
  projectId: string;
  sourceDir: string;   // 输入 PNG/JPG 所在文件夹
  outputName: string;  // 输出基础名
  maxWidth?: number;   // 默认 2048
}): Promise<{ ok: true; output: string; json: string; frameCount: number } | GenErr>;
```

流程：

1. 列出 `sourceDir` 中的输入文件（PNG / JPG / WebP）
2. 按文件名排序（帧顺序确定性）
3. 计算布局：网格，每行最大 `maxWidth`
4. 用 `sharp` 合成——逐个读取输入，过大则缩放，按 `(col*tileW, row*tileH)` 放置
5. 写出 `production/preview/<pid>/assets/<outputName>.png`（精灵表）以及 `<outputName>.json`（帧元数据）
6. 发出 `asset.spritesheet_saved`

JSON 输出格式（Aseprite 兼容）：

```json
{
  "frames": [
    { "filename": "frame_000.png", "frame": { "x": 0,   "y": 0,  "w": 64, "h": 64 }, "duration": 100 },
    { "filename": "frame_001.png", "frame": { "x": 64,  "y": 0,  "w": 64, "h": 64 }, "duration": 100 },
    ...
  ],
  "meta": {
    "app": "aigameagent-asset-pipeline",
    "version": "1.0",
    "image": "<outputName>.png",
    "size": { "w": 256, "h": 64 },
    "format": "RGBA8888"
  }
}
```

## 视频转码

```ts
async function studioTranscodeVideo(opts: {
  repoRoot: string;
  projectId: string;
  input: string;     // 相对于 repoRoot 的路径，或 repo 内的绝对路径
  output: string;    // 相对于预览资源目录的目标路径
  codec?: string;    // 默认 "libx264"
}): Promise<{ ok: true; output: string } | GenErr>;
```

流程：

1. 校验两条路径都在 `repoRoot` 下（`isUnderRepoRoot()`）
2. 用 `-i <input> -c:v <codec> <output>` 派生 `ffmpeg`（或 `process.env.FFMPEG_PATH`）
3. 捕获 stdout/stderr；非零退出即拒绝
4. 失败时发出 `asset.pipeline_failed`（带 `stage: "ffmpeg"`）；成功时不发事件（由调用方自行发出 `job.finished`）

v1 中该函数**不**发「视频已保存」事件——假设调用方（一个 Job）会包住这次操作，自己发 `job.finished`。

## 错误形态

```ts
type GenOk = { ok: true; projectId: string; runId: string; files: string[]; relPaths: string[] };
type GenErr = { ok: false; error: string; status?: number };
```

当上游返回 HTTP 错误（4xx / 5xx）时，`status` 会被设置。它会作为提示，让 `/api/finance/summary` 把失败归因到对应位置。

## 路径安全

```ts
function isUnderRepoRoot(repoRoot: string, absPath: string): boolean {
  const root = resolve(repoRoot);
  const target = resolve(absPath);
  return target === root || target.startsWith(root + sep) || target.startsWith(root + "/");
}
```

这是唯一做这道检查的地方——对输入（防止读取到 repo 外）是这样，对输出（防止写到 `production/preview/` 之外）也是这样。

`safeProjectId()` 助手是每个导出函数的第一行：

```ts
function safeProjectId(projectId: string): string {
  return String(projectId ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
}
```

如果清洗后为空，函数在任何 I/O 之前就会返回 `{ ok: false, error: "bad_project_id" }`。

## Agent 如何调用这些函数

在典型 Job 中，Agent 的任务描述会带一条提示，比如「生成 4 张 512x512 主视觉概念图」或「把 `assets/frames/` 里的 PNG 打成精灵表」。Agent 的输出由服务端解析；若匹配某个「意图」模式，服务端就调用对应的管道函数。（v1 中此调度**是手动的**——producer 或 art-director 写指示，LLM 输出服务端能够理解的结构化响应。）

服务端调度的示例（v1 中尚无，但计划中）：

```ts
if (task.includes("生成") && task.includes("图片")) {
  const result = await studioGenerateImages({ repoRoot, projectId, prompt: extractPrompt(task), n: 4, imageBaseUrl, apiKey });
  if (result.ok) emit({ type: "asset.image_saved", payload: result });
}
```

管道函数**不是**由 OpenAI 代理自动调用的；它们是供服务端（或 Job）显式调用的库。

## 为什么选 sharp（而不是 canvas / jimp）？

- **sharp** 是事实上的 Node.js 图像库——由 libvips 驱动，即便在大型图像上也很快，并为常见平台（Windows / macOS / Linux）打包了原生二进制
- 它是 Node 生态里唯一开箱即用地正确处理 `RGBA8888` / `PremultipliedAlpha` 的图像库——这在精灵表打包中很关键
- `jimp` 是纯 JS，但速度慢约 10 倍，且缺少 sharp 暴露的部分操作

代价：sharp 自带约 30 MB 的原生二进制，这也是为什么资源管道是可选的。没有 sharp 的最小化 AiGameAgent 安装仍然完全可用——只是精灵表打包不可用。

## 接下来

- [监控与 H5 预览](/docs/07-monitor-and-preview) —— 资源的提供位置
- [财务与模型路由](/docs/09-finance-and-routing) —— 资源管道的成本是如何被追踪的
- [Local LLM 集成](/docs/10-local-llm) —— 图像模型的路由
