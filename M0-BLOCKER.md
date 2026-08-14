# M0 停机报告：transcript 数据面与锁定源码不符

状态：**BLOCKED — 等待人审裁决**  
核对日期：2026-08-14  
dsh 锁定提交：`47f943859bef60e4160492346772ded9b24f765a`（本机 `D:\deepseek-harness` 的 HEAD 精确匹配）

## 触发规则

任务书 `dsh-tui_任务书_v1.0.md`：

- 第 20 行称 `ctx.sessionProjections` 是 transcript 的唯一数据源。
- 第 67 行 ADR-3 要求 TUI 直连 `sessionProjections / approval / user-questions / commands`，不复用浏览器 client runtime。
- 第 90 行要求 transcript 渲染消费 `sessionProjections`。
- 第 134 行规定发现文档与代码不符必须停机上报，不得自行发明绕过。

## 锁定源码证据

1. `packages/session/session-projection/src/types.ts:11-17`
   - `SessionProjectionMap` 是 merge-extensible 的 whole-value 投影表；基础表为空。

2. `packages/session/session-projection/src/index.ts:81-86, 93-98, 224-254`
   - `onChanged` 只报告已注册投影键的 whole-value 变化。
   - `snapshot(session)` 只返回已注册投影的 `values` 与一致性水位 `asOfSeq`。

3. 锁定提交内的生产投影注册全集（排除 tests）没有 transcript/message/events 键：
   - `packages/goal/goal/src/types.ts:103-110` → `goal`
   - `packages/host/apiproxy/src/api/sessions.ts:19-34` → `sessionListMetadata`, `imageLimits`
   - `packages/interaction/permission-presets/src/types.ts:35-42` → `permissions`
   - `packages/llm/token-meter/src/projection.ts:69-75` → `tokenUsage`, `contextPressure`, `contextBreakdown`
   - `packages/plan/plan-mode/src/types.ts:24-26` → `plan`
   - `packages/session/session-stats/src/types.ts:42-44` → `sessionStats`
   - `packages/session/session-title/src/types.ts:16-22` → `title`
   - `packages/subagent/subagent/src/projection-types.ts:50-62` → `subagentTiming`, `subagent`
   - `packages/todo/tool-todo/src/types.ts:16-22` → `todos`

4. transcript 的实际数据路径是事件日志，而非上述投影：
   - `packages/core/session/src/index.ts:66-76` 定义实时的 `session/event(session, event)` 发布面。
   - `packages/core/session/src/index.ts:553-562` 暴露不可变 `session.events` 历史快照。
   - `packages/client/runtime/src/client/sessions/session.ts:469` 消费 `session/event` 帧。
   - `packages/client/runtime/src/client/sessions/partial.ts:1-22` 明确用 `assistant/chunk` 累积流式 assistant 内容。
   - `packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts:81,186,249,263` 从 `assistant/chunk` 构建 transcript 节点。

因此，单独消费 `ctx.sessionProjections` 无法满足 AC-3（流式回答、工具调用节点）或 AC-5（历史 transcript 完整重放）。

## 需要人审裁决的架构分叉

### A（建议）：修订 ADR-3，transcript 使用核心 Session 事件面

- 历史：`session.events`
- 实时：`ctx.on('session/event', ...)`，按目标 agent/session scope 过滤
- 辅助状态：继续使用 `ctx.sessionProjections.snapshot/onChanged`
- 代价：任务书第 20/67/90 行需改；但不修改内核，也不引入网络或浏览器 runtime，并与官方 web 的事件语义一致。

### B：TUI 插件自行注册一个 transcript whole-value 投影

- 通过 declaration merge 增加 TUI 私有 projection key，再 fold 所有 session events。
- 代价：每个流式 chunk 都产生整份 transcript whole-value，5k 行场景复制/校验/通知成本高；这不是锁定源码中已存在的 host seam，也会把 UI 形态的数据塞进通用投影层，与该层的职责边界冲突。

### C：等待上游新增官方 transcript projection

- 代价：当前锁定 commit 无法实现，且违反本任务锁版本、不得顺手升级的规则。

## 停机范围

- 未创建或修改任何产品实现代码。
- 未修改 `D:\deepseek-harness`（该仓库现有工作树改动属于其他参赛者）。
- 未下载或重装 dsh。
- 因硬停机发生在接口勘察期间，`INTERFACES.md`、`UX-SPEC.md`、`SPIKE.md` 尚不能在“无待确认项”的条件下完成；Ink spike 与 npm 可装性检查未继续执行。
