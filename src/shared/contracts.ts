export type ProviderId = 'codex' | 'claude'
export type RuntimeType = 'windows' | 'wsl'
export type WindowKind = 'dashboard' | 'island' | 'status'
export type WindowMode = 'dashboard' | 'island' | 'status' | 'compact'

export interface UsageBreakdown {
  totalTokens: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  providers: Record<ProviderId, number>
  models: Record<string, number>
}

export interface UsageSummary {
  today: UsageBreakdown
  week: UsageBreakdown
  lifetime: UsageBreakdown
  windows: UsageBreakdown
  wsl: UsageBreakdown
  wslDistros: Record<string, UsageBreakdown>
  daily: Array<{ date: string; tokens: number }>
}

export interface QuotaWindow {
  limitId: string
  label: string
  usedPercent: number
  windowDurationMinutes?: number
  resetsAt?: number
}

export type ActivityState =
  | 'idle'
  | 'starting'
  | 'thinking'
  | 'working'
  | 'tool_running'
  | 'waiting_approval'
  | 'compacting'
  | 'subagent_running'
  | 'completed'
  | 'failed'

export interface ActivitySession {
  sessionId: string
  provider: 'codex'
  runtime: RuntimeType
  distro?: string
  project?: string
  state: ActivityState
  startedAt: number
  updatedAt: number
  currentTool?: string
  message?: string
}

export interface WslRuntime {
  distro: string
  homePaths: string[]
  running: boolean
}

export interface MonitorHealth {
  codex: 'connected' | 'not-found' | 'signed-out' | 'error'
  usage: 'ready' | 'empty' | 'error'
  wsl: 'ready' | 'not-installed' | 'not-running' | 'denied' | 'error'
  activityHook: 'not-installed' | 'pending-trust' | 'receiving'
  lastUpdatedAt?: number
  message?: string
}

export interface HookInstallResult {
  installed: boolean
  configPath: string
  backupPath?: string
  requiresTrust: boolean
}

export interface DashboardSnapshot {
  usage: UsageSummary
  quota: QuotaWindow[]
  activities: ActivitySession[]
  wslRuntimes: WslRuntime[]
  plan?: string
  lifetimeAccountTokens?: number
  health: MonitorHealth
}

export interface CodePulseApi {
  getSnapshot(): Promise<DashboardSnapshot>
  refresh(): Promise<DashboardSnapshot>
  installActivityHook(): Promise<HookInstallResult>
  getLaunchAtStartup(): Promise<boolean>
  setLaunchAtStartup(enabled: boolean): Promise<boolean>
  getWindowMode(): Promise<WindowMode>
  setWindowMode(mode: WindowMode): Promise<WindowMode>
  openWindow(kind: WindowKind): Promise<void>
  getCompletionSound(): Promise<boolean>
  setCompletionSound(enabled: boolean): Promise<boolean>
  onSnapshot(listener: (snapshot: DashboardSnapshot) => void): () => void
  windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void>
}
