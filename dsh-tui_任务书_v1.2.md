# dsh-tui 任务书 v1.2

**派发对象**：Codex CLI ｜ **上游架构**：Claude ｜ **日期**：2026-08-14

**一句话目标**：为 DeepSeek Harness（dsh，v0.1 developer preview）构建一个 Grok Build 风格的全屏终端界面，作为**同进程 dsh App 插件**交付，通过 `dsh --profile tui` 启动。**内核零改动，只换 UI 面**。

## 变更记录 v1.1 → v1.2

针对 M0 停机报告《锁定提交的 rc.5 包未发布到 npm》的裁决。报告的 npm 证据经上游独立复核属实，且上游追加勘察发现更深一层事实：**公开仓库与 npm registry 在顶端脱节**（详见 §1.1 版本考古）。

1. **裁决：采纳修正版方案 B（B′），双锚锁定。** 依赖/运行时锁 = npm `0.1.0-rc.6` artifact 集（不可变，integrity 哈希入册）；源码勘察参照 = 公开仓库 `47f9438`（公开历史顶端，与 rc.6 血缘最近的可读源码）。上游已对五个接缝包做契约级预检，v1.1 引用的全部接缝声明在 rc.6 d.ts 中原样成立（§1.1）。
2. 方案 A（补发 rc.5）驳回：`@deepseek-ai` npm scope 归 DeepSeek，本项目上游无发布权，任何等待均不可控。可顺手向上游仓库提 issue 报告脱节（不阻塞，见 §8）。
3. 原方案 B（改锁 rc.6 提交）**不可执行**：公开仓库不存在 rc.6 提交。
4. 方案 C（本地 tarball 供依赖）降为回退路线，写入 ADR-2。
5. M0 新增交付物 `PROVENANCE.md`；AC-7 改写；守则 5/7 修订并新增契约漂移停机规则。
6. transcript 数据面裁决（v1.1）不变。

其余条款与 v1.1 一致。**本文件整体取代 v1.1。M0 解除停机，按新增交付物续跑。**

---

## 1. 已确认事实（上游已实勘，非猜测）

### 1.1 dsh 侧

- 仓库：`github.com/deepseek-ai/deepseek-harness`。MIT 协议。pnpm monorepo，TypeScript。
- **源码勘察参照 commit `47f943859bef60e4160492346772ded9b24f765a`**（2026-08-13，master 顶端）。
- 顶层结构：`apps/{cli,web}`；`packages/*/*` 两级包族；bundle 三件套 `packages/bundle/{base,headless,web-app}`。
- **官方架构已为 TUI 预留位置**：`apps/cli/README.md` 明文示例 `dsh --profile tui --resume <id>`。启动器只解析自己的 flag，其余交给 profile 内 app 插件，经 `dsh-cmdline`（`packages/boot/cmdline`）快照解析。
- **headless bundle 是结构模板**：`packages/bundle/headless/`——startup provider 从 `cmdlineArgs` 解析应用参数 → runner 插件 `inject` 该 provider 并驱动 core registry。TUI 照此结构，把"一次性打印结果"换成"交互式渲染循环"。

**版本考古（v1.2 新增，双侧核实于 2026-08-14）：**

- 公开仓库 master 自发布日后**零新提交**，顶端即 `47f9438`，manifest 版本 `0.1.0-rc.5`。
- 公开历史版本链（近 16 提交扫描）：`rc.2 → rc.3 → rc.5`（rc.4 被跳过）。
- npm 实际版本集（`dsh-base` 等七关键包一致）：`rc.2`、`rc.3`、`rc.6`。**rc.5 从未发布；rc.6 无对应公开提交**，metadata 无 `gitHead`。结论：registry 与公开源在顶端脱节，dsh 应与 grok-build 同为内部 monorepo 同步制，rc.6 发布自尚未同步的内部源。
- rc.6 tarball 仅含 `lib/`（含 `lib/types/*.d.ts`）、README、LICENSE，**不含 src** → 比特级源码等价不可证，采用**契约级等价**。
- **契约预检（上游实测：下载 base/cmdline/session/session-projection/user-approval 五包 rc.6 tarball，深查后三者）**——v1.1 引用的接缝声明全部在 rc.6 d.ts 中原样成立：
  - `dsh-session` `lib/types/index.d.ts:174-176`：`get events(): readonly SessionEvent[]`；`get seq(): number` 且 **"seq = log.length contiguity contract" 注释原文保留**；`seq: number` 事件字段（`surface.d.ts:67`、`types.d.ts:424`）；`session/event` 事件名与 `(session, event)` 参数形态在产物代码中原样存在。
  - `dsh-session-projection` `lib/types/`：`SessionProjectionMap`（`types.d.ts:16`，打包 d.ts 中为合并展开态，属 rollup 正常现象）、`onChanged(listener)`（`index.d.ts:144`）、`snapshot(session)`（`index.d.ts:153`）。
  - `dsh-user-approval` `lib/types/`：waterfall 签名 `'approval/request'(this: Scoped<ApprovalService>, req, next): Promise<ApprovalOutcome>`（`index.d.ts:24`）；`ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`（`types.d.ts:23`）。
  - integrity 示例：`dsh-session@0.1.0-rc.6` `sha512-8tu8I6VW…`（全量入 PROVENANCE.md）。

**transcript 数据面 = core Session 事件面（v1.1 裁决，不变；引用为 47f9438 源码位置）：**

- `packages/core/session/src/index.ts:76`：`'session/event'(this: Scoped<Session>, session, event)`——post-commit、fire-and-forget 追加事件流，**scope 过滤分发**（agent-scoped 监听器只收该 agent 上下文会话的事件）。观察者异常隔离。
- `packages/core/session/src/index.ts:559` 附近：`session.events` 不可变深冻结快照。
- **seq 连续性契约**：`session.seq === log.length`；事件自带单调 `seq`（`types.ts:407-408`）。→ 接缝协议：先挂监听、再读 `session.events`、丢弃 `seq < events.length` 的实时事件，天然幂等。
- 归并语义：`assistant/message` 引用构成它的 `assistant/chunk` 源 seq 集（`types.ts:383,426` 附近）。
- **参照折叠语义（只读镜像，禁止 import）**：`packages/client/runtime/src/client/sessions/partial.ts` 的 `PartialAccumulator`（六种 `StreamChunk` 变体 → block index 键控 `AssistantBlock[]`，**block-start 可乱序、稀疏留洞**）；`packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts`。

**`ctx.sessionProjections` 定位（v1.1 更正，不变）：**

- 辅助状态投影注册表，不含 transcript。基础表空、merge-extensible（`src/types.ts:18`）。
- 生产注册键全集：`goal`、`sessionListMetadata`、`imageLimits`、`permissions`、`tokenUsage`、`contextPressure`、`contextBreakdown`、`plan`、`sessionStats`、`title`、`subagentTiming`、`subagent`、`todos`。
- 消费面：`onChanged` + `snapshot`（`asOfSeq` 水位）。

**其余接缝（不变）：**

- `ctx.approval`：waterfall answerer，"one terminal answerer per deployment"，fail closed。
- `packages/interaction/` 族：`user-questions`、`commands`、`permission-presets`、`tool-ask-user`。
- wire 协议备案（v1 不用）：HTTP POST unary + 双 WS 下行；同进程 carrier 存在。远程 attach 属 v2。
- **ACP 路线已排除**（automation-only，非 UI 接缝）。
- 官方警示：v0.1 接口"预计快速迭代"。

### 1.2 grok-build 侧（不变）

- 仓库：`github.com/xai-org/grok-build`，**锁定 commit `eb267feff13129e568df38fb6fdf0ceb65f735d6`**（2026-08-13）。Apache-2.0。Rust。
- TUI 实体：`crates/codegen/xai-grok-pager`（ratatui + crossterm，全屏、鼠标）。
- **UX 规格唯一来源**：`crates/codegen/xai-grok-pager/docs/user-guide/` 24 篇。直接相关：03、04、06、17、19、21、22、23。
- 已确认交互语汇：`/` 模糊匹配命令菜单（两源合流、冲突打 badge）；Shift+Tab 模式轮换；`/model`、`/plan`、`/view-plan`、`/auto`、`/always-approve`、`/workflows`。

### 1.3 根本约束（不变）

UX 移植，不是代码移植。逐字搬运 grok-build 文案/资源须 NOTICE 登记（Apache-2.0）；正常不应发生。

---

## 2. 目标 / 非目标（不变）

**目标（v1）**：① `dsh --profile tui` 全屏 TUI 完成一整轮编码任务（提问→流式→工具→审批→落盘）；② Grok Build 核心交互语汇成立；③ CJK 完全正确（硬验收）；④ 内核零改动。

**非目标（v1）**：远程 attach（v2）；鼠标完备（P2，键盘必须完备）；web settings 全集；ACP/编辑器嵌入；为 UI 造内核功能；多会话并行渲染/未读角标（v1 单活动会话）。

---

## 3. 架构决策（ADR）

| # | 决策 | 结论 | 依据 |
|---|---|---|---|
| ADR-1 | 集成路线 | 同进程 App 插件：新 bundle `dsh-tui-app`，经 profile 启动 | 官方 CLI 语法预留；headless 先例；审批 answerer 挂 host 侧 |
| ADR-2（v1.2 修订） | 锁定与栖身 | **双锚锁定**：依赖锁 = npm `0.1.0-rc.6` artifact 集（确切版本，integrity 入册，npm artifact 不可变）；源码勘察参照 = `47f9438`。独立仓库 out-of-tree 不变，`dsh plugin --profile tui` 装配。**回退**：PROVENANCE 契约校验发现重大漂移 → 自有工作区全新克隆 `47f9438`、`pnpm pack` 生成本地 tarball 供依赖（保源码精确性，弃 npm 安装故事，停机另报） | registry 与公开源顶端脱节（§1.1 版本考古）；**用户可安装的现实只有 rc.6**——对幽灵 rc.5 开发等于交付博物馆展品；五包契约预检已通过 |
| ADR-3（v1.1 修订，不变） | 数据面 | 双轨：transcript = 事件面（`session.events` + `'session/event'`，seq 幂等折叠，自有 `transcript-fold` 纯函数模块）；辅助状态 = 投影面。不复用浏览器 client runtime/React；web 折叠逻辑仅作参照语义，**不 import `@deepseek-ai/dsh-client-*`** | M0 报告 + 复核；seq 契约使去重极简 |
| ADR-4 | 渲染栈 | 默认 Ink，M0 spike 四硬指标（alt-screen+resize / truecolor 降级 / CJK wcwidth / Windows Terminal）任一不达即换自绘 ANSI | TS 生态最成熟 |
| ADR-5 | UX 参照边界 | grok user-guide 为规格源，术语映射表逐条 采纳/降级/砍掉 | 见 1.2/1.3 |

**ADR-5 术语映射（初版，M0 补全）**：plan mode→`plan` 投影（采纳）；`/model`→模型选择服务（采纳）；Shift+Tab→permission/agent preset 轮换（按 dsh 语义重定义）；`/auto` `/always-approve`→`user-approval`+`permission-presets`（映射实际策略集）；`/workflows`→列表视图 P1；subagent 导航→折叠树 P1；鼠标→P2。

---

## 4. v1 功能范围（不变）

**P0**：① 会话生命周期（新建/`--resume`/切换）；② transcript 渲染——`transcript-fold` 消费事件面：chunk 六变体折叠、chunk→message 归并替换、乱序 block-start 留洞、工具生命周期折叠树、diff 视图、**未知事件渲染 raw 占位节点绝不崩溃**；③ 输入区：多行编辑、`/` 命令菜单（`commands` 服务 + 本地 `/quit` `/theme` `/help` `/keys`）、`@` 引用视服务支持接入或砍；④ 审批终端 answerer（y/n/预设升级按 dsh 策略集）；⑤ user-questions 表单化；⑥ 状态栏：model、cwd、会话 id/`title`、`permissions`、`tokenUsage`、`contextPressure`、`sessionStats` 摘要、`plan`/`todos` 徽标——无金额字段，不造数据；⑦ CJK 全正确。

**P1**：主题（≥2 内置）、键位帮助页、workflow/jobs 列表、subagent 折叠树、Windows Terminal CI。
**P2**：鼠标、会话搜索、多会话感知。

---

## 5. 里程碑与人审停机点

| 阶段 | 内容 | 产出物 | 验收 |
|---|---|---|---|
| **M0 勘察+spike**（续跑，≤1 天） | 通读指定清单；**依赖全集 rc.6 可装性与契约核对**；Ink spike 四指标；grok 文档提炼 UX 规格；事件面全谱勘察 | `INTERFACES.md`、`UX-SPEC.md`、`SPIKE.md`、`EVENT-SPEC.md`、**`PROVENANCE.md`**、ADR-4 终裁 | 五文档齐备，无"待确认"项 → **STOP** |
| **M1 骨架** | bundle+profile 打通；空壳全屏 app；事件面最小折叠纯文本滚动 | 可运行 `dsh --profile tui` | AC-1、AC-2 → **STOP** |
| **M2 渲染** | 完整 transcript：流式、markdown、工具树、diff、subagent 折叠 | — | AC-3、AC-6、AC-8 |
| **M3 交互** | 输入区、斜杠命令、审批、user-questions、会话切换/resume | — | AC-4、AC-5 → **STOP** |
| **M4 打磨** | 状态栏、主题、键位页、CJK 全量、README+安装文档 | 用户文档 | 全部 AC，交付 |

**`EVENT-SPEC.md` 要求（不变）**：`SessionEvent` 全谱清单（transcript 相关逐一：字段/语义/折叠动作；无关者标注忽略理由）；`StreamChunk` 六变体折叠规则；chunk→message 归并协议；快照-订阅接缝协议与幂等性论证；乱序 block-start 处理；主引用为 `47f9438` 源码 路径:行号（可读性最优），契约一致性由 PROVENANCE 保障。

**`PROVENANCE.md` 要求（v1.2 新增）**：① 插件直接依赖的 `@deepseek-ai/dsh-*` 包全集清单，确切版本 `0.1.0-rc.6`，逐包 `dist.integrity`（sha512）；② 契约核对表——本任务书与 EVENT-SPEC/INTERFACES 引用的每条接缝声明 ↔ rc.6 tarball `lib/types/*.d.ts` 中的定位（文件:行号），上游预检的五包条目可直接沿用 §1.1 记录；③ 偏差记录：d.ts 与 `47f9438` 源码不一致处逐条列出，**以 tarball d.ts 为准**（那是插件编译与运行的现实）并标注；④ `gitHead` 缺失、repo/registry 脱节现状备案。

---

## 6. 验收标准（机器可验）

- **AC-1 启动**：`dsh --profile tui --help` 退出码 0 且打印 TUI flag；alt-screen 进出干净，终端完全复原。
- **AC-2 内核零改动**：out-of-tree 结构性成立；fork 回退时 `git diff --stat -- packages/ apps/web vendor/` 为空。
- **AC-3 端到端**：PTY 120×40，触发文件写入任务：流式增量、工具节点渲染、落盘内容正确。
- **AC-4 审批**：ask 策略触发 bash：提示渲染；`y` → 执行且日志含 `approval/decided`；`n` → 拒绝未执行。
- **AC-5 会话**：退出后 `--resume` 续接，历史完整重放且可继续追问。
- **AC-6 CJK**：中英混排/全角标点，快照断言无错位断行、无半字截断；输入区中文光标列位正确。
- **AC-7 锁定（v1.2 改写）**：插件 `package.json` 中全部 `@deepseek-ai/dsh-*` 依赖为确切 `0.1.0-rc.6`（无 `^`/`~`）；`PROVENANCE.md` 含逐包 sha512 与契约核对表；仓库根记录源码参照 SHA `47f9438` 与 grok-build SHA `eb267fe`。
- **AC-8 折叠确定性**：property test——`fold(session.events)` ≡ 逐事件增量折叠；重复 seq 注入为 no-op；未知类型伪事件渲染 raw 占位且进程不崩。

---

## 7. 反幻觉与工程守则（对 Codex 的硬约束）

1. **M0 五文档齐备前禁止写任何实现代码。**
2. 一切签名、事件名、配置键以锁定基准为准；`INTERFACES.md` + `EVENT-SPEC.md` + `PROVENANCE.md` 是后续唯一事实源。
3. 文档与代码不符、依赖缺失 → 停机上报附证据。前两次停机均为此规则的正确执行，机制保留。
4. 每次改动跑对应 AC；提交信息引用 AC 编号。
5. **（v1.2 修订）锁定基准 = npm `0.1.0-rc.6` artifact 集 + 源码参照 `47f9438`。上游后续任何发版（rc.7+、公开仓库推进、脱节修复）一律不自动跟进，另立任务书。**
6. 未覆盖的架构分叉 → 列选项与代价停机等裁决。
7. **（v1.2 澄清）共享检出（如 `D:\deepseek-harness`）绝对只读——严禁落文件、写操作、提交。允许且鼓励在自有工作区对锁定 SHA 做全新克隆，用于只读勘察及（回退路线时）本地打包。**
8. **（v1.2 新增）契约漂移分级**：d.ts 与源码参照的措辞/行号差异 → PROVENANCE 记录即可；**语义级漂移**（事件参数形态、`ApprovalOutcome` 值集、投影 API 形状、seq 契约变化）→ 立即停机上报。

---

## 8. 风险与回退

| 风险 | 缓解 |
|---|---|
| **registry 与公开源脱节**（rc.5 有源无包、rc.6 有包无源） | 双锚锁定 + PROVENANCE 契约核对；建议向 deepseek-harness 提 issue 报告脱节（附版本考古证据，**不阻塞本任务**）；后续同步跟进另立任务书 |
| v0.1 接口快速迭代 | 锁 artifact 集（不可变）+ 源码参照；升级另立任务 |
| 事件 schema 高危变动面 | EVENT-SPEC 逐类型引用；`transcript-fold` 每类型单测；未知事件优雅降级（AC-8） |
| out-of-tree 装配 rc 阶段有坑 | ADR-2 本地 tarball 回退，AC-2 保内核不脏 |
| Ink 长 transcript 性能 | 虚拟滚动/增量重绘；spike 以 5k 事件折叠产物压测 |
| Windows conhost 不足 | 仅支持 Windows Terminal（grok 21 号文档口径），启动探测警告 |
| 折叠语义与 web 漂移 | 以 `partial.ts`/`ui-conversation` 为参照基线，EVENT-SPEC 逐条对照 |

---

## 9. 交付物清单

1. 独立仓库 `dsh-tui`（或回退：本地 tarball 供依赖形态），含插件包、`transcript-fold`、bundle patch、profile 模板。
2. `INTERFACES.md`、`UX-SPEC.md`、`SPIKE.md`、`EVENT-SPEC.md`、`PROVENANCE.md`、ADR 终裁记录。
3. PTY 测试套件（含 AC-8 property test）+ CI 配置。
4. 用户 README：安装（`dsh plugin` 流程，依赖 npm rc.6）、键位表、与 web UI 功能对照表、已知限制。
