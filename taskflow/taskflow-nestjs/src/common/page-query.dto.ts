import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';
import { IsOmittable } from './validation/decorators.js';

/** `?limit=20&cursor=…`. List endpoints extend this class to add their own filters. */
export class PageQueryDto {
  // Query strings are text. @Type converts "20" to 20 before validation; bodies get no such help.
  @ApiProperty({ required: false })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOmittable()
  @IsString()
  @Length(1, 512)
  @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;
}
