# dsh-tui Dependency and Contract Provenance

Status: final for M0. Audit date: 2026-08-14.

## 1. Dual lock and audit method

- Compile/runtime artifact contract: npm `0.1.0-rc.6`, exact versions only, no `^`, `~`, tag, workspace range, or moving URL.
- Readable source archaeology: DeepSeek Harness commit `47f943859bef60e4160492346772ded9b24f765a`.
- UX archaeology: grok-build commit `eb267feff13129e568df38fb6fdf0ceb65f735d6`.
- Artifact authority on disagreement: rc.6 `lib/types/*.d.ts`, because that is what an install compiles against.

Every tarball below was downloaded with `npm pack`, retained under `.m0-artifacts`, hashed locally with SHA-512, extracted, and checked for public declarations. All 33 contain `lib/types/*.d.ts`; none contains `src/`. The hashes match npm `dist.integrity` for the 21 initially audited runtime seams and are computed over the exact registry tarballs for the 12 event-contract owners.

## 2. Direct `@deepseek-ai/dsh-*` package set

These are the repository's direct profile/app/fold/type-contract packages. All will be pinned to the exact version shown. Event-owner packages are direct type-contract inputs so declaration merging cannot depend accidentally on a transitive import.

| Package | Version | `dist.integrity` / tarball SHA-512 |
|---|---|---|
| `@deepseek-ai/dsh-base` | `0.1.0-rc.6` | `sha512-SR0V0Lq4Bm2ir7k2OaiINZZWFSDt1n4dS8J6IlIabYhoIF46baEQY2awZ9/InOWCe+dIpQob0/3y3yZOHqjnpw==` |
| `@deepseek-ai/dsh-cmdline` | `0.1.0-rc.6` | `sha512-dqRHF+kIlTBwt+fio/34ttp6B7Lrpm31A+EOoEwBuwaziiHTEAWVl50hS53dPFmPyVBRINavBdx7Fa7UT2/2iw==` |
| `@deepseek-ai/dsh-agent` | `0.1.0-rc.6` | `sha512-vtqq2pWTrzn0dKfj5kREZRpP82AwtGjGx9V1lYnKvF+Uc/a8zyWbSvjDE7V1d3YQAQJzs2cWO31hURWDekDXIA==` |
| `@deepseek-ai/dsh-agent-default-model` | `0.1.0-rc.6` | `sha512-5Fl15p5mHVMlp69Ea0qeS81ej1Bt9vSJtCed+gjvzkKzv5y3VbJQ8PPBV34F1rTSyhTtjj5Q7TuDugQI5ZpjfA==` |
| `@deepseek-ai/dsh-agent-presets` | `0.1.0-rc.6` | `sha512-LtDz0TYE7YNhJOhMDZ8s45xQG57bWF4F1SN3tjYDosaBdINIRTxJ0O80BC+KeliqFDw071ZNOzTUEelwEAIx7w==` |
| `@deepseek-ai/dsh-attachment` | `0.1.0-rc.6` | `sha512-3P6N17NQ8jqSQGzeCs+svCIqArU8oq0YmgEAo+axN9aVuUDferWU4DLRSX59UGpmyldX4LQn81toA+c+DqMcHg==` |
| `@deepseek-ai/dsh-command-feedback` | `0.1.0-rc.6` | `sha512-VGVszTifY/LkgrTOctj8FRCVm62fwLZEGUan8rTqxLwIWYt7JZ9avckTtuB3Ls62hNBKGSAdbZ7fgH4n8KKMxQ==` |
| `@deepseek-ai/dsh-commands` | `0.1.0-rc.6` | `sha512-dq1GZmGTPXEGG01ksZ6Jj6DxAkzAbg+nepvfnM/P74d6EUcsFsEy7CfS18n0VJ6/2Wp0xOWsQyyuFElqbynO7w==` |
| `@deepseek-ai/dsh-compaction` | `0.1.0-rc.6` | `sha512-Uu8qgrHom13gdwwxAnqmNuWM8MqafkRlhjQMMJYmaMVVxjEUewSJ6lwtMbUEBR5ViLsfv4pTm5TnhxNCjedBUw==` |
| `@deepseek-ai/dsh-goal` | `0.1.0-rc.6` | `sha512-cONQOvFqZmjtw5HSgbXJ5/8rZ2gHqdf69ONhH21cLFu5jJKVy9YbLt42SlD2sdGMv/co9nN8Kt9bWQiZ/96VbQ==` |
| `@deepseek-ai/dsh-hook-protocol` | `0.1.0-rc.6` | `sha512-ePElA9wDf8UTtXErxfE0Q5sxZ58OlerI+c8A9jP0hULAFyE8paNDkdtSr7DMPGQLMkhI0CFwcJeJc37d1L20yA==` |
| `@deepseek-ai/dsh-jobs` | `0.1.0-rc.6` | `sha512-fmyvSOVsNObmRnciuH57ZntuCSb0gflRleCeQx1ToGHRoGrR4Ndnstx33SuIXUQt6OSUhD2w2WKQTReXogpnSQ==` |
| `@deepseek-ai/dsh-llm` | `0.1.0-rc.6` | `sha512-kuFGC8bHlzGTwlRxQhXjf3CYWl8M4NzH+EYIkrW8rri4iMc9W53xrdvkil5No/DUlMm8g1u7GdeiWYFy0TMvtA==` |
| `@deepseek-ai/dsh-llm-retry` | `0.1.0-rc.6` | `sha512-HdjBWcQ6spwA8B5dScRhndLQNiKoQTkq36O+kmJ80B9V4z08K5XrJwAInH9cCxJ91CqNzx/sxCdDds0oZDH1Pw==` |
| `@deepseek-ai/dsh-permission-presets` | `0.1.0-rc.6` | `sha512-enFyuj9mTN44sMAwLoiommngZSY5yp09JtKOKT541lycacUotuvlTj9W+KJ0whtIOuYQ1jdIzYnyFGnH0J10SQ==` |
| `@deepseek-ai/dsh-plan-mode` | `0.1.0-rc.6` | `sha512-kabVmxbdjLSJkY3bM0s+VuDBuIhPNvKdW8CHXz/UmpQfm2KNfrS46+EEgDgRnz2xFxfAGLcV9KFm0iDEksE22A==` |
| `@deepseek-ai/dsh-sandbox-policy` | `0.1.0-rc.6` | `sha512-XEB7+pJZVPWmZXv27EX/4V/1noVLUF5ZHyy3EY5tC4XtEyayWKtvHL4y9OTLIYhlU4Ualv5ag8s5ueGGq3ID8Q==` |
| `@deepseek-ai/dsh-schedule` | `0.1.0-rc.6` | `sha512-83p0mxkMUWwRZkazWICbD1SZO6hKwFVb9W3adDSR4wmojJQYTnawopnwTJn+Sij0V+gvvA4wTcL4rwDgbawDHA==` |
| `@deepseek-ai/dsh-session` | `0.1.0-rc.6` | `sha512-8tu8I6VWC7050GAUXWhcEWQw4pakALQc8TlhKr52m7Y4+kIKeNt3FBgP86PaGPBtpK0p5zUPRQNkFpzZbBdxyw==` |
| `@deepseek-ai/dsh-session-persistence` | `0.1.0-rc.6` | `sha512-AbNBe+IYCbZqSHqOACVdj8QTynm2HZ0cThrEuI6nGMtlWLYLx6lzZ1rgO/56Av9mIScjyTBGJAIKhEYaMTBG9g==` |
| `@deepseek-ai/dsh-session-projection` | `0.1.0-rc.6` | `sha512-DYLALBPdEI1LZjJ4B6rdGdGY4gy+iR2+5Xh2xJoAGa/pTyN5Z55TNfvuMJrmeRBjAuDXNUQpmURbvos5rJ4veg==` |
| `@deepseek-ai/dsh-session-stats` | `0.1.0-rc.6` | `sha512-B2Rwp1klSl7DmRpViPnuIlmlPgsARdxqRpsz7MwoXTC1oKYipWgoCw8JFOsDxVj8Rno1o1kWVjVAM10I/FC1aw==` |
| `@deepseek-ai/dsh-session-title` | `0.1.0-rc.6` | `sha512-RHV1ujuomvQB63HPI/n25c2/2It5XQ7zNQKozSqYOPQw7AIr16PT9iFqC7sCQ4l2gAY5GI3FbI1cQgHzjHNOag==` |
| `@deepseek-ai/dsh-session-title-llm` | `0.1.0-rc.6` | `sha512-BiqsXDSbyZbQ1XtLhKpILKdnDgZaQKWopZpSQW+Cy6i0wozMJ/xeO+oCWEFn0rQtsgBY6b+rKVKUW4wc7u9Ydg==` |
| `@deepseek-ai/dsh-subagent` | `0.1.0-rc.6` | `sha512-vROmBDAlaFAzzSlTBOlvg/7fO55zxhUztnLtB3lKmN5RevrNQBjTsbeIMDQ8ow5ZplxEOnLU+sikFoA5JaoH8A==` |
| `@deepseek-ai/dsh-token-meter` | `0.1.0-rc.6` | `sha512-qU5FT4n1RJXP3Ss8NJ5TTvPo8rZ6cxcrCedp1t0sTAj93SGssAanq47voSmznPP52nwz/SLeunznAIT0jhbsZQ==` |
| `@deepseek-ai/dsh-tools` | `0.1.0-rc.6` | `sha512-Tu08EPK3JyK0iNjH4FGzu/1uADynNSS6SmwOLdfytUN0YNqwNuKFSt2OJUg19famNlTgy992DcHfDu0T+gLXFg==` |
| `@deepseek-ai/dsh-tool-todo` | `0.1.0-rc.6` | `sha512-ll9xmgkrV6nsxjEZn5+YkNwQei7WrMMisnbr9mAKmqN5vpyOVHXisLvKdiASEmgpm4rsicnR8Y0wcBUfbeJTxA==` |
| `@deepseek-ai/dsh-tool-workflow` | `0.1.0-rc.6` | `sha512-w/D4RuFwxcx39Ryb//RFkSi1hp/QFVX/m6K7dFZ8HFdJVyu5otg5RJqvlDO55QNNLA8EndUOnc1GHl691MEDpg==` |
| `@deepseek-ai/dsh-user-approval` | `0.1.0-rc.6` | `sha512-9rnkSDGOpu2XUeGwbPeTzVUTFWTND1PMPM5L/ZQPptV5yyZlQiNxM2rCC6OdL+ZVerwxEqrRhZIQn/KVtQfKag==` |
| `@deepseek-ai/dsh-user-questions` | `0.1.0-rc.6` | `sha512-5vG4Ug+hVQuwU4KN7CFpF9qObBEYY/mPe1FHhToYO8Y2ICdHt3eX0Or9oEJFW68bZAMfuiAshZL8oUubr7obRg==` |
| `@deepseek-ai/dsh-web-search-deepseek` | `0.1.0-rc.6` | `sha512-+p3eOiUIN5Gk8KLjgAgIXmC6Y/db7LDb1TQ+iCAxz/zNJ2vbGVAoP+Br2jSUA1vbUdHTj49zTEWAQKaebuldCw==` |
| `@deepseek-ai/dsh-workflow` | `0.1.0-rc.6` | `sha512-zpTqaEp5/aXp3Zj5OfpZpTZxncak8af0FSSCOj5e6Eo6+o6cW2Y48fPk5Rl9Dzcbm/x4Y4PZfJSyqazeA27YeA==` |

Non-dsh UI dependencies will also use exact versions and a committed lockfile. They are outside AC-7's dsh package registry.

## 3. Contract cross-check table

Paths below are relative to the extracted rc.6 `package/` directory. The source column is the readable `47f9438` location. “Match” means names, parameter/payload shape, value union, and stated invariant agree; emitted declaration flattening and shifted line numbers are not semantic differences.

| Contract used by task/docs | rc.6 declaration evidence | Source reference | Result |
|---|---|---|---|
| app argv and exit | `dsh-cmdline/lib/types/index.d.ts:24-45,89` | `packages/boot/cmdline/src/index.ts:45-48` | match |
| agent registry context, create/resume/handle | `dsh-agent/lib/types/index.d.ts:26-39,65-195,276-296` | `packages/core/agent/src/index.ts:36-49,80-175,405-429` | match |
| Agent session/status/input/cancel/idle | `dsh-agent/lib/types/runtime-types.d.ts:60-123` | `packages/core/agent/src/runtime-types.ts:60-132` | match |
| session firehose, immutable events, seq, store list | `dsh-session/lib/types/index.d.ts:66,174-176,336,392-397` | `packages/core/session/src/index.ts:66-76,553-566,792-830,1055-1063` | match |
| event envelope, surface operations, seq/source fields | `dsh-session/lib/types/types.d.ts:223-353,371-435` | `packages/core/session/src/types.ts:230-435` | match |
| persistence prepare/load/inspect/read/list | `dsh-session-persistence/lib/types/index.d.ts:118-187` | `packages/session/session-persistence/src/index.ts:118-187` | match |
| projection map/change/snapshot | `dsh-session-projection/lib/types/types.d.ts:16`; `lib/types/index.d.ts:144,153` | `packages/session/session-projection/src/types.ts:16-18`; `src/index.ts:144-153` | match |
| approval waterfall, request fields, outcome union, policy | `dsh-user-approval/lib/types/index.d.ts:24,37-64,81,104-124,152,171`; `lib/types/types.d.ts:23-29` | `packages/interaction/user-approval/src/index.ts:24,44-71,141-171`; `src/types.ts:14-29` | match |
| user-question request/provider/items/answers/plan-review | `dsh-user-questions/lib/types/index.d.ts:20-62`; `lib/types/types.d.ts:8-60` | `packages/interaction/user-questions/src/index.ts:20-62`; `src/types.ts:8-60` | match |
| command discovery/execute and durable pair | `dsh-commands/lib/types/index.d.ts:83,110`; `lib/types/types.d.ts:67-100` | `packages/interaction/commands/src/index.ts:83-110`; `src/types.ts:67-100` | match |
| permission select/current/set | `dsh-permission-presets/lib/types/index.d.ts:107-162`; `lib/types/types.d.ts:25-40` | `packages/interaction/permission-presets/src/index.ts:42-57,107-162` | match |
| default model read/save | `dsh-agent-default-model/lib/types/index.d.ts:40-55` | `packages/core/agent-default-model/src/index.ts:40-55` | match |
| plan get/set and projection | `dsh-plan-mode/lib/types/index.d.ts:36-38,88-116`; `lib/types/types.d.ts:11-24` | `packages/plan/plan-mode/src/index.ts:46-53,80-116` | match |
| title event/get/rename/refresh/projection | `dsh-session-title/lib/types/index.d.ts:39-73,140-176`; `lib/types/types.d.ts:14-18` | `packages/session/session-title/src/index.ts:39-100,140-176` | match |
| known projection keys used in status/P1 | `dsh-token-meter/lib/types/projection.d.ts:67-71`; `dsh-session-stats/lib/types/types.d.ts:39`; `dsh-tool-todo/lib/types/types.d.ts:19`; `dsh-subagent/lib/types/projection-types.d.ts:46-57` | corresponding package `src/types.ts`/projection files | match |
| seven `StreamChunk` variants | `dsh-llm/lib/types/types.d.ts:259-297` | `packages/llm/llm/src/types.ts:283-303` | match |
| core 12 session event payloads | `dsh-session/lib/types/types.d.ts:223-353` | `packages/core/session/src/types.ts:236-332` | match |
| agent/inbox and agent-preset events | `dsh-agent/lib/types/types.d.ts:16-24`; `dsh-agent-presets/lib/types/session.d.ts:24-26` | `packages/core/agent/src/types.ts:12-25`; `packages/preset/agent-presets/src/session.ts:18-27` | match |
| approval/command/permission/plan events | owning packages' `lib/types/{index,types}.d.ts` at event declarations | corresponding interaction/plan source locations in `EVENT-SPEC.md` | match |
| compaction four-event protocol | `dsh-compaction/lib/types/types.d.ts:20-96` | `packages/compaction/compaction/src/types.ts:16-88` | match |
| code dispatch pair | `dsh-tools/lib/types/types.d.ts:11-52` | `packages/core/tools/src/types.ts:10-56` | match |
| feedback/goal/hook/retry events | `dsh-command-feedback/lib/types/index.d.ts:18-20`; `dsh-goal/lib/types/domain.d.ts:51`; `dsh-hook-protocol/lib/types/types.d.ts:18-38`; `dsh-llm-retry/lib/types/types.d.ts:7-47` | corresponding locked source files cited in `EVENT-SPEC.md` | match |
| sandbox/schedule/title-LLM events | `dsh-sandbox-policy/lib/types/session-mode.d.ts:31-35`; `dsh-schedule/lib/types/types.d.ts:178`; `dsh-session-title-llm/lib/types/index.d.ts:11-29` | corresponding locked source files cited in `EVENT-SPEC.md` | match |
| subagent descriptor | `dsh-subagent/lib/types/descriptor.d.ts:34-88` | `packages/subagent/subagent/src/descriptor.ts:28-88` | match |
| tool-workflow four-event lifecycle | `dsh-tool-workflow/lib/types/types.d.ts:13-54` | `packages/workflow/tool-workflow/src/types.ts:13-62` | match |
| DeepSeek auxiliary search request | `dsh-web-search-deepseek/lib/types/provider.d.ts:38-64` | `packages/web/web-search-deepseek/src/provider.ts:52-83` | match |

## 4. Deviations and archaeology record

1. **Registry/source detachment.** Public source stops at manifests marked rc.5; npm publishes rc.6 without `gitHead`. rc.6 tarballs contain built JS/declarations but no source. Bit-for-bit source equivalence is therefore unprovable. The accepted dual lock provides contract-level, not source-level, equivalence.
2. **Emission/line drift only.** Rollup/TypeScript moves and flattens declarations (for example `SessionProjectionMap`) and changes line numbers. The audited names, fields, unions, and method signatures match. No semantic d.ts/source drift was found in the seams above.
3. **StreamChunk count comment.** The reference `PartialAccumulator` comment says six variants, while both source and rc.6 d.ts define seven. Its visibility predicate/switch handles five block variants and treats `usage`/`finish` as non-visible. The approved resolution is seven protocol variants = five visible + two control/stat; recorded in `EVENT-SPEC.md`.
4. **Benchmark-machine launcher.** The pre-existing `dsh` command points at the shared locked-source checkout whose manifest says rc.5. Per the user's instruction, no second launcher is downloaded or installed. This does not change the plugin's exact rc.6 package/artifact contract or release target; M1 launcher smoke must record this environment fact alongside the rc.6 profile lock.
5. **Prior blocker reports retained.** `M0-BLOCKER.md`, `M0-BLOCKER-NPM.md`, and `M0-BLOCKER-STREAMCHUNK.md` are audit history. v1.2 and the user's approval supersede their stop conditions; they are not deleted or rewritten.

No audited semantic contract mismatch remains. A future semantic difference in event parameters, `ApprovalOutcome`, projection API, or seq invariants triggers the task-book stop rule; new upstream releases are not adopted automatically.

## 5. Reverification

Tarballs are under `.m0-artifacts/tarballs` and `.m0-artifacts/evidence-tarballs`; extracted declarations are under the sibling `unpacked` directories. Recompute a stored digest in PowerShell with:

```powershell
$bytes = [IO.File]::ReadAllBytes('<artifact>.tgz')
$sha = [Security.Cryptography.SHA512]::Create()
'sha512-' + [Convert]::ToBase64String($sha.ComputeHash($bytes))
```

The source reference was inspected read-only. No file, commit, package, or generated artifact was written to `D:\deepseek-harness`.

## 6. Chafa-generated DeepSeek whale

The M0 hand-drawn whale was rejected and is superseded by a reproducible build-time asset pipeline:

| Item | Locked value |
|---|---|
| Generator | Chafa `1.18.2` |
| Official project | `https://github.com/hpjansson/chafa` |
| Windows build artifact | `chafa-1.18.2-1-x86_64-windows.zip` |
| Artifact SHA-256 | `dcd3245c31851eef11eb077fefc12c6c76f3b0616754f0275fa8c3cb1e694165` |
| Logo owner/source | DeepSeek official GitHub organization avatar, org id `148330874` |
| Source URL | `https://avatars.githubusercontent.com/u/148330874?v=4&s=512` |
| Source SHA-256 | `55e6e0c1ba0c453749211368b8a26e00f470b4ab696ce1fed539d70777d4aab1` |
| Character command | symbols, `30x14`, stretch, fg-only, invert, ASCII class, median extractor, no dithering |
| Runtime asset | `src/ui/logo.generated.ts` (three blue tiers plus a no-color fallback) |

`scripts/generate-logo.mjs` verifies the image digest before invoking Chafa and emits only terminal character/color data. Chafa itself and the source PNG are not included in the published package `files` list. Chafa's LGPL-3.0-or-later license and the DeepSeek trademark/non-endorsement notice are recorded in `NOTICE`. The use is for this independent local Harness UI and does not claim DeepSeek affiliation or endorsement.
