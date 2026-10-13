import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveApiBaseUrl } from '../utils/api-config.js'

test('development keeps local API default', () => {
  assert.equal(resolveApiBaseUrl(), 'http://localhost:3000/api')
})
test('configured URL trims whitespace and trailing slash', () => {
  assert.equal(resolveApiBaseUrl(' https://api.example.test/api/ ', true), 'https://api.example.test/api')
})
test('production requires explicit HTTPS API, never silent localhost fallback', () => {
  for (const value of ['', undefined, 'http://api.example.test/api', 'https://localhost/api', 'https://127.0.0.1/api', 'https://[::1]/api']) {
    assert.throws(() => resolveApiBaseUrl(value, true))
  }
})
test('rejects invalid protocols, credentials, query, fragments and missing API prefix', () => {
  for (const value of ['invalid', 'ftp://example.test/api', 'https://u:p@example.test/api',
    'https://example.test/api?key=1', 'https://example.test/api#fragment', 'https://example.test']) {
    assert.throws(() => resolveApiBaseUrl(value))
  }
})
