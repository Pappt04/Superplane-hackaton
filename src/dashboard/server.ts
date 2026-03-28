import "dotenv/config";
import express, { Request, Response } from "express";
import path from "path";
import { investigateIncident } from "../agent/incident-investigator";
import { getLogs } from "../integrations/log-fetcher";
import { getMetrics } from "../integrations/metrics-fetcher";
import { getRecentDeployments } from "../integrations/deployment-fetcher";
import { store } from "./incident-store";
import { Alert, InvestigationRequest } from "../types";

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../../public")));

const PORT = parseInt(process.env.DASHBOARD_PORT || "3003", 10);

// ─── Types ────────────────────────────────────────────────────────────────────

interface IncidentEvent {
  id: string;
  type: "ALERT_RECEIVED" | "INVESTIGATION_STARTED" | "INCIDENT_RESOLVED" | "INCIDENT_ESCALATED" | "INVESTIGATION_FAILED" | "HUMAN_ESCALATION";
  incidentId?: string;
  alert?: { service: string; severity: string; message: string; timestamp: string };
  result?: {
    root_cause: string;
    actions_taken: string[];
    fix_applied: boolean;
    proposed_fix: string;
    confidence: number;
    full_timeline: string;
  };
  error?: string;
  demo?: boolean;
  timestamp: string;
}

// ─── State ────────────────────────────────────────────────────────────────────

const events: IncidentEvent[] = [];
const sseClients: Response[] = [];

function broadcastEvent(event: IncidentEvent): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  sseClients.forEach((client) => {
    try { client.write(data); } catch { /* client disconnected */ }
  });
}

// ─── SSE ──────────────────────────────────────────────────────────────────────

app.get("/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  // Send all past events on connect
  events.forEach((e) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  });

  // Keepalive ping every 15s
  const ping = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { clearInterval(ping); }
  }, 15_000);

  sseClients.push(res);
  console.log(`[SSE] Client connected (${sseClients.length} total)`);

  req.on("close", () => {
    clearInterval(ping);
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
    console.log(`[SSE] Client disconnected (${sseClients.length} total)`);
  });
});

// ─── Incident webhook (called by webhook-server) ──────────────────────────────

app.post("/incidents", (req: Request, res: Response) => {
  const payload = req.body as Omit<IncidentEvent, "id">;
  const event: IncidentEvent = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ...payload,
    timestamp: payload.timestamp || new Date().toISOString(),
  };

  events.push(event);
  // Keep last 100 events in memory
  if (events.length > 100) events.shift();

  broadcastEvent(event);

  console.log(`[EVENT] ${event.type} — ${event.alert?.service || event.incidentId || ""}`);
  res.json({ ok: true, id: event.id });
});

// GET /api/events — REST fallback for initial page load
app.get("/api/events", (_req: Request, res: Response) => {
  res.json(events);
});

// GET /health
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "dashboard", port: PORT, events: events.length, clients: sseClients.length });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Dashboard running on http://localhost:${PORT}`);
  console.log(`  GET  /           - dashboard UI`);
  console.log(`  GET  /events     - SSE real-time feed`);
  console.log(`  POST /incidents  - receive incident events (from webhook-server)`);
  console.log(`  GET  /api/events - REST event history`);
  console.log(`  GET  /health     - health check`);
});
