# CodePulse

CodePulse is a local Windows 10/11 monitoring companion for Codex and Claude Code.

Current version: `0.1.7`

## Features

- Exact daily, weekly, and lifetime token usage for Codex and Claude Code
- Codex dynamic quota windows and reset times
- A 52-week GitHub Contributions-style token heatmap
- Live Codex task states for the Windows desktop app, PowerShell CLI, and WSL CLI
- Stable start-order display for parallel Codex tasks, including tool activity, approval waits, and completion sounds
- Separate usage totals for Windows and running WSL distributions
- Full dashboard, Dynamic Island-style compact view, and standalone Codex status window
- Background operation through the Windows system tray, including a right-click exit action
- Chinese and English UI languages
- Dark and light liquid-glass themes
- Local SQLite history storage
- NSIS installer and portable Windows builds

CodePulse runs its collectors and native Hook Helper without opening PowerShell or terminal windows.

## Privacy

CodePulse does not scrape web pages, read browser cookies, copy Codex credentials, or store chat content. Account requests are performed by the local Codex App Server.

The activity Hook keeps only the event name, session identifier, project directory, tool name, and runtime metadata. Windows events use an authenticated loopback receiver at `127.0.0.1`; WSL events use a signed local inbox under the CodePulse application data directory. Prompts, tool arguments, and assistant messages are not forwarded or stored.

Application data is stored locally in:

```text
%APPDATA%\CodePulse\
```

The `codepulse.db` database contains aggregate usage, session indexes, activity metadata, and quota snapshots only.

## Installation

Windows installers and portable builds can be distributed through GitHub Releases. To build them locally:

```powershell
npm.cmd install
npm.cmd run dist:win
```

Build artifacts are written to `dist/` and are intentionally excluded from the source repository.

## Codex live activity setup

1. Start CodePulse.
2. Open **Settings** and select **Enable live status**.
3. Fully restart Codex.
4. Run `/hooks` in Codex and trust `CodePulse activity monitor` when prompted.

CodePulse installs its native Helper at the stable `%APPDATA%\CodePulse\hooks\CodePulseHook.exe` path. It does not rewrite a current Hook configuration or replace the Helper during normal startup. It performs an automatic update only when it detects a legacy CodePulse Hook, the unsupported `async` field, or an old installation-dependent Helper path. A current Hook therefore keeps the same trust identity across subsequent launches.

The Windows user Hook covers both the Codex desktop app and Codex CLI launched from PowerShell. CodePulse also configures a Python Helper for every running WSL distribution it discovers. Run `/hooks` once inside each WSL distribution to trust its local CodePulse Hook.

Codex intentionally requires renewed trust when the Hook command itself changes. See the [official OpenAI Hooks documentation](https://learn.chatgpt.com/docs/hooks).

## Development

Requirements:

- Windows 10 or Windows 11
- Node.js 22.13 or later
- The Windows .NET Framework C# compiler included with Windows

Install dependencies and start the development build:

```powershell
npm.cmd install
npm.cmd run dev
```

Run type checks, tests, and a production build:

```powershell
npm.cmd run verify
```

Create the NSIS installer and portable build:

```powershell
npm.cmd run dist:win
```

## Data sources

- Codex quota and account usage: Codex App Server JSON-RPC
- Codex and Claude local usage: `tokscale`
- WSL: only currently running distributions are discovered and scanned; CodePulse does not start stopped distributions
- Live activity: authenticated Codex command Hooks delivered to a local loopback receiver

## Project structure

```text
resources/hooks/   Native no-console Windows Hook Helper source
scripts/           Build scripts
src/main/          Electron main process and local services
src/preload/       Secure IPC bridge
src/renderer/      React user interface
src/shared/        Shared contracts and defaults
tests/             Vitest test suite
```
