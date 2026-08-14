# dsh-tui-app

`dsh-tui-app` is an independent, out-of-tree full-screen terminal interface for DeepSeek Harness. It runs in the same process as the existing `dsh` host, reads the durable session event stream directly, and uses host projections only for auxiliary status facts. The Chafa-generated DeepSeek whale is its one visual signature.

## 继任者交接（2026-08-14）

### 这是什么项目

这是一次 **benchmark 比赛**：为 DeepSeek Harness（dsh，v0.1 developer preview）做 Grok Build 风格的全屏终端 UI。交付形态是**同进程 out-of-tree App 插件**，不改 dsh 内核。

- 工作区：`C:\Users\lenovo\Desktop\dshtui`（独立 Git 仓库）
- 启动：`dsh --profile tui`，本机也可直接 `dsh` 打开这套 TUI
- 任务书：`dsh-tui_任务书_v1.2.md`（取代 v1.0 / v1.1）
- 运行时锁：npm `@deepseek-ai/*@0.1.0-rc.6`
- 源码参照：本机只读仓 `D:\deepseek-harness` 的 `47f943859bef60e4160492346772ded9b24f765a`
- UX 参照：grok-build `eb267feff13129e568df38fb6fdf0ceb65f735d6`（只移植交互，不搬代码）

硬约束：

- **禁止写入** `D:\deepseek-harness`。那里有另一位参赛者（Oh My Pi）的未提交改动，只允许 `git show 47f9438:<path>` 只读取证。
- **不要重新下载 / 重装 dsh**。用本机已有 launcher。
- 不要发明模型 id、effort 词表、费用/账单字段。目录和能力一律问 `ctx.llm`。
- transcript 走 `session.events` + `session/event`；`sessionProjections` 只做辅助状态。

### 交到 Grok 手里时是什么状态

Codex Desktop 会话 `019ffdbf-5068-7751-ba50-eb2c6126c744` 额度用尽。用户带着这个工作区过来，要求接着做。

当时 **已提交** 到 `2edd7b3`：

| 提交 | 内容 |
|---|---|
| `ec3a637` | M1 空壳 + AC-1/2 |
| `ef36e87` | M2 transcript + AC-3/6/8 |
| `3e8e8a3` | M3 交互 + AC-4/5 |
| `474f467` | M4 交付 + AC-1～8 |
| `2edd7b3` | 裸命令 `dsh` 打开 TUI |

M0 过程中三次按任务书停机，上游已裁决并写入 v1.1 / v1.2：transcript 不走投影；依赖双锚 rc.6 + `47f9438`；`StreamChunk` 以源码七变体为准。

额度用尽前，Codex **已在未提交工作树里写完、但未 commit** 的 post-M4 功能：

- `/switch`、`/effort`、`/model` 别名，经 `installModelSelection` 只改下一个未 assemble 的 step
- Grok 式思考折叠的第一版（收起首行 / 展开预览 / 独立详情）
- 输入框钉住真实 `ctx N%`
- README / UX-SPEC / PROVENANCE 已按这些功能改过一稿

当时测试大约 18 文件 / 43 例。官方 session reader 会漏掉这条 Desktop 会话，要用会话 ID 或直接读 `~\.codex\sessions\2026\08\14\rollout-2026-08-14T08-50-01-019ffdbf-5068-7751-ba50-eb2c6126c744.jsonl`。

### Grok 在这个基础上又改了什么

1. **接上 Codex 的未完成交互，并补 Grok Truncated 思考尾**  
   思考中默认露出最后 3 行；结束后仍折成首行。见 `src/ui/reasoning-view.ts`、`src/ui/transcript-view.tsx`。

2. **滚轮不再回填上一条用户输入**  
   备用屏里滚轮会被当成方向键，空输入框就会翻历史。现在 `src/ui/terminal.ts` 打开 SGR 鼠标并关掉 alternate scroll；`src/ui/mouse.ts` 识别滚轮；连续方向键也按滚轮处理。滚轮只滚对话。键盘单击 `↑` 仍可取历史（短延迟防误伤），`Ctrl+↑` 立即取历史。

3. **输入光标按显示列对齐**  
   Ink 按 JS 字符宽度折行，中文会偏格。`presentEditor()` 按 terminal cell 折行，光标落在当前 grapheme 上。见 `src/ui/editor.ts`。

4. **底栏不再长得像 API key**  
   整行 `middleEllipsis` 会把会话 UUID 拼进模型名，截图像 `deepseek-official/dee...18-4d22-bdc9-…`。现在底栏只用短字段：通知、ctx、短模型名、effort、权限、plan/todos。会话 id、cwd、长标题、UUID/token 形模型 id 只出现在 `/session-info`。密钥类字符串一律打码。见 `src/ui/status.ts`、`src/ui/secrets.ts`。

5. **测试与产物**  
   当时 `npm test`：19 文件 / 47 例。改完后必须 `npm run build`，已安装的 `dsh` 读的是 `lib/`。

### 之后又做的两件事（2026-08-14 晚）

1. **滚动改成按行，不再按节点**  
   原来 `scrollOffset` 数的是 transcript 节点，一格滚轮可能跳过整条 50 行的回答，也可能只动 1 行。现在 `src/ui/transcript-rows.ts` 把整份 transcript 摊平成"一行 = 一个终端行"的数组，视口是这个数组上的窗口：滚轮一格固定 3 行，PgUp/PgDn 按行翻页（在输入框里也能用），右侧常驻一条比例滚动条。流式输出时若已经往上翻，偏移量会跟着新增行数一起长，读到哪停在哪；停在底部则始终钉住最新行。每个节点的行有 WeakMap 缓存，`foldTranscript` 没动过的节点不会重新排版。
2. **`/resume` 显示对话而不是 id**  
   `describeSession()` 用只读的 `sessionPersistence.readFrom(id, 0)` 折出 `session/title`、第一句人类提问、提问条数和最后活动时间（`src/session-summary.ts`）。列表先出 header，再按可见窗口逐条补摘要；完整 session id 只留在选中项下面那一行。

### 再之后修的三件事（2026-08-14 深夜）

3. **工具输出折叠，不再刷屏**  
   工具返回的文件内容现在按"预格式化"渲染（不再当成 Markdown 段落重排，行结构和缩进都保留），默认只露 6 行并在标题行标出真实行数，`… N more lines`。左右键展开/收起，`Ctrl+E` 全开全关。窄终端（≤80 列）仍是单行，但标题会写出行数，选中后才出提示行。见 `src/ui/transcript-rows.ts` 的 `emitTool` / `emitPreformatted`。
4. **中文输入法组合位置**  
   Ink 把硬件光标停在整帧末尾，输入法就把拼音画在屏幕最底部。现在每帧渲染后（`setImmediate`，确保排在 Ink 的同步写之后）把光标移到输入框光标格并显示，见 `src/ui/cursor.ts` 的 `composerCaret`。此时不再画反色光标块，避免和终端光标叠成两个。`tests/m5/ime-caret.spec.tsx` 用真实 `render()` + 假 TTY 验证：空输入框 `ESC[21;6H`，敲完 `中文a` 变 `ESC[21;11H`。
5. **复制**  
   `Ctrl+Y` 复制选中块（或最新块）的原始文本：先发 OSC 52，再调平台工具（Windows 用 `clip.exe`，UTF-16LE + BOM，中文和 emoji 已实测往返正确）。另外 `Shift+拖拽` 用终端自己的选区；`/mouse` 可整体关掉鼠标跟踪，把鼠标还给终端（代价是滚轮不再滚）。见 `src/clipboard.ts`。

当前 `npm test`：23 文件 / 74 例。

这些 post-M4 + Grok 修补 **仍全部未提交**。继任者先 `git status` 看工作树，不要以为 `2edd7b3` 就是最新功能。

### 建议接着做的事

- 用真实 PTY 回归 `/switch`、`/effort`、滚轮、中文光标、底栏、`/resume` 摘要
- 只有事件带真实时间戳时才显示 “Thought for Xs”，不要编造耗时
- 鼠标点选、transcript 搜索、多 root dashboard 仍是 v1 非目标
- 需要里程碑再 commit，不要把未验证的 PTY 失败打进交付报告

关键入口：`src/index.ts`（插件）、`src/interaction-controller.ts`（dsh 接缝）、`src/transcript-fold.ts`（事件折叠）、`src/ui/app.tsx`（键鼠与布局）。)

## What ships

- Streaming transcript reconciliation, terminal Markdown, tool trees, diffs, workflows/jobs, raw-event fallback, and grapheme-safe CJK layout.
- Row-precise scrollback: the viewport is a window over rendered terminal lines, not over nodes, so one wheel notch always moves three lines whatever the node underneath costs. A proportional scrollbar tracks the position, streaming appends stay anchored on whatever the reader is reading, and a released wheel returns to the pinned live tail.
- Folded tool output. A tool result is preformatted (never re-flowed as Markdown prose) and collapses to a six-line preview carrying its real size, so reading a file no longer buries the conversation. Arrow keys select any block — tool output or reasoning — and `→`/`←` expand and collapse it.
- `Ctrl+Y` copies the selected block, or the newest one, through the terminal's own OSC 52 sink and the platform clipboard tool. `Shift+drag` still gives the terminal's native selection, and `/mouse` hands the mouse back entirely when an emulator needs it.
- The terminal cursor is parked on the composer caret every frame, so IME pre-edit text composes inside the prompt instead of at the bottom of the screen.
- Multiline prompt editing, queued follow-ups, explicit steering, dsh/local slash-command discovery, approvals, structured questions, and durable resume/switch.
- A session picker that lists conversations: the durable `session/title`, else the opening prompt, plus prompt count, age, and a current-session marker. Opaque ids stay on the detail row for the selected entry.
- Harness-native live model and reasoning-effort selection. `/switch` changes the next not-yet-assembled Agent step; `/effort` only offers exact-model levels advertised by the active adapter.
- Grok-style reasoning disclosure over real dsh reasoning events: live tail, stable settled summary, bounded preview, and an independently scrollable full-detail view.
- Projection-backed model/session/permission/token/context/stats/plan/todo status. The footer stays short (notice, ctx, short model, effort, permission, plan/todos). Session ids, cwd, and opaque ids live in `/session-info`. Context occupancy is pinned in composer chrome. Missing capabilities stay hidden; secrets and billing are never shown.
- Abyss and Pearl themes with explicit truecolor, 256-color, 16-color, and monochrome palettes. `auto` safely defaults to Abyss when terminal background cannot be determined without a query.
- A Chafa 1.18.2-generated, three-blue-tier ASCII whale on empty wide sessions; Chafa is not a runtime dependency.

## Requirements and installation

This project uses the `dsh` already installed on the machine. It does not download, replace, patch, or vendor Harness.

- Existing DeepSeek Harness `dsh` launcher with the npm `0.1.0-rc.6` artifact set
- Node.js 22 or newer (Node.js 24 is used in CI)
- npm and pnpm available to the `dsh plugin` workflow
- Windows Terminal on Windows; modern xterm-compatible terminals are best effort on other systems

```powershell
npm install
npm run build
dsh plugin --profile tui add "C:\absolute\path\to\dsh-tui-app"
dsh --profile tui --help
dsh --profile tui
```

To make a bare `dsh` command open this TUI on the validated Windows local-workspace installation:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-default-command.ps1
dsh
```

Explicit commands such as `dsh --help`, `dsh web`, and `dsh plugin ...` remain routed to the upstream CLI.

The plugin creates/updates the isolated `tui` profile with `@deepseek-ai/dsh-base` followed by `dsh-tui-app`; it does not edit the Harness checkout. Resume a durable session with:

```powershell
dsh --profile tui --resume <session-id>
```

The direct dsh package dependencies are exactly `0.1.0-rc.6`: `dsh-agent`, `dsh-agent-default-model`, `dsh-cmdline`, and `dsh-session`. Their registry integrity values and every consumed host contract are recorded in [PROVENANCE.md](./PROVENANCE.md). Detailed setup and diagnostics are in [INSTALL.md](./INSTALL.md).

## Flags

| Flag | Values | Default |
|---|---|---|
| `--resume <session-id>` | opaque durable session id | new session |
| `--theme <name>` | `abyss`, `pearl`, `auto` | `auto` |
| `--color <mode>` | `truecolor`, `256`, `16`, `mono`, `auto` | `auto` |

`NO_COLOR` always forces monochrome, regardless of `--color`. `/theme abyss|pearl|auto` previews a theme immediately for the current TUI run.

## Keyboard reference

| Key | Action |
|---|---|
| `Enter` | send a normal prompt/follow-up; insert newline in multiline mode |
| `Ctrl+M` / `Alt+Enter` | toggle multiline / send multiline; from transcript, open the model picker |
| `Ctrl+L` | steer the current or next step |
| `Ctrl+W`, `Ctrl+U`, `Ctrl+K` | delete word / to line start / to line end |
| `Ctrl+P` or `?` | open fuzzy dsh + local command palette |
| `Ctrl+S` | open persisted session picker |
| `Ctrl+X` | open the complete in-app key page |
| `Ctrl+Y` | copy the selected block, or the newest one, to the clipboard |
| `Ctrl+E` | expand/collapse every tool output and reasoning preview |
| `Shift+Tab` | cycle only permission presets advertised by dsh |
| `Tab` | move between composer, blocking card, and transcript |
| `PgUp`, `PgDn` | page the transcript by lines, from either focus |
| `Ctrl+U`, `Ctrl+D` | half-page scroll while transcript is focused |
| `Home` / `End` in transcript | jump to the oldest row / back to the live tail |
| Mouse wheel | scroll the transcript three lines per notch, or walk an open picker; never recalls prompt history |
| `Up` on an empty composer | recall previous prompt after a short pause (wheel bursts are ignored) |
| `Ctrl+Up` / `Ctrl+Down` | recall prompt history immediately |
| `Up`, `Down`, `Left`, `Right`, `Enter` in transcript | select a tool output or reasoning block, fold/expand it, or open full detail |
| `Shift`+drag | the terminal's own selection and copy, unaffected by mouse tracking |
| `Esc` | close an overlay or park a blocking card without answering it |
| `Ctrl+C` | cancel a running turn; otherwise clear draft; press twice when idle/empty to quit |

Approvals use `y`/`1` (allow once), `n`/`2` (reject), or `3` (change the real permission preset and then allow once). Questions use arrows, digits, Space for multi-select, `z` for free text, and Enter to advance/submit.

Useful local commands include `/switch [provider/model]`, `/effort [default|level]`, `/model` (a `/switch` alias), `/new`, `/resume`, `/session-info`, `/rename`, `/theme`, `/workflows`, `/mouse`, `/keys`, `/help`, and `/quit`. `/resume` (and `Ctrl+S`) lists persisted sessions by conversation: header metadata loads first, then each visible row's durable log is folded read-only through `sessionPersistence.readFrom` for its title, opening prompt, prompt count, and last activity. Picker catalogs and capability validation come from `ctx.llm`; model ids and effort names are never hard-coded. Commands advertised by dsh execute through the host command registry; exact-name collisions remain visibly separate as `[dsh]` and `[tui]` entries.

## Web UI comparison

| Capability | dsh-tui v1 | Harness Web UI |
|---|---|---|
| One active root session, new/resume/switch | Yes, picker lists titles and opening prompts | Yes |
| Scrollback | Row-precise window, proportional scrollbar, anchored during streaming | Browser scrolling |
| Streaming messages, tools, diffs, workflows | Terminal-native compact tree | Rich browser presentation |
| Live model + exact-model effort switching | Next unassembled step through `ModelSelectionRef` | Yes |
| Reasoning disclosure | Live tail, settled summary, keyboard detail | Collapsible browser row |
| Long tool output | Preformatted, folded to a sized preview, keyboard-expandable | Collapsible browser panel |
| Copying output | `Ctrl+Y` per block, `Shift`+drag, `/mouse` off | Browser selection |
| Approvals and structured user questions | Keyboard-first, fail-closed | Browser controls |
| Projection status (tokens/context/stats/plan/todos) | Short footer + `/session-info` | Rich panels |
| Themes | Abyss/Pearl + capability fallbacks | Browser theme system |
| CJK and grapheme-safe editing | Yes, Windows Terminal validated | Browser text engine |
| Image/media rendering | Metadata placeholder only | Rich media surfaces |
| Mouse, transcript search, multi-root dashboard | Not in v1 | Available or better suited to Web UI |
| Remote/browser attachment and DOM slots | Deliberately not used | Native architecture |

## Responsive behavior

At 120×40 the transcript remains the dominant continuous surface. At 80×24 the header collapses to the title, tool/workflow cards become one-line summaries, reasoning detail replaces (rather than squeezes) the transcript viewport, and the help row shows context-relevant keys. Context occupancy remains pinned on the composer. Below 60 columns borders use plain ASCII and long cwd/title/status text is middle-ellipsized by terminal display cells. Detailed token composition remains available in `/session-info`.

## Development and acceptance

```powershell
npm run check
npm test
npm run build
npm run test:ac:all
```

The full local acceptance requires the existing `dsh` launcher for AC-1 through AC-5. CI runs the static M4 suite on `windows-latest`; real-profile PTY acceptance remains a local/release gate because CI does not install another Harness copy.

## Known limitations

- Windows Terminal is the supported Windows emulator; legacy conhost is best-effort monochrome.
- Block disclosure is keyboard-first. The mouse wheel scrolls the transcript and walks open pickers; click-to-select is still not a v1 feature. Drag-selection belongs to the terminal: hold `Shift`, or turn mouse tracking off with `/mouse`. The UI displays only reasoning emitted by Harness and never invents completion estimates or activity claims.
- `Ctrl+Y` reports what it attempted, not what the clipboard now holds: OSC 52 delivery is unobservable, and a terminal may refuse it. On Windows the `clip.exe` path is authoritative. Copy takes the block's source text, so a folded preview and an expanded one copy the same thing.
- Assistant messages are still rendered in full; only tool output folds. A model that emits a very long code block in its own answer still prints it.
- Placing the terminal cursor on the composer caret is what lets an IME compose in place. A terminal that ignores cursor positioning keeps the old behavior, and the painted caret block is suppressed only while the hardware cursor is in use.
- The session picker folds one durable log per visible row, so a very large stored session costs one read when it scrolls into view. Rows stay sorted by creation time, not by folded last activity, because sorting by activity would require reading every log.
- `@` remains ordinary prompt text because rc.6 has no host-safe general attachment-picker seam.
- Images render as attachment labels, not terminal pixels. The whale is a pre-generated ASCII asset.
- No transcript-content search, multi-root dashboard, remote attach, ACP bridge, persistent per-command grants, or invented `/auto` policy.
- Workflow/subagent views are read-only durable summaries. They do not dispatch concurrent root sessions.
- `auto` does not send a blocking terminal-background query; when detection is unreliable it chooses Abyss.

This project is independent and is not affiliated with or endorsed by DeepSeek. Logo provenance and trademark boundaries are documented in [NOTICE](./NOTICE) and [PROVENANCE.md](./PROVENANCE.md).
