import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../prisma/prisma.module.js';
import { JwtAuthService } from './jwt.service.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { InviteCodeService } from './invite-code.service.js';
import { AuthController } from './auth.controller.js';
import { GoogleAuthService } from './google-auth.service.js';
import jwtConfig from '../../config/jwt.config.js';

@Module({
  imports: [
    ConfigModule.forFeature(jwtConfig),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('jwt.secret'),
        signOptions: {
          expiresIn: configService.get('jwt.accessTokenExpiry'),
        },
      }),
      inject: [ConfigService],
    }),
    PrismaModule,
  ],
  controllers: [AuthController],
  providers: [JwtAuthService, JwtStrategy, InviteCodeService, GoogleAuthService],
  exports: [JwtAuthService, InviteCodeService, GoogleAuthService, PassportModule],
})
export class AuthModule {}
