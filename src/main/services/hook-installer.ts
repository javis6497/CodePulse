import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { HookInstallResult } from '../../shared/contracts'

const EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse',
  'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'Stop', 'SessionEnd'
]
const MARKER = 'CodePulse activity monitor'

interface HookHandler {
  type?: string
  command?: string
  commandWindows?: string
  statusMessage?: string
  timeout?: number
}

interface HookGroup {
  matcher?: string
  hooks?: HookHandler[]
}

interface HooksDocument {
  description?: string
  hooks?: Record<string, HookGroup[]>
  [key: string]: unknown
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`
}

function toWslPath(value: string): string {
  const match = /^([a-z]):\\(.*)$/i.exec(value)
  if (!match) return value.replaceAll('\\', '/')
  return `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replaceAll('\\', '/')}`
}

function isCodePulseGroup(group: HookGroup): boolean {
  return Boolean(group.hooks?.some((handler) => handler.statusMessage === MARKER))
}

export async function isActivityHookInstalled(codexHome: string): Promise<boolean> {
  try {
    const document = JSON.parse(await readFile(join(codexHome, 'hooks.json'), 'utf8')) as HooksDocument
    return Object.values(document.hooks || {}).some((groups) => groups.some(isCodePulseGroup))
  } catch {
    return false
  }
}

export async function installActivityHook(options: {
  codexHome: string
  executablePath: string
  token: string
  runtime?: 'windows' | 'wsl'
  distro?: string
}): Promise<HookInstallResult> {
  const configPath = join(options.codexHome, 'hooks.json')
  await mkdir(options.codexHome, { recursive: true })

  let document: HooksDocument = {}
  let original: string | undefined
  try {
    original = await readFile(configPath, 'utf8')
    document = JSON.parse(original) as HooksDocument
  } catch (error) {
    if (original !== undefined) throw new Error(`Invalid hooks.json: ${error instanceof Error ? error.message : String(error)}`)
  }

  document.hooks ||= {}
  const runtime = options.runtime || 'windows'
  const nativeCommand = `${quote(options.executablePath)} --token ${quote(options.token)} --runtime windows`
  const wslCommand = `${quote(toWslPath(options.executablePath))} --token ${quote(options.token)} --runtime wsl${options.distro ? ` --distro ${quote(options.distro)}` : ''}`
  const command = runtime === 'wsl' ? wslCommand : nativeCommand
  for (const event of EVENTS) {
    const existing = Array.isArray(document.hooks[event]) ? document.hooks[event].filter((group) => !isCodePulseGroup(group)) : []
    existing.push({
      hooks: [{ type: 'command', command, commandWindows: nativeCommand, statusMessage: MARKER, timeout: 3 }]
    })
    document.hooks[event] = existing
  }

  const updated = `${JSON.stringify(document, null, 2)}\n`
  if (updated === original) return { installed: true, configPath, requiresTrust: false }

  let backupPath: string | undefined
  if (original !== undefined) {
    backupPath = join(dirname(configPath), `hooks.codepulse-backup-${Date.now()}.json`)
    await writeFile(backupPath, original, 'utf8')
  }
  await writeFile(configPath, updated, 'utf8')
  return { installed: true, configPath, backupPath, requiresTrust: true }
}
