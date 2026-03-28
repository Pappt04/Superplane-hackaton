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

const PORT = process.env.DASHBOARD_PORT || 3000;
const AGENT_PORT = process.env.PORT || 3001;

// SSE klijenti
const sseClients = new Set<Response>();

store.on("update", (incident) => {
  const data = `data: ${JSON.stringify(incident)}\n\n`;
  sseClients.forEach(client => client.write(data));
});

// GET /events - SSE stream
app.get("/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Posalji postojece incidente odmah
  store.getAll().forEach(inc => {
    res.write(`data: ${JSON.stringify(inc)}\n\n`);
  });

  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// GET /incidents - svi incidenti (za inicijalni load)
app.get("/incidents", (_req: Request, res: Response) => {
  res.json(store.getAll());
});

// POST /webhooks/alert - SuperPlane ili mock servis salje alert ovde
app.post("/webhooks/alert", async (req: Request, res: Response) => {
  const alert = req.body as Alert;
  if (!alert?.service) { res.status(400).json({ error: "Missing alert.service" }); return; }

  res.json({ message: "Alert received, investigating..." });
  triggerInvestigation(alert);
});

// POST /demo/trigger - dugme na dashboardu
app.post("/demo/trigger", async (req: Request, res: Response) => {
  const services = ["payment-service", "api-gateway", "user-service"];
  const messages = [
    "Service down - connection refused on port 8080",
    "OOM killed - process exited with code 137",
    "Health check failing for 5 consecutive minutes",
    "Error rate spiked to 98% - upstream timeout",
  ];

  const alert: Alert = {
    service: req.body?.service || services[Math.floor(Math.random() * services.length)],
    severity: "critical",
    message: messages[Math.floor(Math.random() * messages.length)],
    timestamp: new Date().toISOString(),
  };

  res.json({ message: "Demo incident triggered", alert });
  triggerInvestigation(alert);
});

async function triggerInvestigation(alert: Alert) {
  const incident = store.create(alert);

  try {
    const [logs, metrics, deployments] = await Promise.all([
      getLogs(alert.service, 30),
      getMetrics(alert.service),
      getRecentDeployments(alert.service, 24),
    ]);

    const request: InvestigationRequest = { alert, context: { logs, metrics, deployments } };
    const result = await investigateIncident(request);
    store.resolve(incident.id, result);
  } catch (err) {
    store.resolve(incident.id, {
      root_cause: "Investigation failed",
      actions_taken: [],
      fix_applied: false,
      proposed_fix: String(err),
      confidence: 0,
      full_timeline: "",
    });
  }
}

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`Agent API: http://localhost:${AGENT_PORT}`);
});
