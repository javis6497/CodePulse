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

export function discoverWslRuntimes(): WslRuntime[] {
  return listRunningWslDistros().map((distro) => {
    const homePaths: string[] = []
    for (const prefix of [`\\\\wsl.localhost\\${distro}`, `\\\\wsl$\\${distro}`]) {
      const homeRoot = `${prefix}\\home`
      try {
        for (const user of readdirSync(homeRoot)) {
          const home = `${homeRoot}\\${user}`
          if (hasTrackedData(home)) homePaths.push(home)
        }
      } catch {
        // Try the compatible UNC prefix below.
      }
      const rootHome = `${prefix}\\root`
      if (hasTrackedData(rootHome)) homePaths.push(rootHome)
      if (homePaths.length) break
    }
    return { distro, homePaths, running: true }
  })
}
