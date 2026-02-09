import { Controller, Get, Sse, Query } from '@nestjs/common';
import { MonitoringService } from '../services/monitoring.service';
import { Observable } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { MonitoringClientService } from '../services/monitoring-client.service';

@Controller('api')
export class MonitoringController {
  constructor(
    private readonly svc: MonitoringService,
    private readonly cfg: ConfigService,
    private readonly client: MonitoringClientService
  ) {}

  @Get('services')
  services() {
    return { services: this.svc.getServices(), source: 'cached' };
  }

  @Get('logs')
  async logs(@Query() query: Record<string, string>) {
    const base = this.cfg.get<string>('BAYUTI_BASE_URL')!;
    const url = new URL('/bayuti/logs', base);
    Object.entries(query || {}).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await axios.get(url.toString(), { validateStatus: () => true });
    return { logs: res.data?.data || [], meta: res.data?.meta, source: 'live' };
  }

  @Sse('events')
  events(): Observable<MessageEvent> {
    return this.svc.events$();
  }

  @Get('recheck')
  async recheck() {
    const results = await this.client.runAll();
    return { services: results, source: 'live' };
  }
}
