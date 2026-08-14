# M0 停机报告：StreamChunk “六变体”与协议实际七变体不符

状态：**BLOCKED — 等待上游修订规格口径**  
核对日期：2026-08-14  
双锚：npm artifacts `0.1.0-rc.6` + 源码参照 `47f943859bef60e4160492346772ded9b24f765a`

## 触发规则

任务书 `dsh-tui_任务书_v1.2.md`：

- 第 50 行称 `PartialAccumulator` 折叠“六种 `StreamChunk` 变体”。
- 第 103 行要求 transcript 实现“chunk 六变体折叠”。
- 第 120 行要求 `EVENT-SPEC.md` 写明“`StreamChunk` 六变体折叠规则”。
- 第 143 行（§7.3）规定文档与代码不符必须停机上报。
- 第 148 行（§7.8）规定语义级契约漂移必须立即停机。

## 源码参照证据

`packages/llm/llm/src/types.ts:283-303` 定义的 `StreamChunk` 是七成员判别联合：

| # | `type` | 字段 |
|---:|---|---|
| 1 | `block-start` | `index`, `blockType` |
| 2 | `text-delta` | `index`, `text` |
| 3 | `reasoning-delta` | `index`, `text` |
| 4 | `tool-call-delta` | `index`, `id`, `name?`, `argumentsDelta` |
| 5 | `block-end` | `index`, `block` |
| 6 | `usage` | `usage` |
| 7 | `finish` | `reason`, `replayState?` |

`packages/llm/llm/src/assembler.ts:49-90` 对七种类型逐一处理，证明 `usage` 与 `finish` 都是协议成员，而非测试或废弃声明。

## rc.6 artifact 证据

已下载并按 registry integrity 校验的：

`@deepseek-ai/dsh-llm@0.1.0-rc.6`  
`sha512-kuFGC8bHlzGTwlRxQhXjf3CYWl8M4NzH+EYIkrW8rri4iMc9W53xrdvkil5No/DUlMm8g1u7GdeiWYFy0TMvtA==`

其 `lib/types/types.d.ts:259-297` 同样定义上述七成员联合，和 `47f9438` 源码契约一致。这里不存在 artifact/source 漂移；不一致发生在任务书与两个锁定基准之间。

## 官方 UI 折叠语义

`packages/client/runtime/src/client/sessions/partial.ts`：

- 第 2 行注释声称 “six StreamChunk variants”，但该注释与类型及实现不一致。
- 第 14-20 行 `isVisibleAssistantChunk` 只把五种类型列为可见：`block-start`、`text-delta`、`reasoning-delta`、`tool-call-delta`、`block-end`。
- 第 49-83 行 `PartialAccumulator.push` 只对这五种更新 block。
- 第 84-87 行明确：`usage`、`finish` 和未来未知变体不改变可见 block，返回 `false`；`finish` 后随即由 `assistant/message` 取代 partial。

因此准确口径应是：

- **七种协议变体**；
- **五种可见 block 折叠变体**；
- **两种非可见变体**：`usage`（统计）与 `finish`（终止控制），transcript block fold 不产生节点，但 EVENT-SPEC 必须逐一记录其处理。

## 建议裁决

发布 v1.3，将所有“六变体”改为：

> 覆盖 StreamChunk 七种协议变体；五种可见 block 变体按 index 折叠，usage 与 finish 作为非可见统计/控制变体处理并在 EVENT-SPEC 中明载。

不建议由执行者自行猜测删去哪一种：漏掉 `reasoning-delta` 会破坏推理块；漏掉 `usage` 会影响 token 状态；漏掉 `finish` 会破坏 partial 到 finalized message 的生命周期说明。

## 本轮停机范围

- 已完成 21 个拟定直接依赖 rc.6 tarball 的下载、版本核验与 integrity 采集；未发现缺包。
- 已确认 tarball 均不含 `src/`，只将 `lib/types/*.d.ts` 用于契约审计。
- 尚未编写五份不完整的 M0 正式文档，也未写实现代码。
- 未修改共享 `D:\deepseek-harness` 工作树。
- 像素鲸 logo 的内置生成服务连续两次网络失败，未生成资产；未未经授权切换到 CLI/API-key 降级路径。
