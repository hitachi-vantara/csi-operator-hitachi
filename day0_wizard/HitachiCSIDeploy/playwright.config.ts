import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testIgnore: ['live/**'],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  use: {
    baseURL: 'http://127.0.0.1:5173',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: ['live/**', 'mobile.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testMatch: 'mobile.spec.ts',
      use: {
        ...devices['iPhone 13'],
        // CI/WSL install Chromium only (`playwright install --with-deps chromium`); iPhone 13 still supplies ~390px viewport and touch UA.
        defaultBrowserType: 'chromium',
      },
    },
  ],
})
