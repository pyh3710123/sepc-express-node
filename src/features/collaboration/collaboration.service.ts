import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import type { QueryResultRow } from 'pg';
import { AuthService, type Identity } from '../auth';
import { CanvasService } from '../canvas/canvas.service';
import { AppError, parse } from '../../common';
import { APP_CONFIG, type AppConfig } from '../../config';
import { Database } from '../../database';
import { Inject } from '@nestjs/common';
import { sessionEvents } from '../auth/session-events';

interface Peer {
  socket: WebSocket;
  token: string;
  identity: Identity;
  clientId: string;
  canvasId?: number;
  pathCanvasId?: number;
  dramaId?: number;
  lockKeys: Set<string>;
  windowStarted: number;
  messageCount: number;
}

interface CollaborationMember {
  client_id: string;
  user_id: number;
}

interface CollaborationLock {
  node_id: number;
  lock_type: string;
  client_id: string;
}

interface CollaborationEvent extends QueryResultRow {
  event_id: string;
  server_version: number;
  payload: unknown;
}

interface CollaborationJoinResult {
  list: CollaborationMember[];
  locks: CollaborationLock[];
  version: number;
  events: CollaborationEvent[];
  resync_required: boolean;
}

@Injectable()
export class CollaborationService implements OnModuleDestroy {
  private readonly peers = new Map<string, Peer>();
  private readonly ws = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
  private readonly redis: Redis;
  private readonly subscriber: Redis;
  private closed = false;

  /** 注入认证、画布和数据库服务，并建立 WebSocket 与 Redis 客户端。 */
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CanvasService) private readonly canvases: CanvasService,
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
    this.subscriber = new Redis(config.redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
    sessionEvents.on('invalidated', this.kickSession);
  }

  /** 连接 Redis 事件通道并把 HTTP Upgrade 请求交给 WebSocket 服务。 */
  async attach(server: Server): Promise<void> {
    await this.redis.connect();
    await this.subscriber.connect();
    await this.subscriber.subscribe('canvas-events');
    this.subscriber.on('message', (channel, raw) => {
      if (channel === 'canvas-events') this.broadcastSavedEvent(raw);
    });
    server.on('upgrade', (request, socket, head) => {
      void this.upgrade(request.url ?? '/', request.headers.origin, socket, head, request).catch(
        () => {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
        },
      );
    });
  }

  /** 校验来源与会话令牌后完成 WebSocket 握手并登记客户端。 */
  private async upgrade(
    path: string,
    origin: string | undefined,
    socket: Duplex,
    head: Buffer,
    request: Parameters<Server['emit']>[1],
  ) {
    const url = new URL(path, 'http://localhost');
    if (url.pathname !== '/' && !/^\/ws\/canvas\/\d+$/.test(url.pathname))
      throw new AppError(404, 'WS 路径不存在');
    if (origin && !this.config.wsAllowedOrigins.includes(origin))
      throw new AppError(403, 'WS 来源不允许');
    const token = url.searchParams.get('token');
    if (!token) throw new AppError(401, '缺少凭证');
    const identity = await this.auth.authenticate(token);
    this.ws.handleUpgrade(
      request as Parameters<WebSocketServer['handleUpgrade']>[0],
      socket,
      head,
      (ws) => {
        const clientId = randomUUID();
        const peer: Peer = {
          socket: ws,
          token,
          identity,
          clientId,
          pathCanvasId: url.pathname.startsWith('/ws/canvas/')
            ? Number(url.pathname.split('/').pop())
            : undefined,
          lockKeys: new Set(),
          windowStarted: Date.now(),
          messageCount: 0,
        };
        this.peers.set(clientId, peer);
        this.send(peer, 'connect', { client_id: clientId });
        ws.on(
          'message',
          (bytes) =>
            void this.message(peer, bytes.toString()).catch(() =>
              ws.close(1008, 'Invalid message'),
            ),
        );
        ws.on('close', () => void this.disconnect(peer).catch(() => undefined));
      },
    );
  }

  /** 校验客户端身份和画布权限，并返回成员、锁及缺失的增量事件。 */
  async join(
    actor: Identity,
    dramaId: number,
    canvasId: number,
    clientId: string,
    lastVersion?: number,
  ): Promise<CollaborationJoinResult> {
    const peer = this.peers.get(clientId);
    if (
      !peer ||
      peer.identity.userId !== actor.userId ||
      peer.identity.accountId !== actor.accountId ||
      peer.identity.sessionId !== actor.sessionId
    ) {
      throw new AppError(404, '协作连接不存在');
    }
    if (peer.pathCanvasId && peer.pathCanvasId !== canvasId) throw new AppError(404, '画布不存在');
    const canvas = await this.canvases.detail(actor, canvasId);
    if (canvas.drama_id !== dramaId) throw new AppError(404, '画布不存在');
    peer.canvasId = canvasId;
    peer.dramaId = dramaId;
    const list: CollaborationMember[] = [...this.peers.values()]
      .filter((item) => item.canvasId === canvasId && item.identity.accountId === actor.accountId)
      .map((item) => ({ client_id: item.clientId, user_id: item.identity.userId }));
    const locks: CollaborationLock[] = [];
    let cursor = '0';
    const prefix = `canvas-lock:${actor.accountId}:${canvasId}:`;
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
      cursor = next;
      for (const key of keys) {
        const owner = await this.redis.get(key);
        if (!owner) continue;
        const rest = key.slice(prefix.length).split(':');
        locks.push({ node_id: Number(rest[0]), lock_type: rest[1], client_id: owner });
      }
    } while (cursor !== '0' && locks.length < 200);
    const resyncRequired =
      lastVersion !== undefined &&
      (lastVersion > canvas.version || canvas.version - lastVersion > 100);
    const events =
      lastVersion !== undefined && !resyncRequired
        ? (
            await this.db.query<CollaborationEvent>(
              'SELECT event_id,server_version,payload FROM canvas_events WHERE canvas_id=$1 AND server_version>$2 ORDER BY server_version LIMIT 100',
              [canvasId, lastVersion],
            )
          ).rows
        : [];
    this.broadcast(canvasId, actor.accountId, 'canvas:presence', { list }, clientId);
    return { list, locks, version: canvas.version, events, resync_required: resyncRequired };
  }

  /** 账号切换或令牌轮换后关闭使用旧会话的 WebSocket 连接。 */
  kickSession = (sessionId: string): void => {
    for (const peer of this.peers.values())
      if (peer.identity.sessionId === sessionId) {
        this.send(peer, 'kick_out', { reason: 'account_changed' });
        peer.socket.close(1008, 'Account changed');
      }
  };

  /** 向仍处于开放状态的单个协作连接发送协议消息。 */
  private send(peer: Peer, type: string, data: unknown): void {
    if (peer.socket.readyState === WebSocket.OPEN) peer.socket.send(JSON.stringify({ type, data }));
  }

  /** 向同画布、同账号的协作成员广播消息，可排除消息发送者。 */
  private broadcast(
    canvasId: number,
    accountId: number,
    type: string,
    data: unknown,
    except?: string,
  ): void {
    for (const peer of this.peers.values())
      if (
        peer.canvasId === canvasId &&
        peer.identity.accountId === accountId &&
        peer.clientId !== except
      ) {
        this.send(peer, type, data);
      }
  }

  /** 校验客户端消息、执行协作锁操作并限制消息大小与发送频率。 */
  private async message(peer: Peer, raw: string): Promise<void> {
    if (raw.length > 32768) throw new AppError(400, 'WS 消息过大');
    const now = Date.now();
    if (now - peer.windowStarted >= 1000) {
      peer.windowStarted = now;
      peer.messageCount = 0;
    }
    if (++peer.messageCount > 30) throw new AppError(429, 'WS 发送过快');
    const actor = await this.auth.authenticate(peer.token);
    if (!peer.canvasId || !peer.dramaId || actor.accountId !== peer.identity.accountId)
      throw new AppError(403, '尚未加入画布');
    const message = parse(
      z.object({ type: z.string().max(50), data: z.unknown() }),
      JSON.parse(raw),
    );
    if (message.type === 'mouse_move' || message.type === 'node_move_end') {
      if (JSON.stringify(message.data).length > 8192) throw new AppError(400, '消息过大');
      this.broadcast(
        peer.canvasId,
        actor.accountId,
        message.type,
        { ...(message.data as object), client_id: peer.clientId },
        peer.clientId,
      );
      return;
    }
    if (message.type === 'locked_node' || message.type === 'unlocked_node') {
      const data = parse(
        z.object({
          node_id: z.number().int().positive(),
          lock_type: z.string().max(30).optional(),
        }),
        message.data,
      );
      const node = await this.db.query('SELECT 1 FROM nodes WHERE id=$1 AND canvas_id=$2', [
        data.node_id,
        peer.canvasId,
      ]);
      if (!node.rowCount) throw new AppError(404, '节点不存在');
      const key = `canvas-lock:${actor.accountId}:${peer.canvasId}:${data.node_id}:${data.lock_type ?? 'edit'}`;
      if (message.type === 'locked_node') {
        const renewed = await this.redis.eval(
          "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE',KEYS[1],15000) else return 0 end",
          1,
          key,
          peer.clientId,
        );
        const won =
          renewed === 1 ? 'OK' : await this.redis.set(key, peer.clientId, 'PX', 15000, 'NX');
        if (won !== 'OK') {
          this.send(peer, 'lock_denied', { node_id: data.node_id });
          return;
        }
        peer.lockKeys.add(key);
      } else {
        if (!(await this.release(key, peer.clientId))) {
          this.send(peer, 'lock_denied', { node_id: data.node_id });
          return;
        }
        peer.lockKeys.delete(key);
      }
      this.broadcast(
        peer.canvasId,
        actor.accountId,
        message.type,
        { ...data, client_id: peer.clientId },
        peer.clientId,
      );
      return;
    }
    // 浏览器提交的结构变更通知不会直接采信；以数据库提交后发布的 outbox 事件为准。
    if (
      [
        'update_node',
        'upsert_connection',
        'canvas_graph_delete',
        'delete_node',
        'delete_connection',
        'generate_percentage',
      ].includes(message.type)
    )
      return;
    throw new AppError(400, '未知 WS 消息');
  }

  /** 仅当锁仍属于指定客户端时才从 Redis 中原子释放。 */
  private async release(key: string, clientId: string): Promise<boolean> {
    const removed = await this.redis.eval(
      "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
      1,
      key,
      clientId,
    );
    return removed === 1;
  }

  /** 移除断开连接的成员，释放其锁并广播最新在线列表。 */
  private async disconnect(peer: Peer): Promise<void> {
    if (!this.peers.delete(peer.clientId)) return;
    for (const key of peer.lockKeys) {
      const removed = await this.release(key, peer.clientId);
      if (removed && peer.canvasId) {
        const parts = key.split(':');
        this.broadcast(peer.canvasId, peer.identity.accountId, 'unlocked_node', {
          node_id: Number(parts[3]),
          lock_type: parts[4],
          client_id: peer.clientId,
        });
      }
    }
    if (peer.canvasId)
      this.broadcast(peer.canvasId, peer.identity.accountId, 'canvas:presence', {
        list: [...this.peers.values()]
          .filter((item) => item.canvasId === peer.canvasId)
          .map((item) => ({ client_id: item.clientId, user_id: item.identity.userId })),
      });
  }

  /** 将数据库 outbox 发布的已提交变更转换为 WebSocket 更新事件。 */
  private broadcastSavedEvent(raw: string): void {
    const event = JSON.parse(raw) as {
      event_id: string;
      canvas_id: number;
      account_id: number;
      version: number;
      nodes: { create: { node_id: number }[]; update: { node_id: number }[] };
      connections: { create: unknown[]; update?: unknown[] };
      deleted_node_ids: number[];
      deleted_connection_ids: number[];
    };
    const common = { event_id: event.event_id, server_version: event.version };
    const nodeIds = [...event.nodes.create, ...event.nodes.update].map((row) => row.node_id);
    if (nodeIds.length)
      this.broadcast(event.canvas_id, event.account_id, 'update_node', {
        ...common,
        node_ids: nodeIds,
      });
    for (const connection of [...event.connections.create, ...(event.connections.update ?? [])])
      this.broadcast(event.canvas_id, event.account_id, 'upsert_connection', {
        ...common,
        ...(connection as object),
      });
    if (event.deleted_node_ids.length || event.deleted_connection_ids.length)
      this.broadcast(event.canvas_id, event.account_id, 'canvas_graph_delete', {
        ...common,
        node_ids: event.deleted_node_ids,
        connection_ids: event.deleted_connection_ids,
      });
  }

  /** 幂等关闭所有客户端、WebSocket 服务和 Redis 连接。 */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    sessionEvents.off('invalidated', this.kickSession);
    for (const peer of [...this.peers.values()]) {
      await this.disconnect(peer).catch(() => undefined);
      peer.socket.terminate();
    }
    this.ws.close();
    this.subscriber.disconnect();
    this.redis.disconnect();
  }

  /** 通过 Redis PING 检查协作服务依赖是否可用。 */
  async ping(): Promise<void> {
    await this.redis.ping();
  }

  /** NestJS 销毁模块时复用协作服务的清理流程。 */
  onModuleDestroy(): Promise<void> {
    return this.close();
  }
}
