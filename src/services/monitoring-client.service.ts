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
    if (!this.servicesCfg.length) {
      this.log.warn('No services configured. Set one or more *_HEALTH_URL env vars');
      return;
    }
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeoutMs,
    });
    this.servicesCfg.forEach(s => this.log.log(`Resolved ${s.name} health URL=${s.healthUrl}`));
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
      await this.postStatus([{ name: target.name, category: target.category, status, responseTime, error, url: target.healthUrl, live: true }]);
      this.log.log(`[LIVE] Reported status: ${target.name} ${status} rt=${responseTime}ms${error ? ' err='+error : ''}`);
    } catch (err: any) {
      if (err?.response?.status === 401) {
        this.log.warn('Token expired; re-authorizing');
        try {
          await this.authorize();
          await this.postStatus([{ name: target.name, category: target.category, status, responseTime, error, url: target.healthUrl, live: true }]);
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

  async runAll(): Promise<ServiceResult[]> {
    const results: ServiceResult[] = [];
    for (const cfg of this.servicesCfg) {
      try {
        const r = await this.runOnce(cfg);
        results.push(r);
      } catch (e: any) {
        results.push({ name: cfg.name, category: cfg.category, status: 'down', responseTime: 0, error: e?.message || 'error', url: cfg.healthUrl, live: true });
      }
    }
    try {
      await this.postStatus(results);
    } catch (e: any) {
      this.log.error(`Batch report failed: ${e?.message || e}`);
    }
    return results;
  }

  private async postStatus(results: ServiceResult[]) {
    const body = {
      environment: this.environment,
      services: results.map(r => ({
        name: r.name,
        url: r.url,
        status: r.status,
        responseTime: r.responseTime,
        ...(r.error ? { error: r.error } : {}),
      })),
    };
    await this.http!.post('/bayuti/status', body, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
  }

  private loadServiceConfigs(): ServiceConfig[] {
    const defs = [
      { envUrl: 'BAYUTI_API_HEALTH_URL', name: 'Bayuti API', category: 'internal' as const },
      { envUrl: 'LIVE_INVESTOR_HEALTH_URL', name: 'Live Investor', category: 'internal' as const },
      { envUrl: 'LIVE_ADMIN_HEALTH_URL', name: 'Live Admin', category: 'internal' as const },
      { envUrl: 'LIVE_WEBAPP_HEALTH_URL', name: 'Live Web-app', category: 'internal' as const },
      { envUrl: 'BAYUTI_HEALTH_URL', name: 'Bayuti API', category: 'internal' as const }, // legacy single-service
    ];
    const items: ServiceConfig[] = [];
    for (const d of defs) {
      const url = this.cfg.get<string>(d.envUrl);
      if (url) {
        const tokenEnv = d.envUrl.replace('_HEALTH_URL', '_HEALTH_TOKEN');
        items.push({ ...d, healthUrl: url, tokenEnv });
      }
    }
    return items;
  }
}
