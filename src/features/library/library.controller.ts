import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../../common';
import { AuthGuard, type AuthedRequest } from '../auth';
import { LibraryService } from './library.service';
import {
  createMaterial,
  createTimbre,
  libraryId,
  libraryIds,
  libraryNodeCategory,
  libraryPage,
  materialCategory,
  subjectCategory,
  subjectFields,
  updateSubject,
  upsertLibraryNode,
} from './library.schemas';

@Controller('api')
@UseGuards(AuthGuard)
export class LibraryController {
  /** 素材、主体与工具箱节点复用同一资产校验服务。 */
  constructor(@Inject(LibraryService) private readonly library: LibraryService) {}

  /** 保存当前项目节点为素材。 */
  @Post('material')
  createMaterial(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<LibraryService['createMaterial']> {
    return this.library.createMaterial(request.auth, parse(createMaterial, body));
  }

  /** 查询可见素材列表。 */
  @Get('material')
  materials(
    @Req() request: AuthedRequest,
    @Query() query: unknown,
  ): ReturnType<LibraryService['materials']> {
    const input = parse(
      libraryPage.extend({ category: z.union([materialCategory, z.literal('')]).optional() }),
      query,
    );
    return this.library.materials(request.auth, {
      ...input,
      category: input.category || undefined,
    });
  }

  /** 查询素材与节点快照。 */
  @Get('material/:id')
  material(
    @Req() request: AuthedRequest,
    @Param('id') id: unknown,
  ): ReturnType<LibraryService['material']> {
    return this.library.material(request.auth, parse(libraryId, id));
  }

  /** 批量删除素材。 */
  @Delete('material')
  deleteMaterials(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<LibraryService['deleteMaterials']> {
    return this.library.deleteMaterials(request.auth, parse(libraryIds, body).ids);
  }

  /** 创建主体并校验全部媒体归属。 */
  @Post('subject')
  createSubject(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<LibraryService['createSubject']> {
    return this.library.createSubject(request.auth, parse(subjectFields, body));
  }

  /** 更新主体。 */
  @Put('subject')
  updateSubject(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<LibraryService['updateSubject']> {
    return this.library.updateSubject(request.auth, parse(updateSubject, body));
  }

  /** 查询主体列表。 */
  @Get('subject')
  subjects(
    @Req() request: AuthedRequest,
    @Query() query: unknown,
  ): ReturnType<LibraryService['subjects']> {
    const input = parse(libraryPage.extend({ type: subjectCategory.optional() }), query);
    return this.library.subjects(request.auth, input);
  }

  /** 查询主体详情。 */
  @Get('subject/:id')
  subject(
    @Req() request: AuthedRequest,
    @Param('id') id: unknown,
  ): ReturnType<LibraryService['subject']> {
    return this.library.subject(request.auth, parse(libraryId, id));
  }

  /** 批量删除主体。 */
  @Delete('subject')
  deleteSubjects(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<LibraryService['deleteSubjects']> {
    return this.library.deleteSubjects(request.auth, parse(libraryIds, body).ids);
  }

  /** 查询账号内可见的自定义音色。 */
  @Get('subject/timbre')
  timbres(@Req() request: AuthedRequest): ReturnType<LibraryService['timbres']> {
    return this.library.timbres(request.auth);
  }

  /** 把已登记音频保存为主体音色。 */
  @Post('subject/timbre')
  createTimbre(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<LibraryService['createTimbre']> {
    return this.library.createTimbre(request.auth, parse(createTimbre, body));
  }

  /** 删除自定义音色。 */
  @Delete('subject/timbre')
  deleteTimbre(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<LibraryService['deleteTimbre']> {
    const input = parse(z.object({ timbre_id: libraryId }).strict(), body);
    return this.library.deleteTimbre(request.auth, input.timbre_id);
  }

  /** 创建或更新工具箱节点快照。 */
  @Post('canvas/node')
  upsertNode(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<LibraryService['upsertNode']> {
    return this.library.upsertNode(request.auth, parse(upsertLibraryNode, body));
  }

  /** 查询工具箱节点列表。 */
  @Get('canvas/node')
  nodes(
    @Req() request: AuthedRequest,
    @Query() query: unknown,
  ): ReturnType<LibraryService['nodes']> {
    const input = parse(
      libraryPage.extend({ category: z.union([libraryNodeCategory, z.literal('')]).optional() }),
      query,
    );
    return this.library.nodes(request.auth, { ...input, category: input.category || undefined });
  }

  /** 查询工具箱节点详情。 */
  @Get('canvas/node/:id')
  node(
    @Req() request: AuthedRequest,
    @Param('id') id: unknown,
  ): ReturnType<LibraryService['node']> {
    return this.library.node(request.auth, parse(libraryId, id));
  }

  /** 批量删除工具箱节点。 */
  @Delete('canvas/node')
  deleteNodes(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<LibraryService['deleteNodes']> {
    return this.library.deleteNodes(request.auth, parse(libraryIds, body).ids);
  }
}
