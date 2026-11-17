import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { ToLowerCase, Trim } from '../../common/validation/decorators.js';
import { UserDto } from '../users/user.dto.js';

export class RegisterDto {
  @ToLowerCase()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @Length(8, 128)
  password: string;

  @Trim()
  @IsString()
  @Length(1, 80)
  displayName: string;
}

export class LoginDto {
  @ToLowerCase()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @Length(1, 128)
  password: string;
}

export class AccessTokenDto {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export class AuthSessionDto extends AccessTokenDto {
  user: UserDto;
}
