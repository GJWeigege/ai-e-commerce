import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  FileWbCatalogStore,
  LayeredWbCatalogStore,
  MemoryWbCatalogStore,
  isWbCatalogFresh,
  loadCatalogValue,
  resetSharedWbCatalogStore,
} from '@aiecom/platform-core';

describe('WbCatalogStore', () => {
  afterEach(() => {
    resetSharedWbCatalogStore();
  });

  it('文件写入后换一个 store 实例仍能读到，供不同租户/店铺复用', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-catalog-'));
    try {
      const writer = new FileWbCatalogStore(dir, { sweepOnInit: false });
      await writer.write('directories', 'ru', { colors: [{ name: 'белый' }], vat: ['0'] });

      const reader = new FileWbCatalogStore(dir, { sweepOnInit: false });
      const hit = await reader.read<{ colors: Array<{ name: string }>; vat: string[] }>('directories', 'ru');
      expect(hit?.value.colors[0]?.name).toBe('белый');
      expect(hit?.value.vat).toEqual(['0']);
      expect(hit && isWbCatalogFresh(hit.at, 14 * 24 * 60 * 60 * 1000)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('过期条目不算命中', () => {
    expect(isWbCatalogFresh(Date.now() - 1000, 500)).toBe(false);
    expect(isWbCatalogFresh(Date.now() - 100, 500)).toBe(true);
  });

  it('分层存储：内存未命中时从文件回填，且不改文件时间戳', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-catalog-'));
    try {
      const memory = new MemoryWbCatalogStore();
      const file = new FileWbCatalogStore(dir, { sweepOnInit: false });
      const at = Date.now() - 60_000;
      await file.write('subject-meta', '123|ru', { brands: ['NoName'] }, at);

      const layered = new LayeredWbCatalogStore([memory, file]);
      const hit = await layered.read<{ brands: string[] }>('subject-meta', '123|ru');
      expect(hit?.value.brands).toEqual(['NoName']);
      expect(hit?.at).toBe(at);

      const memHit = await memory.read<{ brands: string[] }>('subject-meta', '123|ru');
      expect(memHit?.at).toBe(at);
      expect(memHit?.value.brands).toEqual(['NoName']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('并发 miss 只打一次上游', async () => {
    const memory = new MemoryWbCatalogStore();
    let loads = 0;
    const loader = async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { brands: ['Acme'] };
    };

    const [a, b] = await Promise.all([
      loadCatalogValue(memory, 'subject-meta', '9|ru', loader),
      loadCatalogValue(memory, 'subject-meta', '9|ru', loader),
    ]);
    expect(a.brands).toEqual(['Acme']);
    expect(b.brands).toEqual(['Acme']);
    expect(loads).toBe(1);

    await loadCatalogValue(memory, 'subject-meta', '9|ru', loader);
    expect(loads).toBe(1);
  });

  it('内存 LRU 淘汰冷检索，颜色目录不淘汰', async () => {
    const memory = new MemoryWbCatalogStore({ maxEntries: 3, maxBytes: 10 * 1024 * 1024 });
    await memory.write('directories', 'ru', { colors: [{ name: 'белый' }] });
    await memory.write('subject-search', 'q1', [{ subjectID: 1, subjectName: 'a' }]);
    await memory.write('subject-search', 'q2', [{ subjectID: 2, subjectName: 'b' }]);
    await memory.write('subject-search', 'q3', [{ subjectID: 3, subjectName: 'c' }]);
    await memory.write('subject-search', 'q4', [{ subjectID: 4, subjectName: 'd' }]);

    expect(await memory.read('directories', 'ru')).toBeTruthy();
    expect(await memory.read('subject-search', 'q1')).toBeNull();
    expect(await memory.read('subject-search', 'q4')).toBeTruthy();
    expect(memory.size).toBeLessThanOrEqual(3);
  });

  it('类目检索不落盘，避免按商品名无限涨文件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-catalog-'));
    try {
      const file = new FileWbCatalogStore(dir, { sweepOnInit: false });
      await file.write('subject-search', 'ru|подушка из лебяжьего пуха', [{ subjectID: 1, subjectName: 'Подушки' }]);
      expect(await file.read('subject-search', 'ru|подушка из лебяжьего пуха')).toBeNull();

      const memory = new MemoryWbCatalogStore();
      const layered = new LayeredWbCatalogStore([memory, file]);
      await layered.write('subject-search', 'ru|подушка', [{ subjectID: 1, subjectName: 'Подушки' }]);
      expect((await memory.read('subject-search', 'ru|подушка'))?.value).toEqual([
        { subjectID: 1, subjectName: 'Подушки' },
      ]);
      expect(await new FileWbCatalogStore(dir, { sweepOnInit: false }).read('subject-search', 'ru|подушка')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('单条超过体积上限不写盘', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-catalog-'));
    try {
      const file = new FileWbCatalogStore(dir, { sweepOnInit: false, maxValueBytes: 80 });
      await file.write('subject-brands', '1', Array.from({ length: 200 }, (_, i) => `Brand-${i}`));
      expect(await file.read('subject-brands', '1')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
