import { Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { API_PREFIX } from '../../common/http/routes.js';
import { notFound } from '../../common/problem.js';
import { defined, PatchBody } from '../../common/validation/decorators.js';
import { CurrentUser } from '../auth/decorators.js';
import { toUser, UpdateUserDto, UserDto } from './user.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@Controller(`${API_PREFIX}/users`)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  async me(@CurrentUser() userId: string): Promise<UserDto> {
    const user = await this.users.findById(userId);
    if (!user) throw notFound('User');
    return toUser(user);
  }

  @Patch('me')
  async updateMe(@CurrentUser() userId: string, @PatchBody() dto: UpdateUserDto): Promise<UserDto> {
    const user = await this.users.update(userId, defined(dto));
    if (!user) throw notFound('User');
    return toUser(user);
  }
}
