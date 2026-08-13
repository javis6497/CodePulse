import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import type { WslRuntime } from '../../shared/contracts'

const LXSS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'
const DATA_MARKERS = ['.codex/sessions', '.codex/archived_sessions', '.claude/projects', '.claude/transcripts']

function run(command: string, args: string[], isWsl = false): string {
  const output = execFileSync(command, args, {
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5_000,
    windowsHide: true,
    encoding: 'buffer'
  })
  return Buffer.from(output).toString(isWsl ? 'utf16le' : 'utf8')
}

export function isWslInstalled(): boolean {
  if (process.platform !== 'win32') return false
  try {
    run('reg.exe', ['query', LXSS_KEY])
    return true
  } catch {
    return false
  }
}

export function listRunningWslDistros(): string[] {
  if (!isWslInstalled()) return []
  try {
    return run('wsl.exe', ['--list', '--quiet', '--running'], true)
      .split(/\r?\n/)
      .map((line) => line.replace(/\0/g, '').trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function hasTrackedData(home: string): boolean {
  return DATA_MARKERS.some((marker) => existsSync(`${home}\\${marker.replaceAll('/', '\\')}`))
}

function primaryHome(distro: string): string | undefined {
  try {
    const linuxHome = run('wsl.exe', ['--distribution', distro, '--exec', 'sh', '-lc', 'printf %s "$HOME"'])
      .replace(/\0/g, '')
      .trim()
    if (!linuxHome.startsWith('/')) return undefined
    for (const prefix of [`\\\\wsl.localhost\\${distro}`, `\\\\wsl$\\${distro}`]) {
      const home = `${prefix}${linuxHome.replaceAll('/', '\\')}`
      if (existsSync(home)) return home
    }
  } catch {
    return undefined
  }
  return undefined
}

export function discoverWslRuntimes(): WslRuntime[] {
  return listRunningWslDistros().map((distro) => {
    const homePaths = new Set<string>()
    const home = primaryHome(distro)
    if (home) homePaths.add(home)
    for (const prefix of [`\\\\wsl.localhost\\${distro}`, `\\\\wsl$\\${distro}`]) {
      const homeRoot = `${prefix}\\home`
      try {
        for (const user of readdirSync(homeRoot)) {
          const candidate = `${homeRoot}\\${user}`
          if (hasTrackedData(candidate)) homePaths.add(candidate)
        }
      } catch {
        // Try the compatible UNC prefix below.
      }
      const rootHome = `${prefix}\\root`
      if (hasTrackedData(rootHome)) homePaths.add(rootHome)
      if (homePaths.size) break
    }
    return { distro, homePaths: [...homePaths], running: true }
  })
}
