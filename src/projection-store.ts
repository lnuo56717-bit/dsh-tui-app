export interface ProjectionSnapshotView {
  readonly asOfSeq: number
  readonly values: Readonly<Record<string, unknown>>
}

export interface ProjectionRegistryLike<Session> {
  onChanged(listener: (session: Session, key: string, value: unknown, seq: number) => void): () => void
  snapshot(session: Session): { asOfSeq: number; values: Record<string, unknown> }
}

export interface AttachedProjections {
  dispose(): void
}

function detached(snapshot: { asOfSeq: number; values: Record<string, unknown> }): ProjectionSnapshotView {
  return Object.freeze({ asOfSeq: snapshot.asOfSeq, values: Object.freeze({ ...snapshot.values }) })
}

/** Subscribe first, then publish a whole consistent cut. Bursts coalesce to one microtask read. */
export function attachProjections<Session>(
  registry: ProjectionRegistryLike<Session>,
  session: Session,
  publish: (snapshot: ProjectionSnapshotView) => void,
): AttachedProjections {
  let active = true
  let queued = false
  const refresh = (): void => {
    if (!active) return
    queued = false
    publish(detached(registry.snapshot(session)))
  }
  const disposeChanged = registry.onChanged(changed => {
    if (!active || changed !== session || queued) return
    queued = true
    queueMicrotask(refresh)
  })
  refresh()
  return {
    dispose(): void {
      if (!active) return
      active = false
      disposeChanged()
    },
  }
}
