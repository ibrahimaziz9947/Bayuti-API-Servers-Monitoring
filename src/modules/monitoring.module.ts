import { Module } from '@nestjs/common';
import { MonitoringController } from '../routes/monitoring.controller';
import { CronController } from '../routes/cron.controller';
import { MonitoringService } from '../services/monitoring.service';
import { MonitoringClientService } from '../services/monitoring-client.service';

@Module({
  controllers: [MonitoringController, CronController],
  providers: [MonitoringService, MonitoringClientService],
})
export class MonitoringModule {}
