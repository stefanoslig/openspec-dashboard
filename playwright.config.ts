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
  webServer: [
    {
      command: 'dotnet run --project backend/OpenSpec.Api --no-launch-profile --no-build',
      env: { PORT: '4311', DASHBOARD_MODE: 'local' },
      url: 'http://127.0.0.1:4311',
      reuseExistingServer: false,
    },
    {
      command: 'dotnet run --project backend/OpenSpec.BrowserHost --no-launch-profile --no-build',
      url: 'http://127.0.0.1:4312',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
