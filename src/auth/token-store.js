import { Buffer } from 'node:buffer';
import { randomUUID as uuidV4 } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const JWT_ENV_VAR = 'ZAI_JWT';

export function defaultTokenPath() {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  return join(home, 'dsh-glm-web-search', 'token.json');
}

function readJwtSubject(token) {
  if (typeof token !== 'string') return undefined;
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    for (const key of ['user_id', 'sub']) {
      if (typeof claims?.[key] === 'string' && claims[key].trim().length > 0) {
        return claims[key].trim();
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

export class TokenStore {
  constructor(options = {}) {
    this.path = options.path ?? defaultTokenPath();
    this.envVar = options.envVar ?? JWT_ENV_VAR;
    this.env = options.env ?? process.env;
    this._cache = undefined;
  }

  read() {
    const fromEnv = this.env[this.envVar]?.trim();
    if (fromEnv) return fromEnv;

    if (this._cache) return this._cache;

    const stored = readJson(this.path);
    const token = typeof stored?.jwt === 'string' ? stored.jwt.trim() : '';
    if (token.length === 0) return undefined;
    this._cache = token;
    return token;
  }

  readUserId() {
    const fromToken = readJwtSubject(this.read());
    if (fromToken) return fromToken;
    const stored = readJson(this.path);
    return typeof stored?.userId === 'string' && stored.userId.trim().length > 0
      ? stored.userId.trim()
      : undefined;
  }

  describe() {
    const fromEnv = this.env[this.envVar]?.trim();
    if (fromEnv) return { configured: true, source: `environment (${this.envVar})` };

    const stored = readJson(this.path);
    if (typeof stored?.jwt === 'string' && stored.jwt.trim().length > 0) {
      return {
        configured: true,
        source: 'plugin store',
        ...(typeof stored.email === 'string' ? { email: stored.email } : {}),
        ...(Number.isFinite(stored.savedAt) ? { savedAt: stored.savedAt } : {}),
      };
    }
    return { configured: false };
  }

  deviceMid() {
    const stored = readJson(this.path);
    if (typeof stored?.deviceMid === 'string' && stored.deviceMid.trim().length > 0) {
      return stored.deviceMid.trim();
    }
    const generated = uuidV4();
    this.#write({ ...(stored ?? {}), deviceMid: generated, jwt: stored?.jwt });
    return generated;
  }

  #write(payload) {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
      chmodSync(this.path, 0o600);
    } catch {
    }
    this._cache = typeof payload.jwt === 'string' ? payload.jwt : undefined;
  }

  save(record) {
    const existing = readJson(this.path);
    const payload = {
      jwt: record.jwt,
      savedAt: Date.now(),
      ...(record.email ? { email: record.email } : {}),
      ...(record.userId ? { userId: record.userId } : {}),
      ...(typeof existing?.deviceMid === 'string' ? { deviceMid: existing.deviceMid } : {}),
    };
    this.#write(payload);
    return payload;
  }

  clear() {
    this._cache = undefined;
    const stored = readJson(this.path);
    if (typeof stored?.deviceMid !== 'string' || stored.deviceMid.trim().length === 0) {
      try {
        rmSync(this.path, { force: true });
      } catch {
      }
      return;
    }
    const { jwt, savedAt, email, userId, ...rest } = stored;
    this.#write(rest);
  }
}
