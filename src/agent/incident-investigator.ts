import Anthropic from "@anthropic-ai/sdk";
import { getLogs } from "../integrations/log-fetcher";
import { getMetrics, setServiceStatus } from "../integrations/metrics-fetcher";
import { getRecentDeployments } from "../integrations/deployment-fetcher";
import { InvestigationRequest, InvestigationResult } from "../types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Ti si AI dezurni inzenjer. Istrazujes production incidente metodicno i konzervativno.

Tvoj proces:
1. UVIJEK prvo prikupi sve podatke (logs, metrics, deployments) pre nego zakljucis
2. Identifikuj root cause sa konkretnim dokazima iz logova i metrika
3. Pokusaj fix redosledom: restart -> rollback -> scale (od najmanje do najvise invazivnog)
4. Nakon svakog fix-a, uradi health check da proveris da li je pomoglo
5. Ako fix nije uspio nakon 2 pokusaja, dokumentuj sve i predlozi sledeci korak za coveka

Budi koncizan ali precizan. Svaka akcija mora biti opravdana dokazima.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_logs",
    description: "Dohvati error logove servisa za zadati vremenski period",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Naziv servisa" },
        minutes: { type: "number", description: "Koliko minuta unazad (default: 30)" },
      },
      required: ["service"],
    },
  },
  {
    name: "get_metrics",
    description: "Dohvati trenutne metrike servisa: CPU, memory, error rate, latency",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Naziv servisa" },
      },
      required: ["service"],
    },
  },
  {
    name: "get_recent_deployments",
    description: "Dohvati listu nedavnih deploymenta za servis",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Naziv servisa" },
        hours: { type: "number", description: "Koliko sati unazad (default: 24)" },
      },
      required: ["service"],
    },
  },
  {
    name: "run_health_check",
    description: "Provjeri da li servis odgovara na health check endpoint",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Naziv servisa" },
      },
      required: ["service"],
    },
  },
  {
    name: "restart_service",
    description: "Restartuj servis. Bezbijedna opcija, ne gubi podatke. 80% sansa uspjeha.",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Naziv servisa za restart" },
      },
      required: ["service"],
    },
  },
  {
    name: "rollback_deployment",
    description: "Rollbackuj servis na prethodnu verziju deploymenta",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Naziv servisa" },
        version: { type: "string", description: "Verzija na koju rollbackujemo (npr. v1.11.2)" },
      },
      required: ["service", "version"],
    },
  },
  {
    name: "scale_service",
    description: "Promijeni broj instanci servisa (scale up/down)",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Naziv servisa" },
        replicas: { type: "number", description: "Broj instanci" },
      },
      required: ["service", "replicas"],
    },
  },
];

// Izvrsavanje alata
async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  const service = input.service as string;

  switch (name) {
    case "get_logs": {
      const logs = await getLogs(service, (input.minutes as number) || 30);
      return JSON.stringify(logs.map(l => `[${l.timestamp}] ${l.level}: ${l.message}`).join("\n"));
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
      return JSON.stringify(deployments.map(d =>
        `[${d.timestamp}] ${d.version} by ${d.author}: "${d.commit_message}" (${d.status})`
      ).join("\n"));
    }

    case "run_health_check": {
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      // Servis je pao - health check fails, ali nakon restart/rollback moze proci
      const healthy = Math.random() > 0.8;
      return healthy
        ? `✓ Health check OK - ${service} responding in ${80 + Math.floor(Math.random() * 120)}ms`
        : `✗ Health check FAILED - ${service} not responding (connection refused)`;
    }

    case "restart_service": {
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
      const success = Math.random() > 0.2; // 80% success
      if (success) {
        setServiceStatus(service, "healthy");
        return `✓ ${service} restarted successfully. New instance started, passing health checks.`;
      }
      return `✗ Restart failed - ${service} crashed again immediately (exit code 137). Likely OOM issue persists.`;
    }

    case "rollback_deployment": {
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
      const version = input.version as string;
      setServiceStatus(service, "healthy");
      return `✓ Rolled back ${service} to ${version}. Deployment complete, service healthy.`;
    }

    case "scale_service": {
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
      const replicas = input.replicas as number;
      return `✓ Scaled ${service} to ${replicas} replicas. New instances starting up.`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

export async function investigateIncident(request: InvestigationRequest): Promise<InvestigationResult> {
  const { alert, context } = request;

  const userMessage = `
Incident alert: ${alert.message}
Service: ${alert.service}
Severity: ${alert.severity}
Time: ${alert.timestamp}

Pre-fetched context:
- Logs (last 30 min): ${context.logs.length} entries, latest error: "${context.logs.filter(l => l.level === "ERROR").slice(-1)[0]?.message || "none"}"
- Metrics: CPU ${context.metrics.cpu_percent.toFixed(0)}%, Memory ${context.metrics.memory_percent.toFixed(0)}%, Error rate ${(context.metrics.error_rate * 100).toFixed(0)}%
- Recent deployments: ${context.deployments.length} in last 24h, latest: "${context.deployments.slice(-1)[0]?.commit_message || "none"}"

Istrazisi incident i pokusaj da ga rijesIS. Koristi alate po potrebi.
`.trim();

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  const actionsTaken: string[] = [];
  const timelineEntries: string[] = [`[START] Incident detected: ${alert.message}`];
  let fixApplied = false;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`AI INVESTIGATION: ${alert.service} - ${alert.severity}`);
  console.log("=".repeat(60));

  // Manuel agentic loop
  while (true) {
    const stream = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
      stream: true,
    });

    let fullText = "";
    const toolUseBlocks: Anthropic.ToolUseBlock[] = [];
    let currentToolUse: Partial<Anthropic.ToolUseBlock> & { input_json: string } | null = null;
    let stopReason = "";

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          currentToolUse = {
            type: "tool_use",
            id: event.content_block.id,
            name: event.content_block.name,
            input: {},
            input_json: "",
          };
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          process.stdout.write(event.delta.text);
          fullText += event.delta.text;
        } else if (event.delta.type === "input_json_delta" && currentToolUse) {
          currentToolUse.input_json += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        if (currentToolUse) {
          currentToolUse.input = JSON.parse(currentToolUse.input_json || "{}");
          toolUseBlocks.push(currentToolUse as Anthropic.ToolUseBlock);
          currentToolUse = null;
        }
      } else if (event.type === "message_delta") {
        stopReason = event.delta.stop_reason || "";
      }
    }

    if (fullText) {
      timelineEntries.push(`[AI] ${fullText.trim()}`);
    }

    // Dohvati cijeli response za messages historiju
    const assistantContent: Anthropic.MessageParam["content"] = [];
    if (fullText) (assistantContent as Anthropic.ContentBlockParam[]).push({ type: "text", text: fullText });
    for (const tb of toolUseBlocks) (assistantContent as Anthropic.ContentBlockParam[]).push(tb);

    messages.push({ role: "assistant", content: assistantContent });

    if (stopReason === "end_turn" || toolUseBlocks.length === 0) {
      break;
    }

    // Izvrsi alate
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tool of toolUseBlocks) {
      console.log(`\n[TOOL] ${tool.name}(${JSON.stringify(tool.input)})`);
      const result = await executeTool(tool.name, tool.input as Record<string, unknown>);
      console.log(`[RESULT] ${result}\n`);

      const actionLine = `${tool.name}(${JSON.stringify(tool.input)}) -> ${result.slice(0, 100)}`;
      actionsTaken.push(actionLine);
      timelineEntries.push(`[ACTION] ${actionLine}`);

      if ((tool.name === "restart_service" || tool.name === "rollback_deployment") && result.startsWith("✓")) {
        fixApplied = true;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: tool.id,
        content: result,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  // Izvuci zakljucak iz posljednje AI poruke
  const lastMessage = messages.filter(m => m.role === "assistant").slice(-1)[0];
  const lastText = Array.isArray(lastMessage?.content)
    ? lastMessage.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("")
    : "";

  const rootCauseMatch = lastText.match(/root.?cause[:\s]+([^\n.]+)/i);
  const proposedFixMatch = lastText.match(/predlaz[^\n]+fix[:\s]+([^\n]+)/i) ||
                           lastText.match(/preporuc[^\n]+[:\s]+([^\n]+)/i) ||
                           lastText.match(/sledeci korak[:\s]+([^\n]+)/i);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`INVESTIGATION COMPLETE - fix_applied: ${fixApplied}`);
  console.log("=".repeat(60) + "\n");

  return {
    root_cause: rootCauseMatch?.[1]?.trim() || lastText.slice(0, 200),
    actions_taken: actionsTaken,
    fix_applied: fixApplied,
    proposed_fix: fixApplied ? "" : (proposedFixMatch?.[1]?.trim() || lastText.slice(0, 300)),
    confidence: fixApplied ? 0.9 : 0.6,
    full_timeline: timelineEntries.join("\n"),
  };
}
