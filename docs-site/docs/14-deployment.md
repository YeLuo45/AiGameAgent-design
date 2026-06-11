# 14 · Deployment

The Studio server is a single Node.js process. Deployment is "run it on a host with the right env vars and a reachable LLM upstream". This page covers the three deployment modes the team uses: **local dev**, **LAN / staging**, and **containerized**.

## Mode 1: Local dev (the default)

```bash
# 1. Clone
git clone https://github.com/YeLuo45/AiGameAgent
cd AiGameAgent

# 2. Install (npm workspaces auto-link apps/* and packages/*)
npm install

# 3. Configure
cp .env.example .env
# Edit .env if needed

# 4. Start both server and web in one terminal
npm run dev
# → server on http://127.0.0.1:8787
# → web   on http://127.0.0.1:5173

# 5. Or start them separately
npm run dev:server
npm run dev:web

# 6. Smoke test
npm run check:studio-e2e
```

> Loopback bind (`127.0.0.1`) is **deliberate** — keep the studio on loopback unless you understand the implications. See [Security notes](#security-notes) below.

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 20 | ESM modules, native `node:http` |
| npm | ≥ 10 | bundled with Node 20 |
| Ollama | latest | default upstream; not required if you use cloud |
| (optional) ffmpeg | latest | only for video transcoding |
| (optional) PowerShell | 5+ | Windows only — used for GPU detection |

### Environment variables

| Var | Default | Notes |
|-----|---------|-------|
| `STUDIO_PORT` | `8787` | server listen port |
| `STUDIO_HOST` | `127.0.0.1` | server bind host |
| `STUDIO_REPO_ROOT` | `process.cwd()` | file roots (charter, preview, policy) |
| `STUDIO_LOG_PATH` | `<repo>/studio_events.jsonl` | event log path |
| `STUDIO_UPSTREAM_BASE_URL` | `http://127.0.0.1:11434/v1` | OpenAI-compatible upstream |
| `STUDIO_MODEL` | `llama3.2` | default bench model |
| `STUDIO_IMAGE_BASE_URL` | (unset → upstream) | image-gen endpoint |
| `STUDIO_IMAGE_MODEL` | `dall-e-2` | image-gen model |
| `STUDIO_IMAGE_API_KEY` | (unset) | optional separate key |
| `STUDIO_DEBUG_PROXY_HEADERS` | `0` | `1` = log forwarded headers (auth redacted) |
| `FFMPEG_PATH` | (unset → `ffmpeg` on PATH) | video transcoder path |

## Mode 2: LAN / staging

To expose the studio on a LAN, set `STUDIO_HOST=0.0.0.0`:

```bash
STUDIO_HOST=0.0.0.0 \
STUDIO_PORT=8787 \
STUDIO_UPSTREAM_BASE_URL=http://192.168.1.50:11434/v1 \
npm run dev:server
```

**Security checklist before exposing LAN:**

- [ ] Place a reverse proxy (nginx / caddy) in front for TLS
- [ ] Add basic auth or OIDC at the proxy layer
- [ ] Set `STUDIO_DEBUG_PROXY_HEADERS=0`
- [ ] Verify `.env` is not committed (`git status` should not show it)
- [ ] Verify `production/` is gitignored (it is, by default)
- [ ] Consider rate-limiting at the proxy

Example nginx config:

```nginx
server {
  listen 443 ssl;
  server_name studio.example.com;

  ssl_certificate     /etc/letsencrypt/live/studio.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/studio.example.com/privkey.pem;

  # Optional: basic auth
  auth_basic "Studio";
  auth_basic_user_file /etc/nginx/.htpasswd;

  # WebSocket upgrade
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 600s;  # long-running SSE
  }
}
```

## Mode 3: Containerized (Docker)

A minimal Dockerfile:

```dockerfile
FROM node:20-slim

# Optional: ffmpeg for video transcoding
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps
COPY package.json package-lock.json ./
COPY apps/studio-server/package.json apps/studio-server/
COPY apps/studio-web/package.json apps/studio-web/
COPY packages/shared/package.json packages/shared/
RUN npm install --omit=dev --no-audit --no-fund

# Build server (tsc) and web (vite)
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY apps/studio-server/ apps/studio-server/
COPY apps/studio-web/ apps/studio-web/
RUN cd apps/studio-server && npx tsc -p tsconfig.json
RUN cd apps/studio-web && npx vite build

# Runtime
ENV STUDIO_HOST=0.0.0.0
ENV STUDIO_PORT=8787
EXPOSE 8787
CMD ["sh", "-c", "cd apps/studio-server && node dist/index.js"]
```

Build & run:

```bash
docker build -t aigameagent-studio:latest .
docker run -p 8787:8787 -p 5173:5173 \
  -e STUDIO_UPSTREAM_BASE_URL=http://host.docker.internal:11434/v1 \
  -v $(pwd)/production:/app/production \
  aigameagent-studio:latest
```

The `-v` mount persists `production/` between runs (charter, policy, preview).

> The `host.docker.internal` DNS works on Docker Desktop (Win/Mac) to reach the host's Ollama. On Linux, use `--network host` or pass the host's IP explicitly.

## Reverse proxy + LLM gateway

For production, the recommended topology is:

```mermaid
flowchart LR
  U[👤 Boss browser] -->|HTTPS| N[nginx / caddy]
  N -->|http| S[Studio server :8787]
  S -->|http| O[Ollama / vLLM :11434]
  S -.optional.->|https| C[OpenAI / DeepSeek]
  N -.optional.->|WSS| S
```

If you put a gateway (e.g. LiteLLM, OpenRouter) in front of the LLM, point `STUDIO_UPSTREAM_BASE_URL` at the gateway:

```
STUDIO_UPSTREAM_BASE_URL=https://gateway.example.com/openai/v1
```

The studio doesn't care — anything that speaks OpenAI compat is fine.

## WebSocket considerations

The `/ws` upgrade requires:

- HTTP/1.1 (most proxies)
- `Connection: upgrade` and `Upgrade: websocket` headers passed through
- A long read timeout (SSE streams can run minutes)

nginx:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 600s;
```

Caddy:

```caddyfile
reverse_proxy studio:8787 {
  transport http {
    keepalive 600s
  }
}
```

## Monitoring

The studio emits events to `studio_events.jsonl`. To monitor in real time:

```bash
# Tail events
tail -f studio_events.jsonl | jq -c '{ts, type, agentId, .payload.ok}'

# Count by type over the last hour
tail -n 5000 studio_events.jsonl | jq -r .type | sort | uniq -c | sort -rn

# Find failed jobs
jq -c 'select(.type == "job.failed" or (.type == "job.finished" and .payload.ok == false))' studio_events.jsonl
```

For external monitoring, point a Prometheus exporter at `/api/finance/summary?range=today` (1-min scrape interval is fine).

## Security notes

- **Loopback default**: `STUDIO_HOST=127.0.0.1` keeps the studio off the network. Don't change this unless you've added a reverse proxy with auth.
- **No built-in auth**: the studio does **not** authenticate clients. Add auth at the proxy layer.
- **Path traversal**: project IDs are sanitised to `[a-zA-Z0-9_-]` before any file I/O.
- **Redaction**: `Authorization` headers are replaced with `Bearer ***` in any debug log (`STUDIO_DEBUG_PROXY_HEADERS=1`).
- **No eval / dynamic require**: all modules are statically imported.
- **`.env` is gitignored**: keep it that way. The shipped `.env.example` shows the schema but no real keys.
- **`production/` is gitignored**: never commit the runtime state.

## Backing up

To back up the studio's runtime state without stopping the server:

```bash
# Charter + policy + model-routing + hire roster
tar -czf backup-$(date +%Y%m%d).tar.gz \
  production/charter/ \
  production/policy.json \
  production/model-routing.json \
  production/studio-hired.json \
  studio_events.jsonl
```

The preview tree can grow large; if you back it up, prefer `production/preview/<pid>/index.html` over the full history.

## Upgrading

```bash
# Pull latest
git pull

# Re-install
npm install

# Restart (manual)
# Ctrl-C the dev process, then `npm run dev` again
```

The on-disk schema is forward-compatible: older `state.json` files are read with `??` defaults, so downgrades are usually safe.

## Next

- [Tech Stack](/tech-stack) — exact library versions
- [Studio Server](/docs/01-studio-server) — what the server does
- [Open API Reference](/docs/13-api-reference) — every endpoint in one table
