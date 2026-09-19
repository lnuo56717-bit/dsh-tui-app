import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type {
  BrowserActorView, BrowserViewSnapshot, InteractionController,
} from '../interaction-controller.js'
import type { BrowserActivityView } from '../browser-control.js'
import { displayWidth, middleEllipsis } from './display-width.js'
import { padCells } from './status.js'
import type { Theme } from './theme.js'

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`
}

function controlGlyph(control: BrowserActorView['control']): string {
  if (control === 'enabled') return '●'
  if (control === 'paused') return 'Ⅱ'
  if (control === 'inactive') return '○'
  return '×'
}

function controlColor(control: BrowserActorView['control'], theme: Theme): string {
  if (control === 'enabled') return theme.success
  if (control === 'paused') return theme.warning
  if (control === 'unavailable') return theme.danger
  return theme.muted
}

function activityGlyph(activity: BrowserActivityView): string {
  if (activity.status === 'succeeded') return '✓'
  if (activity.status === 'failed' || activity.status === 'denied') return '×'
  if (activity.status === 'running') return '◆'
  return '…'
}

function activityColor(activity: BrowserActivityView, theme: Theme): string {
  if (activity.status === 'succeeded') return theme.success
  if (activity.status === 'failed' || activity.status === 'denied') return theme.danger
  if (activity.status === 'running') return theme.primary
  return theme.warning
}

function browserAction(tool: string): string {
  return `browser/${tool.replace(/^browser_/u, '').replaceAll('_', '-')}`
}

function visibleWindow<T>(items: readonly T[], offset: number, limit: number): readonly T[] {
  return items.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit))
}

export function BrowserCenter({ controller, width, height, theme, plain, onClose, initialView }: {
  readonly controller: InteractionController
  readonly width: number
  readonly height: number
  readonly theme: Theme
  readonly plain: boolean
  readonly onClose: () => void
  /** Deterministic render seam; the live application leaves this absent. */
  readonly initialView?: BrowserViewSnapshot
}): React.JSX.Element {
  const [view, setView] = useState<BrowserViewSnapshot>(initialView ?? controller.browserView())
  const [selected, setSelected] = useState(0)
  const [activityOffset, setActivityOffset] = useState(0)

  useEffect(() => {
    if (initialView !== undefined) return undefined
    const refresh = (): void => setView(controller.browserView())
    refresh()
    return controller.subscribeBrowser(refresh)
  }, [controller, initialView])

  useEffect(() => {
    setSelected(index => Math.min(index, Math.max(0, view.actors.length - 1)))
  }, [view.actors.length])

  const actor = view.actors[selected]
  const activityRows = Math.max(2, height - Math.min(6, Math.max(1, view.actors.length)) - 9)
  const activities = useMemo(
    () => visibleWindow(actor?.activity ?? [], activityOffset, activityRows),
    [actor?.activity, activityOffset, activityRows],
  )
  const maxActivityOffset = Math.max(0, (actor?.activity.length ?? 0) - activityRows)

  useInput((input, key) => {
    if (key.eventType === 'release') return
    if (key.escape || key.ctrl && input === 'b') { onClose(); return }
    if (key.upArrow) { setSelected(index => Math.max(0, index - 1)); setActivityOffset(0); return }
    if (key.downArrow) { setSelected(index => Math.min(Math.max(0, view.actors.length - 1), index + 1)); setActivityOffset(0); return }
    if (key.pageUp) { setActivityOffset(offset => Math.max(0, offset - activityRows)); return }
    if (key.pageDown) { setActivityOffset(offset => Math.min(maxActivityOffset, offset + activityRows)); return }
    if ((input === 'p' || key.return) && actor !== undefined && (actor.control === 'enabled' || actor.control === 'paused')) {
      controller.setBrowserPaused(actor.sessionId, actor.control !== 'paused')
      setView(controller.browserView())
    }
  })

  const inner = Math.max(12, width - (plain ? 2 : 4))
  const executable = view.executablePath === undefined ? 'not found' : view.executablePath
  const provider = view.provider ?? (view.configured ? 'not active' : 'disabled')
  const actorLimit = Math.min(6, Math.max(1, view.actors.length))
  const actorStart = Math.max(0, Math.min(selected, view.actors.length - actorLimit))

  return <Box width={width} height={height} flexDirection="column" backgroundColor={theme.canvas} paddingX={plain ? 0 : 1}>
    <Text bold color={theme.primary}>BROWSER / SAFE PLAYWRIGHT CONTROL</Text>
    <Text color={view.available ? theme.success : theme.danger} wrap="truncate">
      {view.available ? '● available' : '× unavailable'} · {provider} · isolated launch · {view.visible ? 'visible' : 'headless'}
    </Text>
    <Text color={theme.muted} wrap="truncate">{middleEllipsis(view.unavailableReason ?? executable, inner)}</Text>

    <Box marginTop={plain ? 0 : 1} borderStyle={plain ? 'classic' : 'single'} borderColor={theme.border} flexDirection="column" paddingX={1}>
      <Text bold color={theme.accent}>SESSIONS · each live Agent owns a separate browser</Text>
      {view.actors.length === 0
        ? <Text color={theme.muted}>No active Lead Session</Text>
        : view.actors.slice(actorStart, actorStart + actorLimit).map((item, row) => {
            const index = actorStart + row
            const id = shortId(item.sessionId)
            const suffix = `${item.role} · ${id} · ${item.memberStatus}${item.activeCalls > 0 ? ` · ${item.activeCalls} active` : ''}`
            const available = Math.max(4, inner - displayWidth(suffix) - 8)
            return <Text key={item.sessionId} bold={index === selected} color={index === selected ? theme.primary : theme.text} wrap="truncate">
              {index === selected ? '›' : ' '} <Text color={controlColor(item.control, theme)}>{controlGlyph(item.control)}</Text> {padCells(middleEllipsis(item.name, available), available)} <Text color={theme.muted}>{suffix}</Text>
            </Text>
          })}
    </Box>

    <Box marginTop={plain ? 0 : 1} borderStyle={plain ? 'classic' : 'single'} borderColor={theme.border} flexDirection="column" paddingX={1} flexGrow={1} overflow="hidden">
      <Text bold color={theme.accent}>RECENT ACTIVITY{actor === undefined ? '' : ` / ${actor.name}`}</Text>
      {activities.length === 0
        ? <Text color={theme.muted}>No browser calls in this live activation</Text>
        : activities.map(activity => <Text key={activity.callId} color={theme.text} wrap="truncate">
            <Text color={activityColor(activity, theme)}>{activityGlyph(activity)}</Text> {middleEllipsis(`${browserAction(activity.tool)} · ${activity.summary}`, Math.max(8, inner - 4))}
          </Text>)}
    </Box>

    <Text color={actor?.control === 'paused' ? theme.warning : theme.muted} wrap="truncate">
      {actor?.control === 'paused'
        ? 'Manual takeover active: enter credentials only in the visible browser, then press p to resume.'
        : 'p/Enter pause or resume · ↑↓ member · PgUp/PgDn activity · Esc close'}
    </Text>
    <Text color={theme.muted} wrap="truncate">Delivered clicks/navigation cannot be undone. Browser state ends with its live Session.</Text>
  </Box>
}
