import { spawn } from 'node:child_process';

export const BROWSER_OPEN_ENV = 'ZAI_BROWSER_OPEN';

export function browserOpenEnabled(env = process.env) {
  const value = env[BROWSER_OPEN_ENV];
  if (value === undefined || value.trim().length === 0) return true;
  const normalized = value.trim().toLowerCase();
  return normalized !== '0' && normalized !== 'false' && normalized !== 'off' && normalized !== 'no';
}

export function openerArgs(platform, url) {
  if (platform === 'win32') {
    return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  }
  if (platform === 'darwin') return ['open', [url]];
  return ['xdg-open', [url]];
}

export function openBrowser(url, deps = {}) {
  if (!browserOpenEnabled(deps.env)) return Promise.resolve(false);

  const platform = deps.platform ?? process.platform;
  const spawnImpl = deps.spawnImpl ?? spawn;
  const [command, args] = openerArgs(platform, url);

  return new Promise((resolve) => {
    try {
      const child = spawnImpl(command, args, { detached: true, stdio: 'ignore' });
      child.on?.('error', () => resolve(false));
      child.unref?.();
      setTimeout(() => resolve(true), 250);
    } catch {
      resolve(false);
    }
  });
}
