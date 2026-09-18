import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  CreateTeamTaskRequest,
  SendTeamMessageRequest,
  SendTeamMessageResult,
  SpawnTeammateRequest,
  SpawnTeammateResult,
  TeamMemberView,
  TeamMembership,
  TeamTaskId,
  TeamTaskView,
  TeamWaitResult,
  UpdateTeamTaskRequest,
} from '@deepseek-ai/dsh-experimental-agent-team'
import type { EventLike } from './transcript-fold.js'

export type { TeamMemberView, TeamTaskView, TeamMembership, UpdateTeamTaskRequest }

/** Structural face used by the TUI; the official TeamService remains the sole state owner. */
export interface TeamServiceLike {
  tryMembership(agent: Agent): TeamMembership | undefined
  listMembers(agent: Agent): TeamMemberView[]
  listTasks(agent: Agent): TeamTaskView[]
  spawnTeammate(agent: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult>
  sendMessage(agent: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult>
  createTask(agent: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView>
  updateTask(agent: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView>
  interrupt(agent: Agent, targetName: string): { previousStatus: 'running' | 'idle' | 'inactive' }
  waitForChange(agent: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult>
}

export type TeamActivityKind = 'member' | 'message-queued' | 'message-delivered' | 'task'

export interface TeamActivityItem {
  readonly id: string
  readonly seq: number
  readonly time?: number
  readonly kind: TeamActivityKind
  readonly title: string
  readonly detail: string
}

export interface TeamViewSnapshot {
  readonly members: readonly TeamMemberView[]
  readonly tasks: readonly TeamTaskView[]
  readonly activity: readonly TeamActivityItem[]
}

const TEAM_EVENT_TYPES = new Set([
  'team/member', 'team/task', 'team/message/queued', 'team/message/delivered',
])

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function blockText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.map(blockValue => {
    const block = record(blockValue)
    if (block.type === 'text' || block.type === 'reasoning') return text(block.text)
    if (block.type === 'image') return `[image] ${text(record(block.attachment).name, 'attachment')}`
    return `[${text(block.type, 'content')}]`
  }).filter(Boolean).join(' ')
}

/** Stable, UI-only projection of durable Team events in the Lead log. */
export function foldTeamActivity(events: readonly EventLike[]): TeamActivityItem[] {
  const names = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'team/member') continue
    const member = record(record(event.data).member)
    const id = text(member.id)
    const name = text(member.name)
    if (id !== '' && name !== '') names.set(id, name)
  }

  const activity: TeamActivityItem[] = []
  for (const event of events) {
    if (!TEAM_EVENT_TYPES.has(event.type)) continue
    const data = record(event.data)
    const common = { id: `team:${event.seq}`, seq: event.seq, ...(event.time === undefined ? {} : { time: event.time }) }
    if (event.type === 'team/member') {
      const member = record(data.member)
      const name = text(member.name, 'teammate')
      const phase = text(member.phase, 'unknown')
      activity.push({ ...common, kind: 'member', title: `${name} · ${phase}`, detail: text(member.error, text(member.description)) })
      continue
    }
    if (event.type === 'team/task') {
      const task = record(data.task)
      const id = text(task.id, 'task')
      const revision = typeof task.revision === 'number' ? task.revision : '?'
      activity.push({
        ...common, kind: 'task', title: `${id} · ${text(task.status, 'unknown')} · r${revision}`,
        detail: text(task.subject, text(task.description)),
      })
      continue
    }
    if (event.type === 'team/message/queued') {
      const message = record(data.message)
      const sender = text(message.senderName, names.get(text(message.senderId)) ?? 'member')
      const targetId = text(message.targetId)
      const target = targetId === text(data.teamId) ? 'lead' : names.get(targetId) ?? (targetId || 'member')
      activity.push({
        ...common, kind: 'message-queued', title: `${sender} → ${target} · queued`,
        detail: blockText(message.content),
      })
      continue
    }
    const targetId = text(data.targetId)
    activity.push({
      ...common, kind: 'message-delivered', title: `message delivered → ${names.get(targetId) ?? (targetId === text(data.teamId) ? 'lead' : targetId || 'member')}`,
      detail: text(data.messageId),
    })
  }
  return activity
}

export const TEAMMATE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** Keep direct TUI creation byte-for-byte aligned with the official model tool identity prefix. */
export function teammatePrompt(name: string, prompt: string): SpawnTeammateRequest['prompt'] {
  return [
    { type: 'text', text: `<system-reminder>\nYou are teammate "${name.trim()}".\n</system-reminder>\n\n` },
    { type: 'text', text: prompt },
  ]
}

export function teamMessageSource(value: unknown): string | undefined {
  const source = record(value)
  if (source.kind !== 'team-message') return undefined
  const sender = text(source.senderName)
  return sender === '' ? 'teammate' : `teammate ${sender}`
}

export function teamTaskId(value: string): TeamTaskId {
  return value as TeamTaskId
}
