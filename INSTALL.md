# Installation and troubleshooting

## Install into an isolated profile

Build from this repository, then prepare a side-by-side Browser Host from the already installed alpha.2 Host:

```powershell
Set-Location C:\absolute\path\to\dsh-tui-app
dsh --version # Session V3, Teams and Browser Use require 0.1.6-alpha.2
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
npm install
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-browser-host.ps1
```

The resulting profile bundle order must be:

```text
@deepseek-ai/dsh-base
dsh-tui-app
```

The helper copies `.alpha2-host` into `.browser-host`; it does not download dsh again. It installs exact Browser Use `0.1.6-alpha.2` plus `@playwright/mcp@0.0.80` inside the copied Host with Chromium download disabled. This co-location is required so the Provider and active Harness share the same physical `dsh-scope` module; the runtime refuses unsafe multi-Session registration when they differ.

Verify parsing without entering alternate-screen mode:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\with-browser-host.ps1 dsh --profile tui --help
```

Then start in the workspace the agent should use:

```powershell
Set-Location C:\path\to\your\workspace
powershell -ExecutionPolicy Bypass -File C:\absolute\path\to\dshtui\scripts\with-browser-host.ps1 dsh --profile tui
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
- Host version mismatch: this checkout targets exact `dsh-v0.1.6-alpha.2`. Use the side-by-side gate below before switching the existing launcher.
- “Agent Teams service is unavailable”: confirm `dsh --profile tui --dump-config` contains both `agent-team` and `tool-agent-team`, and that the four legacy subagent-control rows are disabled.
- “Browser unavailable”: open `/browser` for the exact reason. Check `DSH_TUI_BROWSER` is not `off`, or point `DSH_TUI_BROWSER_EXECUTABLE` at an existing Chrome/Edge executable. An invalid explicit path is reported without preventing the TUI from starting.
- “active dsh Host does not contain the pinned Playwright MCP provider” or a `dsh-scope` identity error: run `scripts/prepare-browser-host.ps1` and launch through `.browser-host`; do not copy packages into the source checkout.
- Browser recovery switch: set `$env:DSH_TUI_BROWSER='off'` before launch. Browser Center remains available as a disabled diagnostic surface; Teams and ordinary TUI work continue.
- Missing status item: open `/session-info`. If the item is still absent, the corresponding host projection capability is not composed or has not reported a value; the TUI intentionally does not synthesize one.
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

AC-1 through AC-5 use isolated `DSH_HOME` directories under the repository. Generated acceptance artifacts are gitignored. To exercise Session V3 without replacing the daily launcher, install a prefix-local copy and prepend it for the gate:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-browser-host.ps1
npm run test:gate:browser
```

## Make bare `dsh` open this TUI

On this Windows local-workspace installation, run the idempotent helper once:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-browser-command.ps1
```

It points the argument-aware wrapper at `.browser-host`: bare `dsh` becomes `dsh --profile tui`, while `dsh --help`, `dsh web`, `dsh plugin ...`, and every other explicit invocation retain upstream behavior. The working 0.2.0 wrapper is saved as `dsh.cmd.pre-0.2.0` before the switch.

Do this only after `test:gate:browser` passes. Restore 0.2.0 with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\rollback-0.2.0.ps1
```

Keep the prior alpha.1 wrapper/Profile/credential backups until the new bare-command PTY check also passes.

To restore the saved alpha.1 wrapper, Profile manifests, and credentials in one step:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\rollback-alpha1.ps1
```

The script reads Profile backups from `$HOME\.dsh\backups`; backups are kept outside `$HOME\.dsh\profiles` so Harness never mistakes them for runnable profiles.
