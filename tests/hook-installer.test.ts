import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installActivityHook, isActivityHookInstalled, isActivityHookMigrationNeeded } from '../src/main/services/hook-installer'

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

    expect(await isActivityHookMigrationNeeded(codexHome)).toBe(true)
    const first = await installActivityHook({ codexHome, executablePath, token: 'a'.repeat(64) })
    const afterFirstInstall = await readFile(join(codexHome, 'hooks.json'), 'utf8')
    const second = await installActivityHook({ codexHome, executablePath, token: 'a'.repeat(64) })

    const document = JSON.parse(await readFile(join(codexHome, 'hooks.json'), 'utf8'))
    expect(document.hooks.Stop).toHaveLength(2)
    expect(document.hooks.Stop[0].hooks[0].command).toBe('existing')
    expect(document.hooks.SessionStart[0].hooks[0].commandWindows).toContain('CodePulseHook.exe" --token')
    expect(document.hooks.SessionStart[0].hooks[0].commandWindows).not.toContain('CodePulse.exe" --activity-hook')
    expect(document.hooks.SessionStart[0].hooks[0].commandWindows).not.toContain('powershell')
    expect(document.hooks.SessionStart[0].hooks[0]).not.toHaveProperty('async')
    expect(await isActivityHookInstalled(codexHome)).toBe(true)
    expect(await isActivityHookMigrationNeeded(codexHome)).toBe(false)
    expect(await isActivityHookMigrationNeeded(codexHome, executablePath)).toBe(false)
    expect(await isActivityHookMigrationNeeded(codexHome, 'C:\\Users\\Example\\AppData\\Roaming\\CodePulse\\hooks\\CodePulseHook.exe')).toBe(true)
    expect(first.requiresTrust).toBe(true)
    expect(second).toMatchObject({ installed: true, requiresTrust: false })
    expect(second.backupPath).toBeUndefined()
    expect(await readFile(join(codexHome, 'hooks.json'), 'utf8')).toBe(afterFirstInstall)
    expect((await readdir(codexHome)).filter((name) => name.startsWith('hooks.codepulse-backup-'))).toHaveLength(1)
  })

  it('writes a Linux command without a Windows-only override for WSL', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'codepulse-wsl-hook-'))
    await installActivityHook({
      codexHome,
      executablePath: 'C:\\Users\\Example\\AppData\\Roaming\\CodePulse\\hooks\\CodePulseHook.exe',
      token: 'b'.repeat(64),
      runtime: 'wsl',
      distro: 'Ubuntu-24.04',
      wslExecutablePath: 'C:\\Users\\Example\\AppData\\Roaming\\CodePulse\\hooks\\CodePulseHook.py',
      wslInboxPath: 'C:\\Users\\Example\\AppData\\Roaming\\CodePulse\\activity-inbox'
    })

    const document = JSON.parse(await readFile(join(codexHome, 'hooks.json'), 'utf8'))
    const handler = document.hooks.UserPromptSubmit[0].hooks[0]
    expect(handler.command).toContain('python3 "/mnt/c/Users/Example/AppData/Roaming/CodePulse/hooks/CodePulseHook.py"')
    expect(handler.command).toContain('--inbox "/mnt/c/Users/Example/AppData/Roaming/CodePulse/activity-inbox"')
    expect(handler.command).toContain('--distro "Ubuntu-24.04"')
    expect(handler).not.toHaveProperty('commandWindows')
  })
})
