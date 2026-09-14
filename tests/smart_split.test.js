'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(require.resolve('../DISCOMOD.js'), 'utf8');
const start = source.indexOf('function smartSplitText');
const end = source.indexOf('\n\n// Universal sender', start);
assert.ok(start >= 0 && end > start, 'smartSplitText function not found');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext('const DISCORD_SAFE_CONTENT_LIMIT = 1900;\n' + source.slice(start, end) + '\nthis.smartSplitText = smartSplitText;', sandbox);
const smartSplitText = sandbox.smartSplitText;

for (const size of [500, 1900, 1999, 2000, 2001, 4000, 10000, 50000]) {
  const input = 'x'.repeat(size);
  const chunks = smartSplitText(input);
  assert.ok(chunks.every(c => c.length <= 1900), `chunk exceeded safe limit for ${size}`);
  assert.strictEqual(chunks.join(''), input, `characters were lost for ${size}`);
}

const code = '```js\n' + 'const answer = 42;\n'.repeat(400) + '```';
const codeChunks = smartSplitText(code);
assert.ok(codeChunks.every(c => c.length <= 1900), 'code chunk exceeded safe limit');
assert.ok(codeChunks.every(c => ((c.match(/```/g) || []).length % 2) === 0), 'code fence became unbalanced');

console.log('smart_split.test.js: PASS');
