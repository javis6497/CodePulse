import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type { WslRuntime } from '../../shared/contracts'

const TRACKED_DIRECTORIES = [
  ['.codex', 'sessions'],
  ['.codex', 'archived_sessions'],
  ['.claude', 'projects'],
  ['.claude', 'transcripts']
]

function rootsFor(runtimes: WslRuntime[]): string[] {
  const homes = [homedir(), ...runtimes.flatMap((runtime) => runtime.homePaths)]
  return homes.flatMap((home) => TRACKED_DIRECTORIES
    .map((parts) => join(home, ...parts))
    .filter((path) => existsSync(path)))
}

export class UsageWatcher {
  private watcher?: FSWatcher
  private rootsKey = ''
  private debounceTimer?: NodeJS.Timeout

  constructor(private readonly onChanged: () => void) {}

  async update(runtimes: WslRuntime[]): Promise<void> {
    const roots = rootsFor(runtimes)
    const nextKey = roots.slice().sort().join('|')
    if (nextKey === this.rootsKey) return
    this.rootsKey = nextKey
    await this.watcher?.close()
    this.watcher = undefined
    if (!roots.length) return

    this.watcher = watch(roots, {
      ignoreInitial: true,
      persistent: true,
      usePolling: process.platform === 'win32' && roots.some((path) => path.startsWith('\\\\')),
      interval: 1_000,
      awaitWriteFinish: { stabilityThreshold: 700, pollInterval: 100 }
    })
    this.watcher.on('all', () => this.schedule())
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    await this.watcher?.close()
    this.watcher = undefined
  }

  private schedule(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.onChanged(), 1_200)
  }
}
