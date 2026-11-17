import { Injectable, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { ProblemError } from '../problem.js';
import { fieldErrors } from './field-errors.js';

/** Carries class-validator's errors out of ValidationPipe until we know where the value came from. */
class ValidationFailed extends Error {
  constructor(readonly errors: ValidationError[]) {
    super('Validation failed');
  }
}

/**
 * Nest's ValidationPipe with our error format. For every handler argument typed as a DTO class it
 * builds an instance (transform), drops properties without a decorator (whitelist), and validates.
 */
@Injectable()
export class RequestValidationPipe extends ValidationPipe {
  constructor() {
    super({
      transform: true,
      whitelist: true,
      stopAtFirstError: true,
      exceptionFactory: (errors) => new ValidationFailed(errors),
    });
  }

  override async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    // A JSON body can be an array; a DTO can only be built from an object.
    if (metadata.type === 'body' && Array.isArray(value)) throw invalidBody('must be an object');
    try {
      return await super.transform(value, metadata);
    } catch (err) {
      if (!(err instanceof ValidationFailed)) throw err;
      throw new ProblemError(
        'validation-error',
        'The request contains invalid fields',
        fieldErrors(err.errors, metadata.type),
      );
    }
  }
}

export const invalidBody = (message: string) =>
  new ProblemError('validation-error', 'The request contains invalid fields', [
    { field: 'body', message },
  ]);
