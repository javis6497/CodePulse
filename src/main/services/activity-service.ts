import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { basename } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type { ActivitySession, ActivityState, RuntimeType } from '../../shared/contracts'

const EVENT_STATE: Record<string, ActivityState> = {
  SessionStart: 'starting',
  UserPromptSubmit: 'thinking',
  PreToolUse: 'tool_running',
  PermissionRequest: 'waiting_approval',
  PostToolUse: 'working',
  PreCompact: 'compacting',
  PostCompact: 'thinking',
  SubagentStart: 'subagent_running',
  SubagentStop: 'working',
  Stop: 'completed',
  SessionEnd: 'idle',
  Failure: 'failed'
}

interface HookPayload {
  hook_event_name?: string
  session_id?: string
  cwd?: string
  tool_name?: string
  runtime?: RuntimeType
  distro?: string
}

interface InboxEnvelope {
  body?: string
  signature?: string
}

function safeIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function runtimeFrom(payload: HookPayload): RuntimeType {
  if (payload.runtime === 'wsl') return 'wsl'
  return payload.cwd?.startsWith('/') ? 'wsl' : 'windows'
}

export function reduceHookEvent(payload: HookPayload, previous?: ActivitySession): ActivitySession | undefined {
  const event = payload.hook_event_name
  const sessionId = payload.session_id
  if (!event || !sessionId || !EVENT_STATE[event]) return undefined
  const now = Date.now()
  const project = payload.cwd ? basename(payload.cwd.replaceAll('\\', '/')).slice(0, 80) : previous?.project
  return {
    sessionId: safeIdentifier(sessionId),
    provider: 'codex',
    runtime: runtimeFrom(payload),
    distro: payload.distro?.slice(0, 80) || previous?.distro,
    project,
    state: EVENT_STATE[event],
    startedAt: previous?.startedAt || now,
    updatedAt: now,
    currentTool: payload.tool_name?.slice(0, 64),
    message: event
  }
}

export function verifyInboxEnvelope(envelope: InboxEnvelope, token: string): HookPayload | undefined {
  if (typeof envelope.body !== 'string' || typeof envelope.signature !== 'string' || !/^[a-f0-9]{64}$/i.test(envelope.signature)) return undefined
  const expected = createHmac('sha256', Buffer.from(token, 'hex')).update(envelope.body).digest()
  const received = Buffer.from(envelope.signature, 'hex')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return undefined
  try {
    return JSON.parse(envelope.body) as HookPayload
  } catch {
    return undefined
  }
}

export class ActivityService extends EventEmitter {
  readonly token: string
  private server?: Server
  private inboxWatcher?: FSWatcher
  private sessions = new Map<string, ActivitySession>()

  constructor(token = randomBytes(32).toString('hex'), private readonly inboxPath?: string, readonly port = 17_322) {
    super()
    this.token = token
  }

  start(): void {
    if (this.server) return
    this.server = createServer((request, response) => {
      if (request.method !== 'POST' || request.url !== '/activity') {
        response.writeHead(404).end()
        return
      }
      if (request.headers.authorization !== `Bearer ${this.token}`) {
        response.writeHead(401).end()
        return
      }
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        body += chunk
        if (body.length > 2_097_152) request.destroy()
      })
      request.on('end', () => {
        try {
          const payload = JSON.parse(body) as HookPayload
          const key = payload.session_id ? safeIdentifier(payload.session_id) : ''
          const session = reduceHookEvent(payload, this.sessions.get(key))
          if (!session) throw new Error('Unsupported activity event')
          this.sessions.set(session.sessionId, session)
          this.prune()
          this.emit('changed', this.list())
          response.writeHead(204).end()
        } catch {
          response.writeHead(400).end()
        }
      })
    })
    this.server.listen(this.port, '127.0.0.1')
    if (this.inboxPath) void this.startInboxWatcher()
  }

  stop(): void {
    this.server?.close()
    this.server = undefined
    void this.inboxWatcher?.close()
    this.inboxWatcher = undefined
  }

  list(): ActivitySession[] {
    return [...this.sessions.values()].sort((a, b) => {
      const aActive = !['idle', 'completed', 'failed'].includes(a.state)
      const bActive = !['idle', 'completed', 'failed'].includes(b.state)
      if (aActive !== bActive) return aActive ? -1 : 1
      if (aActive) return a.startedAt - b.startedAt || a.sessionId.localeCompare(b.sessionId)
      return b.updatedAt - a.updatedAt
    }).slice(0, 20)
  }

  ingestForTest(payload: HookPayload): ActivitySession | undefined {
    const key = payload.session_id ? safeIdentifier(payload.session_id) : ''
    const session = reduceHookEvent(payload, this.sessions.get(key))
    if (session) this.sessions.set(session.sessionId, session)
    return session
  }

  private async startInboxWatcher(): Promise<void> {
    if (!this.inboxPath || this.inboxWatcher) return
    await mkdir(this.inboxPath, { recursive: true })
    this.inboxWatcher = watch(this.inboxPath, { ignoreInitial: false, depth: 0 })
    this.inboxWatcher.on('add', (path) => {
      if (path.toLowerCase().endsWith('.json')) void this.ingestInboxFile(path)
    })
  }

  private async ingestInboxFile(path: string): Promise<void> {
    try {
      const raw = await readFile(path, 'utf8')
      if (raw.length > 2_097_152) return
      const payload = verifyInboxEnvelope(JSON.parse(raw) as InboxEnvelope, this.token)
      if (!payload) return
      const key = payload.session_id ? safeIdentifier(payload.session_id) : ''
      const session = reduceHookEvent(payload, this.sessions.get(key))
      if (!session) return
      this.sessions.set(session.sessionId, session)
      this.prune()
      this.emit('changed', this.list())
    } catch {
      // Ignore malformed or incomplete queue entries.
    } finally {
      try { await unlink(path) } catch { /* Entry may already be gone. */ }
    }
  }

  private prune(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1_000
    for (const [id, session] of this.sessions) {
      if (session.updatedAt < cutoff) this.sessions.delete(id)
    }
  }
}
