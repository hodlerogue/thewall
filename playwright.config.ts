import { defineConfig, devices } from '@playwright/test'

/**
 * §4.4 / §8 — mobile is the kill condition, so the default project IS a phone.
 * 380x740 is the viewport the doc names.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    // The environment ships Chromium at a fixed path; never run
    // `playwright install` here.
    launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
  },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 380, height: 740 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
