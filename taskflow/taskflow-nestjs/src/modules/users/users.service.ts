import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity.js';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  findById(id: string): Promise<User | null> {
    return this.users.findOneBy({ id });
  }

  /** The only query that reads the password hash: the column is `select: false`. */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }

  findByIds(ids: string[]): Promise<User[]> {
    return this.users.findBy({ id: In(ids) });
  }

  create(data: { email: string; passwordHash: string; displayName: string }): Promise<User> {
    return this.users.save(this.users.create(data));
  }

  async update(id: string, data: { displayName?: string }): Promise<User | null> {
    await this.users.update({ id }, data);
    return this.findById(id);
  }
}
