import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { MonitoringModule } from './monitoring.module';
import * as Joi from 'joi';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: Joi.object({
        BAYUTI_BASE_URL: Joi.string().uri().required(),
        BAYUTI_API_KEY: Joi.string().required(),
        BAYUTI_MASTER_KEY: Joi.string().required(),
        BAYUTI_HEALTH_URL: Joi.string().uri().required(),
        MONITOR_ENV: Joi.string().default('production'),
        MONITOR_INTERVAL_MS: Joi.number().default(60000),
        MONITOR_TIMEOUT_MS: Joi.number().default(5000),
        MONITOR_DEGRADED_THRESHOLD_MS: Joi.number().default(1000),
        PORT: Joi.number().default(3000),
      }),
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'ui'),
    }),
    MonitoringModule,
  ],
})
export class AppModule {}
