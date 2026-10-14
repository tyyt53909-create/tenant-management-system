import { writeFile, mkdir } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'

// 原创线条图标，可重复生成 PNG；微信 tabBar 不依赖 SVG 支持。
const size = 64
function crc32(buffer) {
  let crc = 0xffffffff
  for (const value of buffer) {
    crc ^= value
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4)
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, crc])
}
function segment(x, y, [x1, y1, x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - x1 - t * dx, y - y1 - t * dy) < 2
}
const shapes = {
  home: [[10, 30, 32, 10], [32, 10, 54, 30], [16, 26, 16, 53], [48, 26, 48, 53], [16, 53, 48, 53], [27, 53, 27, 37], [37, 53, 37, 37], [27, 37, 37, 37]],
  bill: [[17, 10, 47, 10], [17, 10, 17, 54], [47, 10, 47, 54], [17, 54, 47, 54], [24, 23, 40, 23], [24, 32, 40, 32], [24, 41, 35, 41]],
  repair: [[15, 13, 15, 26], [15, 26, 27, 26], [27, 26, 27, 13], [21, 26, 21, 52], [40, 12, 49, 22], [49, 22, 40, 32], [40, 12, 40, 52]],
  user: [[13, 53, 13, 47], [13, 47, 22, 37], [22, 37, 42, 37], [42, 37, 51, 47], [51, 47, 51, 53]],
  wallet: [[12, 18, 52, 18], [12, 18, 12, 49], [12, 49, 52, 49], [52, 18, 52, 49], [52, 28, 37, 28], [37, 28, 37, 39], [37, 39, 52, 39]],
  bell: [[18, 28, 18, 40], [46, 28, 46, 40], [18, 40, 12, 48], [46, 40, 52, 48], [12, 48, 52, 48], [27, 54, 37, 54]],
  calendar: [[13, 16, 51, 16], [13, 16, 13, 53], [51, 16, 51, 53], [13, 53, 51, 53], [13, 28, 51, 28], [23, 10, 23, 22], [41, 10, 41, 22]],
  check: [[15, 32, 27, 44], [27, 44, 49, 20]],
  door: [[17, 9, 47, 9], [17, 9, 17, 54], [47, 9, 47, 54], [17, 54, 47, 54], [37, 32, 39, 32]],
  droplet: [[32,8,19,28],[19,28,13,39],[13,39,16,48],[16,48,23,54],[23,54,32,56],[32,56,41,54],[41,54,48,48],[48,48,51,39],[51,39,45,28],[45,28,32,8]],
  lightning: [[36,7,13,36],[13,36,29,36],[29,36,26,57],[26,57,51,27],[51,27,35,27],[35,27,36,7]],
  chair: [[18,12,46,12],[18,12,18,39],[46,12,46,39],[13,39,51,39],[18,39,18,55],[46,39,46,55],[13,31,13,41],[51,31,51,41]],
  grid: [[13,13,25,13],[25,13,25,25],[25,25,13,25],[13,25,13,13],[39,13,51,13],[51,13,51,25],[51,25,39,25],[39,25,39,13],[13,39,25,39],[25,39,25,51],[25,51,13,51],[13,51,13,39],[39,39,51,39],[51,39,51,51],[51,51,39,51],[39,51,39,39]]
}
await mkdir(new URL('../static/', import.meta.url), { recursive: true })
for (const name of ['home', 'bill', 'repair', 'user', 'contract', 'wallet', 'logo', 'avatar-default', 'bell', 'calendar', 'check', 'door', 'droplet', 'lightning', 'chair', 'grid']) {
  for (const active of ['home', 'bill', 'repair', 'user'].includes(name) ? [false, true] : [false]) {
    const shapeName = name === 'contract' ? 'bill' : name === 'logo' ? 'home' : name === 'avatar-default' ? 'user' : name
    const color = active || ['logo', 'contract', 'wallet', 'check'].includes(name) ? [104, 113, 91] : [129, 126, 118]
    const pixels = Buffer.alloc(size * (size * 4 + 1))
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let hits = 0
      for (const sy of [.25, .75]) for (const sx of [.25, .75]) {
        const px = x + sx, py = y + sy
        if (shapes[shapeName].some(line => segment(px, py, line)) ||
          (shapeName === 'user' && Math.abs(Math.hypot(px - 32, py - 22) - 10) < 2) ||
          (shapeName === 'bell' && py <= 29 && Math.abs(Math.hypot(px - 32, py - 28) - 14) < 2)) hits++
      }
      const offset = y * (size * 4 + 1) + 1 + x * 4
      pixels.set([...color, Math.round(hits * 255 / 4)], offset)
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
    await writeFile(new URL(`../static/${name}${active ? '-active' : ''}.png`, import.meta.url), png)
  }
}
console.log('Generated 20 local PNG icons')
