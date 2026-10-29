/**
 * VELARIS background worker entrypoint (scaffold only).
 *
 * T3.03 landed the ingestion engine (parse/chunk/embed with retry and
 * tenant-scoped job metadata) inside apps/api's knowledge domain, where
 * Prisma, dependency injection and the test harness live; the job
 * contract is `apps/api/src/domains/knowledge/ingestion-types.ts` and the
 * queue port is `ingestion-queue.ts`. This process will host the external
 * queue consumer once two owner decisions land: provisioning the
 * Redis/BullMQ queue service (ARCHITECTURE.md §1) and selecting the
 * embedding provider (D-07). Until then this entrypoint starts, reports
 * that no jobs are configured, and exits.
 */
export function main(): number {
  console.log("[worker] scaffold ready; no jobs are configured yet");
  return 0;
}

if (process.env["NODE_ENV"] !== "test") {
  process.exitCode = main();
}
