import { describe, expect, it } from 'vitest'
import type { ActivitySession } from '../src/shared/contracts'
import { hasNewCompletion } from '../src/main/services/completion-sound'

function activity(state: ActivitySession['state']): ActivitySession {
  return { sessionId: 'session', provider: 'codex', runtime: 'windows', state, startedAt: 1, updatedAt: 1 }
}

describe('hasNewCompletion', () => {
  it('triggers once only when an existing task becomes completed', () => {
    const states = new Map<string, ActivitySession['state']>()
    expect(hasNewCompletion([activity('working')], states)).toBe(false)
    expect(hasNewCompletion([activity('completed')], states)).toBe(true)
    expect(hasNewCompletion([activity('completed')], states)).toBe(false)
  })

  it('does not alert for completed history loaded at startup', () => {
    expect(hasNewCompletion([activity('completed')], new Map())).toBe(false)
  })
})
