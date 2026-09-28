import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common';
import { Database } from '../../database';
import type { Identity } from '../auth';

@Injectable()
export class FinanceService {
  /** 服务端价格表可读取；支付、续费折算与开票操作仍需商户和业务配置。 */
  constructor(@Inject(Database) private readonly db: Database) {}

  /** 返回当前配置的所有会员方案；没有服务端价格时拒绝展示。 */
  async plans(actor: Identity): Promise<unknown> {
    const [plans, current] = await Promise.all([
      this.db.query(
        `SELECT id AS plan_id,account_type AS type,plan_title,level,pay_cycle,
         (price_cents/100.0)::float8 AS price,included_seats AS min_seat_count
         FROM plan_catalog WHERE active ORDER BY account_type,level,pay_cycle,id`,
      ),
      this.db.query<{ plan_id: number | null; vip_level: number }>(
        `SELECT e.plan_id,e.vip_level FROM account_entitlements e
         WHERE e.account_id=$1 AND e.expires_at>now()`,
        [actor.accountId],
      ),
    ]);
    if (!plans.rows.length) throw new AppError(503, '会员方案价格未配置');
    return {
      list: plans.rows,
      current_plan_id: current.rows[0]?.plan_id ?? null,
      current_level: current.rows[0]?.vip_level ?? 0,
    };
  }

  /** 返回服务器配置的充值档位和兑换比例。 */
  async creditConfig(): Promise<unknown> {
    const [settings, presets] = await Promise.all([
      this.db.query<{
        min_credit: number;
        max_credit: number;
        step_credit: number;
        credits_per_yuan: number;
      }>(
        'SELECT min_credit,max_credit,step_credit,credits_per_yuan FROM credit_pricing WHERE id=1',
      ),
      this.db.query(
        `SELECT id,label,credit_value AS value,total_credit,total_credit-credit_value AS give_credit,
         (price_cents/100.0)::float8 AS price FROM credit_price_presets WHERE active ORDER BY id`,
      ),
    ]);
    if (!settings.rows[0] || !presets.rows.length) throw new AppError(503, '积分充值价格未配置');
    return {
      list: presets.rows,
      min: settings.rows[0].min_credit,
      max: settings.rows[0].max_credit,
      step: settings.rows[0].step_credit,
      rate: settings.rows[0].credits_per_yuan,
    };
  }

  /** 返回服务器配置的空间扩容单价。 */
  async spacePrices(): Promise<unknown> {
    const result = await this.db.query(
      `SELECT id,type,discount::float8 AS discount,min_limit,max_limit,
       (origin_price_cents/100.0)::float8 AS origin_price,(price_cents/100.0)::float8 AS price
       FROM space_price_plans WHERE active ORDER BY type,id`,
    );
    if (!result.rows.length) throw new AppError(503, '空间扩容价格未配置');
    return { list: result.rows };
  }

  /** 按有效权益限制读取当前账号空间配额和已登记媒体用量。 */
  async accountSpace(actor: Identity): Promise<{ space_limit: number; space_used: number }> {
    const result = await this.db.query<{ storage_limit_bytes: string | null; used_bytes: string }>(
      `SELECT e.storage_limit_bytes,
       (SELECT COALESCE(sum(size_byte),0)::text FROM media_assets WHERE account_id=$1) AS used_bytes
       FROM account_entitlements e WHERE e.account_id=$1 AND e.expires_at>now()`,
      [actor.accountId],
    );
    const limit = result.rows[0]?.storage_limit_bytes;
    if (limit == null) throw new AppError(503, '账号空间配额未配置');
    const limitBytes = Number(limit);
    const usedBytes = Number(result.rows[0].used_bytes);
    if (!Number.isSafeInteger(limitBytes) || !Number.isSafeInteger(usedBytes))
      throw new AppError(503, '空间统计超出支持范围');
    const gb = 1024 ** 3;
    return { space_limit: limitBytes / gb, space_used: usedBytes / gb };
  }

  /** 仅展示本账号已支付的扩容订单明细，不使用支付二维码失效时间充当扩容到期日。 */
  async spaceBills(actor: Identity, page: number, limit: number): Promise<unknown> {
    const [rows, count] = await Promise.all([
      this.db.query(
        `SELECT id AS record_id,amount_cents AS paid_amount,
         to_char(amount_cents/100.0,'FM9999999990.00') AS paid_amount_text,
         to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS create_date,
         COALESCE(metadata->>'capacity_expires_at','') AS expire_date,
         CASE WHEN metadata ? 'capacity_gb' THEN metadata->>'capacity_gb' || ' GB' ELSE '未记录' END AS capacity_gb_text
         FROM orders WHERE account_id=$1 AND order_type='capacity' AND pay_status IN (2,3)
         ORDER BY id DESC LIMIT $2 OFFSET $3`,
        [actor.accountId, limit, (page - 1) * limit],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM orders WHERE account_id=$1 AND order_type='capacity' AND pay_status IN (2,3)`,
        [actor.accountId],
      ),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  /** 按订单号读取当前账号的真实支付状态，绝不从客户端参数修改状态。 */
  async orderInfo(actor: Identity, orderNo: string): Promise<unknown> {
    const result = await this.db.query(
      `SELECT o.pay_status AS "payStatus",o.order_no AS "tradeId",(o.amount_cents/100.0)::float8 AS "payAmount",
       COALESCE(to_char(o.paid_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS'),'') AS "payTime",
       'CNY' AS currency,
       to_char(o.expires_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS "expireTime",
       EXTRACT(epoch FROM o.expires_at)::float8 AS "expireTimeTs",
       o.subject AS "membershipName",o.order_type AS type,a.type AS "accountType",
       COALESCE(u.nickname,u.username) AS "userName",o.metadata AS detail
       FROM orders o JOIN accounts a ON a.id=o.account_id
       JOIN users u ON u.id=$3 WHERE o.order_no=$1 AND o.account_id=$2`,
      [orderNo, actor.accountId, actor.userId],
    );
    if (!result.rows[0]) throw new AppError(404, '订单不存在');
    return result.rows[0];
  }

  /** 分页返回本账号购买记录与真实开票状态。 */
  async orders(actor: Identity, page: number, limit: number): Promise<unknown> {
    const [rows, count] = await Promise.all([
      this.db.query(
        `SELECT o.id AS order_id,o.order_no,
         to_char(o.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS create_time,
         o.subject AS goods_name,
         CASE o.pay_status WHEN 1 THEN '待支付' WHEN 2 THEN '已支付'
           WHEN 3 THEN '已完成' WHEN 4 THEN '已取消' ELSE '未知' END AS order_status_text,
         o.pay_status::text AS order_status,
         to_char(o.amount_cents/100.0,'FM9999999990.00') AS amount_text,
         COALESCE(i.status,'uninvoiced') AS invoice_status,i.id AS invoice_id
         FROM orders o LEFT JOIN invoice_orders io ON io.order_no=o.order_no
         LEFT JOIN invoices i ON i.id=io.invoice_id
         WHERE o.account_id=$1 ORDER BY o.id DESC LIMIT $2 OFFSET $3`,
        [actor.accountId, limit, (page - 1) * limit],
      ),
      this.db.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM orders WHERE account_id=$1',
        [actor.accountId],
      ),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  /** 订阅列表只读取验签回调或迁移已标记为已支付的订单。 */
  async subscriptions(actor: Identity, page: number, limit: number): Promise<unknown> {
    const [rows, count] = await Promise.all([
      this.db.query(
        `SELECT id,subject AS plan_title,COALESCE(pay_cycle,'') AS pay_cycle,
         COALESCE(to_char(paid_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS'),'') AS effective_time,
         COALESCE(channel,'') AS channel
         FROM orders WHERE account_id=$1 AND order_type='subscribe' AND pay_status IN (2,3)
         ORDER BY id DESC LIMIT $2 OFFSET $3`,
        [actor.accountId, limit, (page - 1) * limit],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM orders WHERE account_id=$1 AND order_type='subscribe' AND pay_status IN (2,3)`,
        [actor.accountId],
      ),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  /** 修改待支付订单需要重算价格并刷新商户收银台，未配置时明确拒绝。 */
  async unavailableOrderUpdate(actor: Identity, orderNo: string): Promise<never> {
    const order = await this.db.query<{ pay_status: number }>(
      'SELECT pay_status FROM orders WHERE order_no=$1 AND account_id=$2',
      [orderNo, actor.accountId],
    );
    if (!order.rows[0]) throw new AppError(404, '订单不存在');
    if (order.rows[0].pay_status !== 1) throw new AppError(409, '订单已无法修改');
    throw new AppError(503, '支付商户与订单重定价规则未配置');
  }

  /** 未取得商户验签资料时不生成可支付订单。 */
  unavailableCheckout(): never {
    throw new AppError(503, '支付商户未配置');
  }

  /** 续费、升级及席位折算规则未确定，避免展示无法兑现的价格。 */
  unavailablePlanQuote(): never {
    throw new AppError(503, '会员续费与升级计价规则未配置');
  }

  /** 开票申请须先验证订单已支付且属于当前账号；开票服务缺失时不伪造申请。 */
  async unavailableInvoiceCreate(actor: Identity, orderIds: number[]): Promise<never> {
    if (new Set(orderIds).size !== orderIds.length) throw new AppError(400, '订单 ID 不得重复');
    const result = await this.db.query<{
      id: number;
      pay_status: number;
      invoice_id: number | null;
    }>(
      `SELECT o.id,o.pay_status,io.invoice_id FROM orders o LEFT JOIN invoice_orders io ON io.order_no=o.order_no
       WHERE o.id=ANY($1::int[]) AND o.account_id=$2`,
      [orderIds, actor.accountId],
    );
    if (result.rows.length !== orderIds.length) throw new AppError(404, '订单不存在');
    if (result.rows.some((row) => ![2, 3].includes(row.pay_status)))
      throw new AppError(409, '包含未支付订单');
    if (result.rows.some((row) => row.invoice_id !== null))
      throw new AppError(409, '订单已有开票记录');
    throw new AppError(503, '开票服务未配置');
  }

  /** 仅处理中且属于当前账号的发票申请可取消。 */
  async cancelInvoice(
    actor: Identity,
    id: number,
  ): Promise<{ invoice_id: number; status: string }> {
    return this.db.transaction(async (client) => {
      const current = await client.query<{ status: string }>(
        'SELECT status FROM invoices WHERE id=$1 AND account_id=$2 FOR UPDATE',
        [id, actor.accountId],
      );
      if (!current.rows[0]) throw new AppError(404, '发票申请不存在');
      if (current.rows[0].status === 'cancelled') return { invoice_id: id, status: 'cancelled' };
      if (current.rows[0].status !== 'processing') throw new AppError(409, '已开票的申请不可撤销');
      await client.query("UPDATE invoices SET status='cancelled',updated_at=now() WHERE id=$1", [
        id,
      ]);
      // 取消后释放订单开票占用，允许日后重新申请，同时保留原申请审计记录。
      await client.query('DELETE FROM invoice_orders WHERE invoice_id=$1', [id]);
      return { invoice_id: id, status: 'cancelled' };
    });
  }

  /** 仅已开票且文件地址存在的本账号申请可下载。 */
  async invoiceFile(actor: Identity, id: number): Promise<unknown> {
    const result = await this.db.query<{
      status: string;
      file_url: string | null;
      invoice_no: string | null;
      invoice_time: string | null;
    }>(
      `SELECT status,file_url,invoice_no,
       to_char(issued_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS invoice_time
       FROM invoices WHERE id=$1 AND account_id=$2`,
      [id, actor.accountId],
    );
    const invoice = result.rows[0];
    if (!invoice) throw new AppError(404, '发票申请不存在');
    if (invoice.status !== 'issued') throw new AppError(409, '发票尚未开具');
    if (!invoice.file_url) throw new AppError(503, '发票文件尚不可用');
    return {
      invoice_file: invoice.file_url,
      invoice_no: invoice.invoice_no,
      invoice_time: invoice.invoice_time,
    };
  }
}
