import { LogEntry } from "../types";

const ERROR_TEMPLATES: Record<string, string[]> = {
  "payment-service": [
    "FATAL: Out of memory - killed by OOM killer (RSS: 2.1GB, limit: 2GB)",
    "ERROR: Database connection pool exhausted (pool_size=50, waiting=234)",
    "ERROR: java.lang.OutOfMemoryError: Java heap space at PaymentProcessor.process(PaymentProcessor.java:142)",
    "ERROR: Connection refused to postgres://db-primary:5432 after 3 retries",
    "WARN: Response time 4823ms exceeds SLA threshold of 500ms",
    "ERROR: Transaction rollback - deadlock detected between txn_8821 and txn_8834",
    "ERROR: Redis NOAUTH Authentication required - cache unavailable",
    "FATAL: Segmentation fault (core dumped) in native payment library v2.1.3",
  ],
  "api-gateway": [
    "ERROR: Upstream service payment-service timeout after 30000ms",
    "ERROR: Circuit breaker OPEN for payment-service (failures: 47/50)",
    "WARN: Rate limit exceeded for client 192.168.1.45 (1200 req/min, limit: 1000)",
    "ERROR: SSL certificate expired for api.internal (expired: 2026-03-27)",
    "ERROR: 503 Service Unavailable - no healthy upstream instances",
    "WARN: Request queue depth 892 exceeds warning threshold 500",
  ],
  "user-service": [
    "ERROR: MongoDB replica set primary not reachable",
    "ERROR: Authentication service timeout (attempt 3/3)",
    "WARN: JWT token validation failed - clock skew detected (diff: 312s)",
    "ERROR: SMTP connection failed - cannot send verification email",
  ],
};

const DEFAULT_ERRORS = [
  "ERROR: Service crashed - exit code 137 (OOM)",
  "ERROR: Health check failed 5 consecutive times",
  "WARN: Disk usage at 94% on /var/log",
  "ERROR: Cannot connect to dependency service",
  "ERROR: Unhandled exception in worker thread",
];

export async function getLogs(service: string, minutes: number = 30): Promise<LogEntry[]> {
  // Simulira fetch logova - u produkciji bi ovo bio CloudWatch/Grafana Loki API
  await new Promise(r => setTimeout(r, 200 + Math.random() * 300));

  const templates = ERROR_TEMPLATES[service] || DEFAULT_ERRORS;
  const now = new Date();
  const logs: LogEntry[] = [];

  // Normalni logovi pre incidenta
  for (let i = minutes; i > 10; i -= 3) {
    logs.push({
      timestamp: new Date(now.getTime() - i * 60_000).toISOString(),
      level: "INFO",
      message: `Health check OK - responding in ${50 + Math.floor(Math.random() * 100)}ms`,
      service,
    });
  }

  // Pocetak problema
  logs.push({
    timestamp: new Date(now.getTime() - 10 * 60_000).toISOString(),
    level: "WARN",
    message: templates[Math.floor(Math.random() * templates.length)].replace("ERROR:", "WARN:"),
    service,
  });

  // Eskalacija gresaka
  for (let i = 8; i > 0; i -= 1) {
    logs.push({
      timestamp: new Date(now.getTime() - i * 60_000).toISOString(),
      level: "ERROR",
      message: templates[Math.floor(Math.random() * templates.length)],
      service,
    });
  }

  // Fatalni error
  logs.push({
    timestamp: new Date(now.getTime() - 30_000).toISOString(),
    level: "ERROR",
    message: templates[0],
    service,
  });

  return logs;
}
