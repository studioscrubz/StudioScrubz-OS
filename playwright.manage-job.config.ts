import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', testMatch: 'manage-job.spec.ts', fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:4179', screenshot: 'only-on-failure' },
  webServer: { command: 'node tests/ui/manage-job-server.mjs', url: 'http://127.0.0.1:4179', reuseExistingServer: !process.env.CI },
  projects: [{name:'desktop',use:{viewport:{width:1280,height:900}}},{name:'mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}},{name:'small-mobile',use:{viewport:{width:320,height:740},isMobile:true,hasTouch:true}}],
});
