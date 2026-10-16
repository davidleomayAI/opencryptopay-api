import { defineConfig } from '@playwright/test';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dbPath = join(tmpdir(), 'opencryptopay-e2e-map.sqlite');
// Every run starts with an empty database; a leftover file would keep old rows.
rmSync(dbPath, { force: true });
rmSync(`${dbPath}-wal`, { force: true });
rmSync(`${dbPath}-shm`, { force: true });

/**
 * HTTP end-to-end tests against `bun src/index.ts`. No browser.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
  },
  webServer: {
    command: 'bun src/index.ts',
    url: 'http://127.0.0.1:3000/healthz',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
    env: {
      ...process.env,
      PORT: '3000',
      PLACE_DB: dbPath,
      OCP_PLACE_INGEST_TOKEN: 'e2e-ingest',
      BTCMAP_ACCESS_TOKEN: '',
      BTCMAP_SUBMIT_URL: '',
    },
  },
});
