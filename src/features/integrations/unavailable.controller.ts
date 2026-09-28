import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AppError, parse } from '../../common';
import { Database } from '../../database';
import { AuthGuard, type AuthedRequest } from '../auth';

const uploadData = z
  .object({
    category: z.enum(['image', 'video', 'audio']),
    origin_name: z.string().trim().min(1).max(255),
    object_name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/),
    hash: z.string().regex(/^[a-fA-F0-9]{64}$/),
    mime_type: z.string().trim().min(1).max(100),
    storage_path: z.string().trim().min(1).max(500),
    suffix: z.string().regex(/^(?:\.[A-Za-z0-9]{1,12})?$/),
    size_byte: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 ** 3),
    url: z.url().max(2048),
    fps: z.number().finite().positive().max(240).optional(),
    seconds: z
      .number()
      .finite()
      .positive()
      .max(24 * 3600)
      .optional(),
    width: z.number().int().positive().max(32768).optional(),
    height: z.number().int().positive().max(32768).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.mime_type.startsWith(`${value.category}/`))
      context.addIssue({ code: 'custom', message: '媒体类别与 MIME 类型不匹配' });
    if (value.category === 'video' && (value.fps === undefined || value.seconds === undefined))
      context.addIssue({ code: 'custom', message: '视频需要帧率和时长' });
    if (value.category === 'audio' && value.seconds === undefined)
      context.addIssue({ code: 'custom', message: '音频需要时长' });
    if (value.object_name.includes('..') || value.storage_path.includes('..'))
      context.addIssue({ code: 'custom', message: '对象路径无效' });
  });
const workflowId = z.union([z.string().trim().min(1).max(128), z.number().int().positive()]);
const workflowNodeId = z.string().trim().min(1).max(128);
const workflowExecution = z
  .object({
    workflow_id: workflowId.optional(),
    project_id: workflowId.optional(),
    title: z.string().trim().max(200).optional(),
    document: z
      .object({
        workflowId: workflowNodeId.optional(),
        projectId: workflowNodeId.optional(),
        schemaVersion: z.number().int().positive(),
        version: z.number().int().min(0),
        rootNodeIds: z.array(workflowNodeId).max(1000),
        terminalNodeIds: z.array(workflowNodeId).max(1000),
        nodes: z
          .array(
            z
              .object({
                id: workflowNodeId,
                type: z.string().trim().max(100).optional(),
                config: z.record(z.string(), z.unknown()),
                inputs: z.array(z.record(z.string(), z.unknown())).max(100),
              })
              .strict(),
          )
          .max(1000),
        edges: z.array(z.record(z.string(), z.unknown())).max(2000),
      })
      .strict(),
  })
  .strict()
  .refine((value) => value.workflow_id !== undefined || value.project_id !== undefined, {
    message: 'workflow_id 或 project_id 必填',
  });

@Controller('api')
@UseGuards(AuthGuard)
export class UnavailableIntegrationsController {
  /** 使用数据库中的当前用户标识验证待登记对象的路径前缀。 */
  constructor(@Inject(Database) private readonly db: Database) {}

  /** OSS 尚未配置时以明确的不可用错误响应。 */
  @Get('oss/sts')
  oss(): never {
    throw new AppError(503, 'OSS STS 服务未配置');
  }
  /** 上传登记尚未接入时返回服务不可用错误。 */
  @Post('upload/data')
  async upload(@Req() request: AuthedRequest, @Body() body: unknown): Promise<never> {
    const input = parse(uploadData, body);
    const user = await this.db.query<{ uuid: string }>('SELECT uuid::text FROM users WHERE id=$1', [
      request.auth.userId,
    ]);
    // 前端对象键含上传者 UUID；仅校验名称不足以证明对象已上传，故仍拒绝登记。
    if (!user.rows[0] || !input.storage_path.startsWith(`web-upload/${user.rows[0].uuid}/`))
      throw new AppError(404, '上传对象不属于当前用户');
    throw new AppError(503, 'OSS 上传登记服务未配置');
  }
  /** 工作流执行能力尚未接入时返回服务不可用错误。 */
  @Post('workflow/execute')
  workflow(@Body() body: unknown): never {
    parse(workflowExecution, body);
    throw new AppError(503, '工作流执行服务尚未接入');
  }
  /** 火山素材服务尚未接入时返回服务不可用错误。 */
  @Post('volc-asset/check')
  volc(@Body() body: unknown): never {
    parse(
      z.object({ ids: z.array(z.string().trim().min(1).max(200)).min(1).max(100) }).strict(),
      body,
    );
    throw new AppError(503, '火山素材服务未配置');
  }

  /** 校验待翻译原文后报告翻译供应商不可用。 */
  @Post('node/prompt/translate')
  translate(@Body() body: unknown): never {
    parse(z.object({ text: z.string().trim().min(1).max(10000) }).strict(), body);
    throw new AppError(503, '提示词翻译服务未配置');
  }
}
