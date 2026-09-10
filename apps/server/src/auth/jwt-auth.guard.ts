import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface AuthedRequest extends Request {
  user?: { id: number; username: string; role: string };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (!token) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: '请先登录' });
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub: number; username: string; role: string }>(token);
      request.user = { id: payload.sub, username: payload.username, role: payload.role };
      return true;
    } catch {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: '登录状态已失效，请重新登录' });
    }
  }
}
