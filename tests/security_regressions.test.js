'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const bot = fs.readFileSync(path.join(root, 'DISCOMOD.js'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

// Claude's reported bug: permission methods are valid on the top-level slash
// command builder. In this source tree they are not chained from addSubcommand.
const lines = bot.split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('addSubcommand') && /setDefaultMemberPermissions/.test(lines[i])) {
    throw new Error('ASSERTION FAILED: permission method chained directly from addSubcommand');
  }
}
assert(/new SlashCommandBuilder\(\)[\s\S]{0,250}\.setName\('welcome'\)[\s\S]{0,220}setDefaultMemberPermissions/.test(bot),
  'welcome should keep its top-level default permission setting');

// The Python worker must never expose arbitrary exec to a Discord-controlled path.
assert(/if method=='python_exec':\s*\n\s*_reply\(\{'id': rid, 'ok': False, 'error': 'python_exec is disabled'\}\)/.test(bot),
  'python_exec must stay disabled');

// Python-backed math commands are owner-only, including the legacy prefix SymPy path.
for (const label of ["case 'sympy':", "case 'gaypy':", "case 'mpmath':"]) {
  const i = bot.indexOf(label);
  assert(i >= 0 && /Owner-only math command/.test(bot.slice(i, i + 300)), `${label} must be owner-gated`);
}
assert(/if \(lower\.startsWith\('sympy'\)\) \{[\s\S]{0,220}Owner-only math command/.test(bot),
  'legacy prefix sympy path must be owner-gated');

// Join/leave handlers should not duplicate the expensive kick audit-log check.
assert((bot.match(/client\.on\('guildMemberRemove'/g) || []).length === 1,
  'guildMemberRemove should have one consolidated handler');

// Prefix invite status must be a real command, not just listed in help text.
assert(/if\(sub==='status'\)\{return message\.channel\.send/.test(bot),
  '!invites status must have a handler');

// Math sessions must be guild-scoped to prevent cross-server continuation.
assert(bot.includes('const mathSessionKey = `${guildId}:${interaction.user.id}`;'),
  'slash math sessions must be guild-scoped');
assert(bot.includes('const mathSessionKeyMsg = `${guildId}:${uid}`;'),
  'prefix math sessions must be guild-scoped');

// Session growth must be bounded.
assert(bot.includes('Math session exceeded the 4000-character limit'),
  'prefix math sessions must have a hard size limit');
assert(bot.includes('expression too long (max 4000 characters)'),
  'mpmath expressions must have a hard size limit');

// Dashboard member search results are inserted into HTML; escape URLs too.
assert(!script.includes('<img src="${m.avatarUrl}"'),
  'member-search avatar URLs must be HTML-escaped');

console.log('security_regressions.test.js: all assertions passed');
