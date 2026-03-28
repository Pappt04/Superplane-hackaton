import "dotenv/config";
import express, { Request, Response } from "express";
import http from "http";

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.MOCK_PORT || "3002", 10);
const WEBHOOK_SERVER_URL = process.env.WEBHOOK_SERVER_URL || "http://localhost:3000";
const AGENT_URL = process.env.AGENT_URL || "http://localhost:3001";
const DEMO_APP_URL = `http://localhost:${process.env.DEMO_APP_PORT || "4000"}`;
const SERVICE_NAME = "payment-service";

// ─── State ────────────────────────────────────────────────────────────────────

let isDown = false;
let isCrashInProgress = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function callDemoApp(path: string): void {
  const url = new URL(`${DEMO_APP_URL}${path}`);
  const req = http.request(
    { hostname: url.hostname, port: url.port || 4000, path: url.pathname, method: "POST",
      headers: { "Content-Length": "0" } },
    () => {}
  );
  req.on("error", () => {});
  req.end();
}

function setAgentScenario(service: string, status: string): Promise<void> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ service, status });
    const url = new URL(`${AGENT_URL}/scenario`);
    const req = http.request(
      { hostname: url.hostname, port: url.port || 3001, path: url.pathname, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => { console.log(`[SCENARIO] Agent status set → ${status} (HTTP ${res.statusCode})`); resolve(); }
    );
    req.on("error", (e) => { console.error("[SCENARIO] Failed to set agent status:", e.message); resolve(); });
    req.write(body);
    req.end();
  });
}

function sendGrafanaAlert(severity: "critical" | "high", message: string): void {
  const grafanaPayload = {
    receiver: "superplane-webhook",
    status: "firing",
    alerts: [
      {
        status: "firing",
        labels: {
          alertname: "ServiceDown",
          service: SERVICE_NAME,
          severity,
          env: "production",
          instance: `${SERVICE_NAME}:${PORT}`,
        },
        annotations: {
          summary: `${SERVICE_NAME} is down`,
          description: message,
        },
        startsAt: new Date().toISOString(),
        endsAt: "0001-01-01T00:00:00Z",
        generatorURL: `http://grafana:3000/alerting/${SERVICE_NAME}`,
        fingerprint: `${SERVICE_NAME}-${Date.now()}`,
      },
    ],
    groupLabels: { alertname: "ServiceDown" },
    commonLabels: { service: SERVICE_NAME, env: "production" },
    commonAnnotations: { description: message },
    externalURL: "http://grafana:3000",
    version: "4",
    groupKey: `{}:{alertname="ServiceDown"}`,
  };

  const body = JSON.stringify(grafanaPayload);
  const url = new URL(`${WEBHOOK_SERVER_URL}/webhooks/alert`);

  const req = http.request(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    },
    (res) => {
      console.log(`[ALERT SENT] Grafana webhook → webhook-server, status: ${res.statusCode}`);
    }
  );
  req.on("error", (e) => console.error("[ALERT] Failed to send webhook:", e.message));
  req.write(body);
  req.end();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /health — main service health endpoint
// Returns 503 when crashed, 200 when healthy
app.get("/health", (_req: Request, res: Response) => {
  if (isDown) {
    console.log(`[HEALTH] 503 Service Unavailable`);
    res.status(503).json({
      status: "error",
      service: SERVICE_NAME,
      message: "Service is down — OOM killer triggered, awaiting restart",
      timestamp: new Date().toISOString(),
      uptime: 0,
    });
    return;
  }

  console.log(`[HEALTH] 200 OK`);
  res.json({
    status: "healthy",
    service: SERVICE_NAME,
    message: "All systems operational",
    timestamp: new Date().toISOString(),
    metrics: {
      memory_mb: Math.floor(400 + Math.random() * 200),
      cpu_percent: Math.floor(20 + Math.random() * 30),
      requests_per_min: Math.floor(400 + Math.random() * 100),
    },
  });
});

// POST /chaos/crash — forces service to crash + fires Grafana webhook alert
app.post("/chaos/crash", (_req: Request, res: Response) => {
  if (isCrashInProgress) {
    res.status(409).json({ error: "Crash already in progress" });
    return;
  }

  console.log("\n💥 [CHAOS] Forcing crash — simulating OOM killer...");
  isCrashInProgress = true;

  // Simulate brief degradation before full crash
  setTimeout(() => {
    isDown = true;
    isCrashInProgress = false;
    console.log("[CHAOS] Service is now DOWN (503)");

    // Send Grafana-format alert to webhook server
    sendGrafanaAlert(
      "critical",
      `FATAL: Out of memory - OOM killer terminated ${SERVICE_NAME} (RSS: 2.1GB, limit: 2GB). Service is returning 503. Immediate investigation required.`
    );
  }, 1000);

  res.json({
    ok: true,
    message: "Crash initiated — service will be down in ~1s and Grafana alert will fire",
    service: SERVICE_NAME,
  });
});

// POST /chaos/recover — manually recovers the service
app.post("/chaos/recover", (_req: Request, res: Response) => {
  const wasDown = isDown;
  isDown = false;
  isCrashInProgress = false;

  console.log("\n✅ [CHAOS] Service recovered — returning 200");

  if (wasDown) {
    // Send recovery notification
    const recoveryPayload = {
      receiver: "superplane-webhook",
      status: "resolved",
      alerts: [
        {
          status: "resolved",
          labels: { alertname: "ServiceDown", service: SERVICE_NAME, severity: "critical", env: "production" },
          annotations: { summary: `${SERVICE_NAME} recovered`, description: "Service is healthy again" },
          startsAt: new Date(Date.now() - 120_000).toISOString(),
          endsAt: new Date().toISOString(),
        },
      ],
    };

    const body = JSON.stringify(recoveryPayload);
    const url = new URL(`${WEBHOOK_SERVER_URL}/webhooks/alert`);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      () => {}
    );
    req.on("error", () => {});
    req.write(body);
    req.end();
  }

  res.json({
    ok: true,
    message: wasDown ? "Service recovered successfully" : "Service was already healthy",
    service: SERVICE_NAME,
    status: "healthy",
  });
});

// POST /chaos/scenario-a — memory leak, AI WILL fix (restart succeeds)
app.post("/chaos/scenario-a", async (_req: Request, res: Response) => {
  console.log("\n🅰️  [SCENARIO A] Memory leak — AI will fix this via restart");
  isDown = true;

  // Tell agent server: this service is "down" (restart will work, 80% chance)
  await setAgentScenario(SERVICE_NAME, "down");
  callDemoApp("/chaos/memory-leak");

  sendGrafanaAlert(
    "critical",
    `FATAL: Out of memory — OOM killer terminated ${SERVICE_NAME} (RSS: 2.1GB, limit: 2GB). Service returning 503. Immediate investigation required.`
  );

  res.json({
    ok: true,
    scenario: "A — memory leak",
    note: "AI WILL fix this. Restart succeeds with 80% chance, or rollback. Watch Discord for RESOLVED.",
  });
});

// POST /chaos/scenario-b — config error, AI CANNOT fix (Discord escalation)
app.post("/chaos/scenario-b", async (_req: Request, res: Response) => {
  console.log("\n🅱️  [SCENARIO B] Config error — AI CANNOT fix this, will escalate");
  isDown = true;

  // Tell agent server: config_error means restart/rollback will always fail
  await setAgentScenario(SERVICE_NAME, "config_error");
  callDemoApp("/chaos/config-error");

  sendGrafanaAlert(
    "critical",
    `CRITICAL: ${SERVICE_NAME} repeatedly crashing on startup. DATABASE_URL environment variable appears misconfigured — connection refused on every attempt. Manual intervention required.`
  );

  res.json({
    ok: true,
    scenario: "B — config error",
    note: "AI CANNOT fix this. Restart/rollback will fail. Watch Discord for ESCALATION embed with proposed fix.",
  });
});

// GET /status — internal state (for debugging)
app.get("/status", (_req: Request, res: Response) => {
  res.json({
    service: SERVICE_NAME,
    isDown,
    isCrashInProgress,
    port: PORT,
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Mock Broken Service (${SERVICE_NAME}) running on http://localhost:${PORT}`);
  console.log(`  GET  /health              - service health (200 or 503)`);
  console.log(`  POST /chaos/crash         - generic crash + Grafana alert`);
  console.log(`  POST /chaos/scenario-a    - Scenario A: memory leak (AI WILL fix)`);
  console.log(`  POST /chaos/scenario-b    - Scenario B: config error (AI CANNOT fix → Discord)`);
  console.log(`  POST /chaos/recover       - recover service`);
  console.log(`  GET  /status              - internal state`);
  console.log(`\nService starts HEALTHY. Use scenario-a or scenario-b to trigger demo incidents.`);
});
