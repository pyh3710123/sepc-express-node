import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { z } from 'zod';
import { AppError, parse } from './common';
import { AuthGuard, type AuthedRequest, type Identity } from './auth';
import { APP_CONFIG, type AppConfig } from './config';
import { Database, type QueryExecutor } from './database';
import { Inject } from '@nestjs/common';

const id = z.coerce.number().int().positive();
const uuid = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w.-]+$/);
const position = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const size = z
  .object({ width: z.number().positive().max(10000), height: z.number().positive().max(10000) })
  .strict();
const extraData = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 16384, 'extra_data is too large');
const nodeFields = z
  .object({
    uuid,
    type: z.string().min(1).max(50),
    node_name: z.string().max(200),
    position,
    size: size.optional(),
    parent_uuid: uuid.nullable().optional(),
    z_index: z.number().int().min(-100000).max(100000).optional(),
    content: z.string().max(100000).nullable().optional(),
    extra_data: extraData.optional(),
  })
  .strict();
const nodeCreate = nodeFields;
const nodeUpdate = nodeFields.partial().extend({ id, uuid: uuid.optional() }).strict();
const edgeFields = z
  .object({
    uuid,
    source_uuid: uuid,
    target_uuid: uuid,
    source_anchor: z.string().max(100).nullable().optional(),
    target_anchor: z.string().max(100).nullable().optional(),
    type: z.string().max(50).nullable().optional(),
    extra_data: extraData.optional(),
  })
  .strict();
const edgeCreate = edgeFields;
const edgeUpdate = edgeFields.partial().extend({ id, uuid: uuid.optional() }).strict();
const operations = <T extends z.ZodTypeAny, U extends z.ZodTypeAny>(create: T, update: U) =>
  z
    .object({
      create: z.array(create).default([]),
      update: z.array(update).default([]),
      delete: z.array(z.object({ id }).strict()).default([]),
    })
    .strict()
    .default({ create: [], update: [], delete: [] });
export const batchSchema = z
  .object({
    drama_id: id,
    canvas_id: id,
    expected_version: z.number().int().nonnegative(),
    nodes: operations(nodeCreate, nodeUpdate),
    connections: operations(edgeCreate, edgeUpdate),
  })
  .strict();
export type BatchInput = z.infer<typeof batchSchema>;

interface NodeRow extends QueryResultRow {
  id: number;
  uuid: string;
  type: string;
  node_name: string;
  position_x: number;
  position_y: number;
  width: number | null;
  height: number | null;
  parent_uuid: string | null;
  z_index: number;
  content: string | null;
  extra_data: Record<string, unknown>;
}
interface EdgeRow extends QueryResultRow {
  id: number;
  uuid: string;
  source_uuid: string;
  target_uuid: string;
  source_anchor: string | null;
  target_anchor: string | null;
  type: string | null;
  extra_data: Record<string, unknown>;
}
interface CanvasRow extends QueryResultRow {
  id: number;
  drama_id: number;
  title: string;
  version: number;
  schema_version: number;
  updated_at: Date;
}

function nodeDto(row: NodeRow) {
  return {
    node_id: row.id,
    uuid: row.uuid,
    type: row.type,
    node_name: row.node_name,
    position: { x: row.position_x, y: row.position_y },
    size: row.width == null || row.height == null ? null : { width: row.width, height: row.height },
    parent_uuid: row.parent_uuid,
    z_index: row.z_index,
    content: row.content,
    extra_data: row.extra_data,
  };
}
function edgeDto(row: EdgeRow) {
  return {
    connection_id: row.id,
    uuid: row.uuid,
    source_uuid: row.source_uuid,
    target_uuid: row.target_uuid,
    source_anchor: row.source_anchor,
    target_anchor: row.target_anchor,
    type: row.type,
    extra_data: row.extra_data,
  };
}

@Injectable()
export class CanvasService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async canvas(
    client: QueryExecutor,
    canvasId: number,
    actor: Identity,
    action: 'read' | 'edit' | 'delete',
    lock = false,
  ): Promise<CanvasRow> {
    const result = await client.query<CanvasRow>(
      `SELECT c.id,c.drama_id,c.title,c.version,c.schema_version,c.updated_at
      FROM canvases c JOIN dramas d ON d.id=c.drama_id AND d.deleted_at IS NULL
      WHERE c.id=$1 AND c.account_id=$2 ${lock ? 'FOR UPDATE OF c' : ''}`,
      [canvasId, actor.accountId],
    );
    const canvas = result.rows[0];
    if (!canvas) throw new AppError(404, '画布不存在');
    if (action === 'delete' && actor.role === 'member') throw new AppError(403, '没有删除权限');
    return canvas;
  }

  async listDramas(actor: Identity, page: number, limit: number) {
    const [rows, count] = await Promise.all([
      this.db.query(
        'SELECT id AS drama_id,title,type,parent_id,created_at,updated_at FROM dramas WHERE account_id=$1 AND deleted_at IS NULL ORDER BY id DESC LIMIT $2 OFFSET $3',
        [actor.accountId, limit, (page - 1) * limit],
      ),
      this.db.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM dramas WHERE account_id=$1 AND deleted_at IS NULL',
        [actor.accountId],
      ),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  async createDrama(actor: Identity, title: string) {
    const result = await this.db.query<{ id: number }>(
      `INSERT INTO dramas(account_id,created_by,title) VALUES ($1,$2,$3) RETURNING id`,
      [actor.accountId, actor.userId, title],
    );
    return { drama_id: result.rows[0].id };
  }

  async createCanvas(actor: Identity, dramaId: number, title: string) {
    const drama = await this.db.query(
      'SELECT 1 FROM dramas WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL',
      [dramaId, actor.accountId],
    );
    if (!drama.rowCount) throw new AppError(404, '项目不存在');
    const result = await this.db.query<{ id: number }>(
      'INSERT INTO canvases(account_id,drama_id,title) VALUES ($1,$2,$3) RETURNING id',
      [actor.accountId, dramaId, title],
    );
    return { canvas_id: result.rows[0].id };
  }

  async options(actor: Identity, dramaId: number) {
    const drama = await this.db.query(
      'SELECT 1 FROM dramas WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL',
      [dramaId, actor.accountId],
    );
    if (!drama.rowCount) throw new AppError(404, '项目不存在');
    const result = await this.db.query(
      'SELECT id AS canvas_id,title AS canvas_title FROM canvases WHERE drama_id=$1 AND account_id=$2 ORDER BY id',
      [dramaId, actor.accountId],
    );
    return { list: result.rows };
  }

  async detail(actor: Identity, canvasId: number) {
    const canvas = await this.canvas(this.db, canvasId, actor, 'read');
    const [nodes, connections, viewport] = await Promise.all([
      this.db.query<NodeRow>('SELECT * FROM nodes WHERE canvas_id=$1 ORDER BY id', [canvasId]),
      this.db.query<EdgeRow>('SELECT * FROM connections WHERE canvas_id=$1 ORDER BY id', [
        canvasId,
      ]),
      this.db.query<{ x: number; y: number; window_zoom_rate: number }>(
        'SELECT x,y,window_zoom_rate FROM canvas_viewports WHERE canvas_id=$1 AND user_id=$2',
        [canvasId, actor.userId],
      ),
    ]);
    return {
      canvas_id: canvas.id,
      drama_id: canvas.drama_id,
      canvas_title: canvas.title,
      version: canvas.version,
      schema_version: canvas.schema_version,
      updated_at: canvas.updated_at.getTime(),
      nodes: nodes.rows.map(nodeDto),
      connections: connections.rows.map(edgeDto),
      settings: viewport.rows[0] ?? { x: 0, y: 0, window_zoom_rate: 100 },
    };
  }

  async viewport(
    actor: Identity,
    canvasId: number,
    input: { x: number; y: number; window_zoom_rate: number },
  ) {
    await this.canvas(this.db, canvasId, actor, 'read');
    await this.db.query(
      `INSERT INTO canvas_viewports(canvas_id,user_id,x,y,window_zoom_rate) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (canvas_id,user_id) DO UPDATE SET x=EXCLUDED.x,y=EXCLUDED.y,window_zoom_rate=EXCLUDED.window_zoom_rate,updated_at=now()`,
      [canvasId, actor.userId, input.x, input.y, input.window_zoom_rate],
    );
    return { canvas_id: canvasId };
  }

  async rename(actor: Identity, canvasId: number, title: string) {
    await this.canvas(this.db, canvasId, actor, 'edit');
    await this.db.query('UPDATE canvases SET title=$1,updated_at=now() WHERE id=$2', [
      title,
      canvasId,
    ]);
    return { canvas_id: canvasId, canvas_title: title };
  }

  async deleteCanvas(actor: Identity, canvasId: number) {
    await this.canvas(this.db, canvasId, actor, 'delete');
    await this.db.query('DELETE FROM canvases WHERE id=$1 AND account_id=$2', [
      canvasId,
      actor.accountId,
    ]);
    return { canvas_id: canvasId };
  }

  async copy(actor: Identity, canvasId: number, title: string) {
    return this.db.transaction(async (client) => {
      const source = await this.canvas(client, canvasId, actor, 'edit', true);
      const created = await client.query<{ id: number }>(
        'INSERT INTO canvases(account_id,drama_id,title,schema_version) VALUES ($1,$2,$3,$4) RETURNING id',
        [actor.accountId, source.drama_id, title, source.schema_version],
      );
      const copyId = created.rows[0].id;
      await client.query(
        `INSERT INTO nodes(canvas_id,uuid,type,node_name,position_x,position_y,width,height,parent_uuid,z_index,content,extra_data)
        SELECT $1,uuid,type,node_name,position_x,position_y,width,height,parent_uuid,z_index,content,extra_data FROM nodes WHERE canvas_id=$2`,
        [copyId, canvasId],
      );
      await client.query(
        `INSERT INTO connections(canvas_id,uuid,source_uuid,target_uuid,source_anchor,target_anchor,type,extra_data)
        SELECT $1,uuid,source_uuid,target_uuid,source_anchor,target_anchor,type,extra_data FROM connections WHERE canvas_id=$2`,
        [copyId, canvasId],
      );
      return { canvas_id: copyId };
    });
  }

  async nodesByIds(actor: Identity, ids: number[]) {
    if (ids.length > 100) throw new AppError(400, '节点数量超限');
    const result = await this.db.query<NodeRow>(
      `SELECT n.* FROM nodes n JOIN canvases c ON c.id=n.canvas_id
      JOIN dramas d ON d.id=c.drama_id AND d.deleted_at IS NULL WHERE n.id=ANY($1::int[]) AND c.account_id=$2 ORDER BY n.id`,
      [ids, actor.accountId],
    );
    return { list: result.rows.map(nodeDto) };
  }

  async connection(actor: Identity, connectionId: number) {
    const result = await this.db.query<EdgeRow>(
      `SELECT e.* FROM connections e JOIN canvases c ON c.id=e.canvas_id
      JOIN dramas d ON d.id=c.drama_id AND d.deleted_at IS NULL WHERE e.id=$1 AND c.account_id=$2`,
      [connectionId, actor.accountId],
    );
    if (!result.rows[0]) throw new AppError(404, '连线不存在');
    return edgeDto(result.rows[0]);
  }

  async batch(actor: Identity, input: BatchInput) {
    const nodeCount =
      input.nodes.create.length + input.nodes.update.length + input.nodes.delete.length;
    const edgeCount =
      input.connections.create.length +
      input.connections.update.length +
      input.connections.delete.length;
    if (nodeCount > this.config.maxBatchNodes || edgeCount > this.config.maxBatchConnections)
      throw new AppError(400, '批量保存数量超限');
    return this.db.transaction(async (client) => {
      const canvas = await this.canvas(client, input.canvas_id, actor, 'edit', true);
      if (canvas.drama_id !== input.drama_id) throw new AppError(404, '画布不存在');
      if (canvas.version !== input.expected_version)
        throw new AppError(409, '画布版本冲突', { current_version: canvas.version });
      const existingNodes = (
        await client.query<NodeRow>('SELECT * FROM nodes WHERE canvas_id=$1 FOR UPDATE', [
          input.canvas_id,
        ])
      ).rows;
      const existingEdges = (
        await client.query<EdgeRow>('SELECT * FROM connections WHERE canvas_id=$1 FOR UPDATE', [
          input.canvas_id,
        ])
      ).rows;
      const nodes = new Map(existingNodes.map((row) => [row.uuid, { ...row }]));
      const edges = new Map(existingEdges.map((row) => [row.uuid, { ...row }]));
      const nodeIds = new Map(existingNodes.map((row) => [row.id, row.uuid]));
      const edgeIds = new Map(existingEdges.map((row) => [row.id, row.uuid]));
      const deletedNodeIds = new Set<number>();
      const deletedEdgeIds = new Set<number>();
      const changedNodes = new Set<number>();
      const changedEdges = new Set<number>();

      for (const item of input.nodes.delete) {
        const key = nodeIds.get(item.id);
        if (!key) throw new AppError(400, '删除的节点不属于画布');
        deletedNodeIds.add(item.id);
      }
      // Deleting a group also deletes all descendants, including their edges.
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const row of nodes.values()) {
          if (
            row.parent_uuid &&
            !deletedNodeIds.has(row.id) &&
            deletedNodeIds.has(nodes.get(row.parent_uuid)?.id ?? -1)
          ) {
            deletedNodeIds.add(row.id);
            expanded = true;
          }
        }
      }
      for (const row of existingNodes) if (deletedNodeIds.has(row.id)) nodes.delete(row.uuid);

      for (const item of input.nodes.update) {
        const key = nodeIds.get(item.id);
        const row = key && nodes.get(key);
        if (!row || (item.uuid && item.uuid !== row.uuid))
          throw new AppError(400, '更新的节点不属于画布');
        if (changedNodes.has(item.id)) throw new AppError(400, '节点重复更新');
        changedNodes.add(item.id);
        if (item.type !== undefined) row.type = item.type;
        if (item.node_name !== undefined) row.node_name = item.node_name;
        if (item.position !== undefined) {
          row.position_x = item.position.x;
          row.position_y = item.position.y;
        }
        if (item.size !== undefined) {
          row.width = item.size.width;
          row.height = item.size.height;
        }
        if (item.parent_uuid !== undefined) row.parent_uuid = item.parent_uuid;
        if (item.z_index !== undefined) row.z_index = item.z_index;
        if (item.content !== undefined) row.content = item.content;
        if (item.extra_data !== undefined) row.extra_data = item.extra_data;
      }
      for (const item of input.nodes.create) {
        if (nodes.has(item.uuid)) throw new AppError(400, '节点 UUID 重复');
        nodes.set(item.uuid, {
          id: -1,
          uuid: item.uuid,
          type: item.type,
          node_name: item.node_name,
          position_x: item.position.x,
          position_y: item.position.y,
          width: item.size?.width ?? null,
          height: item.size?.height ?? null,
          parent_uuid: item.parent_uuid ?? null,
          z_index: item.z_index ?? 0,
          content: item.content ?? null,
          extra_data: item.extra_data ?? {},
        });
      }
      for (const row of nodes.values()) {
        if (row.parent_uuid && (!nodes.has(row.parent_uuid) || row.parent_uuid === row.uuid))
          throw new AppError(400, '无效的节点分组');
        const seen = new Set<string>([row.uuid]);
        let parent = row.parent_uuid;
        while (parent) {
          if (seen.has(parent)) throw new AppError(400, '节点分组存在循环');
          seen.add(parent);
          parent = nodes.get(parent)?.parent_uuid ?? null;
        }
      }

      for (const item of input.connections.delete) {
        const key = edgeIds.get(item.id);
        if (!key) throw new AppError(400, '删除的连线不属于画布');
        deletedEdgeIds.add(item.id);
      }
      for (const row of existingEdges)
        if (
          deletedEdgeIds.has(row.id) ||
          !nodes.has(row.source_uuid) ||
          !nodes.has(row.target_uuid)
        ) {
          deletedEdgeIds.add(row.id);
          edges.delete(row.uuid);
        }
      for (const item of input.connections.update) {
        const key = edgeIds.get(item.id);
        const row = key && edges.get(key);
        if (!row || (item.uuid && item.uuid !== row.uuid))
          throw new AppError(400, '更新的连线不属于画布');
        if (changedEdges.has(item.id)) throw new AppError(400, '连线重复更新');
        changedEdges.add(item.id);
        if (item.source_uuid !== undefined) row.source_uuid = item.source_uuid;
        if (item.target_uuid !== undefined) row.target_uuid = item.target_uuid;
        if (item.source_anchor !== undefined) row.source_anchor = item.source_anchor;
        if (item.target_anchor !== undefined) row.target_anchor = item.target_anchor;
        if (item.type !== undefined) row.type = item.type;
        if (item.extra_data !== undefined) row.extra_data = item.extra_data;
      }
      for (const item of input.connections.create) {
        if (edges.has(item.uuid)) throw new AppError(400, '连线 UUID 重复');
        edges.set(item.uuid, {
          id: -1,
          uuid: item.uuid,
          source_uuid: item.source_uuid,
          target_uuid: item.target_uuid,
          source_anchor: item.source_anchor ?? null,
          target_anchor: item.target_anchor ?? null,
          type: item.type ?? null,
          extra_data: item.extra_data ?? {},
        });
      }
      for (const row of edges.values()) {
        if (!nodes.has(row.source_uuid) || !nodes.has(row.target_uuid))
          throw new AppError(400, '连线端点不存在');
      }

      if (deletedEdgeIds.size)
        await client.query('DELETE FROM connections WHERE canvas_id=$1 AND id=ANY($2::int[])', [
          input.canvas_id,
          [...deletedEdgeIds],
        ]);
      if (deletedNodeIds.size)
        await client.query('DELETE FROM nodes WHERE canvas_id=$1 AND id=ANY($2::int[])', [
          input.canvas_id,
          [...deletedNodeIds],
        ]);
      const updatedNodes = [];
      for (const item of input.nodes.update) {
        const row = nodes.get(nodeIds.get(item.id)!)!;
        await client.query(
          `UPDATE nodes SET type=$1,node_name=$2,position_x=$3,position_y=$4,width=$5,height=$6,parent_uuid=$7,z_index=$8,content=$9,extra_data=$10,updated_at=now()
          WHERE id=$11 AND canvas_id=$12`,
          [
            row.type,
            row.node_name,
            row.position_x,
            row.position_y,
            row.width,
            row.height,
            row.parent_uuid,
            row.z_index,
            row.content,
            row.extra_data,
            row.id,
            input.canvas_id,
          ],
        );
        updatedNodes.push({ uuid: row.uuid, node_id: row.id });
      }
      const createdNodes = [];
      for (const item of input.nodes.create) {
        const row = nodes.get(item.uuid)!;
        const result = await client.query<{ id: number }>(
          `INSERT INTO nodes(canvas_id,uuid,type,node_name,position_x,position_y,width,height,parent_uuid,z_index,content,extra_data)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [
            input.canvas_id,
            row.uuid,
            row.type,
            row.node_name,
            row.position_x,
            row.position_y,
            row.width,
            row.height,
            row.parent_uuid,
            row.z_index,
            row.content,
            row.extra_data,
          ],
        );
        createdNodes.push({ uuid: row.uuid, node_id: result.rows[0].id });
      }
      const updatedEdges = [];
      for (const item of input.connections.update) {
        const row = edges.get(edgeIds.get(item.id)!)!;
        await client.query(
          `UPDATE connections SET source_uuid=$1,target_uuid=$2,source_anchor=$3,target_anchor=$4,type=$5,extra_data=$6,updated_at=now()
          WHERE id=$7 AND canvas_id=$8`,
          [
            row.source_uuid,
            row.target_uuid,
            row.source_anchor,
            row.target_anchor,
            row.type,
            row.extra_data,
            row.id,
            input.canvas_id,
          ],
        );
        updatedEdges.push({
          uuid: row.uuid,
          connection_id: row.id,
          source_uuid: row.source_uuid,
          target_uuid: row.target_uuid,
          source_anchor: row.source_anchor,
          target_anchor: row.target_anchor,
        });
      }
      const createdEdges = [];
      for (const item of input.connections.create) {
        const row = edges.get(item.uuid)!;
        const result = await client.query<{ id: number }>(
          `INSERT INTO connections(canvas_id,uuid,source_uuid,target_uuid,source_anchor,target_anchor,type,extra_data)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            input.canvas_id,
            row.uuid,
            row.source_uuid,
            row.target_uuid,
            row.source_anchor,
            row.target_anchor,
            row.type,
            row.extra_data,
          ],
        );
        createdEdges.push({
          uuid: row.uuid,
          connection_id: result.rows[0].id,
          source_uuid: row.source_uuid,
          target_uuid: row.target_uuid,
          source_anchor: row.source_anchor,
          target_anchor: row.target_anchor,
        });
      }
      const updated = await client.query<{ version: number; updated_at: Date }>(
        'UPDATE canvases SET version=version+1,updated_at=now() WHERE id=$1 RETURNING version,updated_at',
        [input.canvas_id],
      );
      const data = {
        version: updated.rows[0].version,
        updated_at: updated.rows[0].updated_at.getTime(),
        nodes: { create: createdNodes, update: updatedNodes },
        connections: { create: createdEdges, update: updatedEdges },
        deleted_node_ids: [...deletedNodeIds].sort((a, b) => a - b),
        deleted_connection_ids: [...deletedEdgeIds].sort((a, b) => a - b),
      };
      const eventId = randomUUID();
      await client.query(
        'INSERT INTO canvas_events(event_id,canvas_id,server_version,payload) VALUES ($1,$2,$3,$4)',
        [eventId, input.canvas_id, data.version, data],
      );
      await client.query('INSERT INTO outbox_events(id,event_type,payload) VALUES ($1,$2,$3)', [
        randomUUID(),
        'canvas.changed',
        { event_id: eventId, canvas_id: input.canvas_id, account_id: actor.accountId, ...data },
      ]);
      return data;
    });
  }
}

@Controller('api')
@UseGuards(AuthGuard)
export class CanvasController {
  constructor(@Inject(CanvasService) private readonly service: CanvasService) {}

  @Get('drama') list(
    @Req() req: AuthedRequest,
    @Query('page') page: unknown,
    @Query('limit') limit: unknown,
  ) {
    const pagination = parse(
      z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
      { page, limit },
    );
    return this.service.listDramas(req.auth, pagination.page, pagination.limit);
  }
  @Post('drama') createDrama(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parse(z.object({ title: z.string().min(1).max(200) }).strict(), body);
    return this.service.createDrama(req.auth, input.title);
  }
  @Post('drama/canvas') createCanvas(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parse(z.object({ drama_id: id, title: z.string().min(1).max(200) }), body);
    return this.service.createCanvas(req.auth, input.drama_id, input.title);
  }
  @Get('drama/canvas/options') options(
    @Req() req: AuthedRequest,
    @Query('drama_id') dramaId: unknown,
  ) {
    return this.service.options(req.auth, parse(id, dramaId));
  }
  @Put('drama/canvas/rename') rename(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parse(
      z.object({ canvas_id: id, canvas_title: z.string().min(1).max(200) }),
      body,
    );
    return this.service.rename(req.auth, input.canvas_id, input.canvas_title);
  }
  @Post('drama/canvas/copy') copy(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parse(
      z.object({ canvas_id: id, canvas_title: z.string().min(1).max(200) }),
      body,
    );
    return this.service.copy(req.auth, input.canvas_id, input.canvas_title);
  }
  @Get('drama/canvas/:id') detail(@Req() req: AuthedRequest, @Param('id') canvasId: unknown) {
    return this.service.detail(req.auth, parse(id, canvasId));
  }
  @Put('drama/canvas/:id') viewport(
    @Req() req: AuthedRequest,
    @Param('id') canvasId: unknown,
    @Body() body: unknown,
  ) {
    const input = parse(
      z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        window_zoom_rate: z.number().finite().min(10).max(800),
      }),
      body,
    );
    return this.service.viewport(req.auth, parse(id, canvasId), input);
  }
  @Delete('drama/canvas/:id') delete(@Req() req: AuthedRequest, @Param('id') canvasId: unknown) {
    return this.service.deleteCanvas(req.auth, parse(id, canvasId));
  }
  @Post('node/batch') batch(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.service.batch(req.auth, parse(batchSchema, body));
  }
  @Post('nodes') nodes(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parse(z.object({ ids: z.array(id).max(100) }), body);
    return this.service.nodesByIds(req.auth, input.ids);
  }
  @Get('connection/:id') connection(@Req() req: AuthedRequest, @Param('id') connectionId: unknown) {
    return this.service.connection(req.auth, parse(id, connectionId));
  }
  @Get('node') types() {
    return {
      list: [
        { type: 'text' },
        { type: 'image' },
        { type: 'video' },
        { type: 'audio' },
        { type: 'group' },
      ],
    };
  }
  @Post('node/download') download() {
    throw new AppError(503, '媒体签名服务未配置');
  }
}
