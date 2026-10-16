import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createThumbnail, detectImageMime } from './image-bytes.js';

describe('图片内容校验与缩略图', () => {
  it('扩展名是 png 但内容不是图片时识别失败', () => {
    expect(detectImageMime(Buffer.from('<script>not a PNG</script>'))).toBeNull();
  });

  it('缩略图去掉 EXIF GPS', async () => {
    const input = await sharp({
      create: { width: 32, height: 24, channels: 3, background: { r: 9, g: 8, b: 7 } },
    }).jpeg().withMetadata({
      exif: {
        IFD0: { ImageDescription: 'gps-test' },
        GPS: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '22/1 32/1 0/1',
          GPSLongitudeRef: 'E',
          GPSLongitude: '114/1 8/1 0/1',
        },
      } as any,
    }).toBuffer();
    const before = await sharp(input).metadata();
    expect(before.exif).toBeInstanceOf(Buffer);

    const thumb = await createThumbnail(input);
    const after = await sharp(thumb).metadata();
    expect(after.format).toBe('jpeg');
    expect(after.exif).toBeUndefined();
    expect(after.width).toBeLessThanOrEqual(320);
    expect(thumb.includes(Buffer.from('gps-test'))).toBe(false);
  });
});
