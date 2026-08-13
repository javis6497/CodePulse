import { createHash, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createServer, type Server } from 'node:http'
import { basename } from 'node:path'
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

export class ActivityService extends EventEmitter {
  readonly port = 17_322
  readonly token: string
  private server?: Server
  private sessions = new Map<string, ActivitySession>()

  constructor(token = randomBytes(32).toString('hex')) {
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
  }

  stop(): void {
    this.server?.close()
    this.server = undefined
  }

  list(): ActivitySession[] {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20)
  }

  ingestForTest(payload: HookPayload): ActivitySession | undefined {
    const key = payload.session_id ? safeIdentifier(payload.session_id) : ''
    const session = reduceHookEvent(payload, this.sessions.get(key))
    if (session) this.sessions.set(session.sessionId, session)
    return session
  }

  private prune(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1_000
    for (const [id, session] of this.sessions) {
      if (session.updatedAt < cutoff) this.sessions.delete(id)
    }
  }
}
