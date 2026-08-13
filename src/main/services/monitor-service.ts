import { EventEmitter } from 'node:events'
import type { DashboardSnapshot, WslRuntime } from '../../shared/contracts'
import { emptySnapshot } from '../../shared/defaults'
import { ActivityService } from './activity-service'
import { CodexAppServerClient, type CodexAccountSnapshot } from './codex-app-server'
import { collectUsage } from './usage-collector'
import { UsageWatcher } from './usage-watcher'
import { discoverWslRuntimes, isWslInstalled, listRunningWslDistros } from './wsl-service'

function dateRangeTotal(buckets: Array<{ startDate: string; tokens: number }> | null | undefined, days: number): number {
  if (!buckets?.length) return 0
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - (days - 1))
  return buckets.reduce((total, bucket) => {
    const date = new Date(`${bucket.startDate}T00:00:00`)
    return date >= cutoff ? total + Math.max(0, bucket.tokens) : total
  }, 0)
}

export class MonitorService extends EventEmitter {
  private snapshot = emptySnapshot()
  private readonly codex = new CodexAppServerClient()
  private readonly activity: ActivityService
  private readonly usageWatcher = new UsageWatcher(() => void this.refresh())
  private refreshTimer?: NodeJS.Timeout
  private refreshing?: Promise<DashboardSnapshot>

  constructor(activityToken?: string, activityInboxPath?: string) {
    super()
    this.activity = new ActivityService(activityToken, activityInboxPath)
  }

  getActivityToken(): string {
    return this.activity.token
  }

  start(): void {
    this.codex.on('notification', (method: string) => {
      if (method === 'account/rateLimits/updated') void this.refresh()
    })
    this.activity.start()
    this.activity.on('changed', (activities) => {
      this.snapshot = {
        ...this.snapshot,
        activities,
        health: { ...this.snapshot.health, activityHook: 'receiving' }
      }
      this.emit('snapshot', this.getSnapshot())
    })
    void this.refresh()
    this.refreshTimer = setInterval(() => void this.refresh(), 60_000)
  }

  stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    void this.usageWatcher.stop()
    this.activity.stop()
    this.codex.stop()
  }

  getSnapshot(): DashboardSnapshot {
    return structuredClone(this.snapshot)
  }

  refresh(): Promise<DashboardSnapshot> {
    if (this.refreshing) return this.refreshing
    this.refreshing = this.performRefresh().finally(() => { this.refreshing = undefined })
    return this.refreshing
  }

  setActivityHookInstalled(installed: boolean): void {
    if (this.snapshot.health.activityHook === 'receiving') return
    this.snapshot = {
      ...this.snapshot,
      health: { ...this.snapshot.health, activityHook: installed ? 'pending-trust' : 'not-installed' }
    }
    this.emit('snapshot', this.getSnapshot())
  }

  private async performRefresh(): Promise<DashboardSnapshot> {
    let account: CodexAccountSnapshot | undefined
    let codexHealth: DashboardSnapshot['health']['codex'] = 'error'
    let message: string | undefined
    try {
      account = await this.codex.fetchAccountSnapshot()
      codexHealth = 'connected'
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      codexHealth = text === 'CODEX_NOT_FOUND' ? 'not-found' : text.includes('401') ? 'signed-out' : 'error'
      message = text
    }

    const installed = isWslInstalled()
    const running = installed ? listRunningWslDistros() : []
    let wslRuntimes: WslRuntime[] = []
    let wslHealth: DashboardSnapshot['health']['wsl'] = installed ? (running.length ? 'ready' : 'not-running') : 'not-installed'
    try {
      wslRuntimes = running.length ? discoverWslRuntimes() : []
      await this.usageWatcher.update(wslRuntimes)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      wslHealth = code === 'EACCES' ? 'denied' : 'error'
    }

    let usage = this.snapshot.usage
    let usageHealth: DashboardSnapshot['health']['usage'] = 'error'
    try {
      usage = await collectUsage(wslRuntimes)
      usageHealth = usage.lifetime.totalTokens > 0 ? 'ready' : 'empty'
    } catch (error) {
      message = message || (error instanceof Error ? error.message : String(error))
    }

    if (usage.lifetime.totalTokens === 0 && account?.usage) {
      const buckets = account.usage.dailyUsageBuckets
      usage.today.totalTokens = dateRangeTotal(buckets, 1)
      usage.week.totalTokens = dateRangeTotal(buckets, 7)
      usage.lifetime.totalTokens = account.usage.summary?.lifetimeTokens || 0
      usage.today.providers.codex = usage.today.totalTokens
      usage.week.providers.codex = usage.week.totalTokens
      usage.lifetime.providers.codex = usage.lifetime.totalTokens
    }
    if (account?.usage?.dailyUsageBuckets) {
      usage.daily = account.usage.dailyUsageBuckets.map((bucket) => ({ date: bucket.startDate, tokens: bucket.tokens }))
    }

    this.snapshot = {
      usage,
      quota: account?.quota || this.snapshot.quota,
      plan: account?.plan,
      lifetimeAccountTokens: account?.usage?.summary?.lifetimeTokens ?? undefined,
      activities: this.activity.list(),
      wslRuntimes,
      health: {
        codex: codexHealth,
        usage: usageHealth,
        wsl: wslHealth,
        activityHook: this.snapshot.health.activityHook,
        lastUpdatedAt: Date.now(),
        message
      }
    }
    this.emit('snapshot', this.getSnapshot())
    return this.getSnapshot()
  }
}
