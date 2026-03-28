import "dotenv/config";
import express, { Request, Response } from "express";

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.DEMO_APP_PORT || "4000", 10);

// ── State ──────────────────────────────────────────────────────────────────
type AppState = "healthy" | "memory_leak" | "config_error";
let state: AppState = "healthy";
let requestCount = 0;
let errorCount = 0;

const transactions = [
  { id: "txn_001", amount: 149.99, status: "success", user: "alice@example.com", ts: new Date().toISOString() },
  { id: "txn_002", amount: 89.50,  status: "success", user: "bob@example.com",   ts: new Date().toISOString() },
  { id: "txn_003", amount: 320.00, status: "success", user: "carol@example.com", ts: new Date().toISOString() },
];

// ── Routes ─────────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  if (state === "healthy") {
    res.json({ status: "ok", uptime: process.uptime().toFixed(0) });
  } else {
    res.status(503).json({ status: "error", reason: state });
  }
});

app.get("/api/transactions", (_req: Request, res: Response) => {
  requestCount++;
  if (state !== "healthy") { errorCount++; res.status(503).json({ error: "Service unavailable" }); return; }
  res.json({ transactions, total: transactions.length });
});

app.post("/api/pay", (req: Request, res: Response) => {
  requestCount++;
  if (state !== "healthy") { errorCount++; res.status(503).json({ error: "Payment service unavailable" }); return; }
  const { amount, user } = req.body as { amount: number; user: string };
  const txn = { id: `txn_${Date.now()}`, amount, status: "success", user, ts: new Date().toISOString() };
  transactions.unshift(txn);
  if (transactions.length > 20) transactions.pop();
  res.json(txn);
});

app.get("/api/status", (_req, res) => {
  res.json({ state, requestCount, errorCount, uptime: process.uptime().toFixed(0) });
});

// ── Chaos endpoints ────────────────────────────────────────────────────────

// Scenario A: memory leak → AI CE MOCI da popravi (restart radi)
app.post("/chaos/memory-leak", (_req, res) => {
  state = "memory_leak";
  console.log("💥 [CHAOS] Memory leak triggered — OOM imminent");
  res.json({ ok: true, scenario: "memory_leak", message: "Memory leak started. Service will become unresponsive." });
});

// Scenario B: config error → AI NECE MOCI da popravi (restart ne pomaze, treba manual fix)
app.post("/chaos/config-error", (_req, res) => {
  state = "config_error";
  console.log("💥 [CHAOS] Database config corrupted — connection string invalid");
  res.json({ ok: true, scenario: "config_error", message: "DB config corrupted. Restart will not help." });
});

app.post("/chaos/recover", (_req, res) => {
  state = "healthy";
  errorCount = 0;
  console.log("✅ [RECOVER] Service restored to healthy state");
  res.json({ ok: true, message: "Service recovered" });
});

// ── Dashboard UI ───────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>PayFlow — Payment Service</title>
  <meta http-equiv="refresh" content="3">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0d1117; color: #c9d1d9; font-family: 'Courier New', monospace; padding: 32px; }
    h1 { color: #58a6ff; font-size: 22px; margin-bottom: 4px; }
    .sub { color: #8b949e; font-size: 12px; margin-bottom: 24px; }
    .status { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px;
              border-radius: 4px; font-size: 13px; font-weight: bold; margin-bottom: 24px; }
    .status.healthy  { background: #0f2d0f; color: #3fb950; border: 1px solid #3fb950; }
    .status.memory_leak { background: #2d2205; color: #d29922; border: 1px solid #d29922; }
    .status.config_error { background: #2d0f0f; color: #f85149; border: 1px solid #f85149; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; animation: pulse 1.5s infinite; }
    @keyframes pulse { 50% { opacity: 0.3; } }
    .stats { display: flex; gap: 16px; margin-bottom: 24px; }
    .stat { background: #161b22; border: 1px solid #21262d; border-radius: 6px; padding: 14px 20px; }
    .stat .val { font-size: 28px; font-weight: bold; color: #58a6ff; }
    .stat .lbl { font-size: 11px; color: #8b949e; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; background: #161b22;
            border: 1px solid #21262d; border-radius: 6px; overflow: hidden; }
    th { background: #21262d; padding: 10px 14px; text-align: left; font-size: 11px;
         color: #8b949e; text-transform: uppercase; letter-spacing: 1px; }
    td { padding: 10px 14px; border-bottom: 1px solid #21262d; font-size: 13px; }
    tr:last-child td { border-bottom: none; }
    .success { color: #3fb950; }
  </style>
</head>
<body>
  <h1>⚡ PayFlow</h1>
  <p class="sub">Payment Processing Service — port ${PORT}</p>

  <div class="status ${state}">
    <span class="dot"></span>
    ${state === "healthy" ? "OPERATIONAL" : state === "memory_leak" ? "MEMORY LEAK DETECTED" : "DATABASE CONFIG ERROR"}
  </div>

  <div class="stats">
    <div class="stat"><div class="val">${requestCount}</div><div class="lbl">Total Requests</div></div>
    <div class="stat"><div class="val">${errorCount}</div><div class="lbl">Errors</div></div>
    <div class="stat"><div class="val">${transactions.length}</div><div class="lbl">Transactions</div></div>
    <div class="stat"><div class="val">${process.uptime().toFixed(0)}s</div><div class="lbl">Uptime</div></div>
  </div>

  <table>
    <tr><th>ID</th><th>User</th><th>Amount</th><th>Status</th><th>Time</th></tr>
    ${transactions.slice(0, 8).map(t => `
    <tr>
      <td>${t.id}</td>
      <td>${t.user}</td>
      <td>$${t.amount}</td>
      <td class="${t.status}">${t.status.toUpperCase()}</td>
      <td>${new Date(t.ts).toLocaleTimeString()}</td>
    </tr>`).join("")}
  </table>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`PayFlow app running on http://localhost:${PORT}`);
  console.log(`  POST /chaos/memory-leak  — Scenario A: AI WILL fix (restart works)`);
  console.log(`  POST /chaos/config-error — Scenario B: AI CANNOT fix (manual needed)`);
  console.log(`  POST /chaos/recover      — Reset to healthy`);
});

export { state, AppState };
