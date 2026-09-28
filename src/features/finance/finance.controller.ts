import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../../common';
import { AuthGuard, type AuthedRequest } from '../auth';
import { FinanceService } from './finance.service';

const id = z.coerce.number().int().positive();
const page = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
const orderNo = z.string().trim().min(1).max(100);
const createOrder = z.union([
  z
    .object({
      order_type: z.literal('subscribe'),
      plan_id: id,
      buy_num: z.number().int().positive(),
      team_id: id.optional(),
    })
    .strict(),
  z.object({ order_type: z.literal('recharge'), credit_id: id }).strict(),
  z.object({ order_type: z.literal('recharge'), credit: z.number().int().positive() }).strict(),
  z
    .object({
      order_type: z.literal('capacity'),
      price_id: id,
      capacity_gb: z.number().int().positive(),
    })
    .strict(),
  z.object({ order_type: z.literal('seat_expand'), buy_num: z.number().int().positive() }).strict(),
]);
const invoiceCreate = z
  .object({
    invoice_type: z.enum(['personal', 'unit']),
    invoice_kind: z.enum(['common', 'special']),
    title: z.string().trim().min(1).max(200),
    email: z.email().max(200),
    order_ids: z.array(id).min(1).max(100),
    tax_no: z.string().trim().max(100).optional(),
    registered_address: z.string().trim().max(300).optional(),
    registered_phone: z.string().trim().max(50).optional(),
    bank_name: z.string().trim().max(200).optional(),
    bank_account: z.string().trim().max(100).optional(),
  })
  .strict()
  .refine((value) => value.invoice_type !== 'unit' || Boolean(value.tax_no), {
    message: '单位发票需要税号',
  });

@Controller('api')
@UseGuards(AuthGuard)
export class FinanceController {
  /** 价格来自服务端目录；支付状态只读，外部操作缺商户配置时拒绝。 */
  constructor(@Inject(FinanceService) private readonly finance: FinanceService) {}

  /** 会员套餐目录。 */
  @Get('plan') plans(@Req() r: AuthedRequest): ReturnType<FinanceService['plans']> {
    return this.finance.plans(r.auth);
  }
  /** 续费价格尚缺折算规则。 */
  @Get('plan/renew') renew(@Query() q: unknown): never {
    parse(z.object({ plan_id: id }).strict(), q);
    return this.finance.unavailablePlanQuote();
  }
  /** 升级价格尚缺折算规则。 */
  @Get('plan/upgrade') upgrade(@Query() q: unknown): never {
    parse(z.object({ type: z.enum(['personal', 'team']), level: id }).strict(), q);
    return this.finance.unavailablePlanQuote();
  }
  /** 席位扩容价格尚缺折算规则。 */
  @Get('plan/seat-expand') seatExpand(): never {
    return this.finance.unavailablePlanQuote();
  }
  /** 充值价格目录。 */
  @Get('creditConfig') creditConfig(): ReturnType<FinanceService['creditConfig']> {
    return this.finance.creditConfig();
  }
  /** 空间扩容价格目录。 */
  @Get('space/price') spacePrices(): ReturnType<FinanceService['spacePrices']> {
    return this.finance.spacePrices();
  }
  /** 当前账号空间配额和使用量。 */
  @Get('account/space') accountSpace(
    @Req() r: AuthedRequest,
  ): ReturnType<FinanceService['accountSpace']> {
    return this.finance.accountSpace(r.auth);
  }
  /** 已支付扩容订单明细。 */
  @Get('space/bill') spaceBills(
    @Req() r: AuthedRequest,
    @Query() q: unknown,
  ): ReturnType<FinanceService['spaceBills']> {
    const p = parse(page, q);
    return this.finance.spaceBills(r.auth, p.page, p.limit);
  }
  /** 当前账号订单实时状态。 */
  @Get('order/info') orderInfo(
    @Req() r: AuthedRequest,
    @Query() q: unknown,
  ): ReturnType<FinanceService['orderInfo']> {
    return this.finance.orderInfo(
      r.auth,
      parse(z.object({ order_no: orderNo }).strict(), q).order_no,
    );
  }
  /** 本账号购买记录。 */
  @Get('order/record') orders(
    @Req() r: AuthedRequest,
    @Query() q: unknown,
  ): ReturnType<FinanceService['orders']> {
    const p = parse(page, q);
    return this.finance.orders(r.auth, p.page, p.limit);
  }
  /** 本账号已支付订阅。 */
  @Get('order/subscribe') subscriptions(
    @Req() r: AuthedRequest,
    @Query() q: unknown,
  ): ReturnType<FinanceService['subscriptions']> {
    const p = parse(page, q);
    return this.finance.subscriptions(r.auth, p.page, p.limit);
  }
  /** 商户未配置时拒绝创建支付订单。 */
  @Post('order/create') createOrder(@Body() b: unknown): never {
    parse(createOrder, b);
    return this.finance.unavailableCheckout();
  }
  /** 商户未配置时拒绝修改支付订单。 */
  @Post('order/update') updateOrder(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
  ): ReturnType<FinanceService['unavailableOrderUpdate']> {
    const input = parse(
      z.object({ order_no: orderNo, buy_num: z.number().int().positive() }).strict(),
      b,
    );
    return this.finance.unavailableOrderUpdate(r.auth, input.order_no);
  }
  /** 开票服务未配置时验证订单后明确拒绝提交。 */
  @Post('invoice/create') createInvoice(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
  ): ReturnType<FinanceService['unavailableInvoiceCreate']> {
    return this.finance.unavailableInvoiceCreate(r.auth, parse(invoiceCreate, b).order_ids);
  }
  /** 撤销当前账号处理中开票申请。 */
  @Delete('invoice/:id') cancelInvoice(
    @Req() r: AuthedRequest,
    @Param('id') value: unknown,
  ): ReturnType<FinanceService['cancelInvoice']> {
    return this.finance.cancelInvoice(r.auth, parse(id, value));
  }
  /** 读取当前账号已开票文件。 */
  @Get('invoice/file') invoiceFile(
    @Req() r: AuthedRequest,
    @Query() q: unknown,
  ): ReturnType<FinanceService['invoiceFile']> {
    return this.finance.invoiceFile(
      r.auth,
      parse(z.object({ invoice_id: id }).strict(), q).invoice_id,
    );
  }
}
