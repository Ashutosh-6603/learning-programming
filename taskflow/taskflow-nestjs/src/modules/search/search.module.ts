import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from '../../database/entities/task.entity.js';
import { AccessModule } from '../access/access.module.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Task]), AccessModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
