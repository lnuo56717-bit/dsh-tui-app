import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { ComputerActorView, ComputerViewSnapshot, InteractionController } from '../interaction-controller.js'
import type { ComputerActivityView } from '../computer-control.js'
import { displayWidth, middleEllipsis } from './display-width.js'
import { padCells } from './status.js'
import type { Theme } from './theme.js'

export const COMPUTER_ARM_CONFIRMATION = 'AUTO'
export function confirmsComputerArm(value: string): boolean { return value === COMPUTER_ARM_CONFIRMATION }

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`
}

function phaseGlyph(phase: ComputerActorView['phase']): string {
  if (phase === 'active') return '●'
  if (phase === 'pending' || phase === 'arming') return '◌'
  if (phase === 'paused') return 'Ⅱ'
  if (phase === 'stopping') return '■'
  if (phase === 'faulted' || phase === 'unavailable') return '×'
  return '○'
}

function phaseColor(phase: ComputerActorView['phase'], theme: Theme): string {
  if (phase === 'active') return theme.success
  if (phase === 'pending' || phase === 'arming' || phase === 'paused') return theme.warning
  if (phase === 'faulted' || phase === 'unavailable') return theme.danger
  return theme.muted
}

function activityGlyph(activity: ComputerActivityView): string {
  if (activity.status === 'succeeded') return '✓'
  if (activity.status === 'failed' || activity.status === 'denied') return '×'
  return '◆'
}

function activityColor(activity: ComputerActivityView, theme: Theme): string {
  if (activity.status === 'succeeded') return theme.success
  if (activity.status === 'failed' || activity.status === 'denied') return theme.danger
  return theme.primary
}

function visibleWindow<T>(items: readonly T[], offset: number, limit: number): readonly T[] {
  return items.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit))
}

export function ComputerCenter({ controller, width, height, theme, plain, onClose, initialView }: {
  readonly controller: InteractionController
  readonly width: number
  readonly height: number
  readonly theme: Theme
  readonly plain: boolean
  readonly onClose: () => void
  /** Deterministic render seam; the live application leaves this absent. */
  readonly initialView?: ComputerViewSnapshot
}): React.JSX.Element {
  const [view, setView] = useState<ComputerViewSnapshot>(initialView ?? controller.computerView())
  const [selected, setSelected] = useState(0)
  const [activityOffset, setActivityOffset] = useState(0)
  const [arming, setArming] = useState(false)
  const [confirmation, setConfirmation] = useState('')

  const refresh = (): void => setView(controller.computerView())
  useEffect(() => {
    if (initialView !== undefined) return undefined
    refresh()
    return controller.subscribeComputer(refresh)
  }, [controller, initialView])

  useEffect(() => {
    setSelected(index => Math.min(index, Math.max(0, view.actors.length - 1)))
  }, [view.actors.length])

  const actor = view.actors[selected]
  const activityRows = Math.max(2, height - Math.min(6, Math.max(1, view.actors.length)) - (arming ? 15 : 10))
  const activities = useMemo(
    () => visibleWindow(actor?.activity ?? [], activityOffset, activityRows),
    [actor?.activity, activityOffset, activityRows],
  )
  const maxActivityOffset = Math.max(0, (actor?.activity.length ?? 0) - activityRows)

  useInput((input, key) => {
    if (key.eventType === 'release') return
    if (arming) {
      if (key.escape) { setArming(false); setConfirmation(''); return }
      if (key.return) {
        if (!confirmsComputerArm(confirmation) || actor === undefined) return
        setArming(false)
        setConfirmation('')
        void controller.armComputer(actor.sessionId).then(refresh)
        return
      }
      if (key.backspace || key.delete) { setConfirmation(value => [...value].slice(0, -1).join('')); return }
      if (!key.ctrl && !key.meta && input !== '') setConfirmation(value => `${value}${input}`.slice(0, 16))
      return
    }
    if (key.escape || key.ctrl && (input === 'g' || input === 'b')) { onClose(); return }
    if (key.upArrow) { setSelected(index => Math.max(0, index - 1)); setActivityOffset(0); return }
    if (key.downArrow) { setSelected(index => Math.min(Math.max(0, view.actors.length - 1), index + 1)); setActivityOffset(0); return }
    if (key.pageUp) { setActivityOffset(offset => Math.max(0, offset - activityRows)); return }
    if (key.pageDown) { setActivityOffset(offset => Math.min(maxActivityOffset, offset + activityRows)); return }
    if (input === 'a' && actor !== undefined && view.available && actor.phase !== 'inactive' && actor.phase !== 'unavailable' && view.ownerSessionId === undefined) {
      setArming(true); setConfirmation(''); return
    }
    if (input === 'p' && actor?.leaseOwner === true) {
      void controller.setComputerPaused(actor.sessionId, !actor.paused).then(refresh)
      return
    }
    if (input === 'x' && actor?.leaseOwner === true) {
      void controller.stopComputer(actor.sessionId).then(refresh)
    }
  })

  const inner = Math.max(12, width - (plain ? 2 : 4))
  const actorLimit = Math.min(6, Math.max(1, view.actors.length))
  const actorStart = Math.max(0, Math.min(selected, view.actors.length - actorLimit))
  const owner = view.actors.find(item => item.leaseOwner)
  const health = view.unavailableReason ?? view.lastError ?? view.executablePath ?? 'Cua Driver path unavailable'

  return <Box width={width} height={height} flexDirection="column" backgroundColor={theme.canvas} paddingX={plain ? 0 : 1}>
    <Text bold color={theme.primary}>COMPUTER / CUA FULL-DESKTOP CONTROL</Text>
    <Text color={view.available ? theme.success : theme.danger} wrap="truncate">
      {view.available ? '● available' : '× unavailable'} · Cua Driver {view.driverVersion ?? 'not detected'} · {view.permissionMode} · {view.catalogSize} pinned tools
    </Text>
    <Text color={theme.muted} wrap="truncate">{middleEllipsis(health, inner)}</Text>

    <Box marginTop={plain ? 0 : 1} borderStyle={plain ? 'classic' : 'single'} borderColor={theme.border} flexDirection="column" paddingX={1}>
      <Text bold color={theme.accent}>AGENTS · one global desktop lease</Text>
      {view.actors.length === 0
        ? <Text color={theme.muted}>No active Lead Session</Text>
        : view.actors.slice(actorStart, actorStart + actorLimit).map((item, row) => {
            const index = actorStart + row
            const suffix = `${item.role} · ${shortId(item.sessionId)} · ${item.memberStatus}${item.activeCalls > 0 ? ` · ${item.activeCalls} active` : ''}`
            const available = Math.max(4, inner - displayWidth(suffix) - 8)
            return <Text key={item.sessionId} bold={index === selected} color={index === selected ? theme.primary : theme.text} wrap="truncate">
              {index === selected ? '›' : ' '} <Text color={phaseColor(item.phase, theme)}>{phaseGlyph(item.phase)}</Text> {padCells(middleEllipsis(item.name, available), available)} <Text color={theme.muted}>{suffix}</Text>
            </Text>
          })}
    </Box>

    {arming
      ? <Box marginTop={plain ? 0 : 1} borderStyle={plain ? 'classic' : 'double'} borderColor={theme.danger} flexDirection="column" paddingX={1} flexGrow={1}>
          <Text bold color={theme.danger}>ARM FULL AUTOMATION / {actor?.name ?? 'unknown'}</Text>
          <Text color={theme.warning}>The model may automatically control the entire desktop, clipboard, processes, files, browser, recordings and screenshots.</Text>
          <Text color={theme.warning}>All {view.catalogSize} pinned actions run without per-action TUI approval for one model turn. Persistent side effects are not rolled back.</Text>
          <Text color={theme.text}>Close private windows and never place passwords, tokens or payment secrets in the prompt.</Text>
          <Text color={theme.text}>Type <Text bold color={theme.danger}>{COMPUTER_ARM_CONFIRMATION}</Text> exactly, then press Enter:</Text>
          <Text bold color={confirmsComputerArm(confirmation) ? theme.success : theme.primary}>› {confirmation}<Text inverse> </Text></Text>
          <Text color={theme.muted}>Esc cancels without arming</Text>
        </Box>
      : <Box marginTop={plain ? 0 : 1} borderStyle={plain ? 'classic' : 'single'} borderColor={theme.border} flexDirection="column" paddingX={1} flexGrow={1} overflow="hidden">
          <Text bold color={theme.accent}>RECENT ACTIVITY{actor === undefined ? '' : ` / ${actor.name}`}</Text>
          {activities.length === 0
            ? <Text color={theme.muted}>No CUA calls in this live activation</Text>
            : activities.map(activity => <Text key={activity.callId} color={theme.text} wrap="truncate">
                <Text color={activityColor(activity, theme)}>{activityGlyph(activity)}</Text> {middleEllipsis(`computer/${activity.tool.replaceAll('_', '-')} · ${activity.summary}`, Math.max(8, inner - 4))}
              </Text>)}
        </Box>}

    <Text bold color={owner === undefined ? theme.muted : theme.warning} wrap="truncate">
      {owner === undefined ? 'CUA: disarmed' : `CUA: ${owner.name} armed · ${owner.phase}${owner.paused ? ' · paused' : ''}`}
    </Text>
    <Text color={theme.muted} wrap="truncate">a arm (type AUTO) · p pause/resume · x emergency stop · ↑↓ Agent · PgUp/PgDn activity · Esc close</Text>
    <Text color={theme.muted} wrap="truncate">Emergency stop blocks new calls and cancels the owner turn; OS actions already delivered cannot be undone.</Text>
  </Box>
}
