import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyInboxEnvelope } from '../src/main/services/activity-service'

const windowsOnly = process.platform === 'win32' ? describe : describe.skip
const helperPath = join(process.cwd(), 'resources', 'hooks', 'CodePulseHook.exe')

windowsOnly('CodePulseHook', () => {
  it('is a Windows GUI executable and exits quickly without opening a console', async () => {
    const executable = await readFile(helperPath)
    const peOffset = executable.readUInt32LE(0x3c)
    expect(executable.toString('ascii', peOffset, peOffset + 4)).toBe('PE\0\0')
    expect(executable.readUInt16LE(peOffset + 24 + 68)).toBe(2)

    const startedAt = Date.now()
    const result = spawnSync(helperPath, ['--token', 'invalid'], {
      input: '{}', timeout: 1_000, windowsHide: true
    })
    expect(result.status).toBe(0)
    expect(Date.now() - startedAt).toBeLessThan(1_000)
  })

  it('forwards official hook input and returns JSON for Stop', async () => {
    const token = 'c'.repeat(64)
    let received = ''
    const server = createServer((request, response) => {
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { received += chunk })
      request.on('end', () => response.writeHead(204).end())
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Diagnostic listener did not start')

    try {
      const child = spawn(join(process.cwd(), 'resources', 'hooks', 'CodePulseHook.exe'), [
        '--token', token, '--runtime', 'windows', '--diagnostic', '--port', String(address.port)
      ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
      child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
      child.stdin.end(JSON.stringify({
        hook_event_name: 'Stop', session_id: 'session-1', turn_id: 'turn-1', cwd: 'C:\\work\\CodePulse', last_assistant_message: 'private'
      }))
      const exitCode = await new Promise<number | null>((resolve) => child.on('exit', resolve))

      expect(exitCode).toBe(0)
      expect(stderr).toBe('')
      expect(stdout).toBe('{}')
      expect(JSON.parse(received)).toMatchObject({
        hook_event_name: 'Stop', session_id: 'session-1', cwd: 'C:\\work\\CodePulse', runtime: 'windows'
      })
      expect(received).not.toContain('private')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('writes a signed inbox event with the WSL Python helper', async () => {
    const token = 'e'.repeat(64)
    const inbox = await mkdtemp(join(tmpdir(), 'codepulse-wsl-inbox-'))
    const child = spawn('python', [join(process.cwd(), 'resources', 'hooks', 'CodePulseHook.py'),
      '--token', token, '--inbox', inbox, '--distro', 'Ubuntu-22.04'
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stdin.end(JSON.stringify({
      hook_event_name: 'Stop', session_id: 'wsl-session', cwd: '/home/javis/project', last_assistant_message: 'private'
    }))
    const exitCode = await new Promise<number | null>((resolve) => child.on('exit', resolve))
    const entries = (await readdir(inbox)).filter((name) => name.endsWith('.json'))
    const envelope = JSON.parse(await readFile(join(inbox, entries[0]!), 'utf8'))

    expect(exitCode).toBe(0)
    expect(stdout).toBe('{}')
    expect(entries).toHaveLength(1)
    expect(verifyInboxEnvelope(envelope, token)).toMatchObject({
      hook_event_name: 'Stop', session_id: 'wsl-session', cwd: '/home/javis/project', runtime: 'wsl', distro: 'Ubuntu-22.04'
    })
    expect(envelope.body).not.toContain('private')
  })
})
