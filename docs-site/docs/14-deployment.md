# 14 · 部署

Studio 服务端是一个独立的 Node.js 进程。部署就是"在一台具备正确环境变量和可达 LLM 上游的机器上把它跑起来"。本章覆盖团队使用的三种部署模式：**本地开发**、**局域网 / 预发布**、**容器化**。

## 模式一：本地开发（默认）

```bash
# 1. 克隆
git clone https://github.com/YeLuo45/AiGameAgent
cd AiGameAgent

# 2. 安装（npm workspaces 会自动 link apps/* 和 packages/*）
npm install

# 3. 配置
cp .env.example .env
# 按需编辑 .env

# 4. 一个终端同时启动 server 和 web
npm run dev
# → server 监听 http://127.0.0.1:8787
# → web    监听 http://127.0.0.1:5173

# 5. 也可以分别启动
npm run dev:server
npm run dev:web

# 6. 烟雾测试
npm run check:studio-e2e
```

> 回环绑定（`127.0.0.1`）是**有意为之**——除非你已了解其影响，否则请将工作室保留在回环上。详见下方 [安全说明](#安全说明)。

### 前置依赖

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 20 | ESM 模块、原生 `node:http` |
| npm | ≥ 10 | Node 20 自带 |
| Ollama | latest | 默认上游；如果用云端则不是必须 |
| (可选) ffmpeg | latest | 仅用于视频转码 |
| (可选) PowerShell | 5+ | 仅 Windows —— 用于 GPU 检测 |

### 环境变量

| Var | Default | Notes |
|-----|---------|-------|
| `STUDIO_PORT` | `8787` | 服务端监听端口 |
| `STUDIO_HOST` | `127.0.0.1` | 服务端绑定地址 |
| `STUDIO_REPO_ROOT` | `process.cwd()` | 文件根目录（charter、preview、policy） |
| `STUDIO_LOG_PATH` | `<repo>/studio_events.jsonl` | 事件日志路径 |
| `STUDIO_UPSTREAM_BASE_URL` | `http://127.0.0.1:11434/v1` | OpenAI 兼容上游 |
| `STUDIO_MODEL` | `llama3.2` | 默认基准测试模型 |
| `STUDIO_IMAGE_BASE_URL` | （未设置 → 上游） | 图像生成端点 |
| `STUDIO_IMAGE_MODEL` | `dall-e-2` | 图像生成模型 |
| `STUDIO_IMAGE_API_KEY` | （未设置） | 可选的独立 key |
| `STUDIO_DEBUG_PROXY_HEADERS` | `0` | `1` = 记录转发的头（auth 会被脱敏） |
| `FFMPEG_PATH` | （未设置 → PATH 中的 `ffmpeg`） | 视频转码器路径 |

## 模式二：局域网 / 预发布

要把工作室暴露到局域网，设置 `STUDIO_HOST=0.0.0.0`：

```bash
STUDIO_HOST=0.0.0.0 \
STUDIO_PORT=8787 \
STUDIO_UPSTREAM_BASE_URL=http://192.168.1.50:11434/v1 \
npm run dev:server
```

**暴露到局域网之前的安全清单：**

- [ ] 在前端放置反向代理（nginx / caddy）以提供 TLS
- [ ] 在代理层加上 Basic Auth 或 OIDC
- [ ] 设置 `STUDIO_DEBUG_PROXY_HEADERS=0`
- [ ] 确认 `.env` 没有被提交（`git status` 不应出现它）
- [ ] 确认 `production/` 已被 gitignore（默认就是）
- [ ] 考虑在代理层做限流

示例 nginx 配置：

```nginx
server {
  listen 443 ssl;
  server_name studio.example.com;

  ssl_certificate     /etc/letsencrypt/live/studio.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/studio.example.com/privkey.pem;

  # 可选：Basic Auth
  auth_basic "Studio";
  auth_basic_user_file /etc/nginx/.htpasswd;

  # WebSocket 升级
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 600s;  # 长跑的 SSE
  }
}
```

## 模式三：容器化（Docker）

一个最小化的 Dockerfile：

```dockerfile
FROM node:20-slim

# 可选：用于视频转码的 ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装依赖
COPY package.json package-lock.json ./
COPY apps/studio-server/package.json apps/studio-server/
COPY apps/studio-web/package.json apps/studio-web/
COPY packages/shared/package.json packages/shared/
RUN npm install --omit=dev --no-audit --no-fund

# 构建 server（tsc）和 web（vite）
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY apps/studio-server/ apps/studio-server/
COPY apps/studio-web/ apps/studio-web/
RUN cd apps/studio-server && npx tsc -p tsconfig.json
RUN cd apps/studio-web && npx vite build

# 运行时
ENV STUDIO_HOST=0.0.0.0
ENV STUDIO_PORT=8787
EXPOSE 8787
CMD ["sh", "-c", "cd apps/studio-server && node dist/index.js"]
```

构建并运行：

```bash
docker build -t aigameagent-studio:latest .
docker run -p 8787:8787 -p 5173:5173 \
  -e STUDIO_UPSTREAM_BASE_URL=http://host.docker.internal:11434/v1 \
  -v $(pwd)/production:/app/production \
  aigameagent-studio:latest
```

`-v` 挂载会持久化 `production/`（charter、policy、preview）在多次运行间的内容。

> `host.docker.internal` 这个 DNS 在 Docker Desktop（Win/Mac）上可用，用于访问宿主机上的 Ollama。在 Linux 上，请改用 `--network host` 或显式传入宿主机 IP。

## 反向代理 + LLM 网关

生产环境推荐如下拓扑：

```mermaid
flowchart LR
  U[👤 老板浏览器] -->|HTTPS| N[nginx / caddy]
  N -->|http| S[Studio server :8787]
  S -->|http| O[Ollama / vLLM :11434]
  S -.optional.->|https| C[OpenAI / DeepSeek]
  N -.optional.->|WSS| S
```

如果你在 LLM 前面再放一个网关（例如 LiteLLM、OpenRouter），把 `STUDIO_UPSTREAM_BASE_URL` 指向网关即可：

```
STUDIO_UPSTREAM_BASE_URL=https://gateway.example.com/openai/v1
```

工作室对此并不在意——任何兼容 OpenAI 的实现都可以。

## WebSocket 相关

`/ws` 升级需要：

- HTTP/1.1（绝大多数代理都支持）
- `Connection: upgrade` 和 `Upgrade: websocket` 头需要透传
- 较长的读超时（SSE 流可能跑数分钟）

nginx：

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 600s;
```

Caddy：

```caddyfile
reverse_proxy studio:8787 {
  transport http {
    keepalive 600s
  }
}
```

## 监控

工作室会向 `studio_events.jsonl` 输出事件。要实时监控：

```bash
# 跟踪事件
tail -f studio_events.jsonl | jq -c '{ts, type, agentId, .payload.ok}'

# 统计最近一小时按 type 的数量
tail -n 5000 studio_events.jsonl | jq -r .type | sort | uniq -c | sort -rn

# 查找失败的 job
jq -c 'select(.type == "job.failed" or (.type == "job.finished" and .payload.ok == false))' studio_events.jsonl
```

要做外部监控，把 Prometheus exporter 指向 `/api/finance/summary?range=today`（1 分钟一次抓取就够用）。

## 安全说明

- **默认回环**：`STUDIO_HOST=127.0.0.1` 让工作室不进入网络。除非你已经搭好带鉴权的反向代理，否则不要修改它。
- **无内建鉴权**：工作室**不**对客户端进行认证。请在代理层加入鉴权。
- **路径穿越**：项目 ID 在任何文件 I/O 之前已被规整为 `[a-zA-Z0-9_-]`。
- **脱敏**：`Authorization` 头在任何调试日志中都会被替换为 `Bearer ***`（`STUDIO_DEBUG_PROXY_HEADERS=1`）。
- **没有 eval / 动态 require**：所有模块均为静态 import。
- **`.env` 已被 gitignore**：请保持这一点。仓库自带的 `.env.example` 给出 schema 但不包含任何真实 key。
- **`production/` 已被 gitignore**：永远不要提交运行时状态。

## 备份

无需停服即可备份工作室的运行时状态：

```bash
# charter + policy + model-routing + hire roster
tar -czf backup-$(date +%Y%m%d).tar.gz \
  production/charter/ \
  production/policy.json \
  production/model-routing.json \
  production/studio-hired.json \
  studio_events.jsonl
```

preview 目录可能很大；如果要备份，建议只备份 `production/preview/<pid>/index.html` 而不是完整历史。

## 升级

```bash
# 拉取最新代码
git pull

# 重新安装
npm install

# 重启（手动）
# Ctrl-C 终止 dev 进程，然后再次执行 npm run dev
```

磁盘上的 schema 向前兼容：旧的 `state.json` 文件会以 `??` 默认值读取，因此降级通常是安全的。

## 接下来

- [技术栈](/tech-stack) —— 精确的库版本
- [Studio 服务端](/docs/01-studio-server) —— 服务端的功能介绍
- [开放 API 参考](/docs/13-api-reference) —— 全部端点合集
