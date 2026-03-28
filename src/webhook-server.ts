import "dotenv/config";
import express, { Request, Response } from "express";
import http from "http";
import { getLogs } from "./integrations/log-fetcher";
import { getMetrics } from "./integrations/metrics-fetcher";
import { getRecentDeployments } from "./integrations/deployment-fetcher";
import { Alert, InvestigationRequest, InvestigationResult } from "./types";

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.WEBHOOK_PORT || "3000", 10);
const AGENT_URL = process.env.AGENT_URL || "http://localhost:3001";
const DASHBOARD_URL = process.env.DASHBOARD_URL || "http://localhost:3003";
const SUPERPLANE_TRIAGE_WEBHOOK_URL = process.env.SUPERPLANE_TRIAGE_WEBHOOK_URL || "";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function postToDashboard(event: object): void {
  const body = JSON.stringify(event);
  const url = new URL(`${DASHBOARD_URL}/incidents`);
  const req = http.request(
    { hostname: url.hostname, port: url.port, path: url.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
    () => {}
  );
  req.on("error", () => {}); // fire-and-forget
  req.write(body);
  req.end();
}

function normalizeGrafanaAlert(body: Record<string, unknown>): Alert | null {
  // Grafana Alertmanager format
  if (Array.isArray((body as { alerts?: unknown[] }).alerts)) {
    const alerts = (body as { alerts: Record<string, unknown>[] }).alerts;
    const first = alerts[0];
    if (!first) return null;
    const labels = (first.labels || {}) as Record<string, string>;
    const annotations = (first.annotations || {}) as Record<string, string>;
    const rawSeverity = labels.severity || "high";
    const severity = (["critical", "high", "medium", "low"].includes(rawSeverity)
      ? rawSeverity
      : "high") as Alert["severity"];
    return {
      service: labels.service || labels.alertname || "unknown-service",
      severity,
      message: annotations.description || annotations.summary || first.labels?.toString() || "Alert fired",
      timestamp: (first.startsAt as string) || new Date().toISOString(),
    };
  }

  // PagerDuty format
  const msgs = (body as { messages?: { data?: { incident?: Record<string, unknown> } }[] }).messages;
  if (Array.isArray(msgs) && msgs[0]?.data?.incident) {
    const incident = msgs[0].data.incident as Record<string, unknown>;
    const service = (incident.service as { name?: string })?.name || "unknown-service";
    const urgency = (incident.urgency as string) || "high";
    const severity = (["critical", "high", "medium", "low"].includes(urgency)
      ? urgency
      : "high") as Alert["severity"];
    return {
      service,
      severity,
      message: (incident.title as string) || "PagerDuty incident triggered",
      timestamp: new Date().toISOString(),
    };
  }

  // Already normalized Alert shape
  if (body.service && body.severity && body.message) {
    return body as unknown as Alert;
  }

  return null;
}

async function triggerAgentDirectly(alert: Alert): Promise<void> {
  const incidentId = `inc-${Date.now()}`;

  postToDashboard({ type: "INVESTIGATION_STARTED", incidentId, alert, timestamp: new Date().toISOString() });

  try {
    const [logs, metrics, deployments] = await Promise.all([
      getLogs(alert.service, 30),
      getMetrics(alert.service),
      getRecentDeployments(alert.service, 24),
    ]);

    const body = JSON.stringify({ alert, context: { logs, metrics, deployments } } satisfies InvestigationRequest);
    const url = new URL(`${AGENT_URL}/agent/investigate`);

    const result = await new Promise<InvestigationResult>((resolve, reject) => {
      const req = http.request(
        { hostname: url.hostname, port: url.port || 3001, path: url.pathname, method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
          timeout: 120_000 },
        (res) => {
          let data = "";
          res.on("data", (c) => { data += c; });
          res.on("end", () => {
            try { resolve(JSON.parse(data)); }
            catch { reject(new Error("Invalid JSON from agent")); }
          });
        }
      );
      req.on("error", reject);
      req.on("timeout", () => reject(new Error("Agent timeout")));
      req.write(body);
      req.end();
    });

    const type = result.fix_applied ? "INCIDENT_RESOLVED" : "INCIDENT_ESCALATED";
    postToDashboard({ type, incidentId, alert, result, timestamp: new Date().toISOString() });
    console.log(`[AGENT] ${type} — fix_applied: ${result.fix_applied}`);

    if (!result.fix_applied) {
      triggerEscalation({ alert, result }).catch((e) => console.error("[Escalation]", e));
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    postToDashboard({ type: "INVESTIGATION_FAILED", incidentId, alert, error, timestamp: new Date().toISOString() });
    console.error("[AGENT] Investigation failed:", error);
  }
}

async function triggerSuperPlane(alert: Alert): Promise<void> {
  if (!SUPERPLANE_TRIAGE_WEBHOOK_URL) {
    console.log("[INFO] SUPERPLANE_TRIAGE_WEBHOOK_URL not set — calling agent directly (fallback)");
    triggerAgentDirectly(alert);
    return;
  }
  const url = new URL(SUPERPLANE_TRIAGE_WEBHOOK_URL);
  const body = JSON.stringify(alert);
  const req = http.request(
    { hostname: url.hostname, port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
    (res) => { console.log(`[SuperPlane] Webhook triggered, status: ${res.statusCode}`); }
  );
  req.on("error", (e) => console.error("[SuperPlane] Webhook error:", e.message));
  req.write(body);
  req.end();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /webhooks/alert — receives Grafana/PagerDuty alert
app.post("/webhooks/alert", async (req: Request, res: Response) => {
  const alert = normalizeGrafanaAlert(req.body as Record<string, unknown>);
  if (!alert) {
    res.status(400).json({ error: "Could not parse alert payload" });
    return;
  }

  console.log(`\n[ALERT] ${alert.severity.toUpperCase()} — ${alert.service}: ${alert.message}`);

  postToDashboard({ type: "ALERT_RECEIVED", alert, timestamp: new Date().toISOString() });
  res.json({ ok: true, alert });

  // Trigger SuperPlane (async, don't block response)
  triggerSuperPlane(alert).catch((e) => console.error("[SuperPlane]", e));
});

// POST /demo/trigger — manually trigger a demo incident
app.post("/demo/trigger", async (req: Request, res: Response) => {
  const body = req.body as Partial<Alert>;
  const alert: Alert = {
    service: body.service || "payment-service",
    severity: body.severity || "critical",
    message: body.message || "Demo incident: high error rate detected (manually triggered)",
    timestamp: new Date().toISOString(),
  };

  console.log(`\n[DEMO] Triggering incident for: ${alert.service}`);

  postToDashboard({ type: "ALERT_RECEIVED", alert, timestamp: new Date().toISOString(), demo: true });
  res.json({ ok: true, alert, note: "Demo incident triggered" });

  triggerSuperPlane(alert).catch((e) => console.error("[SuperPlane]", e));
});

// POST /trigger/investigate — called by SuperPlane after triage merge
// Receives { alert, context } and calls the AI agent
app.post("/trigger/investigate", async (req: Request, res: Response) => {
  const payload = req.body as Partial<InvestigationRequest>;
  if (!payload.alert?.service) {
    res.status(400).json({ error: "Missing alert.service" });
    return;
  }

  const alert = payload.alert;
  const incidentId = `inc-${Date.now()}`;

  console.log(`\n[INVESTIGATE] Starting AI investigation for ${alert.service} (${incidentId})`);
  postToDashboard({ type: "INVESTIGATION_STARTED", incidentId, alert, timestamp: new Date().toISOString() });
  res.json({ ok: true, incidentId });

  // Call the AI agent (async after response)
  (async () => {
    try {
      // If context not provided by SuperPlane, fetch it ourselves
      const context = payload.context || await (async () => {
        console.log(`[${incidentId}] Fetching context locally...`);
        const [logs, metrics, deployments] = await Promise.all([
          getLogs(alert.service, 30),
          getMetrics(alert.service),
          getRecentDeployments(alert.service, 24),
        ]);
        return { logs, metrics, deployments };
      })();

      const agentBody = JSON.stringify({ alert, context } satisfies InvestigationRequest);
      const result = await new Promise<InvestigationResult>((resolve, reject) => {
        const url = new URL(`${AGENT_URL}/agent/investigate`);
        const req = http.request(
          { hostname: url.hostname, port: url.port, path: url.pathname, method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(agentBody) },
            timeout: 130_000 },
          (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
              try { resolve(JSON.parse(data) as InvestigationResult); }
              catch { reject(new Error("Invalid JSON from agent")); }
            });
          }
        );
        req.on("error", reject);
        req.on("timeout", () => reject(new Error("Agent request timed out")));
        req.write(agentBody);
        req.end();
      });

      console.log(`[${incidentId}] fix_applied=${result.fix_applied}, confidence=${result.confidence}`);

      if (result.fix_applied) {
        postToDashboard({ type: "INCIDENT_RESOLVED", incidentId, alert, result, timestamp: new Date().toISOString() });
      } else {
        postToDashboard({ type: "INCIDENT_ESCALATED", incidentId, alert, result, timestamp: new Date().toISOString() });
        // Forward to human escalation
        triggerEscalation({ alert, result }).catch((e) => console.error("[Escalation]", e));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${incidentId}] Investigation failed:`, msg);
      postToDashboard({ type: "INVESTIGATION_FAILED", incidentId, alert, error: msg, timestamp: new Date().toISOString() });
    }
  })();
});

// POST /trigger/escalate — called by SuperPlane when fix_applied=false
app.post("/trigger/escalate", (req: Request, res: Response) => {
  const payload = req.body as Record<string, unknown>;
  console.log(`\n[ESCALATE] Human escalation for: ${payload.service}`);
  postToDashboard({ type: "HUMAN_ESCALATION", ...payload, timestamp: new Date().toISOString() });
  res.json({ ok: true });
});

// ─── Mock data endpoints (called by SuperPlane triage workflow) ───────────────

app.get("/mock/logs", async (req: Request, res: Response) => {
  const service = String(req.query.service || "payment-service");
  const minutes = parseInt(String(req.query.minutes || "30"), 10);
  const logs = await getLogs(service, minutes);
  res.json(logs);
});

app.get("/mock/metrics", async (req: Request, res: Response) => {
  const service = String(req.query.service || "payment-service");
  const metrics = await getMetrics(service);
  res.json(metrics);
});

app.get("/mock/deployments", async (req: Request, res: Response) => {
  const service = String(req.query.service || "payment-service");
  const hours = parseInt(String(req.query.hours || "24"), 10);
  const deployments = await getRecentDeployments(service, hours);
  res.json(deployments);
});

// GET /health
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "webhook-server", port: PORT });
});

// ─── Helpers (async) ──────────────────────────────────────────────────────────

async function triggerEscalation(payload: { alert: Alert; result: InvestigationResult }): Promise<void> {
  const DISCORD_URL = process.env.DISCORD_WEBHOOK_URL || "";
  if (!DISCORD_URL) {
    console.log("[INFO] DISCORD_WEBHOOK_URL not set — logging escalation locally");
    console.log("[ESCALATION] Service:", payload.alert.service);
    console.log("[ESCALATION] Root cause:", payload.result.root_cause);
    console.log("[ESCALATION] Proposed fix:", payload.result.proposed_fix);
    return;
  }

  const actionsList = payload.result.actions_taken
    .slice(0, 5)
    .map(a => `• ${a.split("->")[0].trim()}`)
    .join("\n");

  const discordBody = JSON.stringify({
    embeds: [{
      title: `🚨 AI ne može da fiksuje incident — potrebna ljudska intervencija`,
      color: 0xff4444,
      fields: [
        { name: "Servis", value: `\`${payload.alert.service}\``, inline: true },
        { name: "Severity", value: `\`${payload.alert.severity}\``, inline: true },
        { name: "Root Cause", value: payload.result.root_cause.slice(0, 500) },
        { name: "Sta je AI pokusao", value: actionsList || "—" },
        { name: "Predlozeni fix", value: `\`\`\`${payload.result.proposed_fix.slice(0, 800)}\`\`\`` },
        { name: "Confidence", value: `${Math.round(payload.result.confidence * 100)}%`, inline: true },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: "AI On-Call Engineer" },
    }],
  });

  const url = new URL(DISCORD_URL);
  const req = http.request(
    { hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(discordBody) } },
    (res) => { console.log(`[Discord] Escalation sent, status: ${res.statusCode}`); }
  );
  req.on("error", (e) => console.error("[Discord] Error:", e.message));
  req.write(discordBody);
  req.end();
}

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Webhook Server running on http://localhost:${PORT}`);
  console.log(`  POST /webhooks/alert      - receive Grafana/PagerDuty alert`);
  console.log(`  POST /demo/trigger        - manually trigger demo incident`);
  console.log(`  POST /trigger/investigate - SuperPlane calls this after triage`);
  console.log(`  POST /trigger/escalate    - SuperPlane calls this when AI failed`);
  console.log(`  GET  /mock/logs           - mock log data for SuperPlane`);
  console.log(`  GET  /mock/metrics        - mock metrics data for SuperPlane`);
  console.log(`  GET  /mock/deployments    - mock deployment data for SuperPlane`);
  console.log(`  GET  /health              - health check`);
});
