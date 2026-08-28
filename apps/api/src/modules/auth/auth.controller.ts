import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public, SkipTenant } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current.decorators';
import { AuthService } from './auth.service';
import { AuthUser } from './auth.types';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @SkipTenant()
  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return user;
  }
}
