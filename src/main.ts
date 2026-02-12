import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';

// Use require for serverless-http to avoid missing type definitions error
// eslint-disable-next-line @typescript-eslint/no-var-requires
const serverlessExpress = require('serverless-http');

// Check if running in Vercel environment
const isVercel = process.env.VERCEL === '1';

async function bootstrap() {
  if (isVercel) {
    // Skip bootstrap if running in Vercel - the handler below will be used
    return;
  }

  try {
    console.log('Starting NestJS application...');
    const app = await NestFactory.create(AppModule);
    const port = process.env.PORT ? Number(process.env.PORT) : 3000;
    console.log(`Listening on port ${port}`);
    await app.listen(port);
  } catch (error) {
    console.error('Nest bootstrap failed:', error);
    throw error;
  }
}

// Only run bootstrap if executed directly (local development)
if (require.main === module || !isVercel) {
  bootstrap();
}

// Serverless Handler for Vercel
let cachedServer: any;

export default async function handler(req: any, res: any) {
  if (!cachedServer) {
    const expressApp = express();
    const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));
    await app.init();
    cachedServer = serverlessExpress(expressApp);
  }
  return cachedServer(req, res);
}
