import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import type { UsageBreakdown, UsageSummary, WslRuntime } from '../../shared/contracts'
import { emptyBreakdown, emptyUsage } from '../../shared/defaults'

const require = createRequire(import.meta.url)
const TOKEN_KEYS = ['totalTokens', 'total_tokens', 'tokens', 'tokenCount', 'token_count']
const INPUT_KEYS = ['input', 'inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens', 'totalInput']
const OUTPUT_KEYS = ['output', 'outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens', 'totalOutput']
const CACHE_KEYS = ['cacheRead', 'cacheReadTokens', 'cache_read_tokens', 'cachedTokens', 'cached_tokens', 'cacheReadInputTokens', 'totalCacheRead']
const CACHE_WRITE_KEYS = ['cacheWrite', 'cacheWriteTokens', 'cache_write_tokens', 'cacheCreationInputTokens', 'totalCacheWrite']
const REASONING_KEYS = ['reasoning', 'reasoningTokens', 'reasoning_tokens']

function firstNumber(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key]
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replaceAll(',', '')) : 0
    if (Number.isFinite(number) && number !== 0) return number
  }
  return 0
}

function providerOf(record: Record<string, unknown>): 'codex' | 'claude' | undefined {
  const value = String(record.client || record.source || record.platform || record.agent || record.tool || record.name || '').toLowerCase()
  if (value.includes('codex')) return 'codex'
  if (value.includes('claude')) return 'claude'
  return undefined
}

function modelOf(record: Record<string, unknown>): string | undefined {
  const model = String(record.model || record.modelName || record.model_name || record.engine || '').trim()
  return model || undefined
}

function totalOf(record: Record<string, unknown>): number {
  const direct = firstNumber(record, TOKEN_KEYS)
  if (direct) return direct
  return firstNumber(record, INPUT_KEYS)
    + firstNumber(record, OUTPUT_KEYS)
    + firstNumber(record, CACHE_KEYS)
    + firstNumber(record, CACHE_WRITE_KEYS)
}

function looksLikeRow(record: Record<string, unknown>): boolean {
  return totalOf(record) > 0 && Boolean(providerOf(record) || modelOf(record) || record.date)
}

function collectRows(node: unknown, rows: Array<Record<string, unknown>>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRows(item, rows)
    return
  }
  if (!node || typeof node !== 'object') return
  const record = node as Record<string, unknown>
  if (looksLikeRow(record)) {
    rows.push(record)
    return
  }
  for (const value of Object.values(record)) collectRows(value, rows)
}

export function extractTokscaleUsage(json: unknown): UsageBreakdown {
  const result = emptyBreakdown()
  const rows: Array<Record<string, unknown>> = []
  collectRows(json, rows)
  for (const row of rows) {
    const provider = providerOf(row)
    const model = modelOf(row)
    const total = Math.max(0, Math.round(totalOf(row)))
    result.totalTokens += total
    result.inputTokens += Math.max(0, Math.round(firstNumber(row, INPUT_KEYS)))
    result.outputTokens += Math.max(0, Math.round(firstNumber(row, OUTPUT_KEYS)))
    result.cachedInputTokens += Math.max(0, Math.round(firstNumber(row, CACHE_KEYS) + firstNumber(row, CACHE_WRITE_KEYS)))
    result.reasoningTokens += Math.max(0, Math.round(firstNumber(row, REASONING_KEYS)))
    if (provider) result.providers[provider] += total
    if (model) result.models[model] = (result.models[model] || 0) + total
  }
  return result
}

function mergeBreakdowns(target: UsageBreakdown, source: UsageBreakdown): void {
  target.totalTokens += source.totalTokens
  target.inputTokens += source.inputTokens
  target.cachedInputTokens += source.cachedInputTokens
  target.outputTokens += source.outputTokens
  target.reasoningTokens += source.reasoningTokens
  target.providers.codex += source.providers.codex
  target.providers.claude += source.providers.claude
  for (const [model, tokens] of Object.entries(source.models)) {
    target.models[model] = (target.models[model] || 0) + tokens
  }
}

function mondayIso(now = new Date()): string {
  const date = new Date(now)
  const day = (date.getDay() + 6) % 7
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - day)
  return date.toISOString().slice(0, 10)
}

async function runTokscale(flags: string[], home?: string): Promise<UsageBreakdown> {
  const bin = tokscaleExecutable()
  const args = ['--json', '--client', 'codex,claude', '--group-by', 'client,model', ...flags]
  const scanHome = home || nativeHome()
  if (scanHome) args.push('--home', scanHome)
  const json = await new Promise<unknown>((resolve, reject) => {
    const child = spawn(bin, args, {
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('tokscale timed out'))
    }, 30_000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(stderr.trim() || `tokscale exited ${code}`))
      const text = stdout.trim()
      try {
        resolve(JSON.parse(text))
      } catch {
        const offset = Math.min(...[text.indexOf('{'), text.indexOf('[')].filter((index) => index >= 0))
        try { resolve(JSON.parse(text.slice(offset))) } catch { reject(new Error('Invalid tokscale JSON')) }
      }
    })
  })
  return extractTokscaleUsage(json)
}

function tokscaleExecutable(): string {
  if (process.platform === 'win32' && process.arch === 'x64') {
    return unpackedPath(require.resolve('@tokscale/cli-win32-x64-msvc'))
  }
  return unpackedPath(require.resolve('tokscale/bin.js'))
}

function unpackedPath(path: string): string {
  return path.replace(/([\\/])app\.asar([\\/])/i, '$1app.asar.unpacked$2')
}

function nativeHome(): string | undefined {
  const configuredHome = process.env.CODEPULSE_HOME?.trim()
  if (configuredHome) return configuredHome
  const codexHome = process.env.CODEX_HOME?.trim()
  if (codexHome) return dirname(codexHome)
  const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim()
  if (claudeHome) return dirname(claudeHome)
  const profile = process.env.USERPROFILE?.trim()
  if (profile) return profile
  const resolved = homedir()
  return resolved || undefined
}

async function collectPeriods(home?: string): Promise<[UsageBreakdown, UsageBreakdown, UsageBreakdown]> {
  const today = await runTokscale(['--today'], home)
  const week = await runTokscale(['--since', mondayIso()], home)
  const lifetime = await runTokscale(['--since', '1970-01-01'], home)
  return [today, week, lifetime]
}

export async function collectUsage(wslRuntimes: WslRuntime[]): Promise<UsageSummary> {
  const usage = emptyUsage()
  const host = await collectPeriods()
  ;[usage.today, usage.week, usage.lifetime] = host
  usage.windows = structuredClone(host[0])

  for (const runtime of wslRuntimes) {
    const distro = emptyBreakdown()
    for (const home of runtime.homePaths) {
      const [today, week, lifetime] = await collectPeriods(home)
      mergeBreakdowns(usage.today, today)
      mergeBreakdowns(usage.week, week)
      mergeBreakdowns(usage.lifetime, lifetime)
      mergeBreakdowns(usage.wsl, today)
      mergeBreakdowns(distro, today)
    }
    usage.wslDistros[runtime.distro] = distro
  }
  return usage
}
