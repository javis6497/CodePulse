# CodePulse Windows AI Coding Monitor 方案设计

> 面向 Windows 10/11 的 AI Coding 用量与运行状态监控工具。  
> 核心目标：统一监控 **Windows + WSL** 中的 **Codex / Claude Code**，并提供 Token 统计、Codex Quota、实时任务状态、历史趋势、系统托盘与悬浮窗。

---

## 1. 项目定位

CodePulse 是一个 Windows 桌面端 AI Coding Companion，重点解决以下问题：

- 同时监控 Windows 与 WSL 中的 AI Coding 工具
- 统一统计 Codex / Claude Code Token 用量
- 查看今日、本周、历史总 Token
- 查看 Codex 当前 Quota 与 Reset Countdown
- 实时查看 Codex Desktop / WSL Codex CLI 当前运行状态
- 区分 Windows / WSL / WSL Distribution 的消耗来源
- 通过悬浮窗快速看到当前任务状态
- 通过 Dashboard 查看历史趋势与热力图

产品不追求第一版支持几十种 Provider，而是优先把：

**Codex + Claude Code + Windows + WSL**

这四个核心方向做稳。

---

# 2. V1 功能范围

## 2.1 平台

- Windows 10
- Windows 11
- x64
- WSL / WSL2

---

## 2.2 桌面功能

- 系统托盘
- 悬浮小窗
- Dashboard
- History
- Sessions
- Settings
- 开机启动
- Portable EXE
- Installer EXE

---

## 2.3 Provider

第一版支持：

### Codex

- Windows Codex Desktop
- Windows Codex CLI
- WSL Codex CLI

### Claude Code

- Windows Claude Code
- WSL Claude Code

后续可扩展：

- Cursor
- Gemini CLI
- OpenCode
- GitHub Copilot
- Claude Desktop

---

# 3. Token 统计

需要提供：

- 今日 Token
- 本周 Token
- 历史总 Token
- Provider 分布
- Windows / WSL 分布
- WSL Distribution 分布
- Model 分布
- Session 分布
- Project 分布

推荐统一数据结构：

```ts
interface UsageRecord {
  provider: "codex" | "claude";
  runtime: "windows" | "wsl";

  distro?: string;

  sessionId?: string;
  project?: string;
  model?: string;

  timestamp: number;

  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}
```

---

# 4. Token 统计展示

Dashboard 顶部：

```text
Today
18.42M

This Week
91.82M

Lifetime
2.37B
```

来源拆分：

```text
Windows
18.2M

WSL
30.4M
```

WSL 可继续展开：

```text
WSL

Ubuntu-24.04     27.8M
Ubuntu            2.6M
Debian               0
```

Provider：

```text
Codex      71%
Claude     29%
```

---

# 5. Codex Quota

不在代码中写死：

- 5 Hour
- Weekly

而是统一使用动态 Quota Window。

```ts
interface QuotaWindow {
  provider: "codex";

  limitId?: string;

  usedPercent: number;

  windowDurationMinutes: number;

  resetsAt?: number;
}
```

UI 根据服务端返回结果自动决定展示：

```text
Codex

Weekly

██████████████████░░░░

74%

Reset in
2d 14h
```

如果未来重新出现 300 分钟窗口，则自动显示：

```text
5 Hours
31%
```

这样 OpenAI 调整额度规则时无需大幅修改客户端。

---

# 6. Codex Quota 数据来源

推荐使用：

```text
codex app-server
```

Electron Main Process：

```text
spawn codex app-server

        ↓

stdin / stdout JSON-RPC

        ↓

initialize

        ↓

account/rateLimits/read

        ↓

account/usage/read
```

不要采用：

- 网页爬虫
- 浏览器 Cookie
- 模拟浏览器
- 抓取 ChatGPT 页面

---

# 7. Codex 实时运行状态

这是 CodePulse 的核心功能之一。

需要支持：

```text
IDLE

STARTING

THINKING

WORKING

TOOL_RUNNING

WAITING_APPROVAL

COMPACTING

SUBAGENT_RUNNING

COMPLETED

FAILED
```

用户可以看到：

```text
Codex · WSL

正在工作

sam3d-body
```

或者：

```text
Codex · WIN

正在压缩上下文
```

或者：

```text
Codex · WSL

任务完成

SAM3D-Multiview

2m 34s
```

---

# 8. Activity 状态机

推荐状态映射：

```text
SessionStart
       ↓
STARTING


UserPromptSubmit
       ↓
THINKING


PreToolUse
       ↓
TOOL_RUNNING


PostToolUse
       ↓
WORKING


PermissionRequest
       ↓
WAITING_APPROVAL


PreCompact
       ↓
COMPACTING


PostCompact
       ↓
THINKING


SubagentStart
       ↓
SUBAGENT_RUNNING


SubagentStop
       ↓
WORKING


Stop
       ↓
COMPLETED


SessionEnd
       ↓
IDLE


Failure
       ↓
FAILED
```

---

# 9. Windows + WSL Activity

整体架构：

```text
                ActivityService

                      │

           ┌──────────┴──────────┐

           │                     │

       Windows                  WSL

           │                     │

    Codex Desktop            Codex CLI

           │                     │

       Codex Hook             Codex Hook

           │                     │

           └──────────┬──────────┘

                      ↓

                  Event Bus

                      ↓

              Floating Island
```

---

# 10. Windows Codex Hook

Windows 侧：

```text
%USERPROFILE%\.codex\
```

Hook 事件进入：

```text
Codex

↓

CodePulse Hook

↓

localhost IPC / HTTP

↓

Electron Main Process

↓

ActivityService

↓

Floating Island
```

---

# 11. WSL Codex Hook

WSL：

```text
~/.codex/
```

建议：

```text
Codex CLI

↓

Linux Hook Helper

↓

localhost

↓

Windows Electron

↓

ActivityService
```

Fallback：

```text
WSL Hook

↓

Event Spool File

↓

Windows File Watcher

↓

CodePulse
```

这样即使 WSL localhost forwarding 有问题，也可以继续运行。

---

# 12. 多任务 Activity

必须支持多个 Codex Session 同时运行。

例如：

```text
Windows Codex Desktop
↓
CodePulse UI

同时

WSL Codex CLI
↓
SAM3D Project
```

内部使用：

```ts
interface ActivitySession {
  sessionId: string;

  provider: "codex";

  runtime: "windows" | "wsl";

  distro?: string;

  project?: string;

  state:
    | "idle"
    | "starting"
    | "thinking"
    | "working"
    | "tool_running"
    | "waiting_approval"
    | "compacting"
    | "subagent_running"
    | "completed"
    | "failed";

  startedAt: number;
  updatedAt: number;

  currentTool?: string;

  message?: string;
}
```

---

# 13. Floating Island

悬浮窗参考 QuotaView 的交互方式，但做 Windows 原生视觉适配。

## 空闲

```text
●
```

## 正在工作

```text
╭──────────────────────────────────╮
│ ● Codex · WSL                    │
│                                  │
│ 正在修改代码                     │
│ SAM3D-Multiview                  │
╰──────────────────────────────────╯
```

## Tool Use

```text
╭──────────────────────────────────╮
│ ◉ Codex · WIN                    │
│                                  │
│ 正在执行工具                     │
│ apply_patch                      │
╰──────────────────────────────────╯
```

## Context Compact

```text
╭──────────────────────────────────╮
│ ◌ Codex · WSL                    │
│                                  │
│ 正在压缩上下文...                │
╰──────────────────────────────────╯
```

## Completed

```text
╭──────────────────────────────────╮
│ ✓ Codex · WSL                    │
│                                  │
│ 任务完成                         │
│ sam3d-body · 2m 34s              │
╰──────────────────────────────────╯
```

建议：

```text
Completed

↓ 20 秒

Compact

↓ 2 分钟

Hide
```

---

# 14. 多任务悬浮窗

同时运行多个任务时：

```text
╭──────────────────────────────────────────────╮
│ ● Codex                       正在修改代码   │
│                                              │
│ SAM3D-Multiview                              │
│ WSL · Ubuntu-24.04                           │
│                                              │
│                        ● UI Project           │
│                        ● SAM3D-Multiview      │
│                        ✓ Test                 │
╰──────────────────────────────────────────────╯
```

建议最多直接显示 3 个 Session。

超过 3 个：

```text
+ 2 more
```

或者滚动 Task Rail。

---

# 15. 来源标识

每个 Session 必须明确显示来源。

Windows：

```text
COD
WIN
```

WSL：

```text
COD
WSL

Ubuntu-24.04
```

Claude：

```text
CLAUDE
WIN
```

```text
CLAUDE
WSL
```

---

# 16. 刷新机制

不要所有数据都统一轮询。

应该分三种。

---

## 16.1 Activity

事件驱动。

```text
Hook Event

↓

ActivityService

↓

Renderer
```

目标延迟：

```text
< 500ms
```

---

## 16.2 Token

使用：

```text
File Watcher
+
Debounce
+
Incremental Parser
```

流程：

```text
Session JSONL changed

↓

debounce 500~1500ms

↓

只解析新增部分

↓

更新 SQLite

↓

更新 UI
```

目标：

```text
约 1~3 秒更新
```

同时允许用户设置：

- 实时
- 30 秒
- 60 秒
- 5 分钟

---

## 16.3 Quota

建议：

- 30 秒
- 60 秒
- 5 分钟
- 手动

默认：

```text
60 秒
```

---

# 17. Windows / WSL Runtime

Runtime 必须作为一级字段。

```ts
type RuntimeType =
  | "windows"
  | "wsl";
```

WSL：

```ts
interface WslRuntime {
  distro: string;
  homePath: string;
  running: boolean;
}
```

检测：

```text
wsl.exe --list --running --quiet
```

文件路径：

```text
\\wsl.localhost\Ubuntu-24.04\home\<user>\
```

也兼容：

```text
\\wsl$\Ubuntu-24.04\
```

---

# 18. Claude Code

V1 先完成 Token / Session / Project。

```text
Claude Code

├ Windows
└ WSL
```

功能：

- Today
- Week
- Lifetime
- Session
- Project
- Model
- Runtime

第一版不要求像 Codex 一样做完整 Activity Island。

后续 V2 再增加 Claude Activity。

---

# 19. 数据库

推荐：

```text
SQLite
+
better-sqlite3
```

不要把完整聊天内容复制进数据库。

只保存：

- Usage
- Session Index
- Activity Metadata
- Quota Snapshot
- App Settings

---

# 20. usage_daily

```sql
CREATE TABLE usage_daily (
    date TEXT NOT NULL,

    provider TEXT NOT NULL,
    runtime TEXT NOT NULL,
    distro TEXT,
    model TEXT,

    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cached_tokens INTEGER DEFAULT 0,
    reasoning_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,

    PRIMARY KEY (
        date,
        provider,
        runtime,
        distro,
        model
    )
);
```

---

# 21. session_index

```sql
CREATE TABLE session_index (
    session_id TEXT PRIMARY KEY,

    provider TEXT NOT NULL,
    runtime TEXT NOT NULL,

    distro TEXT,

    project TEXT,
    model TEXT,

    source_path TEXT,

    started_at INTEGER,
    ended_at INTEGER,

    total_tokens INTEGER DEFAULT 0
);
```

---

# 22. activity

```sql
CREATE TABLE activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    session_id TEXT,

    provider TEXT NOT NULL,
    runtime TEXT NOT NULL,

    distro TEXT,

    project TEXT,

    event TEXT NOT NULL,

    tool_category TEXT,

    timestamp INTEGER NOT NULL
);
```

---

# 23. quota_snapshot

```sql
CREATE TABLE quota_snapshot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    provider TEXT NOT NULL,

    account_id TEXT,

    limit_id TEXT,

    window_minutes INTEGER,

    used_percent REAL,

    resets_at INTEGER,

    timestamp INTEGER NOT NULL
);
```

---

# 24. 历史归档

不能只依赖：

```text
~/.codex
~/.claude
```

因为用户可能：

- 删除 Session
- 清理日志
- 更换电脑
- 清理 WSL
- 重装 Codex

所以 CodePulse 必须自己保存历史聚合。

例如：

```text
2026-08-10
Codex
WSL
GPT-5.6
38.2M
```

即使原始 Session 被删除，历史总 Token 仍然存在。

---

# 25. 历史折线图

支持：

```text
7D
30D
3M
6M
ALL
```

过滤：

```text
TOTAL

Codex

Claude

Windows

WSL
```

示意：

```text
Token Activity

42M ┤                 ╭─╮
    │            ╭────╯ ╰─
20M ┤       ╭────╯
    │   ╭───╯
 0M ┼──────────────────────
```

---

# 26. 热力图

类似 GitHub Contribution Graph。

```text
2026

        Aug

M  ░ ▒ █ ░ █ █ ▒
T  ▒ █ █ █ ░ ░ █
W  █ ▒ ░ █ █ █ █
T  ░ ░ █ █ ▒ █ ░
F  █ █ █ ░ ▒ █ █
```

强度：

```text
0

< 1M

1M - 5M

5M - 20M

20M - 50M

50M+
```

---

# 27. UI 风格

采用：

```text
Apple-inspired
```

而不是复制 Apple 系统资源。

推荐：

### Font

```text
Segoe UI Variable
```

### Icons

```text
Lucide
```

或者：

```text
Fluent System Icons
```

### Window

```text
border-radius:
16px ~ 22px
```

### Card

```text
border-radius:
12px ~ 16px
```

### Background

```text
Dark
+
Mica
+
Acrylic
+
Backdrop Blur
```

### Default Dark Background

```text
#0B0B0D
```

---

# 28. Dashboard

建议布局：

```text
╭──────────────────────────────────────────────────╮
│ CodePulse                              ⚙   —  ×  │
│                                                  │
│ Overview                                         │
│                                                  │
│ ┌────────┐ ┌────────┐ ┌─────────────┐           │
│ │ TODAY  │ │ WEEK   │ │ ALL TIME    │           │
│ │ 18.4M  │ │ 91.8M  │ │ 2.37B       │           │
│ └────────┘ └────────┘ └─────────────┘           │
│                                                  │
│ Codex                                            │
│ ┌──────────────────────────────────────────────┐ │
│ │ Weekly                           74%          │ │
│ │ ██████████████████████░░░░░░                │ │
│ │ Reset in 2d 14h                             │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ Usage                                            │
│                                                  │
│              ───────────╮                        │
│           ╭──           ╰──────                  │
│       ╭───╯                                      │
│ ──────╯                                          │
│                                                  │
│ Sources                                          │
│                                                  │
│ Windows       7.2M      ███████░░                │
│ WSL          11.2M      ███████████              │
│                                                  │
│ Activity                                         │
│                                                  │
│ ● Codex · WSL       Working                     │
│   sam3d-body                                    │
│                                                  │
│ ✓ Codex · WIN       Completed · 3m ago          │
│   CodePulse                                       │
│                                                  │
╰──────────────────────────────────────────────────╯
```

---

# 29. Tray Popover

系统托盘点击后：

```text
╭───────────────────────────────╮
│ CodePulse                     │
│                               │
│ Today               18.4M     │
│ Week                91.8M     │
│                               │
│ Codex Weekly         74%      │
│ █████████████░░░░             │
│ Reset 2d 14h                  │
│                               │
│ ● WSL Codex         Working   │
│                               │
│ Dashboard                     │
│ Settings                      │
│ Quit                          │
╰───────────────────────────────╯
```

---

# 30. Settings

## General

```text
Launch at startup

Start minimized

Show tray icon

Show Floating Island
```

## Token Collection

```text
● Real-time
○ 30 seconds
○ 60 seconds
○ 5 minutes
```

## Quota

```text
○ 30 seconds
● 60 seconds
○ 5 minutes
○ Manual
```

## Activity

```text
● Real-time
```

## Runtime

```text
Windows

✓ Enable


WSL

✓ Ubuntu-24.04

✓ Ubuntu

□ Debian
```

---

# 31. 技术栈

## Frontend

```text
React
TypeScript
Vite
Zustand
```

图表：

```text
ECharts
```

或者：

```text
Recharts
```

推荐优先：

```text
ECharts
```

---

## Desktop

```text
Electron
```

---

## Collector

```text
Node.js

chokidar

child_process
```

Token Parser：

```text
tokscale
```

优先复用现有能力。

必要时再实现自己的增量 Parser。

---

## Codex

```text
codex app-server

JSON-RPC

Codex Hooks
```

---

## WSL

```text
wsl.exe

\\wsl.localhost

WSL Hook Helper
```

---

## Database

```text
SQLite

better-sqlite3
```

---

## Packaging

```text
electron-builder
```

输出：

```text
CodePulse-Setup.exe

CodePulse-Portable.exe
```

---

# 32. 软件整体架构

```text
┌───────────────────────────────────────────────┐
│                   UI Layer                    │
│                                               │
│ Dashboard   Floating Island   Tray   History  │
│ Settings    Sessions                         │
└──────────────────────┬────────────────────────┘

                       │

              Zustand / Event Bus

                       │

┌──────────────────────▼────────────────────────┐
│              Application Core                 │
│                                               │
│ UsageService          ActivityService         │
│ QuotaService          HistoryService          │
│ RefreshCoordinator    NotificationService     │
└──────────────┬───────────────────┬────────────┘

               │                   │

       ┌───────▼────────┐   ┌──────▼────────┐
       │ Provider Layer │   │ Runtime Layer │
       │                │   │               │
       │ CodexProvider  │   │ Windows       │
       │ ClaudeProvider │   │ WSL           │
       └───────┬────────┘   └──────┬────────┘

               │                   │

       ┌───────▼───────────────────▼───────────┐
       │             Collectors                │
       │                                       │
       │ CodexAppServerCollector               │
       │ CodexSessionCollector                 │
       │ ClaudeSessionCollector                │
       │ CodexHookCollector                    │
       │ WSLCollector                          │
       │ ProcessDetector                       │
       └────────────────┬──────────────────────┘

                        │

                 ┌──────▼──────┐
                 │   SQLite    │
                 │             │
                 │ usage_daily │
                 │ sessions    │
                 │ activities  │
                 │ quotas      │
                 └─────────────┘
```

---

# 33. 推荐项目目录

```text
codepulse/

├── apps/
│   └── desktop/
│
│       ├── electron/
│       │   ├── main.ts
│       │   ├── tray.ts
│       │   ├── windows.ts
│       │   └── ipc.ts
│       │
│       └── renderer/
│           ├── App.tsx
│           ├── pages/
│           ├── components/
│           └── stores/
│
├── packages/
│
│   ├── core/
│   │   ├── usage/
│   │   ├── quota/
│   │   ├── activity/
│   │   └── history/
│
│   ├── providers/
│   │
│   │   ├── codex/
│   │   │   ├── AppServerClient.ts
│   │   │   ├── CodexUsageCollector.ts
│   │   │   ├── CodexQuotaCollector.ts
│   │   │   └── CodexActivityAdapter.ts
│   │   │
│   │   └── claude/
│   │       └── ClaudeUsageCollector.ts
│
│   ├── runtimes/
│   │   ├── windows/
│   │   └── wsl/
│
│   ├── activity-hook/
│   │   ├── windows/
│   │   └── linux/
│
│   ├── database/
│   │
│   └── shared/
│
├── resources/
│
├── package.json
│
└── README.md
```

---

# 34. 开发阶段

## Phase 1：基础 Desktop

目标：

```text
Electron

↓

Tray

↓

Dashboard

↓

SQLite
```

完成：

- Electron 主程序
- React Renderer
- Tray
- Settings
- SQLite
- App Auto Launch

---

# 35. Phase 2：Windows Codex

完成：

```text
Codex App Server

↓

Quota

↓

Token Usage
```

功能：

- Codex Account
- Dynamic Quota Window
- Reset Countdown
- Today
- Week
- Lifetime

目标：

```text
Windows Codex 可以完整统计
```

---

# 36. Phase 3：WSL Codex

完成：

```text
WSL Discovery

↓

WSL Codex Scanner

↓

Windows / WSL Split
```

实现：

- WSL Distribution 检测
- WSL Home 检测
- Codex Session 扫描
- Windows / WSL 来源区分
- 去重

目标：

```text
Windows Codex
+
WSL Codex

统一统计
```

---

# 37. Phase 4：Codex Activity

这是项目最核心阶段。

完成：

```text
Codex Hooks

↓

Activity Event Bus

↓

Session State Machine

↓

Floating Island
```

需要完成：

- Starting
- Thinking
- Working
- Tool Running
- Approval
- Compacting
- Subagent
- Completed
- Failed

支持：

```text
Windows Codex Desktop

+

WSL Codex CLI
```

同时运行。

---

# 38. Phase 5：Claude Code

完成：

```text
Claude Windows

Claude WSL
```

支持：

- Token
- Today
- Week
- Lifetime
- Session
- Project
- Model
- Runtime

---

# 39. Phase 6：历史统计

完成：

- Daily Archive
- Weekly Aggregation
- Lifetime Aggregation
- Line Chart
- Heatmap
- Provider Filter
- Runtime Filter
- WSL Distro Filter

---

# 40. Phase 7：产品化

完成：

- Apple-inspired UI
- Mica / Blur
- Tray Popover
- Floating Island Animation
- Installer EXE
- Portable EXE
- Auto Update
- Crash Log
- Debug Log
- Backup / Restore
- Startup

---

# 41. V1 完成功能表

| 功能 | V1 |
|---|---|
| Windows 10/11 | ✅ |
| 系统托盘 | ✅ |
| Apple-inspired UI | ✅ |
| Floating Island | ✅ |
| Windows Codex Desktop | ✅ |
| Windows Codex CLI | ✅ |
| WSL Codex CLI | ✅ |
| Claude Code Windows | ✅ |
| Claude Code WSL | ✅ |
| 今日 Token | ✅ |
| 本周 Token | ✅ |
| 历史总 Token | ✅ |
| Codex Dynamic Quota | ✅ |
| Codex Weekly Quota | ✅ |
| Reset Countdown | ✅ |
| Windows / WSL 拆分 | ✅ |
| WSL Distro 拆分 | ✅ |
| 历史折线 | ✅ |
| 热力图 | ✅ |
| Codex Thinking | ✅ |
| Codex Working | ✅ |
| Codex Tool Use | ✅ |
| Context Compact | ✅ |
| Approval | ✅ |
| Subagent | ✅ |
| Completed | ✅ |
| Failed | ✅ |
| 多 Codex 任务 | ✅ |
| 开机启动 | ✅ |
| 30 秒刷新 | ✅ |
| 60 秒刷新 | ✅ |
| Token 实时刷新 | ✅ |
| Activity 实时刷新 | ✅ |

---

# 42. V1 暂不做

为了控制开发复杂度，以下功能建议 V1 暂不做：

- Cloud Sync
- 多设备同步
- 手机 App
- Web Dashboard
- 20+ Provider
- Team Usage
- 企业账户管理
- Cloudflare Worker
- 云端账户系统
- 在线数据库
- Claude 完整 Activity Hook
- AI 成本换算
- Billing / Payment
- SaaS

---

# 43. 关键设计原则

## 43.1 Quota 不硬编码

不要：

```text
5h
weekly
```

而是：

```text
QuotaWindow[]
```

---

## 43.2 Usage / Quota / Activity 分离

不要做成一个：

```text
CodexCollector
```

应该拆成：

```text
CodexUsageProvider

CodexQuotaProvider

CodexActivityProvider
```

因为它们：

- 数据来源不同
- 更新频率不同
- 生命周期不同

---

## 43.3 Runtime 是一级维度

必须从第一天就支持：

```text
WINDOWS

WSL
```

---

## 43.4 WSL Distro 是一级维度

```text
WSL

├ Ubuntu-24.04

├ Ubuntu

├ Debian

└ Arch
```

---

## 43.5 Activity 必须事件驱动

不要通过：

```text
轮询 codex.exe
```

猜测：

- Thinking
- Compacting
- Tool Use

应该优先使用 Hook Event。

---

## 43.6 Token 使用增量解析

不要每 1 秒完整扫描所有历史 JSONL。

正确方式：

```text
File Changed

↓

Read From Last Offset

↓

Parse New Events

↓

Update Aggregation
```

这样可以显著降低：

- CPU
- SSD IO
- WSL IO
- Electron 主进程压力

---

# 44. 推荐 V1 MVP

不要一开始同时完成所有功能。

最先实现这个闭环：

```text
Windows Codex Desktop ─┐
                       │
                       ├────→ CodePulse
                       │
WSL Codex CLI ─────────┘
```

CodePulse 显示：

```text
WIN
Codex
Working


WSL
Codex
Compacting


Weekly Quota
72%


Today
18.4M


Windows
6.2M


WSL
12.2M
```

如果这个 Demo 成功：

- WSL 通了
- Codex App Server 通了
- Token 通了
- Hook 通了
- Multi Session 通了
- Activity 通了
- Electron 通了

整个项目最关键的技术闭环基本完成。

---

# 45. 开发难度判断

整体：

```text
6.5 / 10
```

主要困难集中在：

### 中高难度

```text
Windows + WSL Token 去重

WSL 多 Distribution

Codex Session Mapping

Activity 多任务状态机

增量 Token Parser
```

### 中等

```text
Codex App Server

SQLite History

Charts

Electron IPC
```

### 低到中等

```text
Dashboard

Tray

Settings

Apple-style UI

开机启动

Portable EXE
```

---

# 46. 项目参考

主要参考项目：

### QuotaView

```text
https://github.com/Duoasa/QuotaView
```

适合参考：

- Codex App Server Client
- Codex Quota
- Activity Hook
- Activity Event Model
- Codex Floating Island
- Multi Task Activity
- Session State Machine

---

### token-monitor

```text
https://github.com/Javis603/token-monitor
```

适合参考：

- Electron Desktop Architecture
- Windows Packaging
- WSL Detection
- WSL Session Scan
- Token Statistics
- tokscale
- History
- Heatmap
- Provider Adapter

---

# 47. 最终推荐技术栈

```text
Frontend
────────

React
TypeScript
Vite
Zustand
ECharts


Desktop
───────

Electron


Collector
─────────

Node.js
chokidar
child_process
tokscale
Incremental Parser


Codex
─────

codex app-server
JSON-RPC
Codex Hooks


WSL
───

wsl.exe
\\wsl.localhost
WSL Hook Helper


Database
────────

SQLite
better-sqlite3


Packaging
─────────

electron-builder


Output
──────

CodePulse-Setup.exe
CodePulse-Portable.exe
```

---

# 48. 最终目标

最终产品应该同时提供三种使用方式。

## Floating Island

用于实时工作状态：

```text
Codex · WSL

正在修改模型代码
```

---

## Tray Popover

用于快速查看：

```text
Today

Weekly

Quota

Current Task
```

---

## Dashboard

用于完整分析：

```text
Overview

Usage

Activity

Sessions

History

Settings
```

---

# 49. 一句话架构总结

```text
QuotaView 的 Codex Activity / Quota 能力

+

token-monitor 的 Windows / WSL Token 采集能力

+

自己的 Windows Electron UI / SQLite / History

=

CodePulse
```

---

# 50. V1 核心目标

V1 不追求“支持最多”。

V1 只追求：

```text
Codex
+
Claude Code
+
Windows
+
WSL
+
Realtime Activity
+
Reliable Token History
```

把这部分做稳之后，再增加其他 Provider。
