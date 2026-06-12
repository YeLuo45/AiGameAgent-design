---
layout: home

hero:
  name: "AiGameAgent Studio"
  text: "Multi-Platform Mini-Game Workflow"
  tagline: "Orchestrate 30+ role-based AI agents across 7 departments to ship HTML5 page games and WeChat / Douyin mini-games — driven by OpenAI-compatible local or cloud LLMs."
  image:
    src: /hero.svg
    alt: AiGameAgent Studio — isometric office
  actions:
    - theme: brand
      text: Get Started →
      link: /architecture
    - theme: alt
      text: View on GitHub
      link: https://github.com/YeLuo45/AiGameAgent

features:
  - title: 🎮 Multi-Platform Delivery
    details: HTML5 page games, WeChat mini-games, and Douyin mini-games from a single monorepo. Engine selection (Phaser / Cocos / light canvas) and platform specialists are bundled per delivery target.
  - title: 🏢 Department-Based AI Roles
    details: 30 agents across 7 departments — Producer, Technical Director, Creative Director, Programmers, Artists, Narrative, and QA. Each agent has a .claude/agents/ frontmatter manifest and a Skill set.
  - title: 🏝️ Isometric Office Visualization
    details: Phaser-rendered Kairo-like office with desks, rooms (Meeting / Café / Arcade / Gym / Cosplay / Restroom / Pool), minimap, and a live "secretary" HUD that narrates bottlenecks and previews.
  - title: 🔌 OpenAI-Compatible Proxy
    details: The Studio server exposes a transparent /v1/* proxy to any OpenAI-compatible upstream (Ollama, vLLM, LM Studio, cloud). All chunks are parsed and broadcast as StudioEvents for real-time UI.
  - title: 📑 OpenSpec Change Control
    details: Spec-driven change workflow with versioned charter, drift detection, and three-tier model routing (save / balance / quality). Every change has a proposal.md, design.md, tasks.md, and delta spec.
  - title: 💰 Finance-Aware Telemetry
    details: Token estimation, requests, failures, and per-provider cost rollups via /api/finance/summary. Project limits grade by hardware (S / A / B / C) to throttle parallelism.
  - title: 🤖 Local-First LLM
    details: Recommended model tier is auto-derived from GPU VRAM and host RAM — 32B Q4 on 24GB+ VRAM, 7B on 8GB, 3B CPU-only. No cloud lock-in; switch with a single env var.
  - title: 🛠️ Asset Pipeline
    details: Built-in image generation (OpenAI-compatible images/generations), Sharp-based sprite sheet packing, and FFmpeg video transcoding — all routed through the same StudioEvent stream.

---

## Why AiGameAgent?

Most AI coding assistants treat a project as a single-threaded chat. AiGameAgent treats it as a **studio with departments**: a producer assigns work, a technical director routes models and timeouts, a creative director gates on preview, and specialists execute. The boss (you) opens the meeting room, writes a charter, watches the office, and saves the preview — the rest is choreography.

## Where to next?

- New here? Read [Architecture](/architecture) for the 10,000-foot view.
- Setting up your own studio? Jump to [Tech Stack](/tech-stack) then [Local LLM Integration](/docs/10-local-llm).
- Want the API surface? See [Open API Reference](/docs/13-api-reference).
- Deploying? See [Deployment](/docs/14-deployment).
