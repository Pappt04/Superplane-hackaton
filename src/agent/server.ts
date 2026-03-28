import "dotenv/config";
import express, { Request, Response } from "express";
import { investigateIncident } from "./incident-investigator";
import { getLogs } from "../integrations/log-fetcher";
import { getMetrics, setServiceStatus } from "../integrations/metrics-fetcher";
import { getRecentDeployments } from "../integrations/deployment-fetcher";
import { InvestigationRequest } from "../types";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

// POST /agent/investigate
// SuperPlane poziva ovaj endpoint kada treba AI istraga
app.post("/agent/investigate", async (req: Request, res: Response) => {
  const body = req.body as Partial<InvestigationRequest>;

  if (!body.alert?.service) {
    res.status(400).json({ error: "Missing alert.service" });
    return;
  }

  const alert = body.alert;
  console.log(`\n[${new Date().toISOString()}] Received investigation request for: ${alert.service}`);

  // Ako context nije prosledjen (SuperPlane ga mozda vec fetchuje),
  // fetchujemo ga sami
  const context = body.context || await (async () => {
    console.log("[INFO] No context provided, fetching...");
    const [logs, metrics, deployments] = await Promise.all([
      getLogs(alert.service, 30),
      getMetrics(alert.service),
      getRecentDeployments(alert.service, 24),
    ]);
    return { logs, metrics, deployments };
  })();

  const request: InvestigationRequest = { alert, context };

  // Timeout od 120s
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Investigation timeout after 120s")), 120_000)
  );

  try {
    const result = await Promise.race([
      investigateIncident(request),
      timeoutPromise,
    ]);

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ERROR]", message);
    res.status(500).json({
      error: message,
      root_cause: "Investigation failed or timed out",
      actions_taken: [],
      fix_applied: false,
      proposed_fix: "Manual investigation required - AI agent failed to complete",
      confidence: 0,
      full_timeline: `Investigation failed: ${message}`,
    });
  }
});

// POST /scenario — set service status before investigation (used by demo scenarios)
app.post("/scenario", (req: Request, res: Response) => {
  const { service, status } = req.body as { service?: string; status?: string };
  if (!service || !status) {
    res.status(400).json({ error: "Missing service or status" });
    return;
  }
  const validStatuses = ["healthy", "degraded", "down", "config_error"];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    return;
  }
  setServiceStatus(service, status as "healthy" | "degraded" | "down" | "config_error");
  console.log(`[SCENARIO] Set ${service} status → ${status}`);
  res.json({ ok: true, service, status });
});

// GET /health
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "ai-oncall-agent", port: PORT });
});

app.listen(PORT, () => {
  console.log(`AI On-Call Agent running on http://localhost:${PORT}`);
  console.log(`POST /agent/investigate  - trigger AI investigation`);
  console.log(`GET  /health             - health check`);
});
