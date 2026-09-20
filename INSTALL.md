# Installation and troubleshooting

## Install into an isolated profile

Build from this repository, pin Cua Driver, then prepare a side-by-side Computer Host from the already installed alpha.2 Host:

```powershell
Set-Location C:\absolute\path\to\dsh-tui-app
dsh --version # Session V3, Teams and Computer Use require 0.1.6-alpha.2
npm install
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-cua-driver.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-computer-host.ps1
```

The resulting profile bundle order must be:

```text
@deepseek-ai/dsh-base
dsh-tui-app
```

The Host helper copies `.alpha2-host` into `.computer-host`; it does not download dsh again. It installs exact Computer Use and Cua Driver MCP Provider `0.1.6-alpha.2` packages inside the copied Host. This co-location is required so the Provider and active Harness share the same physical `dsh-scope`/`dsh-tools` modules; the runtime refuses unsafe scoped registration when they differ. It creates a separate `tui-computer` profile and leaves the 0.2.1 `tui` profile in place.

`prepare-cua-driver.ps1` uses the official `0.28.2` installer, pins and verifies the installer/module/release SHA-256 values, preserves telemetry and autostart intent, and keeps the `0.17.0` release directory for rollback. If an elevated old daemon survives the installer junction switch, the helper replaces only the exact daemon PID reported by Cua Driver and verifies a new PID, `standard` mode and `doctor` health. It never calls `revoke --all`.

Verify parsing without entering alternate-screen mode:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\with-computer-host.ps1 dsh --profile tui-computer --help
```

Then start in the workspace the agent should use:

```powershell
Set-Location C:\path\to\your\workspace
powershell -ExecutionPolicy Bypass -File C:\absolute\path\to\dshtui\scripts\with-computer-host.ps1 dsh --profile tui-computer
```

`cwd` is captured from the launch directory for new sessions. To resume, pass the opaque id shown in the status bar or session picker:

```powershell
dsh --profile tui-computer --resume <session-id>
```

## Terminal choices

Windows Terminal is the validated Windows host. UTF-8, alternate-screen support, and a Unicode-capable monospace font are required for the intended presentation.

```powershell
dsh --profile tui-computer --theme abyss --color truecolor
dsh --profile tui-computer --theme pearl --color 256
dsh --profile tui-computer --color mono
$env:NO_COLOR = '1'; dsh --profile tui-computer
```

`auto` recognizes common `COLORTERM=truecolor` and `TERM=*-256color` signals. It does not probe the terminal background; an undetectable theme background safely resolves to Abyss.

## Diagnostics

- “profile tui-computer does not exist”: run `scripts/prepare-computer-host.ps1` or `dsh plugin --profile tui-computer add <absolute-path>` through `.computer-host`.
- “interactive TTY is required”: launch directly inside Windows Terminal, not through redirected stdin/stdout.
- Host version mismatch: this checkout targets exact `dsh-v0.1.6-alpha.2`. Use the side-by-side gate below before switching the existing launcher.
- “Agent Teams service is unavailable”: confirm `dsh --profile tui-computer --dump-config` contains both `agent-team` and `tool-agent-team`, and that the four legacy subagent-control rows are disabled.
- “Computer unavailable”: open `/computer` (or `/browser`) for the exact reason. Check `DSH_TUI_COMPUTER` is not `off`; optionally point `DSH_TUI_CUA_EXECUTABLE` at an existing file. An invalid explicit path is reported without preventing the TUI from starting.
- “expected exactly 0.28.2” or “catalog mismatch”: run `scripts/prepare-cua-driver.ps1`. The TUI requires the exact 57-tool MCP catalog, including `debug_window_info`; any drift fails closed.
- “active dsh Host does not contain the pinned Cua Driver MCP provider” or a module-identity error: run `scripts/prepare-computer-host.ps1` and launch through `.computer-host`; do not copy packages into the Harness source checkout.
- Computer recovery switch: set `$env:DSH_TUI_COMPUTER='off'` before launch. Computer Center remains available as a disabled diagnostic surface; Teams and ordinary TUI work continue.
- Isolated browser refusal `browser_route_unavailable`: Cua Driver requires a vendor-signed Chrome/Edge under a trusted Program Files root and proves the current token cannot modify the executable or any ancestor to that root. Fix the browser installation/ACL outside dsh-tui; do not enable unrestricted mode. Existing-profile attachment remains unsupported by design.
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
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-computer-host.ps1
npm run test:gate:computer
```

## Make bare `dsh` open this TUI

On this Windows local-workspace installation, run the idempotent helper once:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-computer-command.ps1
```

It points the argument-aware wrapper at `.computer-host`: bare `dsh` becomes `dsh --profile tui-computer`, while `dsh --help`, `dsh web`, `dsh plugin ...`, and every other explicit invocation retain upstream behavior. The working 0.2.1 wrapper is saved as `dsh.cmd.pre-0.2.1` before the switch.

Do this only after `test:gate:computer` passes. Restore 0.2.1 with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\rollback-0.2.1.ps1
```

Keep the prior alpha.1 wrapper/Profile/credential backups until the new bare-command PTY check also passes.

To restore the saved alpha.1 wrapper, Profile manifests, and credentials in one step:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\rollback-alpha1.ps1
```

The script reads Profile backups from `$HOME\.dsh\backups`; backups are kept outside `$HOME\.dsh\profiles` so Harness never mistakes them for runnable profiles.
