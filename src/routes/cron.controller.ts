import { Controller, Get, Req, UnauthorizedException, Logger, Query } from '@nestjs/common';
import { MonitoringClientService } from '../services/monitoring-client.service';
import { Request } from 'express';

@Controller('api/cron')
export class CronController {
  private readonly log = new Logger(CronController.name);

  constructor(private readonly monitoringService: MonitoringClientService) {}

  @Get('run-monitoring')
  async runMonitoring(@Query('secret') secret: string) {
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || secret !== cronSecret) {
      this.log.warn('Unauthorized cron attempt');
      throw new UnauthorizedException('Invalid cron secret');
    }

    this.log.log('Executing scheduled monitoring check...');
    await this.monitoringService.runAllChecks();

    return {
      success: true,
      executedAt: new Date(),
    };
  }
}
