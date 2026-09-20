# dsh-tui dependency and contract provenance

Status: dsh-tui `0.2.2`, upgraded for Harness `dsh-v0.1.6-alpha.2` and Cua Driver `0.28.2`. Audit date: 2026-09-20.

## 1. Version lock

- Runtime/type target: npm `0.1.6-alpha.2`, exact versions only.
- Official immutable release tag: `dsh-v0.1.6-alpha.2` at commit `ddefc45fbc7f8e46dd73185e68295696d1297887`.
- No moving `master` API is consumed; in particular, the unreleased Team `followup_task` surface is absent.
- Cordis peer contract: `@deepseek-ai/cordis` `4.0.2` and `@deepseek-ai/cordis-plugin-loader` `1.0.3`.
- UX archaeology remains anchored to grok-build commit `eb267feff13129e568df38fb6fdf0ceb65f735d6`.

The release tag, rather than moving `master`, is the build authority. The alpha suffix is intentional: this is a prerelease contract and future prereleases are not adopted automatically.

## 2. Direct package integrity

| Package | Version | npm `dist.integrity` |
|---|---|---|
| `@deepseek-ai/dsh-agent` | `0.1.6-alpha.2` | `sha512-XEOytfXmJG6dyHld3Np0IYRrVPJnuoKKx2yQ+o74a7cN89k+J61c33D7zIcDG5rLkF7sMNM608ZkhfCWJuTcjg==` |
| `@deepseek-ai/dsh-agent-default-model` | `0.1.6-alpha.2` | `sha512-7ITZJOfabWE5D3kKS3Q7nn+TGqTgza1LlLmvXw/wUnDpzAIUzcleFHsAm5Ab9BKfMdpZGfBg0qTIkyFfCA4cBA==` |
| `@deepseek-ai/dsh-attachment` | `0.1.6-alpha.2` | `sha512-dv3s/FrFuZwmcBfWzWozj9khlb8LrFSCgz/spGsEg6l9zka1Wu3ZkHDcE+CRsM+fyCD/z/jTClMOkQ2DIMw5wQ==` |
| `@deepseek-ai/dsh-cmdline` | `0.1.6-alpha.2` | `sha512-ovm0trBqB9hzqxJNYolmap7H9Dh/fqwOo7oj8z25rpJTQx9piCiuUu9r9iPYoRb9dKRKgPRVPgrYRQMfbyMLig==` |
| `@deepseek-ai/dsh-computer-use` | `0.1.6-alpha.2` | `sha512-+TOcjPBsOPh06b+snRqWKmER3s75vPwDhM3++TbCTArmnPX8/+D8ZCzL0rYpZ6LUTObVbqQZsoSWY2wasAJkNg==` |
| `@deepseek-ai/dsh-experimental-agent-team` | `0.1.6-alpha.2` | `sha512-V474u5Wk62g777o+89qbwzOxMTIwwoqTp2vmiSTBeSmY+NwTnKwVX0kgZoziu+6fATJ5DLMGv2JvNkx7ccmIRg==` |
| `@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp` | `0.1.6-alpha.2` | `sha512-FheLHW63pq5d6FpHqaRpQK+SXEGKM5KSbpJucTX0tu6ohvmuRSLcKWXkBkarekdboluUr7z404VvivsbvSB5xw==` |
| `@deepseek-ai/dsh-experimental-tool-agent-team` | `0.1.6-alpha.2` | `sha512-c3msoysF/Sq5/teFXAa9NUFcwCUjeTn+NUSX9yDtbeN+Uf8xPoC1BKt3gecsvPq9gSGurF8qvTxWSUmWcgxxPg==` |
| `@deepseek-ai/dsh-llm` | `0.1.6-alpha.2` | `sha512-kIQoqnD6jN3Z2qQ+gd0TrIwkEDfUZAPC3kkTUUv2yQm1GeDjB7JULwT1vGAKTbEqOhOpVfKhdp4wItpG5PclfA==` |
| `@deepseek-ai/dsh-mcp-resources` | `0.1.6-alpha.2` | `sha512-U4s2gczWYsAFW8iTp7u+4Le7FaGYwEFTvgwRLFBPRZAz9/swHaJ8GKin6SAp2L4yRuq3wbo2ip+HWseIrvmAfA==` |
| `@deepseek-ai/dsh-session` | `0.1.6-alpha.2` | `sha512-WQNriZEQb0ykg+SDvqvNbp/AmG/DnydY5YdkTm5u3ST+PNXSQDLkaFzlY2YFU6hEuzs1h0yGCw6qPVpVGDAm1g==` |
| `@deepseek-ai/dsh-tools` | `0.1.6-alpha.2` | `sha512-twRy/AffES124neGEpDLHjOTgcmWi8HtisTdTIm1b144LdEUBfU604A5N65muE+GfECDzyDKK/jJeLGuosMx2w==` |
| `@deepseek-ai/dsh-user-approval` | `0.1.6-alpha.2` | `sha512-PMV8LOBoO3xwXpxDHBhh7PHHSqxHCn8YmzTMeGA2VNCSsL4e4KHLuVMUKyhpsny6KdP8Y2GjBHaKg2ZxLuEbnA==` |

The committed `package-lock.json` is the complete transitive lock. All resolved `@deepseek-ai/dsh-*` packages in that graph are from the `0.1.6-alpha.2` line.

## 3. Contract cross-check

| Consumed seam | `0.1.6-alpha.2` contract | TUI treatment |
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
| Team domain | `ctx.agentTeams` exclusively owns roster, mailbox, task DAG, replay, limits, authorization, and CAS | the controller is a thin facade; it stores no parallel Team state and never retries a stale revision |
| Team tools | nine scoped alpha.2 tools with explicit-delegation policy; `freshProvider=spawn`, `forkProvider=fork` | official tool package is loaded; legacy same-name subagent controls are disabled; no unreleased `followup_task` |
| Team events | `team/member`, `team/task`, `team/message/queued`, `team/message/delivered` in the Lead Session | omitted from raw cards and folded, in seq order, into Team Activity; delivered user messages retain teammate attribution |
| Team sessions | live members are exact Agents; inactive members persist as Sessions | live read-only transcript attaches to the member stream; inactive transcript is read through a `SessionHandle` opened with `read` access and then closed |
| Team task scopes | normalized advisory path prefixes plus overlap warnings, never locks | warnings are shown verbatim and the UI always states that every member shares the same cwd |
| Human interaction routing | approvals/questions remain Agent-scoped | a 32-item FIFO accepts the active Lead and rostered teammates only; cards identify source member/session and permission changes target that exact Session |
| Computer provider | official Computer Use registry plus Cua Driver MCP Provider; Provider lifetime owns the exclusive official registration | dynamically mounted only in the armed Agent's `agent.ctx`; the Provider must resolve the Host's exact `dsh-scope` and `dsh-tools` modules |
| Driver authorization | Cua Driver `0.28.2` daemon in immutable `standard` mode | launcher strips inherited manifests/policies/grants and never passes unrestricted, bypass-approval, or existing-profile authorization flags |
| CUA catalog | the installed 0.28.2 MCP endpoint exposes 57 tools; the released list includes the additional `debug_window_info` tool | exact set equality is checked before availability and again after scoped registration; any addition, omission or rename fails closed |
| Lease lifecycle | official Provider can be mounted/unmounted; Cua desktop state is process-local | one global Agent lease, five-minute unused next-turn timeout, one-turn binding, cleanup on end/cancel/release/switch/exit, and no custom durable state |
| CUA dispatch | ordinary Harness tool pipeline plus Driver's own `standard` authorization | all exact pinned tools return TUI `allow` only for the active owner; no `approval/asked` is generated; wrong Agent, pending, paused, stopping and unknown tools deny |
| Screenshots | MCP image results use the Harness attachment pipeline | image-capable routes receive the attachment; the terminal shows its ordinary attachment label and never fabricates pixels |
| Browser posture | Cua Driver separately attests vendor signature, trusted Program Files ancestry and current-token non-writability; existing Profile needs an explicit driver grant/host | dsh-tui grants neither attach nor unrestricted mode; safe Driver refusals are surfaced unchanged and never bypassed |

`src/harness-compat.ts` is deliberately the only production location that materializes a full live Session snapshot. Harness marks synchronous reads deprecated but has not yet published an asynchronous attached-consumer full-log replacement. Keeping the call isolated makes that future migration mechanical.

The old durable `assistant/chunk` event remains in the pure fold so sessions presented by an older host can still render during a staged rollout. On a v3 host, live chunks come only from `agent/assistant-stream`; the durable fold sees the compact settlement event.

## 4. Legacy torn-log rescue

Healthy historical logs are migrated by Harness before a Session is constructed. The TUI's separate rescue path also has to inspect a raw, torn v2 JSONL artifact. `src/legacy-chunk-rows.ts` therefore retains a read-only decoder for the three v2 packed row tags (`text-chunks`, `reasoning-chunks`, and `tool-call-chunks`). Its validation and expansion rules are adapted from DeepSeek Harness `packages/core/session/src/chunk-rows.ts` at the former source anchor `47f943859bef60e4160492346772ded9b24f765a` (MIT).

The decoder cannot write old rows and is not used for healthy v3 logs. A malformed packed row is skipped by the existing best-effort rescue reader; normal Session loading remains strict.

## 5. Upgrade boundary

- No file in `D:\deepseek-harness` is modified.
- The source package never rewrites the global launcher by itself. `scripts/install-computer-command.ps1` is an explicit post-gate action and first preserves the working 0.2.1 wrapper as `dsh.cmd.pre-0.2.1`; `scripts/rollback-0.2.1.ps1` restores it.
- Full v3 streaming and Team behavior requires the exact `0.1.6-alpha.2` host. The compatibility bridge can render legacy durable chunks, but it cannot manufacture Team services on an older launcher.
- Agent Teams remains enabled with its official fixed delegation policy and shared-cwd semantics. Playwright Browser Use is removed from the default composition; Cua Driver is the only browser/desktop automation path. Existing-profile grants, unrestricted mode, Stagehand, remote workspaces and auto review remain disabled.
- A side-by-side `.computer-host` is copied from `.alpha2-host`, then receives only the pinned Computer Use dependencies. Runtime identity checks and the Computer PTY gate prove scoped one-Agent ownership before promotion. `.browser-host`, the source alpha.2/alpha.1 prefixes, wrapper backups, Profile manifests and credential backups remain rollback paths.

### Cua Driver release integrity

| Artifact | Locked value |
|---|---|
| Release tag | `cua-driver-rs-v0.28.2` (`fc188250b4ca8549b8e61f937fdb1fb560770e86`) |
| Official Windows installer SHA-256 | `3e770fa8c351b80db99ae6b080f696a22f844534498bf44d45816cbd05eb0c3f` |
| Official `_install-common.psm1` SHA-256 | `324bca98ad19f0487d4afd36a9e2d06478fcfb8e1e20225cdd8ec8ef5150e720` |
| Windows x86_64 release ZIP SHA-256 | `3c1fcf10ff9513b94e4af78ad6a216ab62aa95b2c9a3b70dfbdba9f04e021533` |
| Installed catalog | 57 MCP tools; `cua-driver list-tools` and real MCP `tools/list` agree |

The task specification expected 56 tools, but the immutable official 0.28.2 binary exposes 57. The implementation follows the artifact rather than silently omitting `debug_window_info`. The installer transport substitution is applied only after the official installer hash and exact source seam are verified; it replaces a hanging Windows PowerShell download with Node TLS while leaving official version selection, extraction, junction, registration and rollback retention logic intact.

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
