import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { Database } from '../../database';
import type { Identity } from '../auth';

interface UserInfoRow extends QueryResultRow {
  uuid: string;
  avatar: string | null;
  account_name: string;
  account_type: string;
}

interface AccountSummaryRow extends QueryResultRow {
  account_id: number;
  account_name: string;
  account_type: string;
  role_name: Identity['role'];
}

@Injectable()
export class AccountsService {
  /** 注入数据库，读取当前用户及其可访问账号。 */
  constructor(@Inject(Database) private readonly db: Database) {}

  /** 返回当前用户在所选账号下的首页身份信息。 */
  async info(identity: Identity): Promise<{
    account_id: number;
    account_name: string;
    account_type: string;
    avatar: string | null;
    is_vip: boolean;
    vip_level: number;
    plan_expire: null;
    plan_title: string;
    role_name: Identity['role'];
    uuid: string;
  }> {
    const result = await this.db.query<UserInfoRow>(
      `SELECT u.uuid,u.avatar,a.name AS account_name,a.type AS account_type
      FROM users u JOIN accounts a ON a.id=$2 WHERE u.id=$1`,
      [identity.userId, identity.accountId],
    );
    const row = result.rows[0];
    return {
      account_id: identity.accountId,
      account_name: row.account_name,
      account_type: row.account_type,
      avatar: row.avatar,
      is_vip: false,
      vip_level: 0,
      plan_expire: null,
      plan_title: '',
      role_name: identity.role,
      uuid: row.uuid,
    };
  }

  /** 列出用户仍有有效成员身份的账号。 */
  async list(identity: Identity): Promise<{ list: AccountSummaryRow[] }> {
    const result = await this.db.query<AccountSummaryRow>(
      `SELECT a.id AS account_id,a.name AS account_name,a.type AS account_type,m.role AS role_name
      FROM accounts a JOIN account_members m ON m.account_id=a.id WHERE m.user_id=$1 AND m.status='active' ORDER BY a.id`,
      [identity.userId],
    );
    return { list: result.rows };
  }
}
