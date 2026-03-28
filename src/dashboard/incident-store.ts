import { EventEmitter } from "events";
import { Alert, InvestigationResult } from "../types";

export type IncidentStatus = "investigating" | "fixed" | "escalated";

export interface Incident {
  id: string;
  alert: Alert;
  status: IncidentStatus;
  startedAt: string;
  resolvedAt?: string;
  result?: InvestigationResult;
}

class IncidentStore extends EventEmitter {
  private incidents: Incident[] = [];

  create(alert: Alert): Incident {
    const incident: Incident = {
      id: `inc-${Date.now()}`,
      alert,
      status: "investigating",
      startedAt: new Date().toISOString(),
    };
    this.incidents.unshift(incident);
    this.emit("update", incident);
    return incident;
  }

  resolve(id: string, result: InvestigationResult) {
    const inc = this.incidents.find(i => i.id === id);
    if (!inc) return;
    inc.status = result.fix_applied ? "fixed" : "escalated";
    inc.resolvedAt = new Date().toISOString();
    inc.result = result;
    this.emit("update", inc);
  }

  getAll(): Incident[] {
    return this.incidents;
  }
}

export const store = new IncidentStore();
