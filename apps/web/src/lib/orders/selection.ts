export function toggleSelectedNotaIds(previous: string[], notaId: string): string[] {
  if (previous.includes(notaId)) {
    return previous.filter((id) => id !== notaId)
  }

  return [...previous, notaId]
}

export function toggleVisibleNotaIds(
  previous: string[],
  visibleNotaIds: string[],
  allVisibleSelected: boolean,
): string[] {
  const visibleSet = new Set(visibleNotaIds)

  if (allVisibleSelected) {
    return previous.filter((id) => !visibleSet.has(id))
  }

  return Array.from(new Set([...previous, ...visibleNotaIds]))
}

export function mergeKnownOrderCodes(
  previous: Record<string, string>,
  entries: Array<{ notaId: string | null; orderCode: string | null | undefined }>,
): Record<string, string> {
  let changed = false
  const next = { ...previous }

  for (const entry of entries) {
    const notaId = entry.notaId?.trim()
    const orderCode = entry.orderCode?.trim()
    if (!notaId || !orderCode || next[notaId] === orderCode) continue
    next[notaId] = orderCode
    changed = true
  }

  return changed ? next : previous
}

export function getSelectedOrderCodes(
  selectedNotaIds: string[],
  knownOrderCodesByNotaId: Record<string, string>,
): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const notaId of selectedNotaIds) {
    const orderCode = knownOrderCodesByNotaId[notaId]?.trim()
    if (!orderCode || seen.has(orderCode)) continue
    seen.add(orderCode)
    result.push(orderCode)
  }

  return result
}
