# M4 Final Delivery Report

Status: complete. Version: `dsh-tui-app 0.1.0`.

## Delivered

- Projection-backed status uses one whole `sessionProjections.snapshot(session)` cut. The listener is registered before the initial snapshot, changed-key bursts coalesce to one microtask read, and session switching replaces the whole cut instead of mixing fields.
- The status/footer renders only available model, cwd, session id/title, permissions, token usage, context pressure, session statistics, plan, and todo facts. It contains no currency logic and does not synthesize missing values. `/session-info` exposes the full available cut and context composition.
- Abyss, Pearl, and auto theme selection now match the locked CLI contract. Truecolor, 256, 16, and monochrome palettes are explicit; `NO_COLOR` wins. Terminal release emits OSC 112 cursor-color reset before restoring cursor/alternate screen.
- The in-app key page covers composer, navigation, policy, blockers, and cancellation. `/workflows` shows durable workflow/jobs plus the real `subagents.listDescendants` tree when composed.
- At 80×24 the header collapses to title, tools/workflows collapse to one-line summaries, and footer help is context-sensitive. Below 60 columns the border selection is ASCII and display-cell middle ellipsis is used. CJK, full-width punctuation, combining marks, and emoji remain grapheme-safe.
- README, detailed installation/troubleshooting guide, web UI comparison, known limitations, package contents, and Windows CI are complete.

The frontend-design guidance kept the transcript as one continuous work surface, reserved double borders for blocking human decisions, and retained the Chafa-generated whale as the only decorative signature.

## Acceptance evidence

| AC | Result | Evidence |
|---|---|---|
| AC-1 startup | pass | 120×40 real PTY; help flags present; alternate screen entered/left once; colored whale visible |
| AC-2 zero core changes | pass | independent root; shared checkout hash unchanged before/after every PTY suite |
| AC-3 end-to-end | pass | streaming, tool and unified diff observed; exact CJK/emoji file content written |
| AC-4 approvals | pass | allow executed and logged; reject did not execute; both wrote `approval/decided` |
| AC-5 sessions | pass | durable history replayed, same session id resumed, later follow-up accepted |
| AC-6 CJK | pass | 80×24 snapshot bounded; fixture width 16; no replacement/half glyph; cursor cell 7 |
| AC-7 lock | pass | all four direct dsh dependencies exact `0.1.0-rc.6`; every integrity and both source anchors present |
| AC-8 determinism | pass | batch/incremental property equivalence, duplicate-seq no-op, unknown raw fallback |

Additional M4 real PTY result: `dsh --profile tui --theme pearl --color 256` at 80×24 showed the compact header, transcript, complete key page, explicit 256-color output, no wide whale, clean terminal restoration, and no upstream mutation. Windows ConPTY consumes OSC 112 rather than echoing it into capture; the exact release sequence is asserted by the terminal lease unit test.

## Final verification

```text
npm run check       PASS
npm test            PASS — 15 files, 33 tests
npm run build       PASS
npm run test:ac:all PASS — AC-1 through AC-8
npm audit --omit=dev PASS — 0 vulnerabilities
npm pack --dry-run  PASS — 39 packaged entries
```

No additional Harness copy was downloaded. The pre-existing `dsh` launcher was used for every integration and PTY test. The shared `D:\deepseek-harness` worktree was read-only throughout; its pre-existing competitor changes remained byte-for-byte unchanged by this project.
