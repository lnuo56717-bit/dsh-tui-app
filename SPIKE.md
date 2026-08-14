# dsh-tui M0 Ink Spike Report

Status: final. Decision: **ADR-4 retains Ink**.

## 1. Scope and reproducibility

The spike is isolated under `.m0-spike/` and is not product implementation. It tests the four task-book gates and the 5k-fold risk on Windows x64. Commands:

```powershell
cd C:\Users\lenovo\Desktop\dshtui\.m0-spike
npm install --ignore-scripts --no-audit --no-fund
npm run spike
```

Pinned spike dependencies are Ink 7.1.1, React 19.2.8, string-width 8.2.2, strip-ansi 7.2.0, and wrap-ansi 9.0.0. Test runtime was Node v24.18.0, npm 11.16.0, pnpm 11.7.0, Windows x64, UTF-8 console output.

The real-emulator smoke launched Windows Terminal 1.24.11911.0 in a hidden window and ran `.m0-spike/wt-smoke.mjs`. Its machine-readable result is `.m0-spike/wt-report.json`.

## 2. Gate results

| Gate | Method | Observed result | Verdict |
|---|---|---|---|
| alt-screen + cleanup | emitted `CSI ?1049h` + hide cursor, forced an exception, restored show cursor + `CSI ?1049l` in `finally`; repeated in real Windows Terminal | exactly one enter and one leave in the unit probe; WT report has `enterWritten=true`, `leaveWritten=true`, `inkMounted=true`, `restoredAfterError=true` | pass |
| resize | mounted Ink against a TTY-like output, changed `columns` 25 -> 32, emitted `resize`, and measured the repaint stream at truecolor and 256 tiers | both tiers emitted 12 bytes after resize; no throw or stale instance | pass |
| truecolor -> 256 -> 16/mono | rendered the same semantic accent through explicit tier tokens (`#178BFF`, `ansi256(33)`, `cyan`) in isolated child processes and inspected ANSI | found `38;2;r;g;b`, `38;5;n`, and ANSI-16 foreground sequences; plain text survives stripping | pass |
| CJK wcwidth/wrap/cursor | measured `中文 CJK，ＡＢ。`, prefix cursor columns, and hard-wrapped at 9 cells | total 16 cells; prefix columns `2,4,5,6,7,8,10,12,14,16`; wrapped as two 8-cell lines; reconstructed text unchanged | pass |
| Windows Terminal parity | real WT process, Ink mount on `process.stdout`, terminal facts captured before exit | `WT_SESSION` present, `isTTY=true`, 120×30, `getColorDepth()=24`, terminal restored | pass |

The terminal emitted a final cursor-show sequence after the noninteractive Ink probe. This is expected Ink cleanup, not residue inside a user terminal; the real WT probe independently confirms paired restoration.

## 3. Important color finding

When Ink was rendered into an in-memory stream, its global Chalk capability detection did not honor the stream's synthetic `getColorDepth()` for arbitrary RGB. Treating automatic quantization as the architecture would therefore make tests and embedded terminals environment-dependent.

The accepted design resolves a semantic theme into one of four explicit token tables before rendering:

- truecolor: RGB/hex values;
- 256: explicit `ansi256(n)` values;
- 16: named ANSI colors plus bold/dim;
- mono: no color, glyph/text distinctions only.

This design passed sequence-level tests and is recorded in `UX-SPEC.md`. Ink remains the layout/render engine; it is not the capability-policy engine.

## 4. 5k event fold pressure test

The probe generated 5,000 ordered event-shaped records, injected one duplicate seq and one unknown future type, then folded 100 measured runs after 20 warmups using seq dedupe and keyed node updates.

| Measure | Result |
|---|---:|
| supplied records | 5,002 |
| unique seqs | 5,001 |
| output nodes | 502 |
| p50 | 0.278 ms |
| p95 | 0.441 ms |
| maximum | 2.598 ms |

This demonstrates that pure folding is not the long-transcript bottleneck at the target scale. Rendering must still virtualize/window visible nodes and coalesce frame notifications; the M2 property/performance suite remains the acceptance mechanism.

## 5. ADR-4 final decision

Ink is retained because all four mandatory gates passed. The implementation constraints are final:

1. A terminal guard, outside React, owns alt-screen, cursor visibility/color, signal handling, and `finally` restoration.
2. Ink receives resize events and renders a windowed transcript; event folding is never tied to React component lifecycle.
3. Theme capability detection resolves explicit truecolor/256/16/mono tokens before passing colors to Ink.
4. All width, clipping, wrapping, selection, and cursor math uses grapheme/display-cell utilities; no `string.length` geometry.
5. Windows support targets Windows Terminal. Legacy conhost is warning/best-effort, not an acceptance platform.
6. The fallback self-drawn ANSI renderer is rejected for v1 because no gate triggered it. It is not carried as a second implementation.

There are no pending spike decisions.
