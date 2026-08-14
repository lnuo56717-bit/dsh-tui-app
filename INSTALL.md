# Installation and troubleshooting

## Install into an isolated profile

Build from this repository, then let the existing `dsh` plugin manager compose the `tui` profile:

```powershell
Set-Location C:\absolute\path\to\dsh-tui-app
npm install
npm run build
dsh plugin --profile tui add "C:\absolute\path\to\dsh-tui-app"
```

The resulting profile bundle order must be:

```text
@deepseek-ai/dsh-base
dsh-tui-app
```

Verify parsing without entering alternate-screen mode:

```powershell
dsh --profile tui --help
```

Then start in the workspace the agent should use:

```powershell
Set-Location C:\path\to\your\workspace
dsh --profile tui
```

`cwd` is captured from the launch directory for new sessions. To resume, pass the opaque id shown in the status bar or session picker:

```powershell
dsh --profile tui --resume <session-id>
```

## Terminal choices

Windows Terminal is the validated Windows host. UTF-8, alternate-screen support, and a Unicode-capable monospace font are required for the intended presentation.

```powershell
dsh --profile tui --theme abyss --color truecolor
dsh --profile tui --theme pearl --color 256
dsh --profile tui --color mono
$env:NO_COLOR = '1'; dsh --profile tui
```

`auto` recognizes common `COLORTERM=truecolor` and `TERM=*-256color` signals. It does not probe the terminal background; an undetectable theme background safely resolves to Abyss.

## Diagnostics

- “profile tui does not exist”: run the `dsh plugin --profile tui add <absolute-path>` command above.
- “interactive TTY is required”: launch directly inside Windows Terminal, not through redirected stdin/stdout.
- Missing status item: open `/session-info`. If the item is still absent, the corresponding rc.6 projection capability is not composed or has not reported a value; the TUI intentionally does not synthesize one.
- Incorrect colors: force `--color 256`, `--color 16`, or `--color mono`. `NO_COLOR` wins over the flag.
- Narrow layout: use at least 80×24 for the validated compact view or 120×40 for the full workbench and whale.
- Dirty Harness checkout: this plugin never requires Harness source edits. Confirm that the plugin path points to this independent repository.

Run release checks from this repository with:

```powershell
npm run check
npm test
npm run build
npm run test:ac:all
```

AC-1 through AC-5 use isolated `DSH_HOME` directories under the repository and the already-installed launcher. Generated acceptance artifacts are gitignored.

## Make bare `dsh` open this TUI

On this Windows local-workspace installation, run the idempotent helper once:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-default-command.ps1
```

It builds the project, installs the real `tui` profile, and adds an argument-aware branch to the resolved `dsh.cmd`: bare `dsh` becomes `dsh --profile tui`, while `dsh --help`, `dsh web`, `dsh plugin ...`, and every other explicit invocation retain upstream behavior. The original wrapper is saved beside it as `dsh.cmd.pre-dsh-tui`; restore that file to undo the default routing. Re-run the helper if a future launcher installation replaces the wrapper.
