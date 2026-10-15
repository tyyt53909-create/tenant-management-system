import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  defaultBuildingId: process.env.DEFAULT_BUILDING_ID || 'building-001',
}));
