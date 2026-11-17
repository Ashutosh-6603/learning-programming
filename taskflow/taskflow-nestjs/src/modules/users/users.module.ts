import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/entities/user.entity.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  // forFeature registers a Repository<User> provider that @InjectRepository(User) asks for.
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService],
  // Providers are private to their module unless exported.
  exports: [UsersService],
})
export class UsersModule {}
