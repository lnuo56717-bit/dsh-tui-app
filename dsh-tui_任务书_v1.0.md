# dsh-tui 任务书 v1.0

**派发对象**：Codex CLI ｜ **上游架构**：Claude ｜ **日期**：2026-08-14

**一句话目标**：为 DeepSeek Harness（dsh，v0.1 developer preview）构建一个 Grok Build 风格的全屏终端界面，作为**同进程 dsh App 插件**交付，通过 `dsh --profile tui` 启动。**内核零改动，只换 UI 面**。

---

## 1. 已确认事实（上游已实勘两侧源码，非猜测）

以下事实来自对两个仓库的直接勘察。**引用时以仓库内文件为准，不得凭训练记忆补写 API。**

### 1.1 dsh 侧

- 仓库：`github.com/deepseek-ai/deepseek-harness`，**锁定 commit `47f943859bef60e4160492346772ded9b24f765a`**（2026-08-13）。MIT 协议。pnpm monorepo，TypeScript。
- 顶层结构：`apps/{cli,web}`；`packages/*/*` 两级包族；bundle 三件套 `packages/bundle/{base,headless,web-app}`。
- **官方架构已为 TUI 预留位置**：`apps/cli/README.md` 中明文示例 `dsh --profile tui --resume <id>`（"assuming the tui profile is installed; --resume belongs to the terminal app"）。启动器只解析自己的 flag，其余整体交给 profile 内注入的 app 插件，经 `dsh-cmdline`（`packages/boot/cmdline`）快照解析。
- **headless bundle 是我们的结构模板**：`packages/bundle/headless/` 自述为"在 dsh-base 之上直连 core Agent/Session、无 Host/HTTP/浏览器层的 runner"。其 `cordis.patch.yml` 展示了完整的 app 插件声明范式：startup provider 从 `cmdlineArgs` 解析应用参数 → runner 插件 `inject` 该 provider 并驱动 core registry。TUI bundle 照此结构，只是把"一次性打印结果"换成"交互式渲染循环"。
- **UI 所需的 host 侧服务接缝均已存在且有文档**：
  - `ctx.sessionProjections`（`packages/session/session-projection/`）：会话事件日志之上的纯投影注册表。`onChanged(listener)` 变更推送 + `snapshot(session)` 一致性快照；值为 wire-JSON 完整值（whole-value，非 delta）；README 明言"rendering belongs to the slot system, never this layer"——**投影层与渲染器无关，TUI 可直接消费**。这是 transcript 的唯一数据源。
  - `ctx.approval`（`packages/interaction/user-approval/`）：渠道中立的一次性审批接缝。answerer 是 `approval/request` waterfall 监听器，"compose one terminal answerer per deployment"——**TUI 注册自己的交互式 answerer 即接管审批**。策略 `ask`/`never`，失败即拒（fail closed）。
  - `packages/interaction/` 族其余成员：`user-questions`（agent 向人提问）、`commands`（会话级命令发现与分发）、`permission-presets`、`tool-ask-user`。
  - 其余会用到的包族（均已确认存在）：`plan`、`subagent`、`jobs`、`workflow`、`session/session-stats`、`attachment`。
- **wire 协议（v1 不用，仅备案）**：`packages/client/connection/` README——unary 走 HTTP POST，下行走两条 WebSocket（`/api/events.mux`、`/api/events.host`），loopback 信任栅栏；**存在同进程 carrier，满足同一双流抽象**。远程 attach 属 v2。
- **ACP 路线已排除**：`packages/acp/acp/` README 明言 "Automation-only … not a UI integration or a capability seam"，不暴露 transcript 回放、命令、模式、工具呈现。**禁止试图经 ACP 搭 UI。**
- 包已发布至 npm（`@deepseek-ai/dsh-*`，`0.1.0-rc.x`，publishConfig public），`npx @deepseek-ai/dsh web` 即官方安装路径 → out-of-tree 插件路线可行（待 M0 逐包核实）。
- 官方警示：v0.1 核心插件与基础接口"预计快速迭代"。

### 1.2 grok-build 侧

- 仓库：`github.com/xai-org/grok-build`，**锁定 commit `eb267feff13129e568df38fb6fdf0ceb65f735d6`**（2026-08-13）。Apache-2.0。Rust cargo workspace（monorepo 同步镜像）。
- TUI 实体：`crates/codegen/xai-grok-pager`（及 `-bin`/`-diff`/`-render`/`-minimal`/`-pty-harness` 兄弟 crate），**ratatui + crossterm** 实现，全屏、鼠标交互。
- **UX 规格唯一来源**：`crates/codegen/xai-grok-pager/docs/user-guide/` 共 24 篇编号文档。与本任务直接相关：`03-keyboard-shortcuts`、`04-slash-commands`、`06-theming`、`17-sessions`、`19-plan-mode`、`21-terminal-support`、`22-permissions-and-safety`、`23-dashboard`。
- 已确认的交互语汇（可直接采信）：`/` 唤起模糊匹配命令菜单，命令分 shell builtins 与 pager builtins 两源合流，命名冲突时打 badge；Shift+Tab 轮换会话模式；`/model`、`/plan`、`/view-plan`、`/auto`、`/always-approve`、`/workflows`。完整键位表由 M0 从 03 号文档提炼。

### 1.3 根本约束

两侧语言不同（Rust vs TypeScript）。**本任务是 UX 移植，不是代码移植**：grok-build 只提供交互规格与观感基准，实现全部原生落在 dsh 的 TS 生态。若确需逐字搬运 grok-build 的文案/资源，须在 NOTICE 中登记（Apache-2.0）；正常情况下不应发生。

---

## 2. 目标 / 非目标

**目标（v1）**

1. `dsh --profile tui` 启动全屏 TUI，在真实项目目录中完成一整轮编码任务：提问 → 流式回答 → 工具调用 → 审批 → 结果落盘。
2. Grok Build 的核心交互语汇成立：全屏 alt-screen、斜杠命令菜单、审批提示、会话续接/切换、plan 状态呈现、主题。
3. 中文（CJK）输入与渲染完全正确——这是硬验收，不是加分项。
4. 内核零改动：`packages/`、`apps/web`、`vendor/` 一行不碰。

**非目标（v1 明确不做）**

- 远程 attach 到运行中的 `dsh web` host（v2 议题，wire 协议已备案）。
- 鼠标完备交互（P2 best-effort；键盘必须完备）。
- 复刻 web 端 settings 全集（复杂配置仍指路 `dsh web`，TUI 内给出提示语）。
- ACP / 编辑器嵌入。
- 为 UI 便利而新增/修改任何内核能力。**grok 有而 dsh 内核无的功能一律降级或砍掉，不许造内核。**

---

## 3. 架构决策（ADR）

| # | 决策 | 结论 | 依据 |
|---|---|---|---|
| ADR-1 | 集成路线 | **同进程 App 插件**：新 bundle `dsh-tui-app`（base + tui 应用插件），经 profile 启动 | 官方 CLI 语法已预留；headless 先例；零网络面；审批 answerer 天然挂 host 侧 |
| ADR-2 | 代码栖身处 | **独立仓库 out-of-tree 插件包**，`dsh plugin --profile tui` 装入 profile；dsh 依赖锁死到确切 rc 版本 | profile 机制官方支持 out-of-tree；内核零改动结构性成立。**回退**：若 rc 阶段 out-of-tree 装配有解析坑（M0 验证），允许 fork 内新增目录开发，但既有文件 `git diff` 必须为空（进验收） |
| ADR-3 | 数据面 | **直连 host 服务**（sessionProjections / approval / user-questions / commands），不复用浏览器 client runtime 与 React slot 系统 | 投影层自述渲染器无关；client/ui-* 系 DOM React，v1 复用得不偿失 |
| ADR-4 | 渲染栈 | **默认 Ink**（React for terminal）。M0 做半天 spike，四条硬指标任一不达即换自绘 ANSI 方案：① alt-screen 全屏+resize；② truecolor 及 256 色降级；③ **CJK wcwidth 断行正确**；④ Windows Terminal 下行为一致 | TS 生态内 Ink 最成熟；grok 的 ratatui 无 TS 等价物，不强求同库 |
| ADR-5 | UX 参照边界 | grok user-guide 为规格源，经**术语映射表**翻译到 dsh 能力，逐条标注 采纳/降级/砍掉 | 见 1.2/1.3 |

**ADR-5 术语映射（初版，M0 补全）**

| grok 概念 | dsh 对应 | v1 处置 |
|---|---|---|
| plan mode / `/plan` `/view-plan` | `packages/plan`（plan 状态与退出控制） | 采纳：状态呈现+退出；文件编辑门禁语义以 dsh 实际行为为准 |
| `/model` | dsh 模型选择服务（web 端为 ui-model-selection） | 采纳 |
| Shift+Tab 模式轮换 | dsh permission preset / agent preset 切换 | 采纳（轮换对象按 dsh 语义重定义） |
| `/auto` `/always-approve` | `user-approval` 策略 + `permission-presets` | 映射到 dsh 实际策略集，不发明新策略 |
| `/workflows` 面板 | `packages/workflow`、`packages/jobs` | 降级：v1 只做列表视图，P1 |
| subagent 导航 | `packages/subagent` 投影 | 降级：折叠树，P1 |
| 鼠标交互 | — | P2 |

---

## 4. v1 功能范围

**P0（验收必备）**

1. 会话生命周期：新建、`--resume <id>` 续接、会话内列表切换（映射 grok 17-sessions）。
2. transcript 渲染：消费 sessionProjections，流式增量、markdown 终端降级、工具调用折叠树、diff 视图（参照 grok 的 pager-diff 观感）。
3. 输入区：多行编辑、`/` 命令菜单（接 dsh `commands` 服务的发现/分发 + TUI 本地命令 `/quit` `/theme` `/help` `/keys`）、`@` 文件引用若 dsh commands/attachment 服务已支持则接入，否则砍。
4. 审批：注册终端 answerer，渲染请求详情（工具名、参数摘要、diff），y/n/预设升级 按 dsh 策略集。
5. user-questions：agent 提问的表单化渲染与回传。
6. 状态栏：model、cwd、会话 id、approval 策略、token/费用（session-stats 投影可用则显示，M0 核实）。
7. CJK：输入、渲染、断行、光标定位全正确。

**P1**：主题系统（参照 06-theming，≥2 内置主题）、键位帮助页、workflow/jobs 列表、subagent 折叠树、Windows Terminal CI。
**P2**：鼠标（滚动/点击折叠）、会话搜索。

---

## 5. 里程碑与人审停机点

每个 STOP 处停机等人审，不得自行越过。

| 阶段 | 内容 | 产出物 | 验收 |
|---|---|---|---|
| **M0 勘察+spike**（≤1 天） | 通读 §6.1 指定文件清单；逐一核实 npm 上 `@deepseek-ai/dsh-*` 可装性；Ink spike 打四条硬指标；从 grok 03/04/06/17/19/21/22/23 提炼 UX 规格 | `INTERFACES.md`（每个 ctx 服务的真实签名+文件路径+行号）、`UX-SPEC.md`（键位表/命令表/屏幕布局图）、`SPIKE.md`（四指标实测记录）、ADR-2/4 终裁 | 三文档齐备，无"待确认"项遗留 → **STOP** |
| **M1 骨架** | bundle+profile 打通；空壳全屏 app：启动/退出/resize/信号处理；以纯文本滚动打出一个最小 transcript 投影 | 可运行的 `dsh --profile tui` | AC-1、AC-2 通过 → **STOP** |
| **M2 渲染** | 完整 transcript：流式、markdown、工具树、diff、subagent 折叠 | — | AC-3、AC-6 通过 |
| **M3 交互** | 输入区、斜杠命令、审批 answerer、user-questions、会话切换/resume | — | AC-4、AC-5 通过 → **STOP** |
| **M4 打磨** | 状态栏、主题、键位页、CJK 全量验收、README+安装文档 | 用户文档 | 全部 AC 通过，交付 |

---

## 6. 验收标准（机器可验）

测试基建：node-pty 驱动 + 终端快照断言（grok 的 `xai-grok-pager-pty-harness` 是思路参照，不搬代码）。CI 至少 Linux；Windows Terminal 为 P1 矩阵。

- **AC-1 启动**：`dsh --profile tui --help` 退出码 0 且打印 TUI 应用 flag；`dsh --profile tui` 进入 alt-screen，Ctrl+C/`/quit` 退出后终端完全复原（光标可见、无残屏）。
- **AC-2 内核零改动**：out-of-tree 模式下结构性成立；fork 回退模式下 `git diff --stat -- packages/ apps/web vendor/` 输出为空。
- **AC-3 端到端**：PTY 120×40 启动，发送一个触发文件写入的任务，断言：流式增量出现、工具调用节点渲染、最终文件落盘内容正确。
- **AC-4 审批**：ask 策略下触发 bash 工具，断言审批提示渲染；`y` → 工具执行且日志含 `approval/decided`；`n` → 拒绝且工具未执行。
- **AC-5 会话**：会话 A 退出后 `--resume` 续接，断言历史 transcript 完整重放且可继续追问。
- **AC-6 CJK**：中文 prompt 与含中英混排/全角标点的回答，快照断言无错位断行、无半字截断；输入区中文编辑光标列位正确。
- **AC-7 锁定**：`package.json` 中 dsh 依赖为确切版本（无 `^`/`~`）；仓库根记录两侧上游 commit SHA。

---

## 7. 反幻觉与工程守则（对 Codex 的硬约束）

1. **M0 之前禁止写任何实现代码。**
2. 一切 ctx 服务签名、事件名、配置键以两个仓库锁定 commit 内的 README/types/源码为准；`INTERFACES.md` 是后续阶段唯一事实源。
3. 发现文档与代码不符、或 npm 包缺失/不可装 → **停机上报**，附证据（路径+行号/报错原文），不得自行发明绕过。
4. 每次改动跑对应 AC；提交信息引用 AC 编号。
5. dsh 快速迭代是已知风险：**全程锁死 `47f9438`（对应 rc 版本）开发**；升级适配另立任务书，不在本任务内顺手做。
6. 遇到本任务书未覆盖的架构分叉，列出选项与代价停机等裁决，不得单方面定夺。

---

## 8. 风险与回退

| 风险 | 缓解 |
|---|---|
| v0.1 接口快速迭代 | 锁 commit + 确切版本依赖（AC-7）；升级另立任务 |
| out-of-tree 装配在 rc 阶段有坑 | ADR-2 内置 fork 回退，AC-2 保内核不脏 |
| Ink 全屏长 transcript 性能 | 虚拟滚动/增量重绘；spike 阶段即压测 5k 行投影 |
| Windows conhost 能力不足 | 官宣仅支持 Windows Terminal（参照 grok 21-terminal-support 的口径），启动时探测并警告 |
| 投影缺字段（如费用统计） | 状态栏字段按投影实际可用性裁剪，缺则隐藏，不造数据 |

---

## 9. 交付物清单

1. 独立仓库 `dsh-tui`（或回退：fork 内新增目录），含插件包、bundle patch、profile 模板。
2. `INTERFACES.md`、`UX-SPEC.md`、`SPIKE.md`、本任务书的 ADR 终裁记录。
3. PTY 测试套件 + CI 配置。
4. 用户 README：安装（`dsh plugin` 流程）、键位表、与 web UI 的功能对照表、已知限制。
