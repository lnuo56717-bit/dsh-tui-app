# dsh-tui-app

An out-of-tree, same-process full-screen TUI bundle for DeepSeek Harness. The M3 build adds a grapheme-safe composer, dsh/local slash-command discovery, approval and question cards, permission presets, and durable session resume/switching to the M2 event renderer. The Chafa-generated DeepSeek whale remains the single visual signature.

## Requirements

- The existing `dsh` launcher (this project does not install or replace it)
- Node.js 22 or newer
- pnpm available to `dsh plugin`
- An interactive terminal; Windows Terminal is the validated Windows host

## Build and install

```powershell
npm install
npm run build
dsh plugin --profile tui add "C:\absolute\path\to\dsh-tui-app"
dsh --profile tui --help
dsh --profile tui
dsh --profile tui --resume <session-id>
```

`dsh plugin` initializes the `tui` profile with `@deepseek-ai/dsh-base`, installs this local bundle out of tree, and appends `dsh-tui-app` to the profile bundle list. It does not change Harness source.

Flags are `--resume`, `--theme`, and `--color`. `--resume` loads durable history through `agents.resume`; it does not reconstruct transcript text from projections.

## Keys

| Key | M3 action |
|---|---|
| `Enter` | send a prompt or queued follow-up |
| `Ctrl+M` / `Alt+Enter` | toggle multiline / send multiline |
| `Ctrl+L` | steer the current or next step |
| `Ctrl+P` / `?` | open command sonar |
| `Ctrl+S` | open persisted session picker |
| `Shift+Tab` | cycle advertised permission presets |
| `Tab` | move between composer, blocking card, and scrollback |
| `PgUp` / `PgDn` | page transcript scrollback |
| `Ctrl+X` | show key reference |
| `Ctrl+C` | cancel running turn; clear draft; press twice on idle/empty to quit |

Approval cards accept `y`/`1` (allow once), `n`/`2` (reject), or `3` (change preset, then allow once). Question cards use arrows, digits, Space for multi-select, `z` for free text, and Enter to advance/submit. Esc parks a blocking card without fabricating an answer.

## Development

```powershell
npm run check
npm test
npm run test:ac
npm run test:ac:m2
npm run test:ac:m3
```

The colored whale is generated at build time from the official DeepSeek GitHub avatar using Chafa 1.18.2. See `NOTICE` and `PROVENANCE.md`. Chafa is not a runtime dependency.

## M3 behavior

- The transcript subscribes before reading the immutable session snapshot, buffers the live edge, de-duplicates by `seq`, and requests a re-snapshot on a gap.
- Assistant chunks reconcile in place and are superseded by the committed assistant message without a duplicate frame.
- Markdown is tokenized without executing HTML. CJK wrapping and clipping operate on grapheme clusters and terminal display cells.
- Tool calls/results, Code Mode children, diffs, workflows, and selected runtime activities render as compact trees.
- Unknown future events render once as raw placeholders instead of crashing the process.
- Human input becomes a real identified `UserMessage` and enters through `agent.followup` or the explicit `agent.steer` action; the UI never appends chat events itself.
- The slash menu keeps dsh and local descriptors separate when names collide. Advertised dsh commands execute through the command registry and retain durable run/done events.
- Approval outcomes are fail-closed and limited to the upstream vocabulary. Preset escalation changes the real permission service before allowing the current request.
- Session switching detaches the old transcript, disposes the owned handle, and resumes exactly one selected persisted root.

## M3 limitations

- Reasoning is intentionally collapsed to a one-line disclosure in this milestone.
- `@` remains plain text because rc.6 exposes no host-safe general attachment picker seam.
- Projection-rich status details, final theme polish, and exhaustive 80×24 CJK QA are M4 work.
- Mouse support, transcript search, and multi-root awareness remain P2.
- This independent project is not affiliated with or endorsed by DeepSeek.
