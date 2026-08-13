export interface TokenHeatmapCell {
  date: string
  tokens: number
  level: 0 | 1 | 2 | 3 | 4
}

const DAY = 24 * 60 * 60 * 1_000

function dateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

export function buildTokenHeatmap(
  daily: Array<{ date: string; tokens: number }>,
  today = new Date().toISOString().slice(0, 10)
): TokenHeatmapCell[] {
  const totals = new Map<string, number>()
  for (const item of daily) {
    const date = item.date.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    totals.set(date, (totals.get(date) || 0) + Math.max(0, Math.round(item.tokens)))
  }

  const end = Date.parse(`${today}T00:00:00Z`)
  if (!Number.isFinite(end)) return []
  const firstDay = new Date(end - 364 * DAY)
  const start = firstDay.getTime() - firstDay.getUTCDay() * DAY
  const maximum = Math.max(...totals.values(), 1)
  const cells: TokenHeatmapCell[] = []

  for (let timestamp = start; timestamp <= end; timestamp += DAY) {
    const date = dateKey(timestamp)
    const tokens = totals.get(date) || 0
    const level = tokens === 0 ? 0 : Math.min(4, Math.ceil(tokens / maximum * 4)) as 1 | 2 | 3 | 4
    cells.push({ date, tokens, level })
  }
  return cells
}
