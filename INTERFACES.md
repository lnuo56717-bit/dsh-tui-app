# dsh-tui M0 Interface Contract

Status: final for M0. Runtime/type artifact lock: `0.1.0-rc.6`. Read-only source reference: `47f943859bef60e4160492346772ded9b24f765a`. Grok UX reference: `eb267feff13129e568df38fb6fdf0ceb65f735d6`.

This document is the implementation-facing source of truth for host services. `EVENT-SPEC.md` owns event folding and `PROVENANCE.md` maps every cited contract to the rc.6 declarations. The shared checkout at `D:\deepseek-harness` is evidence only and must never be changed.

## 1. Composition and ownership

The product is an out-of-tree, same-process Cordis app bundle named `dsh-tui-app`. The installed `tui` profile has the ordered bundle layers `@deepseek-ai/dsh-base`, then `dsh-tui-app`, then the user's profile/home/CLI overlays. This follows the launcher profile order in `apps/cli/README.md:31-42` and the app-provider/runner split in `packages/bundle/headless/cordis.patch.yml` plus `packages/bundle/headless/src/index.ts:96-133` at the locked source SHA.

The bundle contains two rows:

1. `dsh-tui-startup` injects `cmdlineArgs`, parses the app grammar, publishes an immutable startup service, and lets help/errors call `appExit` without mounting Ink.
2. `dsh-tui-runner` injects the startup service and all required host services, creates or resumes exactly one root agent, registers exactly one approval answerer and one user-question provider, enters alt-screen, mounts Ink, and owns the returned `AgentHandle` until shutdown.

There is one active root session in v1. Switching sessions disposes the current handle only after the transcript state is detached, then resumes the selected persisted session. No dashboard, parallel root rendering, remote attach, ACP bridge, browser runtime, React DOM slot, or `@deepseek-ai/dsh-client-*` package is used.

Shutdown order is fixed: stop accepting input -> settle/withdraw blocking cards -> unmount Ink -> restore cursor and alt-screen in `finally` -> dispose the agent handle -> call `appExit(code)`. SIGINT, `/quit`, normal EOF, startup failure after terminal acquisition, and render exceptions all use this path.

## 2. App command line

The launcher forwards the inner argv verbatim through `ctx.cmdlineArgs.get()`; app help is therefore `dsh --profile tui --help`, not a launcher subcommand. Contract: `dsh-cmdline` rc.6 `lib/types/index.d.ts:24-45,89`; source reference `packages/boot/cmdline/src/index.ts:45-48`.

| Form | Meaning | Validation |
|---|---|---|
| no app args | create a fresh persisted session in `process.cwd()` | cwd must be absolute after resolution |
| `--resume <session-id>` | resume one persisted session | non-empty id; mutually exclusive with fresh-session-only options |
| `--theme <abyss\|pearl\|auto>` | initial theme | default `auto`; unknown name is a usage error |
| `--color <auto\|truecolor\|256\|16\|mono>` | override color tier for diagnosis | default `auto`; `NO_COLOR` always forces `mono` |
| `--help` | print flags and exit 0 without alt-screen | Commander terminal action |
| `--version` | print `dsh-tui-app` version and exit 0 | does not report the launcher as the app version |

Unknown options and missing values exit nonzero before terminal mutation. Session ids remain opaque branded strings; the TUI does not parse their shape.

## 3. Host service seams

| Seam | Exact rc.6 surface used | TUI use and boundary | Locked source evidence |
|---|---|---|---|
| `ctx.cmdlineArgs`, `ctx.appExit` | `get(): readonly string[]`; `(code: number): void`; `parseCmdline(ctx, program)` | startup parsing and bounded process exit | `packages/boot/cmdline/src/index.ts:45-48` |
| `ctx.agents` | `create(CreateAgentOptions): Promise<AgentHandle>`; `resume(ResumeAgentOptions): Promise<AgentHandle>`; `get(id)`; `list()` | sole lifecycle factory. Fresh create supplies a minted `SessionId`, absolute cwd, and selected model. Resume supplies `resumeSessionId`. The runner owns `handle.dispose()` | `packages/core/agent/src/index.ts:36-49,80-175,405-429` |
| `Agent` | `session`, `status`, `followup(UserMessage)`, `steer(UserMessage)`, `cancel(cause, options?)`, `whenIdle()` | prompt submission; active-turn queue vs interject; cancellation; status line | rc.6 `dsh-agent/lib/types/runtime-types.d.ts:60-123` |
| `ctx.sessions` / `Session` | `get(id)`, `list()`; `events: readonly SessionEvent[]`; `seq: number`; scoped `'session/event'(session,event)` | live lookup and canonical transcript only. UI never appends synthetic events | `packages/core/session/src/index.ts:37-76,553-566,792-830,1055-1063` |
| `ctx.sessionPersistence` | `prepare`, `load`, `inspect`, `readFrom`, `list`, `listSnapshots` | picker uses `list`; preview metadata may use `inspect`; actual resume is only through `ctx.agents.resume`, never by publishing a prepared session directly | rc.6 `dsh-session-persistence/lib/types/index.d.ts:118-187` |
| `ctx.sessionProjections` | `onChanged(listener): () => void`; `snapshot(session): {asOfSeq, values}` | auxiliary whole-value state; not transcript. A changed key triggers one coalesced frame read | `packages/session/session-projection/src/index.ts:144-153` |
| `ctx.approval` + event waterfall | `'approval/request'(req,next): Promise<ApprovalOutcome>`; `setPolicy(agent,'ask'\|'never')`; `request(req)` | runner registers the only terminal answerer for its exact live root. Outcomes are only `allowed-once`, `rejected`, `cancelled`, `unavailable`; missing/throwing UI fails closed | `packages/interaction/user-approval/src/index.ts:24,44-71,141-171`; `src/types.ts:14-29` |
| `ctx.userQuestions` | `registerProvider({ask}): () => void`; `ask({questions,agent?,signal?})` | runner registers one provider. It answers the exact live runtime root only; delegated callers are rejected by the service | `packages/interaction/user-questions/src/index.ts:20-62`; `src/types.ts:8-60` |
| `ctx.commands` | `list(agent): readonly CommandDescriptor[]`; `execute(agent,line,signal): Promise<CommandExecution | undefined>` | fuzzy slash menu and dispatch. An `undefined` result means the line was not a registered dsh command, allowing local-command resolution | `packages/interaction/commands/src/index.ts:83-110`; `src/types.ts:67-100` |
| `ctx.permissionPresets` | `names`, `current(events)`, `selectFor(state)`, `resolve(name)`, `set(session,name)` | Shift+Tab/picker cycles only advertised presets. Base rc.6 order is `read-only`, `workspace-write`, `danger-full-access`. `set` is the sole write path | `packages/interaction/permission-presets/src/index.ts:107-162`; `src/types.ts:25-40` |
| `ctx.agentDefaultModel` | `currentSelection()`; `saveSelection(next)` | model picker reads/saves the next-session default. Existing `agent.options` remains the authority for the live session; v1 does not hot-rewrite it | `packages/core/agent-default-model/src/index.ts:40-55` |
| `ctx.planMode` | `get(agent): {active,pending?}`; `set(agent,active): 'committed'\|'queued'\|'cancelled'\|'noop'` | `/plan` state and badge. Plan state is independent of permission preset; no Grok plan-file semantics are invented | `packages/plan/plan-mode/src/index.ts:74-116` |
| `ctx.sessionTitle` | `get(session)`; `rename(session,title)`; `refresh(session,signal?)` | status/picker title and local `/rename`; empty normalized titles remain service errors | `packages/session/session-title/src/index.ts:140-176` |
| `ctx.subagents` | provider registry and durable child enumeration APIs; projections `subagent`, `subagentTiming` | P1 fold tree and details. Root transcript remains usable when the optional seam is absent | `packages/subagent/subagent/src/index.ts:61-95,186-248`; `src/projection-types.ts:46-57` |
| `ctx.jobs`, workflow seam | read-only registries/lifecycle views exposed by composed packages | P1 list panels only; no new scheduler or workflow operations | `packages/jobs/jobs/src/types.ts`; `packages/workflow/workflow/src/types.ts` |
| attachment package | model message attachment vocabulary; no general TUI filesystem picker seam | `@` completion is omitted in v1 unless the composed command/attachment API advertises a host-safe resolver. Plain `@text` remains text | `packages/attachment/attachment/src` and rc.6 declarations |

### Agent input construction

User input is converted to the real `UserMessage` vocabulary and given a human source/id; it is never inserted directly into the session log. Idle submission uses `agent.followup(message)`. While running, ordinary Enter queues `followup`; the explicit interject action uses `agent.steer(message)`. `agent.inject` is not user chat and is not used by the composer.

### Approval ownership

The answerer is installed on the root agent's scoped context so the scope filter routes only that agent. `req.signal` closes the card and resolves through service cancellation. `y` returns `allowed-once`; `n` returns `rejected`. A preset-upgrade action first calls `permissionPresets.set(req.agent.session, selected)`, then returns `allowed-once` for the current request. If the preset write throws, the card stays open and no fabricated outcome is returned. On teardown the pending answer resolves `unavailable` unless its signal already produced `cancelled`.

## 4. Projection keys and rendering policy

`SessionProjectionMap` is merge-extensible and is empty in its base package (`packages/session/session-projection/src/types.ts:16-18`). The composed rc.6 base registers the following known keys. Absence means capability absence and must hide the associated UI; it never becomes a zero/default invented by the TUI.

| Key | Wire value used | UI |
|---|---|---|
| `goal` | goal snapshot or absence | compact badge/detail |
| `sessionListMetadata` | list metadata | picker enrichment only |
| `imageLimits` | attachment/image limits | composer hint only when present |
| `permissions` | `{options,currentValue}` | status and preset picker |
| `tokenUsage` | uncached input/output/cache read/cache write counts | token summary; no currency |
| `contextPressure` | optional pressure/projected/context window | occupancy only when numerator and capacity exist |
| `contextBreakdown` | approximate system/tools/messages | detail panel, marked approximate |
| `plan` | `{active,pending}` | plan badge |
| `sessionStats` | whole-log counts and wall-clock facts | status/detail summary |
| `title` | `string | null` | title, then shortened session id fallback |
| `subagentTiming` | active-turn duration | P1 subagent row |
| `subagent` | identity or `null` | P1 tree identity |
| `todos` | todo list or `null` | todo badge/panel |

Snapshot values are one consistent cut at `asOfSeq`. Rendering never mixes an older snapshot field with a newer field from another call: one state update replaces the entire projection snapshot.

## 5. Subscription, race, and failure rules

- Transcript startup uses the subscribe-before-snapshot algorithm in `EVENT-SPEC.md`; projections are subscribed before their first `snapshot(session)` for the same reason.
- Session events are scoped. A listener attached under the root agent sees only that agent's session; global picker metadata uses persistence, not a global transcript firehose.
- Every disposer returned by a registration is owned by the runner fiber and is called in reverse order. A session switch tears down old listeners before disposing the old handle.
- Unknown projection keys are retained in diagnostic state but not rendered. Unknown session events render a bounded raw placeholder; required unknown persisted events may already be rejected by the upstream persistence reader.
- Render and observer errors are contained, surfaced as a non-destructive error panel, and never mutate the log. Terminal restoration remains unconditional.
- No host service is monkey-patched, wrapped with private fields, or imported from `src/`. Product imports use public rc.6 package exports only.

## 6. Final architecture decisions

| ADR | Final decision | Consequence |
|---|---|---|
| ADR-1 | Same-process `dsh-tui-app` bundle over `dsh-base` | zero network/wire layer; terminal owns interactive answerers |
| ADR-2 | Dual lock: npm rc.6 artifacts for compile/runtime contracts; source SHA `47f9438` for readable archaeology; out-of-tree profile installation | no edits to dsh, no automatic tracking of rc.7+, local-tarball source build only as the documented emergency fallback |
| ADR-3 | Transcript from `session.events` + scoped `session/event`; auxiliary state from projections | no browser client runtime or React DOM reuse |
| ADR-4 | Ink retained after all four spike gates passed | explicit alt-screen lifecycle, explicit color-tier tokens, string-width-based CJK geometry; evidence in `SPIKE.md` |
| ADR-5 | Grok guide supplies interaction vocabulary only; every action is translated to a real dsh seam | `/auto`, Grok dashboard, plan file, persistent per-command grants, and mouse completeness are not copied when dsh lacks equivalent semantics |

These decisions are final for M0 and contain no pending implementation choice.
