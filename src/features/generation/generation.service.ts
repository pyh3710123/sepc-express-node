import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';
import { AppError, parse } from '../../common';
import type { Identity } from '../auth';
import { APP_CONFIG, type AppConfig } from '../../config';
import { Database, type QueryExecutor } from '../../database';
import { PermissionsService } from '../permissions/permissions.service';

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
interface ModelCapabilityView {
  capability_id: string;
  node_type: string;
  mode_type: string;
  scene: string;
  schema_version: number;
  model_revision: number;
  input_schema: Capability['input_schema'];
  parameters: Capability['parameters'];
  features: Capability['features'];
}
interface ModelView {
  model_code: string;
  model_name: string;
  model_type: string;
  capabilities: ModelCapabilityView[];
}
interface GenerationTaskProgress extends QueryResultRow {
  task_id: string;
  status: string;
  progress: number;
  result: unknown;
  error_message: string | null;
  node_id: number;
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

/** 递归生成键顺序稳定的 JSON 表示，用于请求语义比较。 */
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
/** 为 JSON 数据生成忽略对象键顺序的 SHA-256 摘要。 */
export function semanticHash(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex');
}

type CreditBucket = 'subscription' | 'recharge' | 'gift';
type BucketAmounts = Record<CreditBucket, number>;
const CREDIT_BUCKET_BY_ID: Record<number, CreditBucket> = {
  1: 'subscription',
  2: 'recharge',
  3: 'gift',
};
const DEFAULT_CREDIT_PRIORITY = [1, 2, 3];

/** 按账号顺序逐任务分配积分来源，保留每个任务可退款的扣费构成。 */
export function allocateTaskDebits(
  costs: number[],
  balance: BucketAmounts,
  priority: number[],
): BucketAmounts[] {
  if (
    priority.length !== 3 ||
    new Set(priority).size !== 3 ||
    priority.some((id) => !DEFAULT_CREDIT_PRIORITY.includes(id))
  )
    throw new AppError(409, '积分消耗顺序配置无效');
  return costs.map((cost) => {
    const debit: BucketAmounts = { subscription: 0, recharge: 0, gift: 0 };
    let remaining = cost;
    for (const id of priority) {
      const bucket = CREDIT_BUCKET_BY_ID[id];
      if (!bucket) throw new AppError(409, '积分消耗顺序配置无效');
      const used = Math.min(remaining, balance[bucket]);
      debit[bucket] = used;
      balance[bucket] -= used;
      remaining -= used;
    }
    if (remaining > 0) throw new AppError(402, '积分不足');
    return debit;
  });
}

@Injectable()
export class GenerationService {
  /** 注入数据库和开发模拟配置，处理模型能力与任务生命周期。 */
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
  ) {}

  /** 按模型聚合当前启用的生成能力；关闭模拟模式时返回空列表。 */
  async models(): Promise<{ list: ModelView[] }> {
    if (!this.config.devMockExternals) return { list: [] };
    const result = await this.db.query<
      Capability & { model_name: string; model_type: string }
    >(`SELECT m.model_name,m.model_type,c.*,m.provider FROM model_capabilities c
      JOIN model_catalog m ON m.model_code=c.model_code WHERE m.active AND c.active ORDER BY m.model_code,c.mode_type`);
    const models = new Map<string, ModelView>();
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

  /** 为筛选器返回持久模型主键和名称。 */
  async modelSelect(): Promise<{ list: Array<{ model_id: number; model_name: string }> }> {
    const result = await this.db.query<{ model_id: number; model_name: string }>(
      'SELECT model_id,model_name FROM model_catalog WHERE active ORDER BY model_id',
    );
    return { list: result.rows };
  }

  /** 校验节点、模型能力、输入参数和媒体归属并计算任务费用。 */
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
      JOIN dramas d ON d.id=c.drama_id AND d.deleted_at IS NULL WHERE n.id=$1 AND c.account_id=$2 AND d.id=$3
      FOR SHARE OF d`,
      [nodeId, actor.accountId, dramaId],
    );
    const canvasId = target.rows[0]?.canvas_id;
    if (!canvasId || (task.canvas_id && task.canvas_id !== canvasId))
      throw new AppError(404, '生成节点不存在');
    await this.permissions.assertProject(actor, 'drama', dramaId, 'generate', client);
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
        const url = typeof item === 'string' ? item : item.url;
        if (typeof item !== 'string' && item.asset_id) {
          const asset = await client.query<{ url: string }>(
            `SELECT url FROM media_assets WHERE id=$1 AND account_id=$2
             AND split_part(mime_type,'/',1)=$3`,
            [item.asset_id, actor.accountId, key.slice(0, -1)],
          );
          if (!asset.rows[0] || asset.rows[0].url !== url)
            throw new AppError(404, '媒体资产不存在');
          continue;
        }
        // URL 形态仅接受当前账号已登记或后台已发布的公共素材，拒绝任意外链。
        const registeredAsset = await client.query(
          `SELECT 1 FROM media_assets WHERE account_id=$1 AND url=$2
             AND split_part(mime_type,'/',1)=$3
           UNION ALL SELECT 1 FROM public_media_assets WHERE published AND url=$2
             AND split_part(mime_type,'/',1)=$3 LIMIT 1`,
          [actor.accountId, url, key.slice(0, -1)],
        );
        if (!registeredAsset.rowCount) throw new AppError(404, '媒体资产不存在');
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

  /** 根据已校验的生成输入计算本次请求所需积分。 */
  async quote(actor: Identity, body: unknown): Promise<{ credit: number; capability_id: string }> {
    const input = parse(singleSchema, body);
    const normalized = await this.normalize(this.db, actor, input.drama_id, input);
    return { credit: normalized.price_credits, capability_id: normalized.capability_id };
  }

  /** 在单一事务中处理幂等键、扣费、任务记录和 outbox 事件。 */
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
      // 锁住成员身份直至任务受理提交，避免移除成员与扣费同时发生。
      const membership = await client.query<{ role: Identity['role'] }>(
        `SELECT role FROM account_members WHERE account_id=$1 AND user_id=$2
         AND status='active' FOR SHARE`,
        [actor.accountId, actor.userId],
      );
      if (!membership.rows[0] || membership.rows[0].role !== actor.role)
        throw new AppError(401, '账号身份已变化，请重新登录');
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
        await client.query<{
          balance: number;
          subscription_balance: number;
          recharge_balance: number;
          gift_balance: number;
        }>(
          `SELECT balance,subscription_balance,recharge_balance,gift_balance
           FROM credit_wallets WHERE account_id=$1 FOR UPDATE`,
          [actor.accountId],
        )
      ).rows[0];
      const cost = normalized.reduce((sum, task) => sum + task.price_credits, 0);
      if (actor.role === 'member') {
        // 锁住额度记录，让同一成员跨实例并发受理任务时使用量检查串行化。
        const allocation = await client.query<{ credit_quota: number }>(
          `SELECT credit_quota::float8 AS credit_quota FROM member_credit_allocations WHERE account_id=$1 AND user_id=$2 FOR UPDATE`,
          [actor.accountId, actor.userId],
        );
        const quota = allocation.rows[0]?.credit_quota ?? -1;
        if (quota >= 0) {
          const used = await client.query<{ use_credit: number }>(
            `SELECT COALESCE(sum(price_credits),0)::int AS use_credit FROM generation_tasks
             WHERE account_id=$1 AND created_by=$2 AND status IN ('queued','running','completed')
             AND created_at>=date_trunc('month',now())`,
            [actor.accountId, actor.userId],
          );
          if (used.rows[0].use_credit + cost > quota) throw new AppError(402, '成员积分额度不足');
        }
      }
      if (!wallet || wallet.balance < cost) throw new AppError(402, '积分不足');
      const prioritySetting = await client.query<{ priority: number[] }>(
        'SELECT priority FROM credit_priority_settings WHERE account_id=$1',
        [actor.accountId],
      );
      const priority = prioritySetting.rows[0]?.priority ?? DEFAULT_CREDIT_PRIORITY;
      const buckets: BucketAmounts = {
        subscription: wallet.subscription_balance,
        recharge: wallet.recharge_balance,
        gift: wallet.gift_balance,
      };
      const taskDebits = allocateTaskDebits(
        normalized.map((task) => task.price_credits),
        buckets,
        priority,
      );
      const debitTotal = taskDebits.reduce<BucketAmounts>(
        (sum, debit) => ({
          subscription: sum.subscription + debit.subscription,
          recharge: sum.recharge + debit.recharge,
          gift: sum.gift + debit.gift,
        }),
        { subscription: 0, recharge: 0, gift: 0 },
      );
      const running = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM generation_tasks
        WHERE account_id=$1 AND status IN ('queued','running')`,
        [actor.accountId],
      );
      if (Number(running.rows[0].count) + tasks.length > 20)
        throw new AppError(412, '并发任务已达上限');
      const balance = wallet.balance - cost;
      await client.query(
        `UPDATE credit_wallets SET balance=$1,subscription_balance=$2,recharge_balance=$3,
         gift_balance=$4,updated_at=now() WHERE account_id=$5`,
        [balance, buckets.subscription, buckets.recharge, buckets.gift, actor.accountId],
      );
      await client.query(
        `INSERT INTO credit_ledger(account_id,source_key,amount,balance_after,bucket_amounts)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          actor.accountId,
          `generation:${recordId}`,
          -cost,
          balance,
          {
            subscription: -debitTotal.subscription,
            recharge: -debitTotal.recharge,
            gift: -debitTotal.gift,
          },
        ],
      );
      const taskIds: string[] = [];
      for (const [index, task] of normalized.entries()) {
        const taskId = randomUUID();
        taskIds.push(taskId);
        await client.query(
          `INSERT INTO generation_tasks(task_id,generation_request_id,task_index,account_id,canvas_id,node_id,status,price_credits,payload,created_by,debit_buckets)
          VALUES ($1,$2,$3,$4,$5,$6,'queued',$7,$8,$9,$10)`,
          [
            taskId,
            recordId,
            index,
            actor.accountId,
            task.canvas_id,
            task.node_id,
            task.price_credits,
            task,
            actor.userId,
            taskDebits[index],
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

  /** 校验并受理单个生成任务。 */
  async create(actor: Identity, body: unknown): Promise<unknown> {
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

  /** 合并批次级节点与画布信息后受理多个生成任务。 */
  async batchCreate(actor: Identity, body: unknown): Promise<unknown> {
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

  /** 返回当前账号指定任务的执行进度与结果。 */
  async progress(actor: Identity, body: unknown): Promise<{ list: GenerationTaskProgress[] }> {
    const input = parse(idsSchema, body);
    const result = await this.db.query<GenerationTaskProgress & { drama_id: number | null }>(
      `SELECT t.task_id,t.status,t.progress,t.result,t.error_message,t.node_id,d.id AS drama_id
      FROM generation_tasks t LEFT JOIN canvases c ON c.id=t.canvas_id
      LEFT JOIN dramas d ON d.id=c.drama_id AND d.deleted_at IS NULL
      WHERE t.task_id=ANY($1::uuid[]) AND t.account_id=$2`,
      [input.task_ids, actor.accountId],
    );
    if (result.rowCount !== new Set(input.task_ids).size) throw new AppError(404, '任务不存在');
    for (const dramaId of new Set(result.rows.map((row) => row.drama_id))) {
      if (dramaId) await this.permissions.assertProject(actor, 'drama', dramaId, 'read');
      else if (actor.role === 'member') throw new AppError(404, '任务不存在');
    }
    const map = new Map(result.rows.map((row) => [row.task_id, row]));
    const list = input.task_ids.map((taskId) => {
      const task = map.get(taskId);
      if (!task) throw new AppError(404, '任务不存在');
      return {
        task_id: task.task_id,
        status: task.status,
        progress: task.progress,
        result: task.result,
        error_message: task.error_message,
        node_id: task.node_id,
      };
    });
    return { list };
  }

  /** 取消尚未运行的任务，并在事务中返还已扣积分。 */
  async cancel(actor: Identity, taskId: string): Promise<{ task_id: string; status: string }> {
    return this.db.transaction(async (client) => {
      const result = await client.query<{
        status: string;
        price_credits: number;
        drama_id: number | null;
      }>(
        `SELECT t.status,t.price_credits,d.id AS drama_id FROM generation_tasks t
         LEFT JOIN canvases c ON c.id=t.canvas_id LEFT JOIN dramas d ON d.id=c.drama_id AND d.deleted_at IS NULL
         WHERE t.task_id=$1 AND t.account_id=$2 FOR UPDATE OF t`,
        [taskId, actor.accountId],
      );
      const task = result.rows[0];
      if (!task) throw new AppError(404, '任务不存在');
      if (task.drama_id)
        await this.permissions.assertProject(actor, 'drama', task.drama_id, 'generate', client);
      else if (actor.role === 'member') throw new AppError(404, '任务不存在');
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

  /** 通过账本唯一来源键幂等返还任务积分。 */
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
    const debited = await client.query<{ debit_buckets: BucketAmounts }>(
      'SELECT debit_buckets FROM generation_tasks WHERE task_id=$1 AND account_id=$2',
      [taskId, accountId],
    );
    const original = debited.rows[0]?.debit_buckets;
    const amounts: BucketAmounts =
      original && Object.keys(original).length
        ? original
        : { subscription: 0, recharge: 0, gift: amount };
    if (amounts.subscription + amounts.recharge + amounts.gift !== amount)
      throw new AppError(409, '积分退款来源不匹配');
    const wallet = (
      await client.query<{
        balance: number;
        subscription_balance: number;
        recharge_balance: number;
        gift_balance: number;
      }>(
        `SELECT balance,subscription_balance,recharge_balance,gift_balance
         FROM credit_wallets WHERE account_id=$1 FOR UPDATE`,
        [accountId],
      )
    ).rows[0];
    const balance = wallet.balance + amount;
    await client.query(
      `UPDATE credit_wallets SET balance=$1,subscription_balance=$2,recharge_balance=$3,
       gift_balance=$4,updated_at=now() WHERE account_id=$5`,
      [
        balance,
        wallet.subscription_balance + amounts.subscription,
        wallet.recharge_balance + amounts.recharge,
        wallet.gift_balance + amounts.gift,
        accountId,
      ],
    );
    await client.query(
      `INSERT INTO credit_ledger(account_id,source_key,amount,balance_after,bucket_amounts)
       VALUES ($1,$2,$3,$4,$5)`,
      [accountId, `refund:${taskId}`, amount, balance, amounts],
    );
  }

  /** 执行开发模拟任务，并仅在任务仍运行时写入结果或退款。 */
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
