import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Page } from '../../common/cursor.js';
import { ApiPage } from '../../common/http/api-page.js';
import { API_PREFIX } from '../../common/http/routes.js';
import { IdParam } from '../../common/validation/parse-id.pipe.js';
import { CurrentUser } from '../auth/decorators.js';
import { SearchHitDto, SearchQueryDto } from './search.dto.js';
import { SearchService } from './search.service.js';

@ApiTags('search')
@Controller(API_PREFIX)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('workspaces/:workspaceId/search')
  @ApiPage(SearchHitDto)
  find(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
    @Query() query: SearchQueryDto,
  ): Promise<Page<SearchHitDto>> {
    return this.search.search(workspaceId, userId, query.q, query.limit, query.cursor);
  }
}
