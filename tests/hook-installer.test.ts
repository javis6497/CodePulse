import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installActivityHook, isActivityHookInstalled } from '../src/main/services/hook-installer'

describe('installActivityHook', () => {
  it('preserves existing hooks and adds CodePulse once per event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codepulse-hook-'))
    const codexHome = join(root, '.codex')
    const executablePath = 'C:\\Program Files\\CodePulse\\resources\\hooks\\CodePulseHook.exe'
    await import('node:fs/promises').then(({ mkdir }) => mkdir(codexHome, { recursive: true }))
    await writeFile(join(codexHome, 'hooks.json'), JSON.stringify({ hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'existing' }] }],
      SessionStart: [{ hooks: [{ type: 'command', command: 'old-codepulse', statusMessage: 'CodePulse activity monitor', async: true }] }]
    } }), 'utf8')

    await installActivityHook({ codexHome, executablePath, token: 'a'.repeat(64) })
    await installActivityHook({ codexHome, executablePath, token: 'a'.repeat(64) })

    const document = JSON.parse(await readFile(join(codexHome, 'hooks.json'), 'utf8'))
    expect(document.hooks.Stop).toHaveLength(2)
    expect(document.hooks.Stop[0].hooks[0].command).toBe('existing')
    expect(document.hooks.SessionStart[0].hooks[0].commandWindows).toContain('CodePulseHook.exe" --token')
    expect(document.hooks.SessionStart[0].hooks[0].commandWindows).not.toContain('CodePulse.exe" --activity-hook')
    expect(document.hooks.SessionStart[0].hooks[0].commandWindows).not.toContain('powershell')
    expect(document.hooks.SessionStart[0].hooks[0]).not.toHaveProperty('async')
    expect(await isActivityHookInstalled(codexHome)).toBe(true)
  })
})
