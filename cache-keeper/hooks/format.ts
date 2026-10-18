// Text for token counts, money and time spans shown in the band and toasts.

export function formatTokens(n: number): string {
  if (n < 1_000) return String(n)
  const thousands = Math.round(n / 100) / 10
  if (thousands < 1_000) return `${dropZeroDecimal(thousands.toFixed(1))}k`
  return `${dropZeroDecimal((n / 1_000_000).toFixed(1))}M`
}

export function formatUsd(n: number): string {
  if (n > 0 && n < 0.005) return '<$0.01'
  return `$${n.toFixed(2)}`
}

export function formatCountdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1_000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${unitOrNothing(minutes % 60, 'm')}`
  return `${Math.floor(hours / 24)}d${unitOrNothing(hours % 24, 'h')}`
}

function dropZeroDecimal(text: string): string {
  return text.endsWith('.0') ? text.slice(0, -2) : text
}

function unitOrNothing(value: number, unit: string): string {
  return value === 0 ? '' : `${value}${unit}`
}
