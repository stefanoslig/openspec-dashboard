import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4311',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  // Tests run the built package, so run `npm run build` first.
  webServer: {
    command: 'node dist/cli/main.js --demo --port 4311',
    url: 'http://127.0.0.1:4311',
    reuseExistingServer: false,
  },
});
