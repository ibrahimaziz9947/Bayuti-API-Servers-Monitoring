import { Controller, Get, UnauthorizedException, Logger, Headers } from '@nestjs/common';
import { MonitoringClientService } from '../services/monitoring-client.service';

@Controller('api/cron')
export class CronController {
  private readonly log = new Logger(CronController.name);

  constructor(private readonly monitoringService: MonitoringClientService) {}

  @Get('run-monitoring')
  async runMonitoring(@Headers('x-vercel-cron') vercelCron: string) {
    // Vercel sends x-vercel-cron: 1
    if (vercelCron !== '1') {
      this.log.warn('Unauthorized cron attempt: Missing or invalid x-vercel-cron header');
      throw new UnauthorizedException('Unauthorized: Vercel Cron header missing');
    }

    this.log.log('Executing scheduled monitoring check...');
    await this.monitoringService.runAllChecks();

    return {
      success: true,
      executedAt: new Date(),
    };
  }
}
