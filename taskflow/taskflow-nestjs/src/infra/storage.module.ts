import { Module } from '@nestjs/common';
import { Storage } from './storage.service.js';

@Module({ providers: [Storage], exports: [Storage] })
export class StorageModule {}
