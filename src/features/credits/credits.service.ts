import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { Database } from '../../database';
import type { Identity } from '../auth';
import { AppError } from '../../common';

interface CreditBillRow extends QueryResultRow {
  id: number;
  source_key: string;
  amount: number;
  balance_after: number;
  created_at: Date;
}

/** 积分来源 ID 与生成服务扣费桶保持一致。 */
const CREDIT_PRIORITY_ITEMS = [
  { id: 1, type_name: '订阅积分', description: '会员订阅获得的积分' },
  { id: 2, type_name: '充值积分', description: '充值获得的积分' },
  { id: 3, type_name: '赠送积分', description: '活动和赠送获得的积分' },
] as const;
const DEFAULT_CREDIT_PRIORITY = [1, 2, 3];

@Injectable()
export class CreditsService {
  /** 注入数据库，读取积分余额与流水。 */
  constructor(@Inject(Database) private readonly db: Database) {}

  /** 返回当前账号的积分余额及关联方案信息。 */
  async balance(identity: Identity): Promise<{
    total_balance: number;
    use_credit: number;
    credit_quota: number;
  }> {
    const result = await this.db.query<{
      balance: number;
      credit_quota: number;
      use_credit: number;
    }>(
      `SELECT w.balance,COALESCE(q.credit_quota,-1)::float8 AS credit_quota,
       COALESCE((SELECT sum(t.price_credits)::int FROM generation_tasks t WHERE t.account_id=w.account_id
         AND t.created_by=$2 AND t.status IN ('queued','running','completed')
         AND t.created_at>=date_trunc('month',now())),0) AS use_credit
       FROM credit_wallets w LEFT JOIN member_credit_allocations q
         ON q.account_id=w.account_id AND q.user_id=$2 WHERE w.account_id=$1`,
      [identity.accountId, identity.userId],
    );
    const row = result.rows[0];
    return {
      total_balance: row?.balance ?? 0,
      use_credit: row?.use_credit ?? 0,
      credit_quota: row?.credit_quota ?? -1,
    };
  }

  /** 团队管理员批量分配成员的月度积分上限，整个列表原子保存。 */
  async allocate(
    actor: Identity,
    allocation: Array<{ user_id: number; credit_quota: number }>,
  ): Promise<{ updated: number }> {
    if (actor.role === 'member') throw new AppError(403, '没有管理权限');
    const ids = allocation.map((item) => item.user_id);
    if (new Set(ids).size !== ids.length) throw new AppError(400, '成员不得重复');
    return this.db.transaction(async (client) => {
      const account = await client.query(
        'SELECT 1 FROM accounts WHERE id=$1 AND type=$2 AND dissolved_at IS NULL FOR SHARE',
        [actor.accountId, 'team'],
      );
      if (!account.rowCount) throw new AppError(400, '仅团队可分配额度');
      const members = await client.query<{ user_id: number }>(
        `SELECT user_id FROM account_members WHERE account_id=$1 AND user_id=ANY($2::int[])
         AND status='active' ORDER BY user_id FOR UPDATE`,
        [actor.accountId, ids],
      );
      if (members.rows.length !== ids.length) throw new AppError(404, '成员不存在');
      for (const item of allocation)
        await client.query(
          `INSERT INTO member_credit_allocations(account_id,user_id,credit_quota) VALUES ($1,$2,$3)
         ON CONFLICT (account_id,user_id) DO UPDATE SET credit_quota=EXCLUDED.credit_quota,updated_at=now()`,
          [actor.accountId, item.user_id, item.credit_quota],
        );
      return { updated: allocation.length };
    });
  }

  /** 读取当前账号实际扣费所用的积分来源顺序。 */
  async priority(actor: Identity): Promise<{ list: (typeof CREDIT_PRIORITY_ITEMS)[number][] }> {
    const setting = await this.db.query<{ priority: number[] }>(
      'SELECT priority FROM credit_priority_settings WHERE account_id=$1',
      [actor.accountId],
    );
    const order = setting.rows[0]?.priority ?? DEFAULT_CREDIT_PRIORITY;
    return {
      list: order.map((id) => {
        const item = CREDIT_PRIORITY_ITEMS.find((value) => value.id === id);
        if (!item) throw new AppError(409, '积分消耗顺序配置无效');
        return item;
      }),
    };
  }

  /** 管理员设置三个积分来源的完整排列。 */
  async setPriority(
    actor: Identity,
    order: number[],
  ): Promise<{ list: (typeof CREDIT_PRIORITY_ITEMS)[number][] }> {
    if (actor.role === 'member') throw new AppError(403, '没有管理权限');
    if (
      order.length !== 3 ||
      new Set(order).size !== 3 ||
      order.some((id) => !DEFAULT_CREDIT_PRIORITY.includes(id))
    )
      throw new AppError(400, '积分消耗顺序必须包含全部三种来源');
    await this.db.query(
      `INSERT INTO credit_priority_settings(account_id,priority) VALUES ($1,$2::int[])
       ON CONFLICT (account_id) DO UPDATE SET priority=EXCLUDED.priority,updated_at=now()`,
      [actor.accountId, order],
    );
    return this.priority(actor);
  }

  /** 管理员删除自定义顺序后恢复默认扣费顺序。 */
  async resetPriority(
    actor: Identity,
  ): Promise<{ list: (typeof CREDIT_PRIORITY_ITEMS)[number][] }> {
    if (actor.role === 'member') throw new AppError(403, '没有管理权限');
    await this.db.query('DELETE FROM credit_priority_settings WHERE account_id=$1', [
      actor.accountId,
    ]);
    return this.priority(actor);
  }

  /** 分页返回当前账号的积分流水。 */
  async bills(
    identity: Identity,
    page: number,
    limit: number,
  ): Promise<{ list: CreditBillRow[]; total: number }> {
    const [rows, count] = await Promise.all([
      this.db.query<CreditBillRow>(
        'SELECT id,source_key,amount,balance_after,created_at FROM credit_ledger WHERE account_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3',
        [identity.accountId, limit, (page - 1) * limit],
      ),
      this.db.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM credit_ledger WHERE account_id=$1',
        [identity.accountId],
      ),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }
}
