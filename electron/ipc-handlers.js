const { ipcMain, dialog, shell } = require('electron');
const DSHBridge = require('./dsh-bridge');

// DSH Bridge 实例
let dshBridge = null;

// 初始化 IPC 处理器
function setupIPCHandlers(bridge) {
  dshBridge = bridge || new DSHBridge();
  
  // 注册所有 IPC 处理器
  registerDSHHandlers();
  registerSystemHandlers();
  registerDialogHandlers();
  registerGuiHandlers();
}

// 注册 DSH 相关处理器
function registerDSHHandlers() {
  // 获取 DSH 版本
  ipcMain.handle('dsh-get-version', async () => {
    try {
      return await dshBridge.getVersion();
    } catch (error) {
      return { error: error.message };
    }
  });

  // 获取 Profile 列表
  ipcMain.handle('dsh-get-profiles', async () => {
    try {
      return await dshBridge.getProfiles();
    } catch (error) {
      return { error: error.message };
    }
  });

  // 启动 Profile
  ipcMain.handle('dsh-start-profile', async (event, profileName, args = []) => {
    try {
      return await dshBridge.startProfile(profileName, args);
    } catch (error) {
      return { error: error.message };
    }
  });

  // 停止 Profile
  ipcMain.handle('dsh-stop-profile', async () => {
    try {
      return await dshBridge.stopProfile();
    } catch (error) {
      return { error: error.message };
    }
  });

  // 获取配置
  ipcMain.handle('dsh-get-config', async (event, profileName) => {
    try {
      return await dshBridge.getConfig(profileName);
    } catch (error) {
      return { error: error.message };
    }
  });

  // 保存配置
  ipcMain.handle('dsh-save-config', async (event, profileName, config) => {
    try {
      return await dshBridge.saveConfig(profileName, config);
    } catch (error) {
      return { error: error.message };
    }
  });

  // 管理插件
  ipcMain.handle('dsh-manage-plugin', async (event, profileName, action, packageName) => {
    try {
      return await dshBridge.managePlugin(profileName, action, packageName);
    } catch (error) {
      return { error: error.message };
    }
  });

  // 获取 DSH 路径
  ipcMain.handle('dsh-get-path', async () => {
    try {
      return await dshBridge.getDSHPath();
    } catch (error) {
      return { error: error.message };
    }
  });

  // 设置 DSH 路径
  ipcMain.handle('dsh-set-path', async (event, dshPath) => {
    try {
      return await dshBridge.setDSHPath(dshPath);
    } catch (error) {
      return { error: error.message };
    }
  });

  // 测试 DSH 连接
  ipcMain.handle('dsh-test-connection', async () => {
    try {
      return await dshBridge.testConnection();
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // 获取版本信息
  ipcMain.handle('dsh-get-version-info', async () => {
    try {
      return await dshBridge.getVersionInfo();
    } catch (error) {
      return { error: error.message };
    }
  });

  // 启动 dsh web 服务
  ipcMain.handle('dsh-start-web', async () => {
    try {
      return await dshBridge.startWeb();
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });

  // 停止 dsh web 服务
  ipcMain.handle('dsh-stop-web', async () => {
    try {
      const stopped = dshBridge.stopWeb();
      return { ok: true, stopped };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });

  // 重启 dsh web 服务
  ipcMain.handle('dsh-restart-web', async () => {
    try {
      dshBridge.stopWeb();
      await new Promise((r) => setTimeout(r, 800));
      return await dshBridge.startWeb();
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });

  // 重新探测 dsh 路径
  ipcMain.handle('dsh-find-path', async () => {
    try {
      const p = await dshBridge.findDSHPath();
      if (p) {
        await dshBridge.setDSHPath(p);
      }
      return { path: p };
    } catch (error) {
      return { path: null, error: error.message };
    }
  });

  // 查询 dsh web 服务是否在运行
  ipcMain.handle('dsh-web-status', async () => {
    try {
      return { running: await dshBridge.isWebRunning() };
    } catch (error) {
      return { running: false };
    }
  });
}

// 注册 GUI 配置 / 文件读取相关处理器
function registerGuiHandlers() {
  // 读取 GUI 配置
  ipcMain.handle('gui-get-config', async () => {
    try {
      return await dshBridge.getGuiConfig();
    } catch (error) {
      return {};
    }
  });

  // 写入 GUI 配置（部分更新）
  ipcMain.handle('gui-set-config', async (event, partial) => {
    try {
      return await dshBridge.setGuiConfig(partial || {});
    } catch (error) {
      return false;
    }
  });

  // 读取本地文件（用于拖拽 / 附件）
  ipcMain.handle('system-read-file', async (event, filePath) => {
    try {
      return await dshBridge.readFile(filePath);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

// 注册系统相关处理器
function registerSystemHandlers() {
  // 打开外部链接
  ipcMain.handle('open-external', async (event, url) => {
    await shell.openExternal(url);
  });

  // 获取系统信息
  ipcMain.handle('get-system-info', async () => {
    const os = require('os');
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      hostname: os.hostname(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      cpus: os.cpus().length
    };
  });

  // 获取应用版本
  ipcMain.handle('get-app-version', async () => {
    const { app } = require('electron');
    return app.getVersion();
  });
}

// 注册对话框处理器
function registerDialogHandlers() {
  // 选择文件夹
  ipcMain.handle('select-folder', async (event, options = {}) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: options.title || '选择文件夹',
      defaultPath: options.defaultPath
    });
    
    if (result.canceled) {
      return null;
    }
    
    return result.filePaths[0];
  });

  // 选择文件
  ipcMain.handle('select-file', async (event, options = {}) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: options.title || '选择文件',
      defaultPath: options.defaultPath,
      filters: options.filters || []
    });
    
    if (result.canceled) {
      return null;
    }
    
    return result.filePaths[0];
  });

  // 保存文件
  ipcMain.handle('save-file', async (event, options = {}) => {
    const result = await dialog.showSaveDialog({
      title: options.title || '保存文件',
      defaultPath: options.defaultPath,
      filters: options.filters || []
    });
    
    if (result.canceled) {
      return null;
    }
    
    return result.filePath;
  });

  // 显示消息框
  ipcMain.handle('show-message-box', async (event, options) => {
    const result = await dialog.showMessageBox({
      type: options.type || 'info',
      title: options.title || '消息',
      message: options.message,
      buttons: options.buttons || ['确定']
    });
    
    return result.response;
  });
}

// 清理资源
function cleanup() {
  if (dshBridge) {
    dshBridge.cleanup();
    dshBridge = null;
  }
}

module.exports = {
  setupIPCHandlers,
  cleanup
};
