# SuperPlane Setup Guide

## Preduslovi

SuperPlane je cloud servis — ne može pristupiti `localhost`. Potreban je **ngrok** da expose-uje lokalne servere.

## Korak 1 — Expose lokalnih servera sa ngrok

```bash
# Terminal 1 — expose webhook server (port 3000)
ngrok http 3000

# Terminal 2 — expose agent server (port 3001)
ngrok http 3001
```

ngrok će dati URL-ove u formi `https://abc123.ngrok-free.app`.

## Korak 2 — Postavi env varijable u .env

```env
WEBHOOK_SERVER_URL=https://abc123.ngrok-free.app   # ngrok URL za port 3000
AGENT_URL=https://xyz789.ngrok-free.app            # ngrok URL za port 3001
```

> Na besplatnom ngrok planu, oba tunnela zahtijevaju dva terminala.
> Alternativa: jedan ngrok na port 3000 i hardkodirati `AGENT_URL=http://localhost:3001`
> u SuperPlane env vars (ako SuperPlane i agent rade na istoj mašini).

## Korak 3 — Kreiraj workflow u SuperPlane UI

### Workflow 1: Incident Triage

1. Otvori SuperPlane → New Workflow
2. Importuj `superplane/workflows/incident-triage.yaml`
3. Kopiraj **webhook trigger URL** (npr. `https://superplane.io/hooks/abc...`)
4. Stavi taj URL u `.env`:
   ```env
   SUPERPLANE_TRIAGE_WEBHOOK_URL=https://superplane.io/hooks/abc...
   ```

### Workflow 2: AI Investigation (opcionalno)

Ovaj workflow je alternativa — može SuperPlane direktno zvati AI agenta umjesto nas.

1. Importuj `superplane/workflows/ai-investigation.yaml`
2. Kopiraj webhook trigger URL
3. Ažuriraj `incident-triage.yaml` → "Forward to AI Investigation" URL na ovaj webhook

## Korak 4 — Postavi env varijable u SuperPlane

U SuperPlane UI → Settings → Environment Variables, dodaj:

| Key | Value |
|-----|-------|
| `WEBHOOK_SERVER_URL` | ngrok URL za port 3000 |
| `AGENT_URL` | ngrok URL za port 3001 |
| `DISCORD_WEBHOOK_URL` | Discord webhook URL |

## Korak 5 — Test end-to-end

```bash
# Pokreni sve servere
npm run dev:full

# Scenario A — AI fiksuje (expect: Discord RESOLVED)
curl -X POST http://localhost:3002/chaos/scenario-a

# Scenario B — AI ne može (expect: Discord ESCALATION)
curl -X POST http://localhost:3002/chaos/scenario-b
```

## Flow sa SuperPlane

```
curl /chaos/scenario-a
       ↓
mock-service → POST /webhooks/alert (webhook-server :3000)
       ↓
webhook-server → POST SUPERPLANE_TRIAGE_WEBHOOK_URL
       ↓
SuperPlane: Incident Triage workflow
  ├── GET /mock/logs
  ├── GET /mock/metrics        (paralelno)
  └── GET /mock/deployments
       ↓
SuperPlane → POST /trigger/investigate (webhook-server :3000)
       ↓
webhook-server → POST /agent/investigate (agent :3001)
       ↓
AI Agent (Groq llama) — agentic loop
  ├── get_logs, get_metrics, get_deployments
  ├── run_health_check
  ├── restart_service / rollback_deployment
  └── run_health_check (verify)
       ↓
fix_applied=true  → Dashboard: RESOLVED
fix_applied=false → Discord: ESCALATION embed
```

## Troubleshooting

**SuperPlane ne može da dohvati podatke**: Provjeri da je ngrok aktivan i da su env varijable u SuperPlane ažurirane.

**Workflow ne prima alert**: Provjeri da je `SUPERPLANE_TRIAGE_WEBHOOK_URL` u `.env` ispravno postavljen i da su serveri restartoavani.

**Groq 429 daily limit**: Zamijeni u `.env` sa `GROQ_MODEL=llama-3.1-8b-instant` (500k TPD). Resetuje svaki dan u ponoć UTC.
