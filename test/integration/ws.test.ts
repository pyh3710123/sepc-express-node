import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { CollaborationService } from '../../src/features/collaboration/collaboration.service';
import { createApiApp } from '../../src/main';

/** 等待 WebSocket 上指定类型的消息，并在超时后清理监听器。 */
function message(
  socket: WebSocket,
  type: string,
): Promise<{ type: string; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', receive);
      reject(new Error(`Timed out waiting for ${type}`));
    }, 5000);
    /** 解析收到的消息，只完成与当前等待类型匹配的监听。 */
    const receive = (raw: Buffer) => {
      const parsed = JSON.parse(raw.toString()) as { type: string; data: Record<string, unknown> };
      if (parsed.type !== type) return;
      clearTimeout(timer);
      socket.off('message', receive);
      resolve(parsed);
    };
    socket.on('message', receive);
  });
}

test(
  'native WebSocket connect, authenticated join, presence and Redis locks',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const app = await createApiApp();
    const collaboration = app.get(CollaborationService);
    const sockets: WebSocket[] = [];
    try {
      await collaboration.attach(app.getHttpServer());
      await app.listen(0, '127.0.0.1');
      const address = app.getHttpServer().address();
      assert.ok(address && typeof address !== 'string');
      const base = `ws://127.0.0.1:${address.port}`;
      /** 发送 HTTP 测试请求并解析统一响应体。 */
      const request = async (
        method: 'GET' | 'POST',
        url: string,
        token?: string,
        payload?: Record<string, unknown>,
      ) =>
        (
          await app.inject({
            method,
            url,
            headers: token ? { authorization: `Bearer ${token}` } : {},
            payload,
          })
        ).json();
      /** 使用演示账号登录并切换到团队账号，返回新访问令牌。 */
      const login = async (username: string) => {
        const initial = await request('POST', '/api/login/password', undefined, {
          username,
          password: 'Local-demo-123!',
        });
        const token = initial.data.access_token as string;
        const accounts = await request('GET', '/api/account', token);
        const team = accounts.data.list.find(
          (item: { account_type: string }) => item.account_type === 'team',
        ).account_id as number;
        const changed = await request('POST', '/api/account/change', token, { account_id: team });
        return changed.data.access_token as string;
      };
      const alice = await login('demo_alice');
      const bob = await login('demo_bob');
      const drama = (await request('GET', '/api/drama', alice)).data.list[0].drama_id as number;
      const canvas = (await request('GET', `/api/drama/canvas/options?drama_id=${drama}`, alice))
        .data.list[0].canvas_id as number;
      const node = (await request('GET', `/api/drama/canvas/${canvas}`, alice)).data.nodes[0]
        .node_id as number;
      /** 使用访问令牌建立 WebSocket 连接并等待服务端连接消息。 */
      const open = async (token: string) => {
        const socket = new WebSocket(`${base}/?token=${encodeURIComponent(token)}`);
        sockets.push(socket);
        const connect = message(socket, 'connect');
        await once(socket, 'open');
        return { socket, clientId: (await connect).data.client_id as string };
      };
      const first = await open(alice);
      const joinedAlice = await request('POST', '/api/team/join', alice, {
        drama_id: drama,
        canvas_id: canvas,
        client_id: first.clientId,
      });
      assert.equal(joinedAlice.code, 200);
      assert.equal(joinedAlice.data.list.length, 1);
      const second = await open(bob);
      const presence = message(first.socket, 'canvas:presence');
      const joinedBob = await request('POST', '/api/team/join', bob, {
        drama_id: drama,
        canvas_id: canvas,
        client_id: second.clientId,
      });
      assert.equal(joinedBob.data.list.length, 2);
      assert.equal((await presence).data.list instanceof Array, true);
      const locked = message(second.socket, 'locked_node');
      first.socket.send(JSON.stringify({ type: 'locked_node', data: { node_id: node } }));
      assert.equal((await locked).data.node_id, node);
      const denied = message(second.socket, 'lock_denied');
      second.socket.send(JSON.stringify({ type: 'locked_node', data: { node_id: node } }));
      assert.equal((await denied).data.node_id, node);
    } finally {
      for (const socket of sockets) socket.terminate();
      await app.close();
    }
  },
);
