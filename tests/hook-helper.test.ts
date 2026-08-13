import { readFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const helperPath = join(process.cwd(), 'resources', 'hooks', 'CodePulseHook.exe')

describe('CodePulseHook', () => {
  it('is a Windows GUI executable and exits quickly without opening a console', async () => {
    const executable = await readFile(helperPath)
    const peOffset = executable.readUInt32LE(0x3c)
    expect(executable.toString('ascii', peOffset, peOffset + 4)).toBe('PE\0\0')
    expect(executable.readUInt16LE(peOffset + 24 + 68)).toBe(2)

    const startedAt = Date.now()
    const result = spawnSync(helperPath, ['--token', 'invalid'], {
      input: '{}',
      timeout: 1_000,
      windowsHide: true
    })
    expect(result.status).toBe(0)
    expect(Date.now() - startedAt).toBeLessThan(1_000)
  })

  it('forwards the privacy-filtered hook payload to the activity receiver', async () => {
    let body = ''
    let authorization = ''
    const server = createServer((request, response) => {
      authorization = request.headers.authorization || ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { body += chunk })
      request.on('end', () => response.writeHead(204).end())
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test receiver did not start')

    const token = 'a'.repeat(64)
    const child = spawn(helperPath, [
      '--token', token, '--runtime', 'windows', '--diagnostic', '--port', String(address.port)
    ], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.stdin.end(JSON.stringify({
      hook_event_name: 'PreToolUse', session_id: 'session', cwd: 'F:\\work',
      tool_name: 'apply_patch', prompt: 'must not be forwarded', tool_input: { secret: true }
    }))
    const exitCode = await new Promise<number | null>((resolve) => child.once('exit', resolve))
    await new Promise<void>((resolve) => server.close(() => resolve()))

    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(authorization).toBe(`Bearer ${token}`)
    expect(JSON.parse(body)).toEqual({
      hook_event_name: 'PreToolUse', session_id: 'session', cwd: 'F:\\work',
      tool_name: 'apply_patch', runtime: 'windows', distro: ''
    })
  })
})
