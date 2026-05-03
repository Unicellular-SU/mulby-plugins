import { join } from 'path';
import { existsSync, readdirSync } from 'fs';
import { env, platform } from 'process';
import { exec, ExecOptions } from 'child_process';
import { GetFiles, DeleteFiles } from './files';

declare const mulby: any;

interface Config {
  code: string;
  icon?: string;
  terminal?: string;
  command?: string;
  database?: string;
  timeout?: string;
  [key: string]: string | undefined;
}

function getAppDataPath(): string {
  if (platform === 'win32') {
    return env.APPDATA || join(env.USERPROFILE || '', 'AppData', 'Roaming');
  }
  if (platform === 'darwin') {
    return join(env.HOME || '', 'Library', 'Application Support');
  }
  return env.XDG_CONFIG_HOME || join(env.HOME || '', '.config');
}

function getVSCodeStoragePath(): string {
  const home = env.USERPROFILE || env.HOME;
  const sharedStorage = home
    ? join(home, '.vscode-shared', 'sharedStorage', 'state.vscdb')
    : '';
  if (sharedStorage && existsSync(sharedStorage)) {
    return sharedStorage;
  }
  return join(getAppDataPath(), 'Code', 'User', 'globalStorage', 'state.vscdb');
}

function newConfig(code: string): Config {
  const shells: Record<string, string> = {
    win32: '',
    darwin: 'zsh -l -c',
    linux: 'bash -l -c',
  };
  code = code.toLowerCase();
  const database =
    code === 'vsc' || code === 'vscode'
      ? getVSCodeStoragePath()
      : join(
          getAppDataPath(),
          code.charAt(0).toUpperCase() + code.slice(1),
          'User',
          'globalStorage',
          'state.vscdb'
        );
  return {
    code,
    icon: 'icon/icon.png',
    terminal: shells[platform as keyof typeof shells] || '',
    command: code,
    database,
    timeout: '3000',
  };
}

const CONFIG_PREFIX = 'config.';

async function getConfig(code: string): Promise<Config> {
  const config = newConfig(code);
  const saved = (await mulby.storage.get(CONFIG_PREFIX + code)) || {};
  for (const key of Object.keys(saved)) {
    const value = saved[key];
    if (value !== undefined && value !== '') {
      config[key] = value;
    }
  }
  return config;
}

async function saveConfig(config: Config) {
  await mulby.storage.set(CONFIG_PREFIX + config.code, config);
}

async function removeConfig(code: string) {
  await mulby.storage.remove(CONFIG_PREFIX + code);
}

async function listIDEConfigs(): Promise<Config[]> {
  const raw = await mulby.storage.keys();
  const keys: string[] = Array.isArray(raw) ? raw : [];
  const result: Config[] = [];
  for (const key of keys) {
    if (key.startsWith(CONFIG_PREFIX)) {
      result.push(await getConfig(key.substring(CONFIG_PREFIX.length)));
    }
  }
  return result;
}

async function registerIDEFeatures() {
  let configs = await listIDEConfigs();

  if (configs.length === 0) {
    const vscConfig = newConfig('vsc');
    vscConfig.command = 'code';
    vscConfig.database = getVSCodeStoragePath();
    await saveConfig(vscConfig);

    const cursorConfig = newConfig('cursor');
    cursorConfig.icon = 'icon/cursor.png';
    await saveConfig(cursorConfig);

    configs = [vscConfig, cursorConfig];
  }

  for (const config of configs) {
    await registerIDEFeature(config);
  }
}

async function registerIDEFeature(config: Config) {
  await mulby.features.setFeature({
    code: config.code,
    explain: `搜索 ${config.code} 历史项目`,
    icon: config.icon || 'icon/icon.png',
    mode: 'ui',
    route: `search?code=${config.code}`,
    cmds: [config.code],
  });
  await mulby.features.setFeature({
    code: `${config.code}-setting`,
    explain: `${config.code} 设置`,
    icon: config.icon || 'icon/icon.png',
    mode: 'ui',
    route: `settings?code=${config.code}`,
    cmds: [`${config.code}-setting`],
  });
}

async function removeIDEFeatures(code: string) {
  try { await mulby.features.removeFeature(`${code}-setting`); } catch { /* ok */ }
  try { await mulby.features.removeFeature(code); } catch { /* ok */ }
}

function execCmd(
  command: string,
  options: { encoding: BufferEncoding } & ExecOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, options, (err, stdout, stderr) => {
      if (err) return reject(new Error(err.message + stdout));
      if (stderr) return reject(new Error(stderr + stdout));
      resolve(stdout);
    });
  });
}

function getShellEnv(shellCmd: string): Record<string, string> {
  if (platform === 'win32') return { ...process.env } as Record<string, string>;

  const shellBin = shellCmd.split(' ')[0] || process.env.SHELL || '/bin/bash';
  try {
    const { execSync } = require('child_process');
    const envStr = execSync(`${shellBin} -i -c "env"`, {
      encoding: 'utf-8',
      timeout: 3000,
    }).toString();

    const result: Record<string, string> = { ...process.env } as Record<string, string>;
    envStr.split('\n').forEach((line: string) => {
      const idx = line.indexOf('=');
      if (idx > 0 && idx < line.length - 1) {
        result[line.substring(0, idx)] = line.substring(idx + 1);
      }
    });
    return result;
  } catch {
    return { ...process.env } as Record<string, string>;
  }
}

export async function onLoad() {
  await registerIDEFeatures();
}

export const rpc = {
  async search(code: string, keyword?: string) {
    const config = await getConfig(code);
    if (!config.database) {
      return { error: '未配置数据库路径，请打开对应 IDE 设置重新保存配置' };
    }
    try {
      const files = await GetFiles(config.database);
      let results = files;
      if (keyword) {
        keyword
          .split(/\s+/g)
          .filter(Boolean)
          .forEach((kw) => {
            results = results.filter((file: string) =>
              decodeURIComponent(file).toLowerCase().includes(kw.toLowerCase())
            );
          });
      }
      const { basename, extname } = require('path');
      return {
        files: results.map((file: string) => {
          const name = basename(decodeURIComponent(file));
          const ext = file.includes('remote') ? '.remote' : extname(file);
          return { path: file, name, ext };
        }),
      };
    } catch (error: any) {
      return { error: error.message };
    }
  },

  async open(code: string, filePath: string) {
    const config = await getConfig(code);
    let cmd = config.command;
    if (cmd.includes(' ')) cmd = `"${cmd}"`;

    const isWorkspace = filePath.includes('.code-workspace');
    const uriFlag = isWorkspace ? '--file-uri' : '--folder-uri';
    const fullCmd = `${cmd} ${uriFlag} "${filePath}"`;

    const timeout = Math.max(parseInt(config.timeout || '3000'), 3000);

    try {
      let command: string;
      if (config.terminal && platform !== 'win32') {
        command = `${config.terminal} "env; ${fullCmd}"`;
      } else {
        command = fullCmd;
      }

      const shellEnv = config.terminal
        ? getShellEnv(config.terminal)
        : { ...process.env };

      await execCmd(command, {
        timeout,
        windowsHide: true,
        encoding: 'utf-8',
        env: shellEnv as any,
      });
      return { success: true };
    } catch (error: any) {
      return { error: error.message };
    }
  },

  async deleteFromHistory(code: string, filePath: string) {
    const config = await getConfig(code);
    if (!config.database) {
      return { error: '未配置数据库路径' };
    }
    try {
      const success = await DeleteFiles(config.database, filePath);
      return { success };
    } catch (error: any) {
      return { error: error.message };
    }
  },

  async getConfig(code: string) {
    return getConfig(code);
  },

  async saveConfig(config: Config) {
    await removeIDEFeatures(config.code);
    await saveConfig(config);
    await registerIDEFeature(config);
    return { success: true };
  },

  async addIDE(code: string) {
    code = code.trim().toLowerCase();
    if (!code) return { error: 'IDE 名称不能为空' };
    const config = newConfig(code);
    await saveConfig(config);
    await registerIDEFeature(config);
    return { success: true, code };
  },

  async removeIDE(code: string) {
    const configs = await listIDEConfigs();
    if (configs.length <= 1) {
      return { error: '至少需要保留一个 IDE' };
    }
    await removeIDEFeatures(code);
    await removeConfig(code);
    return { success: true };
  },

  async getIDEs() {
    const configs = await listIDEConfigs();
    return configs.map((c) => ({
      code: c.code,
      icon: c.icon || 'icon/icon.png',
      command: c.command,
      database: c.database,
    }));
  },

  async getIconExt(ext: string) {
    try {
      const iconCandidates = [join(__dirname, 'dist/icon'), join(__dirname, 'icon')];
      let iconDir = iconCandidates[0];
      for (const dir of iconCandidates) {
        if (existsSync(dir)) { iconDir = dir; break; }
      }
      const icons = readdirSync(iconDir);
      const icon = icons.find((f) => '.' + f.split('.')[0] === ext.toLowerCase());
      if (!icon && !ext) return 'icon/folder.svg';
      if (!icon && ext) return 'icon/file.svg';
      return `icon/${icon}`;
    } catch {
      return 'icon/file.svg';
    }
  },

  async hideWindow() {
    try {
      await mulby.window.hide();
    } catch {
      // ignore
    }
  },
};

export default { onLoad, rpc };
