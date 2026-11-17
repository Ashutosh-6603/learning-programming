import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Builds an OpenAPI document from the controllers and DTO classes and serves Swagger UI at
 * /docs (the JSON at /docs-json). It documents this implementation; the hand-written
 * contract/openapi.yaml stays the source of truth, and the contract test compares the two.
 */
export function setupDocs(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('TaskFlow API (NestJS)')
    .setDescription('Generated from code. The contract lives in contract/openapi.yaml.')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addSecurityRequirements('bearer')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
}
