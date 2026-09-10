import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard, type AuthedRequest } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() body: { username?: string; password?: string }) {
    return this.auth.login(body?.username || '', body?.password || '');
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  profile(@Req() request: AuthedRequest) {
    return this.auth.profile(request.user.id);
  }

  @Post('password')
  @UseGuards(JwtAuthGuard)
  changePassword(
    @Req() request: AuthedRequest,
    @Body() body: { oldPassword?: string; newPassword?: string },
  ) {
    return this.auth.changePassword(request.user.id, body?.oldPassword || '', body?.newPassword || '');
  }
}
