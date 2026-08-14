import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Box, Text, useApp, useInput, useWindowSize } from 'ink'
import type { TuiStartupValues } from '../startup.js'
import {
  type CommandChoice, InteractionController, type QuestionAnswerItem, type RuntimeSnapshot, type SessionChoice, type SubagentChoice,
} from '../interaction-controller.js'
import { TranscriptStore } from '../transcript-store.js'
import { cursorParts, deleteForward, deleteToEnd, deleteToStart, deleteWord, EMPTY_EDITOR, backspace, insertText, moveCursor, moveCursorTo, type EditorState } from './editor.js'
import { graphemes, middleEllipsis } from './display-width.js'
import { Logo } from './logo.js'
import { projectionValue, sessionInfoLines, sessionTitle, statusSegments } from './status.js'
import { resolveTheme, type Theme } from './theme.js'
import { TranscriptView } from './transcript-view.js'

export interface ShellProps extends TuiStartupValues {
  store?: TranscriptStore
  controller?: InteractionController
  sessionId?: string
  model?: string
}

type Overlay =
  | { kind: 'commands'; selected: number }
  | { kind: 'sessions'; selected: number; loading: boolean; items: SessionChoice[] }
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

export function borderStyleForWidth(columns: number): 'classic' | 'single' {
  return columns < 60 ? 'classic' : 'single'
}

function matchingCommands(items: readonly CommandChoice[], text: string): CommandChoice[] {
  const query = text.startsWith('/') ? text.slice(1).split(/\s/u, 1)[0]!.toLowerCase() : ''
  return items.filter(item => item.name.includes(query)).slice(0, 9)
}

function Panel({ overlay, editor, controller, runtime, store, theme, plain }: { overlay: Overlay; editor: EditorState; controller: InteractionController | undefined; runtime: RuntimeSnapshot; store: TranscriptStore; theme: Theme; plain: boolean }): React.JSX.Element {
  if (overlay.kind === 'commands') {
    const items = matchingCommands(controller?.commandChoices() ?? [], editor.text)
    return <PanelFrame title="COMMAND SONAR" theme={theme} plain={plain}>{items.length === 0
      ? <Text color={theme.warning}>No matching command</Text>
      : items.map((item, index) => <Text key={`${item.source}:${item.name}`} color={index === overlay.selected ? theme.primary : theme.text} bold={index === overlay.selected}>
          {index === overlay.selected ? '›' : ' '} /{item.name}<Text color={theme.muted}>  [{item.source}] {item.description}{item.inputHint === undefined ? '' : ` · ${item.inputHint}`}</Text>
        </Text>)}</PanelFrame>
  }
  if (overlay.kind === 'sessions') {
    return <PanelFrame title="SESSION SOUNDINGS" theme={theme} plain={plain}>{overlay.loading
      ? <Text color={theme.accent}>◌ Reading persisted sessions…</Text>
      : overlay.items.length === 0 ? <Text color={theme.muted}>No persisted sessions yet</Text>
        : overlay.items.slice(0, 9).map((item, index) => <Text key={item.id} color={index === overlay.selected ? theme.primary : theme.text} bold={index === overlay.selected}>
            {index === overlay.selected ? '›' : ' '} {item.id}<Text color={theme.muted}>  {item.cwd ?? 'cwd unknown'} · {new Date(item.createdAt).toLocaleString()}</Text>
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
    <Text><Text bold>Edit</Text>  Ctrl+W word · Ctrl+U to start · Ctrl+K to end · arrows/history</Text>
    <Text><Text bold>Open</Text>  Ctrl+P/? commands · Ctrl+S sessions · Ctrl+X keys</Text>
    <Text><Text bold>Move</Text>  Tab focus · PgUp/PgDn page · Ctrl+U/D half page · Esc back/park</Text>
    <Text><Text bold>Policy</Text> Shift+Tab cycles only advertised dsh permission presets</Text>
    <Text><Text bold>Blockers</Text> approval y/n/3 · questions arrows/digits/Space/z/Enter</Text>
    <Text><Text bold>Stop</Text>  Ctrl+C cancel, clear draft, then confirm quit</Text>
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
  try { return JSON.stringify(value) ?? String(value) } catch { return '[unserializable]' }
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

function Composer({ editor, focused, runtime, theme, plain }: { editor: EditorState; focused: boolean; runtime: RuntimeSnapshot; theme: Theme; plain: boolean }): React.JSX.Element {
  const parts = cursorParts(editor)
  const mode = runtime.agentStatus === 'running' ? 'FOLLOW-UP' : 'PROMPT'
  return <Box borderStyle={plain ? 'classic' : 'single'} borderColor={focused ? theme.primary : theme.border} minHeight={editor.multiline ? 6 : 4} paddingX={1} flexDirection="column">
    <Text><Text bold color={theme.primary}>⌁ {mode}</Text><Text color={theme.muted}> · {editor.multiline ? 'multiline · Alt+Enter sends' : 'Enter sends · Ctrl+M multiline'}</Text></Text>
    <Text color={theme.text}><Text color={theme.accent}>› </Text>{parts.before}<Text inverse={focused}>{parts.current}</Text>{parts.after}</Text>
  </Box>
}

export function Shell(props: ShellProps): React.JSX.Element {
  const { exit } = useApp()
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
  const [blockingFocused, setBlockingFocused] = useState(true)
  const [approvalOption, setApprovalOption] = useState(0)
  const [quitArmed, setQuitArmed] = useState(false)
  const [questionUi, setQuestionUi] = useState<QuestionUi>({ requestId: -1, index: 0, option: 0, selections: {}, customs: {}, customEditing: false })
  const compact = columns <= 80
  const veryNarrow = borderStyleForWidth(columns) === 'classic'
  const margin = veryNarrow ? 0 : compact ? 1 : 2
  const blockingRows = runtime.approval !== undefined || runtime.questions !== undefined ? 6 : 0
  const overlayRows = overlay === undefined ? 0 : overlay.kind === 'keys' ? 10 : overlay.kind === 'session-info' ? 9 : 7
  const composerRows = editor.multiline ? 6 : 4
  const nodeBudget = Math.max(1, rows - (compact ? 6 : 13) - blockingRows - overlayRows - composerRows)

  useEffect(() => {
    setBlockingFocused(true)
    setApprovalOption(0)
  }, [runtime.approval?.id, runtime.questions?.id])

  useEffect(() => {
    if (runtime.questions !== undefined && runtime.questions.id !== questionUi.requestId) {
      setQuestionUi({ requestId: runtime.questions.id, index: 0, option: 0, selections: {}, customs: {}, customEditing: false })
    }
  }, [runtime.questions?.id, questionUi.requestId])

  const openSessions = (): void => {
    if (controller === undefined) return
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

  const runChoice = (choice: CommandChoice): void => {
    if (controller === undefined) return
    const line = editor.text.startsWith('/') ? editor.text : `/${choice.name}`
    setOverlay(undefined)
    setEditor(EMPTY_EDITOR)
    void controller.executeCommand(line, choice.source).then(action => {
      if (action === 'quit') exit()
      else if (action === 'workflows') openWorkflows()
      else if (action === 'help' || action === 'keys' || action === 'session-info' || action === 'confirm-danger' || action === 'confirm-new') setOverlay({ kind: action })
      else if (action === 'sessions') openSessions()
    })
  }

  const submitPrompt = (steer = false): void => {
    if (editor.text.trim() === '') return
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
    if (question.multiSelect && !finalizeOnly) {
      setQuestionUi({ ...questionUi, selections })
      return
    }
    const answered = (item: typeof question): boolean => (selections[item.id]?.length ?? 0) > 0 || (questionUi.customs[item.id]?.trim() ?? '') !== ''
    if (!question.multiSelect && questionUi.index < request.questions.length - 1) {
      setQuestionUi({ ...questionUi, selections, index: questionUi.index + 1, option: 0, customEditing: false })
      return
    }
    if (request.questions.every(answered)) {
      const answers: QuestionAnswerItem[] = request.questions.map(item => ({
        id: item.id, selected: selections[item.id] ?? [],
        ...((questionUi.customs[item.id]?.trim() ?? '') === '' ? {} : { custom: questionUi.customs[item.id]!.trim() }),
      }))
      controller?.answerQuestions(answers)
    } else setQuestionUi({ ...questionUi, selections })
  }

  useInput((input, key) => {
    if (key.eventType === 'release') return
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
        if (key.escape) setQuestionUi({ ...questionUi, customEditing: false })
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

    if (key.ctrl && input === 'p' || input === '?' && editor.text === '') { setEditor({ ...EMPTY_EDITOR, text: '/', cursor: 1 }); setOverlay({ kind: 'commands', selected: 0 }); return }
    if (key.ctrl && input === 's') { openSessions(); return }
    if (key.ctrl && input === 'x') { setOverlay({ kind: 'keys' }); return }
    if (key.shift && key.tab) { controller?.cyclePermission(); return }
    if (key.tab) {
      if (!blockingFocused && (runtime.approval !== undefined || runtime.questions !== undefined)) setBlockingFocused(true)
      else setFocus(value => value === 'composer' ? 'transcript' : 'composer')
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
      if (key.pageUp || key.upArrow || key.ctrl && input === 'u') setScrollOffset(value => Math.min(Math.max(0, state.nodes.length - 1), value + nodeBudget))
      else if (key.pageDown || key.downArrow || key.ctrl && input === 'd') setScrollOffset(value => Math.max(0, value - nodeBudget))
      else if (key.end) setScrollOffset(0)
      else if (key.escape) setFocus('composer')
      return
    }
    if (key.ctrl && input === 'm') { setEditor(value => ({ ...value, multiline: !value.multiline })); return }
    if (key.ctrl && input === 'l') { submitPrompt(true); return }
    if (key.ctrl && input === 'w') { setEditor(value => deleteWord(value)); return }
    if (key.ctrl && input === 'u') { setEditor(value => deleteToStart(value)); return }
    if (key.ctrl && input === 'k') { setEditor(value => deleteToEnd(value)); return }
    if (key.leftArrow) setEditor(value => moveCursor(value, -1))
    else if (key.rightArrow) setEditor(value => moveCursor(value, 1))
    else if (key.home) setEditor(value => moveCursorTo(value, 'start'))
    else if (key.end) setEditor(value => moveCursorTo(value, 'end'))
    else if (key.backspace) setEditor(value => backspace(value))
    else if (key.delete) setEditor(value => deleteForward(value))
    else if (key.upArrow && editor.text === '' && history.length > 0) {
      const next = Math.min(history.length - 1, historyIndex + 1); setHistoryIndex(next)
      const text = history[history.length - 1 - next]!; setEditor({ ...EMPTY_EDITOR, text, cursor: graphemes(text).length })
    } else if (key.downArrow && editor.text === '' && historyIndex >= 0) {
      const next = historyIndex - 1; setHistoryIndex(next)
      const text = next < 0 ? '' : history[history.length - 1 - next]!; setEditor({ ...EMPTY_EDITOR, text, cursor: graphemes(text).length })
    } else if (key.return) {
      if (editor.multiline && !key.meta) setEditor(value => insertText(value, '\n'))
      else submitPrompt(false)
    } else if (!key.ctrl && !key.meta && input !== '') {
      const opensCommands = editor.text === '' && input.startsWith('/')
      setEditor(value => insertText(value, input))
      if (opensCommands) setOverlay({ kind: 'commands', selected: 0 })
    }
  })

  const title = sessionTitle(runtime) ?? runtime.sessionId ?? props.sessionId ?? props.resume ?? 'new session'
  const facts = statusSegments(runtime, !veryNarrow).join(' · ')
  const signal = runtime.error ?? runtime.notice
  const statusLine = middleEllipsis(signal === undefined ? facts : `${signal} │ ${facts}`, Math.max(1, columns - margin * 2))
  const help = runtime.approval !== undefined
    ? 'y allow · n reject · Esc park'
    : runtime.questions !== undefined
      ? 'arrows choose · Enter answer · Esc park'
      : overlay !== undefined
        ? '↑↓ choose · Enter open · Esc close'
        : focus === 'transcript'
          ? 'PgUp/PgDn scroll · Tab compose · Ctrl+X keys'
          : 'Enter send · Ctrl+P commands · Ctrl+X keys'
  const helpLine = middleEllipsis(quitArmed ? 'Ctrl+C again to quit' : compact ? help : `${help} · Ctrl+S sessions · Shift+Tab permissions`, Math.max(1, columns - margin * 2))

  return (
    <Box width={columns} height={rows} flexDirection="column" backgroundColor={theme.canvas}>
      <Box paddingX={margin} paddingTop={compact ? 0 : 1} alignItems="center" flexShrink={0}>
        {!compact && rows >= 28 && state.nodes.length === 0 && <Logo theme={theme} monochrome={theme.monochrome} />}
        <Box marginLeft={!compact && rows >= 28 && state.nodes.length === 0 ? 3 : 0} flexDirection="column">
          <Text bold color={theme.text}>{compact ? `dsh-tui · ${middleEllipsis(title, Math.max(8, columns - margin * 2 - 10))}` : 'DEEPSEEK / HARNESS'}</Text>
          {!compact && <Text color={theme.accent}>Abyss Workbench · {theme.name}</Text>}
          {!compact && <Text color={theme.muted}>{middleEllipsis(`M4 complete · ${title}`, Math.max(8, columns - 40))}</Text>}
        </Box>
      </Box>

      <Box marginX={margin} marginTop={compact ? 0 : 1} borderStyle={veryNarrow ? 'classic' : 'single'} borderColor={focus === 'transcript' ? theme.primary : theme.border} flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
        <Box><Text color={theme.primary}>◆ </Text><Text bold color={theme.text}>TRANSCRIPT</Text><Text color={theme.muted}>  seq {state.lastSeq < 0 ? '—' : state.lastSeq}{state.gap === undefined ? '' : ` · resnapshot ${state.gap.expected}→${state.gap.received}`}</Text></Box>
        <Box marginTop={compact ? 0 : 1} flexDirection="column" overflow="hidden">
          <TranscriptView state={state} width={Math.max(10, columns - margin * 2 - 4)} nodeBudget={nodeBudget} offset={Math.max(0, scrollOffset)} theme={theme} compact={compact} />
        </Box>
      </Box>

      <Box marginX={margin} flexDirection="column" flexShrink={0}>
        <ApprovalCard runtime={runtime} focused={blockingFocused} theme={theme} plain={veryNarrow} />
        <QuestionCard runtime={runtime} ui={questionUi} focused={blockingFocused} theme={theme} plain={veryNarrow} />
        {overlay !== undefined && <Panel overlay={overlay} editor={editor} controller={controller} runtime={runtime} store={store} theme={theme} plain={veryNarrow} />}
        <Composer editor={editor} focused={focus === 'composer' && blockingFocused} runtime={runtime} theme={theme} plain={veryNarrow} />
      </Box>

      <Box paddingX={margin} flexDirection="column" flexShrink={0}>
        <Text color={runtime.error === undefined ? theme.muted : theme.danger}>{statusLine}</Text>
        <Text color={quitArmed ? theme.warning : theme.accent}>{helpLine}</Text>
      </Box>
    </Box>
  )
}
