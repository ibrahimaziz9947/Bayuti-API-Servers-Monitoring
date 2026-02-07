import { Module } from '@nestjs/common';
import { MonitoringController } from '../routes/monitoring.controller';
import { MonitoringService } from '../services/monitoring.service';
import { MonitoringClientService } from '../services/monitoring-client.service';

@Module({
  controllers: [MonitoringController],
  providers: [MonitoringService, MonitoringClientService],
})
export class MonitoringModule {}
