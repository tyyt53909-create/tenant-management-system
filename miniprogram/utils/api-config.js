export function resolveApiBaseUrl(value, production = false) {
  const candidate = value?.trim() || (production ? '' : 'http://localhost:3000/api')
  if (!candidate) throw new Error('生产构建必须设置 VITE_API_BASE_URL（HTTPS 地址，带 /api）')
  let parsed
  try { parsed = new URL(candidate) } catch { throw new Error('VITE_API_BASE_URL 必须是完整 HTTP(S) URL') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('VITE_API_BASE_URL 不允许非 HTTP(S) 协议、凭证、查询参数或片段')
  }
  if (production && (parsed.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) {
    throw new Error('生产 API 必须使用非 localhost 的 HTTPS 地址')
  }
  const pathname = parsed.pathname.replace(/\/+$/, '')
  if (!pathname.endsWith('/api')) throw new Error('VITE_API_BASE_URL 必须包含后端 /api 前缀')
  return `${parsed.origin}${pathname}`
}

// Vite 在构建时注入。Node 单元测试不需要 Vite 环境。
export const API_BASE_URL = typeof __API_BASE_URL__ === 'string'
  ? __API_BASE_URL__ : resolveApiBaseUrl()
