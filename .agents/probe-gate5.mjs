// GATE-5 live schema probe. Runs inside one transaction and rolls back, so the
// development database keeps no probe rows. Prints one line per check.
import pg from 'pg';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const results = [];
function note(name, ok, detail) {
  results.push({ name, ok, detail });
}

const tables = ['integration_endpoints', 'webhook_deliveries', 'ai_traces', 'ai_memories', 'retention_policies'];
const u = () => '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padStart(12, '0');

await client.connect();
try {
  await client.query('BEGIN');

  const t = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`,
    [tables],
  );
  const found = t.rows.map((r) => r.table_name);
  note('tables present', found.length === tables.length, found.sort().join(','));

  const cols = await client.query(
    `SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='knowledge_sources'
        AND column_name IN ('retention_days','expires_at')`,
  );
  note('knowledge_sources expiry columns', cols.rowCount === 2, JSON.stringify(cols.rows));

  const idx = await client.query(
    `SELECT i.relname AS name, ix.indisunique AS uniq
       FROM pg_index ix
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_class tb ON tb.oid = ix.indrelid
      WHERE tb.relname IN ('webhook_deliveries','integration_endpoints')
        AND i.relname IN ('webhook_deliveries_endpoint_id_delivery_id_key',
                          'integration_endpoints_tenant_id_provider_display_name_key')`,
  );
  note(
    'unique pairs',
    idx.rowCount === 2 && idx.rows.every((r) => r.uniq),
    JSON.stringify(idx.rows),
  );

  const endpointId = u();
  const tenantId = u();
  await client.query(
    `INSERT INTO integration_endpoints (id, tenant_id, provider, display_name, secret_ref, updated_at)
     VALUES ($1,$2,'probe','probe','WEBHOOK_SECRET_PROBE', now())`,
    [endpointId, tenantId],
  );
  await client.query(
    `INSERT INTO webhook_deliveries (id, endpoint_id, tenant_id, provider, delivery_id, payload_hash)
     VALUES ($1,$2,$3,'probe','evt_probe','hash_a')`,
    [u(), endpointId, tenantId],
  );

  let duplicateRejected = false;
  await client.query('SAVEPOINT dup');
  try {
    await client.query(
      `INSERT INTO webhook_deliveries (id, endpoint_id, tenant_id, provider, delivery_id, payload_hash)
       VALUES ($1,$2,$3,'probe','evt_probe','hash_b')`,
      [u(), endpointId, tenantId],
    );
  } catch (error) {
    duplicateRejected = error.code === '23505';
  }
  await client.query('ROLLBACK TO SAVEPOINT dup');
  note('second delivery for one id rejected (23505)', duplicateRejected, 'same id, different payload hash');

  const count = await client.query(
    `SELECT count(*)::int AS n FROM webhook_deliveries WHERE endpoint_id=$1`,
    [endpointId],
  );
  note('one row per delivery id', count.rows[0].n === 1, `rows=${count.rows[0].n}`);

  let checkRejected = false;
  await client.query('SAVEPOINT pol');
  try {
    await client.query(
      `INSERT INTO retention_policies (id, tenant_id, category, retention_days, updated_at)
       VALUES ($1,$2,'TRACES',5000, now())`,
      [u(), tenantId],
    );
  } catch (error) {
    checkRejected = error.code === '23514';
  }
  await client.query('ROLLBACK TO SAVEPOINT pol');
  note('retention window 5000 rejected (23514)', checkRejected, 'CHECK 1..3650');

  await client.query(
    `INSERT INTO retention_policies (id, tenant_id, category, retention_days, updated_at)
     VALUES ($1,$2,'TRACES',30, now())`,
    [u(), tenantId],
  );
  note('retention window 30 accepted', true, 'within 1..3650');

  let traceRejected = false;
  await client.query('SAVEPOINT tr');
  try {
    await client.query(
      `INSERT INTO ai_traces (id, tenant_id, correlation_id, provider, outcome, latency_ms)
       VALUES ($1,$2,'probe','probe','ok',1)`,
      [u(), tenantId],
    );
  } catch (error) {
    traceRejected = error.code === '23502' || error.code === '23514';
  }
  await client.query('ROLLBACK TO SAVEPOINT tr');
  note('ai_traces requires expires_at', traceRejected, 'NOT NULL enforced');
} finally {
  await client.query('ROLLBACK');
  await client.end();
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail}`);
}
console.log(`probe ${failed === 0 ? 'green' : 'has ' + failed + ' failure(s)'}`);
process.exit(failed === 0 ? 0 : 1);
