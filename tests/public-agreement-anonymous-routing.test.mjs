import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { NextRequest } from 'next/server.js';

const compiled = await build({
  entryPoints: ['lib/supabase/proxy.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['next/server'],
  plugins: [{ name: 'anonymous-session', setup(builder) {
    builder.onResolve({ filter: /^@supabase\/ssr$/ }, () => ({ path: 'anonymous', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const createServerClient = () => ({ auth: { getClaims: async () => ({data: null, error: null}) } });' }));
  }}],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { updateSession } = module.exports;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test';

test('anonymous agreement submission reaches token-authorized handler', async () => {
  const response = await updateSession(new NextRequest('https://app.studioscrubz.com/api/public/agreements/accept', { method: 'POST' }));
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('x-middleware-next'), '1');
});
for (const path of ['/agreements', '/api/agreements', '/api/public/agreements/admin', '/api/public/agreements/accept/extra']) {
  test(`anonymous internal route stays protected: ${path}`, async () => {
    const response = await updateSession(new NextRequest(`https://app.studioscrubz.com${path}`));
    assert.equal(new URL(response.headers.get('location')).pathname, '/login');
  });
}
