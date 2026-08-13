import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ActivitySession, WindowKind, WindowMode } from '../shared/contracts'
import { HistoryDatabase } from './services/database'
import { hasNewCompletion } from './services/completion-sound'
import { installActivityHook, isActivityHookInstalled, isActivityHookMigrationNeeded } from './services/hook-installer'
import { MonitorService } from './services/monitor-service'

let mainWindow: BrowserWindow | undefined
let islandWindow: BrowserWindow | undefined
let statusWindow: BrowserWindow | undefined
let tray: Tray | undefined
let quitting = false
let monitor: MonitorService | undefined
let history: HistoryDatabase | undefined
let screenshotSaved = false
let currentWindowMode: WindowMode = 'dashboard'
let completionSoundEnabled = true
let hookSyncEnabled = false
let syncingWslHooks = false
const syncedWslHomes = new Set<string>()
const activityStates = new Map<string, ActivitySession['state']>()

const WINDOW_MODES: WindowMode[] = ['dashboard', 'island', 'status', 'compact']

function saveAcceptanceScreenshot(window: BrowserWindow): void {
  const screenshotPath = process.env.CODEPULSE_SCREENSHOT_PATH
  if (!screenshotPath || screenshotSaved) return
  screenshotSaved = true
  setTimeout(() => {
    const snapshot = monitor?.getSnapshot()
    if (!snapshot) return
    void Promise.all([
      window.webContents.capturePage().then((image) => writeFile(screenshotPath, image.toPNG())),
      writeFile(`${screenshotPath}.json`, JSON.stringify(snapshot, null, 2), 'utf8')
    ]).finally(() => app.quit())
  }, 1_000)
}

function pulseIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="10" fill="#111216"/><path d="M5 17h5l2.5-7 4.5 14 3.5-10 2 3H27" fill="none" stroke="#b8ff54" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
}

function loadRenderer(window: BrowserWindow, kind: WindowKind): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    const separator = process.env.ELECTRON_RENDERER_URL.includes('?') ? '&' : '?'
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${separator}view=${kind}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: kind } })
  }
}

function configureWindow(window: BrowserWindow): void {
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      window.hide()
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (!app.isPackaged) {
    window.webContents.on('console-message', (details) => {
      console.log(`[renderer:${details.level}] ${details.message}`)
    })
    window.webContents.on('did-fail-load', (_event, code, description) => {
      console.error(`Renderer failed to load (${code}): ${description}`)
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error(`Renderer process exited: ${details.reason}`)
    })
  }
}

function createDashboardWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: true,
    titleBarStyle: 'hidden',
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  configureWindow(window)
  loadRenderer(window, 'dashboard')
  return window
}

function createCompactWindow(kind: 'island' | 'status'): BrowserWindow {
  const island = kind === 'island'
  const window = new BrowserWindow({
    width: island ? 840 : 430,
    height: island ? 258 : 190,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  configureWindow(window)
  window.setAlwaysOnTop(true, 'floating')
  loadRenderer(window, kind)
  return window
}

function ensureWindow(kind: WindowKind): BrowserWindow {
  if (kind === 'dashboard') {
    mainWindow ??= createDashboardWindow()
    return mainWindow
  }
  if (kind === 'island') {
    islandWindow ??= createCompactWindow('island')
    return islandWindow
  }
  statusWindow ??= createCompactWindow('status')
  return statusWindow
}

function positionCompactWindows(mode: WindowMode): void {
  const workArea = screen.getPrimaryDisplay().workArea
  if (islandWindow) {
    islandWindow.setPosition(
      Math.round(workArea.x + (workArea.width - islandWindow.getBounds().width) / 2),
      workArea.y + 18
    )
  }
  if (statusWindow) {
    const y = mode === 'compact' && workArea.width < 1500 ? workArea.y + 292 : workArea.y + 18
    statusWindow.setPosition(workArea.x + workArea.width - statusWindow.getBounds().width - 18, y)
  }
}

function showWindow(kind: WindowKind): void {
  const window = ensureWindow(kind)
  positionCompactWindows(currentWindowMode)
  const reveal = () => {
    if (window.isDestroyed()) return
    window.show()
    window.focus()
  }
  if (window.webContents.isLoading()) window.once('ready-to-show', reveal)
  else reveal()
}

function applyWindowMode(mode: WindowMode, persist = false): void {
  currentWindowMode = mode
  if (persist) writeFileSync(join(app.getPath('userData'), 'window-mode'), mode, 'utf8')
  mainWindow?.hide()
  islandWindow?.hide()
  statusWindow?.hide()
  if (mode === 'dashboard') showWindow('dashboard')
  if (mode === 'island') showWindow('island')
  if (mode === 'status') showWindow('status')
  if (mode === 'compact') {
    ensureWindow('island')
    ensureWindow('status')
    positionCompactWindows(mode)
    showWindow('island')
    showWindow('status')
  }
}

function loadWindowMode(): WindowMode {
  const modePath = join(app.getPath('userData'), 'window-mode')
  if (!existsSync(modePath)) return 'dashboard'
  const mode = readFileSync(modePath, 'utf8').trim() as WindowMode
  return WINDOW_MODES.includes(mode) ? mode : 'dashboard'
}

function loadCompletionSound(): boolean {
  const settingPath = join(app.getPath('userData'), 'completion-sound')
  if (!existsSync(settingPath)) return true
  return readFileSync(settingPath, 'utf8').trim() !== 'false'
}

function playNewCompletionSound(activities: ActivitySession[]): void {
  if (hasNewCompletion(activities, activityStates) && completionSoundEnabled) shell.beep()
}

function createTray(): Tray {
  const appTray = new Tray(pulseIcon().resize({ width: 18, height: 18 }))
  appTray.setToolTip('CodePulse')
  appTray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开完整面板', click: () => showWindow('dashboard') },
    { label: '显示灵动岛', click: () => showWindow('island') },
    { label: '显示 Codex 状态窗', click: () => showWindow('status') },
    { type: 'separator' },
    { label: '立即刷新', click: () => { void monitor?.refresh() } },
    { type: 'separator' },
    { label: '退出 CodePulse', click: () => { quitting = true; app.quit() } }
  ]))
  appTray.on('click', () => showWindow('dashboard'))
  return appTray
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function forwardActivityHook(): Promise<void> {
  const token = argumentValue('--token')
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return
  let raw = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) {
    raw += chunk
    if (raw.length > 2_097_152) return
  }

  let input: Record<string, unknown>
  try { input = JSON.parse(raw) as Record<string, unknown> } catch { return }
  const body = JSON.stringify({
    hook_event_name: typeof input.hook_event_name === 'string' ? input.hook_event_name : '',
    session_id: typeof input.session_id === 'string' ? input.session_id : '',
    cwd: typeof input.cwd === 'string' ? input.cwd : '',
    tool_name: typeof input.tool_name === 'string' ? input.tool_name : '',
    runtime: argumentValue('--runtime') === 'wsl' ? 'wsl' : 'windows',
    distro: argumentValue('--distro') || ''
  })

  await new Promise<void>((resolve) => {
    const activityRequest = request({
      hostname: '127.0.0.1', port: 17_322, path: '/activity', method: 'POST', timeout: 1_500,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
    }, () => resolve())
    activityRequest.on('timeout', () => { activityRequest.destroy(); resolve() })
    activityRequest.on('error', () => resolve())
    activityRequest.end(body)
  })
}

function bundledHookHelperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'hooks', 'CodePulseHook.exe')
    : join(app.getAppPath(), 'resources', 'hooks', 'CodePulseHook.exe')
}

function bundledWslHookHelperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'hooks', 'CodePulseHook.py')
    : join(app.getAppPath(), 'resources', 'hooks', 'CodePulseHook.py')
}

function hookHelperPath(): string {
  return join(app.getPath('userData'), 'hooks', 'CodePulseHook.exe')
}

function wslHookHelperPath(): string {
  return join(app.getPath('userData'), 'hooks', 'CodePulseHook.py')
}

function activityInboxPath(): string {
  return join(app.getPath('userData'), 'activity-inbox')
}

async function prepareHookHelper(): Promise<string> {
  const helperPath = hookHelperPath()
  await mkdir(join(app.getPath('userData'), 'hooks'), { recursive: true })
  await Promise.all([
    copyFile(bundledHookHelperPath(), helperPath),
    copyFile(bundledWslHookHelperPath(), wslHookHelperPath())
  ])
  return helperPath
}

async function installHooks(): Promise<import('../shared/contracts').HookInstallResult> {
  if (!monitor) throw new Error('Monitor is not ready')
  const common = {
    executablePath: await prepareHookHelper(),
    token: monitor.getActivityToken()
  }
  const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex')
  const result = await installActivityHook({ codexHome, ...common })
  hookSyncEnabled = true
  const wslRequiresTrust = await syncWslHooks(common)
  monitor.setActivityHookInstalled(true)
  return { ...result, requiresTrust: result.requiresTrust || wslRequiresTrust }
}

async function syncWslHooks(common?: { executablePath: string; token: string }): Promise<boolean> {
  if (!monitor || syncingWslHooks) return false
  const executablePath = common?.executablePath || hookHelperPath()
  if (!existsSync(executablePath) || !existsSync(wslHookHelperPath())) return false
  syncingWslHooks = true
  let requiresTrust = false
  try {
    const options = common || { executablePath, token: monitor.getActivityToken() }
    for (const runtime of monitor.getSnapshot().wslRuntimes) {
      for (const home of runtime.homePaths) {
        if (syncedWslHomes.has(home)) continue
        const result = await installActivityHook({
          codexHome: join(home, '.codex'),
          ...options,
          runtime: 'wsl',
          distro: runtime.distro,
          wslExecutablePath: wslHookHelperPath(),
          wslInboxPath: activityInboxPath()
        })
        requiresTrust ||= result.requiresTrust
        syncedWslHomes.add(home)
      }
    }
  } finally {
    syncingWslHooks = false
  }
  return requiresTrust
}

function registerIpc(): void {
  ipcMain.handle('monitor:get', () => monitor?.getSnapshot())
  ipcMain.handle('monitor:refresh', () => monitor?.refresh())
  ipcMain.handle('activity:install-hook', () => installHooks())
  ipcMain.handle('app:get-launch-at-startup', () => app.getLoginItemSettings().openAtLogin)
  ipcMain.handle('app:set-launch-at-startup', (_event, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
    return app.getLoginItemSettings().openAtLogin
  })
  ipcMain.handle('window:get-mode', () => currentWindowMode)
  ipcMain.handle('window:set-mode', (_event, mode: WindowMode) => {
    if (!WINDOW_MODES.includes(mode)) return currentWindowMode
    applyWindowMode(mode, true)
    return currentWindowMode
  })
  ipcMain.handle('window:open', (_event, kind: WindowKind) => {
    if (kind === 'dashboard' || kind === 'island' || kind === 'status') showWindow(kind)
  })
  ipcMain.handle('sound:get-completion', () => completionSoundEnabled)
  ipcMain.handle('sound:set-completion', (_event, enabled: boolean) => {
    completionSoundEnabled = Boolean(enabled)
    writeFileSync(join(app.getPath('userData'), 'completion-sound'), String(completionSoundEnabled), 'utf8')
    return completionSoundEnabled
  })
  ipcMain.handle('window:action', (event, action: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (action === 'minimize') window.minimize()
    if (action === 'maximize' && window.isMaximizable()) window.isMaximized() ? window.unmaximize() : window.maximize()
    if (action === 'close') window.hide()
  })
}

function loadActivityToken(): string {
  const tokenPath = join(app.getPath('userData'), 'activity-token')
  if (existsSync(tokenPath)) {
    const saved = readFileSync(tokenPath, 'utf8').trim()
    if (/^[a-f0-9]{64}$/i.test(saved)) return saved
  }
  const token = randomBytes(32).toString('hex')
  writeFileSync(tokenPath, token, { encoding: 'utf8', mode: 0o600 })
  return token
}

if (process.argv.includes('--activity-hook')) {
  void forwardActivityHook().finally(() => app.exit(0))
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => applyWindowMode(currentWindowMode))

  app.whenReady().then(() => {
    app.setAppUserModelId('com.javis.codepulse')
    currentWindowMode = process.env.CODEPULSE_SCREENSHOT_PATH ? 'dashboard' : loadWindowMode()
    completionSoundEnabled = loadCompletionSound()
    monitor = new MonitorService(loadActivityToken(), activityInboxPath())
    history = new HistoryDatabase(join(app.getPath('userData'), 'codepulse.db'))
    registerIpc()
    tray = createTray()
    if (!process.argv.includes('--hidden')) applyWindowMode(currentWindowMode)
    monitor.on('snapshot', (snapshot) => {
      history?.saveSnapshot(snapshot)
      playNewCompletionSound(snapshot.activities)
      for (const window of [mainWindow, islandWindow, statusWindow]) {
        window?.webContents.send('monitor:snapshot', snapshot)
      }
      if (mainWindow && snapshot.health.lastUpdatedAt) saveAcceptanceScreenshot(mainWindow)
      const active = snapshot.activities.find((activity: ActivitySession) => !['idle', 'completed', 'failed'].includes(activity.state))
      tray?.setToolTip(active ? `CodePulse · ${active.project || active.state}` : 'CodePulse')
      if (hookSyncEnabled) void syncWslHooks()
    })
    monitor.start()
    const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex')
    const expectedHelperPath = hookHelperPath()
    void Promise.all([
      isActivityHookInstalled(codexHome),
      isActivityHookMigrationNeeded(codexHome, expectedHelperPath)
    ]).then(([installed, migrationNeeded]) => {
      hookSyncEnabled = installed
      monitor?.setActivityHookInstalled(installed)
      if (migrationNeeded || (installed && (!existsSync(expectedHelperPath) || !existsSync(wslHookHelperPath())))) void installHooks()
      else if (installed) void syncWslHooks()
    })
  })
}

app.on('before-quit', () => {
  quitting = true
  monitor?.stop()
  history?.close()
})

app.on('window-all-closed', () => {})
