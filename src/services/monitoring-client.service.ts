import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

type ServiceStatus = 'up' | 'degraded' | 'down';

@Injectable()
export class MonitoringClientService implements OnApplicationBootstrap {
  private readonly log = new Logger(MonitoringClientService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly masterKey: string;
  private readonly healthUrl: string;
  private readonly environment: string;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly degradedThresholdMs: number;

  private http: AxiosInstance | null = null;
  private accessToken: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly cfg: ConfigService) {
    this.baseUrl = this.cfg.get<string>('BAYUTI_BASE_URL')!;
    this.apiKey = this.cfg.get<string>('BAYUTI_API_KEY')!;
    this.masterKey = this.cfg.get<string>('BAYUTI_MASTER_KEY')!;
    this.healthUrl = this.cfg.get<string>('BAYUTI_HEALTH_URL')!;
    this.environment = this.cfg.get<string>('MONITOR_ENV', 'production')!;
    this.intervalMs = this.cfg.get<number>('MONITOR_INTERVAL_MS', 60_000)!;
    this.timeoutMs = this.cfg.get<number>('MONITOR_TIMEOUT_MS', 5_000)!;
    this.degradedThresholdMs = this.cfg.get<number>('MONITOR_DEGRADED_THRESHOLD_MS', 1_000)!;
  }

  onApplicationBootstrap() {
    if (!this.baseUrl || !this.apiKey || !this.healthUrl) {
      this.log.warn('Monitoring disabled: set BAYUTI_BASE_URL, BAYUTI_API_KEY, BAYUTI_HEALTH_URL env vars');
      return;
    }
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeoutMs,
    });
    this.log.log(`Resolved BAYUTI_HEALTH_URL=${this.healthUrl}`);
    this.start();
  }

  private async start() {
    await this.authorize();
    this.log.log(`[LIVE] Monitoring ready (on-demand). healthUrl=${this.healthUrl}`);
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

  async runOnce() {
    const start = Date.now();
    let status: ServiceStatus = 'down';
    let responseTime = 0;
    let error: string | undefined;
    try {
      const urlToCheck = this.buildHealthUrlWithToken();
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
      await this.postStatus(status, responseTime, error);
      this.log.log(`[LIVE] Reported status: ${status} rt=${responseTime}ms${error ? ' err='+error : ''}`);
    } catch (err: any) {
      if (err?.response?.status === 401) {
        this.log.warn('Token expired; re-authorizing');
        try {
          await this.authorize();
          await this.postStatus(status, responseTime, error);
          this.log.log('[LIVE] Re-authorized and reported status');
        } catch (inner: any) {
          this.log.error(`Report failed after re-auth: ${inner?.message || inner}`);
        }
      } else {
        this.log.error(`Report failed: ${err?.message || err}`);
      }
    }
    return { status, responseTime, error, url: this.buildHealthUrlWithToken(), live: true };
  }

  private async postStatus(status: ServiceStatus, responseTime: number, error?: string) {
    const body = {
      environment: this.environment,
      services: [
        {
          name: 'Bayuti API',
          url: this.healthUrl,
          status,
          responseTime,
          ...(error ? { error } : {}),
        },
      ],
    };
    await this.http!.post('/bayuti/status', body, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
  }

  private buildHealthUrlWithToken(): string {
    // If the URL already contains a token param, use it
    if (this.healthUrl.includes('token=')) return this.healthUrl;
    const token = this.cfg.get<string>('BAYUTI_HEALTH_TOKEN');
    if (!token) {
      throw new Error('BAYUTI_HEALTH_URL requires token. Provide BAYUTI_HEALTH_TOKEN or include token= in URL');
    }
    const sep = this.healthUrl.includes('?') ? '&' : '?';
    return `${this.healthUrl}${sep}token=${encodeURIComponent(token)}`;
  }
}
