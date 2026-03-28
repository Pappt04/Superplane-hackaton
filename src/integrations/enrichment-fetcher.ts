import { GitHubDiff, GitHubDiffFile, InfraHealth, InfraEvent, DatabaseStats } from "../types";

// ─── GitHub Diff ──────────────────────────────────────────────────────────────

const DIFF_TEMPLATES: Record<string, { files: Array<{ filename: string; patch: string }> }> = {
  "payment-service": {
    files: [
      {
        filename: "src/db/connection-pool.ts",
        patch: [
          "@@ -45,7 +45,7 @@ export function createPool(config: PoolConfig) {",
          "-  max: 50,",
          "+  max: 200,   // BUG: increased without load testing — OOM risk on high traffic",
          "   idleTimeoutMillis: 30000,",
          "   connectionTimeoutMillis: 2000,",
        ].join("\n"),
      },
      {
        filename: "src/payments/processor.ts",
        patch: [
          "@@ -112,6 +112,10 @@ export class PaymentProcessor {",
          "+  private cache = new Map();  // BUG: unbounded in-memory cache — memory leak",
          "+",
          "   async process(payment: Payment) {",
          "+    this.cache.set(payment.id, payment);  // never evicted",
          "     return await this.db.insert(payment);",
          "   }",
        ].join("\n"),
      },
      {
        filename: "src/config/index.ts",
        patch: [
          "@@ -3,3 +3,4 @@ export const config = {",
          "   db_host: process.env.DB_HOST,",
          "+  db_pool_max: parseInt(process.env.DB_POOL_MAX || '200'),",
          "   redis_url: process.env.REDIS_URL,",
          "};",
        ].join("\n"),
      },
    ],
  },
  "api-gateway": {
    files: [
      {
        filename: "src/middleware/rate-limiter.ts",
        patch: [
          "@@ -18,7 +18,7 @@ export const rateLimiter = rateLimit({",
          "-  windowMs: 60 * 1000,",
          "-  max: 1000,",
          "+  windowMs: 60 * 1000,",
          "+  max: 50000,  // BUG: limit increased 50x — effectively disabled",
          "   message: 'Too many requests',",
          "});",
        ].join("\n"),
      },
      {
        filename: "src/proxy/upstream.ts",
        patch: [
          "@@ -31,6 +31,7 @@ export function proxyRequest(req, res) {",
          "   const upstream = selectUpstream(req.path);",
          "+  // TODO: removed circuit breaker temporarily — needs re-enabling",
          "   return forward(req, res, upstream);",
          " }",
        ].join("\n"),
      },
    ],
  },
};

const DEFAULT_DIFF_FILES: Array<{ filename: string; patch: string }> = [
  {
    filename: "src/main.ts",
    patch: [
      "@@ -1,5 +1,8 @@",
      "+import { newFeature } from './features/new';",
      " import { app } from './app';",
      "+// experimental: enabled in prod without staging validation",
      "+newFeature.enable();",
      " app.listen(3000);",
    ].join("\n"),
  },
];

export async function getGitHubDiff(service: string): Promise<GitHubDiff> {
  await new Promise((r) => setTimeout(r, 150 + Math.random() * 300));

  const templates = DIFF_TEMPLATES[service]?.files || DEFAULT_DIFF_FILES;
  const baseVersion = `v2.${2 + Math.floor(Math.random() * 3)}.${Math.floor(Math.random() * 10)}`;
  const headMinor = parseInt(baseVersion.split(".")[1]) + 1;
  const headVersion = `v2.${headMinor}.0`;

  const files: GitHubDiffFile[] = templates.map((t) => {
    const additions = (t.patch.match(/^\+[^+]/gm) || []).length;
    const deletions = (t.patch.match(/^-[^-]/gm) || []).length;
    return {
      filename: t.filename,
      status: "modified",
      additions,
      deletions,
      patch: t.patch,
    };
  });

  return {
    base_version: baseVersion,
    head_version: headVersion,
    commits_ahead: 3 + Math.floor(Math.random() * 5),
    files_changed: files.length,
    total_additions: files.reduce((s, f) => s + f.additions, 0),
    total_deletions: files.reduce((s, f) => s + f.deletions, 0),
    files,
  };
}

// ─── Infrastructure Health ────────────────────────────────────────────────────

export async function getInfraHealth(region: string): Promise<InfraHealth> {
  await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));

  // 80% chance: no infra events (root cause is in the service, not AWS)
  const hasEvents = Math.random() < 0.2;

  const open_events: InfraEvent[] = hasEvents
    ? [
        {
          event_type: "SERVICE_ISSUE",
          service: "Amazon RDS",
          region,
          status: "open",
          description: "Increased latency and error rates for RDS instances in the affected Availability Zone. AWS engineers are investigating.",
          start_time: new Date(Date.now() - 25 * 60_000).toISOString(),
        },
      ]
    : [];

  return {
    region,
    overall_status: hasEvents ? "degraded" : "healthy",
    checked_at: new Date().toISOString(),
    open_events,
    all_services_healthy: !hasEvents,
  };
}

// ─── Database Statistics ──────────────────────────────────────────────────────

const DB_BASELINES: Record<string, Partial<DatabaseStats>> = {
  "payment-service": { max_connections: 200, avg_query_time_ms: 12 },
  "api-gateway":     { max_connections: 100, avg_query_time_ms: 5 },
  "user-service":    { max_connections: 150, avg_query_time_ms: 8 },
};

export async function getDbStats(service: string): Promise<DatabaseStats> {
  await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));

  const baseline = DB_BASELINES[service] || { max_connections: 100, avg_query_time_ms: 10 };
  const maxConn = baseline.max_connections!;

  // Simulate a DB under stress (matches the service being "down")
  const activeConnections = Math.floor(maxConn * (0.85 + Math.random() * 0.14)); // 85–99% used
  const utilization = Math.round((activeConnections / maxConn) * 100);

  return {
    active_connections: activeConnections,
    max_connections: maxConn,
    connection_utilization_percent: utilization,
    lock_wait_count: Math.floor(20 + Math.random() * 60),         // many sessions blocked
    deadlock_count_1h: Math.floor(Math.random() * 8),
    slow_queries_count_1h: Math.floor(40 + Math.random() * 120),  // lots of slow queries
    avg_query_time_ms: Math.floor((baseline.avg_query_time_ms! * (8 + Math.random() * 10))), // 8–18x normal
    replication_lag_ms: Math.floor(Math.random() * 3000),          // up to 3s lag
    table_bloat_percent: Math.floor(15 + Math.random() * 30),
  };
}
