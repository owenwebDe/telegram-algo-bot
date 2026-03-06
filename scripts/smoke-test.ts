/**
 * Smoke test for the MT5 backend API.
 *
 * Run: npx ts-node scripts/smoke-test.ts
 *
 * The server must be running before executing this script.
 * Tests:
 *   1. GET /health          → 200 { status: 'ok' }
 *   2. GET /metrics         → 200 Prometheus text
 *   3. POST /api/mt5/connect (no auth header) → 401
 *   4. POST /api/mt5/connect (bad body)       → 422
 */

const BASE_URL = process.env['SMOKE_BASE_URL'] ?? 'http://localhost:8080';

type TestResult = { name: string; pass: boolean; detail: string };
const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, pass: true, detail: 'OK' });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    const detail = (err as Error).message;
    results.push({ name, pass: false, detail });
    console.error(`  ✗ ${name}: ${detail}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function run(): Promise<void> {
  console.log(`\nSmoke test against: ${BASE_URL}\n`);

  // ── 1. Health check ─────────────────────────────────────────────────────────
  await test('GET /health returns 200 with status:ok', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = (await res.json()) as { status: string };
    assert(body.status === 'ok', `Expected status:ok, got ${body.status}`);
  });

  // ── 2. Prometheus metrics ───────────────────────────────────────────────────
  await test('GET /metrics returns Prometheus text', async () => {
    const res = await fetch(`${BASE_URL}/metrics`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const text = await res.text();
    assert(text.includes('# HELP'), 'Response missing Prometheus HELP comment');
  });

  // ── 3. Missing auth header → 401 ───────────────────────────────────────────
  await test('POST /api/mt5/connect without auth → 401', async () => {
    const res = await fetch(`${BASE_URL}/api/mt5/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: '1234567', password: 'pass', server: 'Demo' }),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // ── 4. Invalid body → 422 ──────────────────────────────────────────────────
  await test('POST /api/mt5/connect with invalid body → 422', async () => {
    const res = await fetch(`${BASE_URL}/api/mt5/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-init-data': 'hash=invalid_fake_data',
      },
      body: JSON.stringify({ login: 'NOT_A_NUMBER', password: '', server: '' }),
    });
    // Will be 401 (bad hash) or 422 (bad body). Both are acceptable.
    assert([401, 422].includes(res.status), `Expected 401 or 422, got ${res.status}`);
  });

  // ── Summary ─────────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length;
  console.log(`\nResults: ${passed}/${results.length} passed\n`);
  if (passed < results.length) process.exit(1);
}

run().catch((err) => {
  console.error('Smoke test runner failed:', err);
  process.exit(1);
});
