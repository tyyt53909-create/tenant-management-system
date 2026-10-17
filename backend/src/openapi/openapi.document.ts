import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

const PUBLIC_OPERATIONS = new Set([
  'get /api',
  'get /api/health',
  'get /api/health/ready',
  'post /api/auth/register',
  'post /api/auth/login',
  'post /api/auth/refresh',
  'post /api/auth/logout',
  'get /api/auth/google/client-id',
  'post /api/auth/google',
  'post /api/auth/send-email-code',
  'post /api/auth/login-email-code',
]);

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('租客管理系统 API')
    .setDescription('接口以本文件为准。错误响应见 ErrorBody。')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: '登录后的 access token' },
      'bearer',
    )
    .build();
  return annotateOpenApi(SwaggerModule.createDocument(app, config));
}

export function annotateOpenApi(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas.ErrorBody = {
    type: 'object',
    required: ['code', 'message', 'requestId'],
    properties: {
      code: { type: 'string' },
      message: { type: 'string' },
      details: {},
      requestId: { type: 'string' },
    },
  };

  for (const [path, methods] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods ?? {})) {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) continue;
      const op = operation as {
        security?: unknown;
        responses?: Record<string, unknown>;
      };
      const key = `${method.toLowerCase()} ${normalizePath(path)}`;
      const isPublic = path.startsWith('/api/public') || PUBLIC_OPERATIONS.has(key);
      op.security = isPublic ? [] : [{ bearer: [] }];
      op.responses ??= {};
      const responses = op.responses;
      if (!Object.values(responses).some((item) => hasJsonSchema(item))) {
        responses['200'] = {
          description: '成功',
          content: {
            'application/json': {
              schema: { type: 'object', additionalProperties: true },
            },
          },
        };
      }
      responses.default = {
        description: '错误',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorBody' },
          },
        },
      };
    }
  }
  return document;
}

export function countOperations(document: OpenAPIObject): number {
  let count = 0;
  for (const methods of Object.values(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods ?? {})) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method) && operation) count += 1;
    }
  }
  return count;
}

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

function hasJsonSchema(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  const content = (response as { content?: Record<string, { schema?: unknown }> }).content;
  return Boolean(content?.['application/json']?.schema);
}

export function mountOpenApi(app: INestApplication): void {
  if (process.env.NODE_ENV === 'production') return;
  SwaggerModule.setup('api/docs', app, createOpenApiDocument(app), {
    swaggerOptions: { persistAuthorization: true },
  });
}
