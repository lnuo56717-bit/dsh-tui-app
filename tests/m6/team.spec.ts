import { describe, expect, it } from 'vitest'
import { foldTeamActivity, TEAMMATE_NAME, teammatePrompt, teamMessageSource } from '../../src/team.js'
import { EMPTY_TRANSCRIPT, foldEvents, type EventLike } from '../../src/transcript-fold.js'

function event(seq: number, type: string, data: unknown): EventLike {
  return { seq, time: 1_700_000_000_000 + seq, type, data }
}

describe('Agent Teams durable event projections', () => {
  it('folds member, mailbox, delivery and task revisions in event order', () => {
    const events = [
      event(1, 'team/member', { member: { id: 'session-reviewer', name: 'reviewer', phase: 'active', description: 'review code' } }),
      event(2, 'team/message/queued', { teamId: 'session-lead', message: { id: 'm1', senderId: 'session-lead', senderName: 'lead', targetId: 'session-reviewer', content: [{ type: 'text', text: 'check it' }] } }),
      event(3, 'team/message/delivered', { teamId: 'session-lead', messageId: 'm1', targetId: 'session-reviewer' }),
      event(4, 'team/task', { task: { id: 'task-1', revision: 2, status: 'in_progress', subject: 'Audit' } }),
    ]
    expect(foldTeamActivity(events)).toMatchObject([
      { seq: 1, kind: 'member', title: 'reviewer · active' },
      { seq: 2, kind: 'message-queued', title: 'lead → reviewer · queued', detail: 'check it' },
      { seq: 3, kind: 'message-delivered', title: 'message delivered → reviewer', detail: 'm1' },
      { seq: 4, kind: 'task', title: 'task-1 · in_progress · r2', detail: 'Audit' },
    ])
  })

  it('keeps Team events out of raw cards and identifies delivered teammate prompts', () => {
    const events = [
      event(0, 'team/member', { member: { id: 's1', name: 'builder', phase: 'active' } }),
      event(1, 'team/task', { task: { id: 'task-1', revision: 1 } }),
      event(2, 'team/message/queued', { message: { id: 'm1' } }),
      event(3, 'team/message/delivered', { messageId: 'm1' }),
      event(4, 'user/message', { role: 'user', source: { kind: 'team-message', senderName: 'builder' }, content: [{ type: 'text', text: 'done' }] }),
    ]
    const state = foldEvents(events)
    expect(state.nodes.filter(node => node.kind === 'raw')).toEqual([])
    expect(state.nodes.at(-1)).toMatchObject({ kind: 'message', role: 'user', source: 'teammate builder' })
    expect(teamMessageSource({ kind: 'team-message', senderName: 'builder' })).toBe('teammate builder')
  })

  it('uses the official teammate identity prefix and lower-kebab validation', () => {
    expect(teammatePrompt('builder', 'Implement it')).toEqual([
      { type: 'text', text: '<system-reminder>\nYou are teammate "builder".\n</system-reminder>\n\n' },
      { type: 'text', text: 'Implement it' },
    ])
    expect(TEAMMATE_NAME.test('code-reviewer-2')).toBe(true)
    expect(TEAMMATE_NAME.test('Code Reviewer')).toBe(false)
    expect(foldEvents([])).toBe(EMPTY_TRANSCRIPT)
  })
})
