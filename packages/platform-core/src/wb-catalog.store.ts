import { createHash } from 'crypto';
import { existsSync, mkdirSync, promises as fs } from 'fs';
import { dirname, resolve } from 'path';

export type WbCatalogKind =
  | 'directories'
  | 'subject-meta'
  | 'subject-brands'
  | 'subject-search'
  | 'parent-subjects'
  | 'subjects-by-parent';

export type WbCatalogEntry<T> = {
  at: number;
  value: T;
};

/** 无租户隔离：WB 官方目录对所有店铺相同，全平台共用一份 */
export interface WbCatalogStore {
  read<T>(kind: WbCatalogKind, key: string): Promise<WbCatalogEntry<T> | null>;
  write<T>(kind: WbCatalogKind, key: string, value: T, at?: number): Promise<void>;
  clear?(): void | Promise<void>;
}

export const WB_CATALOG_TTL = {
  directories: 14 * 24 * 60 * 60 * 1000,
  subjectMeta: 14 * 24 * 60 * 60 * 1000,
  search: 7 * 24 * 60 * 60 * 1000,
  parentSubjects: 14 * 24 * 60 * 60 * 1000,
};

/** 类目检索按商品名散落，落盘会无限涨；只留内存 LRU */
export const WB_CATALOG_DISK_KINDS: readonly WbCatalogKind[] = [
  'directories',
  'subject-meta',
  'subject-brands',
  'parent-subjects',
  'subjects-by-parent',
];

export const WB_CATALOG_MEMORY_DEFAULTS = {
  maxEntries: 600,
  maxBytes: 48 * 1024 * 1024,
};

/** 单条落盘上限，避免某个类目品牌表把磁盘和 JSON.parse 打爆 */
export const WB_CATALOG_MAX_FILE_BYTES = 1.5 * 1024 * 1024;

export function isWbCatalogFresh(at: number, ttlMs: number): boolean {
  return Date.now() - at < ttlMs;
}

export function estimateCatalogBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return 256;
  }
}

function envPositiveInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export type MemoryWbCatalogStoreOptions = {
  maxEntries?: number;
  maxBytes?: number;
};

type MemoryRecord = WbCatalogEntry<unknown> & { bytes: number };

/**
 * 有上限的 LRU。品类多了以后不能把所有检索词、品牌表常驻堆上。
 * 颜色/父类目很小且每单都用，不参与淘汰。
 */
export class MemoryWbCatalogStore implements WbCatalogStore {
  private readonly data = new Map<string, MemoryRecord>();
  private bytes = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(options: MemoryWbCatalogStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? envPositiveInt('WB_CATALOG_MEMORY_MAX_ENTRIES', WB_CATALOG_MEMORY_DEFAULTS.maxEntries);
    this.maxBytes = options.maxBytes ?? envPositiveInt('WB_CATALOG_MEMORY_MAX_MB', 48) * 1024 * 1024;
  }

  get size(): number {
    return this.data.size;
  }

  get byteSize(): number {
    return this.bytes;
  }

  async read<T>(kind: WbCatalogKind, key: string): Promise<WbCatalogEntry<T> | null> {
    const id = compositeKey(kind, key);
    const hit = this.data.get(id);
    if (!hit) {
      return null;
    }
    this.data.delete(id);
    this.data.set(id, hit);
    return { at: hit.at, value: hit.value as T };
  }

  async write<T>(kind: WbCatalogKind, key: string, value: T, at = Date.now()): Promise<void> {
    const id = compositeKey(kind, key);
    const bytes = Math.max(64, estimateCatalogBytes(value));
    const prev = this.data.get(id);
    if (prev) {
      this.bytes -= prev.bytes;
    }
    this.data.delete(id);
    this.data.set(id, { at, value, bytes });
    this.bytes += bytes;
    this.evict();
  }

  clear(): void {
    this.data.clear();
    this.bytes = 0;
  }

  private evict(): void {
    if (this.data.size <= this.maxEntries && this.bytes <= this.maxBytes) {
      return;
    }
    for (const [id, record] of this.data) {
      if (this.data.size <= this.maxEntries && this.bytes <= this.maxBytes) {
        return;
      }
      const kind = id.slice(0, id.indexOf('|')) as WbCatalogKind;
      if (kind === 'directories' || kind === 'parent-subjects') {
        continue;
      }
      this.data.delete(id);
      this.bytes -= record.bytes;
    }
  }
}

export type FileWbCatalogStoreOptions = {
  persistKinds?: readonly WbCatalogKind[];
  maxValueBytes?: number;
  sweepOnInit?: boolean;
};

/**
 * 落在项目 `config/wb-catalog` 的 JSON。
 * 只持久化有上界的官方目录；检索词不写盘。
 */
export class FileWbCatalogStore implements WbCatalogStore {
  private readonly persistKinds: ReadonlySet<WbCatalogKind>;
  private readonly maxValueBytes: number;

  constructor(
    private readonly rootDir: string,
    options: FileWbCatalogStoreOptions = {},
  ) {
    this.persistKinds = new Set(options.persistKinds ?? WB_CATALOG_DISK_KINDS);
    this.maxValueBytes = options.maxValueBytes ?? WB_CATALOG_MAX_FILE_BYTES;
    if (options.sweepOnInit !== false) {
      void this.sweepExpired();
    }
  }

  async read<T>(kind: WbCatalogKind, key: string): Promise<WbCatalogEntry<T> | null> {
    if (!this.persistKinds.has(kind)) {
      return null;
    }
    const file = this.filePath(kind, key);
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as WbCatalogEntry<T>;
      if (!parsed || typeof parsed.at !== 'number') {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async write<T>(kind: WbCatalogKind, key: string, value: T, at = Date.now()): Promise<void> {
    if (!this.persistKinds.has(kind)) {
      return;
    }
    const bytes = estimateCatalogBytes(value);
    if (bytes > this.maxValueBytes) {
      return;
    }
    const file = this.filePath(kind, key);
    mkdirSync(dirname(file), { recursive: true });
    const payload = JSON.stringify({ at, value } satisfies WbCatalogEntry<T>);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, payload);
    try {
      await fs.rename(tmp, file);
    } catch {
      await fs.writeFile(file, payload);
      await fs.unlink(tmp).catch(() => undefined);
    }
  }

  async sweepExpired(): Promise<number> {
    let removed = 0;
    await Promise.all(
      [...this.persistKinds].map(async (kind) => {
        const dir = resolve(this.rootDir, kind);
        let names: string[];
        try {
          names = await fs.readdir(dir);
        } catch {
          return;
        }
        const ttl = wbCatalogTtlMs(kind);
        await Promise.all(
          names.map(async (name) => {
            if (!name.endsWith('.json')) {
              return;
            }
            const file = resolve(dir, name);
            try {
              const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as { at?: number };
              if (typeof parsed.at !== 'number' || !isWbCatalogFresh(parsed.at, ttl)) {
                await fs.unlink(file);
                removed += 1;
              }
            } catch {
              /* 坏文件留给下次覆盖 */
            }
          }),
        );
      }),
    );
    return removed;
  }

  private filePath(kind: WbCatalogKind, key: string): string {
    const hash = createHash('sha1').update(`${kind}\0${key}`).digest('hex').slice(0, 12);
    const safe = key.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'key';
    return resolve(this.rootDir, kind, `${safe}-${hash}.json`);
  }
}

/** 先读内存，再读持久层；写入时两层都写，并回填内存 */
export class LayeredWbCatalogStore implements WbCatalogStore {
  constructor(private readonly layers: WbCatalogStore[]) {}

  async read<T>(kind: WbCatalogKind, key: string): Promise<WbCatalogEntry<T> | null> {
    const loaded: WbCatalogStore[] = [];
    for (const layer of this.layers) {
      const hit = await layer.read<T>(kind, key);
      if (hit) {
        await Promise.all(loaded.map((upper) => upper.write(kind, key, hit.value, hit.at).catch(() => undefined)));
        return hit;
      }
      loaded.push(layer);
    }
    return null;
  }

  async write<T>(kind: WbCatalogKind, key: string, value: T, at = Date.now()): Promise<void> {
    await Promise.all(this.layers.map((layer) => layer.write(kind, key, value, at).catch(() => undefined)));
  }

  async clear(): Promise<void> {
    await Promise.all(this.layers.map((layer) => Promise.resolve(layer.clear?.()).catch(() => undefined)));
  }
}

export async function readFreshCatalog<T>(
  store: WbCatalogStore | undefined,
  kind: WbCatalogKind,
  key: string,
  ttlMs: number,
): Promise<T | null> {
  if (!store) {
    return null;
  }
  const hit = await store.read<T>(kind, key);
  if (!hit || !isWbCatalogFresh(hit.at, ttlMs)) {
    return null;
  }
  return hit.value;
}

export async function writeCatalog<T>(
  store: WbCatalogStore | undefined,
  kind: WbCatalogKind,
  key: string,
  value: T,
): Promise<void> {
  if (!store) {
    return;
  }
  await store.write(kind, key, value);
}

const inflightLoads = new Map<string, Promise<unknown>>();

export function wbCatalogTtlMs(kind: WbCatalogKind): number {
  const days = Number(process.env.WB_CATALOG_TTL_DAYS);
  if (Number.isFinite(days) && days > 0) {
    return Math.max(1, Math.floor(days)) * 24 * 60 * 60 * 1000;
  }
  if (kind === 'subject-search') {
    return WB_CATALOG_TTL.search;
  }
  if (kind === 'directories') {
    return WB_CATALOG_TTL.directories;
  }
  return WB_CATALOG_TTL.subjectMeta;
}

/** 读共享缓存；未命中则只拉一次，并发调用合并为同一请求 */
export async function loadCatalogValue<T>(
  store: WbCatalogStore | undefined,
  kind: WbCatalogKind,
  key: string,
  loader: () => Promise<T>,
  ttlMs = wbCatalogTtlMs(kind),
): Promise<T> {
  const cached = await readFreshCatalog<T>(store, kind, key, ttlMs);
  if (cached !== null) {
    return cached;
  }
  const lock = `${kind}|${key}`;
  const pending = inflightLoads.get(lock);
  if (pending) {
    return pending as Promise<T>;
  }
  const promise = (async () => {
    const again = await readFreshCatalog<T>(store, kind, key, ttlMs);
    if (again !== null) {
      return again;
    }
    const value = await loader();
    await writeCatalog(store, kind, key, value);
    return value;
  })().finally(() => {
    inflightLoads.delete(lock);
  });
  inflightLoads.set(lock, promise);
  return promise;
}

export function resolveWbCatalogDir(starts: string[] = [process.cwd()]): string {
  const override = process.env.WB_CATALOG_DIR?.trim();
  if (override) {
    return resolve(override);
  }
  for (const start of starts) {
    let dir = resolve(start);
    for (let i = 0; i < 8; i += 1) {
      if (existsSync(resolve(dir, 'prisma', 'schema.prisma')) || existsSync(resolve(dir, 'pnpm-workspace.yaml'))) {
        return resolve(dir, 'config', 'wb-catalog');
      }
      const parent = dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  return resolve(process.cwd(), 'config', 'wb-catalog');
}

function createMemorySingleton(): MemoryWbCatalogStore {
  return new MemoryWbCatalogStore();
}

let memorySingleton = createMemorySingleton();
let sharedStore: LayeredWbCatalogStore | null = null;

/** 全进程共用：内存 LRU + 项目目录。所有租户/店铺/适配器实例读同一份 */
export function sharedWbCatalogStore(fileDir?: string): LayeredWbCatalogStore {
  if (!sharedStore) {
    sharedStore = new LayeredWbCatalogStore([
      memorySingleton,
      new FileWbCatalogStore(fileDir || resolveWbCatalogDir()),
    ]);
  }
  return sharedStore;
}

export function resetSharedWbCatalogStore(): void {
  memorySingleton.clear();
  memorySingleton = createMemorySingleton();
  inflightLoads.clear();
  sharedStore = null;
}

function compositeKey(kind: WbCatalogKind, key: string): string {
  return `${kind}|${key}`;
}
