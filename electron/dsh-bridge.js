const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const EventEmitter = require('events');

const WEB_PORT = 3080;
const WEB_BASE = `http://127.0.0.1:${WEB_PORT}`;
const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'json', 'js', 'ts', 'tsx', 'jsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'php',
  'html', 'htm', 'css', 'scss', 'less', 'yml', 'yaml', 'toml', 'ini', 'cfg',
  'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql', 'xml', 'csv', 'log', 'env',
  'gitignore', 'dockerfile', 'makefile', 'rst', 'tex', 'svg', 'vue', 'svelte',
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class DSHBridge extends EventEmitter {
  constructor() {
    super();
    this.dshPath = null;
    this.currentProcess = null;
    this.webProcess = null;
    this.configPath = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      const configDir = path.join(require('os').homedir(), '.dsh-gui');
      const configFile = path.join(configDir, 'config.json');
      try {
        const configData = await fs.readFile(configFile, 'utf8');
        const config = JSON.parse(configData);
        this.dshPath = config.dshPath;
      } catch (error) {
        this.dshPath = await this.findDSHPath();
      }
      await fs.mkdir(configDir, { recursive: true });
      this.configPath = configDir;
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize DSH Bridge:', error);
      throw error;
    }
  }

  async findDSHPath() {
    const possiblePaths = [
      path.join(process.env.USERPROFILE || process.env.HOME, 'AppData', 'Roaming', 'npm', 'node_modules', '@deepseek-ai', 'dsh'),
      path.join(process.env.USERPROFILE || process.env.HOME, '.npm-global', 'lib', 'node_modules', '@deepseek-ai', 'dsh'),
      '/usr/local/lib/node_modules/@deepseek-ai/dsh',
      '/usr/lib/node_modules/@deepseek-ai/dsh',
      path.join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh'),
      path.join(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh'),
      'D:\\job\\2026job\\AI\\dsh-build\\node_modules\\@deepseek-ai\\dsh',
    ];
    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        return p;
      } catch (error) {
        /* continue */
      }
    }
    return new Promise((resolve) => {
      exec('npm root -g', (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(path.join(stdout.trim(), '@deepseek-ai', 'dsh'));
      });
    });
  }

  async getDSHConfigDir() {
    const dshHome = await this.getDSHHome();
    return path.join(dshHome, 'config');
  }

  async getDSHHome() {
    if (process.env.DSH_HOME) return process.env.DSH_HOME;
    const defaultPath = path.join(require('os').homedir(), '.dsh');
    try {
      await fs.access(defaultPath);
      return defaultPath;
    } catch (error) {
      await fs.mkdir(defaultPath, { recursive: true });
      return defaultPath;
    }
  }

  async getDSHPath() {
    await this.initialize();
    return this.dshPath;
  }

  async setDSHPath(dshPath) {
    this.dshPath = dshPath;
    if (this.configPath) {
      const configFile = path.join(this.configPath, 'config.json');
      const config = await this.readGuiConfig();
      config.dshPath = dshPath;
      await fs.writeFile(configFile, JSON.stringify(config, null, 2));
    }
    return true;
  }

  async readGuiConfig() {
    await this.initialize();
    const configFile = path.join(this.configPath, 'config.json');
    try {
      return JSON.parse(await fs.readFile(configFile, 'utf8'));
    } catch {
      return {};
    }
  }

  async getGuiConfig() {
    return this.readGuiConfig();
  }

  async setGuiConfig(partial) {
    await this.initialize();
    const configFile = path.join(this.configPath, 'config.json');
    const config = await this.readGuiConfig();
    const merged = { ...config, ...partial };
    await fs.writeFile(configFile, JSON.stringify(merged, null, 2));
    return true;
  }

  async executeDSHCommand(args, options = {}) {
    await this.initialize();
    if (!this.dshPath) {
      throw new Error('DSH path not configured. Please set the DSH installation path in settings.');
    }
    const dshBin = path.join(this.dshPath, 'lib', 'bin.js');
    try {
      await fs.access(dshBin);
    } catch (error) {
      throw new Error(`DSH not found at: ${dshBin}`);
    }
    return new Promise((resolve, reject) => {
      const command = ['node', dshBin, ...args];
      const env = { ...process.env, ...options.env };
      const childProcess = spawn(command[0], command.slice(1), {
        cwd: options.cwd || process.cwd(),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
      let stdout = '';
      let stderr = '';
      childProcess.stdout.on('data', (data) => {
        const message = data.toString();
        stdout += message;
        this.emit('log', message);
      });
      childProcess.stderr.on('data', (data) => {
        const message = data.toString();
        stderr += message;
        this.emit('error', message);
      });
      childProcess.on('close', (code) => {
        this.emit('exit', code);
        if (code === 0) resolve({ stdout, stderr, code });
        else reject(new Error(`DSH command failed with code ${code}: ${stderr}`));
      });
      childProcess.on('error', (error) => reject(error));
      if (options.persistent) this.currentProcess = childProcess;
    });
  }

  async getVersion() {
    const result = await this.executeDSHCommand(['--version']);
    return result.stdout.trim();
  }

  async getProfiles() {
    try {
      const dshHome = await this.getDSHHome();
      const profilesDir = path.join(dshHome, 'profiles');
      try {
        await fs.access(profilesDir);
      } catch (error) {
        return [
          { name: 'web', description: 'Web 界面 Profile', status: 'available' },
          { name: 'headless', description: '无头模式 Profile', status: 'available' },
        ];
      }
      const entries = await fs.readdir(profilesDir, { withFileTypes: true });
      const profiles = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const profileDir = path.join(profilesDir, entry.name);
          const packageJsonPath = path.join(profileDir, 'package.json');
          try {
            const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
            profiles.push({
              name: entry.name,
              description: packageJson.description || `Profile: ${entry.name}`,
              version: packageJson.version,
              status: 'available',
            });
          } catch (error) {
            profiles.push({ name: entry.name, description: `Profile: ${entry.name}`, status: 'available' });
          }
        }
      }
      return profiles;
    } catch (error) {
      return [
        { name: 'web', description: 'Web 界面 Profile', status: 'available' },
        { name: 'headless', description: '无头模式 Profile', status: 'available' },
      ];
    }
  }

  async startProfile(profileName, args = []) {
    if (this.currentProcess) await this.stopProfile();
    const commandArgs = ['--profile', profileName, ...args];
    return this.executeDSHCommand(commandArgs, {
      persistent: true,
      env: { DSH_TELEMETRY_DISABLED: '1' },
    });
  }

  async stopProfile() {
    if (this.currentProcess) {
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
      return true;
    }
    return false;
  }

  async getConfig(profileName) {
    const dshHome = await this.getDSHHome();
    const profileDir = path.join(dshHome, 'profiles', profileName);
    try {
      const packageJsonPath = path.join(profileDir, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      const patchPath = path.join(profileDir, 'cordis.patch.yml');
      let patchContent = '';
      try {
        patchContent = await fs.readFile(patchPath, 'utf8');
      } catch (error) {
        /* no patch */
      }
      return { packageJson, patchContent, profileDir };
    } catch (error) {
      throw new Error(`Failed to load config for profile: ${profileName}`);
    }
  }

  async saveConfig(profileName, config) {
    const dshHome = await this.getDSHHome();
    const profileDir = path.join(dshHome, 'profiles', profileName);
    await fs.mkdir(profileDir, { recursive: true });
    if (config.packageJson) {
      const packageJsonPath = path.join(profileDir, 'package.json');
      await fs.writeFile(packageJsonPath, JSON.stringify(config.packageJson, null, 2));
    }
    if (config.patchContent !== undefined) {
      const patchPath = path.join(profileDir, 'cordis.patch.yml');
      await fs.writeFile(patchPath, config.patchContent);
    }
    return true;
  }

  async managePlugin(profileName, action, packageName) {
    const args = ['plugin', '--profile', profileName, action];
    if (packageName) args.push(packageName);
    return this.executeDSHCommand(args);
  }

  // ---- dsh web service ----

  async isWebRunning() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`${WEB_BASE}/api/session.list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'health', method: 'session.list', payload: {} }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  // 端口自愈：检测 3080 被谁占用，返回 { pid, occupied }
  async getPortOccupant() {
    try {
      const { execFile } = require('child_process');
      if (process.platform === 'win32') {
        const out = await new Promise((resolve, reject) => {
          execFile('netstat', ['-ano'], { windowsHide: true }, (err, stdout) => {
            if (err) reject(err); else resolve(stdout);
          });
        });
        const lines = out.split('\n');
        for (const line of lines) {
          if (/:3080\s/.test(line) && /LISTENING/.test(line)) {
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(pid)) return { pid, occupied: true };
          }
        }
        return { pid: null, occupied: false };
      }
      // macOS / Linux: lsof
      const { execFile: ef } = require('child_process');
      const out = await new Promise((resolve, reject) => {
        ef('lsof', ['-ti', ':3080'], { windowsHide: true }, (err, stdout) => {
          if (err) resolve(''); else resolve(stdout);
        });
      });
      const pid = parseInt((out || '').trim(), 10);
      if (!isNaN(pid)) return { pid, occupied: true };
      return { pid: null, occupied: false };
    } catch {
      return { pid: null, occupied: false };
    }
  }

  // 停止当前拉起的 dsh web 服务进程
  stopWeb() {
    if (this.webProcess && !this.webProcess.killed) {
      try {
        // 在 Windows 上用 taskkill 杀掉进程树（node 可能又 spawn 出子进程）
        if (process.platform === 'win32') {
          const { spawn: sp } = require('child_process');
          sp('taskkill', ['/pid', String(this.webProcess.pid), '/T', '/F'], { windowsHide: true });
        } else {
          this.webProcess.kill('SIGKILL');
        }
      } catch (e) {
        try { this.webProcess.kill('SIGKILL'); } catch {}
      }
      this.webProcess = null;
      return true;
    }
    return false;
  }

  async startWeb() {
    await this.initialize();
    // 自愈 1：若服务已在运行，直接复用
    if (await this.isWebRunning()) return { ok: true, alreadyRunning: true };
    if (!this.dshPath) {
      this.dshPath = await this.findDSHPath();
    }
    if (!this.dshPath) return { ok: false, message: '未找到 DSH 安装路径，请在设置中手动指定。' };
    const dshBin = path.join(this.dshPath, 'lib', 'bin.js');
    try {
      await fs.access(dshBin);
    } catch (error) {
      return { ok: false, message: `在 ${dshBin} 未找到 DSH，请在设置中手动指定正确路径。` };
    }
    // 自愈 2：端口被本应用残留进程占用 → 先清掉再启动
    const occ = await this.getPortOccupant();
    if (occ.occupied) {
      if (this.webProcess && !this.webProcess.killed && occ.pid === this.webProcess.pid) {
        this.stopWeb();
        await sleep(1000);
      } else if (occ.pid) {
        // 端口被其他进程占用（可能是上次异常残留的 dsh-web）
        try {
          const { spawn: sp } = require('child_process');
          if (process.platform === 'win32') {
            sp('taskkill', ['/pid', String(occ.pid), '/T', '/F'], { windowsHide: true });
          } else {
            process.kill(occ.pid, 'SIGKILL');
          }
          await sleep(1500);
        } catch (e) {
          return { ok: false, message: `端口 3080 被进程 PID ${occ.pid} 占用且无法清理，请手动结束该进程后重试。` };
        }
      }
    }
    // shell:false 直接 spawn node，便于退出时精准 kill 整个服务进程树（避免残留）
    const child = spawn('node', [dshBin, 'web'], {
      cwd: process.cwd(),
      env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    this.webProcess = child;
    child.stdout.on('data', (d) => this.emit('log', d.toString()));
    child.stderr.on('data', (d) => this.emit('error', d.toString()));
    child.on('close', (code) => this.emit('log', `[dsh-web] process exited with code ${code}`));
    child.on('error', (e) => this.emit('error', `[dsh-web] ${e.message}`));

    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      if (await this.isWebRunning()) return { ok: true };
    }
    return { ok: false, message: '等待 dsh web 服务启动超时（30s）。' };
  }

  // ---- file reading for drag/drop attach ----

  async readFile(filePath) {
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) return { ok: false, error: 'Not a file' };
      const isText = await this.isLikelyText(filePath);
      if (!isText) return { ok: false, error: 'Binary file not supported' };
      const content = await fs.readFile(filePath, 'utf8');
      return { ok: true, name: path.basename(filePath), content, size: stat.size, isText: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async isLikelyText(filePath) {
    const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
    if (TEXT_EXT.has(ext)) return true;
    try {
      const handle = await fs.open(filePath, 'r');
      const buf = Buffer.alloc(512);
      const { bytesRead } = await handle.read(buf, 0, 512, 0);
      await handle.close();
      if (bytesRead === 0) return true;
      let nonPrintable = 0;
      for (let i = 0; i < bytesRead; i++) {
        const b = buf[i];
        if (b === 0) return false; // NUL => binary
        if (b < 9 || (b > 13 && b < 32)) nonPrintable++;
      }
      return nonPrintable / bytesRead < 0.1;
    } catch {
      return false;
    }
  }

  getWebProcess() {
    return this.webProcess;
  }

  cleanup() {
    if (this.currentProcess) {
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
    }
    if (this.webProcess) {
      this.webProcess.kill('SIGTERM');
      this.webProcess = null;
    }
  }

  async getVersionInfo() {
    try {
      const version = await this.getVersion();
      const profiles = await this.getProfiles();
      const dshPath = await this.getDSHPath();
      return {
        version,
        profilesCount: profiles.length,
        dshPath,
        platform: process.platform,
        arch: process.arch,
      };
    } catch (error) {
      return {
        version: 'unknown',
        profilesCount: 0,
        dshPath: null,
        platform: process.platform,
        arch: process.arch,
        error: error.message,
      };
    }
  }

  async testConnection() {
    try {
      const version = await this.getVersion();
      return { success: true, version, message: 'DSH 连接成功' };
    } catch (error) {
      return { success: false, version: null, message: `DSH 连接失败: ${error.message}` };
    }
  }
}

module.exports = DSHBridge;
