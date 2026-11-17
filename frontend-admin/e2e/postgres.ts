import { spawnSync } from 'node:child_process';
import { expect } from '@playwright/test';

function query<T>(sql: string, values: Record<string, string> = {}): T {
  const databaseUrl = process.env.PLAYWRIGHT_DATABASE_URL;
  if (!databaseUrl) throw new Error('PLAYWRIGHT_DATABASE_URL must point to the marked test PostgreSQL database');
  const url = new URL(databaseUrl);
  if (url.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('Browser ledger checks require a local PostgreSQL connection');
  }
  const args = [
    '--no-psqlrc', '--no-password', '--quiet', '--tuples-only', '--no-align',
    '--set', 'ON_ERROR_STOP=1', ...Object.entries(values).flatMap(([key, value]) => ['--set', `${key}=${value}`]),
  ];
  const result = spawnSync('psql', args, {
    input: sql, encoding: 'utf8', timeout: 10_000,
    env: {
      ...process.env,
      PGHOST: url.hostname, PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
      PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=5000',
    },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`PostgreSQL browser verification failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout.trim()) as T;
}

export function assertMarkedPostgres() {
  const marker = process.env.INTEGRATION_DATABASE_MARKER;
  if (!marker || marker.length < 16) throw new Error('Missing integration database marker');
  expect(query(`
    SELECT json_build_object(
      'marked', m.token = :'marker',
      'nonSuperuser', NOT r.rolsuper,
      'readOnly', current_setting('transaction_read_only') = 'on',
      'postgres16', current_setting('server_version_num')::int BETWEEN 160000 AND 169999
    )
    FROM integration_guard.marker m JOIN pg_roles r ON r.rolname = current_user
    WHERE m.id = 1;
  `, { marker })).toEqual({ marked: true, nonSuperuser: true, readOnly: true, postgres16: true });
}

interface Ledger {
  room: { status: string; version: number };
  lease: { id: string; tenantId: string; status: string; leaseConfirmedBy: string | null };
  bills: Array<{ id: string; billType: string; amount: number; paidAmount: number; status: string; contractId: string; readingId: string | null }>;
  accounts: Array<{ id: string; tenantId: string; balanceCache: number }>;
  debits: Array<{ id: string; accountId: string; amount: number; relatedId: string }>;
  readings: Array<{ id: string; currentReading: number; settledAmount: number | null }>;
  moveIns: number;
  payments: number;
}

/** Query the actual recorded links and amounts independently of the browser's HTTP response. */
export function readLedger(room: string, contract: string, meter: string) {
  return query<Ledger>(`
    SELECT json_build_object(
      'room', (SELECT json_build_object('status', status, 'version', version) FROM rooms WHERE id = :'room'),
      'lease', (SELECT json_build_object('id', id, 'tenantId', "tenantId", 'status', status,
        'leaseConfirmedBy', "leaseConfirmedBy") FROM contracts WHERE id = :'contract'),
      'bills', COALESCE((SELECT json_agg(json_build_object('id', id, 'billType', "billType", 'amount', amount,
        'paidAmount', "paidAmount", 'status', status, 'contractId', "contractId", 'readingId', snapshot->>'readingId')
        ORDER BY "billType", id) FROM bills WHERE "contractId" = :'contract'), '[]'),
      'accounts', COALESCE((SELECT json_agg(row_to_json(a) ORDER BY a.id) FROM
        (SELECT id, "tenantId", "balanceCache" FROM prepay_accounts WHERE "roomId" = :'room') a), '[]'),
      'debits', COALESCE((SELECT json_agg(json_build_object('id', p.id, 'accountId', p."accountId",
        'amount', p.amount, 'relatedId', p."relatedId") ORDER BY p.id)
        FROM prepay_transactions p JOIN prepay_accounts a ON a.id = p."accountId"
        WHERE a."roomId" = :'room' AND p.type = 'DEDUCTION'), '[]'),
      'readings', COALESCE((SELECT json_agg(row_to_json(r) ORDER BY r."readingTime", r.id) FROM
        (SELECT id, "readingTime", "currentReading", "settledAmount" FROM meter_readings WHERE "meterId" = :'meter') r), '[]'),
      'moveIns', (SELECT count(*) FROM move_in_requests WHERE "contractId" = :'contract'),
      'payments', (SELECT count(*) FROM payment_records p JOIN bills b ON b.id = p."billId" WHERE b."contractId" = :'contract')
    );
  `, { room, contract, meter });
}

export function readBatch(batch: string) {
  return query<Array<{ targetId: string; state: string; attempts: number; result: { amount: number } | null }>>(`
    SELECT coalesce(json_agg(json_build_object('targetId', "targetId", 'state', state,
      'attempts', attempts, 'result', result) ORDER BY id), '[]')
    FROM periodic_charge_items WHERE "batchId" = :'batch';
  `, { batch });
}

export function readRuleEvidence(contract: string, meter: string) {
  return query<{
    policies: Array<{ id: string; version: number; collectionMode: string; rateCents: number }>;
    intervals: Array<{ id: string; contractId: string; tenantId: string; openingReadingId: string; closingReadingId: string }>;
    confirmations: number;
  }>(`
    SELECT json_build_object(
      'policies', coalesce((SELECT json_agg(row_to_json(p) ORDER BY version) FROM
        (SELECT id, version, "collectionMode", "rateCents" FROM utility_policy_versions WHERE "contractId" = :'contract') p), '[]'),
      'intervals', coalesce((SELECT json_agg(row_to_json(i) ORDER BY i.id) FROM
        (SELECT id, "contractId", "tenantId", "openingReadingId", "closingReadingId"
         FROM meter_responsibility_intervals WHERE "contractId" = :'contract' AND "meterId" = :'meter') i), '[]'),
      'confirmations', (SELECT count(*) FROM utility_rule_confirmations c
        JOIN meter_responsibility_intervals i ON c.result->>'responsibilityIntervalId' = i.id
        WHERE i."contractId" = :'contract' AND i."meterId" = :'meter')
    );
  `, { contract, meter });
}
