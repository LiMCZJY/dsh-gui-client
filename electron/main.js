const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Tray,
  Menu,
  nativeImage,
  shell,
  globalShortcut,
  Notification,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const DSHBridge = require('./dsh-bridge');
const { setupIPCHandlers, cleanup: cleanupIPCHandlers } = require('./ipc-handlers');

const WEB_PORT = 3080;
const WEB_BASE = `http://127.0.0.1:${WEB_PORT}`;
const HOTKEY = 'CommandOrControl+Shift+Space';

// 全局引用
let mainWindow = null;
let settingsWindow = null;
let dshBridge = new DSHBridge();
let tray = null;
let forceQuit = false;
let minimizeToTray = false;
let alwaysOnTop = false;
let starting = false;
let boundsSaveTimer = null;

// ---- 单实例锁 ----
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// ===== 主窗口（原生 Windows 标题栏，直接加载 dsh 网页端）=====
async function createWindow() {
  const bounds = await restoreBounds();
  mainWindow = new BrowserWindow({
    ...(bounds || { width: 1280, height: 860 }),
    minWidth: 800,
    minHeight: 600,
    frame: true,
    backgroundColor: '#1e1e1e',
    resizable: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '../assets/icon.png'),
  });

  mainWindow.setTitle('DeepSeek Harness');
  mainWindow.setAlwaysOnTop(alwaysOnTop);

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('resize', scheduleSaveBounds);
  mainWindow.on('move', scheduleSaveBounds);

  mainWindow.on('close', (event) => {
    if (!forceQuit && minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ===== 设置窗口 =====
function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 600,
    minHeight: 500,
    parent: mainWindow || undefined,
    modal: false,
    resizable: true,
    frame: true,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '../assets/icon.png'),
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ===== 系统通知 =====
function notify(title, body) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  } catch (e) { /* ignore */ }
}

// ===== 启动 dsh web 并加载网页端 =====
async function startAndLoadWeb() {
  if (starting) return;
  starting = true;
  try {
    const res = await dshBridge.startWeb();
    if (!res || !res.ok) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadFile(path.join(__dirname, 'loading.html'));
        setTimeout(() => {
          try { mainWindow.webContents.send('app-error', (res && res.message) || '本地服务启动失败'); } catch (e) {}
        }, 300);
      }
      notify('DeepSeek Harness', (res && res.message) || '本地服务启动失败');
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(WEB_BASE);
    }
    if (!res.alreadyRunning) {
      notify('DeepSeek Harness', '本地服务已启动，网页端加载中…');
    }
  } finally {
    starting = false;
  }
}

function toggleMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow().then(startAndLoadWeb);
    return;
  }
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) mainWindow.hide();
  else { mainWindow.show(); mainWindow.focus(); }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow().then(startAndLoadWeb);
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

// ===== 窗口记忆 =====
async function restoreBounds() {
  try {
    const cfg = await dshBridge.getGuiConfig();
    if (cfg && cfg.bounds) return cfg.bounds;
  } catch { /* ignore */ }
  return null;
}
function saveBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
  const b = mainWindow.getBounds();
  if (b.width < 400 || b.height < 300) return;
  dshBridge.setGuiConfig({ bounds: b }).catch(() => {});
}
function scheduleSaveBounds() {
  if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(saveBounds, 800);
}

// ===== 始终置顶 =====
function applyAlwaysOnTop(value) {
  alwaysOnTop = !!value;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(alwaysOnTop);
  dshBridge.setGuiConfig({ alwaysOnTop }).catch(() => {});
  rebuildMenu();
}

// ===== 系统托盘 =====
function createTray() {
  if (process.platform === 'darwin') return;
  let icon;
  const iconPath = path.join(__dirname, '../assets/icon.png');
  try {
    icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  } catch { icon = nativeImage.createEmpty(); }
  tray = new Tray(icon);
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  tray.setToolTip('DeepSeek Harness');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: () => toggleMainWindow() },
    { type: 'separator' },
    { label: '设置', click: () => openSettings() },
    { label: '重载网页端', click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(WEB_BASE); } },
    { label: '打开数据目录', click: () => { try { shell.openPath(dshHome); } catch {} } },
    { type: 'separator' },
    { label: '退出', click: () => { forceQuit = true; app.quit(); } },
  ]));
  tray.on('double-click', () => toggleMainWindow());
}

// ===== 原生菜单栏 =====
function rebuildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '设置', accelerator: 'CmdOrCtrl+,', click: () => openSettings() },
        { label: '打开数据目录', click: () => { try { shell.openPath(process.env.DSH_HOME || path.join(os.homedir(), '.dsh')); } catch {} } },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => { forceQuit = true; app.quit(); } },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload(); } },
        { label: '始终置顶', type: 'checkbox', checked: alwaysOnTop, accelerator: 'CmdOrCtrl+T', click: () => applyAlwaysOnTop(!alwaysOnTop) },
        { type: 'separator' },
        { label: '实际大小', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: '放大', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: '开发者工具', accelerator: 'F12', click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.toggleDevTools(); } },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于 DeepSeek Harness GUI', click: () => showAbout() },
        { label: '访问 GitHub', click: () => shell.openExternal('https://github.com/LiMCZJY/dsh-gui-client') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showAbout() {
  dialog.showMessageBox({
    type: 'info',
    title: '关于 DeepSeek Harness GUI',
    message: 'DeepSeek Harness GUI',
    detail: `版本：${app.getVersion()}\n桌面壳层：Electron ${process.versions.electron}\n\n将官方 dsh 网页端（127.0.0.1:3080）封装为原生桌面应用，\n附带系统托盘、全局快捷键、设置窗口等桌面独占功能。`,
    buttons: ['确定'],
  });
}

// ===== IPC =====
function registerAppHandlers() {
  ipcMain.on('app-minimize', () => mainWindow && !mainWindow.isDestroyed() && mainWindow.minimize());
  ipcMain.on('app-maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.on('app-close', () => mainWindow && !mainWindow.isDestroyed() && mainWindow.close());
  ipcMain.on('app-hide-to-tray', () => mainWindow && !mainWindow.isDestroyed() && mainWindow.hide());
  ipcMain.on('app-retry-web', () => startAndLoadWeb());
  ipcMain.handle('app-set-minimize-to-tray', async (event, enabled) => {
    minimizeToTray = !!enabled;
    try { await dshBridge.setGuiConfig({ minimizeToTray }); } catch {}
  });
  ipcMain.handle('app-reload-page', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(WEB_BASE);
  });

  // ---- 注入模块触发的桌面动作 ----
  ipcMain.on('inject-toggle-top', () => applyAlwaysOnTop(!alwaysOnTop));
  ipcMain.on('inject-open-settings', () => openSettings());
  ipcMain.on('inject-open-datadir', () => { try { shell.openPath(process.env.DSH_HOME || path.join(os.homedir(), '.dsh')); } catch {} });
  ipcMain.on('inject-hide-window', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); });
  ipcMain.on('inject-notify-task-done', (_e, payload) => {
    if (!payload) return;
    try {
      const n = new Notification({ title: payload.title || 'DeepSeek', body: payload.body || '' });
      n.on('click', () => showMainWindow());
      n.show();
    } catch {}
  });
  ipcMain.handle('inject-get-css', async () => {
    try { const cfg = await dshBridge.getGuiConfig(); return cfg.customCss || ''; } catch { return ''; }
  });
  // 设置页保存 CSS 后调用此主动推送更新到网页端
  ipcMain.handle('inject-push-css', async (_e, css) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.webContents.send('inject-css-update', css); } catch {}
    }
    return true;
  });
}

// ===== 应用入口 =====
app.whenReady().then(async () => {
  try {
    const cfg = await dshBridge.getGuiConfig();
    if (typeof cfg.minimizeToTray === 'boolean') minimizeToTray = cfg.minimizeToTray;
    if (typeof cfg.alwaysOnTop === 'boolean') alwaysOnTop = cfg.alwaysOnTop;
  } catch {}

  setupIPCHandlers(dshBridge);
  await createWindow();
  registerAppHandlers();
  createTray();
  rebuildMenu();
  await startAndLoadWeb();

  globalShortcut.register(HOTKEY, () => toggleMainWindow());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow().then(startAndLoadWeb);
    else toggleMainWindow();
  });
  app.on('second-instance', () => toggleMainWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  forceQuit = true;
  globalShortcut.unregisterAll();
  if (tray) { tray.destroy(); tray = null; }
  cleanupIPCHandlers();
  if (dshBridge) dshBridge.cleanup();
});
