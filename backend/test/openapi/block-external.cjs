const net = require('node:net');
const dgram = require('node:dgram');
const dns = require('node:dns');
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
let attempts = 0;
function blocked() { attempts++; throw new Error('OFFLINE_EXPORT_BLOCKED_NETWORK'); }
net.Socket.prototype.connect = blocked;
dgram.createSocket = blocked;
dns.lookup = blocked;
for (const name of Object.keys(dns)) if (name.startsWith('resolve')) dns[name] = blocked;
for (const name of Object.keys(dns.promises)) if (name.startsWith('resolve') || name === 'lookup') dns.promises[name] = blocked;
function check(path) {
  if (typeof path === 'string' && /(^|[\\/])\.env(?:\.|$)/.test(path)) {
    attempts++;
    throw new Error('OFFLINE_EXPORT_BLOCKED_ENV_FILE');
  }
}
for (const name of ['readFileSync', 'readFile']) {
  const original = fs[name];
  fs[name] = function (path, ...args) { check(path); return original.call(this, path, ...args); };
}
const readAsync = fs.promises.readFile;
fs.promises.readFile = function (path, ...args) { check(path); return readAsync.call(this, path, ...args); };
syncBuiltinESMExports();
process.on('exit', () => { if (attempts) process.exitCode = 1; });
