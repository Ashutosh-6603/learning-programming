import { IsString, Length } from 'class-validator';
import { PageQueryDto } from '../../common/page-query.dto.js';
import { TaskDto } from '../projects/project.dto.js';

export class SearchQueryDto extends PageQueryDto {
  @IsString()
  @Length(1, 200)
  q: string;
}

export class SearchHitDto {
  task: TaskDto;
  rank: number;
  headline: string;
}
