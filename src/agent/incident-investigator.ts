import { GoogleGenerativeAI, FunctionDeclaration, Tool, Part, SchemaType } from "@google/generative-ai";
import { getLogs } from "../integrations/log-fetcher";
import { getMetrics, setServiceStatus } from "../integrations/metrics-fetcher";
import { getRecentDeployments } from "../integrations/deployment-fetcher";
import { InvestigationRequest, InvestigationResult } from "../types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const SYSTEM_PROMPT = `Ti si AI dezurni inzenjer. Istrazujes production incidente metodicno i konzervativno.

Tvoj proces:
1. UVIJEK prvo prikupi sve podatke (logs, metrics, deployments) pre nego zakljucis
2. Identifikuj root cause sa konkretnim dokazima iz logova i metrika
3. Pokusaj fix redosledom: restart -> rollback -> scale (od najmanje do najvise invazivnog)
4. Nakon svakog fix-a, uradi health check da proveris da li je pomoglo
5. Ako fix nije uspio nakon 2 pokusaja, dokumentuj sve i predlozi sledeci korak za coveka

Budi koncizan ali precizan. Svaka akcija mora biti opravdana dokazima.`;

const FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "get_logs",
    description: "Dohvati error logove servisa za zadati vremenski period",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        service: { type: SchemaType.STRING, description: "Naziv servisa" },
        minutes: { type: SchemaType.NUMBER, description: "Koliko minuta unazad (default: 30)" },
      },
      required: ["service"],
    },
  },
  {
    name: "get_metrics",
    description: "Dohvati trenutne metrike servisa: CPU, memory, error rate, latency",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        service: { type: SchemaType.STRING, description: "Naziv servisa" },
      },
      required: ["service"],
    },
  },
  {
    name: "get_recent_deployments",
    description: "Dohvati listu nedavnih deploymenta za servis",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        service: { type: SchemaType.STRING, description: "Naziv servisa" },
        hours: { type: SchemaType.NUMBER, description: "Koliko sati unazad (default: 24)" },
      },
      required: ["service"],
    },
  },
  {
    name: "run_health_check",
    description: "Provjeri da li servis odgovara na health check endpoint",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        service: { type: SchemaType.STRING, description: "Naziv servisa" },
      },
      required: ["service"],
    },
  },
  {
    name: "restart_service",
    description: "Restartuj servis. Bezbijedna opcija, ne gubi podatke. 80% sansa uspjeha.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        service: { type: SchemaType.STRING, description: "Naziv servisa za restart" },
      },
      required: ["service"],
    },
  },
  {
    name: "rollback_deployment",
    description: "Rollbackuj servis na prethodnu verziju deploymenta",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        service: { type: SchemaType.STRING, description: "Naziv servisa" },
        version: { type: SchemaType.STRING, description: "Verzija na koju rollbackujemo (npr. v1.11.2)" },
      },
      required: ["service", "version"],
    },
  },
  {
    name: "scale_service",
    description: "Promijeni broj instanci servisa (scale up/down)",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        service: { type: SchemaType.STRING, description: "Naziv servisa" },
        replicas: { type: SchemaType.NUMBER, description: "Broj instanci" },
      },
      required: ["service", "replicas"],
    },
  },
];

const TOOLS: Tool[] = [{ functionDeclarations: FUNCTION_DECLARATIONS }];

// Izvrsavanje alata - isti kao prije, ne zavisi od AI SDK-a
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
      const healthy = Math.random() > 0.8;
      return healthy
        ? `✓ Health check OK - ${service} responding in ${80 + Math.floor(Math.random() * 120)}ms`
        : `✗ Health check FAILED - ${service} not responding (connection refused)`;
    }

    case "restart_service": {
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
      const success = Math.random() > 0.2;
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

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    tools: TOOLS,
    systemInstruction: SYSTEM_PROMPT,
  });

  const chat = model.startChat({ history: [] });

  const userMessage = `
Incident alert: ${alert.message}
Service: ${alert.service}
Severity: ${alert.severity}
Time: ${alert.timestamp}

Pre-fetched context:
- Logs (last 30 min): ${context.logs.length} entries, latest error: "${context.logs.filter(l => l.level === "ERROR").slice(-1)[0]?.message || "none"}"
- Metrics: CPU ${context.metrics.cpu_percent.toFixed(0)}%, Memory ${context.metrics.memory_percent.toFixed(0)}%, Error rate ${(context.metrics.error_rate * 100).toFixed(0)}%
- Recent deployments: ${context.deployments.length} in last 24h, latest: "${context.deployments.slice(-1)[0]?.commit_message || "none"}"

Istrazisi incident i pokusaj da ga rijesis. Koristi alate po potrebi.
`.trim();

  const actionsTaken: string[] = [];
  const timelineEntries: string[] = [`[START] Incident detected: ${alert.message}`];
  let fixApplied = false;
  let lastText = "";

  console.log(`\n${"=".repeat(60)}`);
  console.log(`AI INVESTIGATION: ${alert.service} - ${alert.severity}`);
  console.log("=".repeat(60));

  let currentMessage: string | Part[] = userMessage;

  // Agentic loop
  while (true) {
    // Streaming za prvi tekst, obican za tool rezultate
    const streamResult = await chat.sendMessageStream(currentMessage);

    let fullText = "";
    for await (const chunk of streamResult.stream) {
      const text = chunk.text();
      if (text) {
        process.stdout.write(text);
        fullText += text;
      }
    }

    if (fullText) {
      lastText = fullText;
      timelineEntries.push(`[AI] ${fullText.trim()}`);
    }

    // Dohvati kompletan response da provjerimo function calls
    const response = await streamResult.response;
    const functionCalls = response.functionCalls();

    if (!functionCalls || functionCalls.length === 0) {
      break; // Nema vise tool poziva - zavrsena istraga
    }

    // Izvrsi sve function calls i spremi rezultate
    const functionResponseParts: Part[] = [];

    for (const fc of functionCalls) {
      const input = fc.args as Record<string, unknown>;
      console.log(`\n[TOOL] ${fc.name}(${JSON.stringify(input)})`);

      const result = await executeTool(fc.name, input);
      console.log(`[RESULT] ${result.slice(0, 150)}\n`);

      const actionLine = `${fc.name}(${JSON.stringify(input)}) -> ${result.slice(0, 100)}`;
      actionsTaken.push(actionLine);
      timelineEntries.push(`[ACTION] ${actionLine}`);

      if ((fc.name === "restart_service" || fc.name === "rollback_deployment") && result.startsWith("✓")) {
        fixApplied = true;
      }

      functionResponseParts.push({
        functionResponse: {
          name: fc.name,
          response: { result },
        },
      });
    }

    currentMessage = functionResponseParts;
  }

  const rootCauseMatch = lastText.match(/root.?cause[:\s]+([^\n.]+)/i);
  const proposedFixMatch = lastText.match(/predlaz[^\n]+[:\s]+([^\n]+)/i) ||
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
