'use strict';
const assert = require('assert');
const fs = require('fs');
const text = fs.readFileSync(require.resolve('../DISCOMOD.js'), 'utf8');
const forbidden = [
  /content:\s*`[^`]*\.slice\(0\s*,\s*1900\)/m,
  /content:\s*[^\n]*\.slice\(0\s*,\s*1999\)/m,
  /message\.channel\.send\(\{\s*content:[^\n]*\.slice\(0\s*,\s*19\d\d\)/m,
];
for (const re of forbidden) {
  assert.ok(!re.test(text), `Found a direct 2k-ish message-content truncation: ${re}`);
}
assert.ok(/async function sendLongResponse\(/.test(text), 'Universal long-response helper missing');
console.log('response_audit.test.js: PASS');
