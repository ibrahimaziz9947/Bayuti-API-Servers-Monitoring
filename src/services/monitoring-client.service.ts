import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

type ServiceStatus = 'up' | 'degraded' | 'down';
type ServiceConfig = { name: string; category: 'internal' | 'external'; envUrl: string; healthUrl: string; tokenEnv?: string; };
type ServiceResult = { name: string; category: 'internal' | 'external'; status: ServiceStatus; responseTime: number; error?: string; url: string; live: true };

@Injectable()
export class MonitoringClientService implements OnApplicationBootstrap {
  private readonly log = new Logger(MonitoringClientService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly masterKey: string;
  private readonly environment: string;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly degradedThresholdMs: number;
  private readonly servicesCfg: ServiceConfig[];

  private http: AxiosInstance | null = null;
  private accessToken: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  private readonly externalCache: Map<string, { status: ServiceStatus, timestamp: number }> = new Map();

  constructor(private readonly cfg: ConfigService) {
    this.baseUrl = this.cfg.get<string>('BAYUTI_BASE_URL')!;
    this.apiKey = this.cfg.get<string>('BAYUTI_API_KEY')!;
    this.masterKey = this.cfg.get<string>('BAYUTI_MASTER_KEY')!;
    this.environment = this.cfg.get<string>('MONITOR_ENV', 'production')!;
    this.intervalMs = this.cfg.get<number>('MONITOR_INTERVAL_MS', 60_000)!;
    this.timeoutMs = this.cfg.get<number>('MONITOR_TIMEOUT_MS', 5_000)!;
    this.degradedThresholdMs = this.cfg.get<number>('MONITOR_DEGRADED_THRESHOLD_MS', 1_000)!;
    this.servicesCfg = this.loadServiceConfigs();
  }

  onApplicationBootstrap() {
    if (!this.baseUrl || !this.apiKey) {
      this.log.warn('Monitoring disabled: set BAYUTI_BASE_URL and BAYUTI_API_KEY env vars');
      return;
    }
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeoutMs,
    });
    this.servicesCfg.forEach(s => this.log.log(`Resolved ${s.name} health URL=${s.healthUrl}`));
    if (this.servicesCfg.length === 0) {
       this.log.warn('No internal services configured via env vars. Dashboard will show warnings or external services only.');
    }
    this.start();
  }

  private async start() {
    await this.authorize();
    this.log.log(`[LIVE] Monitoring ready (on-demand). services=${this.servicesCfg.length}`);
  }

  private async authorize() {
    try {
      const res = await this.http!.post('/bayuti/authorize', { apiKey: this.masterKey }, {
        headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' },
      });
      const token = res.data?.access_token;
      if (!token) throw new Error('No access_token in response');
      this.accessToken = token;
      this.log.log('Authorized with Bayuti backend');
    } catch (err: any) {
      this.log.error(`Authorization failed: ${err?.message || err}`);
      throw err;
    }
  }

  private buildUrlWithToken(cfg: ServiceConfig): string {
    if (cfg.healthUrl.includes('token=')) return cfg.healthUrl;
    const token = cfg.tokenEnv ? this.cfg.get<string>(cfg.tokenEnv) : this.cfg.get<string>('BAYUTI_HEALTH_TOKEN');
    if (!token) return cfg.healthUrl;
    const sep = cfg.healthUrl.includes('?') ? '&' : '?';
    return `${cfg.healthUrl}${sep}token=${encodeURIComponent(token)}`;
  }

  async runOnce(cfg?: ServiceConfig) {
    const target = cfg ?? this.servicesCfg[0];
    if (!target) throw new Error('No service configured');
    const start = Date.now();
    let status: ServiceStatus = 'down';
    let responseTime = 0;
    let error: string | undefined;
    try {
      const urlToCheck = this.buildUrlWithToken(target);
      this.log.log(`[LIVE] Checking URL: ${urlToCheck}`);
      const res = await axios.get(urlToCheck, { timeout: this.timeoutMs, validateStatus: () => true });
      responseTime = Date.now() - start;
      if (res.status === 200) {
        status = responseTime > this.degradedThresholdMs ? 'degraded' : 'up';
      } else {
        status = 'down';
        error = `HTTP ${res.status}`;
      }
    } catch (e: any) {
      responseTime = Date.now() - start;
      status = 'down';
      error = e?.code === 'ECONNABORTED' ? 'timeout' : (e?.message || 'error');
    }

    try {
      // The single-item postStatus call expects an array of ServiceResult
      // but runOnce constructs a ServiceResult object, not ServiceResult[]
      // We must wrap it in an array to match the postStatus signature
      await this.postStatus([{ 
        name: target.name, 
        category: target.category, 
        status, 
        responseTime, 
        error, 
        url: target.healthUrl, 
        live: true 
      }]);
      
      this.log.log(`[LIVE] Reported status: ${target.name} ${status} rt=${responseTime}ms${error ? ' err='+error : ''}`);
    } catch (err: any) {
      if (err?.response?.status === 401) {
        this.log.warn('Token expired; re-authorizing');
        try {
          await this.authorize();
          await this.postStatus([{ 
            name: target.name, 
            category: target.category, 
            status, 
            responseTime, 
            error, 
            url: target.healthUrl, 
            live: true 
          }]);
          this.log.log('[LIVE] Re-authorized and reported status');
        } catch (inner: any) {
          this.log.error(`Report failed after re-auth: ${inner?.message || inner}`);
        }
      } else {
        this.log.error(`Report failed: ${err?.message || err}`);
      }
    }
    return { name: target.name, category: target.category, status, responseTime, error, url: this.buildUrlWithToken(target), live: true } as ServiceResult;
  }

  private async postStatus(results: ServiceResult[]) {
    // Generate individual logs for each service result
    const logs = results.map(r => ({
      level: r.status === 'down' ? 'error' : (r.status === 'degraded' ? 'warn' : 'info'),
      service: r.name,
      message: r.error || (
        r.status === 'up' ? 'All systems operational' : 
        r.status === 'degraded' ? 'Provider reports partial outage / degraded performance' :
        'Service unavailable or major outage'
      ),
      status: r.status,
      timestamp: new Date().toISOString(),
    }));

    const body = {
      environment: this.environment,
      services: results.map(r => ({
        name: r.name,
        url: r.url,
        status: r.status,
        responseTime: r.responseTime,
        ...(r.error ? { error: r.error } : {}),
      })),
      // Include the detailed logs in the payload so the backend can store them
      logs, 
    };
    
    // Note: The Bayuti backend POST /bayuti/status endpoint needs to support this 'logs' field
    // If it doesn't, we might need to post logs separately or rely on the backend generating them from 'services'
    // Assuming for this task that we simply send the services array and the backend (or our mock logic here) handles it.
    // However, the prompt asks to "Create one log entry per service".
    // Since we don't control the Bayuti backend logic that *receives* this POST, 
    // and we are implementing the *client*, we must ensure the data we send allows the receiving end to store these logs.
    //
    // BUT: The prompt says "The backend emits only one log entry... Required Fix... During /api/recheck... Create one log entry per service".
    // This implies we should be fixing the *local* backend logic that handles the recheck response and logs it.
    // Wait, `MonitoringClientService` IS the "backend" for the dashboard in this context (NestJS service).
    // The `postStatus` sends data to the *remote* Bayuti API.
    // The Dashboard UI fetches logs from `/api/logs`, which proxies `BAYUTI_BASE_URL/bayuti/logs`.
    // So if the remote Bayuti API is what stores logs, we must send them there.
    // 
    // If the remote API only accepts `services` list and generates its own logs, we can't change that behavior from here without changing the remote API.
    // HOWEVER, if the task implies that *our* local /api/logs endpoint should return these logs, we need to store them locally or proxy them.
    // 
    // Let's look at `monitoring.controller.ts`. It proxies `/api/logs` to the remote API.
    // So the issue IS that the remote API isn't generating per-service logs from our batch update.
    // OR, we are supposed to send individual status updates to the remote API so it generates individual logs?
    // The prompt says: "Refactor postStatus to accept an array... but post them individually or batch them correctly for logs".
    //
    // If the remote API generates one log per POST request, then batching all services into one POST causes the "one log entry" issue.
    // SOLUTION: We should iterate and send individual POST requests for each service if we want individual logs on the remote end.
    
    // Let's try sending individual requests in parallel (or sequential) instead of one batch.
    
    for (const result of results) {
      const singleBody = {
        environment: this.environment,
        services: [{
          name: result.name,
          url: result.url,
          status: result.status,
          responseTime: result.responseTime,
          ...(result.error ? { error: result.error } : {}),
        }],
      };
      
      try {
        await this.http!.post('/bayuti/status', singleBody, {
          headers: { Authorization: `Bearer ${this.accessToken}` },
        });
      } catch (err: any) {
        this.log.error(`Failed to post status for ${result.name}: ${err?.message || err}`);
      }
    }
  }

  async runAll(): Promise<ServiceResult[]> {
    const results: ServiceResult[] = [];
    
    // Check Internal Services
    for (const cfg of this.servicesCfg) {
      try {
        const r = await this.runOnce(cfg);
        results.push(r);
      } catch (e: any) {
        results.push({ name: cfg.name, category: cfg.category, status: 'down', responseTime: 0, error: e?.message || 'error', url: cfg.healthUrl, live: true });
      }
    }

    // Check External Services
    const externals = this.getExternalConfigs();
    for (const ext of externals) {
      const r = await this.checkExternal(ext);
      results.push(r);
    }

    try {
      await this.postStatus(results);
    } catch (e: any) {
      this.log.error(`Batch report failed: ${e?.message || e}`);
    }
    return results;
  }

  private async checkExternal(cfg: ServiceConfig): Promise<ServiceResult> {
    // Check cache
    const cached = this.externalCache.get(cfg.name);
    const CACHE_TTL = 300_000; // 5 mins
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      return { name: cfg.name, category: 'external', status: cached.status, responseTime: 0, url: cfg.healthUrl, live: true };
    }

    const start = Date.now();
    let status: ServiceStatus = 'down';
    let error: string | undefined;

    try {
      this.log.log(`[LIVE] Checking External: ${cfg.name}`);
      const res = await axios.get(cfg.healthUrl, { timeout: this.timeoutMs, validateStatus: () => true });
      
      // Parse status based on provider
      // Atlassian Statuspage (MongoDB, Vercel, Twilio, SendGrid, DocuSign, HubSpot, Mangopay, Onfido)
      // Usually returns { page: {...}, status: { indicator: "none"|"minor"|"major"|"critical", description: "All Systems Operational" } }
      // Or just check HTTP 200 for simple pages if JSON parsing fails
      
      if (res.status === 200 && res.data?.status?.indicator !== undefined) {
        const ind = res.data.status.indicator;
        status = ind === 'none' ? 'up' : ind === 'minor' ? 'degraded' : 'down';
      } else if (res.status === 200) {
         // Fallback for simple 200 OK
         status = 'up';
      } else {
        status = 'down';
        error = `HTTP ${res.status}`;
      }
    } catch (e: any) {
      status = 'down';
      error = e?.message || 'error';
    }

    this.externalCache.set(cfg.name, { status, timestamp: Date.now() });
    return { name: cfg.name, category: 'external', status, responseTime: Date.now() - start, error, url: cfg.healthUrl, live: true };
  }

  private getExternalConfigs(): ServiceConfig[] {
    return [
      { name: 'MongoDB Atlas', category: 'external', healthUrl: 'https://status.mongodb.com/api/v2/status.json', envUrl: '' },
      { name: 'Vercel', category: 'external', healthUrl: 'https://www.vercel-status.com/api/v2/status.json', envUrl: '' },
      { name: 'Twilio', category: 'external', healthUrl: 'https://status.twilio.com/api/v2/status.json', envUrl: '' },
      { name: 'SendGrid', category: 'external', healthUrl: 'https://status.sendgrid.com/api/v2/status.json', envUrl: '' },
      { name: 'DocuSign', category: 'external', healthUrl: 'https://status.docusign.com/api/v2/status.json', envUrl: '' },
      { name: 'HubSpot', category: 'external', healthUrl: 'https://status.hubspot.com/api/v2/status.json', envUrl: '' },
      { name: 'Mangopay', category: 'external', healthUrl: 'https://status.mangopay.com/api/v2/status.json', envUrl: '' },
      { name: 'Onfido', category: 'external', healthUrl: 'https://status.onfido.com/api/v2/status.json', envUrl: '' },
      { name: 'Plaid', category: 'external', healthUrl: 'https://status.plaid.com/api/v2/status.json', envUrl: '' },
      { name: 'AWS', category: 'external', healthUrl: 'https://status.aws.amazon.com/api/v2/status.json', envUrl: '' },
    ];
  }

  private loadServiceConfigs(): ServiceConfig[] {
    const defs = [
      { envUrl: 'BAYUTI_API_HEALTH_URL', name: 'Bayuti API', category: 'internal' as const },
      { envUrl: 'LIVE_INVESTOR_HEALTH_URL', name: 'Live Investor', category: 'internal' as const },
      { envUrl: 'LIVE_ADMIN_HEALTH_URL', name: 'Live Admin', category: 'internal' as const },
      { envUrl: 'WEB_SERVERS_HEALTH_URL', name: 'Web Servers', category: 'internal' as const },
      { envUrl: 'LIVE_WEBSITE_HEALTH_URL', name: 'Live website', category: 'internal' as const },
      { envUrl: 'LIVE_WEBAPP_HEALTH_URL', name: 'Live Web-app', category: 'internal' as const },
      { envUrl: 'BAYUTI_HEALTH_URL', name: 'Bayuti API', category: 'internal' as const }, // legacy
    ];
    const items: ServiceConfig[] = [];
    const usedNames = new Set<string>();

    for (const d of defs) {
      const url = this.cfg.get<string>(d.envUrl);
      if (url && !usedNames.has(d.name)) {
        const tokenEnv = d.envUrl.replace('_HEALTH_URL', '_HEALTH_TOKEN');
        items.push({ ...d, healthUrl: url, tokenEnv });
        usedNames.add(d.name);
      } else if (!url && d.envUrl !== 'BAYUTI_HEALTH_URL') {
         // Log warning for missing specific internal service, but don't fail
         this.log.warn(`Missing env var ${d.envUrl} for ${d.name}`);
      }
    }
    return items;
  }
}
