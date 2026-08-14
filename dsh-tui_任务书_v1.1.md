# dsh-tui 任务书 v1.1

**派发对象**：Codex CLI ｜ **上游架构**：Claude ｜ **日期**：2026-08-14

**一句话目标**：为 DeepSeek Harness（dsh，v0.1 developer preview）构建一个 Grok Build 风格的全屏终端界面，作为**同进程 dsh App 插件**交付，通过 `dsh --profile tui` 启动。**内核零改动，只换 UI 面**。

## 变更记录 v1.0 → v1.1

针对 M0 停机报告《transcript 数据面与锁定源码不符》的裁决。报告所引四组证据经上游对同一 commit 复核，**全部属实**，v1.0 的事实错误在上游（把投影层"渲染无关"过度引申为"transcript 走投影"）。

1. **裁决：采纳方案 A。** transcript 改走 core Session 事件面（`session.events` 历史 + `session/event` 实时）；`ctx.sessionProjections` 降为辅助状态源。方案 B 驳回：whole-value 规则使 transcript 投影每 chunk 复制整份视图，O(n²)，且把 UI 形态数据塞进通用投影层；方案 C 驳回：违反锁版本守则。
2. §1.1 数据面事实全面更正，补充上游复核出的新证据（seq 连续性契约、scope 过滤分发）。
3. ADR-3 改为**双轨数据面**；M0 新增交付物 `EVENT-SPEC.md`；新增 AC-8（折叠确定性与幂等）。
4. 状态栏字段由"待核实"落定为已确认投影键清单。
5. 工程守则新增：本机 dsh 检出仅作只读参考（工作树内有他人改动，严禁落任何文件）。

其余条款与 v1.0 一致。**本文件整体取代 v1.0。M0 解除停机，按新增交付物续跑。**

---

## 1. 已确认事实（上游已实勘两侧源码，非猜测）

以下事实来自对两个仓库锁定 commit 的直接勘察与 M0 停机报告的交叉复核。**引用时以仓库内文件为准，不得凭训练记忆补写 API。**

### 1.1 dsh 侧

- 仓库：`github.com/deepseek-ai/deepseek-harness`，**锁定 commit `47f943859bef60e4160492346772ded9b24f765a`**（2026-08-13）。MIT 协议。pnpm monorepo，TypeScript。
- 顶层结构：`apps/{cli,web}`；`packages/*/*` 两级包族；bundle 三件套 `packages/bundle/{base,headless,web-app}`。
- **官方架构已为 TUI 预留位置**：`apps/cli/README.md` 中明文示例 `dsh --profile tui --resume <id>`。启动器只解析自己的 flag，其余整体交给 profile 内注入的 app 插件，经 `dsh-cmdline`（`packages/boot/cmdline`）快照解析。
- **headless bundle 是结构模板**：`packages/bundle/headless/`——`cordis.patch.yml` 展示 app 插件声明范式：startup provider 从 `cmdlineArgs` 解析应用参数 → runner 插件 `inject` 该 provider 并驱动 core registry。TUI bundle 照此结构，把"一次性打印结果"换成"交互式渲染循环"。

**transcript 数据面 = core Session 事件面（v1.1 更正，双侧核实）：**

- `packages/core/session/src/index.ts:76`：`'session/event'(this: Scoped<Session>, session, event)` —— post-commit、fire-and-forget 的追加事件流。**scope 过滤分发**：agent-scoped 监听器只收到经该 agent 上下文进入的会话的事件（TUI 作为持有 agent 上下文的 app，天然获得干净过滤）。观察者异常被记录并隔离，不影响已提交追加。
- `packages/core/session/src/index.ts:559` 附近：`session.events` —— append-only 日志的不可变快照，深冻结，快照数组不会事后增长。
- **seq 连续性契约**：`session.seq === log.length`（同文件 564 行附近注释原文 "the `seq = log.length` contiguity contract"）；事件自带单调 `seq: number`（`packages/core/session/src/types.ts:407-408`）。→ 历史折叠 + 实时订阅的接缝协议因此极简：先挂监听，再读 `session.events`，凡 `event.seq < events.length` 的实时事件一律丢弃，去重天然幂等。
- 归并语义存在：`assistant/message` 事件引用构成它的 `assistant/chunk` 源 seq 集（types.ts:383,426 附近）——折叠器必须处理 chunk→message 的替换归并。
- **参照折叠语义（只读镜像，禁止 import）**：`packages/client/runtime/src/client/sessions/partial.ts` 的 `PartialAccumulator` 把六种 `StreamChunk` 变体折叠为按 block index 键控的 `AssistantBlock[]`，block 级不可变；**注意 block-start 可能乱序到达，稀疏数组留洞待归并**。`packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts` 从 `assistant/chunk` 构建 transcript 节点。web 官方 UI 即以此路径渲染——TUI 与其同源同义。

**`ctx.sessionProjections` 的真实定位（v1.1 更正）：**

- 辅助状态投影注册表，**不含 transcript**。基础表为空且 merge-extensible（`packages/session/session-projection/src/types.ts:18`：`export interface SessionProjectionMap {}`）。
- 锁定 commit 生产注册键全集（双侧核实一致）：`goal`、`sessionListMetadata`、`imageLimits`、`permissions`、`tokenUsage`、`contextPressure`、`contextBreakdown`、`plan`、`sessionStats`、`title`、`subagentTiming`、`subagent`、`todos`。
- 消费面：`onChanged(listener)` 变更推送 + `snapshot(session)` 一致性快照（`asOfSeq` 水位）。whole-value 规则（README："state-carrying log event MUST carry the complete post-change state"）正是 transcript 不该做成投影的原因。

**其余接缝（v1.0 结论不变）：**

- `ctx.approval`（`packages/interaction/user-approval/`）：waterfall answerer，"one terminal answerer per deployment"，TUI 注册交互式 answerer 即接管审批；fail closed。
- `packages/interaction/` 族：`user-questions`、`commands`、`permission-presets`、`tool-ask-user`。
- wire 协议（v1 不用，仅备案）：`packages/client/connection/`——HTTP POST unary + 双 WS 下行，存在同进程 carrier。远程 attach 属 v2。
- **ACP 路线已排除**：`packages/acp/acp/` README 明言 automation-only、非 UI 接缝。
- 包已发布 npm（`@deepseek-ai/dsh-*`，`0.1.0-rc.x`）→ out-of-tree 可行（M0 逐包核实，此项在停机时未完成，续跑）。
- 官方警示：v0.1 接口"预计快速迭代"。

### 1.2 grok-build 侧

- 仓库：`github.com/xai-org/grok-build`，**锁定 commit `eb267feff13129e568df38fb6fdf0ceb65f735d6`**（2026-08-13）。Apache-2.0。Rust cargo workspace。
- TUI 实体：`crates/codegen/xai-grok-pager`（及 `-bin`/`-diff`/`-render`/`-minimal`/`-pty-harness`），ratatui + crossterm，全屏、鼠标交互。
- **UX 规格唯一来源**：`crates/codegen/xai-grok-pager/docs/user-guide/` 共 24 篇。直接相关：`03-keyboard-shortcuts`、`04-slash-commands`、`06-theming`、`17-sessions`、`19-plan-mode`、`21-terminal-support`、`22-permissions-and-safety`、`23-dashboard`。
- 已确认交互语汇：`/` 唤起模糊匹配命令菜单（shell/pager 两源合流、冲突打 badge）；Shift+Tab 轮换会话模式；`/model`、`/plan`、`/view-plan`、`/auto`、`/always-approve`、`/workflows`。完整键位表 M0 从 03 号文档提炼。

### 1.3 根本约束

两侧语言不同（Rust vs TypeScript）。**UX 移植，不是代码移植**。若确需逐字搬运 grok-build 文案/资源，NOTICE 登记（Apache-2.0）；正常不应发生。

---

## 2. 目标 / 非目标

**目标（v1）**

1. `dsh --profile tui` 启动全屏 TUI，在真实项目目录完成一整轮编码任务：提问 → 流式回答 → 工具调用 → 审批 → 结果落盘。
2. Grok Build 核心交互语汇成立：全屏 alt-screen、斜杠命令菜单、审批提示、会话续接/切换、plan 状态呈现、主题。
3. 中文（CJK）输入与渲染完全正确——硬验收。
4. 内核零改动：`packages/`、`apps/web`、`vendor/` 一行不碰。

**非目标（v1 明确不做）**

- 远程 attach 运行中的 `dsh web` host（v2）。
- 鼠标完备交互（P2；键盘必须完备）。
- 复刻 web settings 全集（复杂配置指路 `dsh web`）。
- ACP / 编辑器嵌入。
- 为 UI 便利新增/修改内核能力。**grok 有而 dsh 内核无的功能一律降级或砍掉。**
- 多会话并行渲染/未读角标（v1 单活动会话，切换即重挂快照+订阅；多会话感知 P2）。

---

## 3. 架构决策（ADR）

| # | 决策 | 结论 | 依据 |
|---|---|---|---|
| ADR-1 | 集成路线 | **同进程 App 插件**：新 bundle `dsh-tui-app`（base + tui 应用插件），经 profile 启动 | 官方 CLI 语法预留；headless 先例；零网络面；审批 answerer 天然挂 host 侧 |
| ADR-2 | 代码栖身处 | **独立仓库 out-of-tree 插件包**，`dsh plugin --profile tui` 装入；dsh 依赖锁死确切 rc 版本。**回退**：fork 内新增目录，既有文件 `git diff` 必须为空 | profile 机制官方支持 out-of-tree；内核零改动结构性成立 |
| ADR-3（v1.1 修订） | 数据面 | **双轨**：① transcript = 事件面——历史 `session.events` + 实时 `'session/event'`（agent scope 过滤），seq 键控幂等折叠，TUI 自有纯函数折叠模块 `transcript-fold`；② 辅助状态 = 投影面 `snapshot/onChanged`（§1.1 确认键清单）。仍不复用浏览器 client runtime 与 React slot 系统；web 折叠逻辑仅作参照语义（读 `partial.ts` 与 `ui-conversation`，镜像事件类型覆盖，**不 import 任何 `@deepseek-ai/dsh-client-*`**） | M0 停机报告 + 上游复核；seq 契约使去重协议极简；与官方 web 同源同义 |
| ADR-4 | 渲染栈 | **默认 Ink**。M0 spike 四条硬指标任一不达即换自绘 ANSI：① alt-screen 全屏+resize；② truecolor 及 256 色降级；③ CJK wcwidth 断行正确；④ Windows Terminal 行为一致 | TS 生态内最成熟；ratatui 无 TS 等价物，不强求同库 |
| ADR-5 | UX 参照边界 | grok user-guide 为规格源，经术语映射表翻译到 dsh 能力，逐条标注 采纳/降级/砍掉 | 见 1.2/1.3 |

**ADR-5 术语映射（初版，M0 补全）**

| grok 概念 | dsh 对应 | v1 处置 |
|---|---|---|
| plan mode / `/plan` `/view-plan` | `packages/plan`（`plan` 投影键已确认） | 采纳：状态呈现+退出；门禁语义以 dsh 实际行为为准 |
| `/model` | dsh 模型选择服务 | 采纳 |
| Shift+Tab 模式轮换 | permission preset / agent preset 切换（`permissions` 投影键已确认） | 采纳（轮换对象按 dsh 语义重定义） |
| `/auto` `/always-approve` | `user-approval` 策略 + `permission-presets` | 映射到 dsh 实际策略集，不发明新策略 |
| `/workflows` 面板 | `packages/workflow`、`packages/jobs` | 降级：v1 列表视图，P1 |
| subagent 导航 | `subagent`/`subagentTiming` 投影 + subagent 相关事件 | 降级：折叠树，P1 |
| 鼠标交互 | — | P2 |

---

## 4. v1 功能范围

**P0（验收必备）**

1. 会话生命周期：新建、`--resume <id>` 续接、会话内列表切换（`sessionListMetadata`、`title` 投影可用）。
2. transcript 渲染（v1.1 改写）：`transcript-fold` 纯函数模块消费事件面——流式 `assistant/chunk` 六变体折叠、chunk→message 归并替换、乱序 block-start 留洞处理、工具调用生命周期折叠树、diff 视图；**未知事件类型渲染为可折叠 raw 占位节点，绝不崩溃**。
3. 输入区：多行编辑、`/` 命令菜单（接 `commands` 服务 + TUI 本地 `/quit` `/theme` `/help` `/keys`）、`@` 文件引用视 dsh 服务支持情况接入或砍。
4. 审批：终端 answerer，渲染工具名/参数摘要/diff，y/n/预设升级按 dsh 策略集。
5. user-questions：表单化渲染与回传。
6. 状态栏（v1.1 落定）：model、cwd、会话 id/`title`、approval 策略（`permissions`）、`tokenUsage`、`contextPressure`、`sessionStats` 摘要；`plan`、`todos` 状态徽标。金额费用不在确认键内——**不造数据，无则不显**。
7. CJK：输入、渲染、断行、光标定位全正确。

**P1**：主题系统（06-theming 思路，≥2 内置）、键位帮助页、workflow/jobs 列表、subagent 折叠树、Windows Terminal CI。
**P2**：鼠标、会话搜索、多会话感知。

---

## 5. 里程碑与人审停机点

每个 STOP 处停机等人审，不得自行越过。

| 阶段 | 内容 | 产出物 | 验收 |
|---|---|---|---|
| **M0 勘察+spike**（续跑，≤1 天） | 通读 §6.1 清单；npm 逐包可装性；Ink spike 四指标；grok 文档提炼 UX 规格；**新增：事件面全谱勘察** | `INTERFACES.md`、`UX-SPEC.md`、`SPIKE.md`、**`EVENT-SPEC.md`**（见下）、ADR-2/4 终裁 | 四文档齐备，无"待确认"项 → **STOP** |
| **M1 骨架** | bundle+profile 打通；空壳全屏 app；以纯文本滚动打出事件面最小折叠 | 可运行 `dsh --profile tui` | AC-1、AC-2 → **STOP** |
| **M2 渲染** | 完整 transcript：流式、markdown、工具树、diff、subagent 折叠 | — | AC-3、AC-6、AC-8 |
| **M3 交互** | 输入区、斜杠命令、审批、user-questions、会话切换/resume | — | AC-4、AC-5 → **STOP** |
| **M4 打磨** | 状态栏、主题、键位页、CJK 全量、README+安装文档 | 用户文档 | 全部 AC，交付 |

**`EVENT-SPEC.md` 要求**：`SessionEvent` 类型全谱清单（transcript 相关逐一列出：字段、语义、折叠动作；无关者标注忽略理由）；`StreamChunk` 六变体折叠规则；chunk→message 归并协议（含被引 seq 集处理）；快照-订阅接缝协议（先挂听、读 `session.events`、按 `seq < length` 丢弃）与幂等性论证；乱序 block-start 处理；全部带 路径:行号 引用锁定 commit。

---

## 6. 验收标准（机器可验）

测试基建：node-pty 驱动 + 终端快照断言。CI 至少 Linux；Windows Terminal 为 P1 矩阵。

- **AC-1 启动**：`dsh --profile tui --help` 退出码 0 且打印 TUI flag；进入 alt-screen，Ctrl+C/`/quit` 后终端完全复原。
- **AC-2 内核零改动**：out-of-tree 结构性成立；fork 回退时 `git diff --stat -- packages/ apps/web vendor/` 为空。
- **AC-3 端到端**：PTY 120×40，发送触发文件写入的任务，断言：流式增量出现、工具调用节点渲染、最终落盘内容正确。
- **AC-4 审批**：ask 策略触发 bash 工具，断言提示渲染；`y` → 执行且日志含 `approval/decided`；`n` → 拒绝且未执行。
- **AC-5 会话**：退出后 `--resume` 续接，历史 transcript 完整重放且可继续追问。
- **AC-6 CJK**：中文 prompt 与中英混排/全角标点回答，快照断言无错位断行、无半字截断；输入区中文光标列位正确。
- **AC-7 锁定**：dsh 依赖确切版本（无 `^`/`~`）；仓库根记录两侧上游 SHA。
- **AC-8 折叠确定性（v1.1 新增）**：property test——同一事件序列，`fold(session.events)` ≡ 逐事件增量折叠结果；重复注入已见 seq 为 no-op；注入未知类型伪事件渲染 raw 占位节点且进程不崩。

---

## 7. 反幻觉与工程守则（对 Codex 的硬约束）

1. **M0 四文档齐备前禁止写任何实现代码。**
2. 一切签名、事件名、配置键以锁定 commit 内源码为准；`INTERFACES.md` + `EVENT-SPEC.md` 是后续唯一事实源。
3. 文档与代码不符、npm 包缺失 → 停机上报附证据，不得自行绕过。本次停机即此规则的正确执行，机制保留。
4. 每次改动跑对应 AC；提交信息引用 AC 编号。
5. 全程锁死 `47f9438` 开发；升级适配另立任务书。
6. 未覆盖的架构分叉 → 列选项与代价停机等裁决。
7. **（v1.1 新增）本机 dsh 检出（如 `D:\deepseek-harness`）仅作只读参考——工作树内有他人改动，严禁在其中落任何文件、执行任何写操作或提交。**

---

## 8. 风险与回退

| 风险 | 缓解 |
|---|---|
| v0.1 接口快速迭代 | 锁 commit + 确切版本依赖（AC-7）；升级另立任务 |
| **事件 schema 属高危变动面（v1.1）** | `EVENT-SPEC.md` 锁 commit 逐类型引用；`transcript-fold` 每类型单测；未知事件优雅降级（AC-8） |
| out-of-tree 装配 rc 阶段有坑 | ADR-2 fork 回退，AC-2 保内核不脏 |
| Ink 长 transcript 性能 | 虚拟滚动/增量重绘；spike 阶段以 5k 事件折叠产物压测渲染 |
| Windows conhost 能力不足 | 仅支持 Windows Terminal（参照 grok 21 号文档口径），启动探测并警告 |
| 折叠语义与 web 漂移 | 以 `partial.ts`/`ui-conversation` 为参照语义基线，EVENT-SPEC 中逐条对照 |

---

## 9. 交付物清单

1. 独立仓库 `dsh-tui`（或回退：fork 内新增目录），含插件包、`transcript-fold` 模块、bundle patch、profile 模板。
2. `INTERFACES.md`、`UX-SPEC.md`、`SPIKE.md`、`EVENT-SPEC.md`、ADR 终裁记录。
3. PTY 测试套件（含 AC-8 property test）+ CI 配置。
4. 用户 README：安装（`dsh plugin` 流程）、键位表、与 web UI 功能对照表、已知限制。
