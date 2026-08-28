import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { loadRootEnv, resolveEnvFilePaths } from './load-root-env';

describe('load-root-env', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aiecom-env-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('walks up from a nested dist folder to the repo .env', () => {
    const distQueues = join(root, 'apps', 'api', 'dist', 'queues');
    mkdirSync(distQueues, { recursive: true });
    writeFileSync(join(root, '.env'), 'CREDENTIAL_ENCRYPTION_KEY=from-repo-env\n', 'utf8');

    expect(resolveEnvFilePaths([distQueues, distQueues])).toContain(resolve(root, '.env'));
  });

  it('fills missing process.env keys from the walked .env', () => {
    const nested = join(root, 'apps', 'api', 'dist');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, '.env'), 'CREDENTIAL_ENCRYPTION_KEY=loaded-from-file\n', 'utf8');
    const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    try {
      loadRootEnv([nested]);
      expect(process.env.CREDENTIAL_ENCRYPTION_KEY).toBe('loaded-from-file');
    } finally {
      if (previous == null) {
        delete process.env.CREDENTIAL_ENCRYPTION_KEY;
      } else {
        process.env.CREDENTIAL_ENCRYPTION_KEY = previous;
      }
    }
  });
});
