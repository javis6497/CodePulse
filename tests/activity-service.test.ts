import { describe, expect, it } from 'vitest'
import { reduceHookEvent } from '../src/main/services/activity-service'

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
})
