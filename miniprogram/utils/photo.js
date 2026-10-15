import { API_BASE_URL } from './api-config.js'
export function photoUrl(value) {
  if (typeof value !== 'string') return null
  const path = value.startsWith('/api/') ? value.slice(4) : value
  const allowed = /^\/files\/[A-Za-z0-9._%/-]+$/.test(path) || /^\/contracts\/[A-Za-z0-9_-]+\/attachments\/[A-Za-z0-9_-]+\/file$/.test(path)
  if (!allowed || path.includes('..')) return null
  return API_BASE_URL + path
}
