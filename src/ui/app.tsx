import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Box, Text, useApp, useCursor, useInput, useStdout, useWindowSize } from 'ink'
import type { TuiStartupValues } from '../startup.js'
import { copyNotice, copyToClipboard } from '../clipboard.js'
import {
  type CommandChoice, type EffortChoice, InteractionController, type ModelChoice, type QuestionAnswerItem, type RuntimeSnapshot, type SessionChoice, type SessionSummary, type SubagentChoice,
} from '../interaction-controller.js'
import { TranscriptStore } from '../transcript-store.js'
import { cursorForCell, deleteForward, deleteToEnd, deleteToStart, deleteWord, EMPTY_EDITOR, backspace, insertText, layoutEditor, moveCursor, moveCursorTo, type EditorLine, type EditorState } from './editor.js'
import { displayWidth, graphemes, middleEllipsis, sliceCells, takeCells } from './display-width.js'
import { parseMouseBurst, parseWheelBurst, type MouseReport } from './mouse.js'
import { redactSecrets } from './secrets.js'
import { Logo } from './logo.js'
import { contextStatus, formatFooter, padCells, projectionValue, sessionInfoLines, sessionTitle } from './status.js'
import { sessionDetail, sessionLabel, sessionMeta } from './session-picker.js'
import { resolveTheme, type Theme } from './theme.js'
import { presentReasoning } from './reasoning-view.js'
import { transcriptRows, type TranscriptRow } from './transcript-rows.js'
import { composerCaret } from './cursor.js'
import { terminalSequences } from './terminal.js'
import { focusableBlocks, ReasoningDetailView, TranscriptView, viewportWindow, type RowSelection, type TranscriptBlockRef } from './transcript-view.js'

export interface ShellProps extends TuiStartupValues {
  store?: TranscriptStore
  controller?: InteractionController
  sessionId?: string
  model?: string
  /** Overrides the stream the caret sequences are written to; tests supply a fake TTY. */
  stdout?: Pick<NodeJS.WriteStream, 'write'> & { isTTY?: boolean }
}

type Overlay =
  | { kind: 'commands'; selected: number }
  | { kind: 'sessions'; selected: number; loading: boolean; items: SessionChoice[] }
  | { kind: 'models'; selected: number; loading: boolean; items: ModelChoice[]; error?: string }
  | { kind: 'efforts'; selected: number; loading: boolean; items: EffortChoice[]; error?: string }
  | { kind: 'permissions'; selected: number; forApproval: boolean }
  | { kind: 'workflows'; loading: boolean; subagents: SubagentChoice[]; error?: string }
  | { kind: 'help' | 'keys' | 'session-info' | 'confirm-danger' | 'confirm-new' }

interface QuestionUi {
  requestId: number
  index: number
  option: number
  selections: Record<string, string[]>
  customs: Record<string, string>
  customEditing: boolean
}

const EMPTY_STORE = new TranscriptStore()
const READ_ONLY_RUNTIME: RuntimeSnapshot = Object.freeze({
  sessionId: undefined, cwd: process.cwd(), model: 'model —', agentStatus: 'idle', permission: undefined,
  projection: undefined, theme: 'auto', notice: undefined, error: undefined, approval: undefined, questions: undefined,
})
const noopSubscribe = (): (() => void) => () => {}
const readOnlySnapshot = (): RuntimeSnapshot => READ_ONLY_RUNTIME

/** Rows moved per wheel notch. Matches the three-line convention of terminal pagers. */
const WHEEL_ROWS = 3
/** Persisted sessions listed at once in the picker. */
const SESSION_ROWS = 7
/** Two Enters inside this window stop the running turn (the Grok double-Enter interject). */
const DOUBLE_ENTER_MS = 900

export function borderStyleForWidth(columns: number): 'classic' | 'single' {
  return columns < 60 ? 'classic' : 'single'
}

function matchingCommands(items: readonly CommandChoice[], text: string): CommandChoice[] {
  const query = text.startsWith('/') ? text.slice(1).split(/\s/u, 1)[0]!.toLowerCase() : ''
  return items.filter(item => item.name.includes(query)).slice(0, 9)
}

function visibleWindow<T>(items: readonly T[], selected: number, limit: number): Array<{ item: T; index: number }> {
  const start = Math.max(0, Math.min(selected - Math.floor(limit / 2), Math.max(0, items.length - limit)))
  return items.slice(start, start + limit).map((item, offset) => ({ item, index: start + offset }))
}

function Panel({ overlay, editor, controller, runtime, store, theme, plain, width, summaries }: { overlay: Overlay; editor: EditorState; controller: InteractionController | undefined; runtime: RuntimeSnapshot; store: TranscriptStore; theme: Theme; plain: boolean; width: number; summaries: Record<string, SessionSummary> }): React.JSX.Element {
  const panelCells = Math.max(8, width - 4)
  if (overlay.kind === 'commands') {
    const items = matchingCommands(controller?.commandChoices() ?? [], editor.text)
    return <PanelFrame title="COMMAND SONAR" theme={theme} plain={plain}>{items.length === 0
      ? <Text color={theme.warning}>No matching command</Text>
      : items.map((item, index) => <Text key={`${item.source}:${item.name}`} color={index === overlay.selected ? theme.primary : theme.text} bold={index === overlay.selected}>
          {index === overlay.selected ? '›' : ' '} /{item.name}<Text color={theme.muted}>  [{item.source}] {item.description}{item.inputHint === undefined ? '' : ` · ${item.inputHint}`}</Text>
        </Text>)}</PanelFrame>
  }
  if (overlay.kind === 'sessions') {
    const detail = sessionDetail(overlay.items[overlay.selected])
    return <PanelFrame title="SESSION SOUNDINGS" theme={theme} plain={plain}>{overlay.loading
      ? <Text color={theme.accent}>◌ Reading persisted sessions…</Text>
      : overlay.items.length === 0 ? <Text color={theme.muted}>No persisted sessions yet</Text>
        : <>
            {visibleWindow(overlay.items, overlay.selected, SESSION_ROWS).map(({ item, index }) => {
              const summary = summaries[item.id]
              const meta = sessionMeta(item, summary)
              const label = sessionLabel(item, summary)
              return <Text key={item.id} color={index === overlay.selected ? theme.primary : theme.text} bold={index === overlay.selected}>
                {index === overlay.selected ? '›' : ' '} {item.current ? '●' : '○'} {padCells(label, Math.max(4, panelCells - displayWidth(meta) - 6))}
                <Text color={theme.muted}>  {meta}</Text>
              </Text>
            })}
            {detail !== undefined && <Text color={theme.muted}>{middleEllipsis(detail, panelCells)}</Text>}
          </>}</PanelFrame>
  }
  if (overlay.kind === 'models') {
    return <PanelFrame title="MODEL ROUTES · NEXT STEP" theme={theme} plain={plain}>{overlay.loading
      ? <Text color={theme.accent}>◌ Reading the Harness model catalog…</Text>
      : overlay.error !== undefined ? <Text color={theme.warning}>{overlay.error}</Text>
        : overlay.items.length === 0 ? <Text color={theme.muted}>No advertised models; /switch provider/model can still resolve an exact route.</Text>
          : visibleWindow(overlay.items, overlay.selected, 7).map(({ item, index }) => {
              const detail = `${item.name === item.id ? '' : ` · ${item.name}`}${item.description === undefined ? '' : ` · ${item.description}`}`
              return <Text key={`${item.provider}/${item.id}`} color={index === overlay.selected ? theme.primary : theme.text} bold={index === overlay.selected}>
                {middleEllipsis(`${index === overlay.selected ? '›' : ' '} ${item.current ? '●' : '○'} ${item.provider}/${item.id}${detail}`, panelCells)}
              </Text>
            })}</PanelFrame>
  }
  if (overlay.kind === 'efforts') {
    return <PanelFrame title={middleEllipsis(`REASONING EFFORT · ${runtime.model}`, panelCells - 2)} theme={theme} plain={plain}>{overlay.loading
      ? <Text color={theme.accent}>◌ Resolving exact-model capabilities…</Text>
      : overlay.error !== undefined ? <Text color={theme.warning}>{overlay.error}</Text>
        : visibleWindow(overlay.items, overlay.selected, 5).map(({ item, index }) => <Text key={item.id ?? 'default'} color={index === overlay.selected ? theme.primary : theme.text} bold={index === overlay.selected}>
            {middleEllipsis(`${index === overlay.selected ? '›' : ' '} ${item.current ? '●' : '○'} ${item.name}${item.id === undefined ? ' · default' : ` · ${item.id}`}${item.description === undefined ? '' : ` · ${item.description}`}`, panelCells)}
          </Text>)}</PanelFrame>
  }
  if (overlay.kind === 'permissions') {
    const names = controller?.permissionNames() ?? []
    return <PanelFrame title={overlay.forApproval ? 'ALLOW ONCE + CHANGE PRESET' : 'PERMISSION PRESETS'} theme={theme} plain={plain}>
      {names.map((name, index) => <Text key={name} color={index === overlay.selected ? theme.primary : theme.text} bold={index === overlay.selected}>
        {index === overlay.selected ? '›' : ' '} {name}
      </Text>)}
    </PanelFrame>
  }
  if (overlay.kind === 'confirm-danger') return <PanelFrame title="CONFIRM PERMISSION CHANGE" theme={theme} plain={plain}>
    <Text color={theme.warning}>danger-full-access changes both sandbox confinement and approval policy.</Text>
    <Text color={theme.text}>Press <Text bold color={theme.danger}>y</Text> to change it, or <Text bold>n / Esc</Text> to keep the current preset.</Text>
  </PanelFrame>
  if (overlay.kind === 'confirm-new') return <PanelFrame title="CONFIRM NEW SESSION" theme={theme} plain={plain}>
    <Text color={theme.warning}>The active turn will be stopped before a fresh root session is created.</Text>
    <Text color={theme.text}>Press <Text bold color={theme.primary}>y</Text> to continue, or <Text bold>n / Esc</Text> to stay here.</Text>
  </PanelFrame>
  if (overlay.kind === 'keys') return <PanelFrame title="KEY REFERENCE" theme={theme} plain={plain}>
    <Text><Text bold>Send</Text>  Enter prompt · Ctrl+M multiline · Alt+Enter send · Ctrl+L steer</Text>
    <Text><Text bold>Edit</Text>  Ctrl+W word · Ctrl+U to start · Ctrl+K to end · ↑ history</Text>
    <Text><Text bold>Open</Text>  Ctrl+P/? commands · Ctrl+S sessions · Ctrl+X keys</Text>
    <Text><Text bold>Blocks</Text> Tab then ↑↓ select · ←/→ fold tool output and thoughts · Enter full</Text>
    <Text><Text bold>Copy</Text>  Ctrl+Y copies the selected block or mouse selection · release after a transcript drag also copies</Text>
    <Text><Text bold>Move</Text>  Tab focus · PgUp/PgDn page · Ctrl+U/D half page · wheel scrolls · Esc back/park</Text>
    <Text><Text bold>Mouse</Text>  click the composer to move the caret · drag selects · click the transcript to focus a block</Text>
    <Text><Text bold>Policy</Text> Shift+Tab cycles only advertised dsh permission presets</Text>
    <Text><Text bold>Blockers</Text> approval y/n/3 · questions arrows/digits/Space/z/Enter</Text>
    <Text><Text bold>Stop</Text>  Esc stops the turn · Enter sends your draft, Enter again or Esc takes over with it · Ctrl+C cancel, clear draft, then confirm quit</Text>
  </PanelFrame>
  if (overlay.kind === 'session-info') return <PanelFrame title="SESSION INFO" theme={theme} plain={plain}>
    {sessionInfoLines(runtime).map(line => <Text key={line}>{line}</Text>)}
  </PanelFrame>
  if (overlay.kind === 'workflows') {
    const workflows = store.getSnapshot().nodes.filter(node => node.kind === 'workflow')
    const subagent = projectionValue(runtime, 'subagent')
    const timing = projectionValue(runtime, 'subagentTiming')
    return <PanelFrame title="WORKFLOWS / SUBAGENTS" theme={theme} plain={plain}>
      {overlay.loading && <Text color={theme.accent}>◌ Reading durable descendants…</Text>}
      {overlay.error !== undefined && <Text color={theme.warning}>{overlay.error}</Text>}
      {!overlay.loading && workflows.length === 0 && overlay.subagents.length === 0 && subagent === undefined ? <Text color={theme.muted}>No durable workflow or subagent facts in this session.</Text> : workflows.slice(-5).map(node => <Box key={node.id} flexDirection="column">
        <Text>◇ {node.name} · {node.status} · {node.children.length} jobs</Text>
        {node.children.slice(0, 4).map(child => <Text key={`${child.seq}:${child.childId}`} color={theme.muted}>  └─ {child.label} · {child.phase ?? (child.outcome === undefined ? 'running' : 'done')}</Text>)}
      </Box>)}
      {overlay.subagents.slice(0, 12).map(item => <Text key={item.id} color={item.kind === 'diagnostic' ? theme.warning : theme.text}>
        {'  '.repeat(Math.max(0, item.depth - 1))}└─ {item.label ?? item.id} · {item.kind === 'diagnostic' ? item.reason : `${item.mode} · ${item.activity}`}{item.hasChildren ? ' · children' : ''}
      </Text>)}
      {subagent !== undefined && <Text color={theme.muted}>subagent {safeInline(subagent)}{timing === undefined ? '' : ` · timing ${safeInline(timing)}`}</Text>}
    </PanelFrame>
  }
  return <PanelFrame title="HELP" theme={theme} plain={plain}>
    <Text>Type a prompt and press Enter. Start with / to discover dsh and TUI commands.</Text>
    <Text color={theme.muted}>Blocking approvals use y/n; question cards use arrows, digits, Space, z, Enter.</Text>
  </PanelFrame>
}

function safeInline(value: unknown): string {
  return redactSecrets((() => {
    try { return JSON.stringify(value) ?? String(value) } catch { return '[unserializable]' }
  })())
}

/** The plain text covered by a cell-range selection across transcript rows. */
function transcriptSelectionText(rows: readonly TranscriptRow[], selection: RowSelection): string {
  const parts: string[] = []
  for (let row = selection.startRow; row <= selection.endRow; row += 1) {
    const text = rows[row]?.segments.map(part => part.text).join('') ?? ''
    if (row === selection.startRow && row === selection.endRow) parts.push(sliceCells(text, selection.start, selection.end))
    else if (row === selection.startRow) parts.push(sliceCells(text, selection.start))
    else if (row === selection.endRow) parts.push(sliceCells(text, 0, selection.end))
    else parts.push(text)
  }
  return parts.join('\n')
}

function PanelFrame({ title, theme, children, plain }: { title: string; theme: Theme; children: React.ReactNode; plain: boolean }): React.JSX.Element {
  return <Box borderStyle={plain ? 'classic' : 'single'} borderColor={theme.accent} flexDirection="column" paddingX={1}>
    <Text bold color={theme.accent}>◇ {title}</Text>{children}
  </Box>
}

function ApprovalCard({ runtime, focused, theme, plain }: { runtime: RuntimeSnapshot; focused: boolean; theme: Theme; plain: boolean }): React.JSX.Element | null {
  const request = runtime.approval
  if (request === undefined) return null
  return <Box borderStyle={plain ? 'classic' : 'double'} borderColor={focused ? theme.warning : theme.border} flexDirection="column" paddingX={1}>
    <Text bold color={theme.warning}>PERMISSION REQUIRED · {request.toolName}</Text>
    {request.reason !== undefined && <Text color={theme.text}>{request.reason}</Text>}
    {request.callId !== undefined && <Text color={theme.muted}>call {request.callId}</Text>}
    <Text><Text bold color={theme.success}>y / 1 allow once</Text><Text color={theme.muted}>   </Text><Text bold color={theme.danger}>n / 2 reject</Text><Text color={theme.muted}>   3 change preset + allow</Text></Text>
    {!focused && <Text color={theme.muted}>Parked · Tab returns focus; the request is still pending.</Text>}
  </Box>
}

function QuestionCard({ runtime, ui, focused, theme, plain }: { runtime: RuntimeSnapshot; ui: QuestionUi; focused: boolean; theme: Theme; plain: boolean }): React.JSX.Element | null {
  const request = runtime.questions
  if (request === undefined) return null
  const question = request.questions[ui.index]
  if (question === undefined) return null
  const selected = new Set(ui.selections[question.id] ?? [])
  return <Box borderStyle={plain ? 'classic' : 'double'} borderColor={focused ? theme.primary : theme.border} flexDirection="column" paddingX={1}>
    <Text bold color={theme.primary}>{question.header ?? 'QUESTION'} · {ui.index + 1}/{request.questions.length}</Text>
    <Text color={theme.text}>{question.question}</Text>
    {question.detail !== undefined && <Text color={theme.muted}>{question.detail}</Text>}
    {question.options.map((option, index) => {
      const chosen = selected.has(option.label)
      const approve = question.approve === option.label
      return <Text key={option.label} color={index === ui.option ? theme.primary : chosen ? theme.success : theme.text} bold={index === ui.option || approve}>
        {index === ui.option ? '›' : ' '} {index + 1}. {chosen ? '[x]' : '[ ]'} {option.label}{approve ? ' · approve' : ''}<Text color={theme.muted}>{option.description === undefined ? '' : ` — ${option.description}`}</Text>
      </Text>
    })}
    <Text color={ui.customEditing ? theme.primary : theme.muted}>z. Other: {ui.customs[question.id] ?? (ui.customEditing ? '▌' : '')}</Text>
    {!focused && <Text color={theme.muted}>Parked · Tab returns focus; no answer was fabricated.</Text>}
  </Box>
}

function Composer({ editor, focused, runtime, theme, plain, lines, hardwareCaret }: {
  editor: EditorState
  focused: boolean
  runtime: RuntimeSnapshot
  theme: Theme
  plain: boolean
  lines: readonly EditorLine[]
  /** True when the terminal's own cursor marks the caret, so a painted block would double it. */
  hardwareCaret: boolean
}): React.JSX.Element {
  const mode = runtime.agentStatus === 'running' ? 'FOLLOW-UP' : 'PROMPT'
  const context = contextStatus(runtime)
  return <Box borderStyle={plain ? 'classic' : 'single'} borderColor={focused ? theme.primary : theme.border} minHeight={editor.multiline ? 6 : 4} paddingX={1} flexDirection="column">
    <Box justifyContent="space-between">
      <Text><Text bold color={theme.primary}>⌁ {mode}</Text>{!plain && <Text color={theme.muted}> · {editor.multiline ? 'multiline · Alt+Enter sends' : 'Enter sends · Ctrl+M multiline'}</Text>}</Text>
      {context !== undefined && <Text bold color={theme.accent}>{context}</Text>}
    </Box>
    {lines.map((line, index) => <Text key={index} color={theme.text} wrap="truncate">
      <Text color={theme.accent}>{index === 0 ? '› ' : '  '}</Text>
      {line.segments.map((segment, part) => <Text key={part} inverse={segment.caret ? focused && !hardwareCaret : segment.selected}>{segment.text}</Text>)}
    </Text>)}
  </Box>
}

export function Shell(props: ShellProps): React.JSX.Element {
  const { exit } = useApp()
  const { stdout } = useStdout()
  // Ink paints the cursor suffix with the frame itself, so a delayed throttled
  // frame can never leave the terminal cursor at the end of the screen; the IME
  // composes at the caret even while tokens keep streaming past it.
  const { setCursorPosition } = useCursor()
  const { columns = 80, rows = 24 } = useWindowSize()
  const controller = props.controller
  const runtime = useSyncExternalStore(controller?.subscribe ?? noopSubscribe, controller?.getSnapshot ?? readOnlySnapshot, controller?.getSnapshot ?? readOnlySnapshot)
  const themeName = controller === undefined ? props.theme : runtime.theme
  const theme = useMemo(() => resolveTheme(themeName, props.color), [themeName, props.color])
  const store = controller?.transcript ?? props.store ?? EMPTY_STORE
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR)
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [focus, setFocus] = useState<'composer' | 'transcript'>('composer')
  const [scrollOffset, setScrollOffset] = useState(0)
  const [overlay, setOverlay] = useState<Overlay | undefined>()
  const [expandedBlocks, setExpandedBlocks] = useState<ReadonlySet<string>>(() => new Set())
  const [focusedBlockKey, setFocusedBlockKey] = useState<string | undefined>()
  const [reasoningDetail, setReasoningDetail] = useState<{ key: string; offset: number; follow: boolean } | undefined>()
  const [summaries, setSummaries] = useState<Record<string, SessionSummary>>({})
  const [mouseTracking, setMouseTracking] = useState(true)
  const catalogRequest = useRef(0)
  const rowTotal = useRef(0)
  const wheelBurst = useRef({ at: 0, count: 0, historyTimer: undefined as ReturnType<typeof setTimeout> | undefined })
  const [blockingFocused, setBlockingFocused] = useState(true)
  const [approvalOption, setApprovalOption] = useState(0)
  const [quitArmed, setQuitArmed] = useState(false)
  const [stopArmed, setStopArmed] = useState(false)
  const enterAt = useRef(0)
  /** When a draft was last sent while the turn ran; the take-over gesture re-sends the queued drafts. */
  const lastSentAt = useRef(0)
  /** Drafts sent since the turn last went idle; take-over re-sends all of them after the abort. */
  const lastSentTexts = useRef<string[]>([])
  const stopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mouseDrag = useRef<{ area: 'composer'; anchor: number } | { area: 'transcript'; anchorRow: number; anchorCol: number } | undefined>(undefined)
  const [transcriptSel, setTranscriptSel] = useState<RowSelection | undefined>()
  const [questionUi, setQuestionUi] = useState<QuestionUi>({ requestId: -1, index: 0, option: 0, selections: {}, customs: {}, customEditing: false })
  const compact = columns <= 80
  const veryNarrow = borderStyleForWidth(columns) === 'classic'
  const margin = veryNarrow ? 0 : compact ? 1 : 2
  const blockingRows = runtime.approval !== undefined || runtime.questions !== undefined ? 6 : 0
  const overlayRows = overlay === undefined ? 0
    : overlay.kind === 'keys' ? 12
      : overlay.kind === 'sessions' ? SESSION_ROWS + 4
        : overlay.kind === 'session-info' ? 9 : overlay.kind === 'models' ? 10 : overlay.kind === 'efforts' ? 8 : 7
  const composerRows = editor.multiline ? 6 : 4
  const viewportRows = Math.max(1, rows - (compact ? 6 : 13) - blockingRows - overlayRows - composerRows)
  const transcriptWidth = Math.max(10, columns - margin * 2 - 4)
  // The scrollbar column is always reserved, so crossing the viewport height
  // never rewraps the transcript underneath the reader.
  const rowWidth = Math.max(8, transcriptWidth - 2)
  const blocks = useMemo(() => focusableBlocks(state), [state])
  const thoughts = useMemo(() => blocks.filter(item => item.kind === 'reasoning'), [blocks])
  const focusedBlock = blocks.find(item => item.key === focusedBlockKey)
  const detailItem = reasoningDetail === undefined ? undefined : thoughts.find(item => item.key === reasoningDetail.key)
  const transcript = useMemo(() => transcriptRows(state, {
    width: rowWidth,
    compact,
    expandedBlocks,
    focusedBlockKey: focus === 'transcript' ? focusedBlockKey : undefined,
    thinkingGlyph: '◌',
  }), [state, rowWidth, compact, expandedBlocks, focusedBlockKey, focus])
  const maxScroll = Math.max(0, transcript.length - viewportRows)
  const scroll = Math.min(Math.max(0, scrollOffset), maxScroll)
  const composerWidth = Math.max(10, columns - margin * 2 - 4)
  const editorLayout = layoutEditor(editor, Math.max(8, composerWidth), editor.multiline ? 5 : 3)
  const editorLines = editorLayout.lines
  const composerFocused = focus === 'composer' && blockingFocused && overlay === undefined
  const caret = composerFocused ? composerCaret({ rows, margin, lines: editorLines }) : undefined
  // Ink's suffix math assumes the pre-suffix cursor sits one line BELOW the
  // frame (a trailing newline), but a fullscreen frame has none: the cursor
  // rests on the last frame line, so `visibleLineCount - y` overshoots by one.
  // Passing the 1-based row (instead of `row - 1`) compensates exactly.
  setCursorPosition(caret === undefined ? undefined : { x: caret.column - 1, y: caret.row })
  // Bottom-anchored geometry for mouse hit-testing: the composer's own height is
  // exact, so its rows and the transcript viewport above it can be found by
  // counting from the bottom of the screen.
  const composerHeight = Math.max(editor.multiline ? 6 : 4, editorLines.length + 3)
  const middleHeight = blockingRows + overlayRows + composerHeight
  const transcriptBottom = rows - 2 - middleHeight
  const transcriptWindow = viewportWindow(transcript.length, viewportRows, scroll)

  useEffect(() => {
    setBlockingFocused(true)
    setApprovalOption(0)
  }, [runtime.approval?.id, runtime.questions?.id])

  useEffect(() => {
    if (runtime.questions !== undefined && runtime.questions.id !== questionUi.requestId) {
      setQuestionUi({ requestId: runtime.questions.id, index: 0, option: 0, selections: {}, customs: {}, customEditing: false })
    }
  }, [runtime.questions?.id, questionUi.requestId])

  useEffect(() => {
    setExpandedBlocks(new Set())
    setFocusedBlockKey(undefined)
    setReasoningDetail(undefined)
    setScrollOffset(0)
    setTranscriptSel(undefined)
  }, [runtime.sessionId])

  // Streaming appends rows below the viewport. Growing the offset by the same
  // amount keeps the reader parked on the text they were reading; at the bottom
  // the view stays pinned to the newest row instead.
  useEffect(() => {
    const grew = transcript.length - rowTotal.current
    rowTotal.current = transcript.length
    if (grew > 0) setScrollOffset(value => value > 0 ? value + grew : 0)
  }, [transcript.length])

  useEffect(() => () => { clearTimeout(wheelBurst.current.historyTimer); clearTimeout(stopTimer.current) }, [])

  // The double-Enter arm is only meaningful while a turn is running.
  useEffect(() => {
    if (runtime.agentStatus !== 'running') {
      setStopArmed(false)
      enterAt.current = 0
      lastSentAt.current = 0
      lastSentTexts.current = []
    }
  }, [runtime.agentStatus])

  useEffect(() => {
    if (controller === undefined || overlay?.kind !== 'sessions' || overlay.loading) return
    const pending = visibleWindow(overlay.items, overlay.selected, SESSION_ROWS)
      .map(({ item }) => item.id).filter(id => summaries[id] === undefined)
    if (pending.length === 0) return
    let cancelled = false
    void (async () => {
      for (const id of pending) {
        const summary = await controller.describeSession(id).catch(() => ({ id, prompts: 0, unreadable: 'unavailable' } as SessionSummary))
        if (cancelled) return
        setSummaries(current => current[id] === undefined ? { ...current, [id]: summary } : current)
      }
    })()
    return () => { cancelled = true }
  }, [controller, overlay, summaries])

  useEffect(() => {
    if (focusedBlockKey !== undefined && focusedBlock === undefined) setFocusedBlockKey(undefined)
    if (reasoningDetail !== undefined && detailItem === undefined) setReasoningDetail(undefined)
  }, [focusedBlock, focusedBlockKey, reasoningDetail, detailItem])

  useEffect(() => {
    if (reasoningDetail?.follow !== true || detailItem === undefined) return
    const page = Math.max(1, viewportRows - 3)
    const total = presentReasoning(detailItem.text, {
      running: detailItem.running, width: Math.max(8, transcriptWidth - 4), mode: 'detail', offset: 0, rows: page,
    }).totalRows
    const offset = Math.max(0, total - page)
    if (offset !== reasoningDetail.offset) setReasoningDetail({ ...reasoningDetail, offset })
  }, [detailItem?.text, detailItem?.running, viewportRows, transcriptWidth, reasoningDetail])

  const openSessions = (): void => {
    if (controller === undefined) return
    // The open session keeps appending events, so its folded summary is refetched.
    const live = runtime.sessionId
    if (live !== undefined) setSummaries(current => { const { [live]: _stale, ...rest } = current; return rest })
    setOverlay({ kind: 'sessions', selected: 0, loading: true, items: [] })
    void controller.listSessions().then(items => setOverlay(current => current?.kind === 'sessions' ? { ...current, loading: false, items } : current)).catch(error => {
      setOverlay(undefined)
      void controller.executeCommand(`/session-info`, 'tui')
      process.stderr.write(`dsh-tui session list: ${error instanceof Error ? error.message : String(error)}\n`)
    })
  }

  const openWorkflows = (): void => {
    if (controller === undefined) return
    setOverlay({ kind: 'workflows', loading: true, subagents: [] })
    void controller.listSubagents().then(subagents => setOverlay(current => current?.kind === 'workflows' ? { kind: 'workflows', loading: false, subagents } : current)).catch(error => {
      setOverlay(current => current?.kind === 'workflows'
        ? { kind: 'workflows', loading: false, subagents: [], error: error instanceof Error ? error.message : String(error) }
        : current)
    })
  }

  const openModels = (): void => {
    if (controller === undefined) return
    const request = ++catalogRequest.current
    setOverlay({ kind: 'models', selected: 0, loading: true, items: [] })
    void controller.listModels().then(items => {
      if (request !== catalogRequest.current) return
      const selected = Math.max(0, items.findIndex(item => item.current))
      setOverlay(current => current?.kind === 'models' ? { kind: 'models', selected, loading: false, items } : current)
    }).catch(error => {
      if (request !== catalogRequest.current) return
      setOverlay(current => current?.kind === 'models'
        ? { kind: 'models', selected: 0, loading: false, items: [], error: error instanceof Error ? error.message : String(error) }
        : current)
    })
  }

  const openEfforts = (): void => {
    if (controller === undefined) return
    const request = ++catalogRequest.current
    setOverlay({ kind: 'efforts', selected: 0, loading: true, items: [] })
    void controller.listEfforts().then(items => {
      if (request !== catalogRequest.current) return
      const selected = Math.max(0, items.findIndex(item => item.current))
      setOverlay(current => current?.kind === 'efforts' ? { kind: 'efforts', selected, loading: false, items } : current)
    }).catch(error => {
      if (request !== catalogRequest.current) return
      setOverlay(current => current?.kind === 'efforts'
        ? { kind: 'efforts', selected: 0, loading: false, items: [], error: error instanceof Error ? error.message : String(error) }
        : current)
    })
  }

  const focusBlock = (item: TranscriptBlockRef | undefined): void => {
    if (item === undefined) return
    setFocusedBlockKey(item.key)
    const row = transcript.findIndex(entry => entry.nodeId === item.nodeId)
    if (row < 0) return
    const window = viewportWindow(transcript.length, viewportRows, scroll)
    if (row >= window.start && row < window.end) return
    // Park the block two rows below the top edge rather than snapping it flush.
    setScrollOffset(Math.max(0, Math.min(maxScroll, transcript.length - viewportRows - row + 2)))
  }

  const openThoughtDetail = (item: TranscriptBlockRef | undefined): void => {
    if (item === undefined || item.kind !== 'reasoning') return
    const page = Math.max(1, viewportRows - 3)
    const total = presentReasoning(item.text, {
      running: item.running, width: Math.max(8, transcriptWidth - 4), mode: 'detail', offset: 0, rows: page,
    }).totalRows
    setReasoningDetail({ key: item.key, offset: item.running ? Math.max(0, total - page) : 0, follow: item.running })
  }

  const expandBlock = (item: TranscriptBlockRef | undefined, open: boolean): void => {
    if (item === undefined) return
    setExpandedBlocks(current => {
      const next = new Set(current)
      open ? next.add(item.key) : next.delete(item.key)
      return next
    })
  }

  /** Copy the focused block, or the newest one when nothing is selected. */
  const copyBlock = (item: TranscriptBlockRef | undefined): void => {
    const target = item ?? blocks.at(-1)
    if (target === undefined || target.text.trim() === '') {
      controller?.notify('Nothing to copy: no tool output or reasoning block is selected')
      return
    }
    void copyToClipboard(target.text, props.stdout === undefined ? {} : { stdout: props.stdout })
      .then(result => controller?.notify(`${copyNotice(target.text, result)} · ${target.label}`))
      .catch(() => controller?.notify('Clipboard copy failed'))
  }

  /**
   * Mouse tracking is what stops a terminal from drag-selecting text. Shift+drag
   * bypasses it in Windows Terminal and most emulators; where it does not, this
   * hands the mouse back wholesale — at the cost of wheel scrolling.
   */
  const toggleMouse = (): void => {
    const stream = props.stdout ?? stdout
    const next = !mouseTracking
    setMouseTracking(next)
    stream?.write(next ? terminalSequences.ENTER_MOUSE : terminalSequences.LEAVE_MOUSE)
    controller?.notify(next
      ? 'Mouse tracking on · wheel scrolls · Shift+drag selects text'
      : 'Mouse tracking off · drag selects text · keys still scroll · /mouse restores the wheel')
  }

  /**
   * Left-button mouse support over the two content panes. In the composer a
   * click moves the caret and a drag extends a selection (typing replaces it);
   * in the transcript a click focuses the block under the cursor and a drag
   * selects rows — releasing copies the selection to the clipboard.
   */
  const handleMouse = (report: MouseReport): void => {
    if (report.kind === 'release') {
      const drag = mouseDrag.current
      mouseDrag.current = undefined
      if (drag?.area === 'transcript' && transcriptSel !== undefined && (transcriptSel.endRow > transcriptSel.startRow || transcriptSel.end > transcriptSel.start)) {
        const text = transcriptSelectionText(transcript, transcriptSel)
        void copyToClipboard(text, props.stdout === undefined ? {} : { stdout: props.stdout })
          .then(() => controller?.notify(`Copied ${text.split('\n').length} line${text.split('\n').length === 1 ? '' : 's'} to the clipboard`))
          .catch(() => controller?.notify('Clipboard copy failed'))
      }
      setTranscriptSel(undefined)
      return
    }
    if (report.button !== 0 || controller === undefined || overlay !== undefined || blockingRows !== 0) return
    // Composer rows sit at the bottom: footer(2) + composer borders/header, then the editor lines.
    const editorTop = rows - 2 - editorLines.length
    if (report.y >= editorTop && report.y <= rows - 3) {
      const target = cursorForCell(editorLayout, report.y - editorTop, report.x - margin - 5)
      if (target === undefined) return
      if (report.kind === 'press') {
        mouseDrag.current = { area: 'composer', anchor: target }
        setEditor(value => ({ ...value, cursor: target, selection: undefined }))
        if (focus !== 'composer') { setFocus('composer'); setReasoningDetail(undefined) }
      } else if (report.kind === 'motion' && mouseDrag.current?.area === 'composer') {
        const anchor = mouseDrag.current.anchor
        setEditor(value => ({ ...value, cursor: target, selection: anchor === target ? undefined : { start: Math.min(anchor, target), end: Math.max(anchor, target) } }))
      }
      return
    }
    if (detailItem !== undefined) return
    // The viewport block is bottom-justified, so a short transcript hugs the
    // bottom edge; hit-test from the visible row count, not the full viewport.
    const visibleCount = Math.min(viewportRows, transcript.length)
    const viewportRow = report.y - (transcriptBottom - visibleCount)
    if (viewportRow < 0 || viewportRow >= visibleCount) return
    const row = transcriptWindow.start + viewportRow
    if (row < 0 || row >= transcript.length) return
    const column = Math.max(0, report.x - margin - 3)
    if (report.kind === 'press') {
      mouseDrag.current = { area: 'transcript', anchorRow: row, anchorCol: column }
      setTranscriptSel(undefined)
      const block = blocks.find(item => item.nodeId === transcript[row]?.nodeId)
      focusBlock(block)
      if (focus !== 'transcript') setFocus('transcript')
    } else if (report.kind === 'motion' && mouseDrag.current?.area === 'transcript') {
      const { anchorRow, anchorCol } = mouseDrag.current
      setTranscriptSel(row < anchorRow
        ? { startRow: row, start: column, endRow: anchorRow, end: anchorCol }
        : row > anchorRow
          ? { startRow: anchorRow, start: anchorCol, endRow: row, end: column }
          : { startRow: row, start: Math.min(column, anchorCol), endRow: row, end: Math.max(column, anchorCol) })
    }
  }

  const runChoice = (choice: CommandChoice): void => {
    if (controller === undefined) return
    const suffix = editor.text.startsWith('/') ? /^\/[^\s]*([\s\S]*)$/u.exec(editor.text)?.[1] ?? '' : ''
    const line = `/${choice.name}${suffix}`
    setOverlay(undefined)
    setEditor(EMPTY_EDITOR)
    void controller.executeCommand(line, choice.source).then(action => {
      if (action === 'quit') exit()
      else if (action === 'mouse') toggleMouse()
      else if (action === 'workflows') openWorkflows()
      else if (action === 'models') openModels()
      else if (action === 'efforts') openEfforts()
      else if (action === 'help' || action === 'keys' || action === 'session-info' || action === 'confirm-danger' || action === 'confirm-new') setOverlay({ kind: action })
      else if (action === 'sessions') openSessions()
    })
  }

  const submitPrompt = (steer = false): void => {
    if (editor.text.trim() === '') return
    setStopArmed(false)
    enterAt.current = 0
    if (editor.text.startsWith('/')) {
      const items = matchingCommands(controller?.commandChoices() ?? [], editor.text)
      if (items.length > 0) runChoice(items[Math.min(overlay?.kind === 'commands' ? overlay.selected : 0, items.length - 1)]!)
      return
    }
    controller?.submit(editor.text, steer)
    setHistory(items => [...items, editor.text].slice(-100))
    setHistoryIndex(-1)
    setEditor(EMPTY_EDITOR)
    setOverlay(undefined)
    setScrollOffset(0)
    clearTimeout(wheelBurst.current.historyTimer)
    wheelBurst.current.historyTimer = undefined
    // A send during a running turn queues the draft; the next Enter or Esc
    // takes over right away instead of waiting out the turn.
    if (runtime.agentStatus === 'running') {
      lastSentAt.current = Date.now()
      lastSentTexts.current = [...lastSentTexts.current, editor.text].slice(-8)
      setStopArmed(true)
      clearTimeout(stopTimer.current)
      stopTimer.current = setTimeout(() => setStopArmed(false), DOUBLE_ENTER_MS + 250)
    }
  }

  const answerCurrentQuestion = (direct?: number, finalizeOnly = false): void => {
    const request = runtime.questions
    const question = request?.questions[questionUi.index]
    if (request === undefined || question === undefined) return
    const optionIndex = direct ?? questionUi.option
    const option = question.options[optionIndex]
    const selections = { ...questionUi.selections }
    if (!finalizeOnly && option !== undefined) {
      const current = new Set(selections[question.id] ?? [])
      if (question.multiSelect) current.has(option.label) ? current.delete(option.label) : current.add(option.label)
      else { current.clear(); current.add(option.label) }
      selections[question.id] = [...current]
    }
    // Finalizing always closes the free-text field: leaving it open swallowed the
    // arrows that move between questions, stranding the card on question one.
    const base = finalizeOnly ? { ...questionUi, customEditing: false } : questionUi
    if (question.multiSelect && !finalizeOnly) {
      setQuestionUi({ ...base, selections })
      return
    }
    const answered = (item: typeof question): boolean => (selections[item.id]?.length ?? 0) > 0 || (questionUi.customs[item.id]?.trim() ?? '') !== ''
    if (!question.multiSelect && questionUi.index < request.questions.length - 1) {
      setQuestionUi({ ...base, selections, index: questionUi.index + 1, option: 0, customEditing: false })
      return
    }
    if (request.questions.every(answered)) {
      const answers: QuestionAnswerItem[] = request.questions.map(item => ({
        id: item.id, selected: selections[item.id] ?? [],
        ...((questionUi.customs[item.id]?.trim() ?? '') === '' ? {} : { custom: questionUi.customs[item.id]!.trim() }),
      }))
      controller?.answerQuestions(answers)
    } else setQuestionUi({ ...base, selections })
  }

  const scrollTranscript = (direction: 'up' | 'down', amount = 1): void => {
    const step = Math.max(1, amount)
    if (reasoningDetail !== undefined && detailItem !== undefined) {
      const page = Math.max(1, viewportRows - 3)
      const total = presentReasoning(detailItem.text, {
        running: detailItem.running, width: Math.max(8, transcriptWidth - 4), mode: 'detail', offset: 0, rows: page,
      }).totalRows
      if (direction === 'up') setReasoningDetail({ ...reasoningDetail, offset: Math.max(0, reasoningDetail.offset - step), follow: false })
      else {
        const next = Math.min(Math.max(0, total - page), reasoningDetail.offset + step)
        setReasoningDetail({ ...reasoningDetail, offset: next, follow: next >= Math.max(0, total - page) && detailItem.running })
      }
      return
    }
    setScrollOffset(value => {
      const current = Math.min(Math.max(0, value), maxScroll)
      return direction === 'up' ? Math.min(maxScroll, current + step) : Math.max(0, current - step)
    })
  }

  const recallHistory = (direction: 'up' | 'down'): void => {
    if (direction === 'up' && history.length > 0) {
      const next = Math.min(history.length - 1, historyIndex + 1)
      setHistoryIndex(next)
      const text = history[history.length - 1 - next]!
      setEditor({ ...EMPTY_EDITOR, text, cursor: graphemes(text).length })
      return
    }
    if (direction === 'down' && historyIndex >= 0) {
      const next = historyIndex - 1
      setHistoryIndex(next)
      const text = next < 0 ? '' : history[history.length - 1 - next]!
      setEditor({ ...EMPTY_EDITOR, text, cursor: graphemes(text).length })
    }
  }

  const handleVerticalNav = (direction: 'up' | 'down', fromWheel: boolean, amount = 1): void => {
    clearTimeout(wheelBurst.current.historyTimer)
    wheelBurst.current.historyTimer = undefined
    if (fromWheel) {
      scrollTranscript(direction, amount)
      return
    }
    if (editor.text !== '' || history.length === 0) {
      scrollTranscript(direction, amount)
      return
    }
    const now = Date.now()
    if (now - wheelBurst.current.at < 80) {
      // A terminal that translates the wheel into arrow keys arrives as a burst;
      // treat it like a wheel notch instead of one-row keyboard navigation.
      wheelBurst.current.count += 1
      wheelBurst.current.at = now
      scrollTranscript(direction, WHEEL_ROWS)
      return
    }
    wheelBurst.current.at = now
    wheelBurst.current.count = 1
    wheelBurst.current.historyTimer = setTimeout(() => {
      wheelBurst.current.historyTimer = undefined
      if (wheelBurst.current.count > 1) return
      recallHistory(direction)
    }, 70)
  }

  /** How many rows the open overlay offers, mirroring each branch's own bounds. */
  const overlayLength = (): number => {
    if (overlay === undefined) return 0
    if (overlay.kind === 'commands') return matchingCommands(controller?.commandChoices() ?? [], editor.text).length
    if (overlay.kind === 'sessions') return overlay.items.length
    if (overlay.kind === 'models' || overlay.kind === 'efforts') return overlay.loading ? 0 : overlay.items.length
    if (overlay.kind === 'permissions') return (controller?.permissionNames() ?? []).length
    return 0
  }

  useInput((input, key) => {
    if (key.eventType === 'release') return
    const wheel = parseWheelBurst(input)
    if (wheel.notches !== 0) {
      // Over an open picker the wheel walks that list; otherwise it scrolls the transcript.
      const listed = overlayLength()
      if (listed > 0) {
        setOverlay(current => current === undefined || !('selected' in current) ? current
          : { ...current, selected: Math.max(0, Math.min(listed - 1, current.selected + wheel.notches)) })
        return
      }
      handleVerticalNav(wheel.notches < 0 ? 'up' : 'down', true, Math.abs(wheel.notches) * WHEEL_ROWS)
      return
    }
    // Clicks and drags arrive as mouse reports too; handle them before the
    // leftover-noise swallow below drops every non-wheel report.
    const mouse = parseMouseBurst(input)
    if (mouse.length > 0) {
      for (const report of mouse) handleMouse(report)
      return
    }
    if (wheel.mouse) return
    if (stopArmed && !key.return) { setStopArmed(false); enterAt.current = 0 }
    if (quitArmed && !(key.ctrl && input === 'c')) setQuitArmed(false)

    if (runtime.approval !== undefined && blockingFocused && overlay === undefined) {
      if (key.ctrl && input === 'c') controller?.cancel()
      else if (input === 'y' || input === '1') controller?.answerApproval('allowed-once')
      else if (input === 'n' || input === '2') controller?.answerApproval('rejected')
      else if (input === '3') setOverlay({ kind: 'permissions', selected: 0, forApproval: true })
      else if (key.upArrow || key.leftArrow || key.shift && key.tab) setApprovalOption(value => (value + 2) % 3)
      else if (key.downArrow || key.rightArrow || key.tab) setApprovalOption(value => (value + 1) % 3)
      else if (key.return) approvalOption === 0 ? controller?.answerApproval('allowed-once') : approvalOption === 1 ? controller?.answerApproval('rejected') : setOverlay({ kind: 'permissions', selected: 0, forApproval: true })
      else if (key.escape) setBlockingFocused(false)
      return
    }

    if (runtime.questions !== undefined && blockingFocused && overlay === undefined) {
      const question = runtime.questions.questions[questionUi.index]
      if (question === undefined) return
      if (key.ctrl && input === 'c') { controller?.cancel(); return }
      if (questionUi.customEditing) {
        // Arrows leave free-text mode first and then act, so a card with an
        // open "z. Other" field can still be walked and answered by keyboard.
        if (key.escape) setQuestionUi({ ...questionUi, customEditing: false })
        else if (key.leftArrow) setQuestionUi({ ...questionUi, customEditing: false, index: Math.max(0, questionUi.index - 1), option: 0 })
        else if (key.rightArrow) setQuestionUi({ ...questionUi, customEditing: false, index: Math.min(runtime.questions.questions.length - 1, questionUi.index + 1), option: 0 })
        else if (key.upArrow) setQuestionUi({ ...questionUi, customEditing: false, option: Math.max(0, questionUi.option - 1) })
        else if (key.downArrow) setQuestionUi({ ...questionUi, customEditing: false, option: Math.min(Math.max(0, question.options.length - 1), questionUi.option + 1) })
        else if (key.backspace || key.delete) setQuestionUi({ ...questionUi, customs: { ...questionUi.customs, [question.id]: graphemes(questionUi.customs[question.id] ?? '').slice(0, -1).join('') } })
        else if (key.return) answerCurrentQuestion(undefined, true)
        else if (!key.ctrl && !key.meta && input !== '') setQuestionUi({ ...questionUi, customs: { ...questionUi.customs, [question.id]: (questionUi.customs[question.id] ?? '') + input } })
        return
      }
      if (key.leftArrow) setQuestionUi({ ...questionUi, index: Math.max(0, questionUi.index - 1), option: 0 })
      else if (key.rightArrow) setQuestionUi({ ...questionUi, index: Math.min(runtime.questions.questions.length - 1, questionUi.index + 1), option: 0 })
      else if (key.upArrow || key.shift && key.tab) setQuestionUi({ ...questionUi, option: Math.max(0, questionUi.option - 1) })
      else if (key.downArrow || key.tab) setQuestionUi({ ...questionUi, option: Math.min(Math.max(0, question.options.length - 1), questionUi.option + 1) })
      else if (/^[1-9]$/u.test(input)) answerCurrentQuestion(Number(input) - 1)
      else if (input === ' ' && question.multiSelect) answerCurrentQuestion()
      else if (input === 'z') setQuestionUi({ ...questionUi, customEditing: true })
      else if (key.return) answerCurrentQuestion(undefined, question.multiSelect)
      else if (key.escape) {
        const selections = { ...questionUi.selections }; delete selections[question.id]
        if ((questionUi.selections[question.id]?.length ?? 0) > 0) setQuestionUi({ ...questionUi, selections })
        else setBlockingFocused(false)
      }
      return
    }

    // Grok's simple-mode policy: a running turn swallows Esc. When drafts were
    // sent and not yet taken over, Esc takes over with them; otherwise it is
    // the plain stop.
    if (key.escape && runtime.agentStatus === 'running') {
      if (lastSentAt.current !== 0) {
        controller?.takeOver(lastSentTexts.current)
        lastSentTexts.current = []
      } else {
        controller?.cancel()
      }
      lastSentAt.current = 0
      setStopArmed(false)
      return
    }

    if (overlay !== undefined) {
      if (overlay.kind === 'commands') {
        const items = matchingCommands(controller?.commandChoices() ?? [], editor.text)
        if (key.escape) setOverlay(undefined)
        else if (key.upArrow) setOverlay({ ...overlay, selected: Math.max(0, overlay.selected - 1) })
        else if (key.downArrow || key.tab) setOverlay({ ...overlay, selected: Math.min(Math.max(0, items.length - 1), overlay.selected + 1) })
        else if (key.return && items.length > 0) runChoice(items[Math.min(overlay.selected, items.length - 1)]!)
        else if (key.backspace) setEditor(value => backspace(value))
        else if (!key.ctrl && !key.meta && input !== '') setEditor(value => insertText(value, input))
      } else if (overlay.kind === 'sessions') {
        if (key.escape) setOverlay(undefined)
        else if (key.upArrow) setOverlay({ ...overlay, selected: Math.max(0, overlay.selected - 1) })
        else if (key.downArrow || key.tab) setOverlay({ ...overlay, selected: Math.min(Math.max(0, overlay.items.length - 1), overlay.selected + 1) })
        else if (key.return && overlay.items[overlay.selected] !== undefined) {
          const id = overlay.items[overlay.selected]!.id
          setOverlay(undefined); setEditor(EMPTY_EDITOR); void controller?.switchSession(id)
        }
      } else if (overlay.kind === 'models') {
        if (key.escape) setOverlay(undefined)
        else if (!overlay.loading && key.upArrow) setOverlay({ ...overlay, selected: Math.max(0, overlay.selected - 1) })
        else if (!overlay.loading && (key.downArrow || key.tab)) setOverlay({ ...overlay, selected: Math.min(Math.max(0, overlay.items.length - 1), overlay.selected + 1) })
        else if (!overlay.loading && key.return && overlay.items[overlay.selected] !== undefined) {
          const model = overlay.items[overlay.selected]!
          setOverlay(undefined)
          void controller?.switchModel(model.provider, model.id)
        }
      } else if (overlay.kind === 'efforts') {
        if (key.escape) setOverlay(undefined)
        else if (!overlay.loading && key.upArrow) setOverlay({ ...overlay, selected: Math.max(0, overlay.selected - 1) })
        else if (!overlay.loading && (key.downArrow || key.tab)) setOverlay({ ...overlay, selected: Math.min(Math.max(0, overlay.items.length - 1), overlay.selected + 1) })
        else if (!overlay.loading && key.return && overlay.items[overlay.selected] !== undefined) {
          const effort = overlay.items[overlay.selected]!
          setOverlay(undefined)
          void controller?.switchEffort(effort.id)
        }
      } else if (overlay.kind === 'permissions') {
        const names = controller?.permissionNames() ?? []
        if (key.escape) setOverlay(undefined)
        else if (key.upArrow) setOverlay({ ...overlay, selected: Math.max(0, overlay.selected - 1) })
        else if (key.downArrow || key.tab) setOverlay({ ...overlay, selected: Math.min(Math.max(0, names.length - 1), overlay.selected + 1) })
        else if (key.return && names[overlay.selected] !== undefined) {
          const ok = overlay.forApproval ? controller?.answerApprovalWithPreset(names[overlay.selected]!) : controller?.selectPermission(names[overlay.selected]!)
          if (ok !== false) setOverlay(undefined)
        }
      } else if (overlay.kind === 'confirm-danger') {
        if (input === 'y') { controller?.selectPermission('danger-full-access'); setOverlay(undefined) }
        else if (input === 'n' || key.escape) setOverlay(undefined)
      } else if (overlay.kind === 'confirm-new') {
        if (input === 'y') { setOverlay(undefined); setEditor(EMPTY_EDITOR); void controller?.switchSession() }
        else if (input === 'n' || key.escape) setOverlay(undefined)
      } else if (key.escape || key.return) setOverlay(undefined)
      return
    }

    if (key.ctrl && input === 'y') {
      if (focus === 'composer' && editor.selection !== undefined && editor.selection.end > editor.selection.start) {
        const text = graphemes(editor.text).slice(editor.selection.start, editor.selection.end).join('')
        void copyToClipboard(text, props.stdout === undefined ? {} : { stdout: props.stdout })
          .then(result => controller?.notify(copyNotice(text, result)))
          .catch(() => controller?.notify('Clipboard copy failed'))
        return
      }
      copyBlock(focusedBlock)
      return
    }
    if (key.ctrl && input === 'e') {
      if (compact && thoughts.length > 0 && focusedBlock?.kind !== 'tool') {
        if (reasoningDetail !== undefined) { setReasoningDetail(undefined); return }
        const item = thoughts.find(thought => thought.key === focusedBlockKey) ?? thoughts.at(-1)
        focusBlock(item)
        openThoughtDetail(item)
        setFocus('transcript')
        return
      }
      const keys = blocks.map(item => item.key)
      const allExpanded = keys.length > 0 && keys.every(item => expandedBlocks.has(item))
      setExpandedBlocks(allExpanded ? new Set() : new Set(keys))
      return
    }
    if (key.ctrl && input === 'p' || input === '?' && editor.text === '') { setEditor({ ...EMPTY_EDITOR, text: '/', cursor: 1 }); setOverlay({ kind: 'commands', selected: 0 }); return }
    if (key.ctrl && input === 's') { openSessions(); return }
    if (key.ctrl && input === 'x') { setOverlay({ kind: 'keys' }); return }
    if (key.shift && key.tab) { controller?.cyclePermission(); return }
    if (key.tab) {
      if (!blockingFocused && (runtime.approval !== undefined || runtime.questions !== undefined)) setBlockingFocused(true)
      else {
        const next = focus === 'composer' ? 'transcript' : 'composer'
        if (next === 'transcript' && focusedBlockKey === undefined) focusBlock(blocks.at(-1))
        if (next === 'composer') setReasoningDetail(undefined)
        setFocus(next)
      }
      return
    }
    if (key.ctrl && input === 'c') {
      if (controller?.cancel() === true) return
      if (editor.text !== '') { setEditor(EMPTY_EDITOR); return }
      if (quitArmed) exit()
      else setQuitArmed(true)
      return
    }
    if (focus === 'transcript') {
      if (key.ctrl && input === 'm') { openModels(); return }
      if (reasoningDetail !== undefined && detailItem !== undefined) {
        const page = Math.max(1, viewportRows - 3)
        const total = presentReasoning(detailItem.text, { running: detailItem.running, width: Math.max(8, transcriptWidth - 4), mode: 'detail', offset: 0, rows: page }).totalRows
        if (key.pageUp || key.upArrow || key.ctrl && input === 'u') setReasoningDetail({ ...reasoningDetail, offset: Math.max(0, reasoningDetail.offset - page), follow: false })
        else if (key.pageDown || key.downArrow || key.ctrl && input === 'd') {
          const next = Math.min(Math.max(0, total - page), reasoningDetail.offset + page)
          setReasoningDetail({ ...reasoningDetail, offset: next, follow: next >= Math.max(0, total - page) && detailItem.running })
        }
        else if (key.escape || key.leftArrow || key.return) setReasoningDetail(undefined)
        return
      }
      if (key.pageUp) scrollTranscript('up', Math.max(1, viewportRows - 1))
      else if (key.pageDown) scrollTranscript('down', Math.max(1, viewportRows - 1))
      else if (key.ctrl && input === 'u') scrollTranscript('up', Math.max(1, Math.floor(viewportRows / 2)))
      else if (key.ctrl && input === 'd') scrollTranscript('down', Math.max(1, Math.floor(viewportRows / 2)))
      else if ((key.upArrow || key.downArrow) && blocks.length === 0) scrollTranscript(key.upArrow ? 'up' : 'down')
      else if (key.upArrow || key.downArrow) {
        const current = Math.max(0, blocks.findIndex(item => item.key === focusedBlockKey))
        const next = key.upArrow ? Math.max(0, current - 1) : Math.min(blocks.length - 1, current + 1)
        focusBlock(blocks[next])
      } else if (key.leftArrow && focusedBlock !== undefined) expandBlock(focusedBlock, false)
      else if (key.rightArrow && focusedBlock !== undefined) {
        if (compact && focusedBlock.kind === 'reasoning') openThoughtDetail(focusedBlock)
        else expandBlock(focusedBlock, true)
      } else if (key.return && focusedBlock !== undefined) {
        if (focusedBlock.kind === 'reasoning') openThoughtDetail(focusedBlock)
        else expandBlock(focusedBlock, !expandedBlocks.has(focusedBlock.key))
      }
      else if (key.end) setScrollOffset(0)
      else if (key.home) setScrollOffset(maxScroll)
      else if (key.escape) setFocus('composer')
      return
    }
    if (key.ctrl && input === 'm') { setEditor(value => ({ ...value, multiline: !value.multiline })); return }
    if (key.ctrl && input === 'l') { submitPrompt(true); return }
    if (key.ctrl && input === 'w') { setEditor(value => deleteWord(value)); return }
    if (key.ctrl && input === 'u') { setEditor(value => deleteToStart(value)); return }
    if (key.ctrl && input === 'k') { setEditor(value => deleteToEnd(value)); return }
    if (key.escape) {
      if (editor.selection !== undefined) setEditor(value => ({ ...value, selection: undefined }))
      return
    }
    // Paging the transcript never requires leaving the composer, exactly like the wheel.
    if (key.pageUp) { scrollTranscript('up', Math.max(1, viewportRows - 1)); return }
    if (key.pageDown) { scrollTranscript('down', Math.max(1, viewportRows - 1)); return }
    if (key.leftArrow) setEditor(value => moveCursor(value, -1))
    else if (key.rightArrow) setEditor(value => moveCursor(value, 1))
    else if (key.home) setEditor(value => moveCursorTo(value, 'start'))
    else if (key.end) setEditor(value => moveCursorTo(value, 'end'))
    else if (key.backspace) setEditor(value => backspace(value))
    else if (key.delete) setEditor(value => deleteForward(value))
    else if ((key.upArrow || key.downArrow) && key.ctrl) recallHistory(key.upArrow ? 'up' : 'down')
    else if (key.upArrow || key.downArrow) handleVerticalNav(key.upArrow ? 'up' : 'down', false)
    else if (key.return) {
      if (runtime.agentStatus === 'running' && editor.text.trim() === '') {
        // Double Enter: after a send it TAKES OVER — the queued drafts are
        // re-sent after the abort so the agent immediately continues thinking
        // with them, for as long as the turn still runs. Without a recent send
        // the second Enter just stops the turn (the armed window below).
        const now = Date.now()
        const takeover = lastSentAt.current !== 0
        const armed = enterAt.current !== 0 && now - enterAt.current <= DOUBLE_ENTER_MS
        if (takeover || armed) {
          enterAt.current = 0
          lastSentAt.current = 0
          setStopArmed(false)
          clearTimeout(stopTimer.current)
          if (takeover) controller?.takeOver(lastSentTexts.current)
          else controller?.cancel()
          lastSentTexts.current = []
          return
        }
        enterAt.current = now
        setStopArmed(true)
        clearTimeout(stopTimer.current)
        stopTimer.current = setTimeout(() => setStopArmed(false), DOUBLE_ENTER_MS + 250)
        controller?.notify('Enter again to stop the turn · Esc also stops')
        return
      }
      if (editor.multiline && !key.meta) setEditor(value => insertText(value, '\n'))
      else submitPrompt(false)
    } else if (!key.ctrl && !key.meta && input !== '') {
      const opensCommands = editor.text === '' && input.startsWith('/')
      setEditor(value => insertText(value, input))
      if (opensCommands) setOverlay({ kind: 'commands', selected: 0 })
    }
  })

  const title = sessionTitle(runtime) ?? runtime.sessionId ?? props.sessionId ?? props.resume ?? 'new session'
  const transcriptHeading = detailItem === undefined ? 'TRANSCRIPT' : 'THOUGHT DETAIL'
  // One clipped string: a wrapped heading would steal a transcript row and clip the newest line.
  const transcriptFacts = takeCells(
    `  seq ${state.lastSeq < 0 ? '—' : state.lastSeq}`
    + `${state.gap === undefined ? '' : ` · resnapshot ${state.gap.expected}→${state.gap.received}`}`
    + `${detailItem !== undefined ? '' : scroll > 0 ? ` · ↑ ${scroll} rows · End latest` : ' · live'}`,
    Math.max(0, transcriptWidth - 2 - displayWidth(transcriptHeading)),
  ).head
  const statusLine = formatFooter(runtime, runtime.error ?? runtime.notice, Math.max(1, columns - margin * 2), !veryNarrow)
  const help = runtime.approval !== undefined
    ? 'y allow · n reject · Esc park'
    : runtime.questions !== undefined
      ? 'arrows choose · Enter answer · Esc park'
      : overlay !== undefined
        ? '↑↓ choose · Enter open · Esc close'
        : reasoningDetail !== undefined
          ? 'PgUp/PgDn thought · Enter/Esc close · Ctrl+E all'
          : focus === 'transcript'
            ? '↑↓ block · ←→ fold · Ctrl+Y copy · End latest'
            : runtime.agentStatus === 'running'
              ? lastSentAt.current !== 0
                ? 'Enter again or Esc to take over · Ctrl+C hard stop'
                : stopArmed
                  ? 'Enter again to stop · Esc stops now'
                  : 'Esc stop · Enter sends · Enter again takes over'
              : 'Enter send · Ctrl+P commands · Ctrl+Y copy last block'
  const helpLine = middleEllipsis(quitArmed ? 'Ctrl+C again to quit' : compact ? help : `${help} · Ctrl+S sessions · Shift+Tab permissions`, Math.max(1, columns - margin * 2))

  return (
    <Box width={columns} height={rows} flexDirection="column" backgroundColor={theme.canvas}>
      <Box paddingX={margin} paddingTop={compact ? 0 : 1} alignItems="center" flexShrink={0}>
        {!compact && rows >= 28 && state.nodes.length === 0 && <Logo theme={theme} monochrome={theme.monochrome} />}
        <Box marginLeft={!compact && rows >= 28 && state.nodes.length === 0 ? 3 : 0} flexDirection="column">
          <Text bold color={theme.text}>{compact ? `dsh-tui · ${middleEllipsis(title, Math.max(8, columns - margin * 2 - 10))}` : 'DEEPSEEK / HARNESS'}</Text>
          {!compact && <Text color={theme.accent}>Abyss Workbench · {theme.name}</Text>}
          {!compact && <Text color={theme.muted}>{middleEllipsis(`Harness-native model + reasoning controls · ${title}`, Math.max(8, columns - 40))}</Text>}
        </Box>
      </Box>

      <Box marginX={margin} marginTop={compact ? 0 : 1} borderStyle={veryNarrow ? 'classic' : 'single'} borderColor={focus === 'transcript' ? theme.primary : theme.border} flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
        <Box><Text color={theme.primary}>{detailItem === undefined ? '◆ ' : '◇ '}</Text><Text bold color={theme.text}>{transcriptHeading}</Text><Text color={theme.muted}>{transcriptFacts}</Text></Box>
        <Box marginTop={compact ? 0 : 1} flexDirection="column" flexGrow={1} justifyContent="flex-end" overflow="hidden">
          {detailItem === undefined
            ? <TranscriptView rows={transcript} viewport={viewportRows} offset={scroll} theme={theme} plain={veryNarrow} selection={transcriptSel} />
            : <ReasoningDetailView item={detailItem} width={transcriptWidth} rows={viewportRows} offset={reasoningDetail?.offset ?? 0} theme={theme} />}
        </Box>
      </Box>

      <Box marginX={margin} flexDirection="column" flexShrink={0}>
        <ApprovalCard runtime={runtime} focused={blockingFocused} theme={theme} plain={veryNarrow} />
        <QuestionCard runtime={runtime} ui={questionUi} focused={blockingFocused} theme={theme} plain={veryNarrow} />
        {overlay !== undefined && <Panel overlay={overlay} editor={editor} controller={controller} runtime={runtime} store={store} theme={theme} plain={veryNarrow} width={Math.max(10, columns - margin * 2)} summaries={summaries} />}
        <Composer editor={editor} focused={focus === 'composer' && blockingFocused} runtime={runtime} theme={theme} plain={veryNarrow} lines={editorLines} hardwareCaret={caret !== undefined} />
      </Box>

      <Box paddingX={margin} flexDirection="column" flexShrink={0}>
        <Text color={runtime.error === undefined ? theme.muted : theme.danger}>{statusLine}</Text>
        <Text color={quitArmed ? theme.warning : theme.accent}>{helpLine}</Text>
      </Box>
    </Box>
  )
}
