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
import { EmailOtpService } from './email-otp.service.js';
import { MemoryOtpStore, OTP_STORE } from './otp-store.js';
import jwtConfig from '../../config/jwt.config.js';
import { RedisModule } from '../../redis/redis.module.js';
import { RedisOtpStore } from '../../redis/redis-otp.store.js';
import { RedisService } from '../../redis/redis.service.js';

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
    RedisModule,
  ],
  controllers: [AuthController],
  providers: [
    JwtAuthService,
    JwtStrategy,
    InviteCodeService,
    GoogleAuthService,
    EmailOtpService,
    {
      provide: OTP_STORE,
      inject: [RedisService],
      useFactory: async (redis: RedisService) => {
        await redis.connect();
        return redis.ready && redis.client ? new RedisOtpStore(redis.client) : new MemoryOtpStore();
      },
    },
  ],
  exports: [JwtAuthService, InviteCodeService, GoogleAuthService, EmailOtpService, PassportModule],
})
export class AuthModule {}
