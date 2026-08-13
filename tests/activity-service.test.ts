import { createHmac } from 'node:crypto'
import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ActivityService, reduceHookEvent, verifyInboxEnvelope } from '../src/main/services/activity-service'

describe('reduceHookEvent', () => {
  it('maps hook events and sanitizes identifiers and workspace paths', () => {
    const session = reduceHookEvent({
      hook_event_name: 'PreToolUse',
      session_id: 'private-session-id',
      cwd: 'C:\\work\\CodePulse',
      tool_name: 'apply_patch'
    })

    expect(session).toMatchObject({
      provider: 'codex',
      runtime: 'windows',
      project: 'CodePulse',
      state: 'tool_running',
      currentTool: 'apply_patch'
    })
    expect(session?.sessionId).toMatch(/^[a-f0-9]{64}$/)
    expect(session?.sessionId).not.toContain('private')
  })

  it('identifies WSL from a Linux workspace path', () => {
    expect(reduceHookEvent({
      hook_event_name: 'PreCompact',
      session_id: 'session',
      cwd: '/home/javis/project',
      distro: 'Ubuntu-24.04'
    })).toMatchObject({ runtime: 'wsl', project: 'project', state: 'compacting', distro: 'Ubuntu-24.04' })
  })

  it('rejects unknown events', () => {
    expect(reduceHookEvent({ hook_event_name: 'Unknown', session_id: 'session' })).toBeUndefined()
  })

  it('accepts only correctly signed WSL inbox events', () => {
    const token = 'd'.repeat(64)
    const body = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'wsl-session', cwd: '/home/javis/project', runtime: 'wsl' })
    const signature = createHmac('sha256', Buffer.from(token, 'hex')).update(body).digest('hex')
    expect(verifyInboxEnvelope({ body, signature }, token)).toMatchObject({ session_id: 'wsl-session', runtime: 'wsl' })
    expect(verifyInboxEnvelope({ body, signature: '0'.repeat(64) }, token)).toBeUndefined()
  })

  it('consumes signed WSL inbox files and emits the live session', async () => {
    const token = 'f'.repeat(64)
    const inbox = await mkdtemp(join(tmpdir(), 'codepulse-inbox-watch-'))
    const service = new ActivityService(token, inbox, 0)
    const body = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'wsl-live', cwd: '/home/javis/project', tool_name: 'Bash', runtime: 'wsl' })
    const signature = createHmac('sha256', Buffer.from(token, 'hex')).update(body).digest('hex')
    const changed = new Promise<ReturnType<ActivityService['list']>>((resolve) => service.once('changed', resolve))
    service.start()
    try {
      await writeFile(join(inbox, 'event.json'), JSON.stringify({ body, signature }), 'utf8')
      const activities = await changed
      expect(activities[0]).toMatchObject({ runtime: 'wsl', project: 'project', state: 'tool_running', currentTool: 'Bash' })
      await vi.waitFor(async () => expect(await readdir(inbox)).toHaveLength(0))
    } finally {
      service.stop()
    }
  })

  it('keeps parallel active tasks in start order and ahead of completed tasks', () => {
    vi.useFakeTimers()
    try {
      const service = new ActivityService('a'.repeat(64))
      vi.setSystemTime(1_000)
      const first = service.ingestForTest({ hook_event_name: 'UserPromptSubmit', session_id: 'first', cwd: 'C:\\work\\one' })
      vi.setSystemTime(2_000)
      const second = service.ingestForTest({ hook_event_name: 'UserPromptSubmit', session_id: 'second', cwd: 'C:\\work\\two' })
      vi.setSystemTime(3_000)
      service.ingestForTest({ hook_event_name: 'PreToolUse', session_id: 'second', cwd: 'C:\\work\\two', tool_name: 'Bash' })

      expect(service.list().map((session) => session.sessionId)).toEqual([first?.sessionId, second?.sessionId])

      vi.setSystemTime(4_000)
      service.ingestForTest({ hook_event_name: 'Stop', session_id: 'first', cwd: 'C:\\work\\one' })
      expect(service.list().map((session) => session.sessionId)).toEqual([second?.sessionId, first?.sessionId])
    } finally {
      vi.useRealTimers()
    }
  })
})
