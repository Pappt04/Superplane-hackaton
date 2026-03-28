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


  Osoba 1 — SuperPlane Workflow Architect
                                                                                  
    Gradim AI on-call inzenjera za hakaton koristeci SuperPlane + Claude API.   
                                                                                  
    Moj zadatak: SuperPlane workflow definicije i event routing.                  
                                                                                  
    Kreiraj sledece fajlove u TypeScript projektu:                                
                                                                                  
    1. `workflows/incident-triage.yaml` - SuperPlane workflow koji:               
       - Prima webhook trigger od Grafana/PagerDuty (POST /webhooks/alert)        
       - Paralelno poziva 3 koraka: get-logs, get-metrics, get-recent-deployments 
       - Prosledjuje sve u ai-investigation workflow                              
                                                                                  
    2. `workflows/ai-investigation.yaml` - SuperPlane workflow koji:              
       - Prima context iz triage-a                                                
       - Poziva nas Claude agent servis (POST /agent/investigate)                 
       - Ako agent vraca fix_applied: true -> zatvara incident                    
       - Ako agent vraca fix_applied: false -> poziva human-escalation workflow   
                                                                                  
    3. `workflows/human-escalation.yaml` - SuperPlane workflow koji:              
       - Prima context + proposed_fix od Claude agenta                            
       - Salje Slack poruku na #incidents kanal                                   
       - Kreira PagerDuty incident sa svim detaljima                              
                                                                                  
    4. `src/webhook-server.ts` - Express server koji:                             
       - Registruje webhook endpoint /webhooks/alert
       - Validira dolazece alertove                                               
       - Triggera SuperPlane workflow via SuperPlane API                          
       - Vraca 200 OK odmah (async processing)                                    
                                                                                  
    Stack: TypeScript, Express, axios                                             
    Nemoj praviti pravi SuperPlane API poziv, koristi mock za sada.               
    Dodaj README sa instrukcijama kako registrovati webhooks u Grafana.           
                                                                                  
    ---                                                                           
    Osoba 2 — Claude AI Agent                                                     
                                                                                  
    Gradim AI on-call inzenjera za hakaton koristeci Claude API.
  
    Moj zadatak: Claude agent koji istrazuje incidente i pokusava                 
    auto-remedijaciju.
                                                                                  
    Kreiraj `src/agent/incident-investigator.ts` koji:
  
    1. Prima InvestigationRequest:                                                
       - alert: { service, severity, message, timestamp }
       - context: { logs: string[], metrics: object, recent_deployments: string[] 
    }                                                                             
                                                                                  
    2. Koristi Claude Opus 4.6 sa Tool Use (manuel agentic loop, ne tool runner)  
       sa sledecim alatima:
       - get_logs(service, time_range) -> vraca logove iz context-a               
       - get_metrics(service, metric_name) -> vraca metrike iz context-a          
       - run_health_check(service) -> simulira health check, vraca status         
       - restart_service(service) -> simulira restart, 80% sansa uspjeha          
       - rollback_deployment(service, version) -> simulira rollback               
       - scale_service(service, replicas) -> simulira scale up                    
                                                                                  
    3. System prompt: Ti si AI dezurni inzenjer. Istrazis incident, pokusas fix,  
    ali budi konzervativan - ne radi nista destruktivno bez dobrog razloga.
                                                                                  
    4. Vraca InvestigationResult:                                                 
       - root_cause: string
       - actions_taken: string[]                                                  
       - fix_applied: boolean
       - proposed_fix: string (ako fix nije uspeo)
       - confidence: number                                                       
       - full_timeline: string (za eskalaciju)
                                                                                  
    Koristi streaming za real-time ispis toka istrage u konzolu.                  
    Model: claude-opus-4-6, adaptive thinking, max_tokens: 16000                  
    Stack: TypeScript, @anthropic-ai/sdk                                          
                    
    ---                                                                           
    Osoba 3 — Integrations & Context Fetcher
                                                                                  
    Gradim AI on-call inzenjera za hakaton koristeci Claude API.
                                                                                  
    Moj zadatak: API wrappers i mock server koji simulira padove servisa.         
     
    Kreiraj sledece:                                                              
                    
    1. `src/integrations/log-fetcher.ts`:
       - getLogs(service: string, minutes: number): Promise<LogEntry[]>
       - Mock: vraca realisticne error logove (connection refused, OOM, timeout)  
       - Bonus: pokusaj pravi CloudWatch/Grafana API sa .env konfigom             
                                                                                  
    2. `src/integrations/metrics-fetcher.ts`:                                     
       - getMetrics(service: string): Promise<ServiceMetrics>                     
       - Vraca: cpu, memory, error_rate, latency_p99, request_count               
       - Mock: kad je servis "down", cpu/memory su visoki, error_rate 100%        
                                                                                  
    3. `src/integrations/deployment-fetcher.ts`:                                  
       - getRecentDeployments(service: string, hours: number):                    
    Promise<Deployment[]>                                                         
       - Mock: vraca poslednjih 3-5 deploymenta sa timestamp, version, author
                                                                                  
    4. `src/mock-server/broken-service.ts`:
       - Express server koji simulira servis koji pada                            
       - GET /health -> random 200 ili 503
       - POST /chaos/crash -> forsira pad                                         
       - POST /chaos/recover -> oporavak                                          
       - Emituje Grafana-kompatibilan webhook alert kad padne                     
                                                                                  
    5. `src/integrations/action-executor.ts`:
       - restartService(service: string): Promise<ActionResult>                   
       - rollbackDeployment(service: string, version: string):                    
    Promise<ActionResult>
       - scaleService(service: string, replicas: number): Promise<ActionResult>   
       - Mock implementacija, 80% success rate, realn response time
                                                                                  
    Stack: TypeScript, Express
    Svaki mock treba da ima realisticne podatke, ne "test" stringove.             
                                                                                  
    ---
    Osoba 4 — Demo & Dashboard                                                    
                    
    Gradim AI on-call inzenjera za hakaton koristeci Claude API.
                                                                                  
    Moj zadatak: Web dashboard i Slack notifikacije za demo prezentaciju.         
                                                                                  
    Kreiraj sledece:                                                              
                    
    1. `src/dashboard/server.ts` - Express + Server-Sent Events:                  
       - GET / -> sluzi HTML dashboard
       - GET /events -> SSE stream za real-time update                            
       - POST /demo/trigger -> rucno triggera incident za demo                    
       - In-memory store za incident historiju                                    
                                                                                  
    2. `public/index.html` - Single-page dashboard koji prikazuje:                
       - Live incident feed (SSE, auto-update bez refresha)
       - Za svaki incident: status badge (investigating/fixed/escalated), servis  
    ime, vreme                                                                    
       - Expand dugme koji pokazuje: AI root cause analizu, akcije koje je        
    preduzeo, timeline                                                            
       - Ako je eskaliran: pokazuje proposed fix u zelenom boxu
       - Animirani indikator dok AI istrazuje                                     
                                                                                  
    3. `src/notifications/slack.ts`:                                              
       - sendEscalationAlert(incident: EscalationPayload): Promise<void>          
       - Formatira Slack Block Kit poruku sa:                                     
         * Crveni header: "🚨 AI nije uspio da fiksuje incident"                  
         * Service, severity, trajanje                                            
         * Root cause (bold)                                                      
         * Sta je AI pokusao                                                      
         * Proposed fix u code bloku                                              
         * Dugme "View Dashboard" link
       - Koristi SLACK_WEBHOOK_URL iz .env                                        
                    
    4. `src/notifications/incident-store.ts`:                                     
       - In-memory store sa EventEmitter
       - createIncident(), updateIncident(), getAll()                             
       - Emituje evente koje SSE server prosledjuje browseru                      
                                                                                  
    Dizajn: tamna tema, terminus font, terminalni look - odgovara DevOps alatu.   
    Stack: TypeScript, Express, vanilla JS za frontend (bez frameworka).          
    Koristi placeholder za Slack ako nema webhook, samo loguj.                    
                                                                                  
    ---                                                                           
    Zajednicki setup (svi rade ovo na pocetku)                                    
                                                                                  
    mkdir ai-oncall && cd ai-oncall
    npm init -y                                                                   
    npm install typescript @anthropic-ai/sdk express axios dotenv zod
    npm install -D @types/express @types/node ts-node nodemon                     
     
    .env:                                                                         
    ANTHROPIC_API_KEY=sk-...
    SLACK_WEBHOOK_URL=https://hooks.slack.com/...                                 
    SUPERPLANE_API_KEY=...                       
                          
    Osobe 2 i 3 rade paralelno od pocetka. Osoba 3 treba da napravi mock odgovore 
    koje Osoba 2 moze koristiti pre prave integracije — naprave zajednicki        
    types/index.ts sa shared interfejsima.
