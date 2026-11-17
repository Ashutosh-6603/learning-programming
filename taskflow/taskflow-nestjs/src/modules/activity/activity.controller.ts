import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Page } from '../../common/cursor.js';
import { ApiPage } from '../../common/http/api-page.js';
import { API_PREFIX } from '../../common/http/routes.js';
import { IdParam } from '../../common/validation/parse-id.pipe.js';
import { CurrentUser } from '../auth/decorators.js';
import { ActivityEventDto, ActivityQueryDto } from './activity.dto.js';
import { ActivityService } from './activity.service.js';

@ApiTags('activity')
@Controller(API_PREFIX)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get('workspaces/:workspaceId/activity')
  @ApiPage(ActivityEventDto)
  list(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
    @Query() query: ActivityQueryDto,
  ): Promise<Page<ActivityEventDto>> {
    const { limit, cursor, ...filter } = query;
    return this.activity.list(workspaceId, userId, filter, limit, cursor);
  }
}
