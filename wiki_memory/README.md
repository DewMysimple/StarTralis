---
type: moc
status: active
updated: 2026-10-31
topic: memory-entry
sources:
  - "AGENTS.md"
  - "wiki_memory/.memory.json"
  - "用户指令：2026-10-30 明确要求构建标准工程记忆"
---

# 工程记忆导航

模式：`standard`，由用户于 2026-10-30 指定。虽然这是单一前端作品，仍按用户要求保留五页实质状态与六类日志目录；当前布局以 [.memory.json](.memory.json) 为准。

新会话依次读取本页、[维护协议](AGENTS.md)、[项目概览](当前状态/项目概览.md)、[当前约束](当前状态/当前约束.md)、[当前待办](当前状态/当前待办.md)。涉及渲染与验收时再定位架构、问题和相关决策；需要追溯来由时查日志，不通读历史。

项目运行说明见 [README.md](../README.md)。本页只负责导航，不复制状态页的技术事实与待办。

日常开发直接遵循项目内协议，不调用 wiki-memory Skill；仅用户明确要求记忆管理时使用 Skill。

- [记忆维护协议](AGENTS.md)
- [工作日志 MOC](日志/MOC_工作日志.md)

按主题搜索：`rg -n "关键词" wiki_memory/当前状态 wiki_memory/决策 wiki_memory/日志`。新增页面或导航条目后统一运行一次 `python "wiki_memory/工具/memory.py" index --project . --apply`；记忆正文有修改时按维护协议选择检查命令。

<!-- wiki-memory:auto:start -->

## 当前状态

- [[当前状态/已知问题.md|已知问题]] — active
- [[当前状态/当前待办.md|当前待办]] — active
- [[当前状态/当前约束.md|当前约束]] — active
- [[当前状态/系统架构.md|系统架构]] — active
- [[当前状态/项目概览.md|项目概览]] — active

- [[决策/MOC_决策.md|工程决策目录]] — 2 页，按主题或模块检索。

<!-- wiki-memory:auto:end -->
