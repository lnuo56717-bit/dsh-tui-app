# dsh-tui-app

An out-of-tree, same-process full-screen TUI bundle for DeepSeek Harness. M1 provides the profile/bundle seam, clean alternate-screen lifecycle, a responsive empty shell, and the minimal durable event fold. Composer, complete streaming/tool rendering, approvals, and resume are later milestone work.

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

M1 exit keys are `q`, `Esc`, and `Ctrl+C`. Flags are `--resume`, `--theme`, and `--color`; `--resume` is parsed but intentionally deferred to M3.

## Development

```powershell
npm run check
npm test
npm run test:ac
```

The colored whale is generated at build time from the official DeepSeek GitHub avatar using Chafa 1.18.2. See `NOTICE` and `PROVENANCE.md`. Chafa is not a runtime dependency.

## M1 limitations

- The transcript fold renders committed `user/message` and `assistant/message` text only.
- Streaming chunks, Markdown, tool trees, approvals, questions, input, and session resume are explicitly outside M1.
- This independent project is not affiliated with or endorsed by DeepSeek.
