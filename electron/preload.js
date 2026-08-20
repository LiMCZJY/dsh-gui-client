const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // DSH 相关
  dsh: {
    getVersion: () => ipcRenderer.invoke('dsh-get-version'),
    getProfiles: () => ipcRenderer.invoke('dsh-get-profiles'),
    startProfile: (profileName, args) => ipcRenderer.invoke('dsh-start-profile', profileName, args),
    stopProfile: () => ipcRenderer.invoke('dsh-stop-profile'),
    getConfig: (profileName) => ipcRenderer.invoke('dsh-get-config', profileName),
    saveConfig: (profileName, config) => ipcRenderer.invoke('dsh-save-config', profileName, config),
    managePlugin: (profileName, action, packageName) => ipcRenderer.invoke('dsh-manage-plugin', profileName, action, packageName),
    getPath: () => ipcRenderer.invoke('dsh-get-path'),
    setPath: (p) => ipcRenderer.invoke('dsh-set-path', p),
    startWeb: () => ipcRenderer.invoke('dsh-start-web'),
    testConnection: () => ipcRenderer.invoke('dsh-test-connection'),
    getVersionInfo: () => ipcRenderer.invoke('dsh-get-version-info'),
    retryWeb: () => ipcRenderer.send('app-retry-web'),
    onLog: (cb) => {
      const handler = (e, msg) => cb(msg);
      ipcRenderer.on('dsh-log', handler);
      return () => ipcRenderer.removeListener('dsh-log', handler);
    },
    onError: (cb) => {
      const handler = (e, msg) => cb(msg);
      ipcRenderer.on('dsh-error', handler);
      return () => ipcRenderer.removeListener('dsh-error', handler);
    },
    onExit: (cb) => {
      const handler = (e, code) => cb(code);
      ipcRenderer.on('dsh-exit', handler);
      return () => ipcRenderer.removeListener('dsh-exit', handler);
    },
  },

  // 系统相关
  system: {
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    selectFile: () => ipcRenderer.invoke('select-file'),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    readFile: (filePath) => ipcRenderer.invoke('system-read-file', filePath),
  },

  // GUI 配置
  gui: {
    getConfig: () => ipcRenderer.invoke('gui-get-config'),
    setConfig: (partial) => ipcRenderer.invoke('gui-set-config', partial),
  },

  // 应用控制（loading 页错误重试用）
  app: {
    platform: process.platform,
    version: process.env.npm_package_version || '1.0.0',
    onError: (cb) => {
      const handler = (e, msg) => cb(msg);
      ipcRenderer.on('app-error', handler);
      return () => ipcRenderer.removeListener('app-error', handler);
    },
  },

  // 通用 IPC（设置页等调用）
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});

// ---- 注入：仅在 dsh 网页端（127.0.0.1:3080）运行 ----
try {
  const loc = (window.location && window.location.href) || '';
  if (loc.indexOf('127.0.0.1:3080') !== -1) {
    const inject = require('./inject.js');
    // 等 DOM 就绪后再注入
    const boot = () => { try { inject.setup({ ipcRenderer, fetch }); } catch (e) { console.error('[inject] setup failed', e); } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
} catch (e) { /* 注入失败不影响页面 */ }
