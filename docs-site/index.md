---
layout: home

hero:
  name: "AiGameAgent Studio"
  text: "多端小游戏工作流"
  tagline: "在 7 个部门里调度 30+ 个角色化 AI Agent，量产 HTML5 页面游戏以及微信 / 抖音小游戏——由 OpenAI 兼容的本地或云端大模型驱动。"
  image:
    src: /hero.svg
    alt: AiGameAgent Studio — 等距办公室
  actions:
    - theme: brand
      text: 快速上手 →
      link: /architecture
    - theme: alt
      text: 在 GitHub 上查看
      link: https://github.com/YeLuo45/AiGameAgent

features:
  - title: 🎮 多端交付
    details: "一个 monorepo 同时产出 HTML5 页面游戏、微信小游戏和抖音小游戏。引擎选型（Phaser / Cocos / 轻量 canvas）以及平台专员按交付目标打包。"
  - title: 🏢 部门化 AI 角色
    details: "横跨 7 个部门的 30 个 Agent——Producer、Technical Director、Creative Director、Programmers、Artists、Narrative 和 QA。每个 Agent 都有 .claude/agents/ 形式的 frontmatter 清单与一套 skill。"
  - title: 🏝️ 等距办公室可视化
    details: "Phaser 渲染的 Kairo 风格办公室，配有工位、会议室（Meeting / Café / Arcade / Gym / Cosplay / Restroom / Pool）、小地图以及一个实时播报瓶颈和预览进度的 secretary HUD。"
  - title: 🔌 OpenAI 兼容代理
    details: "Studio 服务端对外暴露一个透明的 /v1/* 代理，指向任何 OpenAI 兼容上游（Ollama、vLLM、LM Studio、云端）。所有流式分片都被解析后以 StudioEvent 形式广播，驱动实时 UI。"
  - title: 📑 OpenSpec 变更控制
    details: "规范驱动的变更工作流，带版本化章程、漂移检测以及三层模型路由（save / balance / quality）。每一次变更都包含 proposal.md、design.md、tasks.md 以及增量规范。"
  - title: 💰 财务感知遥测
    details: "通过 /api/finance/summary 提供 token 估算、请求数、失败数以及按提供方汇总的成本。项目上限按硬件等级（S / A / B / C）分级，以限制并发度。"
  - title: 🤖 本地优先大模型
    details: "推荐的模型档位由 GPU 显存与宿主机内存自动推导——24GB+ 显存跑 32B Q4，8GB 跑 7B，纯 CPU 跑 3B。无云端锁定，只需一个环境变量即可切换。"
  - title: 🛠️ 资源管线
    details: "内置图像生成（OpenAI 兼容 images/generations）、基于 Sharp 的雪碧图打包以及 FFmpeg 视频转码——全部走同一条 StudioEvent 流。"

---

## 为什么选择 AiGameAgent？

大多数 AI 编程助手把项目当成单线程对话。AiGameAgent 把它当成一座**有部门划分的 Studio**：Producer 分派任务，Technical Director 路由模型与超时，Creative Director 卡住预览关口，专家负责执行。老板（你）打开会议室、写一份章程、盯住办公室、保存预览——剩下的都是编排。

## 接下来去哪里？

- 第一次接触？阅读 [架构](/architecture) 了解全局视图。
- 想搭建自己的工作室？直接跳到 [技术栈](/tech-stack) 然后看 [本地大模型集成](/docs/10-local-llm)。
- 想看 API？阅读 [开放 API 参考](/docs/13-api-reference)。
- 要部署？看 [部署](/docs/14-deployment)。
