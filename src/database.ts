import type { OnModuleDestroy } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { APP_CONFIG, type AppConfig } from './config';

@Injectable()
export class Database implements OnModuleDestroy {
  private readonly pool: Pool;

  /** 根据已校验配置创建连接池，并记录空闲连接错误。 */
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl, max: 20 });
    this.pool.on('error', (error) => {
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'PostgreSQL idle client error',
          error_type: error.name,
        }),
      );
    });
  }

  /** 使用连接池执行参数化 SQL 查询。 */
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, values);
  }

  /** 在同一连接内执行事务，并在失败时回滚后继续抛出原错误。 */
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 应用关闭时释放 PostgreSQL 连接池。 */
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
export interface QueryExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
}
