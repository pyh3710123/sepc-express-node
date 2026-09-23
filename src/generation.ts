import { createHash, randomUUID } from 'node:crypto';
import { Body, Controller, Get, Inject, Injectable, Post, Req, UseGuards } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';
import { AppError, parse } from './common';
import { AuthGuard, type AuthedRequest, type Identity } from './auth';
import { APP_CONFIG, type AppConfig } from './config';
import { Database, type QueryExecutor } from './database';

const id = z.coerce.number().int().positive();
const scalar = z.union([z.string().max(1000), z.number().finite(), z.boolean()]);
const media = z.union([
  z.string().url().max(2048),
  z
    .object({
      url: z.string().url().max(2048),
      type: z.string().max(50).optional(),
      regions: z.unknown().optional(),
      role: z.string().max(50).optional(),
      node_id: id.optional(),
      node_uuid: z.string().max(128).optional(),
      asset_id: id.optional(),
      volc_asset_id: id.optional(),
    })
    .strict(),
]);
const inputs = z
  .object({
    prompt: z.string().max(5000).optional(),
    images: z.array(media).max(10).default([]),
    videos: z.array(media).max(5).default([]),
    audios: z.array(media).max(5).default([]),
    texts: z.array(z.string().max(5000)).max(20).default([]),
  })
  .strict();
const taskFields = z
  .object({
    canvas_id: id.optional(),
    node_id: id.optional(),
    node_type: z.string().min(1).max(50),
    task_type: z.string().min(1).max(50),
    model_code: z.string().min(1).max(100),
    capability_id: z.string().max(150).optional(),
    mode_type: z.string().max(50).optional(),
    schema_version: z.number().int().positive().optional(),
    model_revision: z.number().int().positive().optional(),
    scene: z.string().max(50).optional(),
    inputs,
    parameters: z.record(z.string(), scalar).default({}),
    features: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const singleSchema = taskFields.extend({
  request_id: z.string().min(1).max(128).optional(),
  drama_id: id,
  canvas_id: id,
  node_id: id,
});
const batchSchema = z
  .object({
    request_id: z.string().min(1).max(128).optional(),
    drama_id: id,
    canvas_id: id.optional(),
    node_id: id,
    tasks: z.array(taskFields).min(1).max(100),
  })
  .strict();
const idsSchema = z.object({ task_ids: z.array(z.string().uuid()).min(1).max(100) }).strict();

interface ParameterDefinition {
  key: string;
  value_type: 'string' | 'number' | 'boolean';
  required?: boolean;
  default?: string | number | boolean;
  options?: { value: string | number | boolean }[];
  min?: number;
  max?: number;
}
interface Capability extends QueryResultRow {
  capability_id: string;
  model_code: string;
  node_type: string;
  mode_type: string;
  scene: string;
  schema_version: number;
  model_revision: number;
  input_schema: Record<string, { min?: number; max?: number }>;
  parameters: ParameterDefinition[];
  features: { key: string }[];
  price_credits: number;
  provider: string;
}
type TaskInput = z.infer<typeof taskFields>;
interface NormalizedTask {
  drama_id: number;
  canvas_id: number;
  node_id: number;
  node_type: string;
  task_type: string;
  model_code: string;
  capability_id: string;
  mode_type: string;
  schema_version: number;
  model_revision: number;
  scene: string;
  inputs: z.infer<typeof inputs>;
  parameters: Record<string, string | number | boolean>;
  features: Record<string, unknown>;
  price_credits: number;
  provider: string;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
export function semanticHash(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex');
}

@Injectable()
export class GenerationService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async models() {
    if (!this.config.devMockExternals) return { list: [] };
    const result = await this.db.query<
      Capability & { model_name: string; model_type: string }
    >(`SELECT m.model_name,m.model_type,c.*,m.provider FROM model_capabilities c
      JOIN model_catalog m ON m.model_code=c.model_code WHERE m.active AND c.active ORDER BY m.model_code,c.mode_type`);
    const models = new Map<
      string,
      { model_code: string; model_name: string; model_type: string; capabilities: unknown[] }
    >();
    for (const row of result.rows) {
      let model = models.get(row.model_code);
      if (!model) {
        model = {
          model_code: row.model_code,
          model_name: row.model_name,
          model_type: row.model_type,
          capabilities: [],
        };
        models.set(row.model_code, model);
      }
      model.capabilities.push({
        capability_id: row.capability_id,
        node_type: row.node_type,
        mode_type: row.mode_type,
        scene: row.scene,
        schema_version: row.schema_version,
        model_revision: row.model_revision,
        input_schema: row.input_schema,
        parameters: row.parameters,
        features: row.features,
      });
    }
    return { list: [...models.values()] };
  }

  private async normalize(
    client: QueryExecutor,
    actor: Identity,
    dramaId: number,
    task: TaskInput,
  ): Promise<NormalizedTask> {
    const nodeId = task.node_id;
    if (!nodeId) throw new AppError(400, 'node_id 必填');
    const target = await client.query<{ canvas_id: number }>(
      `SELECT n.canvas_id FROM nodes n JOIN canvases c ON c.id=n.canvas_id
      JOIN dramas d ON d.id=c.drama_id AND d.deleted_at IS NULL WHERE n.id=$1 AND c.account_id=$2 AND d.id=$3`,
      [nodeId, actor.accountId, dramaId],
    );
    const canvasId = target.rows[0]?.canvas_id;
    if (!canvasId || (task.canvas_id && task.canvas_id !== canvasId))
      throw new AppError(404, '生成节点不存在');
    const capabilities = await client.query<Capability>(
      `SELECT c.*,m.provider FROM model_capabilities c JOIN model_catalog m ON m.model_code=c.model_code
      WHERE c.model_code=$1 AND c.node_type=$2 AND c.active AND m.active`,
      [task.model_code, task.node_type],
    );
    const capability =
      capabilities.rows.find((row) => row.mode_type === (task.mode_type ?? task.scene)) ??
      (capabilities.rows.length === 1 && !task.mode_type && !task.scene
        ? capabilities.rows[0]
        : undefined);
    if (!capability) throw new AppError(400, '模型能力不可用');
    if (task.capability_id && task.capability_id !== capability.capability_id)
      throw new AppError(409, '模型能力已变更');
    if (task.schema_version && task.schema_version !== capability.schema_version)
      throw new AppError(409, '模型能力版本已变更');
    if (task.model_revision && task.model_revision !== capability.model_revision)
      throw new AppError(409, '模型版本已变更');
    if (task.scene && task.scene !== capability.scene) throw new AppError(400, '生成场景不匹配');
    if (capability.provider !== 'mock' || !this.config.devMockExternals)
      throw new AppError(503, '模型供应商未配置');
    const normalized: Record<string, string | number | boolean> = {};
    const definitions = new Map(
      capability.parameters.map((definition) => [definition.key, definition]),
    );
    for (const key of Object.keys(task.parameters))
      if (!definitions.has(key)) throw new AppError(400, `不支持的参数: ${key}`);
    for (const definition of capability.parameters) {
      const value = task.parameters[definition.key] ?? definition.default;
      if (value === undefined) {
        if (definition.required) throw new AppError(400, `缺少参数: ${definition.key}`);
        continue;
      }
      if (typeof value !== definition.value_type)
        throw new AppError(400, `参数类型错误: ${definition.key}`);
      if (definition.options && !definition.options.some((option) => option.value === value))
        throw new AppError(400, `参数选项错误: ${definition.key}`);
      if (
        typeof value === 'number' &&
        ((definition.min != null && value < definition.min) ||
          (definition.max != null && value > definition.max))
      )
        throw new AppError(400, `参数超出范围: ${definition.key}`);
      normalized[definition.key] = value;
    }
    const featureKeys = new Set(capability.features.map((feature) => feature.key));
    for (const key of Object.keys(task.features))
      if (!featureKeys.has(key)) throw new AppError(400, `不支持的功能: ${key}`);
    if (JSON.stringify(task.features).length > 8192) throw new AppError(400, '功能参数过大');
    const promptRule = capability.input_schema.text;
    if (promptRule?.min && (task.inputs.prompt?.length ?? 0) < promptRule.min)
      throw new AppError(400, '提示词过短');
    if (promptRule?.max && (task.inputs.prompt?.length ?? 0) > promptRule.max)
      throw new AppError(400, '提示词过长');
    for (const [key, inputKey] of [
      ['images', 'images'],
      ['videos', 'videos'],
      ['audios', 'audios'],
    ] as const) {
      const max = capability.input_schema[key]?.max;
      if (max != null && task.inputs[inputKey].length > max)
        throw new AppError(400, `${key} 数量超限`);
      for (const item of task.inputs[inputKey]) {
        if (typeof item === 'string' || !item.asset_id)
          throw new AppError(400, '媒体输入需使用当前账号已登记的 asset_id');
        const asset = await client.query<{ url: string }>(
          'SELECT url FROM media_assets WHERE id=$1 AND account_id=$2',
          [item.asset_id, actor.accountId],
        );
        if (!asset.rows[0] || asset.rows[0].url !== item.url)
          throw new AppError(404, '媒体资产不存在');
      }
    }
    const count = typeof normalized.count === 'number' ? normalized.count : 1;
    if (!Number.isInteger(count)) throw new AppError(400, 'count 必须为整数');
    return {
      drama_id: dramaId,
      canvas_id: canvasId,
      node_id: nodeId,
      node_type: task.node_type,
      task_type: task.task_type,
      model_code: task.model_code,
      capability_id: capability.capability_id,
      mode_type: capability.mode_type,
      schema_version: capability.schema_version,
      model_revision: capability.model_revision,
      scene: capability.scene,
      inputs: task.inputs,
      parameters: normalized,
      features: task.features,
      price_credits: capability.price_credits * count,
      provider: capability.provider,
    };
  }

  async quote(actor: Identity, body: unknown) {
    const input = parse(singleSchema, body);
    const normalized = await this.normalize(this.db, actor, input.drama_id, input);
    return { credit: normalized.price_credits, capability_id: normalized.capability_id };
  }

  private async accept(
    actor: Identity,
    endpoint: string,
    requestId: string,
    dramaId: number,
    tasks: TaskInput[],
    batch: boolean,
  ) {
    if (!this.config.devMockExternals) throw new AppError(503, '模型供应商未配置');
    if (tasks.length > this.config.maxGenerationTasks) throw new AppError(400, '任务数量超限');
    return this.db.transaction(async (client) => {
      const normalized = [];
      for (const task of tasks) normalized.push(await this.normalize(client, actor, dramaId, task));
      const payloadHash = semanticHash(
        normalized.map((task) => ({ ...task, price_credits: 0, provider: '' })),
      );
      const recordId = randomUUID();
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO generation_requests(id,account_id,endpoint,request_id,payload_hash,status)
        VALUES ($1,$2,$3,$4,$5,'accepting') ON CONFLICT (account_id,endpoint,request_id) DO NOTHING RETURNING id`,
        [recordId, actor.accountId, endpoint, requestId, payloadHash],
      );
      if (!inserted.rowCount) {
        const previous = (
          await client.query<{ payload_hash: string; response: unknown }>(
            `SELECT payload_hash,response FROM generation_requests
          WHERE account_id=$1 AND endpoint=$2 AND request_id=$3 FOR UPDATE`,
            [actor.accountId, endpoint, requestId],
          )
        ).rows[0];
        if (previous.payload_hash !== payloadHash)
          throw new AppError(409, 'request_id 已用于不同请求');
        if (!previous.response)
          throw new AppError(503, '原请求仍在处理中，请使用原 request_id 重试');
        return previous.response;
      }
      const wallet = (
        await client.query<{ balance: number }>(
          'SELECT balance FROM credit_wallets WHERE account_id=$1 FOR UPDATE',
          [actor.accountId],
        )
      ).rows[0];
      const cost = normalized.reduce((sum, task) => sum + task.price_credits, 0);
      if (!wallet || wallet.balance < cost) throw new AppError(402, '积分不足');
      const running = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM generation_tasks
        WHERE account_id=$1 AND status IN ('queued','running')`,
        [actor.accountId],
      );
      if (Number(running.rows[0].count) + tasks.length > 20)
        throw new AppError(412, '并发任务已达上限');
      const balance = wallet.balance - cost;
      await client.query(
        'UPDATE credit_wallets SET balance=$1,updated_at=now() WHERE account_id=$2',
        [balance, actor.accountId],
      );
      await client.query(
        'INSERT INTO credit_ledger(account_id,source_key,amount,balance_after) VALUES ($1,$2,$3,$4)',
        [actor.accountId, `generation:${recordId}`, -cost, balance],
      );
      const taskIds: string[] = [];
      for (const [index, task] of normalized.entries()) {
        const taskId = randomUUID();
        taskIds.push(taskId);
        await client.query(
          `INSERT INTO generation_tasks(task_id,generation_request_id,task_index,account_id,canvas_id,node_id,status,price_credits,payload)
          VALUES ($1,$2,$3,$4,$5,$6,'queued',$7,$8)`,
          [
            taskId,
            recordId,
            index,
            actor.accountId,
            task.canvas_id,
            task.node_id,
            task.price_credits,
            task,
          ],
        );
        await client.query('UPDATE nodes SET current_task_id=$1 WHERE id=$2 AND canvas_id=$3', [
          taskId,
          task.node_id,
          task.canvas_id,
        ]);
        await client.query('INSERT INTO outbox_events(id,event_type,payload) VALUES ($1,$2,$3)', [
          randomUUID(),
          'generation.queued',
          { task_id: taskId },
        ]);
      }
      const response = batch
        ? { task_ids: taskIds, request_id: requestId }
        : { task_id: taskIds[0], request_id: requestId, status: 'queued', progress: 0 };
      await client.query(
        `UPDATE generation_requests SET status='accepted',response=$1,updated_at=now() WHERE id=$2`,
        [response, recordId],
      );
      return response;
    });
  }

  async create(actor: Identity, body: unknown) {
    const input = parse(singleSchema, body);
    return this.accept(
      actor,
      '/task/generation/create',
      input.request_id ?? randomUUID(),
      input.drama_id,
      [input],
      false,
    );
  }

  async batchCreate(actor: Identity, body: unknown) {
    const input = parse(batchSchema, body);
    const tasks = input.tasks.map((task) => ({
      ...task,
      canvas_id: task.canvas_id ?? input.canvas_id,
      node_id: task.node_id ?? input.node_id,
    }));
    return this.accept(
      actor,
      '/task/generation/batch_create',
      input.request_id ?? randomUUID(),
      input.drama_id,
      tasks,
      true,
    );
  }

  async progress(actor: Identity, body: unknown) {
    const input = parse(idsSchema, body);
    const result = await this.db.query<{
      task_id: string;
      status: string;
      progress: number;
      result: unknown;
      error_message: string | null;
      node_id: number;
    }>(
      `SELECT task_id,status,progress,result,error_message,node_id
      FROM generation_tasks WHERE task_id=ANY($1::uuid[]) AND account_id=$2`,
      [input.task_ids, actor.accountId],
    );
    if (result.rowCount !== new Set(input.task_ids).size) throw new AppError(404, '任务不存在');
    const map = new Map(result.rows.map((row) => [row.task_id, row]));
    return { list: input.task_ids.map((taskId) => map.get(taskId)) };
  }

  async cancel(actor: Identity, taskId: string) {
    return this.db.transaction(async (client) => {
      const result = await client.query<{ status: string; price_credits: number }>(
        `SELECT status,price_credits FROM generation_tasks
        WHERE task_id=$1 AND account_id=$2 FOR UPDATE`,
        [taskId, actor.accountId],
      );
      const task = result.rows[0];
      if (!task) throw new AppError(404, '任务不存在');
      if (task.status === 'running') throw new AppError(409, '任务正在执行，无法取消');
      if (task.status !== 'queued') return { task_id: taskId, status: task.status };
      await client.query(
        `UPDATE generation_tasks SET status='canceled',updated_at=now() WHERE task_id=$1`,
        [taskId],
      );
      await this.refund(client, actor.accountId, taskId, task.price_credits);
      return { task_id: taskId, status: 'canceled' };
    });
  }

  private async refund(
    client: PoolClient,
    accountId: number,
    taskId: string,
    amount: number,
  ): Promise<void> {
    if (amount === 0) return;
    const existing = await client.query(
      'SELECT 1 FROM credit_ledger WHERE account_id=$1 AND source_key=$2',
      [accountId, `refund:${taskId}`],
    );
    if (existing.rowCount) return;
    const wallet = (
      await client.query<{ balance: number }>(
        'SELECT balance FROM credit_wallets WHERE account_id=$1 FOR UPDATE',
        [accountId],
      )
    ).rows[0];
    const balance = wallet.balance + amount;
    await client.query(
      'UPDATE credit_wallets SET balance=$1,updated_at=now() WHERE account_id=$2',
      [balance, accountId],
    );
    await client.query(
      'INSERT INTO credit_ledger(account_id,source_key,amount,balance_after) VALUES ($1,$2,$3,$4)',
      [accountId, `refund:${taskId}`, amount, balance],
    );
  }

  async runMockTask(taskId: string): Promise<void> {
    if (!this.config.devMockExternals) throw new Error('Mock worker disabled');
    const task = await this.db.transaction(async (client) => {
      const result = await client.query<{
        status: string;
        payload: NormalizedTask;
        account_id: number;
        price_credits: number;
        node_id: number;
        canvas_id: number;
      }>(
        'SELECT status,payload,account_id,price_credits,node_id,canvas_id FROM generation_tasks WHERE task_id=$1 FOR UPDATE',
        [taskId],
      );
      const row = result.rows[0];
      if (!row || ['completed', 'failed', 'canceled'].includes(row.status)) return null;
      await client.query(
        `UPDATE generation_tasks SET status='running',progress=10,updated_at=now() WHERE task_id=$1`,
        [taskId],
      );
      return row;
    });
    if (!task) return;
    try {
      const type = task.payload.task_type;
      const outputs =
        type === 'text'
          ? [{ type: 'text', text: `[mock] ${task.payload.inputs.prompt ?? ''}` }]
          : [{ type, url: `mock://generation/${taskId}`, mock: true }];
      await this.db.transaction(async (client) => {
        const current = (
          await client.query<{ status: string }>(
            'SELECT status FROM generation_tasks WHERE task_id=$1 FOR UPDATE',
            [taskId],
          )
        ).rows[0];
        if (current?.status !== 'running') return;
        const result = { outputs, mock: true };
        await client.query(
          `UPDATE generation_tasks SET status='completed',progress=100,result=$1,updated_at=now() WHERE task_id=$2`,
          [result, taskId],
        );
        await client.query(
          `UPDATE nodes SET extra_data=jsonb_set(extra_data,'{generation_result}',$1::jsonb,true),updated_at=now()
          WHERE id=$2 AND canvas_id=$3 AND current_task_id=$4`,
          [JSON.stringify(result), task.node_id, task.canvas_id, taskId],
        );
      });
    } catch (error) {
      await this.db.transaction(async (client) => {
        const current = (
          await client.query<{ status: string }>(
            'SELECT status FROM generation_tasks WHERE task_id=$1 FOR UPDATE',
            [taskId],
          )
        ).rows[0];
        if (current?.status !== 'running') return;
        await client.query(
          `UPDATE generation_tasks SET status='failed',error_message='模拟任务失败',updated_at=now() WHERE task_id=$1`,
          [taskId],
        );
        await this.refund(client, task.account_id, taskId, task.price_credits);
      });
      throw error;
    }
  }
}

@Controller('api')
@UseGuards(AuthGuard)
export class GenerationController {
  constructor(@Inject(GenerationService) private readonly service: GenerationService) {}

  @Get('node/models') models() {
    return this.service.models();
  }
  @Post('node/credit') quote(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.quote(req.auth, body);
  }
  @Post('task/generation/create') create(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.create(req.auth, body);
  }
  @Post('task/generation/batch_create') batch(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.batchCreate(req.auth, body);
  }
  @Post('task/generation/progress') progress(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.progress(req.auth, body);
  }
  @Post('task/generation/cancel') cancel(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parse(z.object({ task_id: z.string().uuid() }), body);
    return this.service.cancel(req.auth, input.task_id);
  }
}
