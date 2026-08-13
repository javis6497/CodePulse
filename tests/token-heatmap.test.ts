import { describe, expect, it } from 'vitest'
import { buildTokenHeatmap } from '../src/renderer/src/token-heatmap'

describe('buildTokenHeatmap', () => {
  it('builds a Sunday-aligned contribution calendar and preserves exact daily tokens', () => {
    const cells = buildTokenHeatmap([
      { date: '2026-08-12', tokens: 43 },
      { date: '2026-08-13', tokens: 476_008 },
      { date: '2026-08-13T12:00:00Z', tokens: 2 }
    ], '2026-08-13')

    expect(new Date(`${cells[0]!.date}T00:00:00Z`).getUTCDay()).toBe(0)
    expect(cells.at(-1)?.date).toBe('2026-08-13')
    expect(cells.find((cell) => cell.date === '2026-08-12')).toMatchObject({ tokens: 43, level: 1 })
    expect(cells.find((cell) => cell.date === '2026-08-13')).toMatchObject({ tokens: 476_010, level: 4 })
  })

  it('ignores malformed dates and clamps negative usage to zero', () => {
    const cells = buildTokenHeatmap([
      { date: 'not-a-date', tokens: 100 },
      { date: '2026-08-13', tokens: -10 }
    ], '2026-08-13')

    expect(cells.at(-1)).toMatchObject({ date: '2026-08-13', tokens: 0, level: 0 })
  })
})
