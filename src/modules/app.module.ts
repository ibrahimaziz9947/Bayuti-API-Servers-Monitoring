import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { MonitoringModule } from './monitoring.module';
import { AuthModule } from './auth/auth.module';
import * as Joi from 'joi';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: Joi.object({
        // Must be a full http(s) URL to the Bayuti backend root
        BAYUTI_BASE_URL: Joi.string().uri({ scheme: ['http', 'https'] }).optional().messages({
          'string.uri': 'BAYUTI_BASE_URL must be a full http(s) URL',
        }),
        BAYUTI_API_KEY: Joi.string().optional(),
        BAYUTI_MASTER_KEY: Joi.string().optional(),
        // Must be a full http(s) URL to the Bayuti API health endpoint (query params allowed)
        BAYUTI_HEALTH_URL: Joi.string()
          .pattern(/^https?:\/\/.+/i)
          .optional()
          .messages({
            'string.pattern.base': 'BAYUTI_HEALTH_URL must be a full http(s) URL; query params allowed',
          }),
        BAYUTI_API_HEALTH_URL: Joi.string().pattern(/^https?:\/\/.+/i).optional(),
        LIVE_INVESTOR_HEALTH_URL: Joi.string().pattern(/^https?:\/\/.+/i).optional(),
        LIVE_ADMIN_HEALTH_URL: Joi.string().pattern(/^https?:\/\/.+/i).optional(),
        WEB_SERVERS_HEALTH_URL: Joi.string().pattern(/^https?:\/\/.+/i).optional(),
        LIVE_WEBSITE_HEALTH_URL: Joi.string().pattern(/^https?:\/\/.+/i).optional(),
        LIVE_WEBAPP_HEALTH_URL: Joi.string().pattern(/^https?:\/\/.+/i).optional(),
        BAYUTI_API_HEALTH_TOKEN: Joi.string().optional(),
        LIVE_INVESTOR_HEALTH_TOKEN: Joi.string().optional(),
        LIVE_ADMIN_HEALTH_TOKEN: Joi.string().optional(),
        WEB_SERVERS_HEALTH_TOKEN: Joi.string().optional(),
        LIVE_WEBSITE_HEALTH_TOKEN: Joi.string().optional(),
        LIVE_WEBAPP_HEALTH_TOKEN: Joi.string().optional(),
        MONITOR_ENV: Joi.string().default('production'),
        MONITOR_INTERVAL_MS: Joi.number().default(60000),
        MONITOR_TIMEOUT_MS: Joi.number().default(5000),
        MONITOR_DEGRADED_THRESHOLD_MS: Joi.number().default(1000),
        PORT: Joi.number().default(3000),
        BAYUTI_HEALTH_TOKEN: Joi.string().optional(),
        JWT_SECRET: Joi.string().min(32).required(),
        ADMIN_EMAIL: Joi.string().email().required(),
        ADMIN_PASSWORD: Joi.string().min(8).required(),
        CRON_SECRET: Joi.string().required(),
      }),
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'ui'),
    }),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET') || 'fallback-secret-for-startup-safety',
        signOptions: { expiresIn: '1h' },
      }),
      inject: [ConfigService],
    }),
    MonitoringModule,
    AuthModule,
  ],
})
export class AppModule {}
