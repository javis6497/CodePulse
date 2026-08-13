import type { DashboardSnapshot, UsageBreakdown, UsageSummary } from './contracts'

export function emptyBreakdown(): UsageBreakdown {
  return {
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    providers: { codex: 0, claude: 0 },
    models: {}
  }
}

export function emptyUsage(): UsageSummary {
  return {
    today: emptyBreakdown(),
    week: emptyBreakdown(),
    lifetime: emptyBreakdown(),
    windows: emptyBreakdown(),
    wsl: emptyBreakdown(),
    wslDistros: {},
    daily: []
  }
}

export function emptySnapshot(): DashboardSnapshot {
  return {
    usage: emptyUsage(),
    quota: [],
    activities: [],
    wslRuntimes: [],
    health: {
      codex: 'not-found',
      usage: 'empty',
      wsl: 'not-running',
      activityHook: 'not-installed'
    }
  }
}
