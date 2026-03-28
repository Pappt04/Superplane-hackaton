// Shared types - koordinisi sa Osobom 1

export interface Alert {
  service: string;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  timestamp: string;
}

export interface LogEntry {
  timestamp: string;
  level: "ERROR" | "WARN" | "INFO" | "DEBUG";
  message: string;
  service: string;
}

export interface ServiceMetrics {
  cpu_percent: number;
  memory_percent: number;
  error_rate: number;       // 0.0 - 1.0
  latency_p99_ms: number;
  request_count_per_min: number;
}

export interface Deployment {
  version: string;
  timestamp: string;
  author: string;
  commit_message: string;
  status: "success" | "failed" | "rolled_back";
}

export interface GitHubDiffFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  patch: string;            // unified diff of the file
}

export interface GitHubDiff {
  base_version: string;     // e.g. "v2.2.0"
  head_version: string;     // e.g. "v2.3.1" (currently deployed / failing)
  commits_ahead: number;
  files_changed: number;
  total_additions: number;
  total_deletions: number;
  files: GitHubDiffFile[];
}

export interface InfraEvent {
  event_type: string;       // e.g. "SERVICE_ISSUE", "INFORMATIONAL"
  service: string;          // e.g. "Amazon EC2", "Amazon RDS"
  region: string;
  status: "open" | "closed" | "upcoming";
  description: string;
  start_time: string;
  end_time?: string;
}

export interface InfraHealth {
  region: string;
  overall_status: "healthy" | "degraded" | "outage";
  checked_at: string;
  open_events: InfraEvent[];
  all_services_healthy: boolean;
}

export interface DatabaseStats {
  active_connections: number;
  max_connections: number;
  connection_utilization_percent: number;
  lock_wait_count: number;         // sessions waiting on a lock
  deadlock_count_1h: number;
  slow_queries_count_1h: number;   // queries > 1s in the last hour
  avg_query_time_ms: number;
  replication_lag_ms: number;      // 0 if no replication or healthy
  table_bloat_percent: number;
}

export interface ServiceContext {
  logs: LogEntry[];
  metrics: ServiceMetrics;
  deployments: Deployment[];
  github_diff?: GitHubDiff;        // code changes between last two deploys
  infra_health?: InfraHealth;      // cloud provider / regional health
  db_stats?: DatabaseStats;        // database-level Prometheus metrics
}

export interface InvestigationRequest {
  alert: Alert;
  context: ServiceContext;
}

export interface InvestigationResult {
  root_cause: string;
  actions_taken: string[];
  fix_applied: boolean;
  proposed_fix: string;
  confidence: number;       // 0.0 - 1.0
  full_timeline: string;
}
