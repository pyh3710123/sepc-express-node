import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { Database } from '../../database';
import type { Identity } from '../auth';

interface CreditBillRow extends QueryResultRow {
  id: number;
  source_key: string;
  amount: number;
  balance_after: number;
  created_at: Date;
}

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
    const result = await this.db.query<{ balance: number }>(
      'SELECT balance FROM credit_wallets WHERE account_id=$1',
      [identity.accountId],
    );
    const balance = result.rows[0]?.balance ?? 0;
    return { total_balance: balance, use_credit: balance, credit_quota: balance };
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
