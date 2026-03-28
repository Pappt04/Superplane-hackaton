import "dotenv/config";
import express, { Request, Response } from "express";

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.DEMO_APP_PORT || "4000", 10);

// ── Types ─────────────────────────────────────────────────────────────────────

type AppState = "healthy" | "memory_leak" | "config_error";
type OrderStatus = "pending" | "processing" | "shipped" | "delivered" | "cancelled";

interface Order {
  id: string;
  customer: string;
  email: string;
  items: { name: string; qty: number; price: number }[];
  total: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
}

// ── State ─────────────────────────────────────────────────────────────────────

let appState: AppState = "healthy";
let requestCount = 0;
let errorCount = 0;
const sseClients: Response[] = [];

const orders: Order[] = [
  { id: "ORD-001", customer: "Ana Petrovic",   email: "ana@example.com",   items: [{ name: "Laptop Stand",  qty: 1, price: 45.00 }, { name: "USB-C Hub", qty: 1, price: 29.99 }], total: 74.99,  status: "delivered",  createdAt: new Date(Date.now() - 86400000 * 3).toISOString(), updatedAt: new Date(Date.now() - 86400000).toISOString() },
  { id: "ORD-002", customer: "Marko Nikolic",  email: "marko@example.com", items: [{ name: "Mechanical Keyboard", qty: 1, price: 120.00 }], total: 120.00, status: "shipped",   createdAt: new Date(Date.now() - 86400000 * 2).toISOString(), updatedAt: new Date(Date.now() - 3600000 * 5).toISOString() },
  { id: "ORD-003", customer: "Jelena Milic",   email: "jelena@example.com", items: [{ name: "Monitor 27\"", qty: 1, price: 349.00 }], total: 349.00, status: "processing", createdAt: new Date(Date.now() - 3600000 * 8).toISOString(),  updatedAt: new Date(Date.now() - 3600000 * 2).toISOString() },
  { id: "ORD-004", customer: "Stefan Jovic",   email: "stefan@example.com", items: [{ name: "Webcam HD", qty: 2, price: 59.99 }, { name: "Ring Light", qty: 1, price: 34.99 }], total: 154.97, status: "pending",    createdAt: new Date(Date.now() - 3600000).toISOString(),     updatedAt: new Date(Date.now() - 3600000).toISOString() },
  { id: "ORD-005", customer: "Lena Kovac",     email: "lena@example.com",  items: [{ name: "Headphones", qty: 1, price: 199.00 }], total: 199.00, status: "pending",    createdAt: new Date(Date.now() - 1800000).toISOString(),     updatedAt: new Date(Date.now() - 1800000).toISOString() },
];

let orderCounter = orders.length + 1;

// ── SSE broadcast ─────────────────────────────────────────────────────────────

function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try { sseClients[i].write(payload); }
    catch { sseClients.splice(i, 1); }
  }
}

function getStats() {
  const total = orders.length;
  const revenue = orders.filter(o => o.status !== "cancelled").reduce((s, o) => s + o.total, 0);
  const byStatus = orders.reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc; }, {} as Record<string, number>);
  return { total, revenue: revenue.toFixed(2), byStatus, uptime: process.uptime().toFixed(0), state: appState, requestCount, errorCount };
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  requestCount++;
  if (appState !== "healthy" && !req.path.startsWith("/chaos") && req.path !== "/health" && req.path !== "/events") {
    errorCount++;
    if (req.path.startsWith("/api")) {
      res.status(503).json({ error: "Service unavailable", reason: appState });
      return;
    }
  }
  next();
});

// ── API Routes ────────────────────────────────────────────────────────────────

app.get("/api/orders", (_req, res) => {
  res.json({ orders: orders.slice().reverse(), total: orders.length });
});

app.post("/api/orders", (req: Request, res: Response) => {
  const { customer, email, items } = req.body as { customer: string; email: string; items: Order["items"] };
  if (!customer || !email || !items?.length) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const total = items.reduce((s, i) => s + i.qty * i.price, 0);
  const order: Order = {
    id: `ORD-${String(orderCounter++).padStart(3, "0")}`,
    customer, email, items,
    total: parseFloat(total.toFixed(2)),
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  orders.push(order);
  broadcast("order_created", order);
  broadcast("stats_updated", getStats());
  res.status(201).json(order);
});

app.patch("/api/orders/:id/status", (req: Request, res: Response) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  const { status } = req.body as { status: OrderStatus };
  const valid: OrderStatus[] = ["pending", "processing", "shipped", "delivered", "cancelled"];
  if (!valid.includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }
  order.status = status;
  order.updatedAt = new Date().toISOString();
  broadcast("order_updated", order);
  broadcast("stats_updated", getStats());
  res.json(order);
});

app.delete("/api/orders/:id", (req: Request, res: Response) => {
  const idx = orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: "Order not found" }); return; }
  const [removed] = orders.splice(idx, 1);
  broadcast("order_deleted", { id: removed.id });
  broadcast("stats_updated", getStats());
  res.json({ ok: true });
});

app.get("/api/stats", (_req, res) => { res.json(getStats()); });

// ── SSE ───────────────────────────────────────────────────────────────────────

app.get("/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(`event: connected\ndata: ${JSON.stringify(getStats())}\n\n`);
  sseClients.push(res);
  req.on("close", () => { const i = sseClients.indexOf(res); if (i > -1) sseClients.splice(i, 1); });
});

// ── Health ────────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  if (appState === "healthy") res.json({ status: "ok", uptime: process.uptime().toFixed(0) });
  else res.status(503).json({ status: "error", reason: appState });
});

// ── Chaos ─────────────────────────────────────────────────────────────────────

app.post("/chaos/memory-leak", (_req, res) => {
  appState = "memory_leak";
  broadcast("state_changed", { state: appState });
  console.log("💥 [CHAOS] Memory leak triggered");
  res.json({ ok: true, scenario: "memory_leak" });
});

app.post("/chaos/config-error", (_req, res) => {
  appState = "config_error";
  broadcast("state_changed", { state: appState });
  console.log("💥 [CHAOS] Config error triggered");
  res.json({ ok: true, scenario: "config_error" });
});

app.post("/chaos/recover", (_req, res) => {
  appState = "healthy";
  errorCount = 0;
  broadcast("state_changed", { state: appState });
  console.log("✅ [RECOVER] Service restored");
  res.json({ ok: true });
});

// ── UI ────────────────────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OrderFlow — Order Management</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #21262d;
    --text: #e6edf3; --muted: #8b949e; --accent: #58a6ff;
    --green: #3fb950; --red: #f85149; --yellow: #d29922; --purple: #bc8cff;
  }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; }

  /* Header */
  .header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 24px; display: flex; align-items: center; justify-content: space-between; height: 56px; position: sticky; top: 0; z-index: 100; }
  .logo { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 18px; }
  .logo-icon { width: 28px; height: 28px; background: linear-gradient(135deg, var(--accent), var(--purple)); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 14px; }
  .status-badge { display: flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; transition: all 0.3s; }
  .status-badge.healthy  { background: #0f2d0f; color: var(--green); border: 1px solid var(--green); }
  .status-badge.memory_leak { background: #2d2205; color: var(--yellow); border: 1px solid var(--yellow); }
  .status-badge.config_error { background: #2d0f0f; color: var(--red); border: 1px solid var(--red); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

  /* Layout */
  .main { max-width: 1200px; margin: 0 auto; padding: 24px; }

  /* Stats row */
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; }
  .stat-val { font-size: 28px; font-weight: 700; color: var(--accent); margin-bottom: 4px; }
  .stat-val.green { color: var(--green); }
  .stat-val.yellow { color: var(--yellow); }
  .stat-val.purple { color: var(--purple); }
  .stat-lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }

  /* Error banner */
  .error-banner { background: #2d0f0f; border: 1px solid var(--red); border-radius: 8px; padding: 14px 18px; margin-bottom: 24px; display: none; align-items: center; gap: 10px; color: var(--red); font-size: 14px; }
  .error-banner.visible { display: flex; }
  .error-banner.yellow { background: #2d2205; border-color: var(--yellow); color: var(--yellow); }

  /* Grid */
  .grid { display: grid; grid-template-columns: 1fr 340px; gap: 20px; }

  /* Panel */
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .panel-header { padding: 14px 18px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .panel-title { font-size: 14px; font-weight: 600; }
  .panel-body { padding: 0; }

  /* Table */
  table { width: 100%; border-collapse: collapse; }
  th { padding: 10px 14px; text-align: left; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); background: #0d1117; }
  td { padding: 12px 14px; font-size: 13px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(88, 166, 255, 0.04); }
  .order-id { font-family: monospace; color: var(--accent); font-size: 12px; }
  .customer-info .name { font-weight: 500; }
  .customer-info .email { color: var(--muted); font-size: 11px; margin-top: 2px; }
  .amount { font-weight: 600; }

  /* Status pill */
  .pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; cursor: pointer; transition: opacity 0.2s; }
  .pill:hover { opacity: 0.8; }
  .pill.pending    { background: #1c2233; color: #79c0ff; border: 1px solid #1f4068; }
  .pill.processing { background: #2d2205; color: var(--yellow); border: 1px solid #4a3800; }
  .pill.shipped    { background: #1a2a4a; color: var(--purple); border: 1px solid #2d3d6b; }
  .pill.delivered  { background: #0f2d0f; color: var(--green); border: 1px solid #1a4a1a; }
  .pill.cancelled  { background: #2d0f0f; color: var(--red); border: 1px solid #4a1a1a; }

  /* Side panel */
  .side { display: flex; flex-direction: column; gap: 16px; }

  /* Form */
  .form { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  label { font-size: 12px; color: var(--muted); margin-bottom: 4px; display: block; }
  input, select { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; color: var(--text); font-size: 13px; outline: none; transition: border-color 0.2s; }
  input:focus, select:focus { border-color: var(--accent); }
  .items-row { display: grid; grid-template-columns: 1fr 50px 80px; gap: 6px; }
  .btn { padding: 9px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.2s; }
  .btn-primary { background: var(--accent); color: #0d1117; }
  .btn-primary:hover { background: #79c0ff; }
  .btn-primary:disabled { background: var(--border); color: var(--muted); cursor: not-allowed; }
  .btn-sm { padding: 4px 10px; font-size: 11px; border-radius: 4px; }
  .btn-ghost { background: var(--border); color: var(--text); }
  .btn-ghost:hover { background: #2d3440; }

  /* Activity feed */
  .feed { max-height: 300px; overflow-y: auto; padding: 0; }
  .feed-item { padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 12px; display: flex; align-items: flex-start; gap: 8px; }
  .feed-item:last-child { border-bottom: none; }
  .feed-dot { width: 6px; height: 6px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; }
  .feed-dot.green { background: var(--green); }
  .feed-dot.blue  { background: var(--accent); }
  .feed-dot.yellow { background: var(--yellow); }
  .feed-dot.red { background: var(--red); }
  .feed-text { color: var(--muted); flex: 1; }
  .feed-text strong { color: var(--text); }
  .feed-time { color: var(--border); font-size: 10px; white-space: nowrap; }

  /* Toast */
  .toast-container { position: fixed; bottom: 24px; right: 24px; display: flex; flex-direction: column; gap: 8px; z-index: 1000; }
  .toast { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; font-size: 13px; display: flex; align-items: center; gap: 8px; animation: slideIn 0.3s ease; max-width: 320px; }
  .toast.success { border-left: 3px solid var(--green); }
  .toast.error   { border-left: 3px solid var(--red); }
  .toast.info    { border-left: 3px solid var(--accent); }
  @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

  /* Responsive */
  @media (max-width: 900px) { .stats { grid-template-columns: repeat(2, 1fr); } .grid { grid-template-columns: 1fr; } }

  /* Overlay when down */
  .service-overlay { display: none; position: fixed; inset: 0; background: rgba(13,17,23,0.85); z-index: 50; align-items: center; justify-content: center; flex-direction: column; gap: 16px; backdrop-filter: blur(4px); }
  .service-overlay.visible { display: flex; }
  .overlay-icon { font-size: 48px; }
  .overlay-title { font-size: 22px; font-weight: 700; color: var(--red); }
  .overlay-sub { color: var(--muted); font-size: 14px; text-align: center; max-width: 360px; }
  .spinner { width: 20px; height: 20px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>

<div class="header">
  <div class="logo">
    <div class="logo-icon">📦</div>
    OrderFlow
  </div>
  <div class="status-badge healthy" id="statusBadge">
    <span class="dot"></span>
    <span id="statusText">OPERATIONAL</span>
  </div>
</div>

<div class="main">
  <div class="error-banner" id="errorBanner">
    <span>⚠</span>
    <span id="errorMsg">Service degraded</span>
  </div>

  <div class="stats">
    <div class="stat-card">
      <div class="stat-val" id="statTotal">0</div>
      <div class="stat-lbl">Total Orders</div>
    </div>
    <div class="stat-card">
      <div class="stat-val green" id="statRevenue">$0</div>
      <div class="stat-lbl">Revenue</div>
    </div>
    <div class="stat-card">
      <div class="stat-val yellow" id="statPending">0</div>
      <div class="stat-lbl">Pending</div>
    </div>
    <div class="stat-card">
      <div class="stat-val purple" id="statUptime">0s</div>
      <div class="stat-lbl">Uptime</div>
    </div>
  </div>

  <div class="grid">
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Orders</span>
        <span id="orderCount" style="font-size:12px;color:var(--muted)">0 orders</span>
      </div>
      <div class="panel-body">
        <table>
          <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead>
          <tbody id="ordersBody"></tbody>
        </table>
      </div>
    </div>

    <div class="side">
      <div class="panel">
        <div class="panel-header"><span class="panel-title">New Order</span></div>
        <div class="form">
          <div>
            <label>Customer Name</label>
            <input id="fName" placeholder="e.g. Ivan Horvat">
          </div>
          <div>
            <label>Email</label>
            <input id="fEmail" type="email" placeholder="ivan@example.com">
          </div>
          <div>
            <label>Item</label>
            <div class="items-row">
              <input id="fItem" placeholder="Product name">
              <input id="fQty" type="number" value="1" min="1">
              <input id="fPrice" type="number" placeholder="0.00" step="0.01">
            </div>
          </div>
          <button class="btn btn-primary" id="submitBtn" onclick="createOrder()">Place Order</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><span class="panel-title">Live Activity</span></div>
        <div class="feed" id="activityFeed"></div>
      </div>
    </div>
  </div>
</div>

<!-- Service Down Overlay -->
<div class="service-overlay" id="overlay">
  <div class="overlay-icon" id="overlayIcon">💥</div>
  <div class="overlay-title" id="overlayTitle">Service Down</div>
  <div class="overlay-sub" id="overlaySub">The service is currently unavailable. AI On-Call is investigating...</div>
  <div style="display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px;">
    <div class="spinner"></div>
    Waiting for AI agent to restore service...
  </div>
</div>

<div class="toast-container" id="toasts"></div>

<script>
const STATUS_LABELS = { healthy: "OPERATIONAL", memory_leak: "MEMORY LEAK", config_error: "DB CONFIG ERROR" };
const STATUS_ICONS = { healthy: "📦", memory_leak: "💥", config_error: "🔴" };
const OVERLAY_SUBS = {
  memory_leak: "OOM killer triggered — service cannot allocate memory. AI On-Call is investigating...",
  config_error: "Database connection refused — environment misconfigured. AI On-Call is investigating..."
};

let orders = [];
let state = "healthy";

// ── SSE ────────────────────────────────────────────────────────────────────

function connectSSE() {
  const es = new EventSource("/events");
  es.addEventListener("connected", e => {
    const data = JSON.parse(e.data);
    updateStats(data);
    setState(data.state);
  });
  es.addEventListener("order_created", e => {
    const order = JSON.parse(e.data);
    orders.unshift(order);
    renderOrders();
    addFeedItem("blue", \`New order <strong>\${order.id}</strong> from <strong>\${order.customer}</strong> — $\${order.total}\`);
    toast("info", \`Order \${order.id} created\`);
  });
  es.addEventListener("order_updated", e => {
    const updated = JSON.parse(e.data);
    const idx = orders.findIndex(o => o.id === updated.id);
    if (idx > -1) orders[idx] = updated;
    renderOrders();
    addFeedItem("yellow", \`Order <strong>\${updated.id}</strong> status → <strong>\${updated.status}</strong>\`);
  });
  es.addEventListener("order_deleted", e => {
    const { id } = JSON.parse(e.data);
    orders = orders.filter(o => o.id !== id);
    renderOrders();
    addFeedItem("red", \`Order <strong>\${id}</strong> deleted\`);
  });
  es.addEventListener("stats_updated", e => updateStats(JSON.parse(e.data)));
  es.addEventListener("state_changed", e => {
    const { state } = JSON.parse(e.data);
    setState(state);
    if (state !== "healthy") {
      addFeedItem("red", \`Service state changed → <strong>\${state}</strong>\`);
    } else {
      addFeedItem("green", \`Service <strong>restored</strong> by AI agent ✓\`);
      toast("success", "Service restored by AI On-Call agent!");
    }
  });
  es.onerror = () => setTimeout(connectSSE, 3000);
}

// ── Load initial data ───────────────────────────────────────────────────────

async function loadOrders() {
  try {
    const r = await fetch("/api/orders");
    if (!r.ok) return;
    const data = await r.json();
    orders = data.orders;
    renderOrders();
  } catch {}
}

// ── Render ──────────────────────────────────────────────────────────────────

function renderOrders() {
  const body = document.getElementById("ordersBody");
  document.getElementById("orderCount").textContent = orders.length + " orders";
  if (!orders.length) {
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:32px">No orders yet</td></tr>';
    return;
  }
  body.innerHTML = orders.map(o => \`
    <tr>
      <td class="order-id">\${o.id}</td>
      <td class="customer-info"><div class="name">\${o.customer}</div><div class="email">\${o.email}</div></td>
      <td style="color:var(--muted);font-size:12px">\${o.items.map(i => i.name).join(", ")}</td>
      <td class="amount">$\${o.total.toFixed(2)}</td>
      <td><span class="pill \${o.status}" onclick="cycleStatus('\${o.id}', '\${o.status}')">\${o.status}</span></td>
      <td><button class="btn btn-sm btn-ghost" onclick="deleteOrder('\${o.id}')">✕</button></td>
    </tr>
  \`).join("");
}

const STATUS_CYCLE = { pending: "processing", processing: "shipped", shipped: "delivered", delivered: "pending", cancelled: "pending" };

async function cycleStatus(id, current) {
  if (state !== "healthy") { toast("error", "Service unavailable"); return; }
  const next = STATUS_CYCLE[current];
  try {
    const r = await fetch(\`/api/orders/\${id}/status\`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
    if (!r.ok) toast("error", "Failed to update status");
  } catch { toast("error", "Network error"); }
}

async function deleteOrder(id) {
  if (state !== "healthy") { toast("error", "Service unavailable"); return; }
  if (!confirm(\`Delete order \${id}?\`)) return;
  try {
    await fetch(\`/api/orders/\${id}\`, { method: "DELETE" });
  } catch { toast("error", "Network error"); }
}

async function createOrder() {
  if (state !== "healthy") { toast("error", "Service unavailable — " + state); return; }
  const name = document.getElementById("fName").value.trim();
  const email = document.getElementById("fEmail").value.trim();
  const item = document.getElementById("fItem").value.trim();
  const qty = parseInt(document.getElementById("fQty").value) || 1;
  const price = parseFloat(document.getElementById("fPrice").value) || 0;
  if (!name || !email || !item || price <= 0) { toast("error", "Please fill in all fields"); return; }
  const btn = document.getElementById("submitBtn");
  btn.disabled = true; btn.textContent = "Placing...";
  try {
    const r = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer: name, email, items: [{ name: item, qty, price }] }) });
    if (r.ok) {
      document.getElementById("fName").value = "";
      document.getElementById("fEmail").value = "";
      document.getElementById("fItem").value = "";
      document.getElementById("fQty").value = "1";
      document.getElementById("fPrice").value = "";
    } else { toast("error", "Failed to create order"); }
  } catch { toast("error", "Network error"); }
  btn.disabled = false; btn.textContent = "Place Order";
}

// ── State ───────────────────────────────────────────────────────────────────

function setState(newState) {
  state = newState;
  const badge = document.getElementById("statusBadge");
  badge.className = "status-badge " + newState;
  document.getElementById("statusText").textContent = STATUS_LABELS[newState] || newState.toUpperCase();

  const overlay = document.getElementById("overlay");
  const banner = document.getElementById("errorBanner");

  if (newState === "healthy") {
    overlay.classList.remove("visible");
    banner.classList.remove("visible");
    document.getElementById("submitBtn").disabled = false;
  } else {
    overlay.classList.add("visible");
    document.getElementById("overlayIcon").textContent = STATUS_ICONS[newState];
    document.getElementById("overlayTitle").textContent = newState === "memory_leak" ? "OOM — Out of Memory" : "Database Config Error";
    document.getElementById("overlaySub").textContent = OVERLAY_SUBS[newState];
    banner.className = "error-banner visible" + (newState === "memory_leak" ? " yellow" : "");
    document.getElementById("errorMsg").textContent = newState === "memory_leak" ? "⚡ Memory leak detected — service is unstable, requests are failing" : "🔴 Database configuration error — connection refused on every startup attempt";
    document.getElementById("submitBtn").disabled = true;
  }
}

function updateStats(data) {
  document.getElementById("statTotal").textContent = data.total;
  document.getElementById("statRevenue").textContent = "$" + data.revenue;
  document.getElementById("statPending").textContent = data.byStatus?.pending || 0;
  document.getElementById("statUptime").textContent = data.uptime + "s";
}

// ── Activity feed ───────────────────────────────────────────────────────────

function addFeedItem(color, text) {
  const feed = document.getElementById("activityFeed");
  const now = new Date().toLocaleTimeString();
  const item = document.createElement("div");
  item.className = "feed-item";
  item.innerHTML = \`<span class="feed-dot \${color}"></span><span class="feed-text">\${text}</span><span class="feed-time">\${now}</span>\`;
  feed.prepend(item);
  while (feed.children.length > 30) feed.removeChild(feed.lastChild);
}

// ── Toast ───────────────────────────────────────────────────────────────────

function toast(type, msg) {
  const container = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Init ────────────────────────────────────────────────────────────────────

loadOrders();
connectSSE();
setInterval(async () => {
  try {
    const r = await fetch("/api/stats");
    if (r.ok) updateStats(await r.json());
  } catch {}
}, 5000);
</script>
</body>
</html>`);
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`OrderFlow running on http://localhost:${PORT}`);
  console.log(`  GET  /          - Dashboard UI`);
  console.log(`  GET  /api/orders           - List orders`);
  console.log(`  POST /api/orders           - Create order`);
  console.log(`  PATCH /api/orders/:id/status - Update status`);
  console.log(`  DELETE /api/orders/:id     - Delete order`);
  console.log(`  GET  /events               - SSE stream`);
  console.log(`  POST /chaos/memory-leak    - Scenario A`);
  console.log(`  POST /chaos/config-error   - Scenario B`);
  console.log(`  POST /chaos/recover        - Recover`);
});

export { appState as state, AppState };
