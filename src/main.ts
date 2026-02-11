import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app.module';

async function bootstrap() {
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
bootstrap();
