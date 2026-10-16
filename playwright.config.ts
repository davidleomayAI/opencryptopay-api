import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
      PLACE_DB: join(tmpdir(), 'opencryptopay-e2e-map.sqlite'),
      OCP_PLACE_INGEST_TOKEN: 'e2e-ingest',
      BTCMAP_ACCESS_TOKEN: '',
      BTCMAP_SUBMIT_URL: '',
      DFX_SPAR_LOCATIONS_URL: 'off',
    },
  },
});
