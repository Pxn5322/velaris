/**
 * VELARIS background worker entrypoint (scaffold only).
 *
 * Real queue consumers (Redis/BullMQ ingestion, embedding, retries, retention)
 * arrive with T3.03; they require the queue/provider decisions (D-07, hosting)
 * to be recorded first. Until then this process starts, reports that no jobs
 * are configured, and exits.
 */
export function main(): number {
  console.log('[worker] scaffold ready; no jobs are configured yet');
  return 0;
}

if (process.env['NODE_ENV'] !== 'test') {
  process.exitCode = main();
}
