import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { QuotaWindow } from '../../shared/contracts'

interface PendingRequest {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

interface RateWindowWire {
  usedPercent?: number
  windowDurationMins?: number
  resetsAt?: number
}

interface RateLimitWire {
  limitId?: string
  limitName?: string | null
  primary?: RateWindowWire | null
  secondary?: RateWindowWire | null
  planType?: string | null
}

interface RateLimitsResponse {
  rateLimits?: RateLimitWire
  rateLimitsByLimitId?: Record<string, RateLimitWire>
}

export interface AccountUsageResponse {
  summary?: {
    lifetimeTokens?: number | null
  }
  dailyUsageBuckets?: Array<{ startDate: string; tokens: number }> | null
}

export interface CodexAccountSnapshot {
  quota: QuotaWindow[]
  plan?: string
  usage?: AccountUsageResponse
}

function executableCandidates(): string[] {
  const candidates = [process.env.CODEX_EXECUTABLE]
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    if (appData) candidates.push(join(appData, 'npm', 'codex.cmd'))
  }

  try {
    const locator = process.platform === 'win32' ? 'where.exe' : 'which'
    const result = spawnSync(locator, ['codex'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3_000
    })
    if (result.status === 0) {
      candidates.push(...result.stdout.split(/\r?\n/))
    }
  } catch {
    // The explicit and npm-global candidates remain available.
  }

  return candidates
    .map((candidate) => candidate?.trim())
    .filter((candidate): candidate is string => Boolean(candidate))
    .filter((candidate, index, all) => all.indexOf(candidate) === index)
}

function codexEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  if (!environment.CODEX_HOME?.trim()) {
    const profile = environment.USERPROFILE?.trim()
    if (profile) environment.CODEX_HOME = join(profile, '.codex')
  }
  return environment
}

export function locateCodexExecutable(): string | undefined {
  return executableCandidates().find((candidate) => existsSync(candidate))
}

export function normalizeQuota(response: RateLimitsResponse): QuotaWindow[] {
  const buckets = response.rateLimitsByLimitId && Object.keys(response.rateLimitsByLimitId).length
    ? response.rateLimitsByLimitId
    : response.rateLimits
      ? { [response.rateLimits.limitId || 'codex']: response.rateLimits }
      : {}

  const windows: QuotaWindow[] = []
  for (const [fallbackId, bucket] of Object.entries(buckets)) {
    const limitId = bucket.limitId || fallbackId
    const parts: Array<['primary' | 'secondary', RateWindowWire | null | undefined]> = [
      ['primary', bucket.primary],
      ['secondary', bucket.secondary]
    ]
    for (const [part, window] of parts) {
      if (!window || typeof window.usedPercent !== 'number') continue
      windows.push({
        limitId: part === 'primary' ? limitId : `${limitId}:${part}`,
        label: bucket.limitName?.trim() || durationLabel(window.windowDurationMins),
        usedPercent: Math.min(100, Math.max(0, window.usedPercent)),
        windowDurationMinutes: window.windowDurationMins,
        resetsAt: window.resetsAt
      })
    }
  }
  return windows
}

function durationLabel(minutes?: number): string {
  if (!minutes) return 'Current window'
  if (minutes % 10_080 === 0) return `${minutes / 10_080} week${minutes === 10_080 ? '' : 's'}`
  if (minutes % 1_440 === 0) return `${minutes / 1_440} day${minutes === 1_440 ? '' : 's'}`
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`
  return `${minutes} min`
}

export class CodexAppServerClient extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams
  private pending = new Map<number, PendingRequest>()
  private nextId = 1
  private stdoutBuffer = ''
  private initialized = false

  async fetchAccountSnapshot(): Promise<CodexAccountSnapshot> {
    await this.connect()
    const [limits, usage] = await Promise.all([
      this.request<RateLimitsResponse>('account/rateLimits/read'),
      this.request<AccountUsageResponse>('account/usage/read').catch(() => undefined)
    ])
    const mainBucket = limits.rateLimitsByLimitId?.codex || limits.rateLimits
    return {
      quota: normalizeQuota(limits),
      plan: mainBucket?.planType || undefined,
      usage
    }
  }

  stop(): void {
    this.initialized = false
    this.child?.kill()
    this.child = undefined
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Codex App Server disconnected'))
    }
    this.pending.clear()
  }

  private async connect(): Promise<void> {
    if (this.initialized && this.child && !this.child.killed) return
    this.stop()
    const executable = locateCodexExecutable()
    if (!executable) throw new Error('CODEX_NOT_FOUND')

    this.child = this.spawnServer(executable)
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.consumeOutput(chunk))
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk: string) => this.emit('diagnostic', chunk.trim().slice(0, 500)))
    this.child.once('exit', () => this.stop())
    this.child.once('error', (error) => this.emit('error', error))

    await this.request('initialize', {
      clientInfo: { name: 'codepulse', title: 'CodePulse', version: '0.1.5' }
    }, 45_000)
    this.notify('initialized', {})
    this.initialized = true
  }

  private spawnServer(executable: string): ChildProcessWithoutNullStreams {
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
      const nativeExecutable = join(dirname(executable), 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe')
      if (!existsSync(nativeExecutable)) throw new Error('Codex native executable not found')
      return spawn(nativeExecutable, ['app-server'], {
        env: codexEnvironment(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    }
    return spawn(executable, ['app-server'], {
      env: codexEnvironment(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  }

  private request<T>(method: string, params: unknown = null, timeoutMs = 15_000): Promise<T> {
    if (!this.child || this.child.killed) return Promise.reject(new Error('Codex App Server is not running'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timeout
      })
      this.child!.stdin.write(`${JSON.stringify({ method, id, params })}\n`)
    })
  }

  private notify(method: string, params: unknown): void {
    this.child?.stdin.write(`${JSON.stringify({ method, params })}\n`)
  }

  private consumeOutput(chunk: string): void {
    this.stdoutBuffer += chunk
    if (this.stdoutBuffer.length > 1_048_576) {
      this.stop()
      return
    }
    let newline = this.stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (line) this.handleMessage(line)
      newline = this.stdoutBuffer.indexOf('\n')
    }
  }

  private handleMessage(line: string): void {
    let message: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: unknown }
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message || `${pending.method} failed`))
      else pending.resolve(message.result)
      return
    }
    if (message.method) this.emit('notification', message.method, message.params)
  }
}
