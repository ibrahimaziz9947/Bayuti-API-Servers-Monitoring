import { Controller, Get, Sse } from '@nestjs/common';
import { MonitoringService } from '../services/monitoring.service';
import { Observable } from 'rxjs';

@Controller('api')
export class MonitoringController {
  constructor(private readonly svc: MonitoringService) {}

  @Get('services')
  services() {
    return { services: this.svc.getServices() };
  }

  @Get('logs')
  logs() {
    return { logs: this.svc.getLogsSorted() };
  }

  @Sse('events')
  events(): Observable<MessageEvent> {
    return this.svc.events$();
  }
}
