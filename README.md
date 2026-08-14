# dsh-tui-app

`dsh-tui-app` is an independent, out-of-tree full-screen terminal interface for DeepSeek Harness. It runs in the same process as the existing `dsh` host, reads the durable session event stream directly, and uses host projections only for auxiliary status facts. The Chafa-generated DeepSeek whale is its one visual signature.

## What ships

- Streaming transcript reconciliation, terminal Markdown, tool trees, diffs, workflows/jobs, raw-event fallback, and grapheme-safe CJK layout.
- Multiline prompt editing, queued follow-ups, explicit steering, dsh/local slash-command discovery, approvals, structured questions, and durable resume/switch.
- Projection-backed model/session/permission/token/context/stats/plan/todo status. Missing capabilities stay hidden; no cost or billing data is invented.
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
| `Ctrl+M` / `Alt+Enter` | toggle multiline / send multiline |
| `Ctrl+L` | steer the current or next step |
| `Ctrl+W`, `Ctrl+U`, `Ctrl+K` | delete word / to line start / to line end |
| `Ctrl+P` or `?` | open fuzzy dsh + local command palette |
| `Ctrl+S` | open persisted session picker |
| `Ctrl+X` | open the complete in-app key page |
| `Shift+Tab` | cycle only permission presets advertised by dsh |
| `Tab` | move between composer, blocking card, and transcript |
| `PgUp`, `PgDn` | page transcript scrollback |
| `Ctrl+U`, `Ctrl+D` | half-page scroll while transcript is focused |
| `Esc` | close an overlay or park a blocking card without answering it |
| `Ctrl+C` | cancel a running turn; otherwise clear draft; press twice when idle/empty to quit |

Approvals use `y`/`1` (allow once), `n`/`2` (reject), or `3` (change the real permission preset and then allow once). Questions use arrows, digits, Space for multi-select, `z` for free text, and Enter to advance/submit.

Useful local commands include `/new`, `/resume`, `/session-info`, `/rename`, `/model`, `/theme`, `/workflows`, `/keys`, `/help`, and `/quit`. Commands advertised by dsh execute through the host command registry; exact-name collisions remain visibly separate as `[dsh]` and `[tui]` entries.

## Web UI comparison

| Capability | dsh-tui v1 | Harness Web UI |
|---|---|---|
| One active root session, new/resume/switch | Yes | Yes |
| Streaming messages, tools, diffs, workflows | Terminal-native compact tree | Rich browser presentation |
| Approvals and structured user questions | Keyboard-first, fail-closed | Browser controls |
| Projection status (tokens/context/stats/plan/todos) | Compact footer + `/session-info` | Rich panels |
| Themes | Abyss/Pearl + capability fallbacks | Browser theme system |
| CJK and grapheme-safe editing | Yes, Windows Terminal validated | Browser text engine |
| Image/media rendering | Metadata placeholder only | Rich media surfaces |
| Mouse, transcript search, multi-root dashboard | Not in v1 | Available or better suited to Web UI |
| Remote/browser attachment and DOM slots | Deliberately not used | Native architecture |

## Responsive behavior

At 120×40 the transcript remains the dominant continuous surface. At 80×24 the header collapses to the title, tool/workflow cards become one-line summaries, and the help row shows three context-relevant keys. Below 60 columns borders use plain ASCII and long cwd/title/status text is middle-ellipsized by terminal display cells. Detailed token composition remains available in `/session-info`.

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
- Reasoning stays collapsed to a bounded disclosure; transcript block expansion and mouse interaction are not v1 features.
- `@` remains ordinary prompt text because rc.6 has no host-safe general attachment-picker seam.
- Images render as attachment labels, not terminal pixels. The whale is a pre-generated ASCII asset.
- No transcript-content search, multi-root dashboard, remote attach, ACP bridge, persistent per-command grants, or invented `/auto` policy.
- Workflow/subagent views are read-only durable summaries. They do not dispatch concurrent root sessions.
- `auto` does not send a blocking terminal-background query; when detection is unreliable it chooses Abyss.

This project is independent and is not affiliated with or endorsed by DeepSeek. Logo provenance and trademark boundaries are documented in [NOTICE](./NOTICE) and [PROVENANCE.md](./PROVENANCE.md).
