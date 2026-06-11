# Tech Stack

AiGameAgent deliberately stays lean: **Node.js for the server, TypeScript everywhere, Phaser for the front-end, and a local-first LLM story**. No React, no database, no Redis — just files, WebSockets, and a well-typed event bus.

## Core stack

| Layer | Tech | Version | Why |
|------|------|---------|-----|
| Runtime | Node.js | ≥ 20 | Native `node:http`, `node:fs/promises`, `node:child_process`, ESM modules |
| Language | TypeScript | ^5.8.3 | `strict: true`, `target: ES2022`, `moduleResolution: Bundler` |
| Workspace | npm workspaces | (built-in) | Avoids pnpm/yarn lockfile drift in a monorepo |
| Process glue | `concurrently` | ^9.2.1 | Run `dev:server` + `dev:web` in one terminal |
| Server | `node:http` + `ws` | ws ^8.18.3 | Zero-dep HTTP, ~3,630 LOC monolith |
| File watch | `chokidar` | ^4.0.3 | Used for repo-root `fs.change` events |
| YAML frontmatter | `gray-matter` | ^4.0.3 | Parses `.claude/agents/*.md` |
| Image pipeline | `sharp` | ^0.34.1 | Sprite-sheet packing & normalization |
| Video | `ffmpeg` (CLI) | external | Optional; only when transcoding assets |
| Front-end | Phaser | ^3.90.0 | Isometric Kairo-like office rendering |
| Front-end tooling | Vite | ^6.2.3 | Dev server + ESM build for the web app |
| Dev runner | `tsx` | ^4.20.5 | TypeScript watch mode for the server |
| Dev (Win compat) | `cross-env` | ^7.0.3 | `STUDIO_REPO_ROOT=../..` on Windows shells |

## Workspace manifests

| Package | Name | Role |
|---------|------|------|
| Root | `aiGameGongfang` | npm workspaces, dev/build orchestration |
| `apps/studio-server` | `@aigongfang/studio-server` | Node.js HTTP + WS (port 8787) |
| `apps/studio-web` | `@aigongfang/studio-web` | Phaser + Vite (dev port 5173) |
| `packages/shared` | `@aigongfang/shared` | Studio event types + reducer |

## TypeScript config

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

The shared package exports `./studio-events` as a **bare path** — the consuming package must import `@aigongfang/shared/studio-events` (not `@aigongfang/shared`).

## LLM compatibility matrix

AiGameAgent doesn't ship its own model — it talks to **any** OpenAI-compatible endpoint.

| Provider | Base URL | Notes |
|----------|----------|-------|
| Ollama | `http://127.0.0.1:11434/v1` | Default `STUDIO_UPSTREAM_BASE_URL`; pick `llama3.2` or any chat model |
| vLLM | `http://127.0.0.1:8000/v1` | High-throughput local |
| LM Studio | `http://127.0.0.1:1234/v1` | GUI-friendly |
| OpenAI | `https://api.openai.com/v1` | Cloud default for "high quality" tier |
| DeepSeek / Doubao / 自建 | any `/v1` root | Plug in via env var |

Capabilities tagged per provider:

```ts
type Capability = "text" | "image" | "music";

type Provider = {
  id: string;
  label: string;
  kind: "local" | "lan" | "cloud";
  baseUrl: string;       // OpenAI-compatible /v1
  model: string;
  capabilities: Capability[];
  pricing: { inputPer1k: number; outputPer1k: number; currency: string };
};
```

## Recommended model tier (auto-derived)

| VRAM | RAM | Recommended |
|------|-----|-------------|
| ≥ 24 GB | any | 32B Q4 quant · 14B full · 7B full |
| ≥ 16 GB | any | 14B Q4/Q5 · 7B full |
| ≥ 8 GB | any | 7B Q4/Q5 · 3B/4B |
| any | ≥ 16 GB | 3B/4B CPU · 7B Q4 (slow) |
| any | < 16 GB | 3B Q4 CPU-only |

Detection is via `Get-CimInstance Win32_VideoController` on Windows; `os.totalmem()` always. The recommendation feeds `/api/advice` so the secretary HUD can show "32B Q4 fits your 24GB GPU" before the boss picks a model.

## Storage model

**Everything is files** — no database:

| Path | Owner | Format | Gitignored? |
|------|-------|--------|-------------|
| `production/policy.json` | server | JSON | ✅ |
| `production/model-routing.json` | server | JSON | ✅ |
| `production/studio-hired.json` | server | JSON | ✅ |
| `production/studio-providers.json` | server | JSON | ✅ |
| `production/charter/state.json` | server | JSON | ✅ |
| `production/preview/<pid>/index.html` | UI | HTML | ✅ |
| `production/preview/<pid>/history/*.html` | UI | HTML | ✅ |
| `production/preview/<pid>/assets/gen/<runId>/*.png` | asset-pipeline | PNG | ✅ |
| `production/session-logs/` | server | JSONL | ✅ |
| `studio_events.jsonl` (root) | server | JSONL | ✅ |
| `.claude/agents/*.md` | manual | Markdown + YAML frontmatter | ❌ committed |
| `openspec/specs/*/spec.md` | manual | Markdown | ❌ committed |
| `openspec/changes/<id>/*` | manual | Markdown | ❌ committed |

## Lint / format / test

AiGameAgent intentionally does **not** ship an ESLint or Prettier config in the root — the project's CLAUDE-local-template.md and `.claude/rules/` carry the conventions, and the team's culture is "rules in the AI's head, not in the toolchain." There's no `npm test` either; the only automated check is `npm run check:studio-e2e` (a smoke test that hits several `/api/*` routes after a dev server starts).

## Runtime ports

| Port | Service | Bind |
|------|---------|------|
| 8787 | Studio server (HTTP + WS `/ws`) | `127.0.0.1` (default) |
| 5173 | Studio web (Vite dev) | `127.0.0.1` |
| 11434 | Ollama (external) | `127.0.0.1` |
| 8000 | vLLM (optional external) | `127.0.0.1` |

> The default studio bind is `127.0.0.1`, not `0.0.0.0` — keep the studio on loopback and let a reverse proxy (or SSH tunnel) expose it.

## Environment variables

| Var | Default | Used by |
|-----|---------|---------|
| `STUDIO_PORT` | `8787` | server listen port |
| `STUDIO_HOST` | `127.0.0.1` | server bind host |
| `STUDIO_REPO_ROOT` | `process.cwd()` | server file roots (charter, preview, policy) |
| `STUDIO_LOG_PATH` | `<repo>/studio_events.jsonl` | event log path |
| `STUDIO_UPSTREAM_BASE_URL` | `http://127.0.0.1:11434/v1` | OpenAI-compatible upstream |
| `STUDIO_MODEL` | `llama3.2` | default bench model |
| `STUDIO_IMAGE_BASE_URL` | (unset → use upstream) | DALL-E / SD compatible |
| `STUDIO_IMAGE_MODEL` | `dall-e-2` | image gen model |
| `STUDIO_IMAGE_API_KEY` | (unset) | separate from upstream key |
| `STUDIO_DEBUG_PROXY_HEADERS` | `0` | log forwarded headers (auth redacted) |
| `FFMPEG_PATH` | (unset → `ffmpeg` on PATH) | video transcoder |

## Build commands

```bash
# Install (npm workspaces auto-links apps/* and packages/*)
npm install

# Dev (server + web in one terminal)
npm run dev                  # both
npm run dev:server           # only server
npm run dev:web              # only web

# Build (tsc for server, vite build for web)
npm run build

# Smoke test
npm run check:studio-e2e
```

## Next

- How the server is wired: [Studio Server](/docs/01-studio-server)
- How the Phaser office is rendered: [Studio Web](/docs/02-studio-web)
- How the 25 event types plug in: [Shared Events Bus](/docs/03-events-bus)
