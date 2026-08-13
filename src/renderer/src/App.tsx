import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import {
  Activity, BarChart3, Bot, ChevronRight, Clock3, Command, Cpu, Database, History,
  LayoutDashboard, Minus, RefreshCw, Settings, Sparkles, Square, TerminalSquare, X
} from 'lucide-react'
import type { ActivitySession, DashboardSnapshot, HookInstallResult, QuotaWindow, WindowMode } from '../../shared/contracts'
import { emptySnapshot } from '../../shared/defaults'
import { buildTokenHeatmap } from './token-heatmap'

type Page = 'overview' | 'usage' | 'activity' | 'sessions' | 'history' | 'settings'
type Language = 'zh-CN' | 'en'
type Theme = 'dark' | 'light'

const NAVIGATION: Array<{ id: Page; zh: string; en: string; icon: typeof Activity }> = [
  { id: 'overview', zh: '概览', en: 'Overview', icon: LayoutDashboard },
  { id: 'usage', zh: '用量', en: 'Usage', icon: BarChart3 },
  { id: 'activity', zh: '运行状态', en: 'Activity', icon: Activity },
  { id: 'sessions', zh: '会话', en: 'Sessions', icon: TerminalSquare },
  { id: 'history', zh: '历史', en: 'History', icon: History },
  { id: 'settings', zh: '设置', en: 'Settings', icon: Settings }
]

function text(language: Language, zh: string, en: string): string {
  return language === 'zh-CN' ? zh : en
}

function formatTokens(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString('en-US')
}

function formatCompact(value: number): string {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function formatReset(timestamp: number | undefined, language: Language): string {
  if (!timestamp) return text(language, '重置时间未知', 'Reset time unavailable')
  const milliseconds = timestamp * 1_000 - Date.now()
  if (milliseconds <= 0) return text(language, '正在重置', 'Resetting now')
  const minutes = Math.floor(milliseconds / 60_000)
  const days = Math.floor(minutes / 1_440)
  const hours = Math.floor((minutes % 1_440) / 60)
  if (days) return text(language, `${days}天${hours}小时后重置`, `Resets in ${days}d ${hours}h`)
  return text(language, `${hours}小时${minutes % 60}分钟后重置`, `Resets in ${hours}h ${minutes % 60}m`)
}

function stateLabel(state: ActivitySession['state'], language: Language): string {
  const labels = {
    idle: ['空闲', 'Idle'], starting: ['启动中', 'Starting'], thinking: ['思考中', 'Thinking'],
    working: ['工作中', 'Working'], tool_running: ['运行工具', 'Running tool'],
    waiting_approval: ['等待批准', 'Needs approval'], compacting: ['压缩上下文', 'Compacting'],
    subagent_running: ['子代理运行中', 'Subagent'], completed: ['已完成', 'Completed'], failed: ['失败', 'Failed']
  } satisfies Record<ActivitySession['state'], [string, string]>
  return text(language, labels[state][0], labels[state][1])
}

function healthLabel(value: string, language: Language): string {
  const labels: Record<string, [string, string]> = {
    connected: ['已连接', 'Connected'], 'not-found': ['未找到', 'Not found'], 'signed-out': ['未登录', 'Signed out'],
    ready: ['正常', 'Ready'], empty: ['暂无数据', 'Empty'], error: ['错误', 'Error'],
    'not-installed': ['未安装', 'Not installed'], 'not-running': ['未运行', 'Not running'], denied: ['无权限', 'Denied'],
    'pending-trust': ['等待信任', 'Pending trust'], receiving: ['实时接收中', 'Live']
  }
  const label = labels[value]
  return label ? text(language, label[0], label[1]) : value
}

function metricCards(snapshot: DashboardSnapshot, language: Language) {
  return [
    { label: text(language, '今天', 'Today'), value: formatTokens(snapshot.usage.today.totalTokens), note: text(language, 'Codex + Claude 合计', 'Across Codex + Claude'), accent: 'lime' },
    { label: text(language, '本周', 'This Week'), value: formatTokens(snapshot.usage.week.totalTokens), note: text(language, '本周一至今', 'Monday to now'), accent: 'blue' },
    { label: text(language, '累计', 'Lifetime'), value: formatTokens(snapshot.usage.lifetime.totalTokens), note: text(language, '数据仅保存在本机', 'Preserved locally'), accent: 'violet' }
  ]
}

function QuotaCard({ quota, plan, language }: { quota: QuotaWindow; plan?: string; language: Language }) {
  const remaining = Math.max(0, 100 - quota.usedPercent)
  return <article className="glass-card quota-card">
    <div className="card-heading"><div><span className="eyebrow">CODEX · {plan || text(language, '账户', 'ACCOUNT')}</span><h3>{quota.label}</h3></div><span className={`quota-status ${remaining < 15 ? 'warning' : ''}`}>{remaining.toFixed(0)}% {text(language, '剩余', 'left')}</span></div>
    <div className="quota-track" aria-label={`${quota.usedPercent}% used`}><span style={{ width: `${quota.usedPercent}%` }} /></div>
    <div className="quota-footer"><span>{quota.usedPercent.toFixed(0)}% {text(language, '已用', 'used')}</span><span><Clock3 size={14} />{formatReset(quota.resetsAt, language)}</span></div>
  </article>
}

function ActivityRow({ session, language, order }: { session: ActivitySession; language: Language; order: number }) {
  const running = !['idle', 'completed', 'failed'].includes(session.state)
  return <div className="activity-row">
    <span className="activity-order">{order}</span>
    <div className={`activity-orb ${running ? 'live' : session.state}`}><span /></div>
    <div className="activity-copy"><strong>{session.project || text(language, '未命名任务', 'Untitled task')}</strong><span>{session.runtime === 'wsl' ? `WSL${session.distro ? ` · ${session.distro}` : ''}` : 'Windows'} · Codex</span></div>
    <div className="activity-state"><strong>{stateLabel(session.state, language)}</strong><span>{session.currentTool || new Date(session.updatedAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}</span></div>
  </div>
}

function UsageChart({ snapshot, language, height = 220 }: { snapshot: DashboardSnapshot; language: Language; height?: number }) {
  const daily = snapshot.usage.daily.slice(-14)
  const option = useMemo(() => ({
    animationDuration: 700,
    grid: { left: 8, right: 8, top: 22, bottom: 18, containLabel: true },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(27,28,33,.94)', borderColor: 'rgba(255,255,255,.1)', textStyle: { color: '#f6f7f9' }, formatter: (items: Array<{ axisValue: string; value: number }>) => `${items[0]?.axisValue}<br/><b>${formatTokens(items[0]?.value || 0)} tokens</b>` },
    xAxis: { type: 'category', boundaryGap: false, data: daily.map((item) => item.date.slice(5)), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#777b84', fontSize: 12, interval: 2 } },
    yAxis: { type: 'value', splitNumber: 3, axisLabel: { color: '#777b84', formatter: (value: number) => formatCompact(value), fontSize: 12 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,.055)' } } },
    series: [{ type: 'line', smooth: 0.45, showSymbol: false, data: daily.map((item) => item.tokens), lineStyle: { color: '#b8ff54', width: 2.5 }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(184,255,84,.28)' }, { offset: 1, color: 'rgba(184,255,84,0)' }] } } }]
  }), [daily])
  return daily.length ? <ReactECharts option={option} style={{ height }} /> : <div className="empty-chart" style={{ height }}><BarChart3 size={26} /><span>{text(language, '首次成功刷新后将显示 Token 历史。', 'Token history will appear after the first successful refresh.')}</span></div>
}

function TokenHeatmap({ snapshot, language }: { snapshot: DashboardSnapshot; language: Language }) {
  const cells = useMemo(() => buildTokenHeatmap(snapshot.usage.daily), [snapshot.usage.daily])
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(language, {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
  }), [language])
  return <div className="token-heatmap-section">
    <div className="token-heatmap-caption"><span>{text(language, '过去一年的每日 Token', 'Daily tokens over the past year')}</span><span>{text(language, '52 周', '52 weeks')}</span></div>
    <div className="token-heatmap-scroll">
      <div className="token-heatmap" role="img" aria-label={text(language, '过去一年每日 Token 使用热力图', 'Daily token usage heatmap for the past year')}>
        {cells.map((cell) => {
          const date = dateFormatter.format(new Date(`${cell.date}T00:00:00Z`))
          const label = `${date}: ${formatTokens(cell.tokens)} tokens`
          return <i className={`level-${cell.level}`} title={label} aria-label={label} key={cell.date} />
        })}
      </div>
    </div>
    <div className="heat-legend"><span>{text(language, '少', 'Less')}</span>{[0, 1, 2, 3, 4].map((level) => <i className={`level-${level}`} key={level} />)}<span>{text(language, '多', 'More')}</span></div>
  </div>
}

function Overview({ snapshot, language, showActivity }: { snapshot: DashboardSnapshot; language: Language; showActivity: () => void }) {
  const cards = metricCards(snapshot, language)
  const totalToday = snapshot.usage.today.totalTokens || 1
  const codexShare = snapshot.usage.today.totalTokens ? Math.round(snapshot.usage.today.providers.codex / totalToday * 100) : 0
  const claudeShare = snapshot.usage.today.totalTokens ? 100 - codexShare : 0
  const activities = snapshot.activities.slice(0, 4)
  return <>
    <section className="metric-grid">{cards.map((card) => <article className={`metric-card accent-${card.accent}`} key={card.label}><span className="eyebrow">{card.label}</span><strong>{card.value}</strong><small>{card.note}</small></article>)}</section>
    <section className="quota-grid">{snapshot.quota.length ? snapshot.quota.slice(0, 2).map((quota) => <QuotaCard quota={quota} plan={snapshot.plan} language={language} key={quota.limitId} />) : <article className="glass-card empty-quota"><Bot size={24} /><div><h3>{text(language, 'Codex 额度不可用', 'Codex quota unavailable')}</h3><p>{text(language, '请登录 Codex 后刷新。CodePulse 不读取你的凭据。', 'Sign in to Codex, then refresh. CodePulse never reads your credentials.')}</p></div></article>}</section>
    <section className="glass-card activity-card"><div className="card-heading"><div><span className="eyebrow">{text(language, '实时', 'LIVE')}</span><h3>{text(language, 'Codex 运行状态', 'Codex activity')}</h3></div><button className="text-button" onClick={showActivity}>{text(language, '查看全部', 'View all')}<ChevronRight size={14} /></button></div>{activities.length ? activities.map((session, index) => <ActivityRow session={session} language={language} order={index + 1} key={session.sessionId} />) : <div className="empty-inline"><div className="activity-orb"><span /></div><div><strong>{text(language, '当前没有 Codex 任务', 'No active Codex task')}</strong><span>{text(language, '在设置中启用实时状态 Hook 后，活动会显示在这里。', 'Enable the live status Hook in Settings to see activity here.')}</span></div></div>}</section>
    <section className="dashboard-grid">
      <article className="glass-card chart-card token-activity-card"><div className="card-heading"><div><span className="eyebrow">{text(language, '最近 14 天', 'LAST 14 DAYS')}</span><h3>{text(language, 'Token 活动', 'Token activity')}</h3></div><span className="soft-chip">{text(language, '全部提供商', 'All providers')}</span></div><UsageChart snapshot={snapshot} language={language} height={170} /><TokenHeatmap snapshot={snapshot} language={language} /></article>
      <article className="glass-card source-card"><div className="card-heading"><div><span className="eyebrow">{text(language, '今天', 'TODAY')}</span><h3>{text(language, '来源', 'Sources')}</h3></div></div><div className="source-total"><strong>{formatTokens(snapshot.usage.today.totalTokens)}</strong><span>tokens</span></div><div className="split-bar"><span style={{ width: `${codexShare}%` }} /><i /></div><div className="legend-row"><span><i className="dot codex" />Codex</span><strong>{codexShare}%</strong></div><div className="legend-row"><span><i className="dot claude" />Claude</span><strong>{claudeShare}%</strong></div><div className="runtime-divider" /><div className="runtime-row"><span><Command size={15} />Windows</span><strong>{formatTokens(snapshot.usage.windows.totalTokens)}</strong></div><div className="runtime-row"><span><TerminalSquare size={15} />WSL</span><strong>{formatTokens(snapshot.usage.wsl.totalTokens)}</strong></div></article>
    </section>
  </>
}

function UsagePage({ snapshot, language }: { snapshot: DashboardSnapshot; language: Language }) {
  const providers = Object.entries(snapshot.usage.lifetime.providers)
  const models = Object.entries(snapshot.usage.lifetime.models).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const maximum = Math.max(...models.map(([, value]) => value), 1)
  return <section className="detail-grid">
    <article className="glass-card detail-card"><span className="eyebrow">{text(language, '提供商', 'PROVIDERS')}</span><h3>{text(language, '累计用量', 'Lifetime usage')}</h3>{providers.map(([name, value]) => <div className="breakdown-row" key={name}><span>{name === 'codex' ? <Bot size={16} /> : <Sparkles size={16} />}{name}</span><strong>{formatTokens(value)}</strong></div>)}</article>
    <article className="glass-card detail-card models-card"><span className="eyebrow">{text(language, '模型', 'MODELS')}</span><h3>{text(language, '常用模型', 'Top models')}</h3>{models.length ? models.map(([name, value]) => <div className="model-row" key={name}><div><span>{name}</span><strong>{formatTokens(value)}</strong></div><i><b style={{ width: `${value / maximum * 100}%` }} /></i></div>) : <p className="muted">{text(language, '本地会话被识别后将显示模型明细。', 'Model attribution will appear after local sessions are found.')}</p>}</article>
    <article className="glass-card chart-card wide"><div className="card-heading"><div><span className="eyebrow">{text(language, '历史', 'HISTORY')}</span><h3>{text(language, '每日总量', 'Daily totals')}</h3></div></div><UsageChart snapshot={snapshot} language={language} /></article>
  </section>
}

function ActivityPage({ snapshot, language }: { snapshot: DashboardSnapshot; language: Language }) {
  return <section className="glass-card activity-card full-card"><div className="card-heading"><div><span className="eyebrow">{text(language, '会话状态机', 'SESSION STATE MACHINE')}</span><h3>{text(language, '最近的 Codex 活动', 'Recent Codex activity')}</h3></div><span className={`soft-chip ${snapshot.health.activityHook === 'receiving' ? 'live-chip' : ''}`}>{healthLabel(snapshot.health.activityHook, language)}</span></div>{snapshot.activities.length ? snapshot.activities.map((session, index) => <ActivityRow session={session} language={language} order={index + 1} key={session.sessionId} />) : <div className="large-empty"><Activity size={30} /><h3>{text(language, '等待活动', 'Waiting for activity')}</h3><p>{text(language, '在设置中启用本地 Hook，可实时查看思考、工具调用、批准、上下文压缩和子代理状态。', 'Enable the local Hook in Settings to see thinking, tools, approvals, compaction and subagents in real time.')}</p></div>}</section>
}

function SessionsPage({ snapshot, language }: { snapshot: DashboardSnapshot; language: Language }) {
  return <section className="glass-card full-card"><div className="card-heading"><div><span className="eyebrow">CODEX + CLAUDE</span><h3>{text(language, '会话', 'Sessions')}</h3></div></div><div className="large-empty"><Database size={30} /><h3>{text(language, '会话索引已就绪', 'Session index is ready')}</h3><p>{snapshot.usage.lifetime.totalTokens ? text(language, '用量正在自动采集，后续版本将补充详细会话列表。', 'Usage is being collected. Detailed session rows will follow.') : text(language, '运行一次 Codex 或 Claude Code 会话后刷新。', 'Run a Codex or Claude Code session, then refresh.')}</p></div></section>
}

function HistoryPage({ snapshot, language }: { snapshot: DashboardSnapshot; language: Language }) {
  const values = snapshot.usage.daily.slice(-70)
  const max = Math.max(...values.map((value) => value.tokens), 1)
  return <section className="glass-card full-card history-card"><div className="card-heading"><div><span className="eyebrow">{text(language, '本地归档', 'LOCAL ARCHIVE')}</span><h3>{text(language, '活动热力图', 'Activity heatmap')}</h3></div><span className="soft-chip">{text(language, '最近 10 周', 'Last 10 weeks')}</span></div><div className="heatmap">{Array.from({ length: 70 }, (_, index) => { const item = values[index - (70 - values.length)]; const level = item ? Math.ceil(item.tokens / max * 4) : 0; return <i className={`level-${level}`} title={item ? `${item.date}: ${formatTokens(item.tokens)}` : text(language, '无数据', 'No data')} key={index} /> })}</div><div className="heat-legend"><span>{text(language, '少', 'Less')}</span>{[0,1,2,3,4].map((level) => <i className={`level-${level}`} key={level} />)}<span>{text(language, '多', 'More')}</span></div><UsageChart snapshot={snapshot} language={language} /></section>
}

function MiniTrend({ snapshot }: { snapshot: DashboardSnapshot }) {
  const values = snapshot.usage.daily.slice(-14).map((item) => item.tokens)
  const maximum = Math.max(...values, 1)
  const points = values.length > 1
    ? values.map((value, index) => `${index / (values.length - 1) * 116},${38 - value / maximum * 34}`).join(' ')
    : '0,38 116,38'
  return <svg className="mini-trend" viewBox="0 0 116 42" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="miniTrendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9cf5ff" stopOpacity=".42" /><stop offset="1" stopColor="#9cf5ff" stopOpacity="0" /></linearGradient></defs>
    <polygon points={`0,42 ${points} 116,42`} fill="url(#miniTrendFill)" />
    <polyline points={points} fill="none" stroke="#aef7ff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function MiniActions({ refresh }: { refresh?: () => void }) {
  return <div className="mini-actions">
    {refresh && <button title="Refresh" onClick={refresh}><RefreshCw size={13} /></button>}
    <button title="Open dashboard" onClick={() => void window.codePulse.openWindow('dashboard')}><LayoutDashboard size={13} /></button>
    <button title="Close" onClick={() => void window.codePulse.windowAction('close')}><X size={14} /></button>
  </div>
}

function IslandWindow({ snapshot, language, refresh }: { snapshot: DashboardSnapshot; language: Language; refresh: () => void }) {
  const active = snapshot.activities.find((activity) => !['idle', 'completed', 'failed'].includes(activity.state))
  const activity = active || snapshot.activities[0]
  const weeklyQuota = [...snapshot.quota].sort((a, b) => (b.windowDurationMinutes || 0) - (a.windowDurationMinutes || 0))[0]
  const quotaRemaining = weeklyQuota ? Math.max(0, 100 - weeklyQuota.usedPercent) : undefined
  const metrics = [
    [text(language, '今日', 'Today'), snapshot.usage.today.totalTokens],
    [text(language, '本周', 'Week'), snapshot.usage.week.totalTokens],
    [text(language, '总量', 'Total'), snapshot.usage.lifetime.totalTokens]
  ] as const
  return <div className="mini-shell island-shell">
    <div className="mini-reflection" />
    <header className="mini-header"><div className="mini-brand"><span className="mini-brand-orb" /><strong>CodePulse</strong><i>{text(language, '实时监控', 'Live monitor')}</i></div><MiniActions refresh={refresh} /></header>
    <div className="island-content">
      <section className="island-metrics">{metrics.map(([label, value]) => <div className="island-metric" key={label}><span>{label}</span><strong>{formatTokens(value)}</strong><small>tokens</small></div>)}</section>
      <section className="island-panel project-panel"><span className="mini-label">{text(language, '当前项目', 'CURRENT PROJECT')}</span><strong>{activity?.project || text(language, '暂无运行项目', 'No active project')}</strong><div className="project-state"><i className={active ? 'live' : ''} />{activity ? stateLabel(activity.state, language) : text(language, '空闲', 'Idle')}{activity?.currentTool && <span>· {activity.currentTool}</span>}</div></section>
      <section className="island-panel trend-panel"><div className="quota-line"><div><span className="mini-label">{text(language, '周额度剩余', 'WEEKLY QUOTA LEFT')}</span><strong>{quotaRemaining === undefined ? '—' : `${quotaRemaining.toFixed(0)}%`}</strong></div><MiniTrend snapshot={snapshot} /></div><div className="trend-caption"><span>{text(language, '14 日趋势', '14-day trend')}</span><span>{weeklyQuota?.label || text(language, '额度暂不可用', 'Quota unavailable')}</span></div></section>
    </div>
  </div>
}

function StatusWindow({ snapshot, language }: { snapshot: DashboardSnapshot; language: Language }) {
  const active = snapshot.activities.find((activity) => !['idle', 'completed', 'failed'].includes(activity.state))
  const activity = active || snapshot.activities[0]
  const connected = snapshot.health.codex === 'connected'
  return <div className="mini-shell status-shell">
    <div className="mini-reflection" />
    <header className="mini-header"><div className="mini-brand"><span className="mini-brand-orb" /><strong>Codex</strong><i>{text(language, '运行状态', 'Runtime status')}</i></div><MiniActions /></header>
    <div className="status-content">
      <div className={`status-core ${active ? 'active' : ''}`}><span /></div>
      <div className="status-copy"><span className="mini-label">{activity?.project || text(language, '暂无运行项目', 'NO ACTIVE PROJECT')}</span><strong>{activity ? stateLabel(activity.state, language) : connected ? text(language, '已连接 · 空闲', 'Connected · Idle') : healthLabel(snapshot.health.codex, language)}</strong><small>{activity?.currentTool || (activity ? `${activity.runtime === 'wsl' ? `WSL · ${activity.distro || ''}` : 'Windows'} · ${new Date(activity.updatedAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}` : text(language, '等待 Codex 活动', 'Waiting for Codex activity'))}</small></div>
    </div>
    <footer className="status-footer"><span><i className={connected ? 'online' : ''} />Codex App Server</span><span>{snapshot.health.activityHook === 'receiving' ? text(language, 'Hook 实时接收中', 'Hook receiving live') : healthLabel(snapshot.health.activityHook, language)}</span></footer>
  </div>
}

function SettingsPage({ snapshot, language, setLanguage, theme, setTheme }: { snapshot: DashboardSnapshot; language: Language; setLanguage: (language: Language) => void; theme: Theme; setTheme: (theme: Theme) => void }) {
  const [startup, setStartup] = useState(false)
  const [windowMode, setWindowMode] = useState<WindowMode>('dashboard')
  const [completionSound, setCompletionSound] = useState(true)
  const [installing, setInstalling] = useState(false)
  const [hookResult, setHookResult] = useState<HookInstallResult>()
  useEffect(() => {
    void window.codePulse.getLaunchAtStartup().then(setStartup)
    void window.codePulse.getWindowMode().then(setWindowMode)
    void window.codePulse.getCompletionSound().then(setCompletionSound)
  }, [])

  async function toggleStartup(enabled: boolean) {
    setStartup(await window.codePulse.setLaunchAtStartup(enabled))
  }

  async function enableHook() {
    setInstalling(true)
    try { setHookResult(await window.codePulse.installActivityHook()) } finally { setInstalling(false) }
  }

  return <section className="settings-stack">
    <article className="glass-card settings-card"><span className="eyebrow">{text(language, '常规', 'GENERAL')}</span><h3>{text(language, '应用行为', 'App behavior')}</h3>
      <label className="setting-row"><span><strong>{text(language, '开机启动', 'Launch at startup')}</strong><small>{text(language, '启动后直接进入系统托盘，不显示终端或主窗口。', 'Start silently in the system tray without a terminal or main window.')}</small></span><input type="checkbox" checked={startup} onChange={(event) => void toggleStartup(event.target.checked)} /></label>
      <label className="setting-row"><span><strong>{text(language, '界面语言', 'Language')}</strong><small>{text(language, '在中文和英文界面之间切换。', 'Switch between Chinese and English.')}</small></span><select value={language} onChange={(event) => setLanguage(event.target.value as Language)}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>
      <label className="setting-row"><span><strong>{text(language, '外观', 'Appearance')}</strong><small>{text(language, '切换苹果风格的深色或浅色玻璃界面。', 'Switch between Apple-inspired dark and light glass appearances.')}</small></span><select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}><option value="dark">{text(language, '深色', 'Dark')}</option><option value="light">{text(language, '浅色', 'Light')}</option></select></label>
      <label className="setting-row"><span><strong>{text(language, '默认显示模式', 'Default window mode')}</strong><small>{text(language, '可以只显示灵动岛，或将 Codex 运行状态放在独立小窗中。', 'Show only the island, or keep Codex runtime status in a separate widget.')}</small></span><select value={windowMode} onChange={(event) => void window.codePulse.setWindowMode(event.target.value as WindowMode).then(setWindowMode)}><option value="dashboard">{text(language, '完整面板', 'Full dashboard')}</option><option value="island">{text(language, '仅灵动岛', 'Island only')}</option><option value="status">{text(language, '仅 Codex 状态窗', 'Codex status only')}</option><option value="compact">{text(language, '灵动岛 + 状态窗', 'Island + status')}</option></select></label>
      <label className="setting-row"><span><strong>{text(language, '任务完成提示音', 'Task completion sound')}</strong><small>{text(language, 'Codex 任务从运行中变为已完成时播放一次系统提示音。', 'Play one system alert when a Codex task changes from running to completed.')}</small></span><input type="checkbox" checked={completionSound} onChange={(event) => void window.codePulse.setCompletionSound(event.target.checked).then(setCompletionSound)} /></label>
    </article>
    <article className="glass-card settings-card"><span className="eyebrow">{text(language, '实时监控', 'LIVE MONITORING')}</span><h3>{text(language, 'Codex 运行状态', 'Codex activity')}</h3>
      <div className="hook-row"><span><strong>{healthLabel(snapshot.health.activityHook, language)}</strong><small>{text(language, '监控 Windows 桌面端、PowerShell CLI 和运行中的 WSL CLI；不发送提示词或工具参数。', 'Monitors the Windows desktop app, PowerShell CLI, and running WSL CLIs without sending prompts or tool arguments.')}</small></span><button className="primary-button" disabled={installing || snapshot.health.activityHook === 'receiving'} onClick={() => void enableHook()}>{installing ? text(language, '安装中…', 'Installing…') : text(language, '启用实时状态', 'Enable live status')}</button></div>
      {(hookResult || snapshot.health.activityHook === 'pending-trust') && <p className="hook-notice">{text(language, 'Hook 已写入。请重启 Windows Codex 并信任 Hook；每个 WSL 发行版也需要在其 Codex CLI 中输入 /hooks 并信任一次。', 'Hooks installed. Restart and trust the Hook in Windows Codex, then run /hooks and trust it once inside each WSL distribution.')}</p>}
    </article>
    <article className="glass-card settings-card"><span className="eyebrow">{text(language, '连接', 'CONNECTIONS')}</span><h3>{text(language, '运行环境状态', 'Runtime status')}</h3><div className="connection-row"><span><Bot size={17} />Codex App Server</span><strong className={snapshot.health.codex === 'connected' ? 'ok' : 'warn'}>{healthLabel(snapshot.health.codex, language)}</strong></div><div className="connection-row"><span><TerminalSquare size={17} />WSL</span><strong className={snapshot.health.wsl === 'ready' ? 'ok' : ''}>{healthLabel(snapshot.health.wsl, language)}</strong></div><div className="connection-row"><span><Cpu size={17} />Token {text(language, '采集器', 'collector')}</span><strong className={snapshot.health.usage === 'ready' ? 'ok' : ''}>{healthLabel(snapshot.health.usage, language)}</strong></div></article>
  </section>
}

export default function App() {
  const view = new URLSearchParams(window.location.search).get('view')
  const [page, setPage] = useState<Page>('overview')
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(emptySnapshot())
  const [refreshing, setRefreshing] = useState(false)
  const [language, setLanguageState] = useState<Language>(() => localStorage.getItem('codepulse-language') === 'en' ? 'en' : 'zh-CN')
  const [theme, setThemeState] = useState<Theme>(() => localStorage.getItem('codepulse-theme') === 'light' ? 'light' : 'dark')

  useEffect(() => {
    document.documentElement.dataset.view = view || 'dashboard'
    document.documentElement.dataset.theme = theme
    void window.codePulse.getSnapshot().then(setSnapshot)
    return window.codePulse.onSnapshot(setSnapshot)
  }, [view, theme])
  useEffect(() => {
    const syncTheme = (event: StorageEvent) => {
      if (event.key === 'codepulse-theme') setThemeState(event.newValue === 'light' ? 'light' : 'dark')
    }
    window.addEventListener('storage', syncTheme)
    return () => window.removeEventListener('storage', syncTheme)
  }, [])
  function setLanguage(next: Language) { localStorage.setItem('codepulse-language', next); setLanguageState(next) }
  function setTheme(next: Theme) { localStorage.setItem('codepulse-theme', next); setThemeState(next) }
  async function refresh() { setRefreshing(true); try { setSnapshot(await window.codePulse.refresh()) } finally { setRefreshing(false) } }

  if (view === 'island') return <IslandWindow snapshot={snapshot} language={language} refresh={() => void refresh()} />
  if (view === 'status') return <StatusWindow snapshot={snapshot} language={language} />

  const content = page === 'overview' ? <Overview snapshot={snapshot} language={language} showActivity={() => setPage('activity')} />
    : page === 'usage' ? <UsagePage snapshot={snapshot} language={language} />
      : page === 'activity' ? <ActivityPage snapshot={snapshot} language={language} />
        : page === 'sessions' ? <SessionsPage snapshot={snapshot} language={language} />
          : page === 'history' ? <HistoryPage snapshot={snapshot} language={language} />
            : <SettingsPage snapshot={snapshot} language={language} setLanguage={setLanguage} theme={theme} setTheme={setTheme} />
  const currentPage = NAVIGATION.find((item) => item.id === page)

  return <div className="app-shell">
    <div className="ambient ambient-one" /><div className="ambient ambient-two" /><div className="ambient ambient-three" />
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><span /></div><div><strong>CodePulse</strong><small>{text(language, 'AI 编程监控', 'AI Coding Monitor')}</small></div></div><nav>{NAVIGATION.map((item) => { const Icon = item.icon; return <button className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)} key={item.id}><Icon size={18} strokeWidth={1.8} />{text(language, item.zh, item.en)}</button> })}</nav><div className="sidebar-status"><div className={`status-light ${snapshot.health.codex === 'connected' ? 'online' : ''}`} /><div><strong>{snapshot.health.codex === 'connected' ? text(language, '监控中', 'Monitoring') : text(language, '受限模式', 'Limited mode')}</strong><small>{snapshot.health.lastUpdatedAt ? `${text(language, '更新于', 'Updated')} ${new Date(snapshot.health.lastUpdatedAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : text(language, '正在启动采集器…', 'Starting collectors…')}</small></div></div></aside>
    <main className="main-area"><header className="titlebar"><div><h1>{currentPage && text(language, currentPage.zh, currentPage.en)}</h1><p>{page === 'overview' ? text(language, '一眼掌握你的 AI 编程活动。', 'Your coding activity, at a glance.') : text(language, '监控 Windows + WSL 中的 Codex 和 Claude Code。', 'Codex and Claude Code on Windows + WSL.')}</p></div><div className="title-actions"><span className="auto-refresh-chip"><i />{text(language, '自动刷新', 'Auto refresh')}</span><button className="refresh-button" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'spin' : ''} />{text(language, '刷新', 'Refresh')}</button><div className="window-controls"><button onClick={() => void window.codePulse.windowAction('minimize')}><Minus size={14} /></button><button onClick={() => void window.codePulse.windowAction('maximize')}><Square size={11} /></button><button className="close" onClick={() => void window.codePulse.windowAction('close')}><X size={14} /></button></div></div></header><div className="page-content">{content}</div></main>
  </div>
}
