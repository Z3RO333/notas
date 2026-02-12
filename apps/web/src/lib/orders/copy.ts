export function buildCopyPayload(codes: string[]): string {
  const normalized = Array.from(
    new Set(
      codes
        .map((code) => code.trim())
        .filter(Boolean)
    )
  )

  normalized.sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' }))
  return normalized.join('\n')
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fallback below
    }
  }

  if (typeof document === 'undefined') return false

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return copied
  } catch {
    return false
  }
}
