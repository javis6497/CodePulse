# CodePulse

CodePulse 是面向 Windows 10/11 的本地 AI 编程监控应用，聚焦 Codex 与 Claude Code。

当前版本：`0.1.5`

## 功能

- Codex 与 Claude Code 今日、本周、累计 Token 精确统计
- Codex 动态额度窗口与重置时间
- 52 周 GitHub Contributions 风格 Token 热力图
- Codex 实时任务状态、工具调用、等待批准与完成提示音
- Windows 与 WSL 用量区分
- Dashboard、灵动岛和独立 Codex 状态窗口
- 系统托盘后台运行与右键退出
- 中英文切换、深色与浅色液态玻璃主题
- SQLite 本地历史归档
- NSIS 安装版与 Portable 便携版

CodePulse 的后台采集和 Hook Helper 均隐藏终端窗口，不会在刷新或任务运行期间弹出 PowerShell。

## 安装

Windows 安装包和便携版可通过 GitHub Releases 分发，也可以在本地执行：

```powershell
npm.cmd install
npm.cmd run dist:win
```

构建产物写入 `dist/`。当前本地发布产物保存在 `release-0.1.5/`，该目录不会提交到源码仓库。

首次启用 Codex 实时状态后，需要完整重启 Codex，并在 Codex 中输入 `/hooks`，信任 `CodePulse activity monitor`。

CodePulse 不抓取网页、不读取浏览器 Cookie，也不复制或保存 Codex 登录凭据。账户请求由本机 Codex App Server 完成。

## 开发

要求 Windows 10/11、Node.js 22.13 或更高版本。

```powershell
npm.cmd install
npm.cmd run dev
```

验证：

```powershell
npm.cmd run verify
```

生成 Windows 安装包和便携版：

```powershell
npm.cmd run dist:win
```

## 数据位置

应用数据默认保存在：

```text
%APPDATA%\CodePulse\
```

其中 `codepulse.db` 只保存聚合用量、会话索引、活动元数据和配额快照，不保存聊天正文或认证令牌。

## 数据源

- Codex quota / account usage：Codex App Server JSON-RPC
- Codex / Claude local usage：tokscale
- WSL：只发现并扫描当前正在运行的发行版，不会自动启动已停止的 WSL
- Activity：本地回环地址上的认证 Hook 接收端

## 项目结构

```text
resources/hooks/   Windows 无窗口 Hook Helper 源码
scripts/           构建脚本
src/main/          Electron 主进程与本地服务
src/preload/       安全 IPC 桥接
src/renderer/      React 界面
src/shared/        共享类型和默认值
tests/             Vitest 测试
```
