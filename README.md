# DeepSeek Harness GUI

一个把官方 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)（dsh）网页端封装成**原生桌面应用**的 Electron 外壳。

双击即用——自动拉起 `dsh web` 服务并以原生窗口加载官方网页前端（`127.0.0.1:3080`），配置模型、对话与浏览器里 100% 一致，同时附带一系列浏览器给不了的桌面独占能力。

> 这个项目只做「外壳 + 桌面增强」，**不重新实现 dsh 的任何前端逻辑**。网页端的内容、样式、功能完全来自官方 dsh，因此它永远和官方网页端保持一致。

---

## 为什么需要它

官方 dsh 是一个命令行工具 + Web 前端，正常使用要在终端跑 `dsh web` 再开浏览器访问 `127.0.0.1:3080`。本客户端把它变成一个**双击就能用的桌面应用**：

- 不用开终端、不用记命令、不用占浏览器标签
- 双击图标 → 自动起服务 → 自动加载网页端
- 关闭时杀掉服务进程，不留残留
- 附带托盘、全局快捷键、设置窗口等桌面能力

---

## 功能特性

### 核心能力
- 🚀 **双击即用** —— 双击启动，自动拉起 `dsh web`（端口 3080）并加载官方网页端，最多 30s 就绪
- 🪟 **原生 Windows 标题栏** —— 稳定不黑屏，标准桌面窗口外观
- 🧹 **退出即清理** —— 关闭时杀掉本应用拉起的 dsh web 进程，不留后台残留
- 🔁 **端口自愈** —— 启动前检测 3080 是否被占用：若是上次残留则自动清理，被其他进程占用则报清晰错误

### 桌面独占功能（浏览器给不了的）
- ⚙️ **设置窗口** —— 可视化管理 dsh 安装路径（自动探测 + 手动指定）、查看/启停/重启本地服务、切换行为偏好
  - 路径自动探测：从 npm 全局目录、用户目录、常见位置查找 `@deepseek-ai/dsh`
  - 手动指定：浏览选择包含 `lib/bin.js` 的目录
  - 服务控制：实时状态、启动 / 停止 / 重启
- 📋 **原生菜单栏** —— 文件 / 视图 / 帮助标准菜单
  - 设置（`Ctrl+,`）、打开数据目录、退出（`Ctrl+Q`）
  - 重新加载（`Ctrl+R`）、始终置顶开关（`Ctrl+T`）、缩放、开发者工具（`F12`）
  - 关于、访问 GitHub
- 📌 **始终置顶** —— 让客户端钉在最前面，写代码/看文档时 AI 放旁边，状态持久化
- 🔔 **系统通知** —— 服务就绪 / 启动失败弹 Windows 原生通知，不用盯着窗口
- 🖥️ **系统托盘** —— 关闭可收进托盘后台运行，托盘菜单：显示/隐藏、设置、重载、打开数据目录、退出
- ⌨️ **全局快捷键** —— `Ctrl+Shift+Space` 一键唤起/隐藏窗口
- 🔒 **单实例锁** —— 已在运行时再双击只聚焦已有窗口，不会开一堆
- 💾 **窗口记忆** —— 记住上次窗口位置和大小

### 由官方网页端负责的（不在外壳层）
- 对话、流式响应、模型配置、Profile/插件管理、文件拖拽、中英文切换、主题——全部由 dsh 网页端自己提供，外壳不干预

---

## 工作原理

```
双击 exe
  │
  ├─ Electron 启动 → 显示主窗口（原生标题栏）
  ├─ DSHBridge.findDSHPath() → 自动探测 @deepseek-ai/dsh 安装位置
  ├─ DSHBridge.startWeb() → spawn "node <dsh>/lib/bin.js web"（端口 3080）
  │    ├─ 端口自愈：检测 3080 占用 → 清理残留 / 报错
  │    └─ 轮询 isWebRunning() 最多 30s
  ├─ 服务就绪 → mainWindow.loadURL("http://127.0.0.1:3080")
  └─ 弹系统通知「本地服务已启动」
```

退出时（关闭窗口 / 托盘退出 / `Ctrl+Q`）：
- `before-quit` → `dshBridge.cleanup()` → `taskkill` 杀掉 web 进程树 → 无残留

---

## 安装与使用

### 方式一：使用预构建安装包（推荐）

下载 [Releases](../../releases) 中的 `DeepSeek Harness GUI Setup 1.0.0.exe`，双击安装后从开始菜单/桌面快捷方式启动。

### 方式二：免安装版

下载 `win-unpacked` 目录，直接双击 `DeepSeek Harness GUI.exe` 运行。

### 前提条件

本机需已安装 **Node.js**（v16+）和 **@deepseek-ai/dsh**，因为外壳需要通过 `node` 拉起 `dsh web` 服务：

```bash
# 安装 dsh（全局）
npm install -g @deepseek-ai/dsh
```

> 客户端启动时若找不到 dsh，会弹出设置窗口让你手动指定安装目录。

### 首次配置

1. 双击启动客户端
2. 若自动探测到 dsh → 自动起服务并加载网页端
3. 若未找到 → 进入「文件 → 设置」，点「浏览…」选择 dsh 安装目录（包含 `lib/bin.js` 的文件夹），保存后重启
4. 网页端加载后，像在浏览器里一样配置模型、开始对话

---

## 从源码构建

```bash
# 克隆仓库
git clone https://github.com/LiMCZJY/dsh-gui-client.git
cd dsh-gui-client

# 安装依赖
npm install

# 开发模式运行
npm start

# 构建 Windows 安装包
npm run electron:build:win

# 构建产物在 dist-electron/ 目录
```

### 构建其他平台

```bash
npm run electron:build:mac    # macOS (.dmg)
npm run electron:build:linux  # Linux (.AppImage)
```

---

## 项目结构

```
dsh-gui-client/
├── electron/                # Electron 主进程（外壳层）
│   ├── main.js              # 主窗口 + 菜单 + 托盘 + 设置窗口 + 通知 + 快捷键
│   ├── preload.js           # 预加载脚本（暴露安全 IPC API）
│   ├── dsh-bridge.js        # dsh 路径探测 + web 服务生命周期 + 端口自愈
│   ├── ipc-handlers.js      # IPC 处理器（路径/服务/配置/文件）
│   ├── loading.html         # 服务启动失败时的错误兜底页
│   └── settings.html        # 设置窗口页面
├── assets/                  # 应用图标
│   ├── icon.ico             # Windows 图标
│   └── icon.png             # 通用图标
├── package.json             # 依赖与 electron-builder 配置
└── README.md
```

### 关键文件说明

| 文件 | 职责 |
|---|---|
| `main.js` | 创建原生窗口、加载 dsh 网页端、原生菜单栏、系统托盘、全局快捷键、单实例锁、窗口记忆、始终置顶、系统通知、设置窗口 |
| `dsh-bridge.js` | `findDSHPath` 路径探测、`startWeb`/`stopWeb` 服务生命周期、`getPortOccupant` 端口自愈、`isWebRunning` 健康检查、GUI 配置读写 |
| `ipc-handlers.js` | dsh 版本/路径/服务启停/配置等 IPC 处理器 |
| `settings.html` | 设置窗口 UI：路径探测与指定、服务启停、行为偏好开关 |

---

## 配置说明

客户端配置保存在 `~/.dsh-gui/config.json`：

| 配置项 | 说明 | 默认值 |
|---|---|---|
| `dshPath` | `@deepseek-ai/dsh` 安装路径 | 自动探测 |
| `minimizeToTray` | 关闭时最小化到托盘 | `false`（关闭即退出） |
| `alwaysOnTop` | 窗口始终置顶 | `false` |
| `bounds` | 窗口位置与大小 | 系统默认 |

dsh 自身的数据（会话、配置、凭证）保存在 `~/.dsh/`，与命令行使用完全互通。

---

## 技术栈

- **Electron 28** —— 跨平台桌面应用框架
- **electron-builder 24** —— 打包与发布
- **原生 HTML/CSS/JS** —— 设置窗口与启动页（无框架依赖）

> 不使用 React/Vue 等前端框架——因为网页端内容由 dsh 官方提供，外壳层只需要几个简单的本地页面。

---

## 常见问题

**Q：启动后窗口黑屏？**
A：本客户端使用原生窗口（`frame: true`）直接 `loadURL` 加载网页端，不会黑屏。若仍黑屏，检查 dsh web 服务是否正常（在浏览器访问 `http://127.0.0.1:3080`）。

**Q：提示「未找到 DSH 安装路径」？**
A：进入「文件 → 设置」，点「浏览…」手动选择 dsh 安装目录（包含 `lib/bin.js` 的文件夹，通常在 `node_modules/@deepseek-ai/dsh`）。

**Q：关闭窗口后服务还在跑？**
A：默认关闭即退出并杀掉服务。若在设置里开启了「最小化到托盘」，关闭会收进托盘后台运行，从托盘菜单「退出」才会真正退出。

**Q：端口 3080 被占用启动失败？**
A：客户端有端口自愈逻辑，会自动清理上次残留进程。若被其他程序占用，设置窗口会提示占用进程 PID，手动结束后重试。

---

## 贡献

欢迎提 Issue 和 PR。开发时运行 `npm start` 即可启动开发模式。

## 许可证

MIT License
