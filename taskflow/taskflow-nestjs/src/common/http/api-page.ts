import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

/**
 * Documents a `{ items: T[], nextCursor }` response. TypeScript generics don't exist at run
 * time, so Swagger can't see what `Page<TaskDto>` holds; this decorator spells it out.
 */
export const ApiPage = (item: Type) =>
  applyDecorators(
    ApiExtraModels(item),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['items', 'nextCursor'],
        properties: {
          items: { type: 'array', items: { $ref: getSchemaPath(item) } },
          nextCursor: { type: 'string', nullable: true },
        },
      },
    }),
  );
