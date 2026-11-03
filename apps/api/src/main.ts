// Load local env first: env.ts must stay the first import so every later
// module sees SUPABASE_*, DATABASE_URL and REDIS_URL (see env.ts).
import './env.js';
import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  configureApp(app);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
