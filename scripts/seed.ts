import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { loadConfig } from '../src/config';
import { hashPassword } from '../src/features/auth/password';

/** 查找演示用户；不存在时创建并返回其数据库 ID。 */
async function user(
  client: PoolClient,
  username: string,
  mobile: string,
  passwordHash: string,
): Promise<number> {
  const found = await client.query<{ id: number }>('SELECT id FROM users WHERE username=$1', [
    username,
  ]);
  if (found.rows[0]) return found.rows[0].id;
  const result = await client.query<{ id: number }>(
    `INSERT INTO users(uuid,username,mobile,password_hash) VALUES ($1,$2,$3,$4) RETURNING id`,
    [randomUUID(), username, mobile, passwordHash],
  );
  return result.rows[0].id;
}

/** 查找或创建演示账号，并返回账号 ID。 */
async function account(
  client: PoolClient,
  name: string,
  type: 'personal' | 'team',
  ownerId: number,
): Promise<number> {
  const found = await client.query<{ id: number }>(
    'SELECT id FROM accounts WHERE name=$1 AND type=$2 AND owner_user_id=$3',
    [name, type, ownerId],
  );
  if (found.rows[0]) return found.rows[0].id;
  const result = await client.query<{ id: number }>(
    'INSERT INTO accounts(type,name,owner_user_id) VALUES ($1,$2,$3) RETURNING id',
    [type, name, ownerId],
  );
  return result.rows[0].id;
}

/** 在非生产环境中幂等写入本地演示账号、画布和模拟模型数据。 */
async function main(): Promise<void> {
  const config = loadConfig();
  if (config.nodeEnv === 'production')
    throw new Error('Development seed is forbidden in production');
  const password = process.env.DEV_SEED_PASSWORD ?? 'Local-demo-123!';
  if (password.length < 12) throw new Error('DEV_SEED_PASSWORD must have at least 12 characters');
  const pool = new Pool({ connectionString: config.databaseUrl });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const passwordHash = await hashPassword(password);
    const alice = await user(client, 'demo_alice', '13800000001', passwordHash);
    const bob = await user(client, 'demo_bob', '13800000002', passwordHash);
    const aliceAccount = await account(client, 'Alice Personal', 'personal', alice);
    const bobAccount = await account(client, 'Bob Personal', 'personal', bob);
    const team = await account(client, 'Demo Team', 'team', alice);
    for (const [accountId, userId, role] of [
      [aliceAccount, alice, 'owner'],
      [bobAccount, bob, 'owner'],
      [team, alice, 'owner'],
      [team, bob, 'member'],
    ] as const) {
      await client.query(
        `INSERT INTO account_members(account_id,user_id,role) VALUES ($1,$2,$3)
        ON CONFLICT (account_id,user_id) DO UPDATE SET role=EXCLUDED.role,status='active'`,
        [accountId, userId, role],
      );
    }
    for (const accountId of [aliceAccount, bobAccount, team]) {
      await client.query(
        `INSERT INTO credit_wallets(account_id,balance) VALUES ($1,1000)
        ON CONFLICT (account_id) DO NOTHING`,
        [accountId],
      );
    }
    let drama = (
      await client.query<{ id: number }>(
        'SELECT id FROM dramas WHERE account_id=$1 AND title=$2 AND deleted_at IS NULL',
        [team, 'Demo Drama'],
      )
    ).rows[0];
    if (!drama)
      drama = (
        await client.query<{ id: number }>(
          `INSERT INTO dramas(account_id,created_by,title) VALUES ($1,$2,$3) RETURNING id`,
          [team, alice, 'Demo Drama'],
        )
      ).rows[0];
    for (const title of ['Main Canvas', 'Storyboard']) {
      let canvas = (
        await client.query<{ id: number }>(
          'SELECT id FROM canvases WHERE drama_id=$1 AND title=$2',
          [drama.id, title],
        )
      ).rows[0];
      if (!canvas)
        canvas = (
          await client.query<{ id: number }>(
            `INSERT INTO canvases(account_id,drama_id,title) VALUES ($1,$2,$3) RETURNING id`,
            [team, drama.id, title],
          )
        ).rows[0];
      await client.query(
        `INSERT INTO nodes(canvas_id,uuid,type,node_name,position_x,position_y,content)
        VALUES ($1,$2,'text','Prompt',0,0,'Demo prompt') ON CONFLICT (canvas_id,uuid) DO NOTHING`,
        [canvas.id, 'demo-text'],
      );
      await client.query(
        `INSERT INTO nodes(canvas_id,uuid,type,node_name,position_x,position_y)
        VALUES ($1,$2,'image','Image',400,0) ON CONFLICT (canvas_id,uuid) DO NOTHING`,
        [canvas.id, 'demo-image'],
      );
      await client.query(
        `INSERT INTO connections(canvas_id,uuid,source_uuid,target_uuid)
        VALUES ($1,'demo-edge','demo-text','demo-image') ON CONFLICT (canvas_id,uuid) DO NOTHING`,
        [canvas.id],
      );
    }
    await client.query(`INSERT INTO model_catalog(model_code,model_name,model_type,provider) VALUES ('mock-image','开发模拟图片模型','image','mock')
      ON CONFLICT (model_code) DO NOTHING`);
    const modes = [
      { id: 'mock-image:text2image:v1', mode: 'text2image', images: 0, price: 5 },
      { id: 'mock-image:image2image:v1', mode: 'image2image', images: 1, price: 8 },
    ];
    for (const mode of modes) {
      await client.query(
        `INSERT INTO model_capabilities(capability_id,model_code,node_type,mode_type,scene,input_schema,parameters,features,price_credits)
        VALUES ($1,'mock-image','image',$2,$2,$3,$4,'[]'::jsonb,$5) ON CONFLICT (capability_id) DO NOTHING`,
        [
          mode.id,
          mode.mode,
          { text: { min: 1, max: 5000 }, images: { max: mode.images } },
          JSON.stringify([
            {
              key: 'ratio',
              value_type: 'string',
              required: true,
              default: '1:1',
              options: [{ value: '1:1' }, { value: '16:9' }],
            },
            { key: 'count', value_type: 'number', required: true, default: 1, min: 1, max: 4 },
          ]),
          mode.price,
        ],
      );
    }
    await client.query(
      `INSERT INTO media_assets(account_id,object_key,mime_type,size_byte,url)
      VALUES ($1,'demo/team/sample.png','image/png',100,'mock://demo/team/sample.png') ON CONFLICT (object_key) DO NOTHING`,
      [team],
    );
    await client.query('COMMIT');
    process.stdout.write('Seed ready: demo_alice and demo_bob\n');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
