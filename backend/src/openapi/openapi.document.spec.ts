import { describe, expect, it } from 'vitest';
import type { OpenAPIObject } from '@nestjs/swagger';
import { annotateOpenApi, countOperations } from './openapi.document.js';

describe('OpenAPI 标注', () => {
  it('受保护路由要求 bearer，公开路由不要求，并补上响应结构', () => {
    const document = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/api/auth/login': { post: { responses: {} } },
        '/api/health': { get: { responses: {} } },
        '/api/rooms': { get: { responses: {} } },
        '/api/public/rooms': { get: { responses: {} } },
      },
      components: {},
    } as OpenAPIObject;

    annotateOpenApi(document);

    expect(document.paths['/api/auth/login']?.post?.security).toEqual([]);
    expect(document.paths['/api/health']?.get?.security).toEqual([]);
    expect(document.paths['/api/public/rooms']?.get?.security).toEqual([]);
    expect(document.paths['/api/rooms']?.get?.security).toEqual([{ bearer: [] }]);
    expect(document.paths['/api/rooms']?.get?.responses?.default).toMatchObject({
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
    });
    expect(countOperations(document)).toBe(4);
  });
});
