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

At 120×40 the layout is one continuous work surface with a fixed one-line header, scrollable transcript, context-sensitive overlay/card, composer, and one-line status/help footer.

```text
┌ dsh-tui · abyss ───────────────────────────────────────── session title ──┐
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
│  reasoning  [collapsed · 24 lines]                                      │
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
│ deepseek-v4-flash · workspace-write · 18k/128k · plan off · todos 2     │
│ Ctrl+P commands  Ctrl+S sessions  Shift+Tab permissions  Ctrl+X keys    │
└──────────────────────────────────────────────────────────────────────────┘
```

At 80×24, header metadata collapses to title only, tool cards become one-line summaries, and the help row shows the three currently useful keys. At widths below 60, borders switch to plain `-`/`|`, cwd/title are middle-ellipsized by display cells, token breakdown moves into `/session-info`, and overlays use the full content width. The composer always retains at least three rows when multiline mode is active.

There is no permanent left sidebar. `Ctrl+S` opens a modal session picker and closes it after selection. P1 workflow/jobs and subagent trees are modal/list details, not competing columns. This explicitly rejects Grok's multi-root dashboard for v1 because the task requires one active session.

## 3. Transcript visual grammar

- User messages use a blue left marker and normal foreground text; no filled chat bubble.
- Assistant text is the default foreground. Markdown headings gain weight, code gains a one-cell gutter, and tables degrade to wrapped key/value blocks when they would overflow.
- Reasoning is collapsed by default with a dim cyan label; expanding it never changes event order.
- Tool calls are a tree. Running is cyan with a spinner, success is foam/green, errors and rejections are coral, and raw/orphan data is amber. Tool names stay visible at every width.
- Diffs use `+`/`-` prefixes in addition to color. No meaning relies on color alone.
- Unknown events render as `raw event #<seq> · <type>` with an expandable JSON body. They never appear as assistant prose.
- Streaming updates mutate the current assistant node in place. Final `assistant/message` does not visually duplicate the partial.
- Approval and question cards take keyboard priority, then composer, then scrollback. `Esc` parks a blocking card in scrollback; it never fabricates an answer.

## 4. Keyboard map

The default is Grok's Simple-mode vocabulary; v1 does not implement Vim mode. References: Grok `03-keyboard-shortcuts.md:27-223,257-301,346-368` and Windows-terminal caveats at `:229-243`.

### Global and focus

| Key | Action | dsh mapping |
|---|---|---|
| `Ctrl+P` or `?` | open fuzzy command palette | dsh command descriptors + local commands |
| `Ctrl+S` | open persisted session picker | `sessionPersistence.list/inspect`, then `agents.resume` |
| `Ctrl+X` | open key reference | local overlay; chosen because Windows Terminal does not reliably distinguish control punctuation |
| `Ctrl+C` | cancel active turn; when idle with a draft, clear draft; when idle/empty, request quit on second press | `agent.cancel` or local state; double action is shown before execution |
| `Ctrl+M` | prompt focused: toggle multiline; scrollback focused: model picker | local composer / `agentDefaultModel` |
| `Shift+Tab` | cycle the advertised permission presets | `permissionPresets.names/current/set`; never cycles invented Grok modes |
| `Tab` | move composer ↔ scrollback, or walk the active blocking card | local focus state |
| `Esc` | close top non-blocking overlay; park a blocking card; return focus | local only; no rejection/cancellation |
| `PgUp` / `PgDn` | page scroll | transcript viewport |
| `Ctrl+U` / `Ctrl+D` | half-page up/down while scrollback is focused | transcript viewport |
| `Up` / `Down` | previous/next visual block in scrollback; prompt history when composer is focused and empty | local viewport/history |
| `Left` / `Right` | collapse/expand focused block | local presentation only |
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
| `Enter` | choose/advance; submit on final valid question |
| `Esc` | clear current selection, then park focus; never dismisses the question |

Required questions cannot submit empty. `plan-review` intent highlights the configured approve option; every other answer declines according to the real dsh intent contract.

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
| `/model` | local | select and save next-session default; clearly labels that the live agent is unchanged |
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
- The acceptance fixture is `中文 CJK，ＡＢ。` plus combining and emoji cases. The M0 baseline measures the first string as 16 cells and wraps it 8+8 without half-glyph clipping.
- ASCII whale/logo characters are all one-cell ASCII. Box-drawing borders have a plain ASCII fallback for terminals whose width probe disagrees.
- Screen reader mode is not claimed in v1, but status text does not depend on spinners or color alone.

Windows Terminal is the supported Windows emulator; legacy conhost receives a warning and best-effort monochrome mode. Terminal rationale: Grok `21-terminal-support.md:51-68,81-105,174-181`.

## 8. Session picker and P1 panels

The session picker lists title (or shortened id), cwd, creation/update fact when available, and current-session marker. It uses metadata listing first and loads details lazily. `Enter` resumes, `Esc` returns, and `/new` creates a new session. It does not search transcript content in v1 and never deletes sessions.

P1 subagent and workflow views are collapsible trees derived from durable ids. They show state, label, child id, phase/outcome, and timing when available. They do not permit multi-session parallel dispatch. This adopts the navigation clarity of Grok `17-sessions.md` and `23-dashboard.md:27-111` while rejecting the latter's concurrent dashboard behavior.

All UX decisions above have a concrete dsh seam or an explicit omission; none remain pending.
