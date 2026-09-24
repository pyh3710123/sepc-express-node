import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Route = {
  method: 'get' | 'post' | 'put' | 'delete';
  path: string;
  summary: string;
  tag: string;
  public?: boolean;
  body?: string;
  parameters?: unknown[];
  unavailable?: boolean;
  dataExample?: unknown;
  dataSchema?: string;
  rateLimited?: boolean;
};
const pathId = { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } };
const pagination = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
];
const routes: Route[] = [
  {
    method: 'get',
    path: '/health',
    summary: '进程存活检查',
    tag: 'Health',
    public: true,
    dataExample: { status: 'ok' },
  },
  {
    method: 'get',
    path: '/ready',
    summary: '数据库就绪检查',
    tag: 'Health',
    public: true,
    dataExample: { status: 'ok' },
  },
  {
    method: 'post',
    path: '/api/login/password',
    summary: '密码登录',
    tag: 'Auth',
    public: true,
    body: 'PasswordLogin',
    dataExample: { access_token: '<jwt>', refresh_token: '<opaque>' },
    dataSchema: 'AuthTokens',
  },
  {
    method: 'post',
    path: '/api/sms/send',
    summary: '发送短信验证码（仅显式开发模拟）',
    tag: 'Auth',
    public: true,
    body: 'SmsSend',
    dataExample: { mock: true },
    dataSchema: 'SmsSendResult',
    rateLimited: true,
  },
  {
    method: 'post',
    path: '/api/login/sms',
    summary: '短信登录；首次使用手机号自动注册个人账号',
    tag: 'Auth',
    public: true,
    body: 'SmsLogin',
    dataExample: { access_token: '<jwt>', refresh_token: '<opaque>' },
    dataSchema: 'AuthTokens',
  },
  {
    method: 'post',
    path: '/api/login/wechat',
    summary: '微信登录（待接入）',
    tag: 'Auth',
    public: true,
    body: 'WechatLogin',
    unavailable: true,
  },
  {
    method: 'post',
    path: '/api/user/bindPhone',
    summary: '绑定手机号（仅显式开发模拟）',
    tag: 'Auth',
    body: 'SmsLogin',
  },
  {
    method: 'post',
    path: '/api/auth/refresh',
    summary: '使用 Bearer refresh token 轮换会话',
    tag: 'Auth',
    dataExample: { access_token: '<jwt>', refresh_token: '<opaque>' },
    dataSchema: 'AuthTokens',
  },
  { method: 'get', path: '/api/user/info', summary: '当前用户及活跃账号', tag: 'Accounts' },
  { method: 'get', path: '/api/account', summary: '可切换账号', tag: 'Accounts' },
  {
    method: 'post',
    path: '/api/account/change',
    summary: '切换活跃账号并轮换 token',
    tag: 'Accounts',
    body: 'ChangeAccount',
  },
  {
    method: 'get',
    path: '/api/credit',
    summary: '活跃账号积分余额',
    tag: 'Credits',
    dataExample: { total_balance: 1000, use_credit: 1000, credit_quota: 1000 },
  },
  {
    method: 'get',
    path: '/api/credit/bill',
    summary: '分页查询积分流水',
    tag: 'Credits',
    parameters: pagination,
    dataExample: { list: [], total: 0 },
  },
  {
    method: 'get',
    path: '/api/home/init',
    summary: '首页基础配置（字段仍待前端契约联调）',
    tag: 'Home',
    dataExample: { model_enabled: false },
    dataSchema: 'HomeInit',
  },
  {
    method: 'get',
    path: '/api/home/carousel',
    summary: '当前已发布且在展示期内的首页轮播',
    tag: 'Home',
    public: true,
    dataExample: { list: [], total: 0 },
    dataSchema: 'HomeCarousel',
  },
  {
    method: 'get',
    path: '/api/drama',
    summary: '分页查询当前账号短剧',
    tag: 'Canvas',
    parameters: [
      ...pagination,
      { name: 'parent_id', in: 'query', schema: { type: 'integer', minimum: 0 } },
      { name: 'name', in: 'query', schema: { type: 'string', maxLength: 100 } },
      { name: 'all', in: 'query', schema: { type: 'string', enum: ['0', '1', '2'] } },
    ],
    dataExample: { list: [], total: 0, drama_total: 0, group_total: 0 },
    dataSchema: 'DramaList',
  },
  {
    method: 'get',
    path: '/api/drama/subset',
    summary: '平铺当前账号全部短剧，供团队权限选择器使用',
    tag: 'Canvas',
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 1000 } },
    ],
    dataExample: { list: [], total: 0 },
    dataSchema: 'DramaSubset',
  },
  {
    method: 'post',
    path: '/api/drama',
    summary: '创建短剧并返回首张画布，或创建项目组',
    tag: 'Canvas',
    body: 'CreateDrama',
    dataExample: { drama_id: 1, canvas_id: 2 },
    dataSchema: 'CreatedDrama',
  },
  {
    method: 'put',
    path: '/api/drama',
    summary: '更新当前账号未删除项目的标题或已登记图片封面',
    tag: 'Canvas',
    body: 'UpdateDrama',
    dataExample: { drama_id: 1, title: '新标题', cover_image: null },
    dataSchema: 'DramaUpdateResult',
  },
  {
    method: 'delete',
    path: '/api/drama',
    summary: '批量将项目及子项目移入回收站',
    tag: 'Canvas',
    body: 'DramaIds',
    dataExample: { deleted_ids: [1] },
    dataSchema: 'DestroyedDramas',
  },
  {
    method: 'post',
    path: '/api/drama/move',
    summary: '移出项目组或移动单个短剧至当前账号项目组',
    tag: 'Canvas',
    body: 'MoveDrama',
    dataExample: { moved_ids: [1], parent_id: 2 },
    dataSchema: 'MovedDramas',
  },
  {
    method: 'post',
    path: '/api/drama/batchMove',
    summary: '批量移出或移动短剧项目',
    tag: 'Canvas',
    body: 'BatchMoveDrama',
    dataExample: { moved_ids: [1, 2], parent_id: null },
    dataSchema: 'MovedDramas',
  },
  {
    method: 'post',
    path: '/api/drama/merge',
    summary: '将同一层级的短剧合并到新项目组',
    tag: 'Canvas',
    body: 'MergeDrama',
    dataExample: { drama_id: 3, moved_ids: [1, 2] },
    dataSchema: 'MergedDramas',
  },
  {
    method: 'post',
    path: '/api/drama/untie',
    summary: '解除项目组并保留组内项目',
    tag: 'Canvas',
    body: 'DramaIds',
    dataExample: { untied_ids: [3] },
    dataSchema: 'UntiedDramas',
  },
  {
    method: 'get',
    path: '/api/project/recycle',
    summary: '分页查询当前账号回收站',
    tag: 'Canvas',
    parameters: [
      ...pagination,
      { name: 'name', in: 'query', schema: { type: 'string', maxLength: 100 } },
      { name: 'type', in: 'query', schema: { type: 'string', enum: ['drama', 'script', ''] } },
    ],
    dataExample: { list: [], total: 0 },
    dataSchema: 'RecycledDramaList',
  },
  {
    method: 'post',
    path: '/api/project/recycle/restore',
    summary: '批量恢复当前账号已删除项目及同批删除的子项目',
    tag: 'Canvas',
    body: 'DramaIds',
    dataExample: { restored_ids: [1] },
    dataSchema: 'RestoredDramas',
  },
  {
    method: 'delete',
    path: '/api/project/recycle',
    summary: '批量永久删除回收站项目及子项目；进行中任务存在时返回 409',
    tag: 'Canvas',
    body: 'DramaIds',
    dataExample: { deleted_ids: [1] },
    dataSchema: 'DestroyedDramas',
  },
  {
    method: 'post',
    path: '/api/drama/canvas',
    summary: '创建画布',
    tag: 'Canvas',
    body: 'CreateCanvas',
    dataExample: { canvas_id: 1 },
  },
  {
    method: 'get',
    path: '/api/drama/canvas/options',
    summary: '画布选项',
    tag: 'Canvas',
    parameters: [
      { name: 'drama_id', in: 'query', required: true, schema: { type: 'integer', minimum: 1 } },
    ],
  },
  {
    method: 'put',
    path: '/api/drama/canvas/rename',
    summary: '重命名画布',
    tag: 'Canvas',
    body: 'RenameCanvas',
  },
  {
    method: 'post',
    path: '/api/drama/canvas/copy',
    summary: '复制画布图',
    tag: 'Canvas',
    body: 'RenameCanvas',
  },
  {
    method: 'get',
    path: '/api/drama/canvas/{id}',
    summary: '画布图及个人视口',
    tag: 'Canvas',
    parameters: [pathId],
  },
  {
    method: 'put',
    path: '/api/drama/canvas/{id}',
    summary: '仅保存个人视口，不增加图版本',
    tag: 'Canvas',
    parameters: [pathId],
    body: 'Viewport',
  },
  {
    method: 'delete',
    path: '/api/drama/canvas/{id}',
    summary: '删除画布',
    tag: 'Canvas',
    parameters: [pathId],
  },
  {
    method: 'post',
    path: '/api/node/batch',
    summary: '原子保存节点与连线，成功图版本加一',
    tag: 'Canvas',
    body: 'NodeBatch',
    dataExample: {
      version: 9,
      updated_at: 1790000000000,
      nodes: { create: [], update: [] },
      connections: { create: [] },
      deleted_node_ids: [],
      deleted_connection_ids: [],
    },
  },
  {
    method: 'post',
    path: '/api/nodes',
    summary: '按 ID 批量查询节点',
    tag: 'Canvas',
    body: 'NodeIds',
  },
  {
    method: 'get',
    path: '/api/connection/{id}',
    summary: '查询连线',
    tag: 'Canvas',
    parameters: [pathId],
  },
  { method: 'get', path: '/api/node', summary: '可创建节点类型', tag: 'Canvas' },
  {
    method: 'post',
    path: '/api/node/download',
    summary: '签名下载（待接入）',
    tag: 'Media',
    unavailable: true,
    body: 'NodeDownload',
  },
  { method: 'get', path: '/api/node/models', summary: '可用模型和模式能力', tag: 'Generation' },
  {
    method: 'post',
    path: '/api/node/credit',
    summary: '生成询价，不扣费',
    tag: 'Generation',
    body: 'GenerationCreate',
    dataExample: { credit: 5, capability_id: 'mock-image:text2image:v1' },
  },
  {
    method: 'post',
    path: '/api/task/generation/create',
    summary: '单次生成受理，使用 request_id 幂等',
    tag: 'Generation',
    body: 'GenerationCreate',
    dataExample: {
      task_id: '00000000-0000-4000-8000-000000000000',
      request_id: 'example',
      status: 'queued',
      progress: 0,
    },
  },
  {
    method: 'post',
    path: '/api/task/generation/batch_create',
    summary: '批量生成受理，顺序稳定',
    tag: 'Generation',
    body: 'GenerationBatch',
  },
  {
    method: 'post',
    path: '/api/task/generation/progress',
    summary: '任务进度',
    tag: 'Generation',
    body: 'TaskIds',
  },
  {
    method: 'post',
    path: '/api/task/generation/cancel',
    summary: '取消排队任务（表单编码）',
    tag: 'Generation',
    body: 'TaskCancel',
  },
  {
    method: 'post',
    path: '/api/team/join',
    summary: 'WS 连接加入画布',
    tag: 'Collaboration',
    body: 'TeamJoin',
  },
  {
    method: 'get',
    path: '/api/oss/sts',
    summary: 'OSS 临时凭证（待接入）',
    tag: 'Media',
    unavailable: true,
  },
  {
    method: 'post',
    path: '/api/upload/data',
    summary: '媒体上传登记（待接入）',
    tag: 'Media',
    unavailable: true,
  },
  {
    method: 'post',
    path: '/api/workflow/execute',
    summary: '工作流执行（待接入）',
    tag: 'Workflow',
    unavailable: true,
  },
  {
    method: 'post',
    path: '/api/order/create',
    summary: '支付下单（待接入）',
    tag: 'Payments',
    unavailable: true,
  },
  {
    method: 'post',
    path: '/api/volc-asset/check',
    summary: '火山素材检查（待接入）',
    tag: 'Media',
    unavailable: true,
  },
];

/** 生成拒绝未声明字段的 OpenAPI 对象结构。 */
function object(properties: Record<string, unknown>, required: string[] = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}
const integer = { type: 'integer', minimum: 1 };
const string = { type: 'string' };
const point = object({ x: { type: 'number' }, y: { type: 'number' } }, ['x', 'y']);
/** 生成画布批量变更中的新增、更新和删除数组结构。 */
function op(create: unknown, update: unknown) {
  return object({
    create: { type: 'array', items: create },
    update: { type: 'array', items: update },
    delete: { type: 'array', items: object({ id: integer }, ['id']) },
  });
}
const components = {
  securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  schemas: {
    Envelope: object(
      {
        code: { type: 'integer', example: 200 },
        message: { type: 'string', example: 'ok' },
        data: {},
      },
      ['code', 'message', 'data'],
    ),
    Health: object({ status: { type: 'string', example: 'ok' } }, ['status']),
    Error: object(
      { code: { type: 'integer' }, message: { type: 'string' }, data: { nullable: true } },
      ['code', 'message'],
    ),
    PasswordLogin: object({ username: string, password: string }, ['username', 'password']),
    AuthTokens: object({ access_token: string, refresh_token: string }, [
      'access_token',
      'refresh_token',
    ]),
    SmsSend: object(
      { mobile: string, sendType: { type: 'string', enum: ['login_register', 'bind_phone'] } },
      ['mobile', 'sendType'],
    ),
    SmsLogin: object({ mobile: string, captcha: string }, ['mobile', 'captcha']),
    SmsSendResult: object({ mock: { type: 'boolean', const: true } }, ['mock']),
    WechatLogin: object({ code: string }, ['code']),
    HomeInit: object({ model_enabled: { type: 'boolean' } }, ['model_enabled']),
    HomeCarouselItem: object(
      {
        id: integer,
        title: string,
        image_url: { type: 'string', format: 'uri' },
        link_url: { type: ['string', 'null'] },
      },
      ['id', 'title', 'image_url', 'link_url'],
    ),
    HomeCarousel: object(
      {
        list: { type: 'array', items: { $ref: '#/components/schemas/HomeCarouselItem' } },
        total: { type: 'integer', minimum: 0 },
      },
      ['list', 'total'],
    ),
    ChangeAccount: object({ account_id: integer }, ['account_id']),
    CreateDrama: object({
      parent_id: { type: 'integer', minimum: 0, default: 0 },
      is_group: { type: 'boolean', default: false },
      title: { type: 'string', minLength: 1, maxLength: 200 },
    }),
    CreatedDrama: object({ drama_id: integer, canvas_id: integer }, ['drama_id']),
    DramaIds: object(
      { ids: { type: 'array', items: integer, minItems: 1, maxItems: 100, uniqueItems: true } },
      ['ids'],
    ),
    MoveDrama: {
      oneOf: [
        object({ action: { type: 'string', const: 'remove' }, drama_id: integer }, [
          'action',
          'drama_id',
        ]),
        object(
          { action: { type: 'string', const: 'transfer' }, drama_id: integer, target_id: integer },
          ['action', 'drama_id', 'target_id'],
        ),
      ],
    },
    BatchMoveDrama: {
      oneOf: [
        object(
          {
            action: { type: 'string', const: 'remove' },
            ids: { type: 'array', items: integer, minItems: 1, maxItems: 100, uniqueItems: true },
          },
          ['action', 'ids'],
        ),
        object(
          {
            action: { type: 'string', const: 'transfer' },
            ids: { type: 'array', items: integer, minItems: 1, maxItems: 100, uniqueItems: true },
            target_id: integer,
          },
          ['action', 'ids', 'target_id'],
        ),
      ],
    },
    MergeDrama: object(
      { ids: { type: 'array', items: integer, minItems: 2, maxItems: 100, uniqueItems: true } },
      ['ids'],
    ),
    MovedDramas: object(
      { moved_ids: { type: 'array', items: integer }, parent_id: { type: ['integer', 'null'] } },
      ['moved_ids', 'parent_id'],
    ),
    MergedDramas: object({ drama_id: integer, moved_ids: { type: 'array', items: integer } }, [
      'drama_id',
      'moved_ids',
    ]),
    UntiedDramas: object({ untied_ids: { type: 'array', items: integer } }, ['untied_ids']),
    UpdateDrama: {
      ...object(
        {
          drama_id: integer,
          title: { type: 'string', minLength: 1, maxLength: 200 },
          cover_image: { type: ['string', 'null'], format: 'uri' },
        },
        ['drama_id'],
      ),
      anyOf: [{ required: ['title'] }, { required: ['cover_image'] }],
    },
    DramaUpdateResult: object(
      { drama_id: integer, title: string, cover_image: { type: ['string', 'null'] } },
      ['drama_id', 'title', 'cover_image'],
    ),
    RestoredDramas: object({ restored_ids: { type: 'array', items: integer } }, ['restored_ids']),
    DestroyedDramas: object({ deleted_ids: { type: 'array', items: integer } }, ['deleted_ids']),
    DramaSummary: object(
      {
        drama_id: integer,
        title: string,
        type: string,
        is_group: { type: 'boolean' },
        parent_id: { type: ['integer', 'null'] },
        canvas_id: { type: ['integer', 'null'] },
        cover_image: { type: ['string', 'null'] },
        child_count: { type: 'integer', minimum: 0 },
        create_time: string,
        permission_code: string,
        created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
      },
      [
        'drama_id',
        'title',
        'type',
        'is_group',
        'parent_id',
        'canvas_id',
        'cover_image',
        'child_count',
        'create_time',
        'permission_code',
        'created_at',
        'updated_at',
      ],
    ),
    RecycledDrama: object(
      {
        id: integer,
        drama_id: integer,
        project_name: string,
        project_type: { type: 'string', const: 'drama' },
        project_create_time: string,
        project_delete_time: string,
        deleted_at: { type: 'string', format: 'date-time' },
      },
      [
        'id',
        'drama_id',
        'project_name',
        'project_type',
        'project_create_time',
        'project_delete_time',
        'deleted_at',
      ],
    ),
    DramaList: object(
      {
        list: { type: 'array', items: { $ref: '#/components/schemas/DramaSummary' } },
        total: { type: 'integer', minimum: 0 },
        drama_total: { type: 'integer', minimum: 0 },
        group_total: { type: 'integer', minimum: 0 },
      },
      ['list', 'total', 'drama_total', 'group_total'],
    ),
    DramaSubsetItem: object(
      {
        drama_id: integer,
        title: string,
        parent_id: { type: ['integer', 'null'] },
        canvas_id: { type: ['integer', 'null'] },
      },
      ['drama_id', 'title', 'parent_id', 'canvas_id'],
    ),
    DramaSubset: object(
      {
        list: { type: 'array', items: { $ref: '#/components/schemas/DramaSubsetItem' } },
        total: { type: 'integer', minimum: 0 },
      },
      ['list', 'total'],
    ),
    RecycledDramaList: object(
      {
        list: { type: 'array', items: { $ref: '#/components/schemas/RecycledDrama' } },
        total: { type: 'integer', minimum: 0 },
      },
      ['list', 'total'],
    ),
    CreateCanvas: object({ drama_id: integer, title: string }, ['drama_id', 'title']),
    RenameCanvas: object({ canvas_id: integer, canvas_title: string }, [
      'canvas_id',
      'canvas_title',
    ]),
    Viewport: object(
      {
        x: { type: 'number' },
        y: { type: 'number' },
        window_zoom_rate: { type: 'number', description: '百分比；zoom=2.06 对应 206' },
      },
      ['x', 'y', 'window_zoom_rate'],
    ),
    Node: object(
      {
        uuid: string,
        type: string,
        node_name: string,
        position: point,
        extra_data: { type: 'object' },
        parent_uuid: { type: 'string', nullable: true },
        size: object({ width: { type: 'number' }, height: { type: 'number' } }),
        z_index: { type: 'integer' },
        content: { type: 'string', nullable: true },
      },
      ['uuid', 'type', 'node_name', 'position'],
    ),
    Connection: object(
      {
        uuid: string,
        source_uuid: string,
        target_uuid: string,
        source_anchor: string,
        target_anchor: string,
        type: string,
        extra_data: { type: 'object' },
      },
      ['uuid', 'source_uuid', 'target_uuid'],
    ),
    NodeBatch: object(
      {
        drama_id: integer,
        canvas_id: integer,
        expected_version: { type: 'integer', minimum: 0 },
        nodes: op({ $ref: '#/components/schemas/Node' }, object({ id: integer }, ['id'])),
        connections: op(
          { $ref: '#/components/schemas/Connection' },
          object({ id: integer }, ['id']),
        ),
      },
      ['drama_id', 'canvas_id', 'expected_version'],
    ),
    NodeIds: object({ ids: { type: 'array', items: integer, maxItems: 100 } }, ['ids']),
    NodeDownload: object({ node_id: integer, index: { type: 'integer', minimum: 0 } }, ['node_id']),
    GenerationCreate: object(
      {
        request_id: string,
        drama_id: integer,
        canvas_id: integer,
        node_id: integer,
        node_type: string,
        task_type: string,
        model_code: string,
        capability_id: string,
        mode_type: string,
        schema_version: integer,
        model_revision: integer,
        scene: string,
        inputs: { type: 'object' },
        parameters: { type: 'object' },
        features: { type: 'object' },
      },
      ['drama_id', 'canvas_id', 'node_id', 'node_type', 'task_type', 'model_code', 'inputs'],
    ),
    GenerationTask: object(
      {
        node_type: string,
        task_type: string,
        model_code: string,
        capability_id: string,
        mode_type: string,
        inputs: { type: 'object' },
        parameters: { type: 'object' },
        features: { type: 'object' },
      },
      ['node_type', 'task_type', 'model_code', 'inputs'],
    ),
    GenerationBatch: object(
      {
        request_id: string,
        drama_id: integer,
        node_id: integer,
        canvas_id: integer,
        tasks: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: { $ref: '#/components/schemas/GenerationTask' },
        },
      },
      ['drama_id', 'node_id', 'tasks'],
    ),
    TaskIds: object(
      { task_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 100 } },
      ['task_ids'],
    ),
    TaskCancel: object({ task_id: { type: 'string', format: 'uuid' } }, ['task_id']),
    TeamJoin: object(
      {
        drama_id: integer,
        canvas_id: integer,
        client_id: { type: 'string', format: 'uuid' },
        last_version: { type: 'integer', minimum: 0 },
      },
      ['drama_id', 'canvas_id', 'client_id'],
    ),
  },
};

const paths: Record<string, Record<string, unknown>> = {};
for (const route of routes) {
  const response: Record<string, unknown> = route.unavailable
    ? {
        '503': {
          description: '外部服务未配置或功能待接入',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      }
    : {
        '200': {
          description: '成功',
          content: {
            'application/json': {
              schema:
                route.dataSchema && route.path !== '/health' && route.path !== '/ready'
                  ? object(
                      {
                        code: { type: 'integer', const: 200 },
                        message: { type: 'string', const: 'ok' },
                        data: { $ref: `#/components/schemas/${route.dataSchema}` },
                      },
                      ['code', 'message', 'data'],
                    )
                  : {
                      $ref:
                        route.path === '/health' || route.path === '/ready'
                          ? '#/components/schemas/Health'
                          : '#/components/schemas/Envelope',
                    },
              example:
                route.path === '/health' || route.path === '/ready'
                  ? route.dataExample
                  : { code: 200, message: 'ok', data: route.dataExample ?? {} },
            },
          },
        },
        '400': {
          description: '请求参数无效',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        '401': {
          description: '凭证无效',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        '403': {
          description: '权限不足',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        '404': {
          description: '资源不存在或不属于当前账号',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        '409': {
          description: '版本或幂等冲突；画布冲突包含 data.current_version',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        '503': {
          description: '依赖不可用',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      };
  if (route.unavailable && route.body) {
    response['400'] = {
      description: '请求参数无效',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    };
  }
  if (route.rateLimited) {
    response['429'] = {
      description: '发送过于频繁或达到每日上限',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    };
  }
  const operation: Record<string, unknown> = {
    tags: [route.tag],
    summary: route.summary,
    security: route.public ? [] : [{ BearerAuth: [] }],
    responses: response,
  };
  if (route.parameters) operation.parameters = route.parameters;
  if (route.body)
    operation.requestBody = {
      required: true,
      content: {
        [route.body === 'TaskCancel' ? 'application/x-www-form-urlencoded' : 'application/json']: {
          schema: { $ref: `#/components/schemas/${route.body}` },
        },
      },
    };
  (paths[route.path] ??= {})[route.method] = operation;
}
const document = {
  openapi: '3.1.0',
  info: {
    title: 'AImanju Backend API',
    version: '0.1.0',
    description:
      '当前仓库已实现路由；标记待接入的路由始终返回 503。服务供应商和前端宽松字段仍需联调。',
  },
  servers: [{ url: 'http://localhost:3000' }],
  paths,
  components,
};
/** 根据路由定义生成 OpenAPI 文件，或在检查模式比较已生成文件。 */
async function main() {
  const path = join(process.cwd(), 'openapi', 'openapi.json');
  const generated = JSON.stringify(document, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if ((await readFile(path, 'utf8')) !== generated)
      throw new Error('openapi/openapi.json is stale; run npm run openapi:generate');
    return;
  }
  await mkdir(join(process.cwd(), 'openapi'), { recursive: true });
  await writeFile(path, generated);
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
