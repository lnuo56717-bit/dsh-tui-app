import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Box, Text, useInput } from 'ink'
import type {
  InteractionController, MemberTranscriptLease, SpawnTeammateInput,
} from '../interaction-controller.js'
import type { TeamActivityItem, TeamMemberView, TeamTaskView, TeamViewSnapshot } from '../team.js'
import { teamTaskId } from '../team.js'
import { TranscriptStore } from '../transcript-store.js'
import { displayWidth, middleEllipsis } from './display-width.js'
import { transcriptRows } from './transcript-rows.js'
import { TranscriptView } from './transcript-view.js'
import type { Theme } from './theme.js'
import { THINKING_REST_GLYPH } from './timing.js'

export type TeamTab = 'roster' | 'tasks' | 'activity'
type FormKind = 'member' | 'message' | 'task-create' | 'task-edit' | 'task-reassign'
type TaskAction = 'claim' | 'release' | 'edit' | 'set_dependencies' | 'complete' | 'reopen' | 'reassign' | 'delete'

interface FormState {
  readonly kind: FormKind
  readonly title: string
  readonly labels: readonly string[]
  readonly values: readonly string[]
  readonly field: number
  readonly member?: TeamMemberView
  readonly task?: TeamTaskView
  readonly context?: 'fresh' | 'fork'
}

export type TeamMode =
  | { readonly kind: 'browse' }
  | FormState
  | { readonly kind: 'dependency-picker'; readonly purpose: 'create' | 'update'; readonly selected: number; readonly chosen: readonly string[]; readonly task?: TeamTaskView; readonly subject?: string; readonly description?: string; readonly writeScopes?: readonly string[] }
  | { readonly kind: 'task-actions'; readonly task: TeamTaskView; readonly selected: number }
  | { readonly kind: 'confirm-interrupt'; readonly member: TeamMemberView }
  | { readonly kind: 'confirm-delete'; readonly task: TeamTaskView }
  | { readonly kind: 'transcript'; readonly member: TeamMemberView; readonly lease: MemberTranscriptLease; readonly offset: number }

const EMPTY_TEAM: TeamViewSnapshot = { members: [], tasks: [], activity: [] }
const TASK_ACTIONS: readonly { readonly id: TaskAction; readonly label: string }[] = [
  { id: 'claim', label: 'Claim as Lead' },
  { id: 'release', label: 'Release to pending' },
  { id: 'edit', label: 'Edit text / write scopes' },
  { id: 'set_dependencies', label: 'Set dependencies' },
  { id: 'complete', label: 'Complete' },
  { id: 'reopen', label: 'Reopen' },
  { id: 'reassign', label: 'Reassign owner' },
  { id: 'delete', label: 'Delete' },
] as const

function editLast(value: string, remove: boolean, input: string): string {
  return remove ? Array.from(value).slice(0, -1).join('') : value + input
}

function csv(value: string): string[] {
  return value.split(',').map(item => item.trim()).filter(Boolean)
}

function visibleWindow<T>(items: readonly T[], selected: number, limit: number): Array<{ readonly item: T; readonly index: number }> {
  const start = Math.max(0, Math.min(selected - Math.floor(limit / 2), Math.max(0, items.length - limit)))
  return items.slice(start, start + limit).map((item, offset) => ({ item, index: start + offset }))
}

function shortId(value: unknown): string {
  const id = String(value)
  return id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`
}

function statusColor(status: TeamMemberView['status'], theme: Theme): string {
  if (status === 'running' || status === 'provisioning') return theme.warning
  if (status === 'failed') return theme.danger
  if (status === 'idle') return theme.success
  return theme.muted
}

function taskColor(status: TeamTaskView['status'], theme: Theme): string {
  if (status === 'completed') return theme.success
  if (status === 'in_progress') return theme.primary
  if (status === 'deleted') return theme.danger
  return theme.text
}

function activityGlyph(item: TeamActivityItem): string {
  if (item.kind === 'member') return '◆'
  if (item.kind === 'task') return '□'
  if (item.kind === 'message-queued') return '→'
  return '✓'
}

function FormPanel({ form, theme, width }: { readonly form: FormState; readonly theme: Theme; readonly width: number }): React.JSX.Element {
  return <Box borderStyle="double" borderColor={theme.primary} flexDirection="column" paddingX={1} width={width}>
    <Text bold color={theme.primary}>{form.title}</Text>
    {form.labels.map((label, index) => <Text key={label} color={index === form.field ? theme.primary : theme.text} bold={index === form.field} wrap="truncate">
      {index === form.field ? '›' : ' '} {label}: {middleEllipsis(form.values[index] ?? '', Math.max(4, width - displayWidth(label) - 8))}{index === form.field ? '▌' : ''}
    </Text>)}
    {form.kind === 'member' && <Text color={form.field === form.labels.length ? theme.primary : theme.muted}>
      {form.field === form.labels.length ? '›' : ' '} context: {form.context ?? 'fresh'} · ←→ toggles
    </Text>}
    <Text color={theme.muted}>Tab/Shift+Tab field · Enter next/submit · Esc cancel</Text>
  </Box>
}

function MemberLog({ mode, theme, width, height, plain }: {
  readonly mode: Extract<TeamMode, { kind: 'transcript' }>
  readonly theme: Theme
  readonly width: number
  readonly height: number
  readonly plain: boolean
}): React.JSX.Element {
  const state = useSyncExternalStore(mode.lease.store.subscribe, mode.lease.store.getSnapshot, mode.lease.store.getSnapshot)
  const rows = useMemo(() => transcriptRows(state, {
    width: Math.max(8, width - 6), compact: width <= 80, expandedBlocks: new Set(),
    focusedBlockKey: undefined, thinkingGlyph: THINKING_REST_GLYPH,
  }), [state, width])
  return <Box height={height} width={width} flexDirection="column" backgroundColor={theme.canvas} paddingX={plain ? 0 : 1}>
    <Text bold color={theme.primary}>TEAM / {mode.member.name} / READ-ONLY SESSION</Text>
    <Text color={theme.muted}>{mode.lease.live ? '● live stream' : '○ persisted SessionHandle'} · {shortId(mode.member.id)} · writes disabled</Text>
    <Box borderStyle={plain ? 'classic' : 'single'} borderColor={theme.border} flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      <TranscriptView rows={rows} viewport={Math.max(1, height - 6)} offset={mode.offset} theme={theme} plain={plain} />
    </Box>
    <Text color={theme.accent}>PgUp/PgDn scroll · Esc return</Text>
  </Box>
}

export function TeamCenter({ controller, width, height, theme, plain, onClose, initialView, initialTab = 'roster', initialMode }: {
  readonly controller: InteractionController
  readonly width: number
  readonly height: number
  readonly theme: Theme
  readonly plain: boolean
  readonly onClose: () => void
  /** Deterministic render seam; the live application leaves this absent. */
  readonly initialView?: TeamViewSnapshot
  readonly initialTab?: TeamTab
  readonly initialMode?: TeamMode
}): React.JSX.Element {
  const [view, setView] = useState<TeamViewSnapshot>(initialView ?? EMPTY_TEAM)
  const [tab, setTab] = useState<TeamTab>(initialTab)
  const [selected, setSelected] = useState<Record<TeamTab, number>>({ roster: 0, tasks: 0, activity: 0 })
  const [mode, setMode] = useState<TeamMode>(initialMode ?? { kind: 'browse' })
  const [loading, setLoading] = useState(initialView === undefined)
  const [error, setError] = useState<string | undefined>()
  const transcriptOpen = useRef<AbortController | undefined>(undefined)

  const refresh = async (): Promise<void> => {
    const next = await controller.teamView()
    setView(next)
    setSelected(current => ({
      roster: Math.min(current.roster, Math.max(0, next.members.length - 1)),
      tasks: Math.min(current.tasks, Math.max(0, next.tasks.length - 1)),
      activity: Math.min(current.activity, Math.max(0, next.activity.length - 1)),
    }))
  }

  useEffect(() => {
    const abort = new AbortController()
    setLoading(true)
    void controller.watchTeam(next => {
      setView(next); setLoading(false); setError(undefined)
    }, abort.signal).catch(reason => {
      if (!abort.signal.aborted) { setLoading(false); setError(reason instanceof Error ? reason.message : String(reason)) }
    })
    return () => {
      abort.abort()
    }
  // A session switch unmounts this component in the parent; the watcher owns
  // the only long wait and must be cancelled with the view.
  }, [controller])

  const transcriptLease = mode.kind === 'transcript' ? mode.lease : undefined
  useEffect(() => () => { void transcriptLease?.dispose() }, [transcriptLease])
  useEffect(() => () => { transcriptOpen.current?.abort() }, [])

  const items = tab === 'roster' ? view.members : tab === 'tasks' ? view.tasks : view.activity
  const current = selected[tab]
  const rowLimit = Math.max(1, height - 8)

  const fail = (reason: unknown): void => setError(reason instanceof Error ? reason.message : String(reason))
  const run = (operation: () => Promise<unknown>): void => {
    setError(undefined)
    void operation().then(async () => { await refresh(); setMode({ kind: 'browse' }) }).catch(async reason => {
      const message = reason instanceof Error ? reason.message : String(reason)
      if (/stale|revision|conflict/iu.test(message)) {
        await refresh().catch(() => undefined)
        setMode({ kind: 'browse' })
        setError('Task changed in another turn. Refreshed; review the latest revision and confirm again.')
      } else fail(reason)
    })
  }

  const move = (delta: number): void => setSelected(currentSelected => ({
    ...currentSelected,
    [tab]: Math.max(0, Math.min(Math.max(0, items.length - 1), currentSelected[tab] + delta)),
  }))

  const closeMode = (): void => {
    transcriptOpen.current?.abort()
    transcriptOpen.current = undefined
    setMode({ kind: 'browse' })
    setError(undefined)
  }

  const openTranscript = (member: TeamMemberView): void => {
    setError(undefined)
    transcriptOpen.current?.abort()
    const abort = new AbortController()
    transcriptOpen.current = abort
    void controller.openMemberTranscript(member, abort.signal).then(lease => {
      if (abort.signal.aborted) { void lease.dispose(); return }
      transcriptOpen.current = undefined
      setMode({ kind: 'transcript', member, lease, offset: 0 })
    }).catch(reason => { if (!abort.signal.aborted) fail(reason) })
  }

  const openTaskAction = (task: TeamTaskView, action: TaskAction): void => {
    if (action === 'delete') { setMode({ kind: 'confirm-delete', task }); return }
    if (action === 'edit') {
      setMode({ kind: 'task-edit', title: `EDIT ${String(task.id)} · r${task.revision}`, labels: ['subject', 'description', 'write scopes (comma)'], values: [task.subject, task.description, task.writeScopes.join(', ')], field: 0, task })
      return
    }
    if (action === 'set_dependencies') {
      setMode({ kind: 'dependency-picker', purpose: 'update', selected: 0, chosen: task.blockedBy.map(String), task })
      return
    }
    if (action === 'reassign') {
      setMode({ kind: 'task-reassign', title: `REASSIGN ${String(task.id)} · r${task.revision}`, labels: ['owner (lead/name; blank releases)'], values: [task.ownerName ?? ''], field: 0, task })
      return
    }
    run(() => controller.updateTeamTask({ taskId: task.id, expectedRevision: task.revision, action }))
  }

  const submitForm = (form: FormState): void => {
    if (form.kind === 'member') {
      const input: SpawnTeammateInput = { name: form.values[0] ?? '', description: form.values[1] ?? '', prompt: form.values[2] ?? '', context: form.context ?? 'fresh' }
      run(() => controller.spawnTeammate(input)); return
    }
    if (form.kind === 'message' && form.member !== undefined) {
      run(() => controller.sendTeamMessage(form.member!.name, form.values[0] ?? '')); return
    }
    if (form.kind === 'task-create') {
      setMode({ kind: 'dependency-picker', purpose: 'create', selected: 0, chosen: [], subject: form.values[0] ?? '', description: form.values[1] ?? '', writeScopes: csv(form.values[2] ?? '') }); return
    }
    const task = form.task
    if (task === undefined) return
    if (form.kind === 'task-edit') {
      run(() => controller.updateTeamTask({ taskId: task.id, expectedRevision: task.revision, action: 'edit', subject: form.values[0] ?? '', description: form.values[1] ?? '', writeScopes: csv(form.values[2] ?? '') })); return
    }
    run(() => controller.updateTeamTask({ taskId: task.id, expectedRevision: task.revision, action: 'reassign', owner: form.values[0]?.trim() ?? '' }))
  }

  useInput((input, key) => {
    if (key.eventType === 'release') return
    if (key.ctrl && input === 't') { onClose(); return }
    if (mode.kind === 'transcript') {
      if (key.escape) closeMode()
      else if (key.pageUp || key.upArrow) setMode({ ...mode, offset: mode.offset + (key.pageUp ? Math.max(1, height - 7) : 1) })
      else if (key.pageDown || key.downArrow) setMode({ ...mode, offset: Math.max(0, mode.offset - (key.pageDown ? Math.max(1, height - 7) : 1)) })
      return
    }
    if (mode.kind === 'confirm-interrupt') {
      if (input.toLowerCase() === 'y') {
        try {
          controller.interruptTeammate(mode.member.name)
          void refresh().catch(fail)
          setMode({ kind: 'browse' })
        } catch (reason) { fail(reason) }
      }
      else if (input.toLowerCase() === 'n' || key.escape) setMode({ kind: 'browse' })
      return
    }
    if (mode.kind === 'confirm-delete') {
      if (input.toLowerCase() === 'y') run(() => controller.updateTeamTask({ taskId: mode.task.id, expectedRevision: mode.task.revision, action: 'delete' }))
      else if (input.toLowerCase() === 'n' || key.escape) setMode({ kind: 'browse' })
      return
    }
    if (mode.kind === 'task-actions') {
      if (key.escape) setMode({ kind: 'browse' })
      else if (key.upArrow) setMode({ ...mode, selected: Math.max(0, mode.selected - 1) })
      else if (key.downArrow || key.tab) setMode({ ...mode, selected: Math.min(TASK_ACTIONS.length - 1, mode.selected + 1) })
      else if (key.return) openTaskAction(mode.task, TASK_ACTIONS[mode.selected]!.id)
      return
    }
    if (mode.kind === 'dependency-picker') {
      const candidates = view.tasks.filter(task => mode.task === undefined || task.id !== mode.task.id)
      if (key.escape) { setMode({ kind: 'browse' }); return }
      if (key.upArrow) { setMode({ ...mode, selected: Math.max(0, mode.selected - 1) }); return }
      if (key.downArrow || key.tab) { setMode({ ...mode, selected: Math.min(Math.max(0, candidates.length - 1), mode.selected + 1) }); return }
      if (input === ' ' && candidates[mode.selected] !== undefined) {
        const id = String(candidates[mode.selected]!.id)
        const chosen = new Set(mode.chosen)
        chosen.has(id) ? chosen.delete(id) : chosen.add(id)
        setMode({ ...mode, chosen: [...chosen] }); return
      }
      if (key.return) {
        if (mode.purpose === 'create') {
          run(() => controller.createTeamTask({ subject: mode.subject ?? '', description: mode.description ?? '', blockedBy: mode.chosen, writeScopes: mode.writeScopes ?? [] }))
        } else if (mode.task !== undefined) {
          const task = mode.task
          run(() => controller.updateTeamTask({ taskId: task.id, expectedRevision: task.revision, action: 'set_dependencies', blockedBy: mode.chosen.map(teamTaskId) }))
        }
      }
      return
    }
    if (mode.kind !== 'browse') {
      const fields = mode.labels.length + (mode.kind === 'member' ? 1 : 0)
      if (key.escape) { setMode({ kind: 'browse' }); setError(undefined); return }
      if (key.tab) { setMode({ ...mode, field: (mode.field + (key.shift ? -1 : 1) + fields) % fields }); return }
      if (mode.kind === 'member' && mode.field === mode.labels.length) {
        if (key.leftArrow || key.rightArrow || input === ' ') setMode({ ...mode, context: mode.context === 'fork' ? 'fresh' : 'fork' })
        else if (key.return) submitForm(mode)
        return
      }
      if (key.return) {
        if (mode.field < fields - 1) setMode({ ...mode, field: mode.field + 1 })
        else submitForm(mode)
        return
      }
      if (key.backspace || key.delete) {
        const values = [...mode.values]; values[mode.field] = editLast(values[mode.field] ?? '', true, '')
        setMode({ ...mode, values }); return
      }
      if (!key.ctrl && !key.meta && input !== '') {
        const values = [...mode.values]; values[mode.field] = editLast(values[mode.field] ?? '', false, input)
        setMode({ ...mode, values })
      }
      return
    }

    if (key.escape) { onClose(); return }
    if (input === '1') { setTab('roster'); return }
    if (input === '2') { setTab('tasks'); return }
    if (input === '3') { setTab('activity'); return }
    if (key.upArrow) { move(-1); return }
    if (key.downArrow) { move(1); return }
    if (key.pageUp) { move(-Math.max(1, rowLimit - 1)); return }
    if (key.pageDown) { move(Math.max(1, rowLimit - 1)); return }
    if (tab === 'roster') {
      const member = view.members[current]
      if (input === 'n') setMode({ kind: 'member', title: 'CREATE TEAMMATE', labels: ['name', 'description', 'prompt'], values: ['', '', ''], field: 0, context: 'fresh' })
      else if (input === 'm' && member?.role === 'teammate') setMode({ kind: 'message', title: `MESSAGE ${member.name} · sent via Lead`, labels: ['message'], values: [''], field: 0, member })
      else if (input === 'x' && member?.role === 'teammate') setMode({ kind: 'confirm-interrupt', member })
      else if (key.return && member !== undefined) openTranscript(member)
    } else if (tab === 'tasks') {
      const task = view.tasks[current]
      if (input === 'n') setMode({ kind: 'task-create', title: 'CREATE TEAM TASK', labels: ['subject', 'description', 'write scopes (comma)'], values: ['', '', ''], field: 0 })
      else if (key.return && task !== undefined) setMode({ kind: 'task-actions', task, selected: 0 })
    }
  })

  if (mode.kind === 'transcript') return <MemberLog mode={mode} theme={theme} width={width} height={height} plain={plain} />

  const panelWidth = Math.max(20, width - (plain ? 0 : 2))
  const selectedMember = tab === 'roster' ? view.members[current] : undefined
  return <Box width={width} height={height} flexDirection="column" backgroundColor={theme.canvas} paddingX={plain ? 0 : 1}>
    <Box justifyContent="space-between">
      <Text bold color={theme.primary}>DEEPSEEK / AGENT TEAMS</Text>
      <Text color={theme.muted}>{view.members.filter(member => member.role === 'teammate').length}/8 teammates · {view.tasks.length}/256 tasks</Text>
    </Box>
    <Text color={theme.warning} wrap="truncate">All members share {middleEllipsis(controller.getSnapshot().cwd, Math.max(8, width - 34))} · write scopes are advisory, not file isolation.</Text>
    <Box marginTop={plain ? 0 : 1}>
      {(['roster', 'tasks', 'activity'] as const).map((item, index) => <Text key={item} bold={tab === item} color={tab === item ? theme.primary : theme.muted}>
        {index + 1} {item.toUpperCase()}{'  '}
      </Text>)}
    </Box>
    <Box borderStyle={plain ? 'classic' : 'single'} borderColor={theme.border} flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      {loading ? <Text color={theme.accent}>◌ Loading official Team state…</Text>
        : items.length === 0 ? <Text color={theme.muted}>{tab === 'roster' ? 'Lead roster is starting…' : tab === 'tasks' ? 'No shared tasks. Press n to create one.' : 'No Team activity yet.'}</Text>
          : tab === 'roster' ? visibleWindow(view.members, current, rowLimit).map(({ item, index }) => <Box key={String(item.id)} flexDirection="column">
              <Text bold={index === current} color={index === current ? theme.primary : theme.text} wrap="truncate">
                {index === current ? '›' : ' '} {item.role === 'lead' ? '★' : '○'} {item.name} <Text color={statusColor(item.status, theme)}>{item.status}</Text>
                <Text color={theme.muted}> · {item.model ?? 'model —'} · {item.context ?? 'root'} · {shortId(item.id)}</Text>
              </Text>
              {index === current && <Text color={theme.muted} wrap="truncate">  {item.description ?? 'Team Lead'}{item.diagnostics.length === 0 ? '' : ` · diagnostics: ${item.diagnostics.join('; ')}`}</Text>}
            </Box>)
            : tab === 'tasks' ? visibleWindow(view.tasks, current, rowLimit).map(({ item, index }) => <Box key={String(item.id)} flexDirection="column">
                <Text bold={index === current} color={index === current ? theme.primary : theme.text} wrap="truncate">
                  {index === current ? '›' : ' '} {String(item.id)} <Text color={taskColor(item.status, theme)}>{item.status}</Text> · r{item.revision} · {item.ownerName ?? 'unowned'} · {item.subject}
                </Text>
                {index === current && <>
                  <Text color={theme.muted} wrap="truncate">  {item.status === 'pending' ? item.ready ? 'ready' : 'blocked' : item.status === 'in_progress' ? 'active' : item.status === 'completed' ? 'done' : 'deleted'}{item.blockedBy.length === 0 ? '' : ` · blocked by ${item.blockedBy.join(', ')}`}{item.writeScopes.length === 0 ? '' : ` · scopes ${item.writeScopes.join(', ')}`}</Text>
                  {item.writeScopeWarnings.slice(0, 2).map(warning => <Text key={warning} color={theme.warning} wrap="truncate">  ⚠ {warning}</Text>)}
                </>}
              </Box>)
              : visibleWindow(view.activity, current, rowLimit).map(({ item, index }) => <Text key={item.id} bold={index === current} color={index === current ? theme.primary : theme.text} wrap="truncate">
                  {index === current ? '›' : ' '} {activityGlyph(item)} #{item.seq} {item.title}<Text color={theme.muted}>{item.detail === '' ? '' : ` · ${item.detail}`}</Text>
                </Text>)}
    </Box>
    {mode.kind !== 'browse' && mode.kind !== 'task-actions' && mode.kind !== 'dependency-picker' && mode.kind !== 'confirm-interrupt' && mode.kind !== 'confirm-delete' && <FormPanel form={mode} theme={theme} width={panelWidth} />}
    {mode.kind === 'task-actions' && <Box borderStyle="double" borderColor={theme.primary} flexDirection="column" paddingX={1}>
      <Text bold color={theme.primary}>TASK {String(mode.task.id)} · revision {mode.task.revision}</Text>
      {TASK_ACTIONS.map((action, index) => <Text key={action.id} bold={index === mode.selected} color={index === mode.selected ? theme.primary : theme.text}>{index === mode.selected ? '›' : ' '} {action.label}</Text>)}
      <Text color={theme.muted}>Every update uses this displayed revision; conflicts refresh without overwrite.</Text>
    </Box>}
    {mode.kind === 'dependency-picker' && <Box borderStyle="double" borderColor={theme.primary} flexDirection="column" paddingX={1}>
      <Text bold color={theme.primary}>{mode.purpose === 'create' ? 'CREATE TASK · DEPENDENCIES' : `DEPENDENCIES ${String(mode.task?.id)} · r${mode.task?.revision}`}</Text>
      {view.tasks.filter(task => mode.task === undefined || task.id !== mode.task.id).length === 0
        ? <Text color={theme.muted}>No other tasks; Enter saves with no dependencies.</Text>
        : view.tasks.filter(task => mode.task === undefined || task.id !== mode.task.id).map((task, index) => <Text key={String(task.id)} bold={index === mode.selected} color={index === mode.selected ? theme.primary : theme.text} wrap="truncate">
            {index === mode.selected ? '›' : ' '} [{mode.chosen.includes(String(task.id)) ? 'x' : ' '}] {String(task.id)} · {task.status} · {task.subject}
          </Text>)}
      <Text color={theme.muted}>↑↓ select · Space toggle · Enter save · Esc cancel</Text>
    </Box>}
    {mode.kind === 'confirm-interrupt' && <Text bold color={theme.warning}>Interrupt {mode.member.name}'s current turn? Identity and mailbox remain. y/N</Text>}
    {mode.kind === 'confirm-delete' && <Text bold color={theme.danger}>Delete task {String(mode.task.id)} at revision {mode.task.revision}? y/N</Text>}
    {error !== undefined && <Text color={theme.danger} wrap="truncate">{middleEllipsis(error, Math.max(1, width - 2))}</Text>}
    <Text color={theme.accent} wrap="truncate">{mode.kind !== 'browse' ? 'Esc back' : tab === 'roster' ? `↑↓ move · n new · m message · x interrupt · Enter ${selectedMember?.role === 'lead' ? 'Lead log' : 'member log'} · Esc close` : tab === 'tasks' ? '↑↓ move · n new · Enter actions · Esc close' : '↑↓ browse · PgUp/PgDn · Esc close'}</Text>
  </Box>
}
