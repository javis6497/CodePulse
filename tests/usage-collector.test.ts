import { describe, expect, it } from 'vitest'
import { extractTokscaleUsage } from '../src/main/services/usage-collector'

describe('extractTokscaleUsage', () => {
  it('aggregates Codex and Claude without double-counting reasoning tokens', () => {
    const result = extractTokscaleUsage({ entries: [
      { client: 'codex', model: 'gpt-5', input: 100, cacheRead: 40, output: 20, reasoning: 12 },
      { client: 'claude', model: 'claude-sonnet', inputTokens: 80, cachedTokens: 15, outputTokens: 10 }
    ] })

    expect(result.totalTokens).toBe(265)
    expect(result.providers).toEqual({ codex: 160, claude: 105 })
    expect(result.reasoningTokens).toBe(12)
    expect(result.models).toEqual({ 'gpt-5': 160, 'claude-sonnet': 105 })
  })

  it('accepts tokscale total-token aliases', () => {
    const result = extractTokscaleUsage({ data: [{ source: 'codex-cli', total_tokens: '1,234' }] })
    expect(result.totalTokens).toBe(1234)
    expect(result.providers.codex).toBe(1234)
  })

  it('keeps empty payloads empty', () => {
    expect(extractTokscaleUsage({ entries: [] }).totalTokens).toBe(0)
  })
})
