/**
 * @file executionIndexSchema.js
 * @description Forge SQL schema for the execution index (Opción A, fase 0).
 *
 * IMPORTANT: Forge SQL is NOT the source of truth. Every execution lives in its Jira
 * Test Run issue (`testpulse-run-data` property, attachments, comments). These tables are
 * an index that can be emptied and rebuilt from Jira at any time. Phase 0 only creates
 * the schema; nothing writes to it yet (dual writes start in phase 1).
 *
 * Migrations are applied by `migrationRunner`, which records each applied migration name
 * in its own table, so running them again is a no-op. They run from the
 * `avi:forge:installed:app` / `avi:forge:upgraded:app` trigger and, as a safety net, the
 * first time the health resolver is called on an instance.
 */

import { migrationRunner, sql } from '@forge/sql';

/**
 * Ordered list of migrations. NEVER edit or reorder an entry that has shipped:
 * add a new entry (v004_…) instead, because applied names are remembered per installation.
 */
export const EXECUTION_INDEX_MIGRATIONS = [
  [
    'v001_create_executions',
    `CREATE TABLE IF NOT EXISTS executions (
      run_issue_id     VARCHAR(20)  NOT NULL PRIMARY KEY,
      run_key          VARCHAR(40)  NOT NULL,
      project_id       VARCHAR(20)  NOT NULL,
      cycle_id         VARCHAR(20)  NOT NULL,
      test_case_id     VARCHAR(20)  NOT NULL,
      test_case_key    VARCHAR(40),
      status           VARCHAR(20)  NOT NULL,
      execution_type   VARCHAR(20),
      environment      VARCHAR(80),
      executed_by      VARCHAR(128),
      executed_at      DATETIME(3),
      assignee         VARCHAR(128),
      bug_count        INT NOT NULL DEFAULT 0,
      evidence_count   INT NOT NULL DEFAULT 0,
      jira_updated_at  DATETIME(3)  NOT NULL,
      indexed_at       DATETIME(3)  NOT NULL,
      INDEX idx_cycle_status (cycle_id, status),
      INDEX idx_case_time (test_case_id, executed_at),
      INDEX idx_project_time (project_id, executed_at)
    )`
  ],
  [
    'v002_create_execution_events',
    `CREATE TABLE IF NOT EXISTS execution_events (
      id            BIGINT AUTO_INCREMENT PRIMARY KEY,
      run_issue_id  VARCHAR(20) NOT NULL,
      test_case_id  VARCHAR(20) NOT NULL,
      cycle_id      VARCHAR(20) NOT NULL,
      project_id    VARCHAR(20) NOT NULL,
      status        VARCHAR(20) NOT NULL,
      executed_by   VARCHAR(128),
      executed_at   DATETIME(3) NOT NULL,
      INDEX idx_case_time (test_case_id, executed_at),
      INDEX idx_run (run_issue_id)
    )`
  ],
  [
    'v003_create_index_state',
    `CREATE TABLE IF NOT EXISTS index_state (
      project_id         VARCHAR(20) NOT NULL PRIMARY KEY,
      status             VARCHAR(20) NOT NULL,
      rebuild_cursor     VARCHAR(255),
      last_rebuild_at    DATETIME(3),
      last_reconcile_at  DATETIME(3)
    )`
  ]
];

export const EXECUTION_INDEX_TABLES = ['executions', 'execution_events', 'index_state'];

// One migration run per warm instance: `migrationRunner` is a shared singleton, so
// enqueuing the same names twice in one process must be avoided.
let _migrationPromise = null;

/**
 * Applies any pending migration. Safe to call many times.
 *
 * @returns {Promise<string[]>} Names of the migrations applied by this call (empty when up to date).
 */
export function applyExecutionIndexMigrations() {
  if (!_migrationPromise) {
    let runner = migrationRunner;
    for (const [name, statement] of EXECUTION_INDEX_MIGRATIONS) {
      runner = runner.enqueue(name, statement);
    }
    _migrationPromise = runner.run().catch((err) => {
      // Allow a retry on the next call if this one failed (e.g. transient SQL outage).
      _migrationPromise = null;
      throw err;
    });
  }
  return _migrationPromise;
}

/**
 * Reports whether the index tables exist and how many rows each holds.
 * Used by the superuser-only `getExecutionIndexHealth` resolver to validate phase 0.
 *
 * @returns {Promise<{tables: Object<string, {exists: boolean, rows: number|null}>, migrationsApplied: string[]}>}
 */
export async function getExecutionIndexHealth() {
  const migrationsApplied = await applyExecutionIndexMigrations();
  const shown = await sql.executeRaw('SHOW TABLES');
  const existing = new Set((shown?.rows || []).map(r => String(Object.values(r)[0])));

  const tables = {};
  for (const name of EXECUTION_INDEX_TABLES) {
    if (!existing.has(name)) {
      tables[name] = { exists: false, rows: null };
      continue;
    }
    // Table names come from the constant list above, never from user input.
    const count = await sql.executeRaw(`SELECT COUNT(*) AS total FROM ${name}`);
    tables[name] = { exists: true, rows: Number(count?.rows?.[0]?.total ?? 0) };
  }
  return { tables, migrationsApplied };
}
