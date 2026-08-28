import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';

const WALK_DEPTH = 8;

function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** 从 dist/src/cwd 向上查找仓库根 .env，兼容 nest start --watch 的编译目录 */
export function resolveEnvFilePaths(starts: string[] = [__dirname, process.cwd()]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const start of starts) {
    let dir = resolve(start);
    for (let i = 0; i < WALK_DEPTH; i += 1) {
      const candidate = resolve(dir, '.env');
      if (!seen.has(candidate)) {
        seen.add(candidate);
        if (existsSync(candidate)) {
          found.push(candidate);
        }
      }
      const parent = dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  return found;
}

/** 把尚未注入 process.env 的键从仓库 .env 补上（不覆盖已有非空值） */
export function loadRootEnv(starts?: string[]): void {
  for (const file of resolveEnvFilePaths(starts)) {
    const parsed = parseEnvFile(readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] == null || process.env[key] === '') {
        process.env[key] = value;
      }
    }
  }
}
