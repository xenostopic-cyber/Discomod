// ╔══════════════════════════════════════════════════════════════════════╗
// ║  DISCOMOD — WEB DASHBOARD  (optional, off by default)                ║
// ║  A settings dashboard covering every guild setting DISCOMOD.js        ║
// ║  tracks, gated to server admins / bot managers via Discord OAuth2.    ║
// ╚══════════════════════════════════════════════════════════════════════╝
'use strict';

// ─── SETUP (do this before turning it on) ───────────────────────────────
//
//  1. In the Discord Developer Portal (discord.com/developers/applications),
//     open YOUR bot's application → OAuth2 tab:
//       - Copy "CLIENT SECRET" (different from the bot token!)
//       - Under "Redirects", add:  http://localhost:3000/auth/callback
//         (swap the host/port for your real domain once deployed)
//
//  2. Add these to your .env (CLIENT_ID already exists — reused as-is):
//       CLIENT_SECRET=your_oauth_client_secret
//       DASHBOARD_ENABLED=true
//       DASHBOARD_PORT=3000
//       DASHBOARD_REDIRECT_URI=http://localhost:3000/auth/callback
//       DASHBOARD_SESSION_SECRET=some_long_random_string
//       DASHBOARD_BOT_PERMISSIONS=8   (optional — 8 = Administrator, the default)
//
//  Public hosting: set DASHBOARD_TRUST_PROXY=true if you're behind nginx/
//  Caddy/a load balancer (needed for secure cookies and rate limiting to see
//  the real client, not the proxy). Point DASHBOARD_REDIRECT_URI at your
//  real https:// domain and re-register that exact URI in the Developer
//  Portal. Cookies automatically go Secure-only once your redirect URI is
//  https:// — no separate flag needed for that part.
//
//  3. In DISCOMOD.js, near the bottom (after client.login(TOKEN) or inside
//     your 'clientReady' handler), add:
//       if (process.env.DASHBOARD_ENABLED === 'true') {
//           require('./dashboard').startDashboard({
//               client, loadData, saveData, getGuildSettings, isManagerMember, isSuperUser,
//           });
//       }
//
//     Pass `loadData` itself (the function), not a `data` object you loaded
//     once — the dashboard calls it fresh on every request, exactly like
//     your interactionCreate/messageCreate handlers do, so it never shows
//     or overwrites stale state if the bot changed something in between.
//
//  Nothing here runs unless DASHBOARD_ENABLED=true — leave it unset/false
//  and this file does nothing even if required.
// ─────────────────────────────────────────────────────────────────────────

const express = require('express');
const crypto = require('crypto');
const path = require('path');
let bfUpdates = null;
try { bfUpdates = require('./bloxfruits_updates'); } catch (_) {}
let mathMod = null;
try { mathMod = require('./math_commands'); } catch (_) {}

const CLIENT_ID          = process.env.CLIENT_ID || '';
const CLIENT_SECRET       = process.env.CLIENT_SECRET || '';
const REDIRECT_URI        = process.env.DASHBOARD_REDIRECT_URI || 'http://localhost:3000/auth/callback';
const SESSION_SECRET      = process.env.DASHBOARD_SESSION_SECRET || '';
const PORT                = parseInt(process.env.DASHBOARD_PORT, 10) || 3000;
const BOT_PERMISSIONS     = process.env.DASHBOARD_BOT_PERMISSIONS || '8';
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30d hard ceiling; access-token refresh (below) keeps permissions genuinely fresh well before this, so this is a "you must fully re-login at least monthly" safety net, not the main freshness mechanism

// ── Web verification (public /verify/:token page) ─────────────────────────
// PUBLIC_BASE_URL: derived from the OAuth redirect URI by default (same host,
// just without the /auth/callback suffix) — set DASHBOARD_PUBLIC_URL explicitly
// if the dashboard sits behind a different public hostname than its OAuth
// callback (e.g. a reverse proxy path).
const PUBLIC_BASE_URL = process.env.DASHBOARD_PUBLIC_URL || REDIRECT_URI.replace(/\/auth\/callback\/?$/, '');
// Turnstile is Cloudflare's free, privacy-respecting CAPTCHA — get a site key
// + secret key at https://dash.cloudflare.com/?to=/:account/turnstile (no
// domain ownership verification needed for testing; use "Managed" widget mode).
// Without these set, the verify page still works (token-only) rather than
// hard-blocking servers that haven't set it up yet, but it visibly labels
// itself "CAPTCHA not configured" rather than silently pretending to be
// protected — see /api/verify/:token/meta's turnstileEnabled field.
const TURNSTILE_SITE_KEY   = process.env.TURNSTILE_SITE_KEY || '';
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '';

// ══════════════════════════════════════════════════════════
//  INTERACTIVE CAPTCHA — a self-contained visual challenge that needs no
//  external service or API key, unlike Turnstile above (which requires a
//  Cloudflare account + env vars — if those aren't set, verification
//  previously had NO challenge at all, just the link itself). This is
//  additive: an admin can use Turnstile, this, both, or neither — not a
//  replacement.
//
//  This is a deterrent against casual/scripted automation, the same way
//  any CAPTCHA is — it is NOT claimed to be unbeatable, and a sufficiently
//  motivated attacker (a human solving it manually, or a targeted ML
//  solver built specifically against this exact shape set) can get through
//  it. Treat it as one layer, same as Turnstile, not a guarantee.
// ══════════════════════════════════════════════════════════
const CAPTCHA_SHAPE_TYPES = ['circle', 'square', 'triangle', 'pentagon', 'hexagon', 'star'];
const CAPTCHA_SHAPE_COLORS = [
    { name: 'red', hex: '#E53935' }, { name: 'blue', hex: '#1E88E5' }, { name: 'green', hex: '#43A047' },
    { name: 'yellow', hex: '#FDD835' }, { name: 'purple', hex: '#8E24AA' }, { name: 'orange', hex: '#FB8C00' },
    { name: 'cyan', hex: '#00ACC1' }, { name: 'pink', hex: '#D81B60' },
];
const CAPTCHA_CANVAS_W = 400, CAPTCHA_CANVAS_H = 260;
const CAPTCHA_SHAPE_COUNT = 6;
const CAPTCHA_MIN_SIZE = 18, CAPTCHA_MAX_SIZE = 34;

function captchaRandInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function captchaPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Places CAPTCHA_SHAPE_COUNT non-overlapping shapes, then picks a challenge
// type whose answer is verifiably unambiguous among the generated set
// (never phrases a question the layout itself can't answer cleanly).
// Returns null if this attempt didn't produce a clean layout — the caller
// (generateCaptchaChallenge) retries rather than ever showing an ambiguous
// or unanswerable challenge to a real user.
function tryGenerateCaptchaLayout() {
    const shapes = [];
    let tries = 0;
    while (shapes.length < CAPTCHA_SHAPE_COUNT && tries < 200) {
        tries++;
        const size = captchaRandInt(CAPTCHA_MIN_SIZE, CAPTCHA_MAX_SIZE);
        const x = captchaRandInt(size + 10, CAPTCHA_CANVAS_W - size - 10);
        const y = captchaRandInt(size + 10, CAPTCHA_CANVAS_H - size - 10);
        const overlaps = shapes.some(s => Math.hypot(s.x - x, s.y - y) < (s.size + size) * 0.9);
        if (overlaps) continue;
        shapes.push({ id: `s${shapes.length}`, type: captchaPick(CAPTCHA_SHAPE_TYPES), color: captchaPick(CAPTCHA_SHAPE_COLORS), size, x, y, rotation: captchaRandInt(0, 359) });
    }
    if (shapes.length < 3) return null;

    const challengeTypes = [];
    // "Click the {color} {type}" — only offered when exactly one shape has
    // that exact color+type combination (no duplicate to confuse the answer).
    const uniqueColorType = shapes.filter(s => shapes.filter(o => o.type === s.type && o.color.name === s.color.name).length === 1);
    if (uniqueColorType.length) challengeTypes.push({ weight: 3, build: () => { const t = captchaPick(uniqueColorType); return { correctId: t.id, promptText: `Click the ${t.color.name} ${t.type}.`, altPrompt: `${t.color.name} ${t.type}` }; } });

    // "Click the largest shape" — only when there's a clear size leader (at
    // least 4px over the runner-up), so it's never a genuine judgment call.
    const bySize = [...shapes].sort((a, b) => b.size - a.size);
    if (bySize.length >= 2 && bySize[0].size - bySize[1].size >= 4) challengeTypes.push({ weight: 2, build: () => ({ correctId: bySize[0].id, promptText: 'Click the largest shape.', altPrompt: 'the largest shape' }) });

    // "Click the shape with the most sides" — restricted to shapes with an
    // unambiguous side count (circle and star excluded on purpose: a circle
    // has no side count, and a star's could reasonably be read as 5 or 10
    // depending on how someone counts points vs. edges).
    const SIDES = { triangle: 3, square: 4, pentagon: 5, hexagon: 6 };
    const sided = shapes.filter(s => SIDES[s.type] !== undefined);
    if (sided.length >= 2) {
        const maxSides = Math.max(...sided.map(s => SIDES[s.type]));
        const withMax = sided.filter(s => SIDES[s.type] === maxSides);
        if (withMax.length === 1) challengeTypes.push({ weight: 2, build: () => ({ correctId: withMax[0].id, promptText: 'Click the shape with the most sides.', altPrompt: 'the shape with the most sides' }) });
    }
    if (!challengeTypes.length) return null;

    const totalWeight = challengeTypes.reduce((s, c) => s + c.weight, 0);
    let roll = Math.random() * totalWeight;
    let chosen = challengeTypes[0];
    for (const c of challengeTypes) { if (roll < c.weight) { chosen = c; break; } roll -= c.weight; }
    const { correctId, promptText, altPrompt } = chosen.build();
    return {
        promptText, altPrompt, correctId,
        shapes: shapes.map(({ id, type, color, size, x, y, rotation }) => ({ id, type, colorHex: color.hex, colorName: color.name, size, x, y, rotation })),
    };
}
function generateCaptchaChallenge(maxTries = 15) {
    for (let i = 0; i < maxTries; i++) { const c = tryGenerateCaptchaLayout(); if (c) return c; }
    return null; // astronomically unlikely given the parameters above, but never crash if it happens
}

const CAPTCHA_DEFAULTS = { mode: 'off', challengeCount: 2, timeLimitSec: 45, maxAttempts: 6, cooldownSec: 60 };
function getCaptchaConfig(gs) { return { ...CAPTCHA_DEFAULTS, ...(gs.verifyCaptcha || {}) }; }

// Ephemeral per-challenge-instance state (the actual shape layout + which
// one is correct) — deliberately NOT persisted to disk. An in-progress,
// not-yet-answered challenge lost to a restart just means the user gets a
// fresh one on their next /captcha/new call; nothing about verification
// state itself lives here (that's on the webVerifyTokens record, which IS
// persisted). Swept for expired entries every minute.
const _captchaChallenges = new Map(); // challengeToken -> { verifyToken, correctId, shapes, expiresAt }
setInterval(() => { const now = Date.now(); for (const [k, v] of _captchaChallenges) if (now > v.expiresAt + 60000) _captchaChallenges.delete(k); }, 60000);
const WEB_VERIFY_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes to actually complete the page

// ══════════════════════════════════════════════════════════
//  Dependency-free signed session tokens (HMAC-SHA256, no jsonwebtoken
//  package needed — this IS what a JWT does, just hand-rolled so the
//  only new dependency this whole file adds is `express`)
// ══════════════════════════════════════════════════════════
function b64url(input) {
    return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(input) {
    input = input.replace(/-/g, '+').replace(/_/g, '/');
    while (input.length % 4) input += '=';
    return Buffer.from(input, 'base64').toString();
}
// Encrypts the OAuth refresh token specifically (not just signs it) before it
// rides inside the session cookie — refresh tokens are more sensitive than
// the rest of the session payload, so they get real confidentiality, not
// just tamper-evidence.
function encryptSecret(text) {
    const key = crypto.createHash('sha256').update(SESSION_SECRET).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}
function decryptSecret(b64) {
    const key = crypto.createHash('sha256').update(SESSION_SECRET).digest();
    const buf = Buffer.from(b64, 'base64');
    const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
function signSession(payload) {
    const body = { ...payload, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC };
    const encoded = b64url(JSON.stringify(body));
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('hex');
    return `${encoded}.${sig}`;
}
function verifySession(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [encoded, sig] = token.split('.');
    if (!encoded || !sig) return null;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('hex');
    const a = Buffer.from(sig, 'hex'), b = Buffer.from(expectedSig, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        const payload = JSON.parse(b64urlDecode(encoded));
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch { return null; }
}
function parseCookies(req) {
    const header = req.headers.cookie || '';
    const out = {};
    header.split(';').forEach(pair => {
        const idx = pair.indexOf('=');
        if (idx === -1) return;
        out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    });
    return out;
}
function setCookie(res, name, value, opts = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`];
    if (opts.httpOnly !== false) parts.push('HttpOnly');
    parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
    parts.push(`Path=${opts.path || '/'}`);
    if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
    if (opts.secure) parts.push('Secure');
    const existing = res.getHeader('Set-Cookie');
    const list = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
    list.push(parts.join('; '));
    res.setHeader('Set-Cookie', list);
}
function clearCookie(res, name) { setCookie(res, name, '', { maxAge: 0 }); }
function randomState() { return crypto.randomBytes(16).toString('hex'); }
// Secure cookies over plain HTTP break local testing, so this only requires
// HTTPS when the request genuinely arrived over it (directly, or via a
// trusted proxy's X-Forwarded-Proto once DASHBOARD_TRUST_PROXY=true) or when
// the configured redirect URI itself is HTTPS, implying a real deployment.
function cookieSecureFor(req) {
    if (process.env.DASHBOARD_FORCE_INSECURE_COOKIES === 'true') return false;
    return req.secure || req.get('x-forwarded-proto') === 'https' || REDIRECT_URI.startsWith('https://');
}

// ══════════════════════════════════════════════════════════
//  DISCORD OAUTH2 + API HELPERS  (native fetch, no extra HTTP deps)
// ══════════════════════════════════════════════════════════
async function exchangeCodeForToken(code) {
    const body = new URLSearchParams({
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
    });
    const res = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
    return res.json();
}
async function refreshAccessToken(refreshToken) {
    const body = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: refreshToken });
    const res = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    return res.json();
}
async function fetchDiscordUser(accessToken) {
    const res = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`/users/@me failed: ${res.status}`);
    return res.json();
}
async function fetchDiscordUserGuilds(accessToken) {
    const res = await fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`/users/@me/guilds failed: ${res.status}`);
    return res.json();
}
function botInviteUrl(guildId) {
    const params = new URLSearchParams({ client_id: CLIENT_ID, permissions: BOT_PERMISSIONS, scope: 'bot applications.commands' });
    if (guildId) params.set('guild_id', guildId);
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
function loginUrl(state) {
    const params = new URLSearchParams({
        client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
        scope: 'identify guilds', state,
    });
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
const ADMINISTRATOR_BIT = 0x8n;
function hasAdminBit(permissionsStr) {
    try { return (BigInt(permissionsStr) & ADMINISTRATOR_BIT) === ADMINISTRATOR_BIT; } catch { return false; }
}

// ══════════════════════════════════════════════════════════
//  PERMISSION CHECKING — reuses the bot's OWN isManagerMember/isSuperUser
//  so the dashboard can never drift out of sync with the bot's actual
//  notion of "who can manage this server."
// ══════════════════════════════════════════════════════════
async function canManageGuild(deps, userId, guildId) {
    const { client, loadData, isManagerMember, isSuperUser } = deps;
    if (isSuperUser && isSuperUser(userId)) return true;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false; // bot isn't in this guild
    let member;
    try { member = guild.members.cache.get(userId) || await guild.members.fetch(userId); }
    catch { return false; } // user isn't a member of this guild
    if (member.permissions.has('Administrator')) return true;
    if (String(guild.ownerId) === String(userId)) return true;
    if (isManagerMember && isManagerMember(member, guildId, loadData())) return true;
    return false;
}
async function computeGuildLists(deps, userId, oauthGuilds) {
    const manageableIds = [];
    const addable = [];
    for (const g of oauthGuilds) {
        const botHere = deps.client.guilds.cache.has(g.id);
        if (botHere) {
            if (await canManageGuild(deps, userId, g.id)) manageableIds.push(g.id);
        } else if (g.owner || hasAdminBit(g.permissions)) {
            addable.push({ id: g.id, name: g.name, icon: g.icon, owner: !!g.owner });
        }
    }
    return { manageableIds, addable };
}
function discordAvatarUrl(user) {
    return user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith('a_') ? 'gif' : 'png'}`
        : 'https://cdn.discordapp.com/embed/avatars/0.png';
}
function buildSessionPayload(discordUser, tokenResp, manageableIds, addable) {
    return {
        id: discordUser.id, username: discordUser.username, avatarUrl: discordAvatarUrl(discordUser),
        manageableIds, addable,
        accessExpiresAt: Date.now() + (tokenResp.expires_in || 604800) * 1000,
        refreshTokenEnc: tokenResp.refresh_token ? encryptSecret(tokenResp.refresh_token) : null,
    };
}
async function ensureFreshSession(deps, req, res, session) {
    const needsRefresh = !session.accessExpiresAt || session.accessExpiresAt - Date.now() < 5 * 60 * 1000;
    if (!needsRefresh || !session.refreshTokenEnc) return session;
    try {
        const refreshToken = decryptSecret(session.refreshTokenEnc);
        const tokenResp = await refreshAccessToken(refreshToken);
        const [discordUser, oauthGuilds] = await Promise.all([fetchDiscordUser(tokenResp.access_token), fetchDiscordUserGuilds(tokenResp.access_token)]);
        const { manageableIds, addable } = await computeGuildLists(deps, discordUser.id, oauthGuilds);
        const fresh = buildSessionPayload(discordUser, tokenResp, manageableIds, addable);
        setCookie(res, 'dm_session', signSession(fresh), { maxAge: SESSION_MAX_AGE_SEC, secure: cookieSecureFor(req) });
        return fresh;
    } catch (e) {
        console.error('[dashboard] silent token refresh failed, using existing session until it hard-expires:', e.message);
        return session;
    }
}

// ══════════════════════════════════════════════════════════
//  SETTINGS SCHEMA — every field here becomes a real, working control on
//  the dashboard automatically (frontend AND API both read this array; add
//  a setting to your bot? add one entry here and it's on the dashboard).
//
//  Field types: boolean | number | string | text | select | channel |
//               role | channel-multi | role-multi | array | color |
//               toggle-group (for nested {sub:true/false} objects)
//
//  Deliberately NOT included: `reactionRoles`, `categoryPolicies` — these
//  are dynamic content created via bot commands, not fixed-shape settings,
//  so a generic form doesn't fit them well (reaction roles get their own
//  page; category policies are managed via /policy). Everything else
//  DISCOMOD.js's getGuildSettings() defines a default for is here,
//  including `tags`, via the generic 'keyvalue' field type below.
// ══════════════════════════════════════════════════════════
const SETTINGS_SCHEMA = [
    { category: 'General', icon: '⚙️', fields: [
        { key: 'commandPrefix', label: 'Prefix Command Character', type: 'string', desc: 'E.g. "!" — used for text commands like !balance.' },
    ]},
    { category: 'Channels & Roles', icon: '📍', fields: [
        { key: 'tradeChannelId', label: 'Trade Channel', type: 'channel' },
        { key: 'servicesChannelId', label: 'Services Channel', type: 'channel' },
        { key: 'gamesHubId', label: 'Games Hub Channel', type: 'channel' },
        { key: 'exiledRoleId', label: 'Exiled Role', type: 'role' },
        { key: 'logChannelId', label: 'Mod Log Channel', type: 'channel' },
        { key: 'appealsChannelId', label: 'Appeals Channel', type: 'channel' },
        { key: 'tradeChannelIds', label: 'Extra Trade Channels', type: 'channel-multi' },
        { key: 'servicesChannelIds', label: 'Extra Service Channels', type: 'channel-multi' },
        { key: 'gamesHubIds', label: 'Extra Bot-Command Channels', type: 'channel-multi' },
    ]},
    { category: 'Detection & Warnings', icon: '🛡️', fields: [
        { key: 'scamEnabled', label: 'Scam Detection', type: 'boolean' },
        { key: 'scamWarnEnabled', label: 'Warn on Scam Detection', type: 'boolean' },
        { key: 'spamWarnEnabled', label: 'Warn on Spam', type: 'boolean' },
        { key: 'begWarnEnabled', label: 'Warn on Begging', type: 'boolean' },
        { key: 'accTradeWarnEnabled', label: 'Warn on Account Trading', type: 'boolean' },
        { key: 'aiEnabled', label: 'AI-Assisted Detection', type: 'boolean' },
        { key: 'checksEnabled', label: 'Enable Checker Systems', type: 'boolean' },
        { key: 'noAffiliationEnabled', label: 'No-Affiliation Notices', type: 'boolean' },
        { key: 'commandRedirectEnabled', label: 'Redirect Off-topic Commands', type: 'boolean' },
        { key: 'serviceRedirectEnabled', label: 'Redirect Service Talk', type: 'boolean' },
        { key: 'tradeRedirectEnabled', label: 'Redirect Trade Talk', type: 'boolean' },
        { key: 'scanEditsEnabled', label: 'Also Scan Edited Messages', type: 'boolean' },
        { key: 'regexStrictness', label: 'Detection Strictness (1-10)', type: 'number', min: 1, max: 10 },
        { key: 'violationThreshold', label: 'Violations Before Exile', type: 'number', min: 1, max: 50 },
        { key: 'exileDurationMins', label: 'Exile Duration (minutes)', type: 'number', min: 1 },
        { key: 'exileStripRoles', label: 'Strip Roles on Exile', type: 'boolean' },
        { key: 'enforcementMode', label: 'Enforcement Mode', type: 'select', options: ['enforce', 'warn-only', 'log-only'] },
    ]},
    { category: 'Custom AutoMod', icon: '🚫', fields: [
        { key: 'automodDeleteMessage', label: 'Delete Matched Messages', type: 'boolean', desc: 'Word/regex rules, exemptions, actions, timeout duration, log channel, and the test box moved to the dedicated AutoMod page (sidebar → Moderation → Custom AutoMod) for a real word-by-word editor and a live "would this be blocked" tester. This is the one AutoMod setting that page doesn\'t cover.' },
    ]},
    { category: 'Beli Economy Core', icon: '💰', fields: [
        { key: 'beliEconomy.startingWallet', label: 'New Player Starting Wallet', type: 'number', min: 0, max: 1000000000, desc: 'Applies only when a user gets their first Beli record in this server. Existing wallets are never overwritten.' },
        { key: 'beliEconomy.startingBank', label: 'New Player Starting Bank', type: 'number', min: 0, max: 1000000000, desc: 'Applies only to newly-created economy records and is capped by the configured base bank capacity.' },
        { key: 'beliEconomy.baseBankCapacity', label: 'Base Bank Capacity', type: 'number', min: 100, max: 1000000000, desc: 'Live base capacity before Vault upgrades. Existing balances are preserved; deposits use the new capacity immediately.' },
    ]},
    { category: 'Beli Earn (Daily/Weekly/Work/Crime/Rob/Trivia)', icon: '☀️', fields: [
        { key: 'beliEarn.dailyBase', label: 'Daily Base Amount', type: 'number', min: 0 },
        { key: 'beliEarn.dailyStreakStep', label: 'Daily Streak Bonus (per day)', type: 'number', min: 0 },
        { key: 'beliEarn.dailyStreakCap', label: 'Daily Streak Bonus Cap', type: 'number', min: 0 },
        { key: 'beliEarn.dailyCooldownMs', label: 'Daily Cooldown (ms)', type: 'number', min: 0, desc: '86400000 = 24 hours.' },
        { key: 'beliEarn.weeklyBase', label: 'Weekly Base Amount', type: 'number', min: 0 },
        { key: 'beliEarn.weeklyCooldownMs', label: 'Weekly Cooldown (ms)', type: 'number', min: 0, desc: '604800000 = 7 days.' },
        { key: 'beliEarn.workMin', label: 'Work Minimum Payout', type: 'number', min: 0 },
        { key: 'beliEarn.workMax', label: 'Work Maximum Payout', type: 'number', min: 0, desc: 'If this ends up lower than the minimum, the bot swaps them automatically rather than erroring.' },
        { key: 'beliEarn.workCooldownMs', label: 'Work Cooldown (ms)', type: 'number', min: 0, desc: '3600000 = 1 hour.' },
        { key: 'beliEarn.crimeSuccessChance', label: 'Crime Base Success Chance', type: 'number', min: 0, max: 0.9, desc: '0–0.9. Player luck/boosts add on top of this, but the total is always capped at 0.9 (90%) regardless.' },
        { key: 'beliEarn.crimeMin', label: 'Crime Success — Min Payout', type: 'number', min: 0 },
        { key: 'beliEarn.crimeMax', label: 'Crime Success — Max Payout', type: 'number', min: 0 },
        { key: 'beliEarn.crimeFineMin', label: 'Crime Fail — Min Fine (% of wallet)', type: 'number', min: 0, max: 1, desc: '0–1, e.g. 0.1 = 10% of current wallet.' },
        { key: 'beliEarn.crimeFineMax', label: 'Crime Fail — Max Fine (% of wallet)', type: 'number', min: 0, max: 1 },
        { key: 'beliEarn.crimeCooldownMs', label: 'Crime Cooldown (ms)', type: 'number', min: 0, desc: '2700000 = 45 min.' },
        { key: 'beliEarn.robSuccessChance', label: 'Rob Base Success Chance', type: 'number', min: 0.05, max: 0.85, desc: "0.05–0.85. A victim's Security upgrade still lowers this and their Rob Shield still fully blocks it — this can't override either protection, by design." },
        { key: 'beliEarn.robStealMin', label: 'Rob Success — Min Steal (% of victim wallet)', type: 'number', min: 0, max: 1 },
        { key: 'beliEarn.robStealMax', label: 'Rob Success — Max Steal (% of victim wallet)', type: 'number', min: 0, max: 1 },
        { key: 'beliEarn.robFailFinePct', label: 'Rob Fail — Fine (% of robber wallet)', type: 'number', min: 0, max: 1 },
        { key: 'beliEarn.robMinVictimWallet', label: 'Rob — Minimum Victim Wallet to Target', type: 'number', min: 0, desc: 'Prevents robbing players who have almost nothing.' },
        { key: 'beliEarn.robCooldownMs', label: 'Rob Cooldown (ms)', type: 'number', min: 0, desc: '7200000 = 2 hours.' },
        { key: 'beliEarn.triviaMin', label: 'Trivia — Min Reward', type: 'number', min: 0 },
        { key: 'beliEarn.triviaMax', label: 'Trivia — Max Reward', type: 'number', min: 0 },
        { key: 'beliEarn.triviaAnswerWindowMs', label: 'Trivia — Answer Time Limit (ms)', type: 'number', min: 5000, desc: '60000 = 60 seconds. The bot\'s own reply text updates to match whatever this is set to.' },
        { key: 'beliEarn.triviaCooldownMs', label: 'Trivia Cooldown (ms)', type: 'number', min: 0, desc: '30000 = 30 seconds. Question content itself isn\'t editable here — that\'s bot-authored trivia content, not a tuning number.' },
        { key: 'beliEarn.coinflipWinChance', label: 'Coinflip Win Chance', type: 'number', min: 0.05, max: 0.9, desc: "0.05–0.9. Whatever you set, the bot enforces a sane house edge (roughly 0–40%) against the payout multiplier below — a combination that would guarantee player profit or become predatory gets corrected automatically rather than saved as-is." },
        { key: 'beliEarn.coinflipPayoutMult', label: 'Coinflip Payout Multiplier', type: 'number', min: 1, max: 3, desc: '1.95 = win 1.95x your bet.' },
        { key: 'beliEarn.diceEdgeFactor', label: 'Dice Edge Factor', type: 'number', min: 0.5, max: 1, desc: "0.5–1.0, applied on top of the true 1-in-6 odds (so 1.0 means no reduction from true odds). Combined with the payout multiplier below, an exploitative or predatory combination gets corrected automatically, same protection as Coinflip." },
        { key: 'beliEarn.dicePayoutMult', label: 'Dice Payout Multiplier', type: 'number', min: 1, max: 10, desc: '5 = win 5x your bet on a correct guess.' },
        { key: 'beliEarn.rouletteColorEdgeFactor', label: 'Roulette Color Bet Edge Factor', type: 'number', min: 0.5, max: 1, desc: 'Applied on top of true 18/37 odds for red/black bets (~12.7% house edge by default). Protected against negative or excessive edges.' },
        { key: 'beliEarn.rouletteColorPayoutMult', label: 'Roulette Color Bet Payout', type: 'number', min: 1, max: 3, desc: '1.95 = win 1.95x your bet.' },
        { key: 'beliEarn.rouletteNumberEdgeFactor', label: 'Roulette Number/Green Bet Edge Factor', type: 'number', min: 0.5, max: 1, desc: "Applied on top of true 1/37 odds (~65% house edge by default — intentionally much steeper than the color bet, same as real roulette's single-number bet. This is NOT clamped to the same 40% ceiling as other games, since that would incorrectly flatten a bet that's supposed to be this steep. Only genuinely broken combinations — negative edge, or something above ~90% — get corrected." },
        { key: 'beliEarn.rouletteNumberPayoutMult', label: 'Roulette Number/Green Bet Payout', type: 'number', min: 1, max: 36, desc: '14 = win 14x your bet.' },
        { key: 'beliEarn.higherLowerWinChance', label: 'Higher/Lower Win Chance', type: 'number', min: 0.05, max: 0.55, desc: "0.05–0.55 (capped lower than most games — this one's balanced around a near-coinflip feel). Protected against negative or excessive house edges, same as Coinflip." },
        { key: 'beliEarn.higherLowerPayoutMult', label: 'Higher/Lower Payout Multiplier', type: 'number', min: 1, max: 3, desc: '1.9 = win 1.9x your bet. Wheel, Scratch, Keno, Limbo, War, Slots, Blackjack, Crash, and Mines still use their original hard-coded values — not wired up. That would be its own, separate pass given how much shared odds/multiplier logic they touch.' },
    ]},
    { category: 'Blox Fruits Stock', icon: '🍎', fields: [
        { key: 'bfStockNotifyEnabled', label: 'Enable Normal Dealer Stock Notifications', type: 'boolean', desc: 'Source is a fan-maintained wiki, not an official API — data can be wrong or briefly stale. Mirage Dealer stock is not available from this source (the wiki itself doesn\'t track it) and is not supported.' },
        { key: 'bfStockChannelId', label: 'Notification Channel', type: 'channel' },
        { key: 'bfStockRoleId', label: 'Notification Role', type: 'role' },
        { key: 'bfStockPingRole', label: 'Ping the Role', type: 'boolean' },
    ]},
    { category: 'Link Verification Gate', icon: '🔒', fields: [
        { key: 'verifyGateEnabled', label: 'Enable Verification Gate', type: 'boolean' },
        { key: 'verifyMinAccountAgeDays', label: 'Minimum Account Age (days)', type: 'number', min: 0 },
        { key: 'verifyRequiredRoleId', label: 'Required Role to Bypass', type: 'role' },
        { key: 'verifyGateAction', label: 'Action on Fail', type: 'select', options: ['warn', 'kick', 'ban', 'timeout'] },
    ]},
    { category: 'Auto-Timeout', icon: '⏱️', fields: [
        { key: 'timeoutEnabled', label: 'Enable Auto-Timeout', type: 'boolean' },
        { key: 'timeoutMinutesSpam', label: 'Timeout: Spam (minutes)', type: 'number', min: 1 },
        { key: 'timeoutMinutesScam', label: 'Timeout: Scam (minutes)', type: 'number', min: 1 },
        { key: 'timeoutMinutesCommand', label: 'Timeout: Command Misuse (minutes)', type: 'number', min: 1 },
        { key: 'timeoutMinutesTrade', label: 'Timeout: Off-topic Trade (minutes)', type: 'number', min: 1 },
        { key: 'timeoutMinutesService', label: 'Timeout: Off-topic Service (minutes)', type: 'number', min: 1 },
    ]},
    { category: 'Raid Protection', icon: '🚨', fields: [
        { key: 'raidModeEnabled', label: 'Manual Raid Mode Active', type: 'boolean' },
        { key: 'raidAutoEnabled', label: 'Auto-Detect Raids', type: 'boolean' },
        { key: 'raidJoinWindowSec', label: 'Join Window (seconds)', type: 'number', min: 1 },
        { key: 'raidJoinThreshold', label: 'Joins to Trigger Raid Mode', type: 'number', min: 1 },
        { key: 'raidLockdownMins', label: 'Auto-Lockdown Duration (minutes)', type: 'number', min: 1 },
        { key: 'raidLockChannels', label: 'Lock Channels During Raid', type: 'boolean' },
        { key: 'raidNotifyChannelId', label: 'Raid Alert Channel', type: 'channel' },
        { key: 'raidLinkBlockAll', label: 'Block All Links During Raid', type: 'boolean' },
        { key: 'raidNewAccountDays', label: 'Flag Accounts Newer Than (days)', type: 'number', min: 0 },
    ]},
    { category: 'Spam & Content Filters', icon: '🧹', fields: [
        { key: 'capsSpamEnabled', label: 'Caps Spam Filter', type: 'boolean' },
        { key: 'capsMaxPercent', label: 'Max Caps %', type: 'number', min: 1, max: 100 },
        { key: 'capsMinLetters', label: 'Min Letters to Check', type: 'number', min: 1 },
        { key: 'capsMaxRun', label: 'Max Consecutive Caps', type: 'number', min: 1 },
        { key: 'emojiSpamEnabled', label: 'Emoji Spam Filter', type: 'boolean' },
        { key: 'emojiMaxCount', label: 'Max Emoji Count', type: 'number', min: 1 },
        { key: 'emojiWindowSec', label: 'Emoji Window (seconds)', type: 'number', min: 1 },
        { key: 'zalgoEnabled', label: 'Zalgo Text Filter', type: 'boolean' },
        { key: 'zalgoMaxCombining', label: 'Max Combining Marks', type: 'number', min: 1 },
        { key: 'stretchSpamEnabled', label: 'Character-Stretch Filter', type: 'boolean' },
        { key: 'stretchMaxCharRun', label: 'Max Character Run', type: 'number', min: 1 },
        { key: 'stretchMaxPunctRun', label: 'Max Punctuation Run', type: 'number', min: 1 },
        { key: 'stretchMaxWordRepeat', label: 'Max Word Repeat', type: 'number', min: 1 },
        { key: 'dupeSpamEnabled', label: 'Duplicate Message Filter', type: 'boolean' },
        { key: 'dupeWindowSec', label: 'Duplicate Window (seconds)', type: 'number', min: 1 },
        { key: 'dupeThreshold', label: 'Duplicate Count Threshold', type: 'number', min: 2 },
        { key: 'dupeMinLen', label: 'Min Message Length to Check', type: 'number', min: 1 },
    ]},
    { category: 'Invite Policy', icon: '🔗', fields: [
        { key: 'invitePolicyEnabled', label: 'Enable Invite Policy', type: 'boolean' },
        { key: 'inviteAllowlistDomains', label: 'Allowed Invite Domains', type: 'array' },
        { key: 'inviteDenylistDomains', label: 'Blocked Invite Domains', type: 'array' },
        { key: 'inviteAllowedChannelIds', label: 'Channels Where Invites Are Always OK', type: 'channel-multi' },
    ]},
    { category: 'Attachment Policy', icon: '📎', fields: [
        { key: 'attachmentPolicyEnabled', label: 'Enable Attachment Policy', type: 'boolean' },
        { key: 'attachmentBlockExts', label: 'Blocked File Extensions', type: 'array', desc: 'One extension per line, no dots (e.g. exe).' },
    ]},
    { category: 'Link Policy', icon: '🌐', fields: [
        { key: 'linkPolicyEnabled', label: 'Enable Link Policy', type: 'boolean' },
        { key: 'linkMode', label: 'Link Mode', type: 'select', options: ['strict', 'relaxed'] },
        { key: 'linkAction', label: 'Action on Blocked Link', type: 'select', options: ['warn', 'delete', 'timeout', 'kick', 'ban'] },
        { key: 'linkAllowlistedDomains', label: 'Allowed Domains', type: 'array' },
        { key: 'linkDenylistedDomains', label: 'Blocked Domains', type: 'array' },
    ]},
    { category: 'Roast Command', icon: '🔥', fields: [
        { key: 'roastProvider', label: 'AI Provider', type: 'select', options: ['claude', 'roastedbyai', 'groq'], desc: '"groq" serves gpt-oss-120b.' },
        { key: 'roastContext', label: "Include Target's Recent Messages", type: 'boolean' },
    ]},
    { category: 'Bot Managers', icon: '👑', fields: [
        { key: 'managerRoles', label: 'Manager Roles (full bot access)', type: 'role-multi' },
        { key: 'managerUsers', label: 'Manager Users (full bot access)', type: 'array', desc: 'One Discord user ID per line.' },
    ]},
    { category: 'Applications', icon: '📋', fields: [
        { key: 'applications.enabled', label: 'Enable Applications', type: 'boolean' },
        { key: 'applications.applyChannelId', label: 'Application Channel', type: 'channel' },
        { key: 'applications.reviewChannelId', label: 'Application Review Channel', type: 'channel' },
        { key: 'applications.reviewerRoleIds', label: 'Reviewer Roles', type: 'role-multi' },
        { key: 'applications.timeLimitMinutes', label: 'Application Time Limit (minutes)', type: 'number', min: 1, max: 10080 },
        { key: 'applications.snoozeMinutes', label: 'Applicant Snooze Duration (minutes)', type: 'number', min: 1, max: 10080 },
        { key: 'applications.reviewSnoozeMinutes', label: 'Review Snooze Duration (minutes)', type: 'number', min: 1, max: 10080 },
        { key: 'applications.maxActivePerUser', label: 'Max Active Applications per User', type: 'number', min: 1, max: 10 },
        { key: 'applications.allowCancel', label: 'Allow Applicants to Cancel', type: 'boolean' },
        { key: 'applications.allowSnooze', label: 'Allow Applicants to Snooze', type: 'boolean' },
        { key: 'applications.decisionDm', label: 'DM Review Decisions', type: 'boolean' },
        { key: 'applications.requireRejectReason', label: 'Require Reject Reason', type: 'boolean' },
        { key: 'applications.reviewerMention', label: 'Mention Reviewer Roles', type: 'boolean' },
        { key: 'applications.deleteReviewMessageAfterDecision', label: 'Remove Review Message After Decision', type: 'boolean' },
        { key: 'applications.allowReviewerSnooze', label: 'Allow Reviewer Snooze', type: 'boolean' },
        { key: 'applications.formTitle', label: 'Application Form Title', type: 'string' },
        { key: 'applications.formDescription', label: 'Application Form Description', type: 'text' },
        { key: 'applications.applicationButtonLabel', label: 'Application Button Label', type: 'string' },
        { key: 'applications.questionButtonLabel', label: 'Question Answer Button Label', type: 'string' },
        { key: 'applications.snoozeButtonLabel', label: 'Snooze Button Label', type: 'string' },
        { key: 'applications.cancelButtonLabel', label: 'Cancel Button Label', type: 'string' },
        { key: 'applications.answerPlaceholder', label: 'Answer Placeholder', type: 'string' },
    ]},
    { category: 'Translation', icon: '🌐', fields: [
        { key: 'translation.enabled', label: 'Enable Translation Commands', type: 'boolean' },
        { key: 'translation.defaultSource', label: 'Default Source Language', type: 'string' },
        { key: 'translation.defaultTarget', label: 'Default Target Language', type: 'string' },
        { key: 'translation.autoEnabled', label: 'Enable Auto-Translate', type: 'boolean' },
        { key: 'translation.autoChannelIds', label: 'Auto-Translate Channels', type: 'channel-multi' },
        { key: 'translation.autoReply', label: 'Reply to Source Messages', type: 'boolean' },
        { key: 'translation.showOriginal', label: 'Show Original Text', type: 'boolean' },
        { key: 'translation.maxInputChars', label: 'Maximum Translation Input', type: 'number', min: 100, max: 12000 },
        { key: 'translation.messageTemplate', label: 'Translation Output Template', type: 'text' },
        { key: 'translation.systemPrefix', label: 'Translation Output Prefix', type: 'string' },
        { key: 'translation.preserveCodeBlocks', label: 'Preserve Code Blocks', type: 'boolean' },
        { key: 'translation.preserveMentions', label: 'Preserve Mentions and IDs', type: 'boolean' },
        { key: 'translation.preserveUrls', label: 'Preserve URLs', type: 'boolean' },
        { key: 'translation.ignoreCommands', label: 'Ignore Command-like Messages', type: 'boolean' },
        { key: 'translation.ignoreBotMessages', label: 'Ignore Bot Messages', type: 'boolean' },
        { key: 'translation.minAutoTranslateChars', label: 'Minimum Auto-Translate Characters', type: 'number', min: 1, max: 200 },
        { key: 'translation.autoCooldownMs', label: 'Auto-Translate Cooldown (ms)', type: 'number', min: 250, max: 60000 },
        { key: 'translation.duplicateSuppressionMs', label: 'Duplicate Suppression (ms)', type: 'number', min: 0, max: 120000 },
    ]},
    { category: 'AI Support', icon: '🤖', fields: [
        { key: 'aiSupport.enabled', label: 'Enable Dashboard AI Support', type: 'boolean' },
        { key: 'aiSupport.provider', label: 'Support Provider', type: 'string' },
        { key: 'aiSupport.model', label: 'Support Model', type: 'string' },
        { key: 'aiSupport.systemPrompt', label: 'Support System Prompt', type: 'text' },
        { key: 'aiSupport.maxHistory', label: 'Chat History Messages', type: 'number', min: 2, max: 40 },
    ]},
    { category: 'Ticket System', icon: '🎫', fields: [
        { key: 'ticketEnabled', label: 'Enable Tickets', type: 'boolean' },
        { key: 'ticketCategoryId', label: 'Ticket Category', type: 'string', desc: 'Category channel ID new tickets are created under.' },
        { key: 'ticketStaffRoleId', label: 'Staff Role', type: 'role' },
        { key: 'ticketExtraRoleIds', label: 'Extra Roles Added to Tickets', type: 'role-multi' },
        { key: 'ticketLogChannelId', label: 'Ticket Log Channel', type: 'channel' },
        { key: 'ticketPanelChannelId', label: 'Ticket Panel Channel', type: 'channel' },
        { key: 'ticketPingStaff', label: 'Ping Staff on New Ticket', type: 'boolean' },
        { key: 'ticketAllowReopen', label: 'Allow Reopening Last Ticket', type: 'boolean' },
        { key: 'ticketOpenMessage', label: 'In-Ticket Welcome Message', type: 'text', desc: 'Posted inside a ticket right after it\'s created. Placeholders: {user} {subject} {reason}' },
        { key: 'ticketPanel.title', label: 'Panel Title', type: 'text', desc: 'The public "click here to open a ticket" embed. See the Ticket Designer (sidebar → Moderation → Tickets) for a live Discord-style preview.' },
        { key: 'ticketPanel.description', label: 'Panel Description', type: 'text' },
        { key: 'ticketPanel.color', label: 'Panel Color', type: 'color' },
        { key: 'ticketPanel.footer', label: 'Panel Footer', type: 'text', desc: 'Defaults to "{server} Support" if left blank.' },
        { key: 'ticketPanel.buttonLabel', label: 'Button Label', type: 'text' },
        { key: 'ticketPanel.buttonStyle', label: 'Button Style', type: 'select', options: ['Primary', 'Secondary', 'Success', 'Danger'] },
        { key: 'ticketPanel.thumbnailUrl', label: 'Thumbnail Image URL', type: 'text' },
        { key: 'ticketPanel.imageUrl', label: 'Banner Image URL', type: 'text' },
    ]},
    { category: 'Welcome Messages', icon: '👋', fields: [
        { key: 'welcomeEnabled', label: 'Enable Welcome Messages', type: 'boolean' },
        { key: 'welcomeChannelId', label: 'Welcome Channel', type: 'channel' },
        { key: 'welcomeMessage', label: 'Welcome Message', type: 'text', desc: 'Placeholders: {user} {server} {count}' },
        { key: 'welcomeEmbedEnabled', label: 'Send as Embed', type: 'boolean' },
        { key: 'welcomeEmbedColor', label: 'Embed Color', type: 'color' },
        { key: 'welcomeDmEnabled', label: 'Also DM New Members', type: 'boolean' },
        { key: 'welcomeDmMessage', label: 'DM Message', type: 'text' },
    ]},    { category: 'Leave Messages', icon: '👋', fields: [
        { key: 'leaveEnabled', label: 'Enable Leave Messages', type: 'boolean' },
        { key: 'leaveChannelId', label: 'Leave Channel', type: 'channel' },
        { key: 'leaveMessage', label: 'Leave Message', type: 'text', desc: 'Placeholders: {user} {server} {count} {username} {tag} {id}' },
        { key: 'leaveEmbedEnabled', label: 'Use Leave Card / Embed', type: 'boolean' },
        { key: 'leaveEmbedColor', label: 'Fallback Embed Color', type: 'color' },
    ]},

    { category: 'Autorole', icon: '🎭', fields: [
        { key: 'autoroleIds', label: 'Roles Assigned on Join', type: 'role-multi' },
    ]},
    { category: 'Starboard', icon: '⭐', fields: [
        { key: 'starboardEnabled', label: 'Enable Starboard', type: 'boolean' },
        { key: 'starboardChannelId', label: 'Starboard Channel', type: 'channel' },
        { key: 'starboardThreshold', label: 'Star Threshold', type: 'number', min: 1 },
        { key: 'starboardEmoji', label: 'Star Emoji', type: 'string' },
        { key: 'starboardSelf', label: 'Allow Self-Starring', type: 'boolean' },
    ]},
    { category: 'Logging', icon: '📜', fields: [
        { key: 'logWebhookEnabled', label: 'Use Webhook for Logs', type: 'boolean' },
        { key: 'logWebhookUrl', label: 'Log Webhook URL', type: 'string' },
        { key: 'logEvents', label: 'Log Event Types', type: 'toggle-group', options: [
            'memberJoin', 'memberLeave', 'memberKick', 'memberTimeout', 'messageDelete', 'messageEdit',
            'voiceState', 'channelCreate', 'channelDelete', 'channelUpdate', 'roleCreate', 'roleDelete',
            'roleUpdate', 'guildBan', 'guildUnban', 'guildPrune', 'slashCommands', 'inviteCreate', 'inviteDelete',
            'emojiUpdate', 'stickerUpdate', 'boostEvent', 'guildUpdate', 'automodRule', 'scheduledEvent',
        ]},
    ]},
    { category: 'Leveling', icon: '📈', fields: [
        { key: 'leveling.enabled', label: 'Enable Leveling', type: 'boolean' },
        { key: 'leveling.curveType', label: 'XP Curve', type: 'select', options: ['linear', 'quadratic', 'exponential'], desc: 'How much XP each level needs, relative to the last. See the XP Curve page (sidebar → Leveling → XP Curve) for a live preview and admin XP tools.' },
        { key: 'leveling.baseXp', label: 'Base XP', type: 'number', min: 0 },
        { key: 'leveling.growthFactor', label: 'Growth Factor', type: 'number', min: 0, desc: 'Linear/quadratic: added per level. Exponential: percent growth per level.' },
        { key: 'leveling.xpMin', label: 'Min XP per Message', type: 'number', min: 0 },
        { key: 'leveling.xpMax', label: 'Max XP per Message', type: 'number', min: 0 },
        { key: 'leveling.cooldownSec', label: 'XP Cooldown (seconds)', type: 'number', min: 0 },
        { key: 'leveling.levelUpChannelId', label: 'Level-Up Announcement Channel', type: 'channel' },
        { key: 'leveling.levelUpMessage', label: 'Level-Up Message', type: 'text', desc: 'Placeholders: {user} {level}' },
        { key: 'leveling.roles', label: 'Level Reward Roles', type: 'levelrewards', desc: "Already manageable via /level config rolereward — this just gives you a visual editor for the same data. Grants a role automatically when a member reaches a level." },
    ]},
    { category: 'Tags', icon: '🏷️', fields: [
        { key: 'tags', label: 'Custom Tags', type: 'keyvalue', desc: 'Reusable text snippets (managed the same way as /tag create/edit/delete — this is the same data).' },
    ]},
    { category: 'Honeypot Security', icon: '🍯', fields: [
        { key: 'honeypotEnabled', label: 'Enable Honeypots', type: 'boolean' },
        { key: 'honeypotAction', label: 'Action on Trigger', type: 'select', options: ['softban', 'ban', 'kick', 'timeout'], desc: 'Softban = ban then instant unban, wiping the last hour of messages without a permanent ban.' },
        { key: 'honeypotReinvite', label: 'DM a Reinvite After', type: 'boolean', desc: 'Only applies when the action is softban or kick — sends a one-time, 7-day invite link.' },
        { key: 'honeypotLogChannelId', label: 'Honeypot Log Channel', type: 'channel' },
        { key: 'honeypotChannelIds', label: 'Honeypot Channels', type: 'channel-multi', desc: 'Any message posted here instantly triggers the configured action.' },
        { key: 'honeypotRoleId', label: 'Trap Role', type: 'role', desc: 'Granting this role to anyone (e.g. via a compromised integration) triggers the configured action.' },
        { key: 'honeypotTrapCommands', label: 'Trap Command Names', type: 'array', desc: 'Fake prefix command names — one per line. Running one triggers the configured action.' },
        { key: 'honeypotWarningMessage', label: 'Channel Warning Message', type: 'text', desc: 'Posted (and pinned) in the honeypot channel. Supports {{action:text}}, {{server:name}}, {{honeypot:channel:mention}}. Leave blank for the default.' },
        { key: 'honeypotDmMessage', label: 'DM Message', type: 'text', desc: 'Sent to whoever triggers it, before the action is taken. Supports {{user:mention}}, {{action:text}}, {{server:name}}, {{trigger:text}}. Leave blank for the default.' },
        { key: 'honeypotLogMessage', label: 'Log Message', type: 'text', desc: 'Posted in the log channel. Supports {{user:mention}}, {{user:id}}, {{action:text}}, {{trigger:text}}. Leave blank for the default.' },
    ]},
    { category: 'Bot Identity', icon: '🤖', fields: [
        { key: 'botOwnerId', label: 'Displayed Bot Owner (User ID)', type: 'string' },
        { key: 'botFooterText', label: 'Embed Footer Text', type: 'string' },
        { key: 'botInfoPublic', label: 'Make Bot Info Public', type: 'boolean' },
        { key: 'serverSetupComplete', label: 'Setup Wizard Completed', type: 'boolean', readOnly: true },
    ]},
];

// ══════════════════════════════════════════════════════════
//  Apply a settings update object against `gs`, validated field-by-field
//  against SETTINGS_SCHEMA so a client can only ever write shapes the
//  schema actually defines (no arbitrary property injection).
// ══════════════════════════════════════════════════════════
// Dot-path helpers so schema keys like 'leveling.xpMin' work against gs.leveling.xpMin
// without needing every nested system to be flattened onto gs directly.
function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}
function setPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
}
function findField(key) {
    for (const cat of SETTINGS_SCHEMA) { const f = cat.fields.find(f => f.key === key); if (f) return f; }
    return null;
}
function applySettingsUpdate(gs, updates, actor) {
    const applied = [];
    const logEntries = [];
    for (const [key, rawValue] of Object.entries(updates || {})) {
        const field = findField(key);
        if (!field || field.readOnly) continue;
        let value = rawValue;
        const before = getPath(gs, key);
        switch (field.type) {
            case 'boolean': value = !!value; break;
            case 'number': {
                const n = Number(value);
                if (!Number.isFinite(n)) continue;
                value = field.min !== undefined ? Math.max(field.min, n) : n;
                if (field.max !== undefined) value = Math.min(field.max, value);
                break;
            }
            case 'color': { const n = Number(value); if (!Number.isFinite(n)) continue; value = Math.max(0, Math.min(0xFFFFFF, n)); break; }
            case 'select': if (!field.options.includes(value)) continue; break;
            case 'string': case 'text': value = value === null ? null : String(value).slice(0, 4000); break;
            case 'array': if (!Array.isArray(value)) continue; value = value.map(String).slice(0, 500); break;
            case 'regexarray':
                if (!Array.isArray(value)) continue;
                value = value.filter(r => r && typeof r.pattern === 'string').map(r => ({ pattern: String(r.pattern).slice(0, 200), flags: String(r.flags || 'i').replace(/[^gimsuy]/g, '') || 'i' })).slice(0, 100);
                break;
            case 'channel': case 'role': value = value ? String(value) : null; break;
            case 'channel-multi': case 'role-multi': if (!Array.isArray(value)) continue; value = value.map(String).slice(0, 250); break;
            case 'toggle-group': {
                if (!value || typeof value !== 'object') continue;
                const existing = getPath(gs, key);
                const obj = existing && typeof existing === 'object' ? { ...existing } : {};
                for (const sub of field.options) if (sub in value) obj[sub] = !!value[sub];
                value = obj; break;
            }
            case 'levelrewards': {
                if (!value || typeof value !== 'object') continue;
                const obj = {};
                for (const [lvl, roleId] of Object.entries(value)) {
                    const n = parseInt(lvl, 10);
                    if (Number.isFinite(n) && n >= 1 && roleId) obj[n] = String(roleId);
                }
                value = obj; break;
            }
            case 'keyvalue': {
                // Tags specifically: preserve existing metadata (createdBy/createdAt/uses),
                // only touch `content`, and stamp new tags with who/when made them.
                if (!value || typeof value !== 'object') continue;
                const existing = getPath(gs, key) || {};
                const merged = {};
                for (const [name, content] of Object.entries(value)) {
                    const cleanName = String(name).trim().slice(0, 50);
                    if (!cleanName) continue;
                    const prior = existing[cleanName];
                    merged[cleanName] = prior
                        ? { ...prior, content: String(content).slice(0, 2000), editedAt: Date.now() }
                        : { content: String(content).slice(0, 2000), createdAt: Date.now(), uses: 0 };
                }
                value = merged; break;
            }
            default: continue;
        }
        setPath(gs, key, value);
        applied.push(key);
        logEntries.push({ key, label: field.label, category: findCategoryFor(key), before: summarizeForLog(before), after: summarizeForLog(value), at: Date.now(), by: actor?.id || null, byName: actor?.username || null });
    }
    if (logEntries.length) {
        gs.settingsAuditLog = Array.isArray(gs.settingsAuditLog) ? gs.settingsAuditLog : [];
        gs.settingsAuditLog.push(...logEntries);
        if (gs.settingsAuditLog.length > 200) gs.settingsAuditLog = gs.settingsAuditLog.slice(-200);
    }
    return applied;
}
function findCategoryFor(key) {
    for (const cat of SETTINGS_SCHEMA) if (cat.fields.some(f => f.key === key)) return cat.category;
    return null;
}
// Keeps audit log entries small and readable — big blobs (arrays/objects) get
// reduced to a size summary instead of dumping the full before/after value.
function summarizeForLog(v) {
    if (v === null || v === undefined) return null;
    if (Array.isArray(v)) return `[${v.length} item${v.length === 1 ? '' : 's'}]`;
    if (typeof v === 'object') return `{${Object.keys(v).length} key${Object.keys(v).length === 1 ? '' : 's'}}`;
    if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '…' : v;
    return v;
}

// ══════════════════════════════════════════════════════════
//  startDashboard(deps) — call this from DISCOMOD.js once, behind
//  DASHBOARD_ENABLED=true. Never throws past this point in a way that
//  could take the bot process down — all route handlers are wrapped.
// ══════════════════════════════════════════════════════════
function startDashboard(deps) {
    if (process.env.DASHBOARD_ENABLED !== 'true') return null;
    const missing = [];
    if (!CLIENT_ID) missing.push('CLIENT_ID');
    if (!CLIENT_SECRET) missing.push('CLIENT_SECRET');
    if (!SESSION_SECRET) missing.push('DASHBOARD_SESSION_SECRET');
    if (missing.length) { console.error(`[dashboard] Not starting — missing env vars: ${missing.join(', ')}`); return null; }
    if (!deps || !deps.client || !deps.loadData || !deps.saveData || !deps.getGuildSettings) {
        console.error('[dashboard] Not starting — startDashboard(deps) needs { client, loadData, saveData, getGuildSettings }.');
        return null;
    }

    const app = express();
    // Set DASHBOARD_TRUST_PROXY=true if running behind nginx/Caddy/a load balancer,
    // so req.secure and the real client IP (for rate limiting) reflect X-Forwarded-*
    // headers instead of the proxy's own connection.
    if (process.env.DASHBOARD_TRUST_PROXY === 'true') app.set('trust proxy', 1);
    app.use(express.json({ limit: '256kb' }));
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        next();
    });

    function wrap(fn) { return (req, res) => Promise.resolve(fn(req, res)).catch(err => { console.error('[dashboard] route error:', err); if (!res.headersSent) res.status(500).send('Internal error.'); }); }

    // ── Tiny TTL cache for expensive aggregate reads (leaderboard/overview
    // iterate every member or every tracked user — cheap for small servers,
    // worth caching briefly for large ones). Not used for anything that must
    // be instantly fresh after a write (settings, reaction roles, etc.).
    const _cache = new Map();
    function cached(key, ttlMs, compute) {
        const hit = _cache.get(key);
        if (hit && Date.now() - hit.at < ttlMs) return hit.value;
        const value = compute();
        _cache.set(key, { value, at: Date.now() });
        return value;
    }

    // ── Simple in-memory rate limiter (no extra dependency) for auth routes ──
    const rateBuckets = new Map();
    function rateLimit(maxRequests, windowMs) {
        return (req, res, next) => {
            const key = req.ip || req.socket.remoteAddress || 'unknown';
            const now = Date.now();
            const hits = (rateBuckets.get(key) || []).filter(t => now - t < windowMs);
            if (hits.length >= maxRequests) return res.status(429).send('Too many requests — please wait a moment and try again.');
            hits.push(now);
            rateBuckets.set(key, hits);
            next();
        };
    }

    // ── Auth middleware (refresh-aware) ─────────────────────────────
    function readSession(req) {
        const cookies = parseCookies(req);
        return verifySession(cookies.dm_session);
    }
    async function requirePage(req, res, next) {
        let session = readSession(req);
        if (!session) return res.redirect('/');
        req.user = await ensureFreshSession(deps, req, res, session);
        next();
    }
    async function requireApi(req, res, next) {
        let session = readSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated.' });
        req.user = await ensureFreshSession(deps, req, res, session);
        next();
    }
    async function requireGuildAccess(req, res, next) {
        const ok = await canManageGuild(deps, req.user.id, req.params.guildId);
        if (!ok) return req.path.startsWith('/api/') ? res.status(403).json({ error: 'You do not have access to this server.' }) : res.status(403).send('You do not have access to this server.');
        next();
    }

    // Serves style.css / script.js and any other static assets in dashboard-public/.
    // index.html is NOT auto-served by this (no `index: true` default triggered here
    // because we explicitly send it per-route below) — every page route hands back
    // the same shell; the client router in script.js decides what to render based
    // on window.location.pathname. This is what actually turns "one big inline
    // HTML-string-per-route" into real separate index.html / style.css / script.js files.
    //
    // /verify/:token is served from this SAME shell too — script.js branches into a
    // completely separate unauthenticated code path for that route (runVerifyPage())
    // before the admin router ever runs. One index.html, one style.css, one script.js
    // for the whole app, admin and public verification alike.
    const PUBLIC_DIR = path.join(__dirname, 'dashboard-public');
    app.use(express.static(PUBLIC_DIR, { index: false }));
    function sendApp(res) { res.sendFile(path.join(PUBLIC_DIR, 'index.html')); }

    app.get('/verify/:token', rateLimit(60, 60 * 1000), wrap((req, res) => sendApp(res)));

    // Public metadata for a given token: per-guild customization + whether
    // CAPTCHA is actually configured. No auth beyond "you have the token" —
    // that's the whole point, this is what the DM'd/replied link carries.
    // ── Interactive CAPTCHA config — mode/challengeCount/timing/lockout.
    // Bespoke routes (not the generic schema) since 'mode' needs its own
    // validated enum and the numeric fields each need their own bounds,
    // same reasoning as AutoMod/Honeypot's dedicated routes elsewhere.
    app.get('/api/guilds/:guildId/verify/captcha', requireApi, requireGuildAccess, wrap((req, res) => {
        const gs = deps.getGuildSettings(req.params.guildId, deps.loadData());
        res.json({ config: getCaptchaConfig(gs), turnstileConfigured: !!TURNSTILE_SITE_KEY });
    }));
    app.post('/api/guilds/:guildId/verify/captcha', requireApi, requireGuildAccess, rateLimit(20, 60 * 1000), wrap((req, res) => {
        const body = req.body || {};
        const mode = body.mode;
        if (!['off', 'interactive', 'turnstile', 'both'].includes(mode)) return res.status(400).json({ error: "mode must be 'off', 'interactive', 'turnstile', or 'both'." });
        const challengeCount = Number(body.challengeCount);
        if (!Number.isInteger(challengeCount) || challengeCount < 1 || challengeCount > 5) return res.status(400).json({ error: 'challengeCount must be an integer from 1 to 5.' });
        const timeLimitSec = Number(body.timeLimitSec);
        if (!Number.isFinite(timeLimitSec) || timeLimitSec < 15 || timeLimitSec > 180) return res.status(400).json({ error: 'timeLimitSec must be between 15 and 180.' });
        const maxAttempts = Number(body.maxAttempts);
        if (!Number.isInteger(maxAttempts) || maxAttempts < 3 || maxAttempts > 15) return res.status(400).json({ error: 'maxAttempts must be an integer from 3 to 15.' });
        const cooldownSec = Number(body.cooldownSec);
        if (!Number.isFinite(cooldownSec) || cooldownSec < 15 || cooldownSec > 1800) return res.status(400).json({ error: 'cooldownSec must be between 15 and 1800.' });
        const guildId = req.params.guildId;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        gs.verifyCaptcha = { mode, challengeCount, timeLimitSec, maxAttempts, cooldownSec };
        deps.saveData(freshData);
        res.json({ ok: true, config: getCaptchaConfig(gs), turnstileConfigured: !!TURNSTILE_SITE_KEY });
    }));

    app.get('/api/verify/:token/meta', rateLimit(60, 60 * 1000), wrap((req, res) => {
        const freshData = deps.loadData();
        const rec = freshData.webVerifyTokens?.[req.params.token];
        if (!rec || rec.usedAt || Date.now() > rec.expiresAt) {
            return res.status(410).json({ error: 'This verification link is invalid, already used, or has expired. Go back to Discord and click Verify again for a fresh one.' });
        }
        const guild = deps.client.guilds.cache.get(rec.guildId);
        if (!guild) return res.status(404).json({ error: 'Server not found.' });
        const gs = deps.getGuildSettings(rec.guildId, freshData);
        const wv = gs.verifyWeb || {};
        const captcha = getCaptchaConfig(gs);
        // 'turnstile'/'both' modes only actually apply if the bot operator has
        // Turnstile env vars set — if not, fall back honestly to whatever
        // interactive gives, rather than silently pretending Turnstile ran.
        const turnstileReallyAvailable = !!TURNSTILE_SITE_KEY;
        const effectiveMode = (captcha.mode === 'turnstile' && !turnstileReallyAvailable) ? 'off'
            : (captcha.mode === 'both' && !turnstileReallyAvailable) ? 'interactive'
            : captcha.mode;
        res.json({
            guildName: guild.name,
            guildIconUrl: guild.iconURL({ size: 128 }) || null,
            title: wv.title || `Verify to join ${guild.name}`,
            description: wv.description || 'Complete the check below to unlock the rest of the server.',
            backgroundUrl: wv.backgroundUrl || null,
            musicUrl: wv.musicUrl || null,
            accentColor: wv.accentColor != null ? `#${Number(wv.accentColor).toString(16).padStart(6, '0')}` : '#2DE0C4',
            turnstileEnabled: !!TURNSTILE_SITE_KEY && (effectiveMode === 'turnstile' || effectiveMode === 'both'),
            turnstileSiteKey: TURNSTILE_SITE_KEY || null,
            interactiveCaptcha: (effectiveMode === 'interactive' || effectiveMode === 'both') ? {
                required: captcha.challengeCount,
                passed: rec.captchaPassed || 0,
                timeLimitSec: captcha.timeLimitSec,
                lockedUntil: (rec.captchaLockedUntil && rec.captchaLockedUntil > Date.now()) ? rec.captchaLockedUntil : null,
            } : null,
        });
    }));

    // Fresh interactive challenge for a given (still-valid) verify token —
    // enforces the per-token attempt limit/cooldown so this can't be
    // brute-forced by just requesting endless new challenges either.
    app.get('/api/verify/:token/captcha/new', rateLimit(60, 60 * 1000), wrap((req, res) => {
        const freshData = deps.loadData();
        const rec = freshData.webVerifyTokens?.[req.params.token];
        if (!rec || rec.usedAt || Date.now() > rec.expiresAt) return res.status(410).json({ error: 'This verification link is invalid, already used, or has expired.' });
        const gs = deps.getGuildSettings(rec.guildId, freshData);
        const captcha = getCaptchaConfig(gs);
        if (captcha.mode !== 'interactive' && captcha.mode !== 'both') return res.status(400).json({ error: 'Interactive CAPTCHA is not enabled for this server.' });
        if (rec.captchaLockedUntil && rec.captchaLockedUntil > Date.now()) {
            return res.status(429).json({ error: `Too many incorrect attempts — try again in ${Math.ceil((rec.captchaLockedUntil - Date.now()) / 1000)}s.`, lockedUntil: rec.captchaLockedUntil });
        }
        if ((rec.captchaPassed || 0) >= captcha.challengeCount) return res.status(400).json({ error: 'You have already completed the CAPTCHA for this link.' });
        const challenge = generateCaptchaChallenge();
        if (!challenge) return res.status(500).json({ error: 'Could not generate a challenge right now — please refresh and try again.' });
        const challengeToken = randomState();
        _captchaChallenges.set(challengeToken, {
            verifyToken: req.params.token, correctId: challenge.correctId, altPrompt: challenge.altPrompt,
            expiresAt: Date.now() + captcha.timeLimitSec * 1000,
        });
        res.json({
            challengeToken, promptText: challenge.promptText, shapes: challenge.shapes,
            canvasWidth: CAPTCHA_CANVAS_W, canvasHeight: CAPTCHA_CANVAS_H,
            timeLimitSec: captcha.timeLimitSec,
            progress: { current: (rec.captchaPassed || 0) + 1, total: captcha.challengeCount },
        });
    }));

    // Validates one challenge answer — either a clicked shape id (visual
    // mode) or a typed word (accessible mode: the prompt's own phrasing,
    // e.g. "the largest shape" — genuinely solvable without seeing the
    // image, since it's read directly off the shape the visual mode would
    // have you click, not a separate secret).
    app.post('/api/verify/:token/captcha/answer', rateLimit(60, 60 * 1000), wrap((req, res) => {
        const freshData = deps.loadData();
        const rec = freshData.webVerifyTokens?.[req.params.token];
        if (!rec || rec.usedAt || Date.now() > rec.expiresAt) return res.status(410).json({ error: 'This verification link is invalid, already used, or has expired.' });
        const gs = deps.getGuildSettings(rec.guildId, freshData);
        const captcha = getCaptchaConfig(gs);
        if (rec.captchaLockedUntil && rec.captchaLockedUntil > Date.now()) {
            return res.status(429).json({ error: `Too many incorrect attempts — try again in ${Math.ceil((rec.captchaLockedUntil - Date.now()) / 1000)}s.`, lockedUntil: rec.captchaLockedUntil });
        }
        const { challengeToken, shapeId, textAnswer } = req.body || {};
        const chal = challengeToken && _captchaChallenges.get(challengeToken);
        if (!chal || chal.verifyToken !== req.params.token) return res.status(400).json({ error: 'That challenge has expired or is invalid — a new one has been requested.' });
        _captchaChallenges.delete(challengeToken); // single use either way, win or lose
        const expired = Date.now() > chal.expiresAt;
        const correct = !expired && (
            (shapeId && shapeId === chal.correctId) ||
            (textAnswer && String(textAnswer).trim().toLowerCase() === chal.altPrompt.toLowerCase())
        );
        if (!correct) {
            rec.captchaAttempts = (rec.captchaAttempts || 0) + 1;
            if (rec.captchaAttempts >= captcha.maxAttempts) {
                rec.captchaLockedUntil = Date.now() + captcha.cooldownSec * 1000;
                rec.captchaAttempts = 0;
                deps.saveData(freshData);
                return res.status(429).json({ error: `Too many incorrect attempts. Try again in ${captcha.cooldownSec}s.`, lockedUntil: rec.captchaLockedUntil });
            }
            deps.saveData(freshData);
            return res.status(400).json({ error: expired ? 'That challenge timed out — here\'s a new one.' : 'Not quite — try again.', attemptsLeft: captcha.maxAttempts - rec.captchaAttempts });
        }
        rec.captchaPassed = (rec.captchaPassed || 0) + 1;
        deps.saveData(freshData);
        res.json({ ok: true, passed: rec.captchaPassed, required: captcha.challengeCount, done: rec.captchaPassed >= captcha.challengeCount });
    }));

    app.post('/api/verify/:token/submit', rateLimit(20, 60 * 1000), wrap(async (req, res) => {
        const freshData = deps.loadData();
        const rec = freshData.webVerifyTokens?.[req.params.token];
        if (!rec || rec.usedAt || Date.now() > rec.expiresAt) {
            return res.status(410).json({ error: 'This verification link is invalid, already used, or has expired.' });
        }
        const gs = deps.getGuildSettings(rec.guildId, freshData);
        const captcha = getCaptchaConfig(gs);
        const effectiveMode = (captcha.mode === 'turnstile' && !TURNSTILE_SITE_KEY) ? 'off'
            : (captcha.mode === 'both' && !TURNSTILE_SITE_KEY) ? 'interactive'
            : captcha.mode;
        if (effectiveMode === 'interactive' || effectiveMode === 'both') {
            if ((rec.captchaPassed || 0) < captcha.challengeCount) {
                return res.status(400).json({ error: 'Please complete the CAPTCHA challenges first.' });
            }
        }
        if (TURNSTILE_SECRET_KEY && (effectiveMode === 'turnstile' || effectiveMode === 'both')) {
            const turnstileToken = req.body?.turnstileToken;
            if (!turnstileToken) return res.status(400).json({ error: 'CAPTCHA response missing.' });
            const verifyResp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ secret: TURNSTILE_SECRET_KEY, response: turnstileToken, remoteip: req.ip }),
            }).then(r => r.json()).catch(() => ({ success: false }));
            if (!verifyResp.success) return res.status(400).json({ error: 'CAPTCHA check failed. Please try again.' });
        }
        const guild = deps.client.guilds.cache.get(rec.guildId);
        if (!guild) return res.status(404).json({ error: 'Server not found — the bot may have left.' });
        if (!gs.verify?.roleId) return res.status(409).json({ error: 'Verification is not configured on this server anymore.' });
        const member = await guild.members.fetch(rec.userId).catch(() => null);
        if (!member) return res.status(404).json({ error: "You don't appear to be a member of this server anymore." });
        try {
            await member.roles.add(gs.verify.roleId, 'Web verification completed');
        } catch (e) {
            return res.status(500).json({ error: `Could not assign your role — the bot may be missing permissions. (${e.message})` });
        }
        rec.usedAt = Date.now();
        deps.saveData(freshData);
        res.json({ ok: true });
    }));

    // ── Public routes ────────────────────────────────────────────────
    app.get('/', wrap((req, res) => {
        if (readSession(req)) return res.redirect('/dashboard');
        sendApp(res);
    }));
    app.get('/auth/login', rateLimit(20, 60 * 1000), wrap((req, res) => {
        const state = randomState();
        setCookie(res, 'dm_state', state, { maxAge: 600, secure: cookieSecureFor(req) });
        res.redirect(loginUrl(state));
    }));
    app.get('/auth/callback', rateLimit(20, 60 * 1000), wrap(async (req, res) => {
        const { code, state } = req.query;
        const cookies = parseCookies(req);
        if (!code || !state || state !== cookies.dm_state) return res.status(400).send('Invalid or expired login attempt — please try signing in again.');
        clearCookie(res, 'dm_state');
        const token = await exchangeCodeForToken(code);
        const [discordUser, oauthGuilds] = await Promise.all([fetchDiscordUser(token.access_token), fetchDiscordUserGuilds(token.access_token)]);
        const { manageableIds, addable } = await computeGuildLists(deps, discordUser.id, oauthGuilds);
        const session = signSession(buildSessionPayload(discordUser, token, manageableIds, addable));
        setCookie(res, 'dm_session', session, { maxAge: SESSION_MAX_AGE_SEC, secure: cookieSecureFor(req) });
        res.redirect('/dashboard');
    }));
    app.get('/auth/logout', wrap((req, res) => { clearCookie(res, 'dm_session'); res.redirect('/'); }));

    // ── Dashboard pages (all served by the SPA shell — see dashboard-public/script.js) ──
    app.get('/dashboard', requirePage, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/settings', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/leaderboard', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/cases', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/tags', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/activity', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/bloxfruits', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/commands', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/setup', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/reaction-roles', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/tickets', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/exile', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/automod', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/honeypot', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/appeals', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/appeal-form', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/carry', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/domains', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/verification', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/cards', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/leave', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/invites', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/math', requirePage, wrap((req, res) => { if (!deps.isSuperUser?.(req.user.id)) return res.status(403).send('Owner only.'); sendApp(res); }));
    app.get('/dashboard/:guildId/xpcurve', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/ticketdesigner', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/beli', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/commandmanager', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/applications', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/translation', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/ai-support', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));
    app.get('/dashboard/:guildId/members', requirePage, requireGuildAccess, wrap((req, res) => sendApp(res)));

    // ── API ───────────────────────────────────────────────────────────
    // Current user + the guild picker's two lists — powers the picker page and
    // the top bar's user chip without ever server-rendering HTML for them.
    app.get('/api/me', requireApi, wrap((req, res) => {
        const manageableGuilds = [];
        for (const id of req.user.manageableIds || []) {
            const guild = deps.client.guilds.cache.get(id);
            if (guild) manageableGuilds.push({ id: guild.id, name: guild.name, icon: guild.icon, memberCount: guild.memberCount });
        }
        res.json({
            user: { id: req.user.id, username: req.user.username, avatarUrl: req.user.avatarUrl, superUser: !!deps.isSuperUser?.(req.user.id) },
            manageableGuilds,
            addableGuilds: (req.user.addable || []).map(g => ({ ...g, inviteUrl: botInviteUrl(g.id) })),
        });
    }));
    // Field schema that drives the settings form — single source of truth stays
    // server-side (SETTINGS_SCHEMA above); the client fetches it instead of a
    // second hardcoded copy, the same fix applied to DISCOMOD.js's AI model list.
    app.get('/api/schema', wrap((req, res) => res.json(SETTINGS_SCHEMA)));
    app.get('/api/guilds/:guildId/meta', requireApi, requireGuildAccess, wrap((req, res) => {
        const guild = deps.client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.status(404).json({ error: 'Server not found.' });
        const channels = guild.channels.cache.filter(c => c.isTextBased && c.isTextBased()).map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
        const roles = guild.roles.cache.filter(r => r.id !== guild.id).map(r => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name));
        res.json({ channels, roles });
    }));

    // ── Global domain allowlist reference — READ-ONLY browser for the bot's
    // own built-in trusted-domain list (COMMON_ALLOWED_DOMAINS, a code
    // constant shared by every guild, not something any one guild can edit).
    // The per-guild allowlist (gs.linkAllowlistedDomains) already has a
    // working editor via the generic settings schema (Security page,
    // "Allowed Domains" array field) — this is additive, not a replacement:
    // it cross-references the guild's own list against the global one so
    // staff can see when they've redundantly added something already
    // globally trusted, without needing a second array editor here.
    app.get('/api/guilds/:guildId/domains/allowlist', requireApi, requireGuildAccess, wrap((req, res) => {
        if (!deps.commonAllowedDomains) return res.status(501).json({ error: 'Not supported by this bot version.' });
        const gs = deps.getGuildSettings(req.params.guildId, deps.loadData());
        const guildDomains = Array.isArray(gs.linkAllowlistedDomains) ? gs.linkAllowlistedDomains : [];
        res.json({
            domains: deps.commonAllowedDomains,
            guildDomains: guildDomains.map(d => ({ domain: d, redundant: deps.domainInList(d, deps.commonAllowedDomains) })),
        });
    }));

    // ── Overview: aggregate stats for the new dashboard home page ──────
    app.get('/api/guilds/:guildId/overview', requireApi, requireGuildAccess, rateLimit(30, 60 * 1000), wrap((req, res) => {
        const guildId = req.params.guildId;
        const guild = deps.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Server not found.' });
        const payload = cached(`overview:${guildId}`, 15000, () => {
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);

        // Last 30 days of message activity (deps.loadData()'s own msgStats bucket, if the bot tracks it).
        const msgStats = (freshData.msgStats && freshData.msgStats[guildId]) || {};
        const last30 = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date(Date.now() - i * 86400000);
            const key = d.toISOString().slice(0, 10);
            last30.push({ date: key, count: msgStats[key] || 0 });
        }

        // Total violations ever logged against members of THIS guild (single pass; violations
        // are stored globally per-user, each history entry tagged with the guildId it happened in).
        let totalViolations = 0;
        if (freshData.violations && typeof deps.getViolationHistory === 'function') {
            for (const uid of Object.keys(freshData.violations)) {
                totalViolations += deps.getViolationHistory(freshData, uid).filter(h => h.guildId === guildId).length;
            }
        }

        // Top 5 leveling preview.
        let topLevelUsers = [];
        if (typeof deps.buildLevelLeaderboard === 'function') {
            const cfg = deps.getLevelingConfig ? deps.getLevelingConfig(gs) : null;
            topLevelUsers = deps.buildLevelLeaderboard(freshData, guildId).slice(0, 5).map(row => {
                const member = guild.members.cache.get(row.uid);
                return {
                    uid: row.uid, xp: row.xp,
                    level: cfg && deps.computeLevelFromXp ? deps.computeLevelFromXp(cfg, row.xp).level : null,
                    displayName: member ? (member.displayName || member.user.username) : null,
                    avatarUrl: member ? member.displayAvatarURL({ size: 32 }) : null,
                };
            });
        }

        return {
            guild: { id: guild.id, name: guild.name, memberCount: guild.memberCount },
            last30DaysActivity: last30,
            totalViolations,
            topLevelUsers,
            recentAuditEntries: (gs.settingsAuditLog || []).slice(-5).reverse(),
            tagCount: Object.keys(gs.tags || {}).length,
            reactionRoleMessageCount: Object.keys(gs.reactionRoles || {}).length,
        };
        });
        res.json(payload);
    }));

    // ── Leveling leaderboard ─────────────────────────────────────────
    app.get('/api/guilds/:guildId/leaderboard', requireApi, requireGuildAccess, rateLimit(30, 60 * 1000), wrap((req, res) => {
        const guildId = req.params.guildId;
        const guild = deps.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Server not found.' });
        if (typeof deps.buildLevelLeaderboard !== 'function') return res.json({ rows: [], enabled: false });
        const payload = cached(`leaderboard:${guildId}`, 15000, () => {
            const freshData = deps.loadData();
            const gs = deps.getGuildSettings(guildId, freshData);
            const cfg = deps.getLevelingConfig ? deps.getLevelingConfig(gs) : null;
            const rows = deps.buildLevelLeaderboard(freshData, guildId).slice(0, 50).map((row, i) => {
                const member = guild.members.cache.get(row.uid);
                const levelInfo = cfg && deps.computeLevelFromXp ? deps.computeLevelFromXp(cfg, row.xp) : null;
                return {
                    rank: i + 1, uid: row.uid, xp: row.xp,
                    level: levelInfo ? levelInfo.level : null,
                    xpIntoLevel: levelInfo ? levelInfo.xpIntoLevel : null,
                    xpForNextLevel: levelInfo ? levelInfo.xpForNextLevel : null,
                    displayName: member ? (member.displayName || member.user.username) : `Unknown (${row.uid})`,
                    avatarUrl: member ? member.displayAvatarURL({ size: 64 }) : null,
                };
            });
            return { rows, enabled: !!gs.leveling?.enabled };
        });
        res.json(payload);
    }));

    // ── Case / violation history lookup ─────────────────────────────
    app.get('/api/guilds/:guildId/cases/:userId', requireApi, requireGuildAccess, rateLimit(60, 60 * 1000), wrap((req, res) => {
        const { guildId, userId } = req.params;
        if (!/^\d{15,25}$/.test(userId)) return res.status(400).json({ error: 'That doesn\'t look like a valid Discord user ID.' });
        if (typeof deps.getViolationHistory !== 'function') return res.json({ count: 0, history: [] });
        const freshData = deps.loadData();
        const fullHistory = deps.getViolationHistory(freshData, userId);
        const scoped = fullHistory.filter(h => !h.guildId || h.guildId === guildId);
        const member = deps.client.guilds.cache.get(guildId)?.members.cache.get(userId);
        res.json({
            uid: userId,
            displayName: member ? (member.displayName || member.user.username) : null,
            avatarUrl: member ? member.displayAvatarURL({ size: 64 }) : null,
            count: deps.getViolationCount ? deps.getViolationCount(freshData, userId) : scoped.length,
            history: scoped.slice().reverse(),
        });
    }));

    // ── Settings audit log ───────────────────────────────────────────
    app.get('/api/guilds/:guildId/activity-log', requireApi, requireGuildAccess, wrap((req, res) => {
        const gs = deps.getGuildSettings(req.params.guildId, deps.loadData());
        res.json({ entries: (gs.settingsAuditLog || []).slice().reverse() });
    }));

    // ── Case actions — these mutate the user's GLOBAL violation record
    // (violations aren't stored per-guild), so both routes return a scope
    // warning the client surfaces before/after the action. ──────────────
    app.post('/api/guilds/:guildId/cases/:userId/decrement', requireApi, requireGuildAccess, rateLimit(20, 60 * 1000), wrap((req, res) => {
        if (typeof deps.decrementViolationEntry !== 'function') return res.status(501).json({ error: 'Not supported by this bot version.' });
        const freshData = deps.loadData();
        const newCount = deps.decrementViolationEntry(freshData, req.params.userId);
        deps.saveData(freshData);
        res.json({ ok: true, newCount, scopeWarning: 'This affects the user\'s violation count across every server the bot moderates, not just this one.' });
    }));
    app.post('/api/guilds/:guildId/cases/:userId/clear', requireApi, requireGuildAccess, rateLimit(10, 60 * 1000), wrap((req, res) => {
        if (typeof deps.clearViolationEntry !== 'function') return res.status(501).json({ error: 'Not supported by this bot version.' });
        const freshData = deps.loadData();
        deps.clearViolationEntry(freshData, req.params.userId);
        deps.saveData(freshData);
        res.json({ ok: true, scopeWarning: 'This wiped ALL violation history for this user across every server the bot moderates, not just this one.' });
    }));

    // ── Settings export / import — plain JSON snapshot of everything the
    // schema knows about, so a config can be backed up or copied to another
    // server. Import goes through the same applySettingsUpdate validation
    // as a normal save, field by field — it can't write anything a manual
    // edit couldn't. ─────────────────────────────────────────────────────
    app.get('/api/guilds/:guildId/export', requireApi, requireGuildAccess, wrap((req, res) => {
        const gs = deps.getGuildSettings(req.params.guildId, deps.loadData());
        const snapshot = {};
        for (const cat of SETTINGS_SCHEMA) for (const f of cat.fields) if (!f.readOnly) snapshot[f.key] = getPath(gs, f.key);
        res.json({ exportedAt: Date.now(), guildId: req.params.guildId, settings: snapshot });
    }));
    app.post('/api/guilds/:guildId/import', requireApi, requireGuildAccess, rateLimit(10, 60 * 1000), wrap((req, res) => {
        const incoming = req.body && req.body.settings;
        if (!incoming || typeof incoming !== 'object') return res.status(400).json({ error: 'Missing "settings" object in import payload.' });
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(req.params.guildId, freshData);
        const applied = applySettingsUpdate(gs, incoming, req.user);
        deps.saveData(freshData);
        res.json({ ok: true, appliedCount: applied.length, skippedCount: Object.keys(incoming).length - applied.length });
    }));

    // ── Tags manager (sorted by usage — a friendlier lens on the same data
    // the generic 'keyvalue' Tags settings field edits) ─────────────────
    app.get('/api/guilds/:guildId/tags', requireApi, requireGuildAccess, wrap((req, res) => {
        const gs = deps.getGuildSettings(req.params.guildId, deps.loadData());
        const tags = Object.entries(gs.tags || {}).map(([name, t]) => ({
            name, content: t?.content ?? '', uses: t?.uses || 0, createdAt: t?.createdAt || null, createdBy: t?.createdBy || null, editedAt: t?.editedAt || null,
        })).sort((a, b) => b.uses - a.uses);
        res.json({ tags });
    }));
    app.delete('/api/guilds/:guildId/tags/:name', requireApi, requireGuildAccess, wrap((req, res) => {
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(req.params.guildId, freshData);
        if (!gs.tags || !gs.tags[req.params.name]) return res.status(404).json({ error: 'Tag not found.' });
        delete gs.tags[req.params.name];
        gs.settingsAuditLog = Array.isArray(gs.settingsAuditLog) ? gs.settingsAuditLog : [];
        gs.settingsAuditLog.push({ key: 'tags', label: 'Custom Tags', category: 'Tags', before: `deleted "${req.params.name}"`, after: null, at: Date.now(), by: req.user.id, byName: req.user.username });
        if (gs.settingsAuditLog.length > 200) gs.settingsAuditLog = gs.settingsAuditLog.slice(-200);
        deps.saveData(freshData);
        res.json({ ok: true });
    }));

    // ── Tickets — live view of the same data.tickets[guildId] map the bot's
    // ticket buttons read/write. Claim/unclaim/close call the exact same
    // shared helpers as the in-Discord buttons (passed in via deps), so
    // acting from the dashboard behaves identically to acting in the
    // ticket channel — no separate code path to drift out of sync. ──────
    app.get('/api/guilds/:guildId/tickets', requireApi, requireGuildAccess, wrap((req, res) => {
        if (typeof deps.getTickets !== 'function') return res.json({ open: [], closed: [] });
        const guildId = req.params.guildId;
        const freshData = deps.loadData();
        const guild = deps.client.guilds.cache.get(guildId);
        const all = Object.entries(deps.getTickets(freshData, guildId)).map(([channelId, t]) => {
            const member = guild?.members.cache.get(t.userId);
            const claimant = t.claimedBy ? guild?.members.cache.get(t.claimedBy) : null;
            return {
                channelId,
                channelExists: !!guild?.channels.cache.has(channelId),
                subject: t.subject || '', reason: t.reason || '',
                status: t.status || 'open',
                userId: t.userId || null,
                userTag: member ? (member.user.tag || member.user.username) : null,
                claimedBy: t.claimedBy || null,
                claimedByTag: claimant ? (claimant.user.tag || claimant.user.username) : null,
                createdAt: t.createdAt || null, closedAt: t.closedAt || null,
                closedBy: t.closedBy || null, closeReason: t.closeReason || null,
            };
        }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        res.json({
            open: all.filter(t => t.status !== 'closed'),
            closed: all.filter(t => t.status === 'closed').slice(0, 30),
        });
    }));
    app.post('/api/guilds/:guildId/tickets/:channelId/claim', requireApi, requireGuildAccess, rateLimit(30, 60 * 1000), wrap(async (req, res) => {
        if (typeof deps.getTickets !== 'function') return res.status(501).json({ error: 'Not supported by this bot version.' });
        const { guildId, channelId } = req.params;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        const tInfo = deps.getTickets(freshData, guildId)[channelId];
        if (!tInfo) return res.status(404).json({ error: 'Ticket not found.' });
        if (tInfo.status === 'closed') return res.status(409).json({ error: 'This ticket is already closed.' });
        tInfo.claimedBy = req.user.id;
        deps.saveData(freshData);
        const guild = deps.client.guilds.cache.get(guildId);
        const channel = guild?.channels.cache.get(channelId);
        if (guild && channel) {
            if (typeof deps.getTicketStaffRoleIds === 'function') {
                const staffRoleIds = deps.getTicketStaffRoleIds(gs);
                for (const [mId, m] of guild.members.cache) {
                    if (mId === req.user.id || mId === tInfo.userId || mId === deps.client.user.id) continue;
                    if (staffRoleIds.some(rid => m.roles.cache.has(rid))) await channel.permissionOverwrites.edit(mId, { ViewChannel: false }).catch(() => {});
                }
            }
            await channel.permissionOverwrites.edit(req.user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
            await channel.send({ content: `🙋 <@${req.user.id}> claimed this ticket from the dashboard. All other staff have been removed — only <@${req.user.id}> and <@${tInfo.userId}> remain.` }).catch(() => {});
        }
        res.json({ ok: true, claimedBy: { id: req.user.id, tag: req.user.username } });
    }));
    app.post('/api/guilds/:guildId/tickets/:channelId/unclaim', requireApi, requireGuildAccess, rateLimit(30, 60 * 1000), wrap(async (req, res) => {
        if (typeof deps.getTickets !== 'function') return res.status(501).json({ error: 'Not supported by this bot version.' });
        const { guildId, channelId } = req.params;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        const tInfo = deps.getTickets(freshData, guildId)[channelId];
        if (!tInfo) return res.status(404).json({ error: 'Ticket not found.' });
        if (!tInfo.claimedBy) return res.status(409).json({ error: 'This ticket is not currently claimed.' });
        const prevClaimant = tInfo.claimedBy;
        tInfo.claimedBy = null;
        deps.saveData(freshData);
        const guild = deps.client.guilds.cache.get(guildId);
        const channel = guild?.channels.cache.get(channelId);
        if (guild && channel && typeof deps.getTicketStaffRoleIds === 'function') {
            for (const rid of deps.getTicketStaffRoleIds(gs)) {
                await channel.permissionOverwrites.edit(rid, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
            }
            await channel.send({ content: `🙌 <@${prevClaimant}> unclaimed this ticket from the dashboard. All staff can view and respond again.` }).catch(() => {});
        }
        res.json({ ok: true });
    }));
    app.post('/api/guilds/:guildId/tickets/:channelId/close', requireApi, requireGuildAccess, rateLimit(20, 60 * 1000), wrap(async (req, res) => {
        if (typeof deps.performTicketClose !== 'function' || typeof deps.getTickets !== 'function') return res.status(501).json({ error: 'Not supported by this bot version.' });
        const { guildId, channelId } = req.params;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        const tInfo = deps.getTickets(freshData, guildId)[channelId];
        if (!tInfo) return res.status(404).json({ error: 'Ticket not found.' });
        if (tInfo.status === 'closed') return res.status(409).json({ error: 'This ticket is already closed.' });
        const guild = deps.client.guilds.cache.get(guildId);
        const channel = guild?.channels.cache.get(channelId);
        if (!guild || !channel) return res.status(404).json({ error: 'That ticket channel no longer exists.' });
        tInfo.status = 'closed'; deps.saveData(freshData); // mark closed immediately, same guard the button uses against a double-click race
        const reason = (req.body && req.body.reason) ? String(req.body.reason).slice(0, 300) : `Closed from dashboard by ${req.user.username}`;
        await deps.performTicketClose(guild, channel, tInfo, gs, freshData, req.user.id, reason);
        res.json({ ok: true });
    }));

    // ── Exile — data.exiles is keyed only by userId (not per-guild — an
    // existing property of the bot's data model, not something introduced
    // here), so the list below is filtered to users who are actually members
    // of THIS guild rather than showing every exile across every server the
    // bot is in. Add/remove call the exact same performExile/performUnexile
    // helpers the /exile command uses, so behavior matches exactly. ─────────
    app.get('/api/guilds/:guildId/exiles', requireApi, requireGuildAccess, wrap(async (req, res) => {
        const guildId = req.params.guildId;
        const freshData = deps.loadData();
        const guild = deps.client.guilds.cache.get(guildId);
        if (!guild) return res.json({ exiles: [] });
        const entries = [];
        for (const [uid, info] of Object.entries(freshData.exiles || {})) {
            const member = guild.members.cache.get(uid);
            if (!member) continue; // not in this guild — belongs to some other server's list
            entries.push({
                userId: uid, tag: member.user.tag || member.user.username,
                reason: info.reason || '', exiledAt: info.exiledAt || null, expiry: info.expiry ? info.expiry * 1000 : null,
            });
        }
        entries.sort((a, b) => (b.exiledAt || 0) - (a.exiledAt || 0));
        res.json({ exiles: entries });
    }));
    app.post('/api/guilds/:guildId/exiles', requireApi, requireGuildAccess, rateLimit(20, 60 * 1000), wrap(async (req, res) => {
        if (typeof deps.performExile !== 'function') return res.status(501).json({ error: 'Not supported by this bot version.' });
        const guildId = req.params.guildId;
        const userId = String(req.body?.userId || '').trim();
        const minutes = Math.max(1, Math.min(60 * 24 * 30, parseInt(req.body?.minutes, 10) || deps.exileDurationMinsDefault || 45));
        const reason = String(req.body?.reason || 'Exiled from dashboard').slice(0, 300);
        const guild = deps.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Server not found.' });
        const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
        if (!member) return res.status(404).json({ error: 'Member not found in this server.' });
        const freshData = deps.loadData();
        await deps.performExile(member, guild, minutes, reason, freshData, req.user.id);
        deps.saveData(freshData);
        res.json({ ok: true });
    }));
    app.post('/api/guilds/:guildId/exiles/:userId/remove', requireApi, requireGuildAccess, rateLimit(20, 60 * 1000), wrap(async (req, res) => {
        if (typeof deps.performUnexile !== 'function') return res.status(501).json({ error: 'Not supported by this bot version.' });
        const { guildId, userId } = req.params;
        const guild = deps.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Server not found.' });
        const freshData = deps.loadData();
        if (!freshData.exiles?.[userId]) return res.status(404).json({ error: 'That user is not currently exiled.' });
        const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
        if (member) await deps.performUnexile(member, guild, freshData);
        delete freshData.exiles[userId];
        deps.saveData(freshData);
        res.json({ ok: true });
    }));

    // ── Appeals inbox — READ-ONLY this pass. data.appeals is a single global
    // object (not nested per guild), and appeal shapes vary by type: warn/
    // timeout/ban/honeypot appeals carry `guildId` + `type` directly; exile
    // appeals are submitted from a DM (no guild context available at
    // creation) so they never have `guildId` — same "filter by current
    // guild membership" fallback already used for the exile list above, for
    // exactly the same underlying reason. Deliberately NOT wiring
    // accept/reject actions from here yet: that logic today lives inline
    // inside 4 separate Discord button-interaction handlers (one per appeal
    // type), not as callable functions the way AutoMod/Honeypot's core*()
    // functions are — building dashboard actions against that would mean
    // either duplicating 4 inline flows (drift risk) or refactoring those
    // handlers first (its own, more careful pass). A read-only inbox is
    // still real value: staff can currently only see appeals as Discord
    // messages one at a time.
    app.get('/api/guilds/:guildId/appeals', requireApi, requireGuildAccess, wrap((req, res) => {
        const guildId = req.params.guildId;
        const guild = deps.client.guilds.cache.get(guildId);
        if (!guild) return res.json({ appeals: [] });
        const freshData = deps.loadData();
        const entries = [];
        for (const [id, a] of Object.entries(freshData.appeals || {})) {
            if (!a) continue;
            const belongsHere = a.guildId ? a.guildId === guildId : guild.members.cache.has(a.userId);
            if (!belongsHere) continue;
            const member = guild.members.cache.get(a.userId);
            entries.push({
                id,
                type: a.type || (a.text !== undefined ? 'general' : 'exile'),
                userId: a.userId,
                tag: member ? (member.user.tag || member.user.username) : null,
                reason: a.reason || a.text || '',
                status: a.status || 'pending',
                createdAt: a.createdAt || a.timestamp || null,
                // Type-specific context, included only when present — never
                // invented for types that don't have it.
                extra: {
                    caseId: a.caseId ?? undefined,
                    warnReason: a.warnReason ?? undefined,
                    timeoutReason: a.timeoutReason ?? undefined,
                    banReason: a.banReason ?? undefined,
                    triggerReason: a.triggerReason ?? undefined,
                    action: a.action ?? undefined,
                },
            });
        }
        entries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        res.json({ appeals: entries });
    }));


    app.post('/api/guilds/:guildId/appeals/:appealId/action', requireApi, requireGuildAccess, rateLimit(20, 60 * 1000), wrap(async (req, res) => {
        if (typeof deps.handleLegacyAppealDashboardAction !== 'function') return res.status(501).json({ error: 'Legacy appeal actions are unavailable in this bot build.' });
        const action = String(req.body?.action || '').toLowerCase();
        const result = await deps.handleLegacyAppealDashboardAction(req.params.guildId, req.params.appealId, action, req.user.id);
        if (result?.error) return res.status(400).json({ error: result.error });
        res.json(result);
    }));

    // ── Custom Appeal Form Studio ─────────────────────────────────────────
    function requireCustomAppeals(req, res) {
        if (!deps.customAppeals) { res.status(501).json({ error: 'Custom appeals module is not available.' }); return null; }
        return deps.customAppeals;
    }
    app.get('/api/guilds/:guildId/appeal-form', requireApi, requireGuildAccess, wrap((req,res)=>{
        const mod=requireCustomAppeals(req,res); if(!mod)return;
        const data=deps.loadData(); const gs=deps.getGuildSettings(req.params.guildId,data); const cfg=mod.getAppealConfig(gs);
        const guild=deps.client.guilds.cache.get(req.params.guildId); const st=mod.stats(data,req.params.guildId);
        res.json({config:cfg,stats:st,roles:guild?[...guild.roles.cache.values()].filter(r=>!r.managed).sort((a,b)=>a.position-b.position).slice(-80).map(r=>({id:r.id,name:r.name})):[],channels:guild?[...guild.channels.cache.values()].filter(c=>c.isTextBased?.()).map(c=>({id:c.id,name:c.name,type:c.type})):[]});
    }));
    app.post('/api/guilds/:guildId/appeal-form', requireApi, requireGuildAccess, rateLimit(30,60*1000), wrap((req,res)=>{
        const mod=requireCustomAppeals(req,res); if(!mod)return; const data=deps.loadData(); const gs=deps.getGuildSettings(req.params.guildId,data); const cur=mod.getAppealConfig(gs); const b=req.body||{};
        const allowedStrings=['title','description','startButtonLabel','answerButtonLabel','cancelButtonLabel','formIntro','completionMessage','acceptedMessage','rejectedMessage'];
        for(const k of allowedStrings) if(b[k]!==undefined){const v=String(b[k]);if(v.length>4000)return res.status(400).json({error:`${k} is too long.`});cur[k]=v;}
        for(const k of ['enabled','allowCancel','allowBack','requireRejectReason','notifyReviewer','reviewerMention','autoCloseOnDecision','decisionDm']) if(b[k]!==undefined)cur[k]=!!b[k];
        for(const [k,min,max] of [['maxActivePerUser',1,10],['timeLimitMinutes',1,10080]]) if(b[k]!==undefined){const n=Number(b[k]);if(!Number.isInteger(n)||n<min||n>max)return res.status(400).json({error:`${k} must be an integer between ${min} and ${max}.`});cur[k]=n;}
        for(const k of ['channelId']) if(b[k]!==undefined)cur[k]=b[k]?String(b[k]):null;
        if(b.reviewerRoleIds!==undefined){if(!Array.isArray(b.reviewerRoleIds))return res.status(400).json({error:'reviewerRoleIds must be an array.'});cur.reviewerRoleIds=[...new Set(b.reviewerRoleIds.map(String).filter(Boolean))].slice(0,25);}
        gs.customAppeals=mod.normalizeConfig(cur); deps.saveData(data); res.json({ok:true,config:gs.customAppeals,stats:mod.stats(data,req.params.guildId)});
    }));
    app.post('/api/guilds/:guildId/appeal-form/questions', requireApi, requireGuildAccess, rateLimit(30,60*1000), wrap((req,res)=>{
        const mod=requireCustomAppeals(req,res); if(!mod)return; const data=deps.loadData(); const gs=deps.getGuildSettings(req.params.guildId,data); const cfg=mod.getAppealConfig(gs); const q=mod.normalizeQuestion(req.body||{},cfg.questions.length); if(!q)return res.status(400).json({error:'Question prompt is required.'}); if(cfg.questions.some(x=>x.id===q.id))return res.status(409).json({error:'Question ID already exists.'}); cfg.questions.push(q); gs.customAppeals=cfg; deps.saveData(data); res.json({ok:true,question:q,questions:cfg.questions});
    }));
    app.put('/api/guilds/:guildId/appeal-form/questions/:questionId', requireApi, requireGuildAccess, rateLimit(30,60*1000), wrap((req,res)=>{
        const mod=requireCustomAppeals(req,res); if(!mod)return; const data=deps.loadData(); const gs=deps.getGuildSettings(req.params.guildId,data); const cfg=mod.getAppealConfig(gs); const i=cfg.questions.findIndex(q=>q.id===req.params.questionId); if(i<0)return res.status(404).json({error:'Question not found.'}); const q=mod.normalizeQuestion({...cfg.questions[i],...(req.body||{}),id:req.params.questionId},i); if(!q)return res.status(400).json({error:'Invalid question.'}); cfg.questions[i]=q; gs.customAppeals=cfg; deps.saveData(data); res.json({ok:true,question:q,questions:cfg.questions});
    }));
    app.delete('/api/guilds/:guildId/appeal-form/questions/:questionId', requireApi, requireGuildAccess, rateLimit(20,60*1000), wrap((req,res)=>{
        const mod=requireCustomAppeals(req,res); if(!mod)return; const data=deps.loadData(); const gs=deps.getGuildSettings(req.params.guildId,data); const cfg=mod.getAppealConfig(gs); if(cfg.questions.length<=1)return res.status(400).json({error:'At least one question is required.'}); const before=cfg.questions.length;cfg.questions=cfg.questions.filter(q=>q.id!==req.params.questionId);if(before===cfg.questions.length)return res.status(404).json({error:'Question not found.'});gs.customAppeals=cfg;deps.saveData(data);res.json({ok:true,questions:cfg.questions});
    }));
    app.post('/api/guilds/:guildId/appeal-form/questions/reorder', requireApi, requireGuildAccess, rateLimit(30,60*1000), wrap((req,res)=>{
        const mod=requireCustomAppeals(req,res);if(!mod)return;if(!Array.isArray(req.body?.ids))return res.status(400).json({error:'ids must be an array.'});const data=deps.loadData();const gs=deps.getGuildSettings(req.params.guildId,data);const cfg=mod.getAppealConfig(gs);const by=new Map(cfg.questions.map(q=>[q.id,q]));const out=[];for(const id of req.body.ids.map(String))if(by.has(id)){out.push(by.get(id));by.delete(id);}out.push(...by.values());cfg.questions=out;gs.customAppeals=cfg;deps.saveData(data);res.json({ok:true,questions:cfg.questions});
    }));
    app.get('/api/guilds/:guildId/appeal-form/export', requireApi, requireGuildAccess, rateLimit(10,60*1000), wrap((req,res)=>{const mod=requireCustomAppeals(req,res);if(!mod)return;const data=deps.loadData();res.json({exportedAt:Date.now(),guildId:req.params.guildId,config:mod.getAppealConfig(deps.getGuildSettings(req.params.guildId,data)),appeals:mod.exportData?mod.exportData(data,req.params.guildId):Object.values(mod.guildStore(data,req.params.guildId))});}));

    // ── Carry Service dashboard ─────────────────────────────────────────────
    function requireCarry(req,res){if(!deps.carryService){res.status(501).json({error:'Carry Service module unavailable.'});return null;}return deps.carryService;}
    app.get('/api/guilds/:guildId/carry', requireApi, requireGuildAccess, wrap((req,res)=>{const mod=requireCarry(req,res);if(!mod)return;const data=deps.loadData();const gs=deps.getGuildSettings(req.params.guildId,data);const guild=deps.client.guilds.cache.get(req.params.guildId);const cfg=mod.getCarryConfig(gs);res.json({config:cfg,stats:mod.counts(data,req.params.guildId),metrics:mod.requestMetrics?mod.requestMetrics(data,req.params.guildId):null,requests:mod.exportData(data,req.params.guildId).map(r=>({id:r.id,userId:r.userId,username:r.username,channelId:r.channelId,serviceId:r.serviceId,serviceName:r.serviceName,status:r.status,claimedBy:r.claimedBy,details:r.details,createdAt:r.createdAt,updatedAt:r.updatedAt,completedAt:r.completedAt,cancelledAt:r.cancelledAt})) ,roles:guild?[...guild.roles.cache.values()].filter(r=>!r.managed).map(r=>({id:r.id,name:r.name})):[],channels:guild?[...guild.channels.cache.values()].filter(c=>c.isTextBased?.()||c.type===4).map(c=>({id:c.id,name:c.name,type:c.type})):[]});}));
    app.get('/api/guilds/:guildId/carry/export', requireApi, requireGuildAccess, rateLimit(10,60*1000), wrap((req,res)=>{const mod=requireCarry(req,res);if(!mod)return;const data=deps.loadData();const format=String(req.query.format||'json').toLowerCase();if(format==='csv'){res.type('text/csv').send(mod.exportCsv(data,req.params.guildId));return;}res.json({ok:true,exportedAt:Date.now(),guildId:req.params.guildId,requests:mod.exportData(data,req.params.guildId)});}));
    app.post('/api/guilds/:guildId/carry', requireApi, requireGuildAccess, rateLimit(30,60*1000), wrap((req,res)=>{const mod=requireCarry(req,res);if(!mod)return;const data=deps.loadData();const gs=deps.getGuildSettings(req.params.guildId,data);const cfg=mod.configure(gs,req.body||{});deps.saveData(data);res.json({ok:true,config:cfg});}));
    app.post('/api/guilds/:guildId/carry/services', requireApi, requireGuildAccess, rateLimit(30,60*1000), wrap((req,res)=>{const mod=requireCarry(req,res);if(!mod)return;const data=deps.loadData();const gs=deps.getGuildSettings(req.params.guildId,data);const cfg=mod.getCarryConfig(gs);const item=mod.normalizeConfig({services:[req.body] }).services[0];if(!item)return res.status(400).json({error:'Invalid service.'});if(cfg.services.some(s=>s.id===item.id))return res.status(409).json({error:'Service ID already exists.'});cfg.services.push(item);gs.carryService=cfg;deps.saveData(data);res.json({ok:true,services:cfg.services});}));
    app.put('/api/guilds/:guildId/carry/services/:serviceId', requireApi, requireGuildAccess, rateLimit(30,60*1000), wrap((req,res)=>{const mod=requireCarry(req,res);if(!mod)return;const data=deps.loadData();const gs=deps.getGuildSettings(req.params.guildId,data);const cfg=mod.getCarryConfig(gs);const i=cfg.services.findIndex(s=>s.id===req.params.serviceId);if(i<0)return res.status(404).json({error:'Service not found.'});const merged=mod.normalizeConfig({services:[{...cfg.services[i],...(req.body||{}),id:req.params.serviceId}]}).services[0];cfg.services[i]=merged;gs.carryService=cfg;deps.saveData(data);res.json({ok:true,services:cfg.services});}));
    app.delete('/api/guilds/:guildId/carry/services/:serviceId', requireApi, requireGuildAccess, rateLimit(20,60*1000), wrap((req,res)=>{const mod=requireCarry(req,res);if(!mod)return;const data=deps.loadData();const gs=deps.getGuildSettings(req.params.guildId,data);const cfg=mod.getCarryConfig(gs);if(cfg.services.length<=1)return res.status(400).json({error:'At least one service must remain.'});cfg.services=cfg.services.filter(s=>s.id!==req.params.serviceId);gs.carryService=cfg;deps.saveData(data);res.json({ok:true,services:cfg.services});}));
    app.post('/api/guilds/:guildId/carry/panel', requireApi, requireGuildAccess, rateLimit(10,60*1000), wrap(async(req,res)=>{const mod=requireCarry(req,res);if(!mod)return;const data=deps.loadData();const gs=deps.getGuildSettings(req.params.guildId,data);const cfg=mod.getCarryConfig(gs);const guild=deps.client.guilds.cache.get(req.params.guildId);const ch=guild?.channels.cache.get(req.body?.channelId||cfg.panelChannelId);if(!ch)return res.status(404).json({error:'Panel channel not found.'});await ch.send(mod.buildPanel(cfg,guild.name));res.json({ok:true});}));
    app.post('/api/guilds/:guildId/carry/request/:requestId/:action', requireApi, requireGuildAccess, rateLimit(30,60*1000), wrap(async(req,res)=>{const mod=requireCarry(req,res);if(!mod)return;const action=String(req.params.action);if(!['cancel','pause','complete'].includes(action))return res.status(400).json({error:'Unsupported dashboard action.'});const data=deps.loadData();const store=mod.guildStore(data,req.params.guildId);const r=store[req.params.requestId];if(!r)return res.status(404).json({error:'Request not found.'});const guild=deps.client.guilds.cache.get(req.params.guildId);if(!guild)return res.status(404).json({error:'Server not found.'});r.updatedAt=Date.now();if(action==='cancel'){r.status='cancelled';r.cancelledAt=Date.now();}if(action==='pause'){r.status='paused';}if(action==='complete'){r.status='completed';r.completedAt=Date.now();}mod.pushEvent?.(r,`dashboard_${action}`,req.user.id);deps.saveData(data);res.json({ok:true,request:r,stats:mod.counts(data,req.params.guildId)});}));

    // ── Applications: per-guild form builder, review queue and statistics ──
    function requireApplications(req, res) {
        if (!deps.applications) { res.status(501).json({ error: 'Applications are not available on this bot instance.' }); return null; }
        return deps.applications;
    }
    function applicationPublic(app, guild, questionCount) {
        const member = guild?.members?.cache?.get(app.userId);
        return {
            id: app.id, userId: app.userId, username: member?.user?.username || null,
            displayName: member?.displayName || member?.user?.globalName || null,
            status: app.status, currentIndex: Number(app.currentIndex) || 0,
            questionCount, answers: app.answers || {}, createdAt: app.createdAt || null,
            updatedAt: app.updatedAt || null, submittedAt: app.submittedAt || null,
            expiresAt: app.expiresAt || null, snoozedUntil: app.snoozedUntil || null,
            snoozeKind: app.snoozeKind || null, remainingMs: app.remainingMs || null,
            reviewStatus: app.reviewStatus || 'pending', reviewedBy: app.reviewedBy || null,
            reviewReason: app.reviewReason || null, reviewMessageId: app.reviewMessageId || null,
            reviewChannelId: app.reviewChannelId || null, cancelReason: app.cancelReason || null,
        };
    }
    app.get('/api/guilds/:guildId/applications', requireApi, requireGuildAccess, wrap((req, res) => {
        const mod = requireApplications(req, res); if (!mod) return;
        const data = deps.loadData(); const gs = deps.getGuildSettings(req.params.guildId, data);
        const guild = deps.client.guilds.cache.get(req.params.guildId); const cfg = mod.getApplicationConfig(gs);
        const apps = Object.values(mod.guildApplications(data, req.params.guildId)).filter(Boolean)
            .sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 250)
            .map(a => applicationPublic(a, guild, cfg.questions.length));
        res.json({ config: cfg, stats: mod.applicationStats(data, req.params.guildId), analytics: mod.applicationAnalytics(data, req.params.guildId), applications: apps, statuses: mod.APP_STATUSES, questionTypes: mod.QUESTION_TYPES, captcha: getCaptchaConfig(gs), captchaConfigured: !!TURNSTILE_SITE_KEY });
    }));
    app.get('/api/guilds/:guildId/applications/analytics', requireApi, requireGuildAccess, wrap((req, res) => { const mod = requireApplications(req,res); if(!mod)return; const data=deps.loadData(); res.json({ok:true,analytics:mod.applicationAnalytics(data,req.params.guildId)}); }));

    app.get('/api/guilds/:guildId/applications/:appId', requireApi, requireGuildAccess, wrap((req, res) => {
        const mod = requireApplications(req, res); if (!mod) return;
        const data = deps.loadData(); const gs = deps.getGuildSettings(req.params.guildId, data); const guild = deps.client.guilds.cache.get(req.params.guildId);
        const appData = mod.guildApplications(data, req.params.guildId)[req.params.appId]; if (!appData) return res.status(404).json({ error: 'Application not found.' });
        const cfg = mod.getApplicationConfig(gs); res.json({ application: applicationPublic(appData, guild, cfg.questions.length), questions: cfg.questions });
    }));
    app.post('/api/guilds/:guildId/applications/config', requireApi, requireGuildAccess, rateLimit(30, 60 * 1000), wrap((req, res) => {
        const mod = requireApplications(req, res); if (!mod) return;
        const data = deps.loadData(); const gs = deps.getGuildSettings(req.params.guildId, data); const current = mod.getApplicationConfig(gs); const body = req.body || {}; const clean = { ...current };
        if (body.enabled !== undefined) clean.enabled = !!body.enabled;
        for (const key of ['applyChannelId','reviewChannelId']) if (body[key] !== undefined) clean[key] = body[key] ? String(body[key]) : null;
        if (body.reviewerRoleIds !== undefined) {
            if (!Array.isArray(body.reviewerRoleIds)) return res.status(400).json({ error: 'reviewerRoleIds must be an array.' });
            clean.reviewerRoleIds = [...new Set(body.reviewerRoleIds.map(String).filter(Boolean))].slice(0, 25);
        }
        for (const [key, min, max] of [['timeLimitMinutes',1,10080],['snoozeMinutes',1,10080],['reviewSnoozeMinutes',1,10080],['maxActivePerUser',1,10]]) {
            if (body[key] !== undefined) { const n = Number(body[key]); if (!Number.isInteger(n) || n < min || n > max) return res.status(400).json({ error: `${key} must be an integer between ${min} and ${max}.` }); clean[key] = n; }
        }
        for (const key of ['allowCancel','allowSnooze','decisionDm','requireRejectReason']) if (body[key] !== undefined) clean[key] = !!body[key];
        if (body.reviewActions !== undefined) clean.reviewActions = { ...current.reviewActions, ...(body.reviewActions || {}) };
        for (const key of ['dmIntro','dmComplete','dmCancelled','dmSnoozed','dmResumed','dmExpired','acceptedDm','rejectedDm','reviewTitle','reviewFooter','formTitle','formDescription','applicationButtonLabel','questionButtonLabel','snoozeButtonLabel','cancelButtonLabel','answerPlaceholder']) {
            if (body[key] !== undefined) { const v = String(body[key]); if (v.length > 2000) return res.status(400).json({ error: `${key} is too long (2,000 characters maximum).` }); clean[key] = v; }
        }
        for (const key of ['acceptedRoleId','rejectedRoleId','decisionChannelId']) if (body[key] !== undefined) clean[key] = body[key] ? String(body[key]) : null;
        for (const key of ['reviewerMention','deleteReviewMessageAfterDecision','allowReviewerSnooze']) if (body[key] !== undefined) clean[key] = !!body[key];
        gs.applications = mod.getApplicationConfig({ applications: clean }); deps.saveData(data); res.json({ ok: true, config: mod.getApplicationConfig(gs), analytics: mod.applicationAnalytics(data, req.params.guildId) });
    }));
    app.post('/api/guilds/:guildId/applications/questions', requireApi, requireGuildAccess, rateLimit(30, 60 * 1000), wrap((req, res) => {
        const mod = requireApplications(req, res); if (!mod) return;
        const data = deps.loadData(); const gs = deps.getGuildSettings(req.params.guildId, data); const cfg = mod.getApplicationConfig(gs); const q = mod.normalizeQuestion(req.body || {}, cfg.questions.length);
        if (!q) return res.status(400).json({ error: 'A question prompt is required.' });
        if (cfg.questions.some(x => x.id === q.id)) return res.status(409).json({ error: 'A question with that ID already exists.' });
        cfg.questions.push(q); gs.applications = cfg; deps.saveData(data); res.json({ ok: true, question: q, questions: cfg.questions });
    }));
    app.post('/api/guilds/:guildId/applications/questions/reorder', requireApi, requireGuildAccess, rateLimit(30, 60 * 1000), wrap((req, res) => {
        const mod = requireApplications(req, res); if (!mod) return;
        if (!Array.isArray(req.body?.ids)) return res.status(400).json({ error: 'ids must be an array of question IDs.' });
        const data = deps.loadData(); const gs = deps.getGuildSettings(req.params.guildId, data); const cfg = mod.getApplicationConfig(gs); const byId = new Map(cfg.questions.map(q => [q.id, q])); const out = [];
        for (const id of req.body.ids.map(String)) if (byId.has(id)) { out.push(byId.get(id)); byId.delete(id); }
        out.push(...byId.values()); cfg.questions = out; gs.applications = cfg; deps.saveData(data); res.json({ ok: true, questions: cfg.questions });
    }));
    app.put('/api/guilds/:guildId/applications/questions/:questionId', requireApi, requireGuildAccess, rateLimit(30, 60 * 1000), wrap((req, res) => {
        const mod = requireApplications(req, res); if (!mod) return;
        const data = deps.loadData(); const gs = deps.getGuildSettings(req.params.guildId, data); const cfg = mod.getApplicationConfig(gs); const idx = cfg.questions.findIndex(q => q.id === req.params.questionId);
        if (idx < 0) return res.status(404).json({ error: 'Question not found.' });
        const q = mod.normalizeQuestion({ ...cfg.questions[idx], ...(req.body || {}), id: req.params.questionId }, idx); if (!q) return res.status(400).json({ error: 'A valid prompt is required.' });
        cfg.questions[idx] = q; gs.applications = cfg; deps.saveData(data); res.json({ ok: true, question: q, questions: cfg.questions });
    }));
    app.delete('/api/guilds/:guildId/applications/questions/:questionId', requireApi, requireGuildAccess, rateLimit(20, 60 * 1000), wrap((req, res) => {
        const mod = requireApplications(req, res); if (!mod) return;
        const data = deps.loadData(); const gs = deps.getGuildSettings(req.params.guildId, data); const cfg = mod.getApplicationConfig(gs); if (cfg.questions.length <= 1) return res.status(400).json({ error: 'An application form must contain at least one question.' });
        const before = cfg.questions.length; cfg.questions = cfg.questions.filter(q => q.id !== req.params.questionId); if (cfg.questions.length === before) return res.status(404).json({ error: 'Question not found.' });
        gs.applications = cfg; deps.saveData(data); res.json({ ok: true, questions: cfg.questions });
    }));
    app.get('/api/guilds/:guildId/applications/export', requireApi, requireGuildAccess, rateLimit(10, 60 * 1000), wrap((req, res) => {
        const mod = requireApplications(req, res); if (!mod) return;
        const data = deps.loadData(); const guild = deps.client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found.' });
        const cfg = mod.getApplicationConfig(deps.getGuildSettings(req.params.guildId, data));
        const apps = Object.values(mod.guildApplications(data, req.params.guildId)).filter(Boolean).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
        const format = String(req.query.format || 'json').toLowerCase();
        const safe = apps.map(a => ({ id:a.id, userId:a.userId, username:a.username||null, status:a.status, reviewStatus:a.reviewStatus||'pending', currentIndex:a.currentIndex||0, questionCount:cfg.questions.length, createdAt:a.createdAt||null, submittedAt:a.submittedAt||null, reviewedAt:a.reviewedAt||null, updatedAt:a.updatedAt||null, reviewedBy:a.reviewedBy||null, reviewReason:a.reviewReason||null, cancelReason:a.cancelReason||null, snoozeKind:a.snoozeKind||null, snoozedUntil:a.snoozedUntil||null, answers:a.answers||{} }));
        if (format === 'csv') {
            const headers=['id','userId','username','status','reviewStatus','currentIndex','questionCount','createdAt','submittedAt','reviewedAt','updatedAt','reviewedBy','reviewReason','cancelReason','snoozeKind','snoozedUntil','answers'];
            const csv=[headers.join(','),...safe.map(r=>headers.map(h=>{const v=h==='answers'?JSON.stringify(r[h]):String(r[h]??''); return `"${v.replace(/"/g,'""')}"`;}).join(','))].join('\n');
            res.type('text/csv').send(csv); return;
        }
        res.json({ok:true,exportedAt:Date.now(),guildId:req.params.guildId,applicationCount:safe.length,config:cfg,applications:safe});
    }));

    app.post('/api/guilds/:guildId/applications/:appId/review', requireApi, requireGuildAccess, rateLimit(40, 60 * 1000), wrap(async (req, res) => {
        const mod = requireApplications(req, res); if (!mod) return;
        const guildId = req.params.guildId; const data = deps.loadData(); const gs = deps.getGuildSettings(guildId, data); const guild = deps.client.guilds.cache.get(guildId); if (!guild) return res.status(404).json({ error: 'Server not found.' });
        const appData = mod.guildApplications(data, guildId)[req.params.appId]; if (!appData) return res.status(404).json({ error: 'Application not found.' });
        const member = guild.members.cache.get(req.user.id) || await guild.members.fetch(req.user.id).catch(() => null); if (!member) return res.status(403).json({ error: 'Your Discord member record could not be loaded.' });
        const action = String(req.body?.action || '').toLowerCase(); if (!['accept','reject','snooze'].includes(action)) return res.status(400).json({ error: 'action must be accept, reject, or snooze.' });
        const cfg = mod.getApplicationConfig(gs); const reason = String(req.body?.reason || '').trim().slice(0, 1000); if (!cfg.reviewActions[action]) return res.status(400).json({ error: `The ${action} action is disabled.` }); if (action === 'reject' && cfg.requireRejectReason && !reason) return res.status(400).json({ error: 'A rejection reason is required.' });
        const result = await mod.reviewApplication({ action, guild, member, app: appData, data, gs, saveData: deps.saveData, reason, ctx: deps }); if (result.error) return res.status(400).json({ error: result.error });
        if (action !== 'snooze' && appData.reviewMessageId && appData.reviewChannelId) {
            const channel = guild.channels.cache.get(appData.reviewChannelId); const msg = channel?.isTextBased?.() ? await channel.messages.fetch(appData.reviewMessageId).catch(() => null) : null;
            if (msg) await msg.edit({ components: [], content: `✅ Application ${action}d by <@${req.user.id}>.` }).catch(() => {});
        }
        res.json({ ok: true, application: appData });
    }));


    app.get('/api/guilds/:guildId/members', requireApi, requireGuildAccess, rateLimit(60, 60 * 1000), wrap((req, res) => {
        const guild = deps.client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.status(404).json({ error: 'Server not found.' });
        const q = String(req.query.search || '').trim().toLowerCase();
        const limit = Math.max(5, Math.min(100, Number(req.query.limit) || 40));
        const members = [];
        for (const [, member] of guild.members.cache) {
            const tag = member.user.tag || member.user.username;
            const hay = `${member.id} ${member.user.username} ${member.user.globalName || ''} ${member.nickname || ''}`.toLowerCase();
            if (q && !hay.includes(q)) continue;
            const fresh = deps.loadData();
            const gs = deps.getGuildSettings(req.params.guildId, fresh);
            const totalXp = deps.getTotalXp(fresh, req.params.guildId, member.id);
            const info = deps.computeLevelFromXp(deps.getLevelingConfig(gs), totalXp);
            members.push({ id:member.id, tag, displayName:member.displayName || tag, avatarUrl:member.user.displayAvatarURL({extension:'png',size:64}), exiled:!!fresh.exiles?.[member.id], leveling:{level:info.level,totalXp} });
            if (members.length >= limit) break;
        }
        res.json({ totalCached:guild.memberCount || guild.members.cache.size, members });
    }));

    app.get('/api/guilds/:guildId/members/:userId/profile', requireApi, requireGuildAccess, rateLimit(60, 60 * 1000), wrap((req, res) => {
        const guildId = req.params.guildId, userId = req.params.userId;
        const guild = deps.client.guilds.cache.get(guildId);
        const member = guild?.members.cache.get(userId);
        if (!member) return res.status(404).json({ error: 'Member not found in this server cache.' });
        const data = deps.loadData();
        const gs = deps.getGuildSettings(guildId, data);
        const lc = deps.getLevelingConfig(gs);
        const totalXp = deps.getTotalXp(data, guildId, userId);
        const li = deps.computeLevelFromXp(lc, totalXp);
        const leaderboard = deps.buildLevelLeaderboard(data, guildId);
        const rank = (leaderboard.findIndex(r => r.uid === userId) + 1) || null;
        const activity = typeof deps.getActivityStats === 'function' ? deps.getActivityStats(data, guildId, userId) : {reactions:0,voiceTime:0,lastActivityAt:null};
        const messages = typeof deps.getMessageCount === 'function' ? deps.getMessageCount(data,guildId,userId,null) : 0;
        const econMod = deps.beliEconomy;
        let economy = {wallet:0,bank:0,netWorth:0,gamesPlayed:0};
        if (econMod) {
            try {
                const rec = econMod.ensureEconomy(data,guildId,userId);
                economy = {wallet:Number(rec.wallet||0),bank:Number(rec.bank||0),netWorth:Number(econMod.netWorth(rec)||0),gamesPlayed:Number(rec.gamesPlayed||0)};
            } catch {}
        }
        const vioObj = data.violations?.[userId];
        const history = Array.isArray(vioObj?.history) ? vioObj.history : [];
        const ex = data.exiles?.[userId] || null;
        const caseCount = Object.values(data.cases?.[guildId] || {}).filter(c => c?.userId === userId || c?.targetId === userId).length;
        const apps = deps.applications?.guildApplications ? Object.values(deps.applications.guildApplications(data,guildId)).filter(a=>a?.userId===userId) : [];
        const appStats = {active:0,completed:0,cancelled:0,snoozed:0}; for (const a of apps) { if (Object.prototype.hasOwnProperty.call(appStats,a.status)) appStats[a.status]++; if (a.status === 'snoozed') appStats.snoozed++; }
        const roles = member.roles.cache.filter(r=>r.id!==guildId).sort((a,b)=>b.position-a.position).map(r=>({id:r.id,name:r.name,position:r.position,color:r.hexColor}));
        const created = member.user.createdAt?.toISOString?.() || new Date(member.user.createdTimestamp).toISOString();
        const joined = member.joinedAt?.toISOString?.() || null;
        const fmtVoice = (sec)=>{sec=Math.max(0,Math.floor(Number(sec)||0));const d=Math.floor(sec/86400),h=Math.floor(sec%86400/3600),m=Math.floor(sec%3600/60);return [d?`${d}d`: '',h?`${h}h`:'',m?`${m}m`:'',(!d&&!h&&!m)?'0m':''].filter(Boolean).join(' ');};
        res.json({
            user:{id:userId,tag:member.user.tag||member.user.username,displayName:member.displayName,username:member.user.username,avatarUrl:member.user.displayAvatarURL({extension:'png',size:256}),bot:!!member.user.bot,createdAt:created,joinedAt:joined},
            roles, primaryRole:roles[0]?.name || '@everyone',
            leveling:{level:li.level,totalXp,xpIntoLevel:li.xpIntoLevel,xpForNextLevel:li.xpForNextLevel,rank},
            activity:{messages,reactions:Number(activity.reactions||0),voiceTime:Number(activity.voiceTime||0),voiceTimeFormatted:fmtVoice(activity.voiceTime),lastActivityAt:activity.lastActivityAt||null,lastMessageAt:data.msgStats?.[guildId]?.[userId]?.lastMessageAt||null},
            economy,
            moderation:{violations:Number(vioObj?.count||0),recentHistory:history.slice(-10).reverse(),exiled:!!ex,exileLabel:ex ? (ex.expiry ? `until ${new Date(ex.expiry).toLocaleString()}` : 'indefinite') : null,caseCount},
            applications:appStats,
        });
    }));
    app.get('/api/guilds/:guildId/members/search', requireApi, requireGuildAccess, rateLimit(60, 60 * 1000), wrap((req, res) => {
        const guild = deps.client.guilds.cache.get(req.params.guildId);
        const q = String(req.query.q || '').trim().toLowerCase();
        if (!guild || q.length < 2) return res.json({ members: [] });
        const out = [];
        for (const [, m] of guild.members.cache) {
            if (out.length >= 15) break;
            if (m.user.username.toLowerCase().includes(q) || (m.nickname || '').toLowerCase().includes(q)) {
                out.push({ id: m.id, tag: m.user.tag || m.user.username, nickname: m.nickname || null, avatarUrl: m.user.displayAvatarURL({ extension: 'png', size: 64 }) });
            }
        }
        res.json({ members: out });
    }));

    // ── Custom AutoMod — every route below is a thin wrapper around the
    // exact same core*() function /beli automod's subcommands call (see
    // beli_commands.js). No rule-matching or validation logic is duplicated
    // here; this file only handles auth, the guild-settings load/save, and
    // resolving role/channel names for display. ────────────────────────────
    function requireAutomod(req, res) {
        if (typeof deps.automod?.getConfig !== 'function') { res.status(501).json({ error: 'Not supported by this bot version.' }); return null; }
        return deps.automod;
    }
    app.get('/api/guilds/:guildId/automod', requireApi, requireGuildAccess, wrap((req, res) => {
        const am = requireAutomod(req, res); if (!am) return;
        const guildId = req.params.guildId;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        const cfg = am.getConfig(gs);
        const guild = deps.client.guilds.cache.get(guildId);
        res.json({
            enabled: cfg.automodEnabled,
            words: cfg.automodWords,
            regexRules: cfg.automodRegexRules,
            action: cfg.automodAction,
            timeoutMinutes: cfg.automodTimeoutMinutes,
            logChannelId: cfg.automodLogChannelId,
            logChannelName: cfg.automodLogChannelId ? (guild?.channels.cache.get(cfg.automodLogChannelId)?.name || null) : null,
            exemptRoles: cfg.automodExemptRoleIds.map(id => ({ id, name: guild?.roles.cache.get(id)?.name || 'deleted-role' })),
            exemptChannels: cfg.automodExemptChannelIds.map(id => ({ id, name: guild?.channels.cache.get(id)?.name || 'deleted-channel' })),
            limits: am.limits,
        });
    }));
    // One endpoint for every mutating action, keyed by `op` — avoids 15 near-
    // identical route handlers for what's really one shape: call a core fn,
    // save, log, respond. `value` is loosely typed on purpose (string / bool
    // / number depending on op); each core function validates its own input,
    // same as it does for the slash command, so nothing here needs to.
    const AUTOMOD_OPS = {
        wordAdd: (am, gs, v) => am.wordAdd(gs, v), wordRemove: (am, gs, v) => am.wordRemove(gs, v), wordClear: (am, gs) => am.wordClear(gs),
        regexAdd: (am, gs, v) => am.regexAdd(gs, v.pattern, v.flags), regexRemove: (am, gs, v) => am.regexRemove(gs, v), regexClear: (am, gs) => am.regexClear(gs),
        exemptRole: (am, gs, v) => am.exemptRole(gs, v), unexemptRole: (am, gs, v) => am.unexemptRole(gs, v),
        exemptChannel: (am, gs, v) => am.exemptChannel(gs, v), unexemptChannel: (am, gs, v) => am.unexemptChannel(gs, v),
        setAction: (am, gs, v) => am.setAction(gs, v), setTimeout: (am, gs, v) => am.setTimeout(gs, v), setLogChannel: (am, gs, v) => am.setLogChannel(gs, v),
        enable: (am, gs) => am.enable(gs), disable: (am, gs) => am.disable(gs), reset: (am, gs) => am.reset(gs),
    };
    app.post('/api/guilds/:guildId/automod/:op', requireApi, requireGuildAccess, rateLimit(40, 60 * 1000), wrap((req, res) => {
        const am = requireAutomod(req, res); if (!am) return;
        const fn = AUTOMOD_OPS[req.params.op];
        if (!fn) return res.status(404).json({ error: 'Unknown AutoMod action.' });
        const guildId = req.params.guildId;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        const before = JSON.stringify({ words: am.getConfig(gs).automodWords.length, regex: am.getConfig(gs).automodRegexRules.length, enabled: am.getConfig(gs).automodEnabled });
        const result = fn(am, gs, req.body?.value);
        if (result?.error) return res.status(400).json({ error: result.error });
        gs.settingsAuditLog = gs.settingsAuditLog || [];
        gs.settingsAuditLog.push({ key: `automod.${req.params.op}`, label: 'Custom AutoMod', category: 'Custom AutoMod', before, after: JSON.stringify(result), at: Date.now(), by: req.user.id, byName: req.user.username });
        gs.settingsAuditLog = gs.settingsAuditLog.slice(-200);
        deps.saveData(freshData);
        res.json({ ok: true, result });
    }));
    // Dry-run test — never touches saved config, mirrors /beli automod test exactly.
    app.post('/api/guilds/:guildId/automod/test', requireApi, requireGuildAccess, rateLimit(60, 60 * 1000), wrap((req, res) => {
        const am = requireAutomod(req, res); if (!am) return;
        const gs = deps.getGuildSettings(req.params.guildId, deps.loadData());
        res.json(am.test(gs, String(req.body?.text || '').slice(0, 2000)));
    }));

    // ── Honeypot manager — same architecture as AutoMod directly above: auth
    // + guild-settings load/save + name resolution live here, all matching
    // logic/validation lives in the exact core*() functions `/beli security
    // honeypot-*` calls, none of it duplicated. ──────────────────────────────
    function requireHoneypot(req, res) {
        if (typeof deps.honeypot?.getConfig !== 'function') { res.status(501).json({ error: 'Not supported by this bot version.' }); return null; }
        return deps.honeypot;
    }
    app.get('/api/guilds/:guildId/honeypot', requireApi, requireGuildAccess, wrap((req, res) => {
        const hp = requireHoneypot(req, res); if (!hp) return;
        const guildId = req.params.guildId;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        const cfg = hp.getConfig(gs);
        const guild = deps.client.guilds.cache.get(guildId);
        res.json({
            enabled: cfg.honeypotEnabled,
            action: cfg.honeypotAction,
            reinvite: cfg.honeypotReinvite,
            roleId: cfg.honeypotRoleId,
            roleName: cfg.honeypotRoleId ? (guild?.roles.cache.get(cfg.honeypotRoleId)?.name || 'deleted-role') : null,
            logChannelId: cfg.honeypotLogChannelId,
            logChannelName: cfg.honeypotLogChannelId ? (guild?.channels.cache.get(cfg.honeypotLogChannelId)?.name || 'deleted-channel') : null,
            channels: cfg.honeypotChannelIds.map(id => ({ id, name: guild?.channels.cache.get(id)?.name || 'deleted-channel' })),
            trapCommands: cfg.honeypotTrapCommands,
            // Effective text (custom-or-default) so the editor always shows what
            // will actually be sent, not a blank box when nothing's customized.
            messages: {
                warning: cfg.honeypotWarningMessage || hp.templateDefaults.warning,
                dm: cfg.honeypotDmMessage || hp.templateDefaults.dm,
                log: cfg.honeypotLogMessage || hp.templateDefaults.log,
            },
            messagesCustomized: { warning: !!cfg.honeypotWarningMessage, dm: !!cfg.honeypotDmMessage, log: !!cfg.honeypotLogMessage },
            limits: hp.limits,
        });
    }));
    // One endpoint for every mutating action, keyed by `op` — same "avoid 15
    // near-identical route handlers" reasoning as AutoMod's dispatcher above.
    app.post('/api/guilds/:guildId/honeypot/post-warning', requireApi, requireGuildAccess, rateLimit(10, 60 * 1000), wrap(async (req, res) => {
        const hp = requireHoneypot(req, res); if (!hp) return;
        const guildId = req.params.guildId;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        const cfg = hp.getConfig(gs);
        if (!cfg.honeypotChannelIds.length) return res.status(400).json({ error: 'No honeypot channels are configured.' });
        const guild = deps.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Server not found.' });
        const template = cfg.honeypotWarningMessage || hp.templateDefaults.warning;
        const vars = { user: '@Member', action: cfg.honeypotAction, server: guild.name, trigger: 'entering a honeypot channel', channel: '#honeypot' };
        const renderTpl = typeof hp.renderTemplate === 'function' ? hp.renderTemplate(template, vars) : String(template).replace(/\{\{server:name\}\}/g, guild.name).replace(/\{\{action:text\}\}/g, cfg.honeypotAction);
        let posted = 0, failed = 0;
        for (const id of cfg.honeypotChannelIds) {
            const ch = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
            if (!ch?.isTextBased?.()) { failed++; continue; }
            try {
                const msg = await ch.send({ content: renderTpl.slice(0, 1900), allowedMentions: { parse: [] } });
                await msg.pin?.().catch(() => {});
                posted++;
            } catch { failed++; }
        }
        gs.settingsAuditLog = gs.settingsAuditLog || [];
        gs.settingsAuditLog.push({ key: 'honeypot.post-warning', label: 'Honeypot warning posted', category: 'Honeypot', before: cfg.honeypotChannelIds.length, after: posted, at: Date.now(), by: req.user.id, byName: req.user.username });
        gs.settingsAuditLog = gs.settingsAuditLog.slice(-200);
        deps.saveData(freshData);
        res.json({ ok: true, posted, failed, total: cfg.honeypotChannelIds.length });
    }));

    const HONEYPOT_OPS = {
        channelAdd: (hp, gs, v) => hp.channelAdd(gs, v), channelRemove: (hp, gs, v) => hp.channelRemove(gs, v),
        commandAdd: (hp, gs, v) => hp.commandAdd(gs, v), commandRemove: (hp, gs, v) => hp.commandRemove(gs, v),
        setEnabled: (hp, gs, v) => hp.setEnabled(gs, v), setAction: (hp, gs, v) => hp.setAction(gs, v), setReinvite: (hp, gs, v) => hp.setReinvite(gs, v),
        setRole: (hp, gs, v) => hp.setRole(gs, v), setLogChannel: (hp, gs, v) => hp.setLogChannel(gs, v),
        setMessage: (hp, gs, v) => hp.setMessage(gs, v?.type, v?.text),
        reset: (hp, gs) => hp.reset(gs),
    };
    app.post('/api/guilds/:guildId/honeypot/:op', requireApi, requireGuildAccess, rateLimit(40, 60 * 1000), wrap((req, res) => {
        const hp = requireHoneypot(req, res); if (!hp) return;
        const fn = HONEYPOT_OPS[req.params.op];
        if (!fn) return res.status(404).json({ error: 'Unknown honeypot action.' });
        const guildId = req.params.guildId;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        const before = JSON.stringify({ channels: hp.getConfig(gs).honeypotChannelIds.length, commands: hp.getConfig(gs).honeypotTrapCommands.length, enabled: hp.getConfig(gs).honeypotEnabled });
        const result = fn(hp, gs, req.body?.value);
        if (result?.error) return res.status(400).json({ error: result.error });
        gs.settingsAuditLog = gs.settingsAuditLog || [];
        gs.settingsAuditLog.push({ key: `honeypot.${req.params.op}`, label: 'Honeypot', category: 'Honeypot', before, after: JSON.stringify(result), at: Date.now(), by: req.user.id, byName: req.user.username });
        gs.settingsAuditLog = gs.settingsAuditLog.slice(-200);
        deps.saveData(freshData);
        res.json({ ok: true, result });
    }));

    // ── Visual Card Editor — GET returns the effective (custom-or-default)
    // schema; POST saves it to gs.cardSchemas[type], which is the exact same
    // field DISCOMOD.js's resolveCardSchema() reads when it actually renders
    // a card, so there is no dashboard-only/fake state here. Preview renders
    // through the real card_renderer.renderCard(), never a second renderer. ──
    const CARD_TYPES = {
        rank: () => deps.cardRenderer?.DEFAULT_RANK_CARD_SCHEMA,
        levelup: () => deps.cardRenderer?.DEFAULT_LEVELUP_CARD_SCHEMA,
        welcome: () => deps.cardRenderer?.DEFAULT_WELCOME_CARD_SCHEMA,
        leave: () => deps.cardRenderer?.DEFAULT_LEAVE_CARD_SCHEMA,
        stock: () => deps.cardRenderer?.DEFAULT_STOCK_CARD_SCHEMA,
    };
    function requireCards(req, res) {
        if (!deps.cardRenderer) { res.status(501).json({ error: 'Card rendering is not available on this bot instance.' }); return null; }
        const getDefault = CARD_TYPES[req.params.type];
        if (!getDefault) { res.status(404).json({ error: 'Unknown card type.' }); return null; }
        return getDefault;
    }
    // Defensive bounds on anything a client can submit for canvas rendering —
    // this is authenticated to guild admins, not the open internet, but a
    // malformed schema (e.g. width: 999999999) still shouldn't be able to
    // force a huge allocation just because the requester is legitimate.
    function sanitizeSchema(raw) {
        if (!raw || typeof raw !== 'object' || !Array.isArray(raw.layers)) throw new Error('Malformed card schema.');
        if (raw.layers.length > 40) throw new Error('A card can have at most 40 layers.');
        return {
            width: Math.max(200, Math.min(2000, Number(raw.width) || 900)),
            height: Math.max(150, Math.min(2000, Number(raw.height) || 280)),
            cornerRadius: Math.max(0, Math.min(200, Number(raw.cornerRadius) || 0)),
            layers: raw.layers.slice(0, 40),
        };
    }
    app.get('/api/guilds/:guildId/cards/:type', requireApi, requireGuildAccess, wrap((req, res) => {
        const getDefault = requireCards(req, res); if (!getDefault) return;
        const gs = deps.getGuildSettings(req.params.guildId, deps.loadData());
        const custom = gs.cardSchemas?.[req.params.type];
        res.json({ schema: custom || getDefault(), isCustom: !!custom });
    }));
    app.post('/api/guilds/:guildId/cards/:type', requireApi, requireGuildAccess, rateLimit(20, 60 * 1000), wrap((req, res) => {
        if (!requireCards(req, res)) return;
        let schema;
        try { schema = sanitizeSchema(req.body?.schema); } catch (e) { return res.status(400).json({ error: e.message }); }
        const guildId = req.params.guildId;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        gs.cardSchemas = gs.cardSchemas || {};
        gs.cardSchemas[req.params.type] = schema;
        gs.settingsAuditLog = gs.settingsAuditLog || [];
        gs.settingsAuditLog.push({ key: `cards.${req.params.type}`, label: `${req.params.type} card design`, category: 'Card Designer', before: 'custom', after: 'custom', at: Date.now(), by: req.user.id, byName: req.user.username });
        gs.settingsAuditLog = gs.settingsAuditLog.slice(-200);
        deps.saveData(freshData);
        res.json({ ok: true });
    }));
    app.post('/api/guilds/:guildId/cards/:type/reset', requireApi, requireGuildAccess, rateLimit(20, 60 * 1000), wrap((req, res) => {
        const getDefault = requireCards(req, res); if (!getDefault) return;
        const guildId = req.params.guildId;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        if (gs.cardSchemas) delete gs.cardSchemas[req.params.type];
        deps.saveData(freshData);
        res.json({ ok: true, schema: getDefault() });
    }));
    app.post('/api/guilds/:guildId/cards/:type/preview', requireApi, requireGuildAccess, rateLimit(120, 60 * 1000), wrap(async (req, res) => {
        if (!requireCards(req, res)) return;
        let schema;
        try { schema = sanitizeSchema(req.body?.schema); } catch (e) { return res.status(400).json({ error: e.message }); }
        // Real sample data: the requesting admin's own Discord identity and,
        // where the leveling system actually has data for them, their real
        // level/XP/rank — synthetic numbers only fill in what genuinely has
        // no data yet (e.g. an admin with 0 tracked messages), same spirit
        // as the "don't invent stats" rule applied to the bot's real output.
        const guildId = req.params.guildId;
        const guild = deps.client.guilds.cache.get(guildId);
        const member = guild?.members.cache.get(req.user.id);
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);

        let sampleData;
        if (req.params.type === 'stock') {
            // Real current stock where the bot instance actually has it; only
            // fall back to clearly-labeled example names if no data is
            // available yet (a fresh install, or the wiki fetch hasn't
            // succeeded once) — never invented prices/rarities, matching the
            // "no fake stock" rule elsewhere in this codebase.
            let fruits = ['Ice', 'Sand', 'Dark'];
            let previousStock = ['Rocket', 'Light'];
            let stale = false, lastUpdated = 'never';
            if (deps.bfStock && deps.bfKnownFruits) {
                const snap = await deps.bfStock.getNormalStock(deps.bfKnownFruits).catch(() => null);
                if (snap?.hasData) {
                    fruits = (snap.fruits || []).map(f => f[0].toUpperCase() + f.slice(1));
                    previousStock = (snap.lastStock || []).map(f => f[0].toUpperCase() + f.slice(1));
                    stale = snap.stale;
                    lastUpdated = snap.lastSuccessAt ? new Date(snap.lastSuccessAt).toLocaleString() : 'never';
                }
            }
            sampleData = { fruits, previousStock, stale, lastUpdated, staleWarning: stale ? ' — ⚠️ data is stale' : '', server: guild?.name || 'Your Server' };
        } else {
            // Real sample data: the requesting admin's own Discord identity and,
            // where the leveling system actually has data for them, their real
            // level/XP/rank — synthetic numbers only fill in what genuinely has
            // no data yet (e.g. an admin with 0 tracked messages), same spirit
            // as the "don't invent stats" rule applied to the bot's real output.
            let level = 12, xp = 1200, xpNeeded = 2000, rank = 4, messages = 340;
            if (deps.getLevelingConfig && deps.computeLevelFromXp && deps.getTotalXp) {
                const lc = deps.getLevelingConfig(gs);
                const totalXp = deps.getTotalXp(freshData, guildId, req.user.id);
                if (totalXp > 0) {
                    const info = deps.computeLevelFromXp(lc, totalXp);
                    level = info.level; xp = info.xpIntoLevel; xpNeeded = info.xpForNextLevel;
                    if (deps.buildLevelLeaderboard) {
                        const lbRows = deps.buildLevelLeaderboard(freshData, guildId);
                        const r = lbRows.findIndex(row => row.uid === req.user.id) + 1;
                        if (r) rank = r;
                    }
                }
            }
            sampleData = {
                username: req.user.username, displayName: member?.displayName || req.user.username,
                avatarUrl: member?.user.displayAvatarURL({ extension: 'png', size: 256 }) || `https://cdn.discordapp.com/embed/avatars/0.png`,
                level, prevLevel: Math.max(0, level - 1), rank, xp, xpNeeded, messages,
                ...(typeof deps.getActivityStats === 'function' ? deps.getActivityStats(freshData, guildId, req.user.id) : {}),
                server: guild?.name || 'Your Server', count: guild?.memberCount || 1337,
            };
        }
        try {
            const buf = await deps.cardRenderer.renderCard(schema, sampleData);
            res.json({ image: `data:image/png;base64,${buf.toString('base64')}` });
        } catch (e) { res.status(400).json({ error: `Render failed: ${e.message}` }); }
    }));

    // ── Blox Fruits stock: status + manual test post. The notification tick
    // itself lives in DISCOMOD.js (it needs client.guilds access to post to
    // every guild, not just this one) — this only reads the shared cache and
    // triggers one manual post to confirm the config actually works. ────────
    app.get('/api/bloxfruits/stock', requireApi, wrap(async (req, res) => {
        if (!deps.bfStock) return res.status(501).json({ error: 'Stock checking not available on this bot instance.' });
        const snap = await deps.bfStock.getNormalStock(deps.bfKnownFruits);
        res.json(snap);
    }));
    app.post('/api/guilds/:guildId/bloxfruits/stock/test', requireApi, requireGuildAccess, rateLimit(5, 60 * 1000), wrap(async (req, res) => {
        if (!deps.bfStock) return res.status(501).json({ error: 'Stock checking not available on this bot instance.' });
        const guildId = req.params.guildId;
        const gs = deps.getGuildSettings(guildId, deps.loadData());
        if (!gs.bfStockChannelId) return res.status(400).json({ error: 'Set a notification channel first.' });
        const guild = deps.client.guilds.cache.get(guildId);
        const ch = guild?.channels.cache.get(gs.bfStockChannelId);
        if (!ch) return res.status(404).json({ error: 'That channel no longer exists.' });
        const snap = await deps.bfStock.getNormalStock(deps.bfKnownFruits);
        if (!snap.hasData) return res.status(502).json({ error: `Couldn't fetch current stock: ${snap.lastError || 'unknown error'}` });
        const capitalizedFruits = (snap.fruits || []).map(f => f[0].toUpperCase() + f.slice(1));
        let stockBuf = null;
        if (deps.cardRenderer) {
            const schema = gs.cardSchemas?.stock || deps.cardRenderer.DEFAULT_STOCK_CARD_SCHEMA;
            stockBuf = await deps.cardRenderer.renderCard(schema, {
                fruits: capitalizedFruits, stale: snap.stale,
                lastUpdated: snap.lastSuccessAt ? new Date(snap.lastSuccessAt).toLocaleString() : 'never',
                staleWarning: snap.stale ? ' — ⚠️ data is stale' : '', server: guild.name,
            }).catch(() => null);
        }
        if (stockBuf) {
            await ch.send({ content: `🧪 **Test notification** (manual, from the dashboard)`, files: [{ attachment: stockBuf, name: 'stock.png' }] })
                .catch(e => { throw new Error(`Failed to send: ${e.message}`); });
        } else {
            await ch.send({ content: `🧪 **Test notification** (manual, from the dashboard)`, embeds: [{
                title: '🍎 Blox Fruits — Normal Dealer Stock',
                description: capitalizedFruits.map(f => `• ${f}`).join('\n') || '*(none detected)*',
                color: 0xFF6B35,
                footer: { text: `Source: fan-maintained wiki${snap.stale ? ' — ⚠️ data is stale' : ''} · last confirmed ${snap.lastSuccessAt ? new Date(snap.lastSuccessAt).toLocaleString() : 'never'}` },
            }] }).catch(e => { throw new Error(`Failed to send: ${e.message}`); });
        }
        res.json({ ok: true });
    }));

    // ── XP curve preview — computed with the bot's own xpNeededForLevel/
    // totalXpForLevel via the deps passed in, never a second formula, per
    // the "must use the same calculation logic as the bot" requirement. ────
    app.get('/api/guilds/:guildId/leveling/curve-preview', requireApi, requireGuildAccess, wrap((req, res) => {
        if (typeof deps.xpNeededForLevel !== 'function' || typeof deps.totalXpForLevel !== 'function') return res.status(501).json({ error: 'Not supported by this bot version.' });
        const gs = deps.getGuildSettings(req.params.guildId, deps.loadData());
        // Preview uses whatever curve params are in the request body (so moving
        // a slider updates the table before saving), falling back to the saved
        // config only when a param is omitted.
        const saved = deps.getLevelingConfig(gs);
        const cfg = {
            curveType: req.query.curveType || saved.curveType,
            baseXp: req.query.baseXp !== undefined ? Number(req.query.baseXp) : saved.baseXp,
            growthFactor: req.query.growthFactor !== undefined ? Number(req.query.growthFactor) : saved.growthFactor,
        };
        const levels = [1, 2, 5, 10, 25, 50, 100];
        res.json({ rows: levels.map(level => ({ level, xpForThisLevel: deps.xpNeededForLevel(cfg, level), totalXp: deps.totalXpForLevel(cfg, level) })) });
    }));
    // Admin XP tools — thin wrappers around the exact logic /level set/addxp/
    // removexp use, including clearing the in-memory XP buffer on a manual
    // set (skipping that would let a delayed buffer flush silently overwrite
    // what the admin just set — the same bug the slash command itself avoids).
    app.get('/api/guilds/:guildId/leveling/member/:userId', requireApi, requireGuildAccess, wrap((req, res) => {
        const { guildId, userId } = req.params;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        const guild = deps.client.guilds.cache.get(guildId);
        const member = guild?.members.cache.get(userId);
        if (!member) return res.status(404).json({ error: 'Member not found in this server.' });
        const lc = deps.getLevelingConfig(gs);
        const totalXp = deps.getTotalXp(freshData, guildId, userId);
        const info = deps.computeLevelFromXp(lc, totalXp);
        const rows = deps.buildLevelLeaderboard(freshData, guildId);
        const rank = rows.findIndex(r => r.uid === userId) + 1;
        const activity = typeof deps.getActivityStats === 'function' ? deps.getActivityStats(freshData, guildId, userId) : { reactions: 0, voiceTime: 0, lastActivityAt: null };
        const messages = typeof deps.getMessageCount === 'function' ? deps.getMessageCount(freshData, guildId, userId, null) : 0;
        res.json({ tag: member.user.tag || member.user.username, level: info.level, xpIntoLevel: info.xpIntoLevel, xpForNextLevel: info.xpForNextLevel, totalXp, rank: rank || null, messages, reactions: activity.reactions || 0, voiceTime: activity.voiceTime || 0, lastActivityAt: activity.lastActivityAt || null });
    }));
    app.post('/api/guilds/:guildId/leveling/member/:userId/:op', requireApi, requireGuildAccess, rateLimit(30, 60 * 1000), wrap((req, res) => {
        const { guildId, userId } = req.params;
        const op = req.params.op; // 'set-level' | 'add-xp' | 'remove-xp'
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        const guild = deps.client.guilds.cache.get(guildId);
        if (!guild?.members.cache.get(userId)) return res.status(404).json({ error: 'Member not found in this server.' });
        freshData.levels = freshData.levels || {}; freshData.levels[guildId] = freshData.levels[guildId] || {};
        if (op === 'set-level') {
            const level = Math.max(0, parseInt(req.body?.value, 10) || 0);
            const lc = deps.getLevelingConfig(gs);
            const newXp = deps.totalXpForLevel(lc, level);
            freshData.levels[guildId][userId] = { xp: newXp };
        } else if (op === 'add-xp' || op === 'remove-xp') {
            const amount = Math.max(0, parseInt(req.body?.value, 10) || 0);
            const rec = freshData.levels[guildId][userId] || (freshData.levels[guildId][userId] = { xp: 0 });
            rec.xp = Math.max(0, (rec.xp || 0) + (op === 'add-xp' ? amount : -amount));
        } else {
            return res.status(404).json({ error: 'Unknown operation.' });
        }
        if (typeof deps.clearXpBuffer === 'function') deps.clearXpBuffer(guildId, userId);
        deps.saveData(freshData);
        res.json({ ok: true });
    }));

    // ── Ticket panel: repost with current design. Uses buildTicketPanel
    // directly — same function every in-Discord path calls — so this can
    // never drift from what /ticket panel would produce. ───────────────────
    app.post('/api/guilds/:guildId/tickets/panel/post', requireApi, requireGuildAccess, rateLimit(10, 60 * 1000), wrap(async (req, res) => {
        if (typeof deps.buildTicketPanel !== 'function') return res.status(501).json({ error: 'Not supported by this bot version.' });
        const guildId = req.params.guildId;
        const gs = deps.getGuildSettings(guildId, deps.loadData());
        if (!gs.ticketEnabled) return res.status(400).json({ error: 'Enable the ticket system first.' });
        const channelId = req.body?.channelId || gs.ticketPanelChannelId;
        if (!channelId) return res.status(400).json({ error: 'No panel channel set — pick one first.' });
        const guild = deps.client.guilds.cache.get(guildId);
        const ch = guild?.channels.cache.get(channelId);
        if (!ch) return res.status(404).json({ error: 'That channel no longer exists.' });
        await ch.send(deps.buildTicketPanel(gs, guild.name)).catch(e => { throw new Error(`Failed to post: ${e.message}`); });
        res.json({ ok: true });
    }));

    // ── Beli economy — read-only. See beli_commands.js's export comment:
    // every value that changes hands (rob/pay/gamble/earn) has real game
    // logic (cooldowns, odds, streaks) behind it that a raw dashboard write
    // would bypass, so there's no write endpoint here. This surfaces what
    // already exists rather than inventing a parallel "admin can just set
    // any number" path the bot's own commands don't have either. ──────────
    function requireBeliEconomy(req, res) {
        if (!deps.beliEconomy) { res.status(501).json({ error: 'Beli economy is not available on this bot instance.' }); return null; }
        return deps.beliEconomy;
    }
    app.get('/api/guilds/:guildId/beli/overview', requireApi, requireGuildAccess, wrap((req, res) => {
        const eco = requireBeliEconomy(req, res); if (!eco) return;
        const freshData = deps.loadData();
        const rows = eco.buildEconomyLeaderboard(freshData, req.params.guildId, 10);
        const guild = deps.client.guilds.cache.get(req.params.guildId);
        res.json({
            currencyName: eco.currencyName, currencyEmoji: eco.currencyEmoji,
            playerCount: Object.keys((freshData.economy && freshData.economy[req.params.guildId]) || {}).length,
            totalNetWorth: rows.reduce((sum, r) => sum + r.net, 0), // sum of top 10 only — buildEconomyLeaderboard doesn't return the full unranked set
            leaderboard: rows.map(r => ({ userId: r.uid, net: r.net, tag: guild?.members.cache.get(r.uid)?.user.tag || null })),
            shopItemCount: (eco.shopItems || []).length,
            upgradeTracks: (eco.upgradeTrackKeys || []).map(k => ({ key: k, label: eco.upgradeTracks[k].label, maxTier: eco.upgradeTracks[k].maxTier })),
        });
    }));
    // ── Beli catalog editor — prices/costs are now genuinely per-guild. ─────
    app.get('/api/guilds/:guildId/beli/catalog', requireApi, requireGuildAccess, wrap((req, res) => {
        const eco = requireBeliEconomy(req, res); if (!eco) return;
        const data = deps.loadData(); const gs = deps.getGuildSettings(req.params.guildId, data);
        const items = eco.getGuildShopItems(gs);
        const tracks = (eco.upgradeTrackKeys || []).map(k => ({
            key: k, label: eco.upgradeTracks[k].label, desc: eco.upgradeTracks[k].desc,
            maxTier: eco.upgradeTracks[k].maxTier,
            baseCost: eco.getGuildUpgradeBaseCost(k, gs),
            tierCosts: Array.from({ length: eco.upgradeTracks[k].maxTier }, (_, i) => eco.upgradeCost(k, i, gs)),
        }));
        res.json({ currencyName: eco.currencyName, currencyEmoji: eco.currencyEmoji, shopItems: items, upgradeTracks: tracks, isCustom: !!gs.beliGameConfig });
    }));
    app.post('/api/guilds/:guildId/beli/catalog', requireApi, requireGuildAccess, rateLimit(20, 60 * 1000), wrap((req, res) => {
        const eco = requireBeliEconomy(req, res); if (!eco) return;
        const data = deps.loadData(); const gs = deps.getGuildSettings(req.params.guildId, data);
        const body = req.body || {}; gs.beliGameConfig = gs.beliGameConfig || {};
        const prices = {};
        for (const item of (eco.shopItems || [])) {
            const n = Number(body.shopPrices?.[item.id]);
            if (Number.isFinite(n)) prices[item.id] = Math.max(0, Math.min(1000000000, Math.floor(n)));
        }
        const bases = {};
        for (const k of (eco.upgradeTrackKeys || [])) {
            const n = Number(body.upgradeBaseCosts?.[k]);
            if (Number.isFinite(n)) bases[k] = Math.max(0, Math.min(1000000000, Math.floor(n)));
        }
        gs.beliGameConfig.shopPrices = prices; gs.beliGameConfig.upgradeBaseCosts = bases;
        deps.saveData(data);
        res.json({ ok: true });
    }));
    app.post('/api/guilds/:guildId/beli/catalog/reset', requireApi, requireGuildAccess, rateLimit(10, 60 * 1000), wrap((req,res)=>{
        const data=deps.loadData(); const gs=deps.getGuildSettings(req.params.guildId,data); gs.beliGameConfig = gs.beliGameConfig || {}; delete gs.beliGameConfig.shopPrices; delete gs.beliGameConfig.upgradeBaseCosts; deps.saveData(data); res.json({ok:true});
    }));

    // Advanced in-game Beli game tuning. These are deliberately Beli-only
    // configuration controls; no real-money wagering is introduced.
    const BELI_GAME_FIELDS = {
        minesMaxMines: [1,19], minesGrowthFactor: [0.5,1.5],
        crashGrowthRate: [0.01,1], crashRtp: [0.5,0.99], crashMaxMultiplier: [2,10000],
        scratchCells: [3,9], lotteryTicketPrice: [1,1000000], lotteryIntervalMinutes: [5,43200],
        blackjackNaturalMult: [1,5], blackjackWinMult: [1,3], blackjackDealerStandAt: [15,21],
        kenoLowMult: [0,10], kenoMidMult: [0,20], kenoHighMult: [0,50], kenoLuckPayoutMult: [0,5],
        warPushChance: [0,0.5], warWinMult: [1,5], duelHouseCutPct: [0,0.25], duelExpiryMinutes: [0.5,60],
    };
    app.get('/api/guilds/:guildId/beli/games', requireApi, requireGuildAccess, wrap((req,res)=>{
        const eco=requireBeliEconomy(req,res);if(!eco)return; const data=deps.loadData(); const gs=deps.getGuildSettings(req.params.guildId,data); const cfg=eco.getEconomyEarnConfig(gs);
        res.json({ config: {
            minesMaxMines:cfg.minesMaxMines, minesGrowthFactor:cfg.minesGrowthFactor, crashGrowthRate:cfg.crashGrowthRate, crashRtp:cfg.crashRtp, crashMaxMultiplier:cfg.crashMaxMultiplier,
            scratchCells:cfg.scratchCells, lotteryTicketPrice:cfg.lotteryTicketPrice, lotteryIntervalMinutes:cfg.lotteryIntervalMs/60000,
            blackjackNaturalMult:cfg.blackjackNaturalMult, blackjackWinMult:cfg.blackjackWinMult, blackjackDealerStandAt:cfg.blackjackDealerStandAt,
            kenoLowMult:cfg.kenoLowMult, kenoMidMult:cfg.kenoMidMult, kenoHighMult:cfg.kenoHighMult, kenoLuckPayoutMult:cfg.kenoLuckPayoutMult,
            warPushChance:cfg.warPushChance, warWinMult:cfg.warWinMult, duelHouseCutPct:cfg.duelHouseCutPct, duelExpiryMinutes:cfg.duelExpiryMs/60000,
        }, fields:BELI_GAME_FIELDS });
    }));
    app.post('/api/guilds/:guildId/beli/games', requireApi, requireGuildAccess, rateLimit(20,60*1000), wrap((req,res)=>{
        const data=deps.loadData(); const gs=deps.getGuildSettings(req.params.guildId,data); gs.beliEarn=gs.beliEarn||{}; const b=req.body||{};
        for(const [key,[min,max]] of Object.entries(BELI_GAME_FIELDS)){
            if(b[key]===undefined) continue; const n=Number(b[key]); if(!Number.isFinite(n)||n<min||n>max) return res.status(400).json({error:`${key} must be between ${min} and ${max}.`}); gs.beliEarn[key]=n;
        }
        if(b.lotteryIntervalMinutes!==undefined) gs.beliEarn.lotteryIntervalMs=Math.round(Number(b.lotteryIntervalMinutes)*60000);
        if(b.duelExpiryMinutes!==undefined) gs.beliEarn.duelExpiryMs=Math.round(Number(b.duelExpiryMinutes)*60000);
        delete gs.beliEarn.lotteryIntervalMinutes; delete gs.beliEarn.duelExpiryMinutes;
        deps.saveData(data); res.json({ok:true});
    }));

    app.get('/api/guilds/:guildId/beli/wheel', requireApi, requireGuildAccess, wrap((req, res) => {
        const eco = requireBeliEconomy(req, res); if (!eco) return;
        if (!eco.wheelSegmentsDefaults) return res.status(501).json({ error: 'Wheel is not available on this bot instance.' });
        const gs = deps.getGuildSettings(req.params.guildId, deps.loadData());
        const saved = gs.beliEarn?.wheelSegments;
        res.json({ segments: eco.mergeWeightTable(saved, eco.wheelSegmentsDefaults), isCustom: !!saved });
    }));
    app.post('/api/guilds/:guildId/beli/wheel', requireApi, requireGuildAccess, rateLimit(20, 60 * 1000), wrap((req, res) => {
        const eco = requireBeliEconomy(req, res); if (!eco) return;
        if (!eco.wheelSegmentsDefaults) return res.status(501).json({ error: 'Wheel is not available on this bot instance.' });
        const defaults = eco.wheelSegmentsDefaults;
        const segments = req.body?.segments;
        if (!Array.isArray(segments) || segments.length !== defaults.length) return res.status(400).json({ error: `Expected exactly ${defaults.length} segments.` });
        const sanitizedInput = segments.map(s => ({ mult: s?.mult, weight: s?.weight }));
        const merged = eco.mergeWeightTable(sanitizedInput, defaults);
        const guildId = req.params.guildId;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        gs.beliEarn = gs.beliEarn || {};
        gs.beliEarn.wheelSegments = merged.map(s => ({ mult: s.mult, weight: s.weight }));
        deps.saveData(freshData);
        res.json({ ok: true, segments: merged });
    }));

    // ── Slots — same protected-label pattern as Wheel above, reusing the
    // exact same mergeWeightTable() (it's generic on {weight, mult}, doesn't
    // care that this table's display field is `sym` instead of `label`).
    app.get('/api/guilds/:guildId/beli/slots', requireApi, requireGuildAccess, wrap((req, res) => {
        const eco = requireBeliEconomy(req, res); if (!eco) return;
        if (!eco.slotSymbolsDefaults) return res.status(501).json({ error: 'Slots is not available on this bot instance.' });
        const gs = deps.getGuildSettings(req.params.guildId, deps.loadData());
        const saved = gs.beliEarn?.slotSymbols;
        res.json({ symbols: eco.mergeWeightTable(saved, eco.slotSymbolsDefaults), isCustom: !!saved });
    }));
    app.post('/api/guilds/:guildId/beli/slots', requireApi, requireGuildAccess, rateLimit(20, 60 * 1000), wrap((req, res) => {
        const eco = requireBeliEconomy(req, res); if (!eco) return;
        if (!eco.slotSymbolsDefaults) return res.status(501).json({ error: 'Slots is not available on this bot instance.' });
        const defaults = eco.slotSymbolsDefaults;
        const symbols = req.body?.symbols;
        if (!Array.isArray(symbols) || symbols.length !== defaults.length) return res.status(400).json({ error: `Expected exactly ${defaults.length} symbols.` });
        const sanitizedInput = symbols.map(s => ({ mult: s?.mult, weight: s?.weight }));
        const merged = eco.mergeWeightTable(sanitizedInput, defaults);
        const guildId = req.params.guildId;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        gs.beliEarn = gs.beliEarn || {};
        gs.beliEarn.slotSymbols = merged.map(s => ({ mult: s.mult, weight: s.weight }));
        deps.saveData(freshData);
        res.json({ ok: true, symbols: merged });
    }));

    // ── Beli economy core settings: safe guild-level bootstrap/capacity knobs.
    // These never mutate existing user balances; starting values apply only when
    // ensureEconomy() creates a brand-new record, while baseBankCapacity affects
    // the live deposit ceiling immediately. Validation is duplicated here only
    // for clear API errors; beli_commands.js remains the authoritative clamp.
    app.get('/api/guilds/:guildId/beli/core', requireApi, requireGuildAccess, wrap((req, res) => {
        const eco = requireBeliEconomy(req, res); if (!eco) return;
        const gs = deps.getGuildSettings(req.params.guildId, deps.loadData());
        res.json({ config: eco.getEconomyBaseConfig(gs), defaults: { startingWallet: eco.STARTING_WALLET, startingBank: eco.STARTING_BANK, baseBankCapacity: eco.BASE_BANK_CAPACITY } });
    }));
    app.post('/api/guilds/:guildId/beli/core', requireApi, requireGuildAccess, rateLimit(20, 60 * 1000), wrap((req, res) => {
        const eco = requireBeliEconomy(req, res); if (!eco) return;
        const b = req.body || {};
        const parse = (key, fallback, min, max) => {
            const n = Number(b[key]);
            if (b[key] === undefined) return fallback;
            if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${key} must be between ${min} and ${max}.`);
            return Math.floor(n);
        };
        const guildId = req.params.guildId;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        const before = eco.getEconomyBaseConfig(gs);
        gs.beliEconomy = { ...(gs.beliEconomy || {}) };
        gs.beliEconomy.startingWallet = parse('startingWallet', before.startingWallet, 0, 1000000000);
        gs.beliEconomy.startingBank = parse('startingBank', before.startingBank, 0, 1000000000);
        gs.beliEconomy.baseBankCapacity = parse('baseBankCapacity', before.baseBankCapacity, 100, 1000000000);
        if (gs.beliEconomy.startingBank > gs.beliEconomy.baseBankCapacity) gs.beliEconomy.startingBank = gs.beliEconomy.baseBankCapacity;
        deps.saveData(freshData);
        gs.settingsAuditLog = Array.isArray(gs.settingsAuditLog) ? gs.settingsAuditLog : [];
        gs.settingsAuditLog.push({ key: 'beliEconomy.core', label: 'Beli Economy Core', category: 'Beli Economy Core', before: JSON.stringify(before), after: JSON.stringify(eco.getEconomyBaseConfig(gs)), at: Date.now(), by: req.user.id, byName: req.user.username });
        gs.settingsAuditLog = gs.settingsAuditLog.slice(-200);
        deps.saveData(freshData);
        res.json({ ok: true, config: eco.getEconomyBaseConfig(gs) });
    }));

    // ── Beli earning actions (Daily/Weekly/Work/Crime/Rob/Trivia amounts +
    // cooldowns) plus coinflip/dice/roulette/higherLower's house-edge fields
    // (added in a later pass — see below). getEconomyEarnConfig() already
    // clamps every one of these fields to a safe range on every read,
    // including clampHouseEdge for the gambling ones (that protection lives
    // in beli_commands.js and isn't duplicated here) — this editor's own
    // validation only exists to give an admin immediate feedback on
    // obviously-invalid input before it's even saved, not as the only
    // safety net.
    // Non-gambling earn fields need only be non-negative (amounts/cooldowns).
    // The gambling fields added below (coinflip/dice/roulette/higherLower)
    // are win-chances/edge-factors (0-1) and payout multipliers (>=1) —
    // EARN_FIELD_RANGES gives those a tighter courtesy check. Either way,
    // getEconomyEarnConfig() in beli_commands.js still clamps every one of
    // these fields to its real safe range (including clampHouseEdge for the
    // gambling ones) on every read — that protection isn't duplicated here,
    // this editor's own validation only exists to give an admin immediate
    // feedback on obviously-invalid input before it's even saved.
    const EARN_FIELDS = [
        'dailyBase', 'dailyStreakCap', 'dailyStreakStep', 'dailyCooldownMs',
        'weeklyBase', 'weeklyCooldownMs',
        'workMin', 'workMax', 'workCooldownMs',
        'crimeSuccessChance', 'crimeMin', 'crimeMax', 'crimeFineMin', 'crimeFineMax', 'crimeCooldownMs',
        'robSuccessChance', 'robStealMin', 'robStealMax', 'robFailFinePct', 'robMinVictimWallet', 'robCooldownMs',
        'triviaMin', 'triviaMax', 'triviaAnswerWindowMs', 'triviaCooldownMs',
        'coinflipWinChance', 'coinflipPayoutMult',
        'diceEdgeFactor', 'dicePayoutMult',
        'rouletteColorEdgeFactor', 'rouletteColorPayoutMult', 'rouletteNumberEdgeFactor', 'rouletteNumberPayoutMult',
        'higherLowerWinChance', 'higherLowerPayoutMult',
        'limboRTP',
    ];
    const EARN_MINMAX_PAIRS = [['workMin', 'workMax'], ['crimeMin', 'crimeMax'], ['crimeFineMin', 'crimeFineMax'], ['robStealMin', 'robStealMax'], ['triviaMin', 'triviaMax']];
    // [min, max] courtesy bounds for fields where "just non-negative" isn't
    // tight enough to catch an obvious mistake (e.g. a win chance of 5.0).
    // Deliberately looser than beli_commands.js's real per-game clamps
    // (which differ per game — roulette's number bet allows a much steeper
    // edge than color, by design) — this is a sanity net, not the final
    // authority, so it uses one generous shared range per field *kind*
    // rather than duplicating each game's exact bound.
    const EARN_FIELD_RANGES = {
        coinflipWinChance: [0, 1], diceEdgeFactor: [0, 1],
        rouletteColorEdgeFactor: [0, 1], rouletteNumberEdgeFactor: [0, 1],
        higherLowerWinChance: [0, 1],
        coinflipPayoutMult: [1, 50], dicePayoutMult: [1, 50],
        rouletteColorPayoutMult: [1, 50], rouletteNumberPayoutMult: [1, 50],
        higherLowerPayoutMult: [1, 50],
        limboRTP: [0.5, 0.99],
    };
    app.get('/api/guilds/:guildId/beli/earn', requireApi, requireGuildAccess, wrap((req, res) => {
        const eco = requireBeliEconomy(req, res); if (!eco) return;
        const gs = deps.getGuildSettings(req.params.guildId, deps.loadData());
        res.json({ config: eco.getEconomyEarnConfig(gs), isCustom: !!gs.beliEarn && EARN_FIELDS.some(k => gs.beliEarn[k] !== undefined) });
    }));
    app.post('/api/guilds/:guildId/beli/earn', requireApi, requireGuildAccess, rateLimit(20, 60 * 1000), wrap((req, res) => {
        const eco = requireBeliEconomy(req, res); if (!eco) return;
        const body = req.body || {};
        const clean = {};
        for (const key of EARN_FIELDS) {
            const v = Number(body[key]);
            if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: `${key} must be a non-negative number.` });
            const range = EARN_FIELD_RANGES[key];
            if (range && (v < range[0] || v > range[1])) return res.status(400).json({ error: `${key} must be between ${range[0]} and ${range[1]}.` });
            clean[key] = v;
        }
        for (const [minKey, maxKey] of EARN_MINMAX_PAIRS) {
            if (clean[minKey] > clean[maxKey]) return res.status(400).json({ error: `${minKey} can't be greater than ${maxKey}.` });
        }
        const guildId = req.params.guildId;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        // Merge onto the existing gs.beliEarn object rather than replacing it —
        // fishLoot/huntLoot/wheelSegments already live under this same key
        // (see the gather/wheel routes above) and must survive this save.
        gs.beliEarn = { ...(gs.beliEarn || {}), ...clean };
        deps.saveData(freshData);
        res.json({ ok: true, config: eco.getEconomyEarnConfig(gs) });
    }));
    app.post('/api/guilds/:guildId/beli/earn/reset', requireApi, requireGuildAccess, rateLimit(20, 60 * 1000), wrap((req, res) => {
        const eco = requireBeliEconomy(req, res); if (!eco) return;
        const guildId = req.params.guildId;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        // Only clear the earn-amount fields — fishLoot/huntLoot/wheelSegments
        // saved under the same gs.beliEarn object must not be wiped out too.
        if (gs.beliEarn) { for (const key of EARN_FIELDS) delete gs.beliEarn[key]; }
        deps.saveData(freshData);
        res.json({ ok: true, config: eco.getEconomyEarnConfig(gs) });
    }));


    // ── Command Management — parses the REAL command definitions (the exact
    // array registered with Discord, already .toJSON()'d), so this can never
    // drift out of sync the way a hand-maintained list could. Enforcement
    // lives in DISCOMOD.js's interactionCreate gate, not here — this only
    // reads/writes gs.disabledCommands, the same object that gate checks.
    const PERM_NAMES = { '8': 'Administrator', '4': 'Ban Members', '2': 'Kick Members', '8192': 'Manage Messages', '268435456': 'Manage Roles', '16': 'Manage Channels', '32': 'Manage Server', '1099511627776': 'Moderate Members' };
    function parseCommandDefs() {
        return (deps.slashCommandDefs || []).map(c => {
            const subcommands = [];
            for (const opt of (c.options || [])) {
                if (opt.type === 1) subcommands.push({ name: opt.name, description: opt.description, group: null });
                else if (opt.type === 2) for (const sub of (opt.options || [])) subcommands.push({ name: sub.name, description: sub.description, group: opt.name });
            }
            return {
                name: c.name, description: c.description,
                permission: c.default_member_permissions ? (PERM_NAMES[c.default_member_permissions] || `Permission bit ${c.default_member_permissions}`) : 'Everyone',
                subcommands,
            };
        });
    }
    app.get('/api/guilds/:guildId/commands/manage', requireApi, requireGuildAccess, wrap((req, res) => {
        const gs = deps.getGuildSettings(req.params.guildId, deps.loadData());
        const disabled = gs.disabledCommands || {};
        res.json({ commands: parseCommandDefs(), prefixCommands: deps.prefixCommandNames || [], disabled });
    }));
    app.post('/api/guilds/:guildId/commands/manage/toggle', requireApi, requireGuildAccess, rateLimit(60, 60 * 1000), wrap((req, res) => {
        const key = String(req.body?.key || '').trim();
        const disable = !!req.body?.disable;
        if (!key) return res.status(400).json({ error: 'No command key given.' });
        const guildId = req.params.guildId;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        gs.disabledCommands = gs.disabledCommands || {};
        if (disable) gs.disabledCommands[key] = true; else delete gs.disabledCommands[key];
        gs.settingsAuditLog = gs.settingsAuditLog || [];
        gs.settingsAuditLog.push({ key: `commands.${key}`, label: `/${key}`, category: 'Command Management', before: !disable, after: disable, at: Date.now(), by: req.user.id, byName: req.user.username });
        gs.settingsAuditLog = gs.settingsAuditLog.slice(-200);
        deps.saveData(freshData);
        res.json({ ok: true });
    }));
    app.post('/api/guilds/:guildId/commands/manage/bulk', requireApi, requireGuildAccess, rateLimit(20, 60 * 1000), wrap((req, res) => {
        const { keys, disable } = req.body || {};
        if (!Array.isArray(keys) || !keys.length) return res.status(400).json({ error: 'No command keys given.' });
        const guildId = req.params.guildId;
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(guildId, freshData);
        gs.disabledCommands = gs.disabledCommands || {};
        for (const key of keys) { if (disable) gs.disabledCommands[String(key)] = true; else delete gs.disabledCommands[String(key)]; }
        deps.saveData(freshData);
        res.json({ ok: true });
    }));

    // ── Bot health snapshot ───────────────────────────────────────────
    app.get('/api/health', requireApi, wrap((req, res) => {
        const ai = typeof deps.getAiChatStatus === 'function' ? deps.getAiChatStatus() : null;
        const aiCatalogEntry = ai && deps.aiModelCatalog ? deps.aiModelCatalog.find(m => m.model === ai.model) : null;
        res.json({
            ping: Math.round(deps.client.ws.ping || 0),
            guildCount: deps.client.guilds.cache.size,
            uptimeSec: Math.round(process.uptime()),
            status: deps.client.ws.status === 0 ? 'online' : 'degraded',
            ai: ai ? { enabled: ai.enabled, provider: ai.activeProvider, model: ai.model, label: aiCatalogEntry?.label || ai.model } : null,
        });
    }));

    // ── Command reference (global — not guild-specific) ──────────────
    app.get('/api/commands', requireApi, wrap((req, res) => {
        res.json({ slash: deps.slashCommandsList || [], message: deps.messageCommandsList || [] });
    }));

    // ── Blox Fruits checker database browser ──────────────────────────
    app.get('/api/bloxfruits/updates/30', requireApi, rateLimit(60, 60 * 1000), wrap((req, res) => {
        if (!bfUpdates) return res.status(503).json({ error: 'Blox Fruits update reference module is unavailable.' });
        const q = String(req.query.q || '');
        const result = q ? bfUpdates.searchUpdate(q) : bfUpdates.cloneUpdate30();
        res.json({ source: bfUpdates.SOURCE, version: bfUpdates.VERSION, update: result, entries: bfUpdates.listUpdate30Entries(), validation: bfUpdates.validate(), related: bfUpdates.RELATED_UPDATES });
    }));

    app.get('/api/bloxfruits/checker', requireApi, rateLimit(60, 60 * 1000), wrap((req, res) => {
        const registry = deps.bfCheckerRegistry || [];
        const q = String(req.query.q || '').trim().toLowerCase();
        if (!q) {
            return res.json({ categories: registry.map(c => ({ key: c.key, label: c.label, count: c.list.length, aliasCount: Object.keys(c.aliases || {}).length })) });
        }
        const results = [];
        for (const cat of registry) {
            for (const name of cat.list) {
                if (name.toLowerCase().includes(q)) results.push({ category: cat.key, label: cat.label, match: name, canonical: name, isAlias: false, exact: name.toLowerCase() === q });
            }
            for (const [alias, canonical] of Object.entries(cat.aliases || {})) {
                if (alias.toLowerCase().includes(q)) results.push({ category: cat.key, label: cat.label, match: alias, canonical, isAlias: true, exact: alias.toLowerCase() === q });
            }
        }
        results.sort((a, b) => (b.exact - a.exact) || a.match.length - b.match.length);
        res.json({ results: results.slice(0, 40) });
    }));
    // ── Translation: per-guild settings and encrypted BYOK ----------------
    function requireTranslation(req, res) { if (!deps.translation) { res.status(501).json({ error: 'Translation module is not available on this bot instance.' }); return null; } return deps.translation; }
    function aiCatalog() { return deps.aiByok?.AI_MODEL_CATALOG || {}; }
    app.get('/api/guilds/:guildId/translation', requireApi, requireGuildAccess, wrap((req, res) => {
        const mod = requireTranslation(req, res); if (!mod) return; const data = deps.loadData(); const gs = deps.getGuildSettings(req.params.guildId, data);
        res.json({ config: mod.translationConfigSummary(gs), languages: mod.LANGUAGE_NAMES, providers: deps.aiByok?.AI_PROVIDERS || [], models: aiCatalog(), configuredProviders: deps.aiByok?.listGuildApiKeys ? deps.aiByok.listGuildApiKeys(data, req.params.guildId) : [] });
    }));
    app.post('/api/guilds/:guildId/translation', requireApi, requireGuildAccess, rateLimit(30, 60 * 1000), wrap((req, res) => {
        const mod = requireTranslation(req, res); if (!mod) return; const data = deps.loadData(); const gs = deps.getGuildSettings(req.params.guildId, data); const current = mod.ensureTranslationConfig(gs); const body = req.body || {}; const clean = { ...current };
        for (const k of ['enabled','autoEnabled','autoReply','showOriginal']) if (body[k] !== undefined) clean[k] = !!body[k];
        for (const k of ['defaultSource','defaultTarget']) if (body[k] !== undefined) { const v = String(body[k]).toLowerCase(); if (!mod.LANGUAGE_NAMES[v]) return res.status(400).json({ error: `Unsupported language: ${v}` }); clean[k] = v; }
        if (body.autoChannelIds !== undefined) { if (!Array.isArray(body.autoChannelIds)) return res.status(400).json({ error: 'autoChannelIds must be an array.' }); clean.autoChannelIds = [...new Set(body.autoChannelIds.map(String).filter(Boolean))].slice(0,50); }
        if (body.provider !== undefined) clean.provider = String(body.provider).toLowerCase(); if (body.model !== undefined) clean.model = String(body.model);
        const catalog = aiCatalog()[clean.model]; if (!catalog || catalog.provider !== clean.provider) return res.status(400).json({ error: 'Selected translation model does not belong to the selected provider.' });
        if (body.maxInputChars !== undefined) { const n=Number(body.maxInputChars); if (!Number.isInteger(n)||n<100||n>12000) return res.status(400).json({ error:'maxInputChars must be 100-12000.'}); clean.maxInputChars=n; }
        if (body.messageTemplate !== undefined) { const v=String(body.messageTemplate); if (!v||v.length>1500) return res.status(400).json({error:'messageTemplate must be 1-1500 characters.'}); clean.messageTemplate=v; }
        gs.translation=clean; deps.saveData(data); res.json({ ok:true, config: mod.translationConfigSummary(gs) });
    }));
    app.post('/api/guilds/:guildId/translation/key', requireApi, requireGuildAccess, rateLimit(20, 60 * 1000), wrap((req,res)=>{
        const ai=deps.aiByok; if(!ai?.setGuildApiKey) return res.status(501).json({error:'BYOK storage is not available.'}); const provider=String(req.body?.provider||'').toLowerCase(); const key=String(req.body?.apiKey||'').trim();
        if(!ai.AI_PROVIDERS.includes(provider)) return res.status(400).json({error:'Unsupported provider.'}); if(!key||key.length>300) return res.status(400).json({error:'API key is required and must be 300 characters or fewer.'});
        const data=deps.loadData(); ai.setGuildApiKey(data,req.params.guildId,provider,key); deps.saveData(data); res.json({ok:true,configuredProviders:ai.listGuildApiKeys(data,req.params.guildId)});
    }));
    app.delete('/api/guilds/:guildId/translation/key/:provider', requireApi, requireGuildAccess, rateLimit(20, 60 * 1000), wrap((req,res)=>{
        const ai=deps.aiByok; if(!ai?.removeGuildApiKey) return res.status(501).json({error:'BYOK storage is not available.'}); const provider=String(req.params.provider||'').toLowerCase(); if(!ai.AI_PROVIDERS.includes(provider)) return res.status(400).json({error:'Unsupported provider.'}); const data=deps.loadData(); const removed=ai.removeGuildApiKey(data,req.params.guildId,provider); deps.saveData(data); res.json({ok:true,removed,configuredProviders:ai.listGuildApiKeys(data,req.params.guildId)});
    }));
    app.post('/api/guilds/:guildId/translation/test', requireApi, requireGuildAccess, rateLimit(10, 60 * 1000), wrap(async(req,res)=>{
        const mod=requireTranslation(req,res); if(!mod) return; const data=deps.loadData(); const gs=deps.getGuildSettings(req.params.guildId,data); const cfg=mod.ensureTranslationConfig(gs); const text=String(req.body?.text||'').trim(); if(!text) return res.status(400).json({error:'Enter text to translate.'});
        const source=String(req.body?.source||cfg.defaultSource||'auto').toLowerCase(); const target=String(req.body?.target||cfg.defaultTarget||'en').toLowerCase(); if(!mod.LANGUAGE_NAMES[source]||!mod.LANGUAGE_NAMES[target]) return res.status(400).json({error:'Unsupported source or target language.'});
        const result=await mod.translateText({text,source,target,cfg,data,guildId:req.params.guildId,ai:deps.aiByok}); if(result.error) return res.status(400).json({error:result.error}); res.json({ok:true,result,formatted:mod.formatTranslationResult(result,cfg)});
    }));

    // ── Dashboard AI Support: server-admin BYOK, never returns raw keys ----
    function requireAiByok(req,res){if(!deps.aiByok){res.status(501).json({error:'AI BYOK subsystem is not available on this bot instance.'});return null;}return deps.aiByok;}
    function supportConfig(gs){const c=gs.aiSupport&&typeof gs.aiSupport==='object'?gs.aiSupport:{};return{enabled:!!c.enabled,provider:String(c.provider||'groq'),model:String(c.model||'groq'),systemPrompt:String(c.systemPrompt||'You are the DISCOMOD Support Assistant. Help administrators understand their selected server.'),maxHistory:Math.max(2,Math.min(40,Number(c.maxHistory)||12))};}
    app.get('/api/guilds/:guildId/ai-support',requireApi,requireGuildAccess,wrap((req,res)=>{const ai=requireAiByok(req,res);if(!ai)return;const data=deps.loadData();const gs=deps.getGuildSettings(req.params.guildId,data);res.json({config:supportConfig(gs),providers:ai.AI_PROVIDERS||[],models:ai.AI_MODEL_CATALOG||{},configuredProviders:ai.listGuildApiKeys?ai.listGuildApiKeys(data,req.params.guildId):[]});}));
    app.post('/api/guilds/:guildId/ai-support',requireApi,requireGuildAccess,rateLimit(30,60*1000),wrap((req,res)=>{const ai=requireAiByok(req,res);if(!ai)return;const data=deps.loadData();const gs=deps.getGuildSettings(req.params.guildId,data);const c=supportConfig(gs);const b=req.body||{};if(b.enabled!==undefined)c.enabled=!!b.enabled;if(b.provider!==undefined)c.provider=String(b.provider).toLowerCase();if(b.model!==undefined)c.model=String(b.model);if(b.systemPrompt!==undefined){c.systemPrompt=String(b.systemPrompt);if(c.systemPrompt.length>6000)return res.status(400).json({error:'System prompt must be 6,000 characters or fewer.'});}if(b.maxHistory!==undefined){const n=Number(b.maxHistory);if(!Number.isInteger(n)||n<2||n>40)return res.status(400).json({error:'maxHistory must be 2-40.'});c.maxHistory=n;}const cat=ai.AI_MODEL_CATALOG?.[c.model];if(!cat||cat.provider!==c.provider)return res.status(400).json({error:'Selected model does not belong to the selected provider.'});gs.aiSupport=c;deps.saveData(data);res.json({ok:true,config:c});}));
    app.post('/api/guilds/:guildId/ai-support/key',requireApi,requireGuildAccess,rateLimit(20,60*1000),wrap((req,res)=>{const ai=requireAiByok(req,res);if(!ai)return;const provider=String(req.body?.provider||'').toLowerCase();const key=String(req.body?.apiKey||'').trim();if(!ai.AI_PROVIDERS.includes(provider))return res.status(400).json({error:'Unsupported provider.'});if(!key||key.length>300)return res.status(400).json({error:'API key is required and must be 300 characters or fewer.'});const data=deps.loadData();ai.setGuildApiKey(data,req.params.guildId,provider,key);deps.saveData(data);res.json({ok:true,configuredProviders:ai.listGuildApiKeys(data,req.params.guildId)});}));
    app.delete('/api/guilds/:guildId/ai-support/key/:provider',requireApi,requireGuildAccess,rateLimit(20,60*1000),wrap((req,res)=>{const ai=requireAiByok(req,res);if(!ai)return;const provider=String(req.params.provider||'').toLowerCase();if(!ai.AI_PROVIDERS.includes(provider))return res.status(400).json({error:'Unsupported provider.'});const data=deps.loadData();const removed=ai.removeGuildApiKey(data,req.params.guildId,provider);deps.saveData(data);res.json({ok:true,removed,configuredProviders:ai.listGuildApiKeys(data,req.params.guildId)});}));
    app.post('/api/guilds/:guildId/ai-support/chat',requireApi,requireGuildAccess,rateLimit(30,60*1000),wrap(async(req,res)=>{const ai=requireAiByok(req,res);if(!ai)return;const guildId=req.params.guildId;const data=deps.loadData();const gs=deps.getGuildSettings(guildId,data);const cfg=supportConfig(gs);if(!cfg.enabled)return res.status(403).json({error:'Dashboard AI Support is disabled for this server.'});const provider=String(req.body?.provider||cfg.provider).toLowerCase();const model=String(req.body?.model||cfg.model);const cat=ai.AI_MODEL_CATALOG?.[model];if(!cat||cat.provider!==provider)return res.status(400).json({error:'Selected model is invalid for the selected provider.'});const key=ai.getGuildApiKey(data,guildId,provider);if(!key)return res.status(400).json({error:`No encrypted ${provider} BYOK key is configured for this server.`});const message=String(req.body?.message||'').trim();if(!message||message.length>8000)return res.status(400).json({error:'Message must be 1-8,000 characters.'});const incoming=Array.isArray(req.body?.history)?req.body.history:[];const history=incoming.filter(m=>m&&(m.role==='user'||m.role==='assistant')&&typeof m.content==='string').slice(-(cfg.maxHistory*2));const guild=deps.client.guilds.cache.get(guildId);const system=`${cfg.systemPrompt}\n\nSelected Discord server: ${guild?.name||guildId}.\nGuild ID: ${guildId}.\nYou are a support assistant only. This chat endpoint does not perform configuration mutations. Never claim that you changed a setting. Never ask the administrator to reveal an API key.`;const result=await ai.callAIProvider(cat,key,[{role:'system',content:system},...history,{role:'user',content:message}]);res.json({ok:true,provider:cat.provider,model:cat.label,content:String(result||'')});}));

    // ── Owner-only Math Lab ─────────────────────────────────────────────────
    function requireMathOwner(req, res) {
        if (!deps.isSuperUser?.(req.user.id)) { res.status(403).json({ error: 'Owner only.' }); return false; }
        if (!mathMod) { res.status(501).json({ error: 'Math module is not available on this bot instance.' }); return false; }
        return true;
    }
    app.get('/api/math/config', requireApi, wrap((req, res) => {
        if (!requireMathOwner(req, res)) return;
        const data = deps.loadData();
        const cfg = mathMod.getMathConfig();
        res.json({
            ...cfg,
            persisted: {
                mathDefaultPrecision: Number(data.botConfig?.mathDefaultPrecision || 50),
                crashTimeoutMs: Number(data.botConfig?.crashTimeoutMs ?? 30000),
            },
        });
    }));
    app.get('/api/math/status', requireApi, rateLimit(20, 60 * 1000), wrap(async (req, res) => {
        if (!requireMathOwner(req, res)) return;
        res.json({ ok: true, backends: await mathMod.getMathStatus(), config: mathMod.getMathConfig() });
    }));
    app.post('/api/math/config', requireApi, rateLimit(20, 60 * 1000), wrap((req, res) => {
        if (!requireMathOwner(req, res)) return;
        const body = req.body || {};
        const ram = Number(body.ramLimitMb);
        const timeoutS = Number(body.timeoutS);
        if (!Number.isInteger(ram) || ram < 64 || ram > 32768) return res.status(400).json({ error: 'ramLimitMb must be an integer from 64-32768.' });
        if (!Number.isInteger(timeoutS) || timeoutS < 1 || timeoutS > 300) return res.status(400).json({ error: 'timeoutS must be an integer from 1-300 seconds.' });
        const data = deps.loadData();
        data.botConfig = data.botConfig || {};
        data.botConfig.mathRamLimitMb = ram;
        data.botConfig.mathTimeoutS = timeoutS;
        if (body.mathDefaultPrecision !== undefined) {
            const precision = Number(body.mathDefaultPrecision);
            if (!Number.isInteger(precision) || precision < 1 || precision > 100000) return res.status(400).json({ error: 'mathDefaultPrecision must be an integer from 1-100000.' });
            data.botConfig.mathDefaultPrecision = precision;
        }
        if (body.crashTimeoutMs !== undefined) {
            const crash = Number(body.crashTimeoutMs);
            if (!Number.isInteger(crash) || crash < 0 || crash > 3600000) return res.status(400).json({ error: 'crashTimeoutMs must be 0-3600000.' });
            data.botConfig.crashTimeoutMs = crash;
        }
        deps.saveData(data);
        const cfg = mathMod.setMathConfig({ ramLimitMb: ram, timeoutS });
        res.json({ ok: true, ...cfg, persisted: { mathDefaultPrecision: Number(data.botConfig.mathDefaultPrecision || 50), crashTimeoutMs: Number(data.botConfig.crashTimeoutMs ?? 30000) } });
    }));
    app.post('/api/math/restart', requireApi, rateLimit(10, 60 * 1000), wrap((req, res) => {
        if (!requireMathOwner(req, res)) return;
        mathMod.mathWorker.restart('Owner requested a Math Worker restart');
        res.json({ ok: true, message: 'Math Worker restarted.' });
    }));

    // ── Invite attribution dashboard ───────────────────────────────────────
    app.get('/api/guilds/:guildId/invites', requireApi, requireGuildAccess, wrap((req, res) => {
        const guildId = req.params.guildId;
        const data = deps.loadData();
        const rec = data.inviteTracker?.[guildId] || { snapshot: {}, members: {}, lastRefreshAt: 0 };
        const rows = Object.entries(rec.members || {}).map(([memberId, v]) => ({ memberId, ...v }));
        const counts = new Map();
        for (const r of rows) if (r.inviterId) counts.set(r.inviterId, (counts.get(r.inviterId) || 0) + 1);
        const leaderboard = [...counts.entries()].map(([inviterId, joins]) => ({ inviterId, joins })).sort((a,b)=>b.joins-a.joins).slice(0,50);
        res.json({ lastRefreshAt: rec.lastRefreshAt || 0, trackedJoins: rows.length, inviteCodes: Object.keys(rec.snapshot || {}).length, recent: rows.sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,100), leaderboard });
    }));
    app.post('/api/guilds/:guildId/invites/refresh', requireApi, requireGuildAccess, rateLimit(5, 60 * 1000), wrap(async (req, res) => {
        if (!deps.client.guilds.cache.has(req.params.guildId)) return res.status(404).json({ error: 'Server not found.' });
        const guild = deps.client.guilds.cache.get(req.params.guildId);
        let invites;
        try { invites = await guild.invites.fetch(); } catch (e) { return res.status(502).json({ error: `Could not fetch invites: ${e.message}` }); }
        const data = deps.loadData();
        data.inviteTracker = data.inviteTracker || {};
        const rec = data.inviteTracker[req.params.guildId] || { snapshot: {}, members: {}, lastRefreshAt: 0 };
        rec.snapshot = {};
        for (const inv of invites.values()) rec.snapshot[inv.code] = { uses: inv.uses || 0, inviterId: inv.inviter?.id || null, inviterTag: inv.inviter?.tag || inv.inviter?.username || null, channelId: inv.channelId || null };
        rec.lastRefreshAt = Date.now();
        data.inviteTracker[req.params.guildId] = rec;
        deps.saveData(data);
        res.json({ ok: true, inviteCodes: Object.keys(rec.snapshot).length, lastRefreshAt: rec.lastRefreshAt });
    }));

    app.post('/api/guilds/:guildId/leave/test', requireApi, requireGuildAccess, rateLimit(10,60*1000), wrap(async (req,res)=>{
        const guildId=req.params.guildId, data=deps.loadData(), gs=deps.getGuildSettings(guildId,data), guild=deps.client.guilds.cache.get(guildId);
        const ch=guild?.channels.cache.get(gs.leaveChannelId); if(!ch?.isTextBased?.()) return res.status(400).json({error:'Leave channel is not configured or no longer exists.'});
        const me=guild.members.cache.get(req.user.id); if(!me) return res.status(400).json({error:'Your dashboard account is not a member of this server.'});
        const msg=String(gs.leaveMessage||'Goodbye {username}!');
        if(gs.leaveEmbedEnabled!==false && deps.cardRenderer){ const schema=gs.cardSchemas?.leave||deps.cardRenderer.DEFAULT_LEAVE_CARD_SCHEMA; const buf=await deps.cardRenderer.renderCard(schema,{displayName:me.displayName||req.user.username,avatarUrl:me.user.displayAvatarURL({extension:'png',size:256}),server:guild.name,count:guild.memberCount}).catch(()=>null); if(buf){ await ch.send({content:msg,files:[{attachment:buf,name:'leave.png'}],allowedMentions:{users:[]}}); return res.json({ok:true,renderer:true}); } }
        await ch.send({content:msg,embeds:gs.leaveEmbedEnabled!==false?[{description:msg,color:Number(gs.leaveEmbedColor||0xFF667A)}]:undefined,allowedMentions:{users:[]}}); res.json({ok:true,renderer:false});
    }));

    app.get('/api/guilds/:guildId/settings', requireApi, requireGuildAccess, wrap((req, res) => {
        const gs = deps.getGuildSettings(req.params.guildId, deps.loadData());
        res.json(gs);
    }));
    app.post('/api/guilds/:guildId/settings', requireApi, requireGuildAccess, wrap((req, res) => {
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(req.params.guildId, freshData);
        const applied = applySettingsUpdate(gs, req.body, req.user);
        deps.saveData(freshData);
        res.json({ ok: true, applied });
    }));
    app.post('/api/guilds/:guildId/setup/complete', requireApi, requireGuildAccess, wrap((req, res) => {
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(req.params.guildId, freshData);
        const enableDetections = !!(req.body && req.body.enableDetections);
        if (enableDetections) {
            gs.tradeRedirectEnabled = true;
            gs.serviceRedirectEnabled = true;
            gs.scamEnabled = true;
            gs.scamWarnEnabled = true;
            gs.checksEnabled = true;
            gs.noAffiliationEnabled = true;
            gs.aiEnabled = true;
        }
        gs.serverSetupComplete = true;
        deps.saveData(freshData);
        res.json({ ok: true, enableDetections });
    }));
    app.post('/api/guilds/:guildId/reaction-roles', requireApi, requireGuildAccess, wrap(async (req, res) => {
        const { channelId, messageId, emoji, roleId } = req.body || {};
        if (!channelId || !messageId || !emoji || !roleId) return res.status(400).json({ error: 'channelId, messageId, emoji, and roleId are all required.' });
        const guild = deps.client.guilds.cache.get(req.params.guildId);
        const channel = guild && guild.channels.cache.get(channelId);
        if (!channel || !channel.isTextBased || !channel.isTextBased()) return res.status(400).json({ error: 'Channel not found in this server.' });
        let message;
        try { message = await channel.messages.fetch(messageId); }
        catch { return res.status(400).json({ error: 'Could not find that message in that channel.' }); }
        try { await message.react(emoji); }
        catch (e) { return res.status(400).json({ error: 'Could not react with that emoji — make sure it is valid and the bot can use it.' }); }
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(req.params.guildId, freshData);
        gs.reactionRoles = gs.reactionRoles || {};
        gs.reactionRoles[messageId] = gs.reactionRoles[messageId] || [];
        gs.reactionRoles[messageId].push({ emoji: String(emoji), roleId: String(roleId) });
        deps.saveData(freshData);
        res.json({ ok: true });
    }));
    app.delete('/api/guilds/:guildId/reaction-roles/:messageId/:index', requireApi, requireGuildAccess, wrap((req, res) => {
        const freshData = deps.loadData();
        const gs = deps.getGuildSettings(req.params.guildId, freshData);
        const list = gs.reactionRoles && gs.reactionRoles[req.params.messageId];
        const idx = parseInt(req.params.index, 10);
        if (!list || !list[idx]) return res.status(404).json({ error: 'Binding not found.' });
        list.splice(idx, 1);
        if (!list.length) delete gs.reactionRoles[req.params.messageId];
        deps.saveData(freshData);
        res.json({ ok: true });
    }));

    app.use((req, res) => res.status(404).send('Not found.'));

    const server = app.listen(PORT, () => console.log(`[dashboard] Listening on http://localhost:${PORT} (redirect URI: ${REDIRECT_URI})`));
    return server;
}

module.exports = { startDashboard, SETTINGS_SCHEMA, applySettingsUpdate, canManageGuild };