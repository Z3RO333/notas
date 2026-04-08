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
