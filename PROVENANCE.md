# dsh-tui dependency and contract provenance

Status: upgraded for Harness `dsh-v0.1.6-alpha.1`. Audit date: 2026-09-16.

## 1. Version lock

- Runtime/type target: npm `0.1.6-alpha.1`, exact versions only.
- Official release tag: `dsh-v0.1.6-alpha.1` at commit `0a15e36e7f82b6ed45af6fa9759f29b40dcd965d`.
- Upstream `master` observed during the audit: `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`.
- Cordis peer contract: `@deepseek-ai/cordis` `4.0.2` and `@deepseek-ai/cordis-plugin-loader` `1.0.3`.
- UX archaeology remains anchored to grok-build commit `eb267feff13129e568df38fb6fdf0ceb65f735d6`.

The release tag, rather than moving `master`, is the build authority. The alpha suffix is intentional: this is a prerelease contract and future prereleases are not adopted automatically.

## 2. Direct package integrity

| Package | Version | npm `dist.integrity` |
|---|---|---|
| `@deepseek-ai/dsh-agent` | `0.1.6-alpha.1` | `sha512-QIUJCzc0gVpwajKeKzZfvcIUToD5D2F2OzxZAqxiERblW5UfbT0V/4UEuNWSnz98ViAy1unfat/JJDx/r8FTxg==` |
| `@deepseek-ai/dsh-agent-default-model` | `0.1.6-alpha.1` | `sha512-JInU4z8DQego9bTyI6ilB+qoHnxGdLvTtbLRO+JfNmcJdsUdzrkYUv/PAVqfbQR8FqfjIpVmjQUfxvjCNZ/Lsg==` |
| `@deepseek-ai/dsh-attachment` | `0.1.6-alpha.1` | `sha512-DUjH5jIe3K3Cnkcp1+BXtCVAt3hlrjDYt7CDkWq5NVpef8dGhKUOfejRwYIO9vsSdWkKavz43OZZMTLLPAQvQw==` |
| `@deepseek-ai/dsh-cmdline` | `0.1.6-alpha.1` | `sha512-x5QH+xZFwrUQsDraq7VEFPpMtt6OlQsfRDDRVd2YaIo5K3gW8DGb2ZGLL9qtZCmsrsDxjIFKyMusIQsniMXdVw==` |
| `@deepseek-ai/dsh-llm` | `0.1.6-alpha.1` | `sha512-J6CR7lfZEDrYnmWbuN8m3Vso7pQYhBGeecT+uvF4jEsCbVeEXLNbqjOBFudlPR2BXZQI7DqG6uJ6I1doJpLIew==` |
| `@deepseek-ai/dsh-session` | `0.1.6-alpha.1` | `sha512-IUdpUwIZaQIXNrgaYr0JAwAhUuhmjzzIgrg8Q8bSQM6fO+nYHIERF/MQZHnnon7wkibtyak+Nj8RKF82boQWIA==` |

The committed `package-lock.json` is the complete transitive lock. All resolved `@deepseek-ai/dsh-*` packages in that graph are from the `0.1.6-alpha.1` line.

## 3. Contract cross-check

| Consumed seam | `0.1.6-alpha.1` contract | TUI treatment |
|---|---|---|
| Agent creation | asynchronous `agents.create()` / `resume()` and `SessionHandle` ownership | awaited and disposed through the returned handle |
| Live assistant output | process-local `agent/assistant-stream` start/chunk/end frames | displayed as an ephemeral overlay; never assigned a durable Session seq |
| Durable assistant output | one `assistant/message` or `assistant/attempt` with compact `stream` records | final message replaces the overlay; stream is validated/expanded for resumed TPS facts |
| Image request offload | durable `image/offload` preserves historical image identity while changing future request projection | treated as known non-visual metadata; the original transcript attachment remains visible |
| PTC nested tools | `tool/ptc-dispatch-start` / `tool/ptc-dispatch` retain the former code-dispatch payload and add complete `tool/result`-style settlement | folded into the existing recursive tool tree by `parentCallId`; legacy V2 names remain readable |
| New log-only facts | `model/selection`, subagent catalog/policy, deliverables, and message-feedback mutations carry no surface placement | retained in transcript metadata and omitted from raw transcript cards |
| Session-log delivery | durable `session-log-deepseek/delivery-accepted` watermarks that a log suffix was accepted by the DeepSeek request extension | treated as known non-visual metadata; not a transcript card |
| Session format | `SESSION_FORMAT_VERSION = 3`; `.events` removed | one centralized `snapshotEvents()` compatibility boundary; internal folds use an unbranded serializable view |
| Surface replacement | `{ op: 'replace', startSeq, endSeq }` | normalized to the TUI fold's `{ start, end }` form |
| Seed lineage | `meta.isSeeded` plus `inheritedEventCount` | v3 repaired copies use both fields; the old raw-rescue compatibility path retains its legacy `seedLength` input |
| Model/effort selection | agent-scoped `ModelSelectionRef` and adapter-owned effort ids | `/switch` and `/effort` continue to affect only not-yet-assembled requests |
| Structured questions | agent-scoped `user-questions/request` waterfall | answerer is installed in Agent setup; the former global provider method is optional legacy compatibility |
| Command execution | v3 adds submitted attachments before the cancellation signal | the TUI passes an empty attachment batch; the legacy three-argument call remains version-detected |
| Unknown durable events | `ignorable` distinguishes safe omission | unknown events remain visible as raw nodes; the TUI does not guess their semantics |

`src/harness-compat.ts` is deliberately the only production location that materializes a full live Session snapshot. Harness marks synchronous reads deprecated but has not yet published an asynchronous attached-consumer full-log replacement. Keeping the call isolated makes that future migration mechanical.

The old durable `assistant/chunk` event remains in the pure fold so sessions presented by an older host can still render during a staged rollout. On a v3 host, live chunks come only from `agent/assistant-stream`; the durable fold sees the compact settlement event.

## 4. Legacy torn-log rescue

Healthy historical logs are migrated by Harness before a Session is constructed. The TUI's separate rescue path also has to inspect a raw, torn v2 JSONL artifact. `src/legacy-chunk-rows.ts` therefore retains a read-only decoder for the three v2 packed row tags (`text-chunks`, `reasoning-chunks`, and `tool-call-chunks`). Its validation and expansion rules are adapted from DeepSeek Harness `packages/core/session/src/chunk-rows.ts` at the former source anchor `47f943859bef60e4160492346772ded9b24f765a` (MIT).

The decoder cannot write old rows and is not used for healthy v3 logs. A malformed packed row is skipped by the existing best-effort rescue reader; normal Session loading remains strict.

## 5. Upgrade boundary

- No file in `D:\deepseek-harness` is modified.
- The machine's existing global `dsh` launcher is not replaced or downloaded by this repository upgrade.
- Full v3 streaming behavior requires a host from the `0.1.6-alpha.1` release line. The compatibility bridge can still render legacy durable chunks, but it cannot manufacture host features an older launcher does not emit.
- Browser/computer use, remote workspaces, MCP resources/templates, teams, auto review, and other new Harness services are not silently enabled by this TUI upgrade. They require explicit UI and security design before exposure.

## 6. Chafa-generated DeepSeek whale

| Item | Locked value |
|---|---|
| Generator | Chafa `1.18.2` |
| Official project | `https://github.com/hpjansson/chafa` |
| Windows artifact SHA-256 | `dcd3245c31851eef11eb077fefc12c6c76f3b0616754f0275fa8c3cb1e694165` |
| Logo owner/source | DeepSeek official GitHub organization avatar, org id `148330874` |
| Source SHA-256 | `55e6e0c1ba0c453749211368b8a26e00f470b4ab696ce1fed539d70777d4aab1` |
| Runtime asset | `src/ui/logo.generated.ts` |

`scripts/generate-logo.mjs` verifies the source image digest before invoking Chafa and emits terminal character/color data only. Chafa and the source PNG are excluded from the published package files. Licensing and the non-endorsement notice are recorded in `NOTICE`.
