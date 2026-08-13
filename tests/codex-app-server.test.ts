import { describe, expect, it } from 'vitest'
import { normalizeQuota } from '../src/main/services/codex-app-server'

describe('normalizeQuota', () => {
  it('keeps provider-defined quota windows dynamic', () => {
    const windows = normalizeQuota({
      rateLimitsByLimitId: {
        codex: {
          limitId: 'codex',
          primary: { usedPercent: 31, windowDurationMins: 300, resetsAt: 1_800_000_000 },
          secondary: { usedPercent: 74, windowDurationMins: 10_080, resetsAt: 1_800_100_000 }
        }
      }
    })

    expect(windows).toEqual([
      {
        limitId: 'codex',
        label: '5 hours',
        usedPercent: 31,
        windowDurationMinutes: 300,
        resetsAt: 1_800_000_000
      },
      {
        limitId: 'codex:secondary',
        label: '1 week',
        usedPercent: 74,
        windowDurationMinutes: 10_080,
        resetsAt: 1_800_100_000
      }
    ])
  })

  it('falls back to the legacy single bucket and clamps invalid percentages', () => {
    const windows = normalizeQuota({
      rateLimits: { limitId: 'codex', limitName: 'Plan period', primary: { usedPercent: 120 } }
    })
    expect(windows[0]).toMatchObject({ limitId: 'codex', label: 'Plan period', usedPercent: 100 })
  })
})
