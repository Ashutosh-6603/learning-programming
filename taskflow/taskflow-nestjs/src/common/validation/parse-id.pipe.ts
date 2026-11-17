import { Injectable, Param, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { invalid } from '../problem.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rejects a path parameter that isn't a UUID before Postgres has to (it would be a 500 there). */
@Injectable()
export class ParseIdPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (!UUID.test(value)) throw invalid(`path.${metadata.data ?? 'id'}`, 'must be a UUID');
    return value;
  }
}

/** `@IdParam('taskId') taskId: string`: a route parameter that must be a UUID. */
export const IdParam = (name: string) => Param(name, ParseIdPipe);
