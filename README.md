# dsh-tui-app

An out-of-tree, same-process full-screen TUI bundle for DeepSeek Harness. The M2 build renders the durable session event stream as streaming Markdown, nested tool/workflow trees, file diffs, activities, and forward-compatible raw event placeholders. It keeps the Chafa-generated DeepSeek whale as the single visual signature.

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
```

`dsh plugin` initializes the `tui` profile with `@deepseek-ai/dsh-base`, installs this local bundle out of tree, and appends `dsh-tui-app` to the profile bundle list. It does not change Harness source.

Flags are `--resume`, `--theme`, and `--color`; `--resume` is parsed but intentionally deferred to M3.

## Keys

| Key | M2 action |
|---|---|
| `PgUp` / `Ctrl+U` | scroll toward older transcript nodes |
| `PgDn` / `Ctrl+D` | scroll toward newer transcript nodes |
| `End` | return to the live edge |
| `q` / `Esc` / `Ctrl+C` | exit and restore the terminal |

## Development

```powershell
npm run check
npm test
npm run test:ac
npm run test:ac:m2
```

The colored whale is generated at build time from the official DeepSeek GitHub avatar using Chafa 1.18.2. See `NOTICE` and `PROVENANCE.md`. Chafa is not a runtime dependency.

## M2 behavior

- The transcript subscribes before reading the immutable session snapshot, buffers the live edge, de-duplicates by `seq`, and requests a re-snapshot on a gap.
- Assistant chunks reconcile in place and are superseded by the committed assistant message without a duplicate frame.
- Markdown is tokenized without executing HTML. CJK wrapping and clipping operate on grapheme clusters and terminal display cells.
- Tool calls/results, Code Mode children, diffs, workflows, and selected runtime activities render as compact trees.
- Unknown future events render once as raw placeholders instead of crashing the process.

## M2 limitations

- Composer editing, slash commands, approvals, questions, and session switching/resume belong to M3 and are not implemented here.
- Reasoning is intentionally collapsed to a one-line disclosure in this milestone.
- Mouse support, transcript search, and multi-session awareness remain P2.
- This independent project is not affiliated with or endorsed by DeepSeek.
