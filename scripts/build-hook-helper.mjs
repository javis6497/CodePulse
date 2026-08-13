import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(projectRoot, 'resources', 'hooks', 'CodePulseHook.cs')
const outputPath = join(projectRoot, 'resources', 'hooks', 'CodePulseHook.exe')
const compilers = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
]
const compiler = compilers.find(existsSync)

if (!compiler) {
  throw new Error('Windows .NET Framework C# compiler was not found.')
}

mkdirSync(dirname(outputPath), { recursive: true })
const result = spawnSync(compiler, [
  '/nologo',
  '/target:winexe',
  '/optimize+',
  '/platform:anycpu',
  '/utf8output',
  '/reference:System.Web.Extensions.dll',
  `/out:${outputPath}`,
  sourcePath
], {
  cwd: projectRoot,
  encoding: 'utf8',
  windowsHide: true
})

if (result.status !== 0) {
  throw new Error((result.stderr || result.stdout || 'Hook helper compilation failed.').trim())
}

console.log(`Built ${outputPath}`)
