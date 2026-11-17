import { Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { API_PREFIX } from '../../common/http/routes.js';
import { CurrentUser } from '../auth/decorators.js';
import { TicketDto } from './ticket.dto.js';
import { Tickets } from './tickets.service.js';

@ApiTags('realtime')
@Controller(API_PREFIX)
export class RealtimeController {
  constructor(private readonly tickets: Tickets) {}

  @Post('ws/ticket')
  issueTicket(@CurrentUser() userId: string): Promise<TicketDto> {
    return this.tickets.issue(userId);
  }
}
