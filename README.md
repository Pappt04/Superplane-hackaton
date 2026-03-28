# Superplane-hackaton
Superplane challenge

Odlicno! SuperPlane je "n8n za DevOps" - event-driven workflow orchestration
  sa 40+ integrations ukljucujuci Claude, Grafana, AWS, Slack, PagerDuty.     
  Savrseno za ovo.

  Evo arhitekture AI Dezurnog Inzenjera:                                        
  
  ---                                                                           
  Arhitektura     
                                                                                
  Alert (Grafana/DataDog)
          ↓                                                                     
    SuperPlane Workflow
          ↓                                                                     
    [Parallel Context Fetch]
    ├── Logs (CloudWatch/Grafana)                                               
    ├── Recent deployments (GitHub)                                             
    ├── Metrics (Prometheus)
    └── Error rates                                                             
          ↓                                                                     
    Claude API - Investigates
          ↓                                                                     
    Claude predlaze fix                                                         
          ↓
    [Pokusaj auto-fixa]                                                         
    ├── Restart servisa                                                         
    ├── Rollback deploymenta                                                    
    └── Scale up resurse                                                        
          ↓                                                                     
    Provjera da li je fix radio
      /           \                                                             
    DA             NE
    |               |                                                           
  Close          Page inzenjera
  incident       (Slack/PagerDuty)                                              
                 sa: kontekst +                                                 
                 root cause +
                 predlozeni fix                                                 
                  
  ---                                                                           
  Sto cemo izgraditi
                                                                                
  3 SuperPlane Workflowa:
                                                                                
  1. incident-triage — prima alert, prikuplja kontekst paralelno                
  2. ai-investigation — Claude analizira, predlaze fix, pokusava                
  auto-remedijaciju                                                             
  3. human-escalation — budi inzenjera sa kompletnim briefingom
                                                                                
  Claude ce biti "agent sa alatima" — Tool Use API sa alatima:                  
  - get_logs                                                                    
  - get_metrics                                                                 
  - restart_service
  - rollback_deployment
  - scale_service                                                               
  - run_health_check
                                                                                
  ---             
Osoba 1 — SuperPlane + Infrastruktura
                                                                                
  Gradim AI on-call inzenjera za hakaton (SuperPlane + Claude API).
  Radim sa jos jednom osobom - ona pravi Claude agenta.                         
                                                                                
  Moj zadatak: sve sto se tice SuperPlane i infrastrukture.                     
                                                                                
  === 1. SUPERPLANE WORKFLOWS ===                                               
                  
  Kreiraj 3 workflow YAML fajla u `superplane/workflows/`:                      
                  
  `incident-triage.yaml`:                                                       
  - Webhook trigger: prima Grafana/PagerDuty alert
  - Paralelno: get-logs + get-metrics + get-recent-deployments                  
  - Prosledjuje sve u ai-investigation                                          
                                                                                
  `ai-investigation.yaml`:                                                      
  - Prima context iz triage                                                     
  - HTTP action: POST http://localhost:3001/agent/investigate (timeout 120s)
  - Ako fix_applied: true -> zatvori incident (Slack: "AI resio problem")       
  - Ako fix_applied: false -> human-escalation                                  
                                                                                
  `human-escalation.yaml`:                                                      
  - Slack Block Kit poruka na #incidents
  - Sadrzaj: servis, root_cause, sta je AI pokusao, proposed_fix                
                                                                                
  === 2. SUPERPLANE INTEGRATIONS ===                                            
                                                                                
  Kreiraj u `superplane/integrations/`:                                         
  - `grafana-webhook.yaml` - mapiranje alert fielda
  - `slack-action.yaml` - eskalacioni template sa svim poljima                  
  - `github-action.yaml` - recent deployments via GitHub API
  - `claude-agent-action.yaml` - HTTP poziv ka nasem agentu                     
                  
  === 3. WEBHOOK SERVER ===                                                     
                  
  Kreiraj `src/webhook-server.ts`:                                              
  - Express server, port 3000
  - POST /webhooks/alert - prima alert, triggera SuperPlane workflow            
  - POST /demo/trigger - rucno triggera incident (za prezentaciju)              
  - GET /health                                                                 
                                                                                
  === 4. MOCK INFRASTRUCTURE ===
                                                                                
  Kreiraj `src/mock/broken-service.ts`:
  - Express server, port 3002
  - GET /health -> naizmenicno 200/503
  - POST /chaos/crash -> forsira pad + salje webhook alert                      
  - POST /chaos/recover -> oporavak servisa
  - Emituje realan Grafana-format webhook                                       
                  
  === 5. DEMO DASHBOARD ===                                                     
                  
  Kreiraj `public/index.html` + `src/dashboard/server.ts`:                      
  - Tamna tema, terminalni look
  - SSE real-time feed incidenata                                               
  - Svaki incident: status badge, vreme, expand za AI analizu
  - Dugme "Trigger Demo Incident"                                               
                                                                                
  Stack: TypeScript, Express                                                    
  Shared types idu u `src/types/index.ts` - koordinisi sa drugom osobom.        
                                                                                
  ---
  Osoba 2 — Claude AI Agent + Integrations                                      
                                                                                
  Gradim AI on-call inzenjera za hakaton (SuperPlane + Claude API).
  Radim sa jos jednom osobom - ona pravi SuperPlane i infrastrukturu.           
                                                                                
  Moj zadatak: Claude AI agent i sve sto mu treba da istrazuje incidente.       
                                                                                
  === 1. SHARED TYPES ===                                                       
                  
  Kreiraj `src/types/index.ts` (koordinisi sa drugom osobom):                   
  
  interface Alert { service: string; severity: string; message: string;         
  timestamp: string }
  interface ServiceContext { logs: LogEntry[]; metrics: ServiceMetrics;         
  deployments: Deployment[] }
  interface InvestigationRequest { alert: Alert; context: ServiceContext }
  interface InvestigationResult {                                               
    root_cause: string;
    actions_taken: string[];                                                    
    fix_applied: boolean;                                                       
    proposed_fix: string;
    confidence: number;                                                         
    full_timeline: string;
  }

  === 2. CONTEXT FETCHERS ===                                                   
  
  `src/integrations/log-fetcher.ts`:                                            
  - getLogs(service, minutes): Promise<LogEntry[]>
  - Mock: realisticni error logovi (OOM, connection refused, timeout, segfault) 
                                                                                
  `src/integrations/metrics-fetcher.ts`:                                        
  - getMetrics(service): Promise<ServiceMetrics>                                
  - Mock: kad servis pada: cpu 95%, memory 98%, error_rate 100%, latency 5000ms
                                                                                
  `src/integrations/deployment-fetcher.ts`:
  - getRecentDeployments(service, hours): Promise<Deployment[]>                 
  - Mock: 3-5 deploymenta, zadnji pre incidenta izgleda sumnjivo
                                                                                
  === 3. CLAUDE AI AGENT ===
                                                                                
  `src/agent/incident-investigator.ts`:
  - Prima InvestigationRequest, vraca InvestigationResult
  - Model: claude-opus-4-6, adaptive thinking, streaming                        
  - Manuel agentic loop (nije tool runner - treba nam kontrola)                 
                                                                                
  Alati za Claude:                                                              
  - get_logs(service, time_range)                                               
  - get_metrics(service, metric_name)                                           
  - run_health_check(service) -> 200 ili 503
  - restart_service(service) -> 80% success                                     
  - rollback_deployment(service, version) -> uvijek uspjesno                    
  - scale_service(service, replicas)                                            
                                                                                
  System prompt: "Ti si AI dezurni inzenjer. Istrazujes incidente metodicno:    
  1. Prikupi sve podatke pre nego sto zakljucis                                 
  2. Identifikuj root cause sa dokazima iz logova/metrika                       
  3. Pokusaj najsigurniji fix prvo (restart pre rollbacka)                      
  4. Ako fix ne uspije, dokumentuj sta si pokusao i predlozi sledeci korak"     
                                                                                
  === 4. HTTP SERVER ===                                                        
                                                                                
  `src/agent/server.ts`:                                                        
  - Express server, port 3001
  - POST /agent/investigate -> poziva Claude agenta, vraca InvestigationResult  
  - Streamu progres na konzolu tokom istrage                                    
  - Timeout handling: 120s max                                                  
                                                                                
  Stack: TypeScript, Express, @anthropic-ai/sdk                                 
  ANTHROPIC_API_KEY iz .env
                                                                                
  ---             
  Redosled rada
               
  Oba odmah:     Dogovorite src/types/index.ts zajedno (5 min)
                 pa svako radi neovisno                                         
                                                                                
  Osoba 2 prva:  Mock context fetcheri gotovi za ~30min                         
                 -> Osoba 1 moze testirati webhook flow                         
                                                                                
  Sat 2:         Integracija - Osoba 1 poziva Osoba 2 HTTP endpoint             
                 -> End-to-end test: alert ulazi, AI istrazuje, Slack poruka    
  izlazi
