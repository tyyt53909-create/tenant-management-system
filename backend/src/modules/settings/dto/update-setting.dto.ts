import { IsDefined } from 'class-validator';

/** 设置值由注册表逐 key 校验，这里只要求「必须提供 value」。 */
export class UpdateSettingDto {
  @IsDefined()
  value: unknown;
}
