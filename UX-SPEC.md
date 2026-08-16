# dsh-tui UX Specification

Status: final for M0. The interaction reference is grok-build `eb267feff13129e568df38fb6fdf0ceb65f735d6`; every adopted action below is remapped to the real dsh rc.6 seams in `INTERFACES.md`.

## 1. Design direction: Abyss Workbench

The TUI should feel like a focused instrument in deep water: near-black field, high-contrast work content, electric DeepSeek blue for direction, a small coral eye/alert accent, and restrained cyan/foam highlights. It is not a dashboard grid and not a decorative “AI chat” card stack. The transcript is the dominant surface; controls stay quiet until relevant.

The signature element is a terminal-native DeepSeek whale produced from the official DeepSeek GitHub avatar by Chafa 1.18.2. Chafa is pinned as a build-time generator; the runtime embeds only ASCII cells and three quantized blue color tiers. Every glyph is one display column. It appears on an empty/new session only when the viewport is at least 72×22; compact layouts omit it rather than squeeze the transcript.

```text
                    _
      _ygggggg@B   u@y_   _y
    yg@@@@@@@@@@gy  @@@g@@@M
   y@@@@@@@@@@@@@@$y`5@@AM~
   $@   `~?@@@@@W7R@@@@@
   4@y      ~R@@@Wy2@@@^
    @@g       7@@@@@@@~
     M@@y_ 4@g_ 5@@@@_
      `7R@@@@@@@$mTFFF~
           ~TT~
```

The exact colored segments live in `src/ui/logo.generated.ts`; `MONO_LOGO_LINES` is the Chafa `--colors none` fallback. Below 72 columns or 22 rows the mark is omitted and the title remains visible. This project is independent and is not affiliated with or endorsed by DeepSeek; logo provenance and trademark boundaries are recorded in `PROVENANCE.md` and `NOTICE`.

## 2. Screen anatomy

At 120×40 the layout is one continuous work surface with a fixed header, scrollable transcript, context-sensitive overlay/card, composer, and one-line status/help footer.

```text
┌ dsh-tui · abyss ────────────────────── session title ──────── ◷ 12s · total 4m12s ┐
│                                                                          │
│  You                                                                     │
│  请检查登录流程，并修复失败测试。                                        │
│                                                                          │
│  DeepSeek                                                               │
│  我先定位测试与认证入口。                                                │
│  ├─ read  src/auth.ts                                      done  18 ms  │
│  ├─ pwsh  pnpm test                                        running …    │
│  └─ edit  src/auth.ts                                      +8  -3       │
│                                                                          │
│  ◇ Thought · stable first line · 24 lines                               │
│                                                                          │
│  ┌ Permission required ───────────────────────────────────────────────┐  │
│  │ pwsh · pnpm test                                                  │  │
│  │ Runs the project test suite in the workspace.                     │  │
│  │ [1] Allow once   [2] Reject   [3] Change permission preset…       │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ > Type a message…                                                        │
├──────────────────────────────────────────────────────────────────────────┤
│ deepseek-v4-flash · workspace-write · 18k/128k · plan off · todos 2        │
│ Ctrl+P commands  Ctrl+S sessions  Shift+Tab permissions  Ctrl+X keys    │
└──────────────────────────────────────────────────────────────────────────┘
```

At 80×24, header metadata collapses to title only, tool cards become one-line summaries, and the help row shows the three currently useful keys. At widths below 60, borders switch to plain `-`/`|`, cwd/title are middle-ellipsized by display cells, token breakdown moves into `/session-info`, and overlays use the full content width. The composer always retains at least three rows when multiline mode is active.

The header closes with the elapsed chip, in accent weight, right of the title block; the title keeps a minimum cell budget and the chip takes the cells it leaves, so the two are laid out against one budget and the header can never wrap into a second row and push the frame past the screen. While the agent is running a single 80ms clock advances Grok's width-1 circling-dot spinner on the live Thinking row, a running tool, and a streaming assistant label; the elapsed chip still floors that same clock to whole seconds. The interval stops the instant the agent goes idle, so a parked TUI still repaints on events alone. When the turn closes the settled chip states the last turn's span and the conversation's total task time (`◷ last 12s · total 4m12s`). One measured turn states a single number, because its last turn is its total; a narrow header keeps the running seconds, or the total once the task is done, and drops the pair. Spans are read from the `turn/start`/`turn/end` timestamps in the log, never sampled by the view, so a resumed session restates the same total and an untimestamped turn is left out instead of estimated. An open turn with no running agent — a wedged or failed loop — reads its settled facts rather than counting up, and the spinner stays on the rest mark.

The elapsed chip is the top of a small right-aligned stack: the cache-hit rate renders under it in muted weight — cache-read tokens as a share of billed prompt input across the whole durable log, the same metric the web UI's stats line prints (`cache hit 95%`) — or beside it on one row when the header collapses to compact mode. Both chips share the header's cell budget with the title, so the header can never gain a row. The status footer is a fixed one-row fact line plus the help row; multi-line signals, such as a dsh command result (`/goal`'s status view), fold onto that single row instead of growing the footer under the composer.

There is no permanent left sidebar. `Ctrl+S` opens a modal session picker and closes it after selection. P1 workflow/jobs and subagent trees are modal/list details, not competing columns. This explicitly rejects Grok's multi-root dashboard for v1 because the task requires one active session.

## 3. Transcript visual grammar

- User messages use a blue left marker and normal foreground text; no filled chat bubble.
- Assistant text is the default foreground. Markdown headings gain weight, code gains a one-cell gutter, and tables degrade to wrapped key/value blocks when they would overflow.
- Reasoning is collapsed by default with a dim cyan label; expanding it never changes event order.
- A streaming reasoning row shows a Grok-style truncated tail (latest summary plus the last three wrapped lines) and the shared width-1 spinner as its marker. A settled row returns to its stable first non-empty line and a static `◇`/`⌄`. Right opens a bounded three-line preview, Enter opens independently scrollable full detail, and `Ctrl+E` toggles every preview. Duration labels are omitted unless Harness emits real timestamps.
- Tool calls are a tree. Running is cyan with the same spinner, success is foam/green, errors and rejections are coral, and raw/orphan data is amber. Tool names stay visible at every width.
- Tool output is preformatted, never re-flowed as Markdown prose: file content keeps its own line breaks and indentation. It folds to a six-line preview (one line at 80 columns and below) whose header states the real row count, so a large file read cannot bury the conversation. `→` expands, `←` collapses, `Ctrl+E` toggles every block, and an expanded body is capped so one pathological result cannot stall the row builder. Folding is view state: the copied text is always the tool's own output.
- Diffs use `+`/`-` prefixes in addition to color. No meaning relies on color alone.
- Unknown events render as `raw event #<seq> · <type>` with an expandable JSON body. They never appear as assistant prose.
- Streaming updates mutate the current assistant node in place. Final `assistant/message` does not visually duplicate the partial.
- Approval and question cards take keyboard priority, then composer, then scrollback. `Esc` parks a blocking card in scrollback; it never fabricates an answer.
- The scrollback viewport is a window over rendered rows, never over nodes: a scroll step of one row moves the window by exactly one terminal line regardless of the node it lands inside, and a tall answer is entered gradually instead of appearing whole. A one-cell scrollbar column is permanently reserved on the right so crossing the viewport height never rewraps text, and it draws a proportional thumb only while the transcript overflows. New rows that arrive while the reader is scrolled up shift the offset by the same amount, so streaming never drags the view; at rest the newest row stays pinned to the bottom edge.

## 4. Keyboard map

The default is Grok's Simple-mode vocabulary; v1 does not implement Vim mode. References: Grok `03-keyboard-shortcuts.md:27-223,257-301,346-368` and Windows-terminal caveats at `:229-243`.

### Global and focus

| Key | Action | dsh mapping |
|---|---|---|
| `Ctrl+P` or `?` | open fuzzy command palette | dsh command descriptors + local commands |
| `Ctrl+S` | open persisted session picker | `sessionPersistence.list`, lazy `readFrom` per visible row, then `agents.resume` |
| `Ctrl+X` | open key reference | local overlay; chosen because Windows Terminal does not reliably distinguish control punctuation |
| `Ctrl+C` | cancel active turn; when idle with a draft, clear draft; when idle/empty, request quit on second press | `agent.cancel` or local state; double action is shown before execution |
| `Ctrl+M` | prompt focused: toggle multiline; scrollback focused: live model picker | local composer / `llm` catalog + Agent `ModelSelectionRef` |
| `Ctrl+E` | expand/collapse every tool output and reasoning preview | local presentation over dsh blocks |
| `Ctrl+Y` | copy the selected block, else the newest, to the clipboard | OSC 52 plus the platform clipboard tool |
| `Shift+Tab` | cycle the advertised permission presets | `permissionPresets.names/current/set`; never cycles invented Grok modes |
| `Tab` | move composer ↔ scrollback, or walk the active blocking card | local focus state |
| `Esc` | close top non-blocking overlay; park a blocking card; return focus | local only; no rejection/cancellation |
| `PgUp` / `PgDn` | page the row viewport, from either focus | transcript viewport |
| `Ctrl+U` / `Ctrl+D` | half-page up/down while scrollback is focused | transcript viewport |
| `Home` / `End` in scrollback | oldest row / live tail | transcript viewport |
| Wheel | three rows per notch; walks an open picker instead when one is open | SGR mouse reports, alternate scroll disabled |
| `Up` / `Down` | previous/next selectable block (tool output or reasoning) in scrollback, or one row when the session has none; prompt history when composer is focused and empty | local viewport/history |
| `Left` / `Right` | collapse/expand focused block | local presentation only |
| `Shift`+drag | the terminal's own selection; `/mouse` releases mouse tracking entirely | terminal-owned, no app involvement |
| `Enter` on focused block | open full detail | local detail overlay |

### Composer and active turn

| State | Key | Result |
|---|---|---|
| normal composer | `Enter` | submit as `agent.followup` |
| normal composer | `Ctrl+M` | enter multiline mode |
| multiline composer | `Enter` | insert newline |
| multiline composer | `Alt+Enter` | submit; primary Windows Terminal-safe multiline send chord |
| any composer | `Ctrl+W`, `Ctrl+U`, `Ctrl+K` | delete word, delete to start, delete to end |
| agent running | ordinary submit | queue a later turn with `agent.followup` |
| agent running | `Ctrl+L` | explicit interject using `agent.steer`; the hint says “steer current/next step” |

`Shift+Enter` may be a detected alias for newline, but it is never the only route because integrated terminals can collapse it. `Ctrl+Enter` is not a primary binding on Windows Terminal for the same reason.

### Approval card

| Key | Result |
|---|---|
| `y` or `1` | return `allowed-once` |
| `n` or `2` | return `rejected` |
| `3` | open permission-preset subpicker; successful preset change then allows this one request |
| arrows, `Tab`, digits, `Enter` | select/activate an option |
| `Ctrl+F` | toggle full tool arguments/diff |
| `Esc` | park focus in scrollback; request remains pending |
| request abort | card closes and the service returns `cancelled` |

No “always allow this command” grant is shown because dsh exposes no equivalent persistent grant. Preset escalation is explicit and names its sandbox/approval consequence before confirmation.

### User-question card

| Key | Result |
|---|---|
| `Left` / `Right` | previous/next question |
| `Up` / `Down`, `Tab` | move through options |
| `1`–`9` | choose an option directly |
| `Space` | toggle an option in multi-select |
| `z` | edit the free-text row |
| `Enter` | choose/advance; commit the free-text row and leave it; submit on final valid question |
| `Esc` | clear current selection, then park focus; never dismisses the question |

Required questions cannot submit empty. `plan-review` intent highlights the configured approve option; every other answer declines according to the real dsh intent contract.

The same card serves the model-facing `ask_user_question` tool (`@deepseek-ai/dsh-tool-ask-user`) through the `ctx.userQuestions` provider this app registers: the tool's step stays blocked until the card returns, and the answer becomes an ordinary tool result. The provider answers only for the active root agent and only one live request; a subagent's request or a second concurrent one is rejected, because inventing an answer — or letting a background agent capture the card — would put words in the user's mouth. Committing the free-text row must close it: an open editor would swallow the arrows that move between questions.

## 5. Slash command policy

Typing `/` opens a fuzzy menu combining `ctx.commands.list(agent)` with local TUI descriptors. Source badges are `dsh` and `tui`; an exact name collision shows both and requires explicit selection. Dispatch tries the selected descriptor, never silently changes precedence.

| Command | v1 disposition | Behavior |
|---|---|---|
| every advertised dsh command | adopt | execute through `ctx.commands.execute` and show its durable run/done activity |
| `/quit`, `/exit` | local | clean terminal shutdown; `/exit` alias |
| `/theme` | local | switch Abyss/Pearl/auto with immediate preview |
| `/help`, `/keys` | local | usage and key overlays |
| `/new` | local | confirm if a turn/draft is active, dispose current handle, create fresh root |
| `/resume` | local | open session picker |
| `/session-info` | local | title/id/cwd/model/preset/projection facts; no invented billing |
| `/switch [provider/model]` | local | exact-route validation through `llm.resolveCallConfig`; changes the active Agent on its next not-yet-assembled step and best-effort saves the default |
| `/effort [default\|level]` | local | only offers effort ids from the exact model metadata; `default` clears the explicit override |
| `/model` | local | compatibility alias for `/switch` |
| `/mouse` | local | toggle mouse tracking so an emulator without `Shift`+drag can drag-select; the wheel stops scrolling while it is off |
| `/rename` | local | `sessionTitle.rename` |
| `/plan [on\|off]` | adopt if dsh descriptor is present, otherwise mapped local action | `planMode.set`; status reflects committed vs queued |
| `/always-approve` | compatibility alias | selects `danger-full-access` only after showing that it changes both sandbox and approval policy; running it again does not invent a Grok toggle |
| `/auto` | omit | dsh rc.6 has no classifier/auto policy |
| `/view-plan` | omit | dsh projection exposes active/pending state, not a durable Grok plan file; plan review remains in the real question card/transcript |
| `/workflows` | P1 read-only | current workflow/jobs list only; no dashboard control invented |
| `/dashboard` | omit | multi-root dashboard is a v1 non-goal |

Grok vocabulary sources: `04-slash-commands.md:11-173,269-325`; plan semantics examined at `19-plan-mode.md:40-145`; permissions examined at `22-permissions-and-safety.md:10-137,375-406,532-536`. Where those semantics exceed dsh, the table deliberately degrades or omits them.

## 6. Themes and terminal capability tiers

Two complete themes ship:

| Token | Abyss (dark) | Pearl (light) | 256 fallback | 16/mono fallback |
|---|---|---|---|---|
| background | `#06111F` | `#F4F7FA` | terminal default | terminal default |
| foreground | `#D7E5F2` | `#172435` | 252 / 235 | default foreground |
| muted | `#6F879D` | `#647489` | 66 / 244 | dim |
| DeepSeek accent | `#178BFF` | `#006FD6` | 33 | cyan/blue |
| foam success | `#5ED6B3` | `#087F69` | 79 / 29 | green |
| coral eye/error | `#FF7A6E` | `#C83B32` | 210 / 160 | red |
| warning/raw | `#F6C85F` | `#8B6508` | 221 / 136 | yellow |

The app selects an explicit token set for truecolor, 256, 16, or mono. It does not rely on Ink/Chalk to quantize arbitrary RGB at render time. `NO_COLOR` forces mono. Focus, state, additions/deletions, and approval choices always have text/glyph cues.

`auto` theme uses terminal background detection only when reliable; otherwise it defaults to Abyss without sending a blocking query. Cursor color may use OSC 12 after terminal acquisition and must reset with OSC 112 on every exit. These choices follow Grok `06-theming.md:7-13,93-134`; the theme names/art are project-original.

## 7. CJK, width, and accessibility

- UTF-8 output is mandatory. Every layout, clip, ellipsis, selection, and cursor calculation uses terminal display cells (`string-width`/wcwidth semantics), never JavaScript string length.
- Combining marks stay attached to their grapheme; full-width punctuation and CJK count as two cells; ANSI sequences count as zero.
- Wrapping happens at grapheme boundaries. A two-cell glyph is moved whole to the next line when only one cell remains.
- Input selection/cursor state stores grapheme boundaries and derives the terminal column from the prefix width.
- An input method composes at the terminal's own cursor, not at whatever the app paints, so the hardware cursor is moved onto the composer caret after every frame and made visible while the composer holds focus. The painted inverse-video caret is dropped exactly then, so a block cursor cannot sit on top of it. Anywhere else — transcript focus, an overlay, a blocking card — the cursor is hidden again.
- Copy paths never transcode: the clipboard receives the block's source text, UTF-16LE with a BOM on Windows (`clip.exe`) and UTF-8 elsewhere, plus a base64 OSC 52 payload for terminals that own the clipboard themselves.
- The acceptance fixture is `中文 CJK，ＡＢ。` plus combining and emoji cases. The M0 baseline measures the first string as 16 cells and wraps it 8+8 without half-glyph clipping.
- ASCII whale/logo characters are all one-cell ASCII. Box-drawing borders have a plain ASCII fallback for terminals whose width probe disagrees.
- Screen reader mode is not claimed in v1, but status text does not depend on spinners or color alone.

Windows Terminal is the supported Windows emulator; legacy conhost receives a warning and best-effort monochrome mode. Terminal rationale: Grok `21-terminal-support.md:51-68,81-105,174-181`.

## 8. Session picker and P1 panels

The session picker lists conversations, not storage keys. Each row is the durable `session/title`; when a log carries none it is the first human prompt; when it carries neither the row says `untitled` and falls back to the id. The right column carries the current-session marker, the human prompt count, and the age of the last stored event. The full session id, cwd, and creation time appear on one detail line under the list, for the selected row only.

It uses `sessionPersistence.list` metadata first and folds details lazily: only the rows in the visible window are read, one at a time, through the read-only `readFrom(id, 0)` seam (`inspect` when a backend has no `readFrom`), so opening the picker never publishes, repairs, or resumes a session. A row whose log cannot be read says `unreadable log` and keeps its id — the picker never fabricates a title. The open session's fold is discarded each time the picker opens because its log keeps growing. Rows stay ordered by `createdAt`: ordering by folded activity would require reading every stored log. `Enter` resumes, `Esc` returns, and `/new` creates a new session. It does not search transcript content in v1 and never deletes sessions.

P1 subagent and workflow views are collapsible trees derived from durable ids. They show state, label, child id, phase/outcome, and timing when available. They do not permit multi-session parallel dispatch. This adopts the navigation clarity of Grok `17-sessions.md` and `23-dashboard.md:27-111` while rejecting the latter's concurrent dashboard behavior.

All UX decisions above have a concrete dsh seam or an explicit omission; none remain pending.
