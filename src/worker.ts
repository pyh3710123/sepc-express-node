import 'reflect-metadata';
import 'dotenv/config';
import { setTimeout as delay } from 'node:timers/promises';
import { NestFactory } from '@nestjs/core';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig } from './config';
import { Database } from './database';
import { GenerationService } from './generation';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);
  const db = app.get(Database);
  const generation = app.get(GenerationService);
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const publisher = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue('generation', { connection });
  const worker = new Worker(
    'generation',
    async (job) => generation.runMockTask(String(job.data.task_id)),
    {
      connection: new Redis(config.redisUrl, { maxRetriesPerRequest: null }),
      concurrency: 4,
    },
  );
  worker.on('failed', (job, error) =>
    console.error({ task_id: job?.data.task_id, error: error.message }),
  );
  let active = true;
  const dispatch = async () => {
    while (active) {
      try {
        await db.transaction(async (client) => {
          const pending = await client.query<{
            id: string;
            event_type: string;
            payload: { task_id?: string };
          }>(`SELECT id,event_type,payload FROM outbox_events
            WHERE delivered_at IS NULL ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED`);
          for (const event of pending.rows) {
            if (event.event_type === 'generation.queued' && event.payload.task_id) {
              if (!config.devMockExternals) throw new Error('Generation provider is unavailable');
              await queue.add(
                'generate',
                { task_id: event.payload.task_id },
                {
                  jobId: event.payload.task_id.replace(/-/g, ''),
                  attempts: 3,
                  backoff: { type: 'exponential', delay: 1000 },
                  removeOnComplete: { age: 86400 },
                },
              );
            } else if (event.event_type === 'canvas.changed') {
              await publisher.publish('canvas-events', JSON.stringify(event.payload));
            }
            await client.query(
              'UPDATE outbox_events SET delivered_at=now(),attempts=attempts+1 WHERE id=$1',
              [event.id],
            );
          }
        });
      } catch (error) {
        console.error('Outbox dispatch failed', error);
      }
      await delay(1000);
    }
  };
  const dispatchPromise = dispatch();
  const shutdown = async () => {
    active = false;
    await dispatchPromise;
    await worker.close();
    await queue.close();
    await connection.quit();
    await publisher.quit();
    await app.close();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  process.stdout.write(
    `AImanju worker started (${config.devMockExternals ? 'mock provider enabled' : 'external provider unavailable'})\n`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
