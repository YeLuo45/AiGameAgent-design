# 08 · Asset Pipeline

AiGameAgent ships with a small but complete asset pipeline: image generation, sprite-sheet packing, and video transcoding. All three run in the same Node.js process as the server, all three emit `asset.*` events, and all three write into the same `production/preview/<projectId>/assets/` tree.

**Source:** `apps/studio-server/src/asset-pipeline.ts` (~280 LOC)

## Three operations

| Function | Output | Use case |
|----------|--------|----------|
| `studioGenerateImages` | PNG files at `assets/gen/<runId>/{0..n-1}.png` | Hero art, character concepts, UI textures |
| `studioPackSpritesheet` | Composite PNG + JSON frame metadata at `assets/<name>.{png,json}` | Animation frames, tile sets |
| `studioTranscodeVideo` | Encoded video file at `assets/<output>` | Promo videos, gameplay captures |

All three:

- Sanitise `projectId` to `[a-zA-Z0-9_-]` (path-traversal safe)
- Compute paths relative to `repoRoot` (for display in events)
- Reject with `{ ok: false, error, status? }` on failure

## Image generation

```ts
async function studioGenerateImages(opts: {
  repoRoot: string;
  projectId: string;
  prompt: string;
  n?: number;            // 1-10, default 1
  size?: string;         // default "1024x1024"
  imageBaseUrl: string;  // OpenAI-compatible /v1
  apiKey?: string;
  model?: string;        // default "dall-e-2"
}): Promise<GenOk | GenErr>;
```

Flow:

1. Validate projectId, prompt
2. Clamp `n` to 1-10
3. POST `{ model, prompt, n, size, response_format: "url" }` to `images/generations`
4. For each returned URL, fetch the binary, write to `production/preview/<pid>/assets/gen/<runId>/<i>.png`
5. Emit `asset.image_saved` with `{ projectId, runId, files, relPaths }`

If the upstream returns a base64 payload instead of a URL, the function will still try to decode it (graceful degradation for non-OpenAI upstreams that return `b64_json`).

## Sprite-sheet packing

```ts
async function studioPackSpritesheet(opts: {
  repoRoot: string;
  projectId: string;
  sourceDir: string;   // folder of input PNGs/JPGs
  outputName: string;  // base name for output
  maxWidth?: number;   // default 2048
}): Promise<{ ok: true; output: string; json: string; frameCount: number } | GenErr>;
```

Flow:

1. List input files in `sourceDir` (PNG / JPG / WebP)
2. Sort by filename (so frame order is deterministic)
3. Compute layout: grid, max `maxWidth` per row
4. Composite with `sharp` — each input read, resized if too large, placed at `(col*tileW, row*tileH)`
5. Write `production/preview/<pid>/assets/<outputName>.png` (the sheet) and `<outputName>.json` (frame metadata)
6. Emit `asset.spritesheet_saved`

The JSON output format (Aseprite-compatible):

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

## Video transcoding

```ts
async function studioTranscodeVideo(opts: {
  repoRoot: string;
  projectId: string;
  input: string;     // path relative to repoRoot, or absolute within repo
  output: string;    // target path relative to preview assets
  codec?: string;    // default "libx264"
}): Promise<{ ok: true; output: string } | GenErr>;
```

Flow:

1. Validate both paths are under `repoRoot` (`isUnderRepoRoot()`)
2. Spawn `ffmpeg` (or `process.env.FFMPEG_PATH`) with `-i <input> -c:v <codec> <output>`
3. Capture stdout/stderr; reject on non-zero exit
4. Emit `asset.pipeline_failed` (with `stage: "ffmpeg"`) on failure, or no event on success (the caller emits its own `job.finished`)

The function does **not** emit a "video saved" event in v1 — the assumption is that the caller (a Job) wraps the operation and emits `job.finished` itself.

## Error shapes

```ts
type GenOk = { ok: true; projectId: string; runId: string; files: string[]; relPaths: string[] };
type GenErr = { ok: false; error: string; status?: number };
```

`status` is set when the upstream returned an HTTP error (4xx / 5xx). It's a hint for `/api/finance/summary` to attribute the failure.

## Path safety

```ts
function isUnderRepoRoot(repoRoot: string, absPath: string): boolean {
  const root = resolve(repoRoot);
  const target = resolve(absPath);
  return target === root || target.startsWith(root + sep) || target.startsWith(root + "/");
}
```

This is the only place that does the check — both for inputs (to prevent reading outside the repo) and for outputs (to prevent writing outside `production/preview/`).

The `safeProjectId()` helper is the first line of every export:

```ts
function safeProjectId(projectId: string): string {
  return String(projectId ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
}
```

If the result is empty, the function returns `{ ok: false, error: "bad_project_id" }` before doing any I/O.

## How the agent calls these

In a typical job, the agent's task description includes a hint like "generate 4 512x512 hero concept images" or "pack the PNGs in `assets/frames/` into a sprite sheet". The agent's output is parsed server-side; if it matches an "intent" pattern, the server invokes the corresponding pipeline function. (In v1 this dispatch is **manual** — the producer or art-director writes instructions, and the LLM emits a structured response that the server knows how to interpret.)

Example server-side dispatch (not in v1, but planned):

```ts
if (task.includes("生成") && task.includes("图片")) {
  const result = await studioGenerateImages({ repoRoot, projectId, prompt: extractPrompt(task), n: 4, imageBaseUrl, apiKey });
  if (result.ok) emit({ type: "asset.image_saved", payload: result });
}
```

The pipeline functions are **not** auto-invoked by the OpenAI proxy; they're a library the server (or a job) calls explicitly.

## Why sharp (and not canvas / jimp)?

- **sharp** is the de-facto Node.js image library — backed by libvips, fast even on large images, and bundles native binaries for common platforms (Windows / macOS / Linux)
- It's the only image lib in the Node ecosystem that handles `RGBA8888` / `PremultipliedAlpha` correctly out of the box, which matters for sprite-sheet packing
- `jimp` is pure JS but ~10× slower and lacks some operations sharp exposes

The downside: sharp ships native binaries (~30 MB), which is why the asset pipeline is optional. A minimal AiGameAgent install without sharp is still fully functional — the sprite-sheet packer just won't be available.

## Next

- [Monitor & HTML Preview](/docs/07-monitor-and-preview) — where the assets are served from
- [Finance & Model Routing](/docs/09-finance-and-routing) — how asset-pipeline costs are tracked
- [Local LLM Integration](/docs/10-local-llm) — image model routing
