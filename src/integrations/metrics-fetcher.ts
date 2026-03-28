import { ServiceMetrics } from "../types";

// Normalne metrike po servisu (kad radi OK)
const HEALTHY_BASELINES: Record<string, ServiceMetrics> = {
  "payment-service": { cpu_percent: 35, memory_percent: 60, error_rate: 0.001, latency_p99_ms: 180, request_count_per_min: 450 },
  "api-gateway":     { cpu_percent: 25, memory_percent: 40, error_rate: 0.002, latency_p99_ms: 80,  request_count_per_min: 1200 },
  "user-service":    { cpu_percent: 20, memory_percent: 45, error_rate: 0.001, latency_p99_ms: 95,  request_count_per_min: 300 },
};

const DEFAULT_BASELINE: ServiceMetrics = {
  cpu_percent: 30, memory_percent: 50, error_rate: 0.001, latency_p99_ms: 120, request_count_per_min: 200,
};

// Simulirani status servisa
// "config_error" = AI ne moze da popravi, treba eskalacija
const serviceStatus: Record<string, "healthy" | "degraded" | "down" | "config_error"> = {};

export function setServiceStatus(service: string, status: "healthy" | "degraded" | "down" | "config_error") {
  serviceStatus[service] = status;
}

export function getServiceStatus(service: string) {
  return serviceStatus[service] || "down";
}

export async function getMetrics(service: string): Promise<ServiceMetrics> {
  await new Promise(r => setTimeout(r, 100 + Math.random() * 200));

  const baseline = HEALTHY_BASELINES[service] || DEFAULT_BASELINE;
  const status = serviceStatus[service] || "down"; // default: servis je pao

  if (status === "healthy") {
    return {
      cpu_percent: baseline.cpu_percent + Math.random() * 10,
      memory_percent: baseline.memory_percent + Math.random() * 5,
      error_rate: baseline.error_rate * (1 + Math.random()),
      latency_p99_ms: baseline.latency_p99_ms + Math.random() * 50,
      request_count_per_min: baseline.request_count_per_min * (0.9 + Math.random() * 0.2),
    };
  }

  if (status === "degraded") {
    return {
      cpu_percent: 75 + Math.random() * 15,
      memory_percent: 80 + Math.random() * 10,
      error_rate: 0.3 + Math.random() * 0.3,
      latency_p99_ms: 2000 + Math.random() * 2000,
      request_count_per_min: baseline.request_count_per_min * 0.4,
    };
  }

  // down - kriticne metrike
  return {
    cpu_percent: 95 + Math.random() * 4,
    memory_percent: 98 + Math.random() * 1.5,
    error_rate: 0.97 + Math.random() * 0.03,
    latency_p99_ms: 30000,
    request_count_per_min: Math.random() * 5,
  };
}
