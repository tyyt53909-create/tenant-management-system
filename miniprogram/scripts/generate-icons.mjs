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
  wallet: [[12, 18, 52, 18], [12, 18, 12, 49], [12, 49, 52, 49], [52, 18, 52, 49], [52, 28, 37, 28], [37, 28, 37, 39], [37, 39, 52, 39]]
}
await mkdir(new URL('../static/', import.meta.url), { recursive: true })
for (const name of ['home', 'bill', 'repair', 'user', 'contract', 'wallet', 'logo', 'avatar-default']) {
  for (const active of ['home', 'bill', 'repair', 'user'].includes(name) ? [false, true] : [false]) {
    const shapeName = name === 'contract' ? 'bill' : name === 'logo' ? 'home' : name === 'avatar-default' ? 'user' : name
    const color = active || ['logo', 'contract', 'wallet'].includes(name) ? [23, 107, 80] : [122, 126, 131]
    const pixels = Buffer.alloc(size * (size * 4 + 1))
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let hits = 0
      for (const sy of [.25, .75]) for (const sx of [.25, .75]) {
        const px = x + sx, py = y + sy
        if (shapes[shapeName].some(line => segment(px, py, line)) ||
          (shapeName === 'user' && Math.abs(Math.hypot(px - 32, py - 22) - 10) < 2)) hits++
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
console.log('Generated 12 local PNG icons')
