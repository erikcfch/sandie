import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    // Chromium's WebGPU support depends on a real (or software) GPU adapter
    // being reachable, which isn't guaranteed on every host (e.g. some
    // headless/VM/RDP setups have none) - --enable-unsafe-webgpu is the most
    // it's worth asking for here, since the app itself already degrades
    // gracefully (see WebGPUUnsupportedError in src/webgpu/simulation.ts)
    // when no adapter is available.
    launchOptions: {
      args: ['--enable-unsafe-webgpu'],
    },
  },
  // Starts the dev server for the test run rather than relying on one
  // already being up - reuseExistingServer is local-only so CI always
  // exercises a fresh server instead of silently reusing stale state.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
