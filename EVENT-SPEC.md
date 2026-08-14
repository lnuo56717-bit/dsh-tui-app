# dsh-tui Session Event and Transcript Fold Specification

Status: final for M0. Source vocabulary is locked to `47f943859bef60e4160492346772ded9b24f765a`; compile/runtime declarations are npm `0.1.0-rc.6` and are cross-indexed in `PROVENANCE.md`.

## 1. Canonical data model

`SessionEventMap` is an append-only, merge-extensible event vocabulary. Each event is the discriminated envelope `{type, seq, time, data, ignorable?}`. Only `user/message`, `assistant/message`, and `tool/result` may also carry `surfaceOp` and `sourceEventSeqs`. Sequence numbers are zero-based, monotonic, contiguous, and `session.seq === session.events.length`. Source: `packages/core/session/src/types.ts:230-435`; live snapshot/firehose: `packages/core/session/src/index.ts:66-76,553-566`.

The TUI owns a pure `transcript-fold` function. Its state is serializable data plus stable node ids; it has no Cordis, Ink, timer, filesystem, or process dependency. Given the same ordered unique event set, full replay and incremental folding must produce deep-equal state.

Core invariants:

- An already-seen `seq` is a no-op. This holds even if the duplicate object differs.
- Canonical input is folded in ascending `seq`. A gap never gets guessed: the driver resnapshots and replays from the last contiguous watermark.
- A known non-visual event can change fold metadata/badges but creates no transcript node.
- An event type without a registered handler creates one bounded `raw-event` placeholder containing `seq`, `type`, and safe JSON data. It does not crash the process.
- `ignorable: true` means an upstream reader may skip an unknown event safely; the live TUI still shows the raw placeholder when it receives one. An unknown required event in persisted data may be rejected by dsh before the TUI receives a session.
- Surface order is governed by `surfaceOp`, not by display arrival. `append` adds a node; `{op:'replace',start,end}` replaces the inclusive surface-node seq range with one node and preserves a deterministic replacement identity.

## 2. Complete known event spectrum

The locked repository catalog contains 44 types (`packages/core/session/src/known-event-types.ts:19-64`). The rc.6 declaration owners preserve the same names and payload shapes.

| Event | Payload fields / meaning | Fold action |
|---|---|---|
| `turn/start` | `turn` | open turn metadata; no node |
| `turn/end` | `turn`, `reason` | close turn; attach terminal reason to the turn group |
| `step/start` | `turn`, `step` | open step metadata; no node |
| `step/end` | `turn`, `step` | close step and stop any orphan running indicator |
| `user/message` | `UserMessage` | apply its required surface operation; render human/injected/goal source distinctly |
| `assistant/chunk` | `turn`, `step`, `chunk` | update the partial assistant keyed by `(turn,step)` using section 3 |
| `assistant/message` | `turn`, `step`, `message`, optional `usage` | materialize final blocks and supersede the matching partial; apply surface operation |
| `tool/call` | `turn`, `step`, `callId`, `name`, raw `arguments` | create a running tool child keyed by `callId`; arguments remain raw until safe presentation parses them |
| `tool/result` | `turn`, `step`, `message`, optional `error`, optional JSON `meta` | settle the paired call using `message.toolCallId`; retain unpaired result as a visible orphan result card |
| `tool/code-dispatch-start` | `rootCallId`, `parentCallId`, `subCallId`, `name`, normalized `arguments` | insert running nested Code Mode subcall under `parentCallId` |
| `tool/code-dispatch` | start fields plus `isError`, `content` | settle the `subCallId`; unpaired settlement becomes an orphan nested card |
| `todo/write` | whole `todos` list | last write wins in local badge fallback; projection remains preferred; no transcript node |
| `request/header` | `header`, `reason` | update route/header diagnostic metadata; no node |
| `request/context` | route/capacity metadata | update context-capacity fallback; no node |
| `session/end-seed` | empty object; position marks restore/fork seed boundary | record seed boundary; no node |
| `agent-preset/selected` | `agentPreset` | status metadata; no node |
| `agent/inbox/spliced` | `target`, `start`, optional `removedCount`, `inserted`, optional cancelled outcome | input-queue diagnostic only; no transcript node |
| `approval/asked` | `id`, `toolName`, optional `callId`, optional `reason` | attach pending audit state to a tool card; the interactive card itself is driven by the live request seam |
| `approval/decided` | `id`, `outcome` | settle approval audit state; no extra transcript message |
| `approval/policy` | `policy`, optional delegation source | permission fallback/status; no node |
| `permission/preset` | `preset` | permission fallback/status; no node |
| `sandbox/mode` | `mode`, optional delegation source | permission fallback/status; no node |
| `plan/mode` | `active` | plan fallback/status; no node |
| `command/run` | `commandId`, `name`, optional raw `args`, `source` | open a compact command activity row outside the model surface |
| `command/done` | `commandId`, success/error kind, optional text and source event seq | settle the command row; pair by `commandId` |
| `compaction/start` | `compactionId`, optional source command, `turn|null` | open non-surface compaction activity |
| `compaction/summary` | id/source, summary blocks, shadowed range/seqs/token count, provider/model/cap/usage, optional raw output marker | record metering/detail only; the immediately following surface replacement performs visible replacement |
| `compaction/end` | id/source/turn, optional error | settle compaction activity |
| `compaction/prune` | shadowed range/seqs/token count | record price/detail only; next surface replacement is visible |
| `feedback/record` | `text` | known log-only human feedback; omit from transcript to avoid implying model visibility |
| `goal/change` | versioned full snapshot change or clear tombstone | goal badge fallback; no node |
| `hook/invoked` | `turn`, `point`, `dialect`, optional matcher, `handlerId` | optional collapsed diagnostic activity; no model-surface node |
| `hook/result` | `turn`, `point`, `handlerId`, decision, optional exit/stderr, duration | settle hook diagnostic activity |
| `llm/retry` | retry id, turn/step/provider/mode/policy/retry/delay/failure, optional max | attach retry notice to the step; bounded to the latest attempts |
| `llm/retry-started` | retry id, turn/step/retry | mark wait completed; no new node |
| `schedule/change` | versioned create/delete/dispatch change | known log-only schedule state; no transcript node |
| `session/title` | `title`, source message seqs, source provenance | title fallback/status; no node |
| `session/title-llm-request` | provider id, input seqs, route, system, messages, max tokens | known auxiliary request; omit to avoid exposing a non-conversation prompt |
| `subagent/descriptor` | version, one-shot/continuable mode, provider, label and optional resumable composition | P1 subagent identity/tree metadata; no parent transcript node |
| `tool-workflow/run-start` | `runId`, `name` | open P1 workflow tree root |
| `tool-workflow/agent-start` | `runId`, member `seq`, label, optional phase, `childId` | add running child row |
| `tool-workflow/agent-end` | `runId`, member `seq`, outcome | settle workflow child |
| `tool-workflow/run-end` | `runId`, stop reason | settle workflow root |
| `web/deepseek-search-llm-request` | endpoint, API version, secret-free request body | known auxiliary request; omit from transcript, retain bounded diagnostics only |

Core payload evidence: `packages/core/session/src/types.ts:236-332`. Extension declarations: `packages/core/agent/src/types.ts:12-25`, `packages/core/tools/src/types.ts:10-56`, `packages/compaction/compaction/src/types.ts:16-88`, `packages/interaction/{user-approval,commands,permission-presets}/src`, `packages/{feedback,goal,hooks,llm,plan,preset,sandbox,schedule,session,subagent,web,workflow}/**/src` at the locked SHA. Precise rc.6 declaration locations are in `PROVENANCE.md`.

## 3. `StreamChunk` protocol: seven wire variants, five visible folds

The authoritative union has seven variants (`packages/llm/llm/src/types.ts:283-303`; rc.6 `dsh-llm/lib/types/types.d.ts:259-297`). The reference accumulator comment says “six,” but its actual switch and visibility predicate distinguish five visible variants plus two non-visible control/stat variants (`packages/client/runtime/src/client/sessions/partial.ts:1-99`). The approved interpretation is therefore:

| Variant | Fold rule | Visible change |
|---|---|---|
| `block-start {index,blockType}` | assign an empty block of the declared kind at `blocks[index]` | yes |
| `text-delta {index,text}` | append text to an existing text block; if absent/wrong kind, start empty text first | yes |
| `reasoning-delta {index,text}` | append to reasoning; tolerate missing start identically | yes |
| `tool-call-delta {index,id,name?,argumentsDelta}` | keep the first non-empty id, latest supplied name, concatenate raw argument fragments | yes |
| `block-end {index,block}` | replace the partial slot with the authoritative final block | yes |
| `usage {usage}` | update step usage/stat metadata; do not publish a partial block frame | no |
| `finish {reason,replayState?}` | mark stream terminal reason; do not expose adapter-private replay state; final message will supersede the partial | no |

`blocks` is intentionally sparse because starts may arrive out of index order. Render order is ascending occupied index; holes never render placeholder glyphs. A delta before its start is accepted and creates the appropriate provisional block. A later `block-start` at the same index resets that provisional block exactly as the reference implementation does. A later `block-end` is always authoritative.

Unknown future chunk variants are non-visible, recorded in bounded diagnostics, and do not destroy the current partial.

## 4. Chunk-to-message supersession

Partial state is keyed by `(turn,step)` and has a stable node id `assistant:<turn>:<step>`. Every chunk event seq is recorded in its source set.

When `assistant/message` arrives:

1. Materialize its final `AssistantMessage` blocks and optional usage.
2. Prefer `sourceEventSeqs` to identify the exact chunk set. When absent for legacy data, fall back to `(turn,step)` only.
3. Replace the partial node in place, retaining `assistant:<turn>:<step>` so scroll position/focus do not jump.
4. Remove the partial accumulator. Late duplicate chunk seqs remain no-ops. A new unique late chunk for an already finalized pair is retained only in diagnostics; it must not resurrect the partial.
5. Apply the event's `surfaceOp`. Normal assistant output is `append`; a replacement operation follows the general surface algorithm and may shadow older surface nodes.

An assistant message with a present empty `sourceEventSeqs` is a known-empty provider stream, not missing provenance. This distinction is preserved.

## 5. Tool and structured-content presentation

Native calls pair `tool/call.callId` with `tool/result.message.toolCallId`. Cards have `running`, `success`, `error`, `cancelled/orphan` visual states. Tool names and a bounded argument summary are always visible; full raw arguments toggle in a detail view. `meta` is tool-private JSON and is passed only to a registered presenter; without one it appears under a clearly labelled raw metadata fold.

Filesystem edit results use a terminal diff view when their content/meta exposes a diff: context dim, additions green, deletions coral/red, full-width CJK cells measured before clipping. Otherwise they render as normal tool content. Code Mode dispatches form a nested tree under their parent call and use the same result renderer.

Workflow/subagent trees are P1 decorations over durable events/projections. Their absence cannot hide or reorder core user/assistant/tool surface nodes.

## 6. Race-free snapshot plus subscription

For a newly attached live session, the driver performs this exact protocol:

1. Register the scoped `session/event` listener first. The listener buffers events by `seq`; it does not fold until initialization completes.
2. Read `const snapshot = session.events`. This is an immutable consistent array. Let `cut = snapshot.length`.
3. Fold the snapshot from seq 0 upward and set watermark to `cut - 1`.
4. Sort the buffered events. Discard each event with `seq < cut`; these committed before the snapshot cut and are already included.
5. Fold buffered events from `seq === cut` upward. Duplicate seqs are no-ops. If the first remaining seq is greater than `cut`, resnapshot instead of filling the gap.
6. Switch the listener to direct incremental dispatch. Coalesce render notifications, never event folding.

Why this is lossless: every commit occurs either before the immutable snapshot cut (therefore is in `snapshot`) or after listener registration (therefore is buffered). Events in both sets are removed by seq dedupe. Contiguity makes `seq < snapshot.length` an exact overlap test. Post-commit listener exceptions cannot undo the canonical append, so a resnapshot repairs observer failure.

Session switching repeats the protocol with a fresh fold state. Resume history comes from the resumed `Session.events`; the TUI never reconstructs from projection values.

## 7. Determinism and required tests

The implementation test oracle is:

`fold(all events)` deep-equals `events.reduce(incrementalFold)`.

Property cases must cover all 44 known event types, all seven chunk variants, sparse/out-of-order block indexes, missing block starts, message supersession with present/absent/empty source seqs, surface range replacement, interleaved tool calls, nested code dispatch, orphan results, duplicate seq injection, a seq gap/resnapshot signal, and a fabricated unknown event becoming exactly one raw placeholder. Random payloads remain lossless JSON.

The M0 performance probe folded 5,002 supplied records (5,001 unique, one duplicate and one unknown) at p50 0.278 ms, p95 0.441 ms, max 2.598 ms on Windows x64/Node 24.18.0. This is evidence for the architecture, not a substitute for the M2 property suite.
