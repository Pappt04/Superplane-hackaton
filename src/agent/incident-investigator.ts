import Groq from "groq-sdk";
import { getLogs } from "../integrations/log-fetcher";
import { getMetrics, setServiceStatus, getServiceStatus } from "../integrations/metrics-fetcher";
import { getRecentDeployments } from "../integrations/deployment-fetcher";
import { InvestigationRequest, InvestigationResult } from "../types";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `Ti si AI dezurni inzenjer. Istrazujes production incidente metodicno i konzervativno.

Tvoj proces:
1. UVIJEK prvo prikupi sve podatke (logs, metrics, deployments) pre nego zakljucis
2. Identifikuj root cause sa konkretnim dokazima iz logova i metrika
3. Pokusaj fix redosledom: restart -> rollback -> scale (od najmanje do najvise invazivnog)
4. Nakon svakog fix-a, uradi health check da proveris da li je pomoglo
5. Ako fix nije uspio nakon 2 pokusaja, dokumentuj sve i predlozi sledeci korak za coveka

Budi koncizan ali precizan. Svaka akcija mora biti opravdana dokazima.`;

const TOOLS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_logs",
      description: "Dohvati error logove servisa za zadati vremenski period",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string", description: "Naziv servisa" },
          minutes: { type: "number", description: "Koliko minuta unazad (default: 30)" },
        },
        required: ["service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_metrics",
      description: "Dohvati trenutne metrike servisa: CPU, memory, error rate, latency",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string", description: "Naziv servisa" },
        },
        required: ["service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_deployments",
      description: "Dohvati listu nedavnih deploymenta za servis",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string", description: "Naziv servisa" },
          hours: { type: "number", description: "Koliko sati unazad (default: 24)" },
        },
        required: ["service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_health_check",
      description: "Provjeri da li servis odgovara na health check endpoint",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string", description: "Naziv servisa" },
        },
        required: ["service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "restart_service",
      description: "Restartuj servis. Bezbijedna opcija, ne gubi podatke. 80% sansa uspjeha.",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string", description: "Naziv servisa za restart" },
        },
        required: ["service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rollback_deployment",
      description: "Rollbackuj servis na prethodnu verziju deploymenta",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string", description: "Naziv servisa" },
          version: { type: "string", description: "Verzija na koju rollbackujemo (npr. v1.11.2)" },
        },
        required: ["service", "version"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scale_service",
      description: "Promijeni broj instanci servisa (scale up/down)",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string", description: "Naziv servisa" },
          replicas: { type: "number", description: "Broj instanci" },
        },
        required: ["service", "replicas"],
      },
    },
  },
];

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  const service = input.service as string;

  switch (name) {
    case "get_logs": {
      const logs = await getLogs(service, (input.minutes as number) || 30);
      return logs.map(l => `[${l.timestamp}] ${l.level}: ${l.message}`).join("\n");
    }
    case "get_metrics": {
      const metrics = await getMetrics(service);
      return JSON.stringify({
        cpu: `${metrics.cpu_percent.toFixed(1)}%`,
        memory: `${metrics.memory_percent.toFixed(1)}%`,
        error_rate: `${(metrics.error_rate * 100).toFixed(1)}%`,
        latency_p99: `${metrics.latency_p99_ms}ms`,
        req_per_min: Math.round(metrics.request_count_per_min),
      });
    }
    case "get_recent_deployments": {
      const deployments = await getRecentDeployments(service, (input.hours as number) || 24);
      return deployments.map(d =>
        `[${d.timestamp}] ${d.version} by ${d.author}: "${d.commit_message}" (${d.status})`
      ).join("\n");
    }
    case "run_health_check": {
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      const currentStatus = getServiceStatus(service);
      // Reflect actual service state — healthy/degraded pass, down/config_error fail
      const healthy = currentStatus === "healthy" || (currentStatus === "degraded" && Math.random() > 0.5);
      return healthy
        ? `✓ Health check OK - ${service} responding in ${80 + Math.floor(Math.random() * 120)}ms`
        : `✗ Health check FAILED - ${service} not responding (connection refused)`;
    }
    case "restart_service": {
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
      // config_error scenario: restart nikada ne pomaze (problem je u konfiguraciji, ne kodu)
      if (getServiceStatus(service) === "config_error") {
        return `✗ Restart failed - ${service} cannot start. Error: DATABASE_URL is invalid or unreachable. Configuration issue — restart will not help.`;
      }
      const success = Math.random() > 0.2;
      if (success) {
        setServiceStatus(service, "healthy");
        return `✓ ${service} restarted successfully. New instance started, passing health checks.`;
      }
      return `✗ Restart failed - ${service} crashed again immediately (exit code 137). Likely OOM issue persists.`;
    }
    case "rollback_deployment": {
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
      // config_error scenario: rollback ne pomaze jer je problem u env varijablama, ne kodu
      if (getServiceStatus(service) === "config_error") {
        return `✗ Rollback failed - ${service} still cannot connect to database after rollback. Issue is in environment configuration (DATABASE_URL), not in application code.`;
      }
      setServiceStatus(service, "healthy");
      return `✓ Rolled back ${service} to ${input.version as string}. Deployment complete, service healthy.`;
    }
    case "scale_service": {
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
      return `✓ Scaled ${service} to ${input.replicas as number} replicas. New instances starting up.`;
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

export async function investigateIncident(request: InvestigationRequest): Promise<InvestigationResult> {
  const { alert, context } = request;

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `
Incident alert: ${alert.message}
Service: ${alert.service}
Severity: ${alert.severity}
Time: ${alert.timestamp}

Pre-fetched context:
- Logs (last 30 min): ${context.logs.length} entries, latest error: "${context.logs.filter(l => l.level === "ERROR").slice(-1)[0]?.message || "none"}"
- Metrics: CPU ${context.metrics.cpu_percent.toFixed(0)}%, Memory ${context.metrics.memory_percent.toFixed(0)}%, Error rate ${(context.metrics.error_rate * 100).toFixed(0)}%
- Recent deployments: ${context.deployments.length} in last 24h, latest: "${context.deployments.slice(-1)[0]?.commit_message || "none"}"

Istrazisi incident i pokusaj da ga rijesis. Koristi alate po potrebi.
`.trim(),
    },
  ];

  const actionsTaken: string[] = [];
  const timelineEntries: string[] = [`[START] Incident detected: ${alert.message}`];
  let fixApplied = false;
  let lastText = "";

  console.log(`\n${"=".repeat(60)}`);
  console.log(`AI INVESTIGATION: ${alert.service} - ${alert.severity}`);
  console.log("=".repeat(60));

  // Agentic loop
  while (true) {
    let response: Groq.Chat.ChatCompletion;
    try {
      response = await client.chat.completions.create({
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        max_tokens: 4096,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = msg.includes("429") || msg.toLowerCase().includes("rate limit");
      console.log(`\n[WARN] LLM error (${isRateLimit ? "rate limit" : "tool format"}) — breaking loop: ${msg.slice(0, 200)}`);
      if (!lastText) {
        lastText = isRateLimit
          ? `Investigation interrupted: Groq API daily token limit reached. Actions taken before limit: see actions_taken. Root cause based on collected data: service is down with critical metrics (CPU/memory near 100%, error rate >98%). Predlazem: manual investigation required — check recent deployments and environment configuration.`
          : `Investigation interrupted due to model tool formatting error. Based on data collected so far, see actions_taken for attempted fixes.`;
      }
      break;
    }

    const message = response.choices[0].message;
    const stopReason = response.choices[0].finish_reason;

    if (message.content) {
      process.stdout.write(message.content + "\n");
      lastText = message.content;
      timelineEntries.push(`[AI] ${message.content.trim()}`);
    }

    messages.push(message);

    if (stopReason === "stop" || !message.tool_calls || message.tool_calls.length === 0) {
      break;
    }

    // Izvrsi tool calls
    for (const tc of message.tool_calls) {
      const input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      console.log(`\n[TOOL] ${tc.function.name}(${tc.function.arguments})`);

      const result = await executeTool(tc.function.name, input);
      console.log(`[RESULT] ${result.slice(0, 150)}\n`);

      const actionLine = `${tc.function.name}(${tc.function.arguments}) -> ${result.slice(0, 100)}`;
      actionsTaken.push(actionLine);
      timelineEntries.push(`[ACTION] ${actionLine}`);

      if ((tc.function.name === "restart_service" || tc.function.name === "rollback_deployment") && result.startsWith("✓")) {
        fixApplied = true;
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  const rootCauseMatch = lastText.match(/root.?cause[:\s]+([^\n.]+)/i);
  const proposedFixMatch = lastText.match(/predlaz[^\n]+[:\s]+([^\n]+)/i) ||
                           lastText.match(/preporuc[^\n]+[:\s]+([^\n]+)/i) ||
                           lastText.match(/next step[:\s]+([^\n]+)/i);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`INVESTIGATION COMPLETE - fix_applied: ${fixApplied}`);
  console.log("=".repeat(60) + "\n");

  return {
    root_cause: rootCauseMatch?.[1]?.trim() || lastText.slice(0, 800),
    actions_taken: actionsTaken,
    fix_applied: fixApplied,
    proposed_fix: fixApplied ? "" : (proposedFixMatch?.[1]?.trim() || lastText.slice(0, 900)),
    confidence: fixApplied ? 0.9 : 0.6,
    full_timeline: timelineEntries.join("\n"),
  };
}
