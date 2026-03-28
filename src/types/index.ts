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

export interface ServiceContext {
  logs: LogEntry[];
  metrics: ServiceMetrics;
  deployments: Deployment[];
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
