'use strict';
/* ══════════════════════════════════════════════════════════════════════
   DISCOMOD DASHBOARD — client application
   Vanilla JS, no build step, no framework — matches the rest of this
   project. One shell (index.html) + this router decide what to render
   based on the URL; all real data comes from the JSON API in dashboard.js.
   ══════════════════════════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════════
//  API CLIENT
// ══════════════════════════════════════════════════════════
const API = {
  async _handle(res) {
    if (res.status === 401) { location.href = '/'; throw new Error('Not authenticated'); }
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json();
  },
  get(url) { return fetch(url, { credentials: 'same-origin' }).then(API._handle); },
  post(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(API._handle);
  },
  del(url) { return fetch(url, { method: 'DELETE', credentials: 'same-origin' }).then(API._handle); },
};

// ══════════════════════════════════════════════════════════
//  SMALL HELPERS
// ══════════════════════════════════════════════════════════
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function guildIconUrl(g) {
  if (g && g.icon) return `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.${String(g.icon).startsWith('a_') ? 'gif' : 'png'}?size=64`;
  return null;
}
function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}
function iconOrInitials(g, sizeClass) {
  const url = guildIconUrl(g);
  return url
    ? `<img class="${sizeClass}" src="${url}" alt="" loading="lazy">`
    : `<div class="${sizeClass} guild-icon">${esc(initials(g.name))}</div>`;
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ══════════════════════════════════════════════════════════
//  TOASTS
// ══════════════════════════════════════════════════════════
function toast(message, kind = 'ok') {
  const stack = qs('#toast-stack');
  if (!stack) return;
  const node = el(`<div class="toast ${kind}">${esc(message)}</div>`);
  stack.appendChild(node);
  setTimeout(() => { node.style.opacity = '0'; node.style.transition = 'opacity .2s'; setTimeout(() => node.remove(), 200); }, 3200);
}

// ══════════════════════════════════════════════════════════
//  APP ROOT / TOPBAR
// ══════════════════════════════════════════════════════════
const app = qs('#app');

function renderChrome() {
  document.body.innerHTML = `
    <div class="topbar">
      <a href="/dashboard" class="brand" data-link>
        <div class="brand-mark">🤖</div>
        <div class="brand-name">DISCOMOD</div>
      </a>
      <div id="topbar-right" style="display:flex;align-items:center;gap:14px;"></div>
    </div>
    <div id="app"></div>
    <div class="toast-stack" id="toast-stack"></div>
  `;
  return qs('#app');
}

async function fillTopbarUser() {
  const right = qs('#topbar-right');
  if (!right) return;
  try {
    const me = await API.get('/api/me');
    right.innerHTML = `
      <button class="btn btn-ghost btn-sm cmdk-trigger" id="cmdk-trigger" type="button">🔍 <span class="cmdk-trigger-label">Search</span><kbd>⌘K</kbd></button>
      <span class="status-pill"><span class="status-dot"></span>Online</span>
      <div class="user-chip">
        <img class="user-avatar" src="${esc(me.user.avatarUrl)}" alt="">
        <span class="user-name">${esc(me.user.username)}</span>
      </div>
      ${me.user.superUser ? '<a href="/dashboard/math" class="link-btn">👑 Math Lab</a>' : ''}
      <a href="/auth/logout" class="link-btn">Log out</a>
    `;
    qs('#cmdk-trigger')?.addEventListener('click', openPalette);
    return me;
  } catch { /* landing page etc. — not authenticated, leave chrome minimal */
    right.innerHTML = `<a href="/auth/login" class="btn btn-ghost btn-sm">Sign in</a>`;
    return null;
  }
}

// ══════════════════════════════════════════════════════════
//  ROUTER
// ══════════════════════════════════════════════════════════
function parseRoute(pathname) {
  if (pathname === '/' ) return { view: 'landing' };
  if (pathname === '/dashboard' || pathname === '/dashboard/') return { view: 'picker' };
  let m;
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/setup\/?$/))) return { view: 'setup', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/reaction-roles\/?$/))) return { view: 'reaction-roles', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/applications\/?$/))) return { view: 'applications', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/translation\/?$/))) return { view: 'translation', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/ai-support\/?$/))) return { view: 'ai-support', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/tickets\/?$/))) return { view: 'tickets', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/ticketdesigner\/?$/))) return { view: 'ticketdesigner', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/exile\/?$/))) return { view: 'exile', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/automod\/?$/))) return { view: 'automod', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/honeypot\/?$/))) return { view: 'honeypot', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/appeals\/?$/))) return { view: 'appeals', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/appeal-form\/?$/))) return { view: 'appeal-form', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/carry\/?$/))) return { view: 'carry', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/domains\/?$/))) return { view: 'domains', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/verification\/?$/))) return { view: 'verification', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/cards\/?$/))) return { view: 'cards', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/leave\/?$/))) return { view: 'leave', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/invites\/?$/))) return { view: 'invites', guildId: m[1] };
  if (pathname === '/dashboard/math' || pathname === '/dashboard/math/') return { view: 'math-owner' };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/xpcurve\/?$/))) return { view: 'xpcurve', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/beli\/?$/))) return { view: 'beli', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/settings\/?$/))) return { view: 'settings', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/leaderboard\/?$/))) return { view: 'leaderboard', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/cases\/?$/))) return { view: 'cases', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/tags\/?$/))) return { view: 'tags', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/activity\/?$/))) return { view: 'activity', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/bloxfruits\/?$/))) return { view: 'bloxfruits', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/bloxupdates\/?$/))) return { view: 'bloxupdates', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/commands\/?$/))) return { view: 'commands', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/commandmanager\/?$/))) return { view: 'commandmanager', guildId: m[1] };
  if ((m = pathname.match(/^\/dashboard\/([^/]+)\/?$/))) return { view: 'overview', guildId: m[1] };
  return { view: 'notfound' };
}

// `group` drives the section labels the sidebar renders between clusters of
// items (see renderNavGroups below) — null/omitted means "no label, sits at
// the top". Grouped rather than flat so new pages (Carry Service, Appeals)
// have an obvious home instead of growing the list as one long column.
const NAV_ITEMS = [
  { view: 'overview', path: g => `/dashboard/${g}`, icon: '🛰️', label: 'Overview' },
  { view: 'tickets', path: g => `/dashboard/${g}/tickets`, icon: '🎫', label: 'Tickets', group: 'Moderation' },
  { view: 'ticketdesigner', path: g => `/dashboard/${g}/ticketdesigner`, icon: '🖌️', label: 'Ticket Designer', group: 'Moderation' },
  { view: 'exile', path: g => `/dashboard/${g}/exile`, icon: '⛓️', label: 'Exile', group: 'Moderation' },
  { view: 'automod', path: g => `/dashboard/${g}/automod`, icon: '🚫', label: 'Custom AutoMod', group: 'Moderation' },
  { view: 'honeypot', path: g => `/dashboard/${g}/honeypot`, icon: '🍯', label: 'Honeypot', group: 'Moderation' },
  { view: 'appeals', path: g => `/dashboard/${g}/appeals`, icon: '📩', label: 'Appeals', group: 'Moderation' },
  { view: 'domains', path: g => `/dashboard/${g}/domains`, icon: '🌐', label: 'Domain Allowlist', group: 'Reference' },
  { view: 'verification', path: g => `/dashboard/${g}/verification`, icon: '🔐', label: 'Verification', group: 'Moderation' },
  { view: 'applications', path: g => `/dashboard/${g}/applications`, icon: '📋', label: 'Applications', group: 'Community' },
  { view: 'appeal-form', path: g => `/dashboard/${g}/appeal-form`, icon: '📝', label: 'Appeal Form', group: 'Community' },
  { view: 'carry', path: g => `/dashboard/${g}/carry`, icon: '🎮', label: 'Carry Service', group: 'Community' },
  { view: 'translation', path: g => `/dashboard/${g}/translation`, icon: '🌐', label: 'Translation', group: 'AI & Language' },
  { view: 'ai-support', path: g => `/dashboard/${g}/ai-support`, icon: '🤖', label: 'AI Support', group: 'AI & Language' },
  { view: 'members', path: g => `/dashboard/${g}/members`, icon: '👥', label: 'Members', group: 'Community' },
  { view: 'cards', path: g => `/dashboard/${g}/cards`, icon: '🎨', label: 'Card Designer', group: 'Design' },
  { view: 'leave', path: g => `/dashboard/${g}/leave`, icon: '👋', label: 'Leave Messages', group: 'Design' },
  { view: 'invites', path: g => `/dashboard/${g}/invites`, icon: '🕵️', label: 'Who Invited Who', group: 'Community' },
  { view: 'xpcurve', path: g => `/dashboard/${g}/xpcurve`, icon: '📊', label: 'XP Curve', group: 'Leveling' },
  { view: 'beli', path: g => `/dashboard/${g}/beli`, icon: '💰', label: 'Beli Economy', group: 'Economy' },
  { view: 'cases', path: g => `/dashboard/${g}/cases`, icon: '📁', label: 'Case Lookup', group: 'Moderation' },
  { view: 'activity', path: g => `/dashboard/${g}/activity`, icon: '📝', label: 'Activity Log', group: 'Moderation' },
  { view: 'leaderboard', path: g => `/dashboard/${g}/leaderboard`, icon: '🏆', label: 'Leaderboard', group: 'Community' },
  { view: 'tags', path: g => `/dashboard/${g}/tags`, icon: '🏷️', label: 'Tags', group: 'Community' },
  { view: 'bloxfruits', path: g => `/dashboard/${g}/bloxfruits`, icon: '🍎', label: 'Blox Fruits Data', group: 'Blox Fruits' },
  { view: 'bloxupdates', path: g => `/dashboard/${g}/bloxfruits?tab=update30`, icon: '📰', label: 'Update 30 Reference', group: 'Blox Fruits' },
  { view: 'commands', path: g => `/dashboard/${g}/commands`, icon: '⌨️', label: 'Commands', group: 'Reference' },
  { view: 'commandmanager', path: g => `/dashboard/${g}/commandmanager`, icon: '🎚️', label: 'Command Management', group: 'Reference' },
];
function renderNavGroups(activeView, guildId) {
  let html = '', lastGroup;
  for (const item of NAV_ITEMS) {
    if (item.group !== lastGroup) { if (item.group) html += `<div class="nav-section-label">${esc(item.group)}</div>`; lastGroup = item.group; }
    html += `<a href="${item.path(guildId)}" data-link class="nav-item ${activeView === item.view ? 'active' : ''}"><span class="icon">${item.icon}</span>${esc(item.label)}</a>`;
  }
  return html;
}

// ══════════════════════════════════════════════════════════
//  LIGHTWEIGHT AUTO-REFRESH — periodic re-fetch for pages where "live-ish"
//  data matters (Overview, Leaderboard). Deliberately NOT a WebSocket
//  server: this app has no build step and no extra runtime dependency,
//  and plain polling is trivial to reason about correctly, whereas wiring
//  push events from every mutation point in a 28k-line bot is a much
//  bigger, harder-to-verify change for the same practical benefit on a
//  dashboard nobody is staring at second-to-second. Only ONE poll timer
//  is ever active — router() clears it on every navigation, so leaving a
//  page always stops its refresh instead of stacking up background work.
let activePollTimer = null;
function stopPolling() { if (activePollTimer) { clearInterval(activePollTimer); activePollTimer = null; } }
function startPolling(fn, ms) { stopPolling(); activePollTimer = setInterval(fn, ms); }

async function router() {
  stopPolling();
  const route = parseRoute(location.pathname);
  const root = renderChrome();

  if (route.view === 'landing') {
    // Landing has its own lightweight header state; skip the authed fetch spam.
    try {
      const me = await API.get('/api/me').catch(() => null);
      if (me) { location.replace('/dashboard'); return; }
    } catch {}
    qs('#topbar-right').innerHTML = `<a href="/auth/login" class="btn btn-primary btn-sm">Sign in with Discord</a>`;
    renderLanding(root);
    return;
  }

  const me = await fillTopbarUser();
  if (!me) { location.replace('/'); return; }

  if (route.view === 'picker') return renderPicker(root, me);
  if (route.view === 'overview') return renderOverview(root, route.guildId, me);
  if (route.view === 'settings') return renderSettingsApp(root, route.guildId, me);
  if (route.view === 'leaderboard') return renderLeaderboard(root, route.guildId, me);
  if (route.view === 'cases') return renderCases(root, route.guildId, me);
  if (route.view === 'tickets') return renderTickets(root, route.guildId, me);
  if (route.view === 'ticketdesigner') return renderTicketDesigner(root, route.guildId, me);
  if (route.view === 'exile') return renderExile(root, route.guildId, me);
  if (route.view === 'automod') return renderAutomod(root, route.guildId, me);
  if (route.view === 'honeypot') return renderHoneypot(root, route.guildId, me);
  if (route.view === 'appeals') return renderAppeals(root, route.guildId, me);
  if (route.view === 'appeal-form') return renderAppealForm(root, route.guildId, me);
  if (route.view === 'carry') return renderCarryService(root, route.guildId, me);
  if (route.view === 'domains') return renderDomainAllowlist(root, route.guildId, me);
  if (route.view === 'verification') return renderVerificationSettings(root, route.guildId, me);
  if (route.view === 'applications') return renderApplications(root, route.guildId, me);
  if (route.view === 'translation') return renderTranslation(root, route.guildId, me);
  if (route.view === 'ai-support') return renderAiSupport(root, route.guildId, me);
  if (route.view === 'members') return renderMembers(root, route.guildId, me);
  if (route.view === 'cards') return renderCardDesigner(root, route.guildId, me);
  if (route.view === 'leave') return renderLeaveSettings(root, route.guildId, me);
  if (route.view === 'invites') return renderInviteAttribution(root, route.guildId, me);
  if (route.view === 'math-owner') return renderMathOwner(root, me);
  if (route.view === 'xpcurve') return renderXpCurve(root, route.guildId, me);
  if (route.view === 'beli') return renderBeliEconomy(root, route.guildId, me);
  if (route.view === 'tags') return renderTags(root, route.guildId, me);
  if (route.view === 'activity') return renderActivity(root, route.guildId, me);
  if (route.view === 'bloxfruits') return renderBloxFruits(root, route.guildId, me);
  if (route.view === 'bloxupdates') return renderBloxUpdates(root, route.guildId, me);
  if (route.view === 'commands') return renderCommands(root, route.guildId, me);
  if (route.view === 'commandmanager') return renderCommandManager(root, route.guildId, me);
  if (route.view === 'setup') return renderSetupWizard(root, route.guildId, me);
  if (route.view === 'reaction-roles') return renderReactionRoles(root, route.guildId, me);
  root.innerHTML = `<div class="state-block"><h3>Page not found</h3><p>That dashboard page doesn't exist.</p></div>`;
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a) return;
  const url = new URL(a.href, location.origin);
  if (url.origin !== location.origin) return;
  e.preventDefault();
  history.pushState({}, '', url.pathname);
  router();
});
window.addEventListener('popstate', router);

// ══════════════════════════════════════════════════════════
//  VIEW: LANDING
// ══════════════════════════════════════════════════════════
const RADAR_BLIPS = [
  { angle: 20, r: 40, label: 'Detection' }, { angle: 95, r: 30, label: 'AI Models' },
  { angle: 160, r: 45, label: 'Leveling' }, { angle: 210, r: 22, label: 'Tickets' },
  { angle: 265, r: 38, label: 'Raid Guard' }, { angle: 320, r: 28, label: 'Blox Fruits' },
];
function renderLanding(root) {
  const blips = RADAR_BLIPS.map((b, i) => {
    const rad = (b.angle * Math.PI) / 180;
    const x = 50 + b.r * Math.cos(rad), y = 50 + b.r * Math.sin(rad);
    return `<div class="radar-blip" style="left:${x}%;top:${y}%;animation-delay:${(i * 4.5 / RADAR_BLIPS.length).toFixed(2)}s"><span class="radar-label">${esc(b.label)}</span></div>`;
  }).join('');

  root.innerHTML = `
    <div class="landing">
      <div class="radar-wrap" aria-hidden="true">
        <div class="radar-ring"></div><div class="radar-ring"></div><div class="radar-ring"></div><div class="radar-ring"></div>
        <div class="radar-cross"></div>
        <div class="radar-sweep"></div>
        ${blips}
        <div class="radar-core"></div>
      </div>
      <div class="landing-eyebrow">● live moderation for Blox Fruits communities</div>
      <h1>Every message, <span class="accent-text">scanned</span>.<br>Every setting, one deck.</h1>
      <p class="landing-sub">DISCOMOD watches your server for scams, trade/service spam, and raid behavior in real time — configure all of it from here instead of digging through slash commands.</p>
      <div class="landing-cta">
        <a href="/auth/login" class="btn btn-primary">Sign in with Discord</a>
        <a href="#features" class="btn btn-ghost">See what it covers</a>
      </div>
      <div class="landing-stats">
        <div><div class="landing-stat-num">24</div><div class="landing-stat-label">Config categories</div></div>
        <div><div class="landing-stat-num">98</div><div class="landing-stat-label">Slash commands</div></div>
        <div><div class="landing-stat-num">7</div><div class="landing-stat-label">AI providers</div></div>
      </div>
      <div class="feature-grid" id="features">
        <div class="feature-card"><span class="icon">🛡️</span><h3>Detection & Warnings</h3><p>Trade/service redirects, scam phrase detection, per-category enforcement policy — tuned from the same board your mods already trust.</p></div>
        <div class="feature-card"><span class="icon">🤖</span><h3>AI-assisted moderation</h3><p>Switch between Claude, GPT, Gemini, Groq, Mistral, DeepSeek, or Grok models with autocomplete search across the whole catalog.</p></div>
        <div class="feature-card"><span class="icon">🚨</span><h3>Raid protection</h3><p>Join-rate thresholds, honeypots, lockdown — configured once, enforced automatically.</p></div>
        <div class="feature-card"><span class="icon">📈</span><h3>Leveling & engagement</h3><p>XP curves, level roles, starboard, tags, welcome messages — the community layer, not just the mod layer.</p></div>
        <div class="feature-card"><span class="icon">🎫</span><h3>Tickets & tools</h3><p>Ticket categories, reaction roles, autorole, logging — all schema-driven so new settings show up here automatically.</p></div>
        <div class="feature-card"><span class="icon">🍎</span><h3>Blox Fruits aware</h3><p>Fruits, swords, bosses, trinkets, sea events — the checker database is purpose-built for this game, not a generic filter.</p></div>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════
//  VIEW: GUILD PICKER
// ══════════════════════════════════════════════════════════
async function renderPicker(root, me) {
  const manageable = me.manageableGuilds || [];
  const addable = me.addableGuilds || [];

  root.innerHTML = `
    <div class="picker-wrap">
      <div class="picker-head">
        <h1>Your servers</h1>
        <p>Pick a server to configure, or add DISCOMOD to a new one.</p>
      </div>
      ${manageable.length ? `
        <div class="guild-grid">
          ${manageable.map(g => `
            <a href="/dashboard/${g.id}" data-link class="guild-card">
              ${iconOrInitials(g, 'guild-icon')}
              <div class="guild-info">
                <div class="guild-name">${esc(g.name)}</div>
                <div class="guild-meta">${g.memberCount ? g.memberCount.toLocaleString() + ' members' : ''}</div>
              </div>
            </a>`).join('')}
        </div>
      ` : `<div class="state-block"><h3>No manageable servers yet</h3><p>You need Administrator (or a bot manager role) in a server DISCOMOD is already in.</p></div>`}

      ${addable.length ? `
        <div class="section-label">Add DISCOMOD to a server</div>
        <div class="guild-grid">
          ${addable.map(g => `
            <a href="${esc(g.inviteUrl)}" target="_blank" rel="noopener" class="guild-card is-addable">
              ${iconOrInitials(g, 'guild-icon')}
              <div class="guild-info">
                <div class="guild-name">${esc(g.name)}</div>
                <div class="guild-meta">${g.owner ? 'Owner' : 'Admin'} · tap to invite</div>
              </div>
            </a>`).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function errorBlock(message) {
  return `<div class="state-block"><h3>Something went wrong</h3><p>${esc(message)}</p></div>`;
}

// ══════════════════════════════════════════════════════════
//  VIEW: SETTINGS APP (sidebar + schema-driven content)
// ══════════════════════════════════════════════════════════
let settingsState = null; // { guildId, schema, meta, gs, pending: {}, activeCategory }

// Shared shell for every guild-scoped page: sidebar with full nav + returns
// the #content element for the specific view to render into.
function renderGuildShell(root, guildId, me, activeView) {
  paletteGuildId = guildId;
  const guildInfo = (me.manageableGuilds || []).find(g => g.id === guildId) || { id: guildId, name: 'Server' };
  root.innerHTML = `
    <div class="app-shell">
      <button class="btn btn-ghost btn-sm sidebar-toggle" id="sidebar-toggle" style="position:fixed;top:70px;left:14px;z-index:46;" aria-label="Toggle menu">☰ Menu</button>
      <div class="scrim" id="scrim"></div>
      <nav class="sidebar" id="sidebar">
        <div class="sidebar-guild">
          ${iconOrInitials(guildInfo, 'guild-icon')}
          <div style="min-width:0;">
            <div class="sidebar-guild-name">${esc(guildInfo.name)}</div>
            <div class="sidebar-guild-sub mono">${esc(guildId)}</div>
          </div>
        </div>
        ${renderNavGroups(activeView, guildId)}
        <div class="nav-divider"></div>
        <a href="/dashboard/${guildId}/settings" data-link class="nav-item ${activeView === 'settings' ? 'active' : ''}"><span class="icon">⚙️</span>Settings</a>
        <a href="/dashboard/${guildId}/setup" data-link class="nav-item ${activeView === 'setup' ? 'active' : ''}"><span class="icon">🧭</span>Setup wizard</a>
        <a href="/dashboard/${guildId}/reaction-roles" data-link class="nav-item ${activeView === 'reaction-roles' ? 'active' : ''}"><span class="icon">🎭</span>Reaction roles</a>
        <div class="nav-divider"></div>
        <a href="/dashboard" data-link class="nav-item"><span class="icon">←</span>All servers</a>
      </nav>
      <div class="content" id="content"></div>
    </div>
  `;
  qs('#sidebar-toggle')?.addEventListener('click', () => { qs('#sidebar').classList.toggle('is-open'); qs('#scrim').classList.toggle('is-visible'); });
  qs('#scrim')?.addEventListener('click', () => { qs('#sidebar').classList.remove('is-open'); qs('#scrim').classList.remove('is-visible'); });
  return { content: qs('#content'), guildInfo };
}

async function renderSettingsApp(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading server configuration…</p></div>`;
  let schema, meta, gs;
  try {
    [schema, meta, gs] = await Promise.all([
      API.get('/api/schema'),
      API.get(`/api/guilds/${guildId}/meta`),
      API.get(`/api/guilds/${guildId}/settings`),
    ]);
  } catch (e) { root.innerHTML = errorBlock(e.message); return; }

  const { guildInfo } = renderGuildShell(root, guildId, me, 'settings');
  settingsState = { guildId, schema, meta, gs, pending: {}, activeCategory: null, guildInfo };

  const content = qs('#content');
  content.innerHTML = `
    <div class="content-head">
      <div><h1>⚙️ Settings</h1><p>${schema.length} categories · <input type="text" id="settings-search" placeholder="Search settings…" style="margin-top:10px;width:280px;"></p></div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost btn-sm" id="settings-export">⬇ Export JSON</button>
        <button class="btn btn-ghost btn-sm" id="settings-import-btn">⬆ Import JSON</button>
        <input type="file" id="settings-import-file" accept="application/json" class="hidden">
      </div>
    </div>
    <div class="settings-layout">
      <div class="settings-cats" id="settings-cats"></div>
      <div id="settings-cat-content"></div>
    </div>
  `;
  qs('#settings-export').addEventListener('click', async () => {
    try {
      const data = await API.get(`/api/guilds/${guildId}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `discomod-settings-${guildId}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Settings exported', 'ok');
    } catch (e) { toast(e.message || 'Export failed', 'err'); }
  });
  qs('#settings-import-btn').addEventListener('click', () => qs('#settings-import-file').click());
  qs('#settings-import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming = parsed.settings || parsed;
      if (!confirm(`Import ${Object.keys(incoming).length} settings into this server? This overwrites your current configuration for anything included in the file.`)) return;
      const result = await API.post(`/api/guilds/${guildId}/import`, { settings: incoming });
      toast(`Imported ${result.appliedCount} setting${result.appliedCount === 1 ? '' : 's'}`, 'ok');
      gs = await API.get(`/api/guilds/${guildId}/settings`);
      settingsState.gs = gs;
      renderCategory(settingsState.activeCategory);
    } catch (err) { toast(err.message || 'Import failed — is this a valid export file?', 'err'); }
    e.target.value = '';
  });
  const catList = qs('#settings-cats');
  const drawCatList = (filter = '') => {
    const f = filter.trim().toLowerCase();
    const matches = !f ? schema : schema.filter(cat =>
      cat.category.toLowerCase().includes(f) || cat.fields.some(fl => fl.label.toLowerCase().includes(f) || (fl.desc || '').toLowerCase().includes(f))
    );
    catList.innerHTML = matches.map(cat => `<a href="#${slug(cat.category)}" class="nav-item" data-cat="${slug(cat.category)}"><span class="icon">${cat.icon || '•'}</span>${esc(cat.category)}</a>`).join('') || `<p style="padding:10px;color:var(--text-faint);font-size:12.5px;">No matching settings.</p>`;
  };
  drawCatList();
  qs('#settings-search').addEventListener('input', debounce((e) => drawCatList(e.target.value), 150));

  const initialCat = (location.hash || '').replace('#', '') || slug(schema[0].category);
  settingsState.activeCategory = initialCat;
  window.onhashchange = () => {
    const c = (location.hash || '').replace('#', '');
    if (c) { settingsState.activeCategory = c; renderCategory(c); }
  };
  renderCategory(initialCat);
}

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }

function renderCategory(catSlug) {
  const { schema, gs } = settingsState;
  const cat = schema.find(c => slug(c.category) === catSlug) || schema[0];
  settingsState.activeCategory = slug(cat.category);

  qsa('.nav-item[data-cat]').forEach(n => n.classList.toggle('active', n.dataset.cat === settingsState.activeCategory));

  const pane = qs('#settings-cat-content');
  if (!pane) return; // settings page has since navigated away
  pane.innerHTML = `
    <div class="content-head" style="margin-bottom:18px;">
      <div>
        <h1 style="font-size:18px;"><span class="cat-icon">${cat.icon || '•'}</span>${esc(cat.category)}</h1>
        <p>${cat.fields.length} setting${cat.fields.length === 1 ? '' : 's'} in this category.</p>
      </div>
    </div>
    <div class="card" id="field-card"></div>
  `;
  const card = qs('#field-card');
  card.innerHTML = cat.fields.map(f => fieldRowHtml(f, getPath(gs, f.key))).join('');
  cat.fields.forEach(f => wireField(f, card));

  // A few categories need something beyond plain field rows (live status,
  // a test action). Kept as an opt-in per-category hook rather than special
  // casing renderCategory itself, so this stays a one-line addition per
  // category rather than a growing if-chain.
  const extra = CATEGORY_EXTRAS[cat.category];
  if (extra) extra(pane, settingsState);
}

const CATEGORY_EXTRAS = {
  'Blox Fruits Stock': (pane, st) => {
    const box = el(`<div class="card" style="padding:18px 20px;margin-top:14px;"><div class="mono" style="font-size:12px;color:var(--text-faint);">Loading current stock…</div></div>`);
    pane.appendChild(box);
    API.get('/api/bloxfruits/stock').then(snap => {
      box.innerHTML = snap.hasData ? `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;">
          <div>
            <div style="font-size:12px;color:var(--text-faint);margin-bottom:6px;">Current Normal Dealer stock ${snap.stale ? '<span style="color:var(--danger);">(⚠️ stale — last confirmed ' + esc(timeAgo(snap.lastSuccessAt)) + ')</span>' : '<span style="color:var(--success,#4ADE80);">(fresh, confirmed ' + esc(timeAgo(snap.lastSuccessAt)) + ')</span>'}</div>
            <div style="font-size:13.5px;">${(snap.fruits || []).map(f => f[0].toUpperCase() + f.slice(1)).join(', ') || '—'}</div>
          </div>
          <button class="btn btn-ghost btn-sm" id="bf-stock-test">Send test notification</button>
        </div>
        <div class="mono" style="font-size:10.5px;color:var(--text-faint);margin-top:10px;">Mirage Dealer stock isn't available from this source. Data comes from a fan-edited wiki, not an official feed — verify in-game before trading on it.</div>
      ` : `<div class="mono" style="font-size:12px;color:var(--danger);">Couldn't fetch stock: ${esc(snap.lastError || 'unknown error')}</div>`;
      qs('#bf-stock-test', box)?.addEventListener('click', async (e) => {
        e.target.disabled = true; e.target.textContent = 'Sending…';
        try { await API.post(`/api/guilds/${st.guildId}/bloxfruits/stock/test`); toast('Test notification sent', 'ok'); }
        catch (err) { toast(err.message || 'Failed to send', 'err'); }
        finally { e.target.disabled = false; e.target.textContent = 'Send test notification'; }
      });
    }).catch(e => { box.innerHTML = `<div class="mono" style="font-size:12px;color:var(--danger);">${esc(e.message)}</div>`; });
  },
};

function colorIntToHex(v) {
  const n = Number(v);
  return '#' + (Number.isFinite(n) ? Math.max(0, Math.min(0xFFFFFF, n)) : 0x2DE0C4).toString(16).padStart(6, '0');
}

function getPath(obj, path) { return path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj); }

// ── Generic field renderer: HTML string per type ──
function fieldRowHtml(field, value) {
  const isBlockType = ['array', 'regexarray', 'text', 'toggle-group', 'channel-multi', 'role-multi', 'keyvalue', 'levelrewards'].includes(field.type);
  return `
    <div class="field-row ${isBlockType ? 'is-col' : ''}" data-field-key="${esc(field.key)}">
      <div>
        <div class="field-label">${esc(field.label)}</div>
        ${field.desc ? `<div class="field-desc">${esc(field.desc)}</div>` : ''}
      </div>
      <div class="field-control" data-control="${esc(field.key)}">${controlHtml(field, value)}</div>
    </div>
  `;
}

function controlHtml(field, value) {
  if (field.readOnly) return `<span class="field-readonly-badge">${value ? '✓ done' : '— not yet —'}</span>`;
  const { meta } = settingsState;
  switch (field.type) {
    case 'boolean':
      return `<label class="switch"><input type="checkbox" ${value ? 'checked' : ''}><span class="switch-track"><span class="switch-thumb"></span></span></label>`;
    case 'string':
      return `<input type="text" value="${esc(value ?? '')}">`;
    case 'number':
      return `<input type="number" value="${value ?? 0}" ${field.min != null ? `min="${field.min}"` : ''} ${field.max != null ? `max="${field.max}"` : ''}>`;
    case 'color':
      return `<input type="color" value="${esc(colorIntToHex(value))}">`;
    case 'text':
      return `<textarea>${esc(value ?? '')}</textarea>`;
    case 'select':
      return `<select>${(field.options || []).map(o => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    case 'channel':
      return `<select><option value="">— none —</option>${meta.channels.map(c => `<option value="${c.id}" ${c.id === value ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select>`;
    case 'role':
      return `<select><option value="">— none —</option>${meta.roles.map(r => `<option value="${r.id}" ${r.id === value ? 'selected' : ''}>@${esc(r.name)}</option>`).join('')}</select>`;
    case 'array':
      return `<div class="array-editor"><textarea rows="4">${esc((value || []).join('\n'))}</textarea><div class="array-hint">One entry per line.</div></div>`;
    case 'regexarray':
      return `<div class="array-editor"><textarea rows="5" class="mono">${esc((value || []).map(r => (r && typeof r === 'object') ? `${r.pattern}${r.flags ? ' ' + r.flags : ''}` : String(r)).join('\n'))}</textarea><div class="array-hint">One regex pattern per line — optionally add flags after a space, e.g. "free\\snitro gi"</div></div>`;
    case 'channel-multi': return chipFieldHtml(field, value || [], meta.channels, '#');
    case 'role-multi': return chipFieldHtml(field, value || [], meta.roles, '@');
    case 'toggle-group': return toggleGroupHtml(field, value || {});
    case 'keyvalue': return keyvalueHtml(field, value || {});
    case 'levelrewards': return levelRewardsHtml(field, value || {}, meta.roles);
    default:
      return `<input type="text" value="${esc(JSON.stringify(value ?? ''))}" disabled>`;
  }
}

function chipFieldHtml(field, ids, options, sigil) {
  const byId = Object.fromEntries(options.map(o => [o.id, o.name]));
  const remaining = options.filter(o => !ids.includes(o.id));
  return `
    <div class="chip-field" data-chip-field="${esc(field.key)}">
      ${ids.map(id => `<span class="chip" data-id="${id}">${sigil}${esc(byId[id] || id)}<button type="button" data-remove="${id}" aria-label="Remove">✕</button></span>`).join('')}
      <select class="chip-add-select" data-add>
        <option value="">+ add…</option>
        ${remaining.map(o => `<option value="${o.id}">${sigil}${esc(o.name)}</option>`).join('')}
      </select>
    </div>
  `;
}

function toggleGroupHtml(field, obj) {
  const opts = field.options || [];
  return `
    <div class="toggle-grid" data-toggle-group="${esc(field.key)}">
      ${opts.map(name => `
        <label class="toggle-grid-item">${esc(name)}
          <label class="switch"><input type="checkbox" data-opt="${esc(name)}" ${obj[name] ? 'checked' : ''}><span class="switch-track"><span class="switch-thumb"></span></span></label>
        </label>`).join('')}
    </div>
  `;
}

function keyvalueHtml(field, obj) {
  const rows = Object.entries(obj).map(([name, v]) => ({ name, content: (v && typeof v === 'object') ? (v.content ?? '') : v }));
  return `
    <div class="array-editor" data-keyvalue="${esc(field.key)}">
      <div class="kv-rows">
        ${rows.map((r, i) => kvRowHtml(r.name, r.content, i)).join('')}
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-kv-add style="margin-top:8px;">+ Add entry</button>
    </div>
  `;
}
function kvRowHtml(name, content, i) {
  return `
    <div class="field-row is-col" style="padding:10px 0;border-bottom:1px dashed var(--border);" data-kv-row="${i}">
      <input type="text" class="kv-name" value="${esc(name)}" placeholder="name" style="margin-bottom:6px;">
      <textarea class="kv-content" placeholder="content" rows="2">${esc(content)}</textarea>
      <button type="button" class="btn btn-danger btn-sm" data-kv-remove style="margin-top:6px;align-self:flex-start;">Remove</button>
    </div>
  `;
}

function levelRewardsHtml(field, obj, roles) {
  const rows = Object.entries(obj).sort((a, b) => Number(a[0]) - Number(b[0]));
  return `
    <div class="array-editor" data-levelrewards="${esc(field.key)}">
      <div class="lr-rows">
        ${rows.map(([lvl, roleId], i) => lrRowHtml(lvl, roleId, roles, i)).join('')}
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-lr-add style="margin-top:8px;">+ Add level reward</button>
    </div>
  `;
}
function lrRowHtml(level, roleId, roles, i) {
  return `
    <div class="field-row" style="padding:10px 0;" data-lr-row="${i}">
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="mono" style="font-size:12px;color:var(--text-faint);">Level</span>
        <input type="number" class="lr-level mono" min="1" value="${esc(level)}" style="width:80px;min-width:80px;">
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <select class="lr-role">${roles.map(r => `<option value="${r.id}" ${r.id === roleId ? 'selected' : ''}>@${esc(r.name)}</option>`).join('')}</select>
        <button type="button" class="btn btn-danger btn-sm" data-lr-remove>✕</button>
      </div>
    </div>
  `;
}

// ── Wiring: attach listeners per field, stage into settingsState.pending ──
function wireField(field, card) {
  const wrap = card.querySelector(`[data-control="${cssEsc(field.key)}"]`);
  if (!wrap || field.readOnly) return;

  const stage = (value) => { settingsState.pending[field.key] = value; showSaveBar(); };

  switch (field.type) {
    case 'boolean': {
      const input = wrap.querySelector('input');
      input.addEventListener('change', () => stage(input.checked));
      break;
    }
    case 'string': case 'number': {
      const input = wrap.querySelector('input');
      input.addEventListener('input', debounce(() => stage(field.type === 'number' ? Number(input.value) : input.value), 250));
      break;
    }
    case 'color': {
      const input = wrap.querySelector('input');
      input.addEventListener('input', () => stage(parseInt(input.value.slice(1), 16)));
      break;
    }
    case 'text': {
      const ta = wrap.querySelector('textarea');
      ta.addEventListener('input', debounce(() => stage(ta.value), 250));
      break;
    }
    case 'select': case 'channel': case 'role': {
      const select = wrap.querySelector('select');
      select.addEventListener('change', () => stage(select.value || null));
      break;
    }
    case 'array': {
      const ta = wrap.querySelector('textarea');
      ta.addEventListener('input', debounce(() => stage(ta.value.split('\n').map(s => s.trim()).filter(Boolean)), 250));
      break;
    }
    case 'regexarray': {
      const ta = wrap.querySelector('textarea');
      ta.addEventListener('input', debounce(() => stage(parseRegexLines(ta.value)), 250));
      break;
    }
    case 'channel-multi': case 'role-multi': {
      wireChipField(field, wrap, stage);
      break;
    }
    case 'toggle-group': {
      const obj = { ...(getPath(settingsState.gs, field.key) || {}) };
      wrap.querySelectorAll('input[data-opt]').forEach(inp => {
        inp.addEventListener('change', () => { obj[inp.dataset.opt] = inp.checked; stage({ ...obj }); });
      });
      break;
    }
    case 'keyvalue': { wireKeyvalue(field, wrap, stage); break; }
    case 'levelrewards': { wireLevelRewards(field, wrap, stage); break; }
  }
}
function cssEsc(s) { return String(s).replace(/[."'\\]/g, '\\$&'); }

// Splits a "pattern [flags]" line into { pattern, flags }. Flags are only
// split off if the trailing token is 1-6 valid regex flag characters —
// otherwise the whole line is treated as the pattern (default flags 'i',
// matching the server's own default).
function parseRegexLines(text) {
  return text.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
    const m = line.match(/^(.*\S)\s+([gimsuy]{1,6})$/);
    return m ? { pattern: m[1], flags: m[2] } : { pattern: line, flags: 'i' };
  });
}

function wireChipField(field, wrap, stage) {
  const currentIds = () => qsa('.chip', wrap).map(c => c.dataset.id);
  wrap.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => {
    btn.closest('.chip').remove();
    refreshChipAddOptions(field, wrap);
    stage(currentIds());
  }));
  const addSelect = wrap.querySelector('[data-add]');
  addSelect?.addEventListener('change', () => {
    const id = addSelect.value;
    if (!id) return;
    const options = field.type === 'channel-multi' ? settingsState.meta.channels : settingsState.meta.roles;
    const sigil = field.type === 'channel-multi' ? '#' : '@';
    const opt = options.find(o => o.id === id);
    const chip = el(`<span class="chip" data-id="${id}">${sigil}${esc(opt ? opt.name : id)}<button type="button" data-remove="${id}" aria-label="Remove">✕</button></span>`);
    chip.querySelector('button').addEventListener('click', () => { chip.remove(); refreshChipAddOptions(field, wrap); stage(currentIds()); });
    addSelect.before(chip);
    refreshChipAddOptions(field, wrap);
    stage(currentIds());
  });
}
function refreshChipAddOptions(field, wrap) {
  const options = field.type === 'channel-multi' ? settingsState.meta.channels : settingsState.meta.roles;
  const sigil = field.type === 'channel-multi' ? '#' : '@';
  const used = new Set(qsa('.chip', wrap).map(c => c.dataset.id));
  const addSelect = wrap.querySelector('[data-add]');
  addSelect.innerHTML = `<option value="">+ add…</option>` + options.filter(o => !used.has(o.id)).map(o => `<option value="${o.id}">${sigil}${esc(o.name)}</option>`).join('');
}

function wireKeyvalue(field, wrap, stage) {
  const rowsWrap = wrap.querySelector('.kv-rows');
  const collect = () => {
    const out = {};
    qsa('[data-kv-row]', rowsWrap).forEach(row => {
      const name = row.querySelector('.kv-name').value.trim();
      const content = row.querySelector('.kv-content').value;
      if (name) out[name] = content;
    });
    return out;
  };
  const wireRow = (row) => {
    row.querySelector('.kv-name').addEventListener('input', debounce(() => stage(collect()), 250));
    row.querySelector('.kv-content').addEventListener('input', debounce(() => stage(collect()), 250));
    row.querySelector('[data-kv-remove]').addEventListener('click', () => { row.remove(); stage(collect()); });
  };
  qsa('[data-kv-row]', rowsWrap).forEach(wireRow);
  wrap.querySelector('[data-kv-add]')?.addEventListener('click', () => {
    const i = qsa('[data-kv-row]', rowsWrap).length;
    const row = el(kvRowHtml('', '', i));
    rowsWrap.appendChild(row);
    wireRow(row);
    row.querySelector('.kv-name').focus();
  });
}

function wireLevelRewards(field, wrap, stage) {
  const rowsWrap = wrap.querySelector('.lr-rows');
  const roles = settingsState.meta.roles;
  const collect = () => {
    const out = {};
    qsa('[data-lr-row]', rowsWrap).forEach(row => {
      const lvl = row.querySelector('.lr-level').value.trim();
      const roleId = row.querySelector('.lr-role').value;
      if (lvl && roleId) out[lvl] = roleId;
    });
    return out;
  };
  const wireRow = (row) => {
    row.querySelector('.lr-level').addEventListener('input', debounce(() => stage(collect()), 250));
    row.querySelector('.lr-role').addEventListener('change', () => stage(collect()));
    row.querySelector('[data-lr-remove]').addEventListener('click', () => { row.remove(); stage(collect()); });
  };
  qsa('[data-lr-row]', rowsWrap).forEach(wireRow);
  wrap.querySelector('[data-lr-add]')?.addEventListener('click', () => {
    const i = qsa('[data-lr-row]', rowsWrap).length;
    const row = el(lrRowHtml(String(i + 1), roles[0]?.id || '', roles, i));
    rowsWrap.appendChild(row);
    wireRow(row);
  });
}

// ── Save bar ──
function ensureSaveBar() {
  if (qs('#save-bar')) return qs('#save-bar');
  const bar = el(`
    <div class="save-bar" id="save-bar">
      <span class="save-bar-text" id="save-bar-text">0 changes</span>
      <button class="btn btn-ghost btn-sm" id="save-discard">Discard</button>
      <button class="btn btn-primary btn-sm" id="save-commit">Save changes</button>
    </div>
  `);
  document.body.appendChild(bar);
  qs('#save-discard', bar).addEventListener('click', () => {
    settingsState.pending = {};
    hideSaveBar();
    renderCategory(settingsState.activeCategory);
  });
  qs('#save-commit', bar).addEventListener('click', commitSave);
  return bar;
}
function showSaveBar() {
  const bar = ensureSaveBar();
  const n = Object.keys(settingsState.pending).length;
  qs('#save-bar-text', bar).textContent = `${n} change${n === 1 ? '' : 's'} pending`;
  bar.classList.toggle('is-visible', n > 0);
}
function hideSaveBar() { qs('#save-bar')?.classList.remove('is-visible'); }

async function commitSave() {
  const btn = qs('#save-commit');
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await API.post(`/api/guilds/${settingsState.guildId}/settings`, settingsState.pending);
    // Merge applied changes into local cache (dot-path aware) so the UI reflects saved state.
    for (const [key, value] of Object.entries(settingsState.pending)) setPath(settingsState.gs, key, value);
    settingsState.pending = {};
    hideSaveBar();
    toast('Saved', 'ok');
  } catch (e) {
    toast(e.message || 'Save failed', 'err');
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
}
function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = cur[parts[i]] && typeof cur[parts[i]] === 'object' ? cur[parts[i]] : {}; cur = cur[parts[i]]; }
  cur[parts[parts.length - 1]] = value;
}

// Warn before leaving with unsaved changes.
window.addEventListener('beforeunload', (e) => {
  if (settingsState && Object.keys(settingsState.pending).length) { e.preventDefault(); e.returnValue = ''; }
});

// ══════════════════════════════════════════════════════════
//  VIEW: OVERVIEW (guild home)
// ══════════════════════════════════════════════════════════
async function renderOverview(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading overview…</p></div>`;
  let ov, health = null;
  try { ov = await API.get(`/api/guilds/${guildId}/overview`); } catch (e) { root.innerHTML = errorBlock(e.message); return; }
  try { health = await API.get('/api/health'); } catch { /* optional — page still works without it */ }
  const { content } = renderGuildShell(root, guildId, me, 'overview');
  let lastFetchedAt = Date.now();

  function draw() {
    const maxActivity = Math.max(1, ...ov.last30DaysActivity.map(d => d.count));
    const chartBars = ov.last30DaysActivity.map(d => {
      const h = Math.max(2, Math.round((d.count / maxActivity) * 64));
      return `<div class="bar-col" title="${esc(d.date)}: ${d.count} messages"><div class="bar" style="height:${h}px"></div></div>`;
    }).join('');

    content.innerHTML = `
      <div class="content-head">
        <div><h1>🛰️ Overview</h1><p>Live snapshot of ${esc(ov.guild.name)} · <span id="ov-updated" class="mono">updated just now</span></p></div>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="stat-num">${ov.guild.memberCount.toLocaleString()}</div><div class="stat-label">Members</div></div>
        <div class="stat-card"><div class="stat-num">${ov.totalViolations.toLocaleString()}</div><div class="stat-label">Violations logged</div></div>
        <div class="stat-card"><div class="stat-num">${ov.tagCount}</div><div class="stat-label">Custom tags</div></div>
        <div class="stat-card"><div class="stat-num">${ov.reactionRoleMessageCount}</div><div class="stat-label">Reaction role messages</div></div>
      </div>

      ${health?.ai ? `
      <div class="card" style="padding:14px 20px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="badge ${health.ai.enabled ? 'badge-on' : 'badge-off'}">${health.ai.enabled ? 'AI Chat Enabled' : 'AI Chat Disabled'}</span>
          <span style="font-size:12.5px;">${esc(health.ai.label)}</span>
        </div>
        <span class="mono" style="font-size:10.5px;color:var(--text-faint);" title="Set via /aimodel — applies bot-wide, not just this server">bot-wide setting, not per-server</span>
      </div>` : ''}

      <div class="card" style="padding:20px;margin-bottom:14px;">
        <h3 style="font-size:14px;margin-bottom:4px;">Message activity — last 30 days</h3>
        <p style="font-size:12px;color:var(--text-faint);margin-bottom:16px;">Hover a bar for the exact count.</p>
        <div class="bar-chart">${chartBars}</div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;" class="two-col-stack">
        <div class="card" style="padding:20px;">
          <h3 style="font-size:14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;">Top of the leaderboard <a href="/dashboard/${guildId}/leaderboard" data-link class="link-btn" style="font-size:11.5px;">See all →</a></h3>
          ${ov.topLevelUsers.length ? ov.topLevelUsers.map((u, i) => `
            <div style="display:flex;align-items:center;gap:10px;padding:7px 0;">
              <span class="mono" style="width:18px;color:var(--text-faint);font-size:12px;">#${i + 1}</span>
              ${u.avatarUrl ? `<img src="${esc(u.avatarUrl)}" style="width:24px;height:24px;border-radius:50%;">` : `<div class="guild-icon" style="width:24px;height:24px;font-size:10px;">?</div>`}
              <span style="font-size:13px;flex:1;">${esc(u.displayName || u.uid)}</span>
              <span class="mono" style="font-size:11.5px;color:var(--text-faint);">Lv.${u.level ?? '—'} · ${u.xp.toLocaleString()} XP</span>
            </div>
          `).join('') : `<p style="color:var(--text-faint);font-size:13px;">No XP earned yet.</p>`}
        </div>
        <div class="card" style="padding:20px;">
          <h3 style="font-size:14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;">Recent settings changes <a href="/dashboard/${guildId}/activity" data-link class="link-btn" style="font-size:11.5px;">Full log →</a></h3>
          ${ov.recentAuditEntries.length ? ov.recentAuditEntries.map(e => `
            <div style="padding:7px 0;font-size:12.5px;">
              <span style="color:var(--accent);">${esc(e.byName || 'Someone')}</span> changed <strong>${esc(e.label)}</strong>
              <div class="mono" style="color:var(--text-faint);font-size:11px;margin-top:2px;">${timeAgo(e.at)}</div>
            </div>
          `).join('') : `<p style="color:var(--text-faint);font-size:13px;">No changes logged yet — edit a setting to start the trail.</p>`}
        </div>
      </div>
    `;
  }
  draw();

  // Keep the "updated Xs ago" label ticking every few seconds without a network call...
  const tickTimer = setInterval(() => { const el = qs('#ov-updated'); if (el) el.textContent = `updated ${timeAgo(lastFetchedAt)}`; else clearInterval(tickTimer); }, 5000);
  // ...and actually re-fetch fresh numbers every 20s. Silent on failure (e.g. a
  // momentary network blip) — the page just keeps showing the last good data
  // rather than replacing it with an error while the person is looking at it.
  startPolling(async () => {
    try { ov = await API.get(`/api/guilds/${guildId}/overview`); lastFetchedAt = Date.now(); draw(); }
    catch { /* keep showing last known-good data */ }
  }, 20000);
}
function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ══════════════════════════════════════════════════════════
//  VIEW: LEADERBOARD
// ══════════════════════════════════════════════════════════
async function renderLeaderboard(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading leaderboard…</p></div>`;
  let data;
  try { data = await API.get(`/api/guilds/${guildId}/leaderboard`); } catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'leaderboard');

  function draw() {
    content.innerHTML = `
      <div class="content-head">
        <div><h1>🏆 Leaderboard</h1><p>Top XP earners in this server. ${data.enabled ? '' : '<span style="color:var(--gold);">Leveling is currently disabled — turn it on in Settings → Leveling.</span>'}</p></div>
      </div>
      ${data.rows.length ? `
        <div class="card">
          ${data.rows.map(u => `
            <div class="field-row">
              <div style="display:flex;align-items:center;gap:12px;">
                <span class="mono rank-badge ${u.rank <= 3 ? 'rank-top' : ''}">#${u.rank}</span>
                ${u.avatarUrl ? `<img src="${esc(u.avatarUrl)}" style="width:36px;height:36px;border-radius:50%;">` : `<div class="guild-icon" style="width:36px;height:36px;">?</div>`}
                <div>
                  <div style="font-weight:600;font-size:13.5px;">${esc(u.displayName)}</div>
                  <div class="mono" style="font-size:11px;color:var(--text-faint);">${u.xp.toLocaleString()} total XP</div>
                </div>
              </div>
              <div style="text-align:right;">
                <div style="font-weight:700;color:var(--accent);font-size:14px;">Level ${u.level ?? '—'}</div>
                ${u.xpForNextLevel ? `<div class="mono" style="font-size:10.5px;color:var(--text-faint);">${u.xpIntoLevel}/${u.xpForNextLevel} to next</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      ` : `<div class="state-block"><h3>No XP earned yet</h3><p>The leaderboard fills in as members chat.</p></div>`}
    `;
  }
  draw();

  // Refresh every 20s — ranks/XP shift as people chat while someone has this open.
  startPolling(async () => {
    try { data = await API.get(`/api/guilds/${guildId}/leaderboard`); draw(); }
    catch { /* keep showing last known-good data */ }
  }, 20000);
}

// ══════════════════════════════════════════════════════════
//  VIEW: CASE / VIOLATION LOOKUP
// ══════════════════════════════════════════════════════════
async function renderCases(root, guildId, me) {
  const { content } = renderGuildShell(root, guildId, me, 'cases');
  content.innerHTML = `
    <div class="content-head"><div><h1>📁 Case Lookup</h1><p>Look up a member's violation history by Discord user ID.</p></div></div>
    <div class="card" style="padding:20px;margin-bottom:20px;">
      <div style="display:flex;gap:10px;">
        <input type="text" id="case-uid" placeholder="Discord user ID (e.g. 123456789012345678)" style="flex:1;min-width:0;" class="mono">
        <button class="btn btn-primary" id="case-search">Search</button>
      </div>
    </div>
    <div id="case-result"></div>
  `;
  const run = async () => {
    const uid = qs('#case-uid').value.trim();
    if (!uid) return;
    const resultEl = qs('#case-result');
    resultEl.innerHTML = `<div class="state-block"><div class="spinner"></div></div>`;
    try {
      const data = await API.get(`/api/guilds/${guildId}/cases/${uid}`);
      resultEl.innerHTML = `
        <div class="card" style="padding:18px 20px;margin-bottom:14px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          ${data.avatarUrl ? `<img src="${data.avatarUrl}" style="width:44px;height:44px;border-radius:50%;">` : `<div class="guild-icon" style="width:44px;height:44px;">?</div>`}
          <div><div style="font-weight:600;">${esc(data.displayName || 'Unknown user')}</div><div class="mono" style="font-size:11.5px;color:var(--text-faint);">${esc(data.uid)}</div></div>
          <div style="margin-left:auto;text-align:right;"><div class="stat-num" style="font-size:22px;">${data.count}</div><div class="stat-label">violations</div></div>
        </div>
        <div class="card" style="padding:14px 20px;margin-bottom:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span style="font-size:12px;color:var(--text-faint);">Actions affect this user's record on <strong>every</strong> server the bot moderates, not just this one:</span>
          <button class="btn btn-ghost btn-sm" id="case-decrement" style="margin-left:auto;">− Decrement by 1</button>
          <button class="btn btn-danger btn-sm" id="case-clear">Clear all history</button>
        </div>
        ${data.history.length ? `<div class="card">${data.history.map(h => `
          <div class="field-row is-col">
            <div style="display:flex;justify-content:space-between;width:100%;">
              <span class="badge badge-off">${esc(h.category)}</span>
              <span class="mono" style="font-size:11px;color:var(--text-faint);">${new Date(h.timestamp).toLocaleString()}</span>
            </div>
            <div style="font-size:13px;margin-top:6px;">${esc(h.reason)}</div>
            ${h.expiresAt ? `<div class="mono" style="font-size:10.5px;color:var(--text-faint);margin-top:4px;">Expires ${new Date(h.expiresAt).toLocaleDateString()}</div>` : ''}
          </div>
        `).join('')}</div>` : `<div class="state-block"><h3>Clean record in this server</h3><p>No violations found for this user here.</p></div>`}
      `;
      qs('#case-decrement').addEventListener('click', async () => {
        if (!confirm(`Decrement ${data.displayName || uid}'s violation count by 1?\n\nThis changes their count across every server the bot moderates, not just this one.`)) return;
        try { await API.post(`/api/guilds/${guildId}/cases/${uid}/decrement`, {}); toast('Decremented', 'ok'); run(); }
        catch (e) { toast(e.message || 'Could not decrement', 'err'); }
      });
      qs('#case-clear').addEventListener('click', async () => {
        if (!confirm(`Clear ALL violation history for ${data.displayName || uid}?\n\nThis wipes their record across every server the bot moderates, not just this one. This can't be undone.`)) return;
        try { await API.post(`/api/guilds/${guildId}/cases/${uid}/clear`, {}); toast('Violation history cleared', 'ok'); run(); }
        catch (e) { toast(e.message || 'Could not clear history', 'err'); }
      });
    } catch (e) { resultEl.innerHTML = errorBlock(e.message); }
  };
  qs('#case-search').addEventListener('click', run);
  qs('#case-uid').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
}

// ══════════════════════════════════════════════════════════
//  VIEW: TAGS MANAGER
// ══════════════════════════════════════════════════════════
async function renderTags(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading tags…</p></div>`;
  let data;
  try { data = await API.get(`/api/guilds/${guildId}/tags`); } catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'tags');

  content.innerHTML = `
    <div class="content-head">
      <div><h1>🏷️ Tags</h1><p>${data.tags.length} tag${data.tags.length === 1 ? '' : 's'}, sorted by usage. Add new ones from Settings → Tags, or <code class="mono">/tag add</code> in Discord.</p></div>
    </div>
    ${data.tags.length ? `<div class="card">${data.tags.map(t => `
      <div class="field-row" data-tag="${esc(t.name)}">
        <div style="min-width:0;">
          <div style="font-weight:600;font-size:13.5px;">${esc(t.name)}</div>
          <div style="font-size:12px;color:var(--text-faint);margin-top:3px;max-width:60ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.content)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:14px;flex-shrink:0;">
          <span class="mono" style="font-size:11.5px;color:var(--text-faint);">${t.uses} use${t.uses === 1 ? '' : 's'}</span>
          <button class="btn btn-danger btn-sm" data-tag-delete="${esc(t.name)}">Delete</button>
        </div>
      </div>
    `).join('')}</div>` : `<div class="state-block"><h3>No tags yet</h3><p>Create one from Settings → Tags.</p></div>`}
  `;
  qsa('[data-tag-delete]').forEach(btn => btn.addEventListener('click', async () => {
    const name = btn.dataset.tagDelete;
    if (!confirm(`Delete tag "${name}"? This can't be undone.`)) return;
    try {
      await API.del(`/api/guilds/${guildId}/tags/${encodeURIComponent(name)}`);
      qs(`[data-tag="${cssEsc(name)}"]`)?.remove();
      toast('Tag deleted', 'ok');
    } catch (e) { toast(e.message || 'Could not delete tag', 'err'); }
  }));
}

// ══════════════════════════════════════════════════════════
//  VIEW: TICKETS — claim/unclaim/close read and write the exact same
//  data.tickets[guildId] map the in-Discord buttons use (via shared
//  helpers on the server side), so an action taken here behaves
//  identically to the same action taken in the ticket channel.
// ══════════════════════════════════════════════════════════
async function renderTickets(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading tickets…</p></div>`;
  let data;
  try { data = await API.get(`/api/guilds/${guildId}/tickets`); } catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'tickets');
  const unclaimed = data.open.filter(t => !t.claimedBy).length;

  const row = (t, isOpen) => `
    <div class="field-row is-col" data-ticket="${esc(t.channelId)}">
      <div style="display:flex;justify-content:space-between;width:100%;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div style="min-width:0;">
          <div style="font-weight:600;font-size:13.5px;">${esc(t.subject || '(no subject)')}</div>
          ${t.reason ? `<div style="font-size:12px;color:var(--text-faint);margin-top:3px;max-width:56ch;">${esc(t.reason)}</div>` : ''}
          <div class="mono" style="font-size:11px;color:var(--text-faint);margin-top:6px;">
            Opened by ${esc(t.userTag || t.userId || 'Unknown')} · ${timeAgo(t.createdAt)}${!t.channelExists ? ' · <span style="color:var(--danger);">channel deleted</span>' : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          ${isOpen
            ? (t.claimedBy
                ? `<span class="badge badge-on">Claimed · ${esc(t.claimedByTag || t.claimedBy)}</span><button class="btn btn-ghost btn-sm" data-unclaim="${esc(t.channelId)}">Unclaim</button>`
                : `<span class="badge badge-off">Unclaimed</span><button class="btn btn-ghost btn-sm" data-claim="${esc(t.channelId)}">Claim</button>`)
            : `<span class="badge badge-off">Closed ${timeAgo(t.closedAt)}</span>`}
          ${t.channelExists ? `<a class="btn btn-ghost btn-sm" href="https://discord.com/channels/${esc(guildId)}/${esc(t.channelId)}" target="_blank" rel="noopener" title="Open in Discord">↗</a>` : ''}
          ${isOpen ? `<button class="btn btn-danger btn-sm" data-close="${esc(t.channelId)}">Close</button>` : ''}
        </div>
      </div>
    </div>`;

  content.innerHTML = `
    <div class="content-head"><div><h1>🎫 Tickets</h1><p>Claim, unclaim, and close tickets from here — same actions and permissions as the buttons inside the ticket channel.</p></div></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-num">${data.open.length}</div><div class="stat-label">Open</div></div>
      <div class="stat-card"><div class="stat-num">${unclaimed}</div><div class="stat-label">Unclaimed</div></div>
      <div class="stat-card"><div class="stat-num">${data.open.length - unclaimed}</div><div class="stat-label">Claimed</div></div>
      <div class="stat-card"><div class="stat-num">${data.closed.length}</div><div class="stat-label">Recently closed</div></div>
    </div>
    <div class="section-label">Open (${data.open.length})</div>
    ${data.open.length ? `<div class="card">${data.open.map(t => row(t, true)).join('')}</div>` : `<div class="state-block"><h3>No open tickets</h3><p>New tickets opened via the ticket panel will show up here.</p></div>`}
    ${data.closed.length ? `<div class="section-label">Recently closed</div><div class="card">${data.closed.map(t => row(t, false)).join('')}</div>` : ''}
  `;

  qsa('[data-claim]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await API.post(`/api/guilds/${guildId}/tickets/${btn.dataset.claim}/claim`); toast('Ticket claimed', 'ok'); renderTickets(root, guildId, me); }
    catch (e) { toast(e.message || 'Could not claim ticket', 'err'); btn.disabled = false; }
  }));
  qsa('[data-unclaim]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await API.post(`/api/guilds/${guildId}/tickets/${btn.dataset.unclaim}/unclaim`); toast('Ticket unclaimed', 'ok'); renderTickets(root, guildId, me); }
    catch (e) { toast(e.message || 'Could not unclaim ticket', 'err'); btn.disabled = false; }
  }));
  qsa('[data-close]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Close this ticket? The channel will be deleted after a short delay, same as closing it in Discord.')) return;
    btn.disabled = true;
    try { await API.post(`/api/guilds/${guildId}/tickets/${btn.dataset.close}/close`); toast('Ticket closed', 'ok'); renderTickets(root, guildId, me); }
    catch (e) { toast(e.message || 'Could not close ticket', 'err'); btn.disabled = false; }
  }));
}

// ══════════════════════════════════════════════════════════
//  VIEW: EXILE — add/remove call the exact same performExile/performUnexile
//  helpers the /exile command uses. Note: exile records aren't stored
//  per-guild in the bot's data model, so this list is filtered server-side
//  to members who are actually in this guild.
// ══════════════════════════════════════════════════════════
async function renderExile(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading exiled members…</p></div>`;
  let data;
  try { data = await API.get(`/api/guilds/${guildId}/exiles`); } catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'exile');
  let picked = null; // { id, tag, avatarUrl } — selected from the member search dropdown

  const row = (x) => `
    <div class="field-row is-col" data-exile="${esc(x.userId)}">
      <div style="display:flex;justify-content:space-between;width:100%;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div style="min-width:0;">
          <div style="font-weight:600;font-size:13.5px;">${esc(x.tag)}</div>
          ${x.reason ? `<div style="font-size:12px;color:var(--text-faint);margin-top:3px;max-width:56ch;">${esc(x.reason)}</div>` : ''}
          <div class="mono" style="font-size:11px;color:var(--text-faint);margin-top:6px;">
            ${x.expiry ? `expires ${timeAgo(x.expiry)}` : 'no expiry set'}
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" data-unexile="${esc(x.userId)}">Unexile</button>
      </div>
    </div>`;

  content.innerHTML = `
    <div class="content-head"><div><h1>⛓️ Exile</h1><p>Add or remove exiles here — same role/channel behavior as <code>/exile</code> in Discord.</p></div></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-num">${data.exiles.length}</div><div class="stat-label">Currently exiled</div></div>
    </div>

    <div class="card" style="padding:20px;margin-bottom:14px;">
      <h3 style="font-size:14px;margin-bottom:14px;">Exile a member</h3>
      <div style="position:relative;margin-bottom:10px;">
        <input type="text" id="ex-search" placeholder="Search by username or nickname…" style="width:100%;" autocomplete="off">
        <div id="ex-results" class="card" style="position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:5;display:none;max-height:220px;overflow-y:auto;"></div>
      </div>
      <div id="ex-picked" style="display:none;align-items:center;gap:8px;margin-bottom:10px;font-size:13px;">
        <span>Exiling:</span><strong id="ex-picked-tag"></strong>
        <button class="btn btn-ghost btn-sm" id="ex-clear">Change</button>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
        <input type="text" id="ex-duration" placeholder="Duration — 45m, 2h, 1d (default 45m)" style="flex:1;min-width:200px;">
        <input type="text" id="ex-reason" placeholder="Reason (optional)" style="flex:2;min-width:240px;">
      </div>
      <button class="btn btn-primary btn-sm" id="ex-submit" disabled>Exile</button>
    </div>

    <div class="section-label">Currently exiled (${data.exiles.length})</div>
    ${data.exiles.length ? `<div class="card">${data.exiles.map(row).join('')}</div>` : `<div class="state-block"><h3>Nobody is currently exiled</h3></div>`}
  `;

  // ── member search dropdown ──
  const searchInput = qs('#ex-search'), resultsBox = qs('#ex-results');
  searchInput.addEventListener('input', debounce(async () => {
    const q = searchInput.value.trim();
    if (q.length < 2) { resultsBox.style.display = 'none'; return; }
    let res;
    try { res = await API.get(`/api/guilds/${guildId}/members/search?q=${encodeURIComponent(q)}`); } catch { return; }
    if (!res.members.length) { resultsBox.style.display = 'none'; return; }
    resultsBox.innerHTML = res.members.map(m => `
      <div class="field-row" data-pick="${esc(m.id)}" style="cursor:pointer;padding:8px 12px;">
        <img src="${esc(m.avatarUrl)}" alt="" style="width:22px;height:22px;border-radius:50%;">
        <span style="font-size:12.5px;">${esc(m.nickname || m.tag)}${m.nickname ? ` <span style="color:var(--text-faint);">(${esc(m.tag)})</span>` : ''}</span>
      </div>`).join('');
    resultsBox.style.display = 'block';
    qsa('[data-pick]', resultsBox).forEach(node => node.addEventListener('click', () => {
      const m = res.members.find(x => x.id === node.dataset.pick);
      picked = m;
      qs('#ex-picked-tag').textContent = m.nickname || m.tag;
      qs('#ex-picked').style.display = 'flex';
      searchInput.style.display = 'none';
      resultsBox.style.display = 'none';
      qs('#ex-submit').disabled = false;
    }));
  }, 200));
  qs('#ex-clear').addEventListener('click', () => {
    picked = null;
    qs('#ex-picked').style.display = 'none';
    searchInput.style.display = 'block';
    searchInput.value = '';
    qs('#ex-submit').disabled = true;
  });

  qs('#ex-submit').addEventListener('click', async (e) => {
    if (!picked) return;
    e.target.disabled = true;
    const durationRaw = qs('#ex-duration').value.trim();
    const minutes = parseDurationClient(durationRaw); // undefined → server falls back to the bot's own default
    try {
      await API.post(`/api/guilds/${guildId}/exiles`, { userId: picked.id, minutes, reason: qs('#ex-reason').value.trim() || undefined });
      toast(`Exiled ${picked.tag}`, 'ok');
      renderExile(root, guildId, me);
    } catch (err) { toast(err.message || 'Could not exile that member', 'err'); e.target.disabled = false; }
  });

  qsa('[data-unexile]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await API.post(`/api/guilds/${guildId}/exiles/${btn.dataset.unexile}/remove`); toast('Unexiled', 'ok'); renderExile(root, guildId, me); }
    catch (e) { toast(e.message || 'Could not unexile', 'err'); btn.disabled = false; }
  }));
}
// Mirrors the bot's own parseDuration() shape (30s/10m/2h/1d/1w) client-side
// just for the input field — the server independently validates/clamps
// whatever number it receives, so a bad parse here just means we omit the
// field and let the bot's own default (45m) apply, not that anything unsafe happens.
function parseDurationClient(raw) {
  const m = raw.match(/^(\d+)\s*([smhdw])$/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  const mult = { s: 1/60, m: 1, h: 60, d: 60*24, w: 60*24*7 }[m[2].toLowerCase()];
  return Math.round(n * mult) || undefined;
}

// ══════════════════════════════════════════════════════════
//  VIEW: CUSTOM AUTOMOD — every mutation calls the exact same core*()
//  function /beli automod's subcommands call server-side; this page adds
//  no new rule-matching logic, just a UI over the existing one.
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
//  VIEW: TICKET DESIGNER — edits gs.ticketPanel.*, the exact same fields
//  the generic Settings → Ticket System category has. This page is a
//  friendlier editor with a live Discord-style preview, not a second data
//  source — saving here and saving there both write the same keys.
// ══════════════════════════════════════════════════════════
async function renderTicketDesigner(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading Ticket Designer…</p></div>`;
  let gs;
  try { gs = await API.get(`/api/guilds/${guildId}/settings`); }
  catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content, guildInfo } = renderGuildShell(root, guildId, me, 'ticketdesigner');
  const draft = { title: '🎫 Support Tickets', description: '**Need help? Open a support ticket!**\n\nClick below to open a ticket.', color: 0x5865F2, footer: '', buttonLabel: '📩 Open a Ticket', buttonStyle: 'Primary', thumbnailUrl: '', imageUrl: '', ...gs.ticketPanel };

  function draw() {
    content.innerHTML = `
      <div class="content-head"><div><h1>🎫 Ticket Designer</h1><p>Same panel data as Settings → Ticket System, with a live Discord-style preview.</p></div></div>
      <div class="cd-layout" style="grid-template-columns: 320px 1fr;">
        <div class="cd-panel cd-inspector" style="max-height:none;">
          <div class="cd-panel-head">Panel design</div>
          <div style="padding:14px;">
            <div class="cd-prop-row"><label>Title</label><input type="text" id="tp-title" value="${esc(draft.title)}"></div>
            <div class="cd-prop-row"><label>Description</label><textarea id="tp-desc" rows="5">${esc(draft.description)}</textarea></div>
            <div class="cd-prop-row"><label>Color</label><input type="color" id="tp-color" value="${esc(colorIntToHex(draft.color))}"></div>
            <div class="cd-prop-row"><label>Footer</label><input type="text" id="tp-footer" value="${esc(draft.footer)}" placeholder="{server} Support"></div>
            <div class="cd-prop-row"><label>Button label</label><input type="text" id="tp-btnlabel" value="${esc(draft.buttonLabel)}"></div>
            <div class="cd-prop-row"><label>Button style</label><select id="tp-btnstyle">${['Primary', 'Secondary', 'Success', 'Danger'].map(s => `<option value="${s}" ${draft.buttonStyle === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
            <div class="cd-prop-row"><label>Thumbnail URL</label><input type="text" id="tp-thumb" value="${esc(draft.thumbnailUrl)}"></div>
            <div class="cd-prop-row"><label>Banner image URL</label><input type="text" id="tp-image" value="${esc(draft.imageUrl)}"></div>
            <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-primary btn-sm" id="tp-save">Save design</button>
              <button class="btn btn-ghost btn-sm" id="tp-post">Post to channel now</button>
            </div>
            ${!gs.ticketPanelChannelId ? `<p class="mono" style="font-size:10.5px;color:var(--danger);margin-top:8px;">No panel channel set (Settings → Ticket System) — posting will fail until one is.</p>` : ''}
          </div>
        </div>

        <div class="cd-panel-canvas cd-canvas-panel" style="padding:20px;">
          <div class="cd-panel-head" style="margin:-20px -20px 16px;">Live preview</div>
          <div class="discord-preview">
            <div class="discord-embed" style="border-left-color:${esc(colorIntToHex(draft.color))};">
              ${draft.thumbnailUrl ? `<img class="discord-embed-thumb" src="${esc(draft.thumbnailUrl)}" onerror="this.style.display='none'">` : ''}
              <div class="discord-embed-title">${esc(draft.title)}</div>
              <div class="discord-embed-desc">${esc(draft.description).replace(/\n/g, '<br>')}</div>
              ${draft.imageUrl ? `<img class="discord-embed-image" src="${esc(draft.imageUrl)}" onerror="this.style.display='none'">` : ''}
              <div class="discord-embed-footer">${esc(draft.footer || `${guildInfo.name} Support`)}</div>
            </div>
            <div class="discord-btn discord-btn-${draft.buttonStyle.toLowerCase()}">${esc(draft.buttonLabel)}</div>
          </div>
        </div>
      </div>
    `;
    bind();
  }

  async function postWarning() {
    const btn = qs('#hp-post-warning'); if (!btn) return;
    if (!confirm(`Post and pin the current warning in all ${cfg.channels.length} honeypot channel(s)?`)) return;
    btn.disabled = true;
    try { const r = await API.post(`/api/guilds/${guildId}/honeypot/post-warning`, {}); toast(`Warning posted to ${r.posted}/${r.total} channels`, r.failed ? 'err' : 'ok'); }
    catch (e) { toast(e.message, 'err'); }
    finally { btn.disabled = false; }
  }

  function bind() {
    const sync = () => {
      draft.title = qs('#tp-title').value; draft.description = qs('#tp-desc').value;
      draft.color = parseInt(qs('#tp-color').value.slice(1), 16); draft.footer = qs('#tp-footer').value;
      draft.buttonLabel = qs('#tp-btnlabel').value; draft.buttonStyle = qs('#tp-btnstyle').value;
      draft.thumbnailUrl = qs('#tp-thumb').value; draft.imageUrl = qs('#tp-image').value;
      draw();
    };
    qsa('#tp-title, #tp-desc, #tp-color, #tp-footer, #tp-btnlabel, #tp-btnstyle, #tp-thumb, #tp-image').forEach(inp => {
      inp.addEventListener(inp.tagName === 'SELECT' || inp.type === 'color' ? 'change' : 'input', debounce(sync, 250));
    });
    qs('#tp-save').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await API.post(`/api/guilds/${guildId}/settings`, {
          'ticketPanel.title': draft.title, 'ticketPanel.description': draft.description, 'ticketPanel.color': draft.color,
          'ticketPanel.footer': draft.footer, 'ticketPanel.buttonLabel': draft.buttonLabel, 'ticketPanel.buttonStyle': draft.buttonStyle,
          'ticketPanel.thumbnailUrl': draft.thumbnailUrl, 'ticketPanel.imageUrl': draft.imageUrl,
        });
        gs.ticketPanel = { ...draft };
        toast('Panel design saved', 'ok');
      } catch (err) { toast(err.message || 'Save failed', 'err'); }
      finally { e.target.disabled = false; }
    });
    qs('#tp-post').addEventListener('click', async (e) => {
      if (!confirm('Post this panel to the configured ticket channel now?')) return;
      e.target.disabled = true;
      try { await API.post(`/api/guilds/${guildId}/tickets/panel/post`); toast('Panel posted', 'ok'); }
      catch (err) { toast(err.message || 'Failed to post', 'err'); }
      finally { e.target.disabled = false; }
    });
  }

  draw();
}

async function renderAutomod(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading Custom AutoMod…</p></div>`;
  let cfg, meta;
  try {
    [cfg, meta] = await Promise.all([
      API.get(`/api/guilds/${guildId}/automod`),
      API.get(`/api/guilds/${guildId}/meta`),
    ]);
  } catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'automod');

  async function callOp(op, value) {
    try { const r = await API.post(`/api/guilds/${guildId}/automod/${op}`, { value }); return r.result; }
    catch (e) { toast(e.message || 'That action failed', 'err'); throw e; }
  }

  function draw() {
    content.innerHTML = `
      <div class="content-head">
        <div><h1>🚫 Custom AutoMod</h1><p>Word and regex filtering — same engine as <code>/beli automod</code> in Discord.</p></div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="badge ${cfg.enabled ? 'badge-on' : 'badge-off'}">${cfg.enabled ? 'Enabled' : 'Disabled'}</span>
          <button class="btn btn-sm ${cfg.enabled ? 'btn-ghost' : 'btn-primary'}" id="am-toggle">${cfg.enabled ? 'Disable' : 'Enable'}</button>
        </div>
      </div>

      <div class="card" style="padding:20px;margin-bottom:14px;">
        <h3 style="font-size:14px;margin-bottom:4px;">Blocked words <span class="mono" style="font-size:11px;color:var(--text-faint);">(${cfg.words.length}/${cfg.limits.maxWords})</span></h3>
        <p style="font-size:12px;color:var(--text-faint);margin-bottom:12px;">Matched as whole words/phrases, case-insensitive.</p>
        <div class="chip-field" id="am-words">
          ${cfg.words.map(w => `<span class="chip">${esc(w)}<button data-remove-word="${esc(w)}" title="Remove">×</button></span>`).join('')}
          <input type="text" id="am-word-input" placeholder="Add a word or phrase…" style="background:transparent;border:1px dashed var(--border-hi);font-size:12px;padding:4px 10px;min-width:160px;">
        </div>
      </div>

      <div class="card" style="padding:20px;margin-bottom:14px;">
        <h3 style="font-size:14px;margin-bottom:4px;">Regex rules <span class="mono" style="font-size:11px;color:var(--text-faint);">(${cfg.regexRules.length}/${cfg.limits.maxRegex})</span></h3>
        <p style="font-size:12px;color:var(--text-faint);margin-bottom:12px;">Patterns are checked for catastrophic-backtracking shapes before they're saved.</p>
        ${cfg.regexRules.map(r => `
          <div class="field-row">
            <code class="mono" style="font-size:12px;">/${esc(r.pattern)}/${esc(r.flags)}</code>
            <button class="btn btn-ghost btn-sm" data-remove-regex="${esc(r.pattern)}">Remove</button>
          </div>`).join('')}
        <div style="display:flex;gap:8px;margin-top:10px;">
          <input type="text" id="am-regex-pattern" placeholder="Pattern (no slashes)" style="flex:2;">
          <input type="text" id="am-regex-flags" placeholder="Flags (default i)" style="flex:1;">
          <button class="btn btn-ghost btn-sm" id="am-regex-add">Add</button>
        </div>
      </div>

      <div class="card" style="padding:20px;margin-bottom:14px;">
        <h3 style="font-size:14px;margin-bottom:14px;">Action on match</h3>
        <div class="field-row">
          <div><strong style="font-size:13px;">What happens</strong></div>
          <select id="am-action">
            ${['delete', 'warn', 'timeout', 'kick', 'ban'].map(a => `<option value="${a}" ${cfg.action === a ? 'selected' : ''}>${a[0].toUpperCase() + a.slice(1)}${a === 'delete' ? ' only' : ''}</option>`).join('')}
          </select>
        </div>
        ${cfg.action === 'timeout' ? `
        <div class="field-row">
          <div><strong style="font-size:13px;">Timeout duration (minutes)</strong></div>
          <input type="number" id="am-timeout-min" value="${cfg.timeoutMinutes}" min="1" max="40320" style="width:120px;">
        </div>` : ''}
      </div>

      <div class="card" style="padding:20px;margin-bottom:14px;">
        <h3 style="font-size:14px;margin-bottom:14px;">Test a message (dry run — takes no action)</h3>
        <div style="display:flex;gap:8px;">
          <input type="text" id="am-test-input" placeholder="Type text to test against your current rules…" style="flex:1;">
          <button class="btn btn-primary btn-sm" id="am-test-btn">Test</button>
        </div>
        <div id="am-test-result" style="margin-top:12px;"></div>
      </div>

      <div class="card" style="padding:20px;">
        <h3 style="font-size:14px;margin-bottom:14px;">Exemptions</h3>
        <div style="font-size:12.5px;color:var(--text-faint);margin-bottom:6px;">Exempt roles</div>
        <div class="chip-field" style="margin-bottom:14px;">
          ${cfg.exemptRoles.map(r => `<span class="chip">${esc(r.name)}<button data-unexempt-role="${esc(r.id)}">×</button></span>`).join('')}
          <select id="am-role-add"><option value="">+ Add role…</option>${meta.roles.filter(r => !cfg.exemptRoles.some(x => x.id === r.id)).map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>
        </div>
        <div style="font-size:12.5px;color:var(--text-faint);margin-bottom:6px;">Exempt channels</div>
        <div class="chip-field" style="margin-bottom:14px;">
          ${cfg.exemptChannels.map(c => `<span class="chip">#${esc(c.name)}<button data-unexempt-channel="${esc(c.id)}">×</button></span>`).join('')}
          <select id="am-channel-add"><option value="">+ Add channel…</option>${meta.channels.filter(c => !cfg.exemptChannels.some(x => x.id === c.id)).map(c => `<option value="${c.id}">#${esc(c.name)}</option>`).join('')}</select>
        </div>
        <div style="font-size:12.5px;color:var(--text-faint);margin-bottom:6px;">Log channel</div>
        <select id="am-logchannel">
          <option value="">None</option>
          ${meta.channels.map(c => `<option value="${c.id}" ${cfg.logChannelId === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}
        </select>
        <div style="margin-top:18px;"><button class="btn btn-danger btn-sm" id="am-reset">Reset to defaults</button></div>
      </div>
    `;
    bind();
  }

  function bind() {
    qs('#am-toggle').addEventListener('click', async (e) => {
      e.target.disabled = true;
      await callOp(cfg.enabled ? 'disable' : 'enable').catch(() => { e.target.disabled = false; return; });
      cfg.enabled = !cfg.enabled;
      draw();
    });
    qs('#am-word-input').addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !e.target.value.trim()) return;
      const w = e.target.value.trim();
      try { await callOp('wordAdd', w); cfg.words.push(w.toLowerCase()); draw(); } catch {}
    });
    qsa('[data-remove-word]').forEach(btn => btn.addEventListener('click', async () => {
      const w = btn.dataset.removeWord;
      try { await callOp('wordRemove', w); cfg.words = cfg.words.filter(x => x !== w); draw(); } catch {}
    }));
    qs('#am-regex-add').addEventListener('click', async () => {
      const pattern = qs('#am-regex-pattern').value.trim(), flags = qs('#am-regex-flags').value.trim() || 'i';
      if (!pattern) return;
      try { await callOp('regexAdd', { pattern, flags }); cfg.regexRules.push({ pattern, flags }); draw(); } catch {}
    });
    qsa('[data-remove-regex]').forEach(btn => btn.addEventListener('click', async () => {
      const p = btn.dataset.removeRegex;
      try { await callOp('regexRemove', p); cfg.regexRules = cfg.regexRules.filter(r => r.pattern !== p); draw(); } catch {}
    }));
    qs('#am-action').addEventListener('change', async (e) => {
      try { await callOp('setAction', e.target.value); cfg.action = e.target.value; draw(); } catch { draw(); }
    });
    qs('#am-timeout-min')?.addEventListener('change', async (e) => {
      const v = parseInt(e.target.value, 10);
      try { await callOp('setTimeout', v); cfg.timeoutMinutes = v; } catch {}
    });
    qs('#am-test-btn').addEventListener('click', async () => {
      const text = qs('#am-test-input').value;
      const box = qs('#am-test-result');
      box.innerHTML = `<span class="mono" style="font-size:12px;color:var(--text-faint);">Testing…</span>`;
      try {
        const r = await API.post(`/api/guilds/${guildId}/automod/test`, { text });
        box.innerHTML = r.matched
          ? `<span class="badge badge-off" style="background:var(--danger-dim);color:var(--danger);">🛑 Would be blocked</span> <span class="mono" style="font-size:12px;color:var(--text-faint);margin-left:8px;">matched ${esc(r.match.type)} rule: ${esc(r.match.rule)}</span>`
          : `<span class="badge badge-on">✅ Would pass</span>`;
      } catch (e) { box.innerHTML = `<span style="color:var(--danger);font-size:12.5px;">${esc(e.message || 'Test failed')}</span>`; }
    });
    qs('#am-role-add').addEventListener('change', async (e) => {
      const id = e.target.value; if (!id) return;
      try { const name = e.target.selectedOptions[0].textContent; await callOp('exemptRole', id); cfg.exemptRoles.push({ id, name }); draw(); } catch { draw(); }
    });
    qsa('[data-unexempt-role]').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.unexemptRole;
      try { await callOp('unexemptRole', id); cfg.exemptRoles = cfg.exemptRoles.filter(r => r.id !== id); draw(); } catch {}
    }));
    qs('#am-channel-add').addEventListener('change', async (e) => {
      const id = e.target.value; if (!id) return;
      try { const name = e.target.selectedOptions[0].textContent.replace(/^#/, ''); await callOp('exemptChannel', id); cfg.exemptChannels.push({ id, name }); draw(); } catch { draw(); }
    });
    qsa('[data-unexempt-channel]').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.unexemptChannel;
      try { await callOp('unexemptChannel', id); cfg.exemptChannels = cfg.exemptChannels.filter(c => c.id !== id); draw(); } catch {}
    }));
    qs('#am-logchannel').addEventListener('change', async (e) => {
      try { await callOp('setLogChannel', e.target.value || null); cfg.logChannelId = e.target.value || null; } catch {}
    });
    qs('#am-reset').addEventListener('click', async () => {
      if (!confirm('Reset Custom AutoMod to defaults? This clears every word, regex rule, and exemption.')) return;
      try { await callOp('reset'); toast('Custom AutoMod reset', 'ok'); renderAutomod(root, guildId, me); } catch {}
    });
  }

  draw();
}

async function renderHoneypot(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading Honeypot…</p></div>`;
  let cfg, meta;
  try {
    [cfg, meta] = await Promise.all([
      API.get(`/api/guilds/${guildId}/honeypot`),
      API.get(`/api/guilds/${guildId}/meta`),
    ]);
  } catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'honeypot');

  async function callOp(op, value) {
    try { const r = await API.post(`/api/guilds/${guildId}/honeypot/${op}`, { value }); return r.result; }
    catch (e) { toast(e.message || 'That action failed', 'err'); throw e; }
  }

  function draw() {
    content.innerHTML = `
      <div class="content-head">
        <div><h1>🍯 Honeypot</h1><p>Trap channels, a trap role, and trap commands — anyone who touches one gets actioned automatically. Same engine as <code>/beli security honeypot-*</code> in Discord.</p></div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="badge ${cfg.enabled ? 'badge-on' : 'badge-off'}">${cfg.enabled ? 'Enabled' : 'Disabled'}</span>
          <button class="btn btn-sm ${cfg.enabled ? 'btn-ghost' : 'btn-primary'}" id="hp-toggle">${cfg.enabled ? 'Disable' : 'Enable'}</button>
        </div>
      </div>

      <div class="card" style="padding:20px;margin-bottom:14px;">
        <h3 style="font-size:14px;margin-bottom:14px;">Action on trigger</h3>
        <div class="field-row">
          <div><strong style="font-size:13px;">What happens</strong></div>
          <select id="hp-action">
            ${['ban', 'softban', 'kick', 'timeout'].map(a => `<option value="${a}" ${cfg.action === a ? 'selected' : ''}>${a[0].toUpperCase() + a.slice(1)}</option>`).join('')}
          </select>
        </div>
        ${cfg.action === 'softban' || cfg.action === 'kick' ? `
        <div class="field-row">
          <div><strong style="font-size:13px;">Send a fresh invite back after</strong><div style="font-size:11.5px;color:var(--text-faint);">Only applies to softban/kick — a ban has no invite-back.</div></div>
          <label class="switch"><input type="checkbox" id="hp-reinvite" ${cfg.reinvite ? 'checked' : ''}><span class="slider"></span></label>
        </div>` : ''}
        <div style="font-size:12.5px;color:var(--text-faint);margin:12px 0 6px;">Log channel</div>
        <select id="hp-logchannel">
          <option value="">None</option>
          ${meta.channels.map(c => `<option value="${c.id}" ${cfg.logChannelId === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}
        </select>
      </div>

      <div class="card" style="padding:20px;margin-bottom:14px;">
        <h3 style="font-size:14px;margin-bottom:4px;">Trap channels <span class="mono" style="font-size:11px;color:var(--text-faint);">(${cfg.channels.length}/${cfg.limits.maxChannels})</span></h3>
        <p style="font-size:12px;color:var(--text-faint);margin-bottom:12px;">Any message sent in one of these channels triggers the action above — post a warning in them so real members know to stay out.</p><button class="btn btn-ghost btn-sm" id="hp-post-warning">📌 Post &amp; pin warning in all trap channels</button>
        <div class="chip-field" style="margin-bottom:10px;">
          ${cfg.channels.map(c => `<span class="chip">#${esc(c.name)}<button data-remove-hp-channel="${esc(c.id)}">×</button></span>`).join('')}
          <select id="hp-channel-add"><option value="">+ Add channel…</option>${meta.channels.filter(c => !cfg.channels.some(x => x.id === c.id)).map(c => `<option value="${c.id}">#${esc(c.name)}</option>`).join('')}</select>
        </div>
      </div>

      <div class="card" style="padding:20px;margin-bottom:14px;">
        <h3 style="font-size:14px;margin-bottom:4px;">Trap role</h3>
        <p style="font-size:12px;color:var(--text-faint);margin-bottom:12px;">If anyone (a compromised bot, a mis-set reaction role, etc.) grants this role to a member, that triggers the action too. Pick a role nobody should legitimately end up with.</p>
        <select id="hp-role">
          <option value="">None</option>
          ${meta.roles.map(r => `<option value="${r.id}" ${cfg.roleId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
        </select>
      </div>

      <div class="card" style="padding:20px;margin-bottom:14px;">
        <h3 style="font-size:14px;margin-bottom:4px;">Trap commands <span class="mono" style="font-size:11px;color:var(--text-faint);">(${cfg.trapCommands.length}/${cfg.limits.maxCommands})</span></h3>
        <p style="font-size:12px;color:var(--text-faint);margin-bottom:12px;">Fake prefix-command names — running one as "!name" triggers the action, even though it isn't a real command.</p>
        <div class="chip-field" id="hp-commands">
          ${cfg.trapCommands.map(c => `<span class="chip">${esc(c)}<button data-remove-hp-command="${esc(c)}" title="Remove">×</button></span>`).join('')}
          <input type="text" id="hp-command-input" placeholder="Add a fake command name…" style="background:transparent;border:1px dashed var(--border-hi);font-size:12px;padding:4px 10px;min-width:160px;">
        </div>
      </div>

      <div class="card" style="padding:20px;margin-bottom:14px;">
        <h3 style="font-size:14px;margin-bottom:4px;">Messages</h3>
        <p style="font-size:12px;color:var(--text-faint);margin-bottom:12px;">Supports <code>{{user:mention}}</code>, <code>{{action:text}}</code>, <code>{{server:name}}</code>, <code>{{trigger:text}}</code>, <code>{{honeypot:channel:mention}}</code>. Clear a box and save to reset that one to the built-in default.</p>
        ${['warning', 'dm', 'log'].map(type => `
          <div style="margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <label style="font-size:12.5px;font-weight:600;">${type === 'warning' ? 'Channel warning (posted in trap channels)' : type === 'dm' ? 'DM to the user' : 'Log channel message'}</label>
              ${cfg.messagesCustomized[type] ? `<span class="badge badge-on" style="font-size:10px;">customized</span>` : `<span class="badge badge-off" style="font-size:10px;">default</span>`}
            </div>
            <textarea data-hp-msg="${type}" rows="3" style="width:100%;font-family:var(--font-mono);font-size:12px;">${esc(cfg.messages[type])}</textarea>
          </div>`).join('')}
        <button class="btn btn-primary btn-sm" id="hp-messages-save">Save messages</button>
      </div>

      <div class="card" style="padding:20px;">
        <button class="btn btn-danger btn-sm" id="hp-reset">Reset to defaults</button>
      </div>
    `;
    bind();
  }

  function bind() {
    qs('#hp-post-warning')?.addEventListener('click', postWarning);
    qs('#hp-toggle').addEventListener('click', async (e) => {
      e.target.disabled = true;
      await callOp('setEnabled', !cfg.enabled).catch(() => { e.target.disabled = false; return; });
      cfg.enabled = !cfg.enabled;
      draw();
    });
    qs('#hp-action').addEventListener('change', async (e) => {
      try { await callOp('setAction', e.target.value); cfg.action = e.target.value; draw(); } catch { draw(); }
    });
    qs('#hp-reinvite')?.addEventListener('change', async (e) => {
      try { await callOp('setReinvite', e.target.checked); cfg.reinvite = e.target.checked; } catch { draw(); }
    });
    qs('#hp-logchannel').addEventListener('change', async (e) => {
      try { await callOp('setLogChannel', e.target.value || null); cfg.logChannelId = e.target.value || null; } catch {}
    });
    qs('#hp-channel-add').addEventListener('change', async (e) => {
      const id = e.target.value; if (!id) return;
      try { const name = e.target.selectedOptions[0].textContent.replace(/^#/, ''); await callOp('channelAdd', id); cfg.channels.push({ id, name }); draw(); } catch { draw(); }
    });
    qsa('[data-remove-hp-channel]').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.removeHpChannel;
      try { await callOp('channelRemove', id); cfg.channels = cfg.channels.filter(c => c.id !== id); draw(); } catch {}
    }));
    qs('#hp-role').addEventListener('change', async (e) => {
      try { await callOp('setRole', e.target.value || null); cfg.roleId = e.target.value || null; } catch { draw(); }
    });
    qs('#hp-command-input').addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !e.target.value.trim()) return;
      const c = e.target.value.trim();
      try { await callOp('commandAdd', c); cfg.trapCommands.push(c.toLowerCase()); draw(); } catch {}
    });
    qsa('[data-remove-hp-command]').forEach(btn => btn.addEventListener('click', async () => {
      const c = btn.dataset.removeHpCommand;
      try { await callOp('commandRemove', c); cfg.trapCommands = cfg.trapCommands.filter(x => x !== c); draw(); } catch {}
    }));
    qs('#hp-messages-save').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        for (const type of ['warning', 'dm', 'log']) {
          const text = qs(`[data-hp-msg="${type}"]`).value;
          await callOp('setMessage', { type, text });
        }
        toast('Messages saved', 'ok');
        renderHoneypot(root, guildId, me);
      } catch { e.target.disabled = false; }
    });
    qs('#hp-reset').addEventListener('click', async () => {
      if (!confirm('Reset Honeypot to defaults? This clears every trap channel, the trap role, trap commands, and custom messages.')) return;
      try { await callOp('reset'); toast('Honeypot reset', 'ok'); renderHoneypot(root, guildId, me); } catch {}
    });
  }

  draw();
}

async function renderAppeals(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading Appeals…</p></div>`;
  let data;
  try { data = await API.get(`/api/guilds/${guildId}/appeals`); }
  catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'appeals');

  const TYPE_META = {
    exile: { icon: '🚪', label: 'Exile' }, general: { icon: '📝', label: 'General' },
    warn: { icon: '⚠️', label: 'Warn' }, timeout: { icon: '⏱️', label: 'Timeout' },
    ban: { icon: '🔨', label: 'Ban' }, honeypot: { icon: '🍯', label: 'Honeypot' },
  };
  const STATUS_BADGE = { pending: 'badge-off', accepted: 'badge-on', rejected: 'badge-danger' };
  let statusFilter = 'all';

  function draw() {
    const rows = statusFilter === 'all' ? data.appeals : data.appeals.filter(a => a.status === statusFilter);
    const counts = { pending: 0, accepted: 0, rejected: 0 };
    for (const a of data.appeals) counts[a.status] = (counts[a.status] || 0) + 1;
    content.innerHTML = `
      <div class="content-head">
        <div><h1>📩 Appeals</h1><p>Review pending appeals directly from the dashboard. Accepted actions reuse the bot's real reversal handlers; rejected actions preserve the original moderation action.</p></div>
      </div>
      <div class="cd-tabs" style="margin-bottom:14px;">
        <button class="cd-tab ${statusFilter === 'all' ? 'is-active' : ''}" data-appeal-filter="all">All (${data.appeals.length})</button>
        <button class="cd-tab ${statusFilter === 'pending' ? 'is-active' : ''}" data-appeal-filter="pending">Pending (${counts.pending || 0})</button>
        <button class="cd-tab ${statusFilter === 'accepted' ? 'is-active' : ''}" data-appeal-filter="accepted">Accepted (${counts.accepted || 0})</button>
        <button class="cd-tab ${statusFilter === 'rejected' ? 'is-active' : ''}" data-appeal-filter="rejected">Rejected (${counts.rejected || 0})</button>
      </div>
      ${rows.length ? rows.map(a => {
        const meta = TYPE_META[a.type] || { icon: '📄', label: a.type };
        const extraLines = Object.entries(a.extra || {}).filter(([, v]) => v !== undefined)
          .map(([k, v]) => `<div style="font-size:11.5px;color:var(--text-faint);"><strong>${esc(k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()))}:</strong> ${esc(String(v))}</div>`).join('');
        return `
        <div class="card" style="padding:16px 20px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;">
            <div style="min-width:0;flex:1;">
              <div style="font-size:13px;margin-bottom:4px;">${meta.icon} <strong>${esc(meta.label)}</strong> appeal from ${a.tag ? esc(a.tag) : `<span class="mono">${esc(a.userId)}</span>`}</div>
              <div style="font-size:12.5px;color:var(--text-secondary);white-space:pre-wrap;margin-bottom:6px;">${esc(a.reason || '(no reason given)')}</div>
              ${extraLines}
            </div>
            <div style="text-align:right;white-space:nowrap;">
              <span class="badge ${STATUS_BADGE[a.status] || 'badge-off'}">${esc(a.status)}</span>
              <div style="font-size:11px;color:var(--text-faint);margin-top:6px;">${a.createdAt ? new Date(a.createdAt).toLocaleString() : ''}</div>
              ${a.status === 'pending' ? `<div style="display:flex;gap:6px;justify-content:flex-end;margin-top:9px;"><button class="btn btn-primary btn-sm" data-appeal-action="accept" data-appeal-id="${esc(a.id)}">Accept</button><button class="btn btn-danger btn-sm" data-appeal-action="reject" data-appeal-id="${esc(a.id)}">Reject</button></div>` : ''}
            </div>
          </div>
        </div>`;
      }).join('') : `<p style="color:var(--text-faint);font-size:13px;">No ${statusFilter === 'all' ? '' : statusFilter + ' '}appeals${statusFilter === 'all' ? ' yet' : ''}.</p>`}
    `;
    qsa('[data-appeal-filter]').forEach(btn => btn.addEventListener('click', () => { statusFilter = btn.dataset.appealFilter; draw(); }));
    qsa('[data-appeal-action]').forEach(btn => btn.addEventListener('click', async () => {
      const action = btn.dataset.appealAction, id = btn.dataset.appealId;
      let reason = '';
      if (action === 'reject') reason = prompt('Optional rejection note:') || '';
      if (!confirm(`Confirm ${action} for this appeal?`)) return;
      btn.disabled = true;
      try {
        const result = await API.post(`/api/guilds/${guildId}/appeals/${encodeURIComponent(id)}/action`, { action, reason });
        const refreshed = await API.get(`/api/guilds/${guildId}/appeals`);
        data = refreshed;
        toast(action === 'accept' ? 'Appeal accepted' : 'Appeal rejected', 'ok');
        draw();
      } catch (e) { btn.disabled = false; toast(e.message || 'Appeal action failed', 'err'); }
    }));
  }
  draw();
}

function genLayerId() { return `layer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`; }


async function renderAppealForm(root, guildId, me) {
  root.innerHTML=`<div class="state-block"><div class="spinner"></div><p>Loading Appeal Form Studio…</p></div>`;
  let data; try{data=await API.get(`/api/guilds/${guildId}/appeal-form`);}catch(e){root.innerHTML=errorBlock(e.message);return;}
  const {content}=renderGuildShell(root,guildId,me,'appeal-form'); let cfg=data.config; let selected=null; let draggingId=null;
  const channelOptions=data.channels.filter(c=>c.type===0).map(c=>`<option value="${c.id}" ${c.id===cfg.channelId?'selected':''}>#${esc(c.name)}</option>`).join('');
  const roleOptions=data.roles.map(r=>`<option value="${r.id}">@${esc(r.name)}</option>`).join('');
  function draw(){
    content.innerHTML=`
      <div class="content-head"><div><h1>📝 Custom Appeal Form Studio</h1><p>Build a private DM appeal workflow without replacing DISCOMOD's existing moderation-specific appeal handlers.</p></div><span class="status-pill"><span class="status-dot"></span>${cfg.enabled?'ACTIVE':'DISABLED'}</span></div>
      <div class="grid-2">
        <div class="card" style="padding:18px 20px"><h3>Form configuration</h3><div class="form-grid" style="margin-top:12px">
          <label class="field"><span>Enabled</span><select id="af-enabled"><option value="true" ${cfg.enabled?'selected':''}>Enabled</option><option value="false" ${!cfg.enabled?'selected':''}>Disabled</option></select></label>
          <label class="field"><span>Review channel</span><select id="af-channel"><option value="">— none —</option>${channelOptions}</select></label>
          <label class="field"><span>Time limit (minutes)</span><input id="af-time" type="number" min="1" max="10080" value="${cfg.timeLimitMinutes}"></label>
          <label class="field"><span>Max active per user</span><input id="af-max" type="number" min="1" max="10" value="${cfg.maxActivePerUser}"></label>
        </div>
        <label class="field"><span>Title</span><input id="af-title" value="${esc(cfg.title)}"></label>
        <label class="field"><span>Description</span><textarea id="af-desc" rows="3">${esc(cfg.description)}</textarea></label>
        <label class="field"><span>Form intro</span><textarea id="af-intro" rows="3">${esc(cfg.formIntro)}</textarea></label>
        <label class="field"><span>Completion DM</span><textarea id="af-complete" rows="2">${esc(cfg.completionMessage)}</textarea></label>
        <label class="field"><span>Accepted DM</span><textarea id="af-accepted" rows="2">${esc(cfg.acceptedMessage)}</textarea></label>
        <label class="field"><span>Rejected DM</span><textarea id="af-rejected" rows="2">${esc(cfg.rejectedMessage)}</textarea></label>
        <div class="field-row"><div><div class="field-label">Workflow options</div><div class="field-desc">Back navigation, applicant cancellation, reviewer notifications and rejection reasons.</div></div><div style="display:flex;gap:14px;flex-wrap:wrap"><label><input id="af-cancel" type="checkbox" ${cfg.allowCancel?'checked':''}> Cancel</label><label><input id="af-back" type="checkbox" ${cfg.allowBack?'checked':''}> Back</label><label><input id="af-mention" type="checkbox" ${cfg.reviewerMention?'checked':''}> Mention reviewers</label><label><input id="af-reason" type="checkbox" ${cfg.requireRejectReason?'checked':''}> Require reject reason</label></div></div>
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-primary btn-sm" id="af-save">Save configuration</button><button class="btn btn-ghost btn-sm" id="af-export">Export</button></div>
        </div>
        <div class="card" style="padding:18px 20px"><h3>Review statistics</h3><div class="stats-grid" style="margin-top:12px">${[['Pending',data.stats.pending],['Accepted',data.stats.accepted],['Rejected',data.stats.rejected],['Withdrawn',data.stats.withdrawn],['Total',data.stats.total],['Accept rate',`${data.stats.acceptanceRate}%`]].map(([a,b])=>`<div class="stat-card"><div class="stat-label">${a}</div><div class="stat-value">${b}</div></div>`).join('')}</div><div class="card" style="margin-top:14px;padding:14px;background:var(--surface-hi)"><strong>Reviewer roles</strong><div class="chip-list" style="margin-top:8px">${cfg.reviewerRoleIds.map(id=>`<span class="chip">@${esc(data.roles.find(r=>r.id===id)?.name||'deleted-role')} <button class="chip-x" data-remove-role="${id}">×</button></span>`).join('') || '<span class="desc">No reviewer roles configured.</span>'}</div><select id="af-role-add" style="margin-top:10px"><option value="">+ Add reviewer role</option>${roleOptions}</select></div></div>
      </div>
      <div class="card" style="padding:18px 20px;margin-top:14px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div><h3>Questions</h3><p class="desc">Drag rows to reorder, or use the arrow controls. Changes are saved immediately when you reorder.</p></div><button class="btn btn-primary btn-sm" id="af-add-q">+ Add question</button></div><div id="af-q-list" style="display:grid;gap:8px;margin-top:12px">${cfg.questions.map((q,i)=>`<div class="field-row" draggable="true" data-qid="${esc(q.id)}" style="padding:12px;cursor:grab"><div style="display:flex;gap:10px;align-items:center;flex:1"><span class="mono" style="width:22px;color:var(--text-faint)">${i+1}</span><div><strong>${q.emoji?esc(q.emoji)+' ':''}${esc(q.prompt)}</strong><div class="desc">${esc(q.type)} · ${q.required?'required':'optional'} · ${q.minLength}-${q.maxLength} chars${q.choices.length?` · ${q.choices.length} choices`:''}</div></div></div><div style="display:flex;gap:5px"><button class="btn btn-ghost btn-sm" data-q-up="${q.id}">↑</button><button class="btn btn-ghost btn-sm" data-q-down="${q.id}">↓</button><button class="btn btn-ghost btn-sm" data-q-edit="${q.id}">Edit</button><button class="btn btn-danger btn-sm" data-q-del="${q.id}">×</button></div></div>`).join('')}</div></div>
      <div class="grid-2" style="margin-top:14px"><div class="card" style="padding:18px 20px"><h3>DM preview</h3><div style="margin-top:12px;background:#11151b;border:1px solid var(--border);border-radius:12px;padding:16px;max-width:520px"><div style="display:flex;gap:10px;align-items:center"><div style="width:34px;height:34px;border-radius:50%;background:var(--surface-hi);display:grid;place-items:center">📩</div><div><strong>${esc(cfg.title)}</strong><div class="mono" style="font-size:10px;color:var(--text-faint)">DISCOMOD • custom appeal</div></div></div><p style="margin:14px 0;color:var(--text-muted);white-space:pre-wrap">${esc(cfg.description)}</p>${cfg.questions.slice(0,4).map((q,i)=>`<div class="card" style="padding:10px;margin-top:8px;background:#161d25"><strong>${i+1}. ${esc(q.prompt)}</strong><div class="mono" style="font-size:10px;margin-top:6px;color:var(--text-faint)">${q.type==='choice'?q.choices.join(' · '):q.placeholder||'Your answer…'}</div></div>`).join('')}</div></div><div class="card" style="padding:18px 20px"><h3>Behavior</h3><div style="display:grid;gap:8px;margin-top:12px">${[['Applicant cancellation',cfg.allowCancel],['Back navigation',cfg.allowBack],['Reviewer mention',cfg.reviewerMention],['Reject reason required',cfg.requireRejectReason],['Decision DMs',cfg.decisionDm],['Auto-close review message',cfg.autoCloseOnDecision]].map(([k,v])=>`<div class="field-row"><span>${k}</span><span class="badge ${v?'badge-on':'badge-off'}">${v?'ON':'OFF'}</span></div>`).join('')}</div></div></div>
      <div id="af-detail"></div>
    `;
    qs('#af-save').onclick=async e=>{e.target.disabled=true;try{const r=await API.post(`/api/guilds/${guildId}/appeal-form`,{enabled:qs('#af-enabled').value==='true',channelId:qs('#af-channel').value||null,timeLimitMinutes:Number(qs('#af-time').value),maxActivePerUser:Number(qs('#af-max').value),title:qs('#af-title').value,description:qs('#af-desc').value,formIntro:qs('#af-intro').value,completionMessage:qs('#af-complete').value,acceptedMessage:qs('#af-accepted').value,rejectedMessage:qs('#af-rejected').value,allowCancel:qs('#af-cancel').checked,allowBack:qs('#af-back').checked,reviewerMention:qs('#af-mention').checked,requireRejectReason:qs('#af-reason').checked,reviewerRoleIds:cfg.reviewerRoleIds});cfg=r.config;data.stats=r.stats;toast('Appeal form saved','ok');draw();}catch(err){toast(err.message,'err');e.target.disabled=false;}};
    qs('#af-export').onclick=()=>window.open(`/api/guilds/${guildId}/appeal-form/export`,'_blank');
    qs('#af-role-add').onchange=async e=>{const id=e.target.value;if(!id)return;cfg.reviewerRoleIds=[...new Set([...cfg.reviewerRoleIds,id])];await API.post(`/api/guilds/${guildId}/appeal-form`,{reviewerRoleIds:cfg.reviewerRoleIds});draw();};
    qsa('[data-remove-role]').forEach(b=>b.onclick=async()=>{cfg.reviewerRoleIds=cfg.reviewerRoleIds.filter(x=>x!==b.dataset.removeRole);await API.post(`/api/guilds/${guildId}/appeal-form`,{reviewerRoleIds:cfg.reviewerRoleIds});draw();});
    qsa('[data-q-up]').forEach(b=>b.onclick=()=>moveQ(b.dataset.qUp,-1));qsa('[data-q-down]').forEach(b=>b.onclick=()=>moveQ(b.dataset.qDown,1));qsa('[data-q-del]').forEach(b=>b.onclick=async()=>{if(cfg.questions.length<=1)return toast('Keep at least one question','err');if(!confirm('Delete this question?'))return;try{const r=await API.del(`/api/guilds/${guildId}/appeal-form/questions/${encodeURIComponent(b.dataset.qDel)}`);cfg.questions=r.questions;draw();}catch(e){toast(e.message,'err')}});qsa('[data-q-edit]').forEach(b=>b.onclick=()=>openEditor(b.dataset.qEdit));
    qs('#af-add-q').onclick=()=>openEditor(null);
    qsa('[data-qid]').forEach(row=>{row.addEventListener('dragstart',()=>{draggingId=row.dataset.qid;row.style.opacity='.45'});row.addEventListener('dragend',()=>{row.style.opacity='';draggingId=null});row.addEventListener('dragover',e=>e.preventDefault());row.addEventListener('drop',async e=>{e.preventDefault();const target=row.dataset.qid;if(!draggingId||draggingId===target)return;const ids=cfg.questions.map(q=>q.id);const from=ids.indexOf(draggingId),to=ids.indexOf(target);ids.splice(from,1);ids.splice(to,0,draggingId);try{const r=await API.post(`/api/guilds/${guildId}/appeal-form/questions/reorder`,{ids});cfg.questions=r.questions;draw();}catch(e){toast(e.message,'err')}});});
  }
  async function moveQ(id,delta){const ids=cfg.questions.map(q=>q.id),i=ids.indexOf(id),j=i+delta;if(i<0||j<0||j>=ids.length)return;[ids[i],ids[j]]=[ids[j],ids[i]];try{const r=await API.post(`/api/guilds/${guildId}/appeal-form/questions/reorder`,{ids});cfg.questions=r.questions;draw();}catch(e){toast(e.message,'err')}}
  function openEditor(id){const q=cfg.questions.find(x=>x.id===id)||{id:`q${cfg.questions.length+1}`,prompt:'',type:'paragraph',required:true,minLength:0,maxLength:2000,choices:[]};const edit=!!id;const detail=qs('#af-detail');detail.innerHTML=`<div class="card" style="padding:18px 20px;margin-top:14px"><div style="display:flex;justify-content:space-between"><h3>${edit?'Edit':'Add'} question</h3><button class="btn btn-ghost btn-sm" id="af-close-editor">Close</button></div><div class="form-grid" style="margin-top:12px"><label class="field"><span>ID</span><input id="qe-id" value="${esc(q.id)}" ${edit?'readonly':''}></label><label class="field"><span>Type</span><select id="qe-type"><option value="short" ${q.type==='short'?'selected':''}>Short</option><option value="paragraph" ${q.type==='paragraph'?'selected':''}>Paragraph</option><option value="choice" ${q.type==='choice'?'selected':''}>Choice</option><option value="yesno" ${q.type==='yesno'?'selected':''}>Yes / No</option></select></label><label class="field"><span>Emoji</span><input id="qe-emoji" value="${esc(q.emoji||'')}"></label><label class="field"><span>Required</span><select id="qe-required"><option value="true" ${q.required?'selected':''}>Required</option><option value="false" ${!q.required?'selected':''}>Optional</option></select></label></div><label class="field"><span>Question</span><textarea id="qe-prompt" rows="3">${esc(q.prompt)}</textarea></label><div class="form-grid"><label class="field"><span>Minimum characters</span><input id="qe-min" type="number" min="0" max="4000" value="${q.minLength||0}"></label><label class="field"><span>Maximum characters</span><input id="qe-max" type="number" min="1" max="4000" value="${q.maxLength||2000}"></label></div><label class="field"><span>Choices (one per line for Choice)</span><textarea id="qe-choices" rows="5">${esc((q.choices||[]).join('\n'))}</textarea></label><div style="margin-top:10px"><button class="btn btn-primary" id="qe-save">Save question</button></div></div>`;qs('#af-close-editor').onclick=()=>detail.innerHTML='';qs('#qe-save').onclick=async()=>{try{const payload={id:qs('#qe-id').value,prompt:qs('#qe-prompt').value,type:qs('#qe-type').value,emoji:qs('#qe-emoji').value,required:qs('#qe-required').value==='true',minLength:Number(qs('#qe-min').value),maxLength:Number(qs('#qe-max').value),choices:qs('#qe-choices').value.split(/\n/).map(x=>x.trim()).filter(Boolean)};const r=edit?await fetch(`/api/guilds/${guildId}/appeal-form/questions/${encodeURIComponent(id)}`,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(API._handle):await API.post(`/api/guilds/${guildId}/appeal-form/questions`,payload);cfg.questions=r.questions;detail.innerHTML='';draw();toast(edit?'Question updated':'Question added','ok');}catch(e){toast(e.message,'err')}};}
  draw();
}

async function renderCarryService(root, guildId, me) {
  root.innerHTML=`<div class="state-block"><div class="spinner"></div><p>Loading Carry Service…</p></div>`;let data;try{data=await API.get(`/api/guilds/${guildId}/carry`);}catch(e){root.innerHTML=errorBlock(e.message);return;}const {content}=renderGuildShell(root,guildId,me,'carry');let cfg=data.config;
  function draw(){const stats=data.stats;content.innerHTML=`<div class="content-head"><div><h1>🎮 Carry Service Control Center</h1><p>Manage private service-request channels, staff queues, service types, completion behavior and panel branding.</p></div><span class="status-pill"><span class="status-dot"></span>${cfg.enabled?'ONLINE':'DISABLED'}</span></div>
  <div class="stats-grid">${[['Open',stats.open],['Claimed',stats.claimed],['Paused',stats.paused],['Completed',stats.completed],['Cancelled',stats.cancelled],['Total',stats.total]].map(([k,v])=>`<div class="stat-card"><div class="stat-label">${k}</div><div class="stat-value">${v}</div></div>`).join('')}</div>
  <div class="grid-2" style="margin-top:14px"><div class="card" style="padding:18px 20px"><h3>Service configuration</h3><label class="field"><span>Enabled</span><select id="cs-enabled"><option value="true" ${cfg.enabled?'selected':''}>Enabled</option><option value="false" ${!cfg.enabled?'selected':''}>Disabled</option></select></label><div class="form-grid"><label class="field"><span>Category</span><select id="cs-category"><option value="">— none —</option>${data.channels.filter(c=>c.type===4).map(c=>`<option value="${c.id}" ${cfg.categoryId===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label class="field"><span>Log channel</span><select id="cs-log"><option value="">— none —</option>${data.channels.filter(c=>c.type===0).map(c=>`<option value="${c.id}" ${cfg.logChannelId===c.id?'selected':''}>#${esc(c.name)}</option>`).join('')}</select></label><label class="field"><span>Panel channel</span><select id="cs-panel"><option value="">— none —</option>${data.channels.filter(c=>c.type===0).map(c=>`<option value="${c.id}" ${cfg.panelChannelId===c.id?'selected':''}>#${esc(c.name)}</option>`).join('')}</select></label><label class="field"><span>Max open requests</span><input id="cs-max" type="number" min="1" max="1000" value="${cfg.maxOpenRequests}"></label></div><label class="field"><span>Panel title</span><input id="cs-title" value="${esc(cfg.panelTitle)}"></label><label class="field"><span>Panel description</span><textarea id="cs-desc" rows="3">${esc(cfg.panelDescription)}</textarea></label><label class="field"><span>Channel naming template</span><input id="cs-name" value="${esc(cfg.channelNameTemplate)}"><span class="field-desc">Variables: {counter} {user} {service}</span></label><div class="field-row"><span>Staff mention</span><input id="cs-mention" type="checkbox" ${cfg.staffMention?'checked':''}></div><div class="field-row"><span>One open request per user</span><input id="cs-one" type="checkbox" ${cfg.oneOpenPerUser?'checked':''}></div><div class="field-row"><span>Auto archive completed requests</span><input id="cs-archive" type="checkbox" ${cfg.autoArchiveOnComplete?'checked':''}></div><div style="margin-top:10px"><button class="btn btn-primary" id="cs-save">Save configuration</button><button class="btn btn-ghost" id="cs-post" style="margin-left:8px">Post Panel</button></div></div>
  <div class="card" style="padding:18px 20px"><h3>Staff roles</h3><p class="desc">Roles allowed to claim, pause and complete carry requests.</p><div class="chip-list" style="margin:10px 0">${cfg.staffRoleIds.map(id=>`<span class="chip">@${esc(data.roles.find(r=>r.id===id)?.name||'deleted-role')} <button class="chip-x" data-rm-role="${id}">×</button></span>`).join('')||'<span class="desc">No roles</span>'}</div><select id="cs-role-add"><option value="">+ Add staff role</option>${data.roles.map(r=>`<option value="${r.id}">@${esc(r.name)}</option>`).join('')}</select><h3 style="margin-top:20px">Available services</h3><div id="cs-services" style="display:grid;gap:8px;margin-top:10px">${cfg.services.map(s=>`<div class="field-row" style="padding:10px"><div style="flex:1"><strong>${esc(s.emoji)} ${esc(s.name)}</strong><div class="desc">${esc(s.id)} · ${esc(s.description)}</div></div><span class="badge ${s.enabled?'badge-on':'badge-off'}">${s.enabled?'ON':'OFF'}</span><button class="btn btn-ghost btn-sm" data-edit-service="${esc(s.id)}">Edit</button><button class="btn btn-danger btn-sm" data-del-service="${esc(s.id)}">×</button></div>`).join('')}</div><button class="btn btn-primary btn-sm" id="cs-add-service" style="margin-top:10px">+ Add service</button></div></div>
  <div class="card" style="padding:18px 20px;margin-top:14px"><div class="content-head" style="margin:0"><div><h3>Request queue</h3><p class="desc">Real persisted requests. Dashboard actions update the same store used by the bot.</p></div></div><div style="display:grid;gap:8px;margin-top:12px">${data.requests.map(r=>`<div class="field-row" style="padding:12px"><div style="flex:1;min-width:0"><strong>${esc(r.serviceName||r.serviceId)}</strong> · ${esc(r.username||r.userId)}<div class="desc">${esc(r.id)} · ${r.channelId?`<a href="https://discord.com/channels/${guildId}/${r.channelId}" target="_blank">open channel</a>`:'no channel'} · ${esc(r.details||'')}</div></div><span class="badge ${r.status==='completed'?'badge-on':r.status==='cancelled'?'badge-danger':'badge-off'}">${esc(r.status)}</span>${['open','claimed','paused'].includes(r.status)?`<button class="btn btn-ghost btn-sm" data-req-action="pause" data-id="${r.id}">Pause</button><button class="btn btn-primary btn-sm" data-req-action="complete" data-id="${r.id}">Complete</button><button class="btn btn-danger btn-sm" data-req-action="cancel" data-id="${r.id}">Cancel</button>`:''}</div>`).join('')||'<div class="state-block"><h3>No requests</h3><p>New requests will appear here.</p></div>'}</div></div>`;
  qs('#cs-save').onclick=async()=>{try{const r=await API.post(`/api/guilds/${guildId}/carry`,{enabled:qs('#cs-enabled').value==='true',categoryId:qs('#cs-category').value||null,logChannelId:qs('#cs-log').value||null,panelChannelId:qs('#cs-panel').value||null,maxOpenRequests:Number(qs('#cs-max').value),panelTitle:qs('#cs-title').value,panelDescription:qs('#cs-desc').value,channelNameTemplate:qs('#cs-name').value,staffMention:qs('#cs-mention').checked,oneOpenPerUser:qs('#cs-one').checked,autoArchiveOnComplete:qs('#cs-archive').checked,staffRoleIds:cfg.staffRoleIds});cfg=r.config;toast('Carry Service saved','ok');data=await API.get(`/api/guilds/${guildId}/carry`);cfg=data.config;draw();}catch(e){toast(e.message,'err')}};
  qs('#cs-post').onclick=async()=>{try{await API.post(`/api/guilds/${guildId}/carry/panel`,{channelId:qs('#cs-panel').value||cfg.panelChannelId});toast('Panel posted','ok')}catch(e){toast(e.message,'err')}};
  qs('#cs-role-add').onchange=async e=>{if(!e.target.value)return;cfg.staffRoleIds=[...new Set([...cfg.staffRoleIds,e.target.value])];await API.post(`/api/guilds/${guildId}/carry`,{staffRoleIds:cfg.staffRoleIds});draw()};qsa('[data-rm-role]').forEach(b=>b.onclick=async()=>{cfg.staffRoleIds=cfg.staffRoleIds.filter(x=>x!==b.dataset.rmRole);await API.post(`/api/guilds/${guildId}/carry`,{staffRoleIds:cfg.staffRoleIds});draw()});
  qsa('[data-req-action]').forEach(b=>b.onclick=async()=>{try{await API.post(`/api/guilds/${guildId}/carry/request/${encodeURIComponent(b.dataset.id)}/${b.dataset.reqAction}`,{});data=await API.get(`/api/guilds/${guildId}/carry`);cfg=data.config;toast('Request updated','ok');draw()}catch(e){toast(e.message,'err')}});
  qs('#cs-add-service').onclick=async()=>{const name=prompt('Service name');if(!name)return;const id=prompt('Service ID (letters/numbers/_/-)')||name.toLowerCase().replace(/[^a-z0-9_-]/g,'');try{const r=await API.post(`/api/guilds/${guildId}/carry/services`,{id,name,description:'Custom service',emoji:'🎮',enabled:true});cfg.services=r.services;draw()}catch(e){toast(e.message,'err')}};
  qsa('[data-del-service]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this service?'))return;try{const r=await API.del(`/api/guilds/${guildId}/carry/services/${encodeURIComponent(b.dataset.delService)}`);cfg.services=r.services;draw()}catch(e){toast(e.message,'err')}});
  qsa('[data-edit-service]').forEach(b=>b.onclick=async()=>{const s=cfg.services.find(x=>x.id===b.dataset.editService);if(!s)return;const name=prompt('Service name',s.name);if(name==null)return;const desc=prompt('Description',s.description);const emoji=prompt('Emoji',s.emoji);try{const r=await fetch(`/api/guilds/${guildId}/carry/services/${encodeURIComponent(s.id)}`,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description:desc,emoji})}).then(API._handle);cfg.services=r.services;draw()}catch(e){toast(e.message,'err')}});
  }
  draw();
}

async function renderDomainAllowlist(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading Domain Allowlist…</p></div>`;
  let data;
  try { data = await API.get(`/api/guilds/${guildId}/domains/allowlist`); }
  catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'domains');
  let query = '';

  function draw() {
    const q = query.trim().toLowerCase();
    const matches = q ? data.domains.filter(d => d.includes(q)) : [];
    content.innerHTML = `
      <div class="content-head">
        <div><h1>🌐 Domain Allowlist</h1><p>Reference for the bot's own built-in trusted-domain list (${data.domains.length.toLocaleString()} entries) — this list is shared by every server and isn't per-guild editable. To add domains your server specifically trusts, look for "Allowed Domains" on the <a href="/dashboard/${guildId}/settings" data-link>Settings</a> page.</p></div>
      </div>

      <div class="card" style="padding:20px;margin-bottom:14px;">
        <h3 style="font-size:14px;margin-bottom:10px;">Search the global list</h3>
        <input type="text" id="domain-search" placeholder="e.g. github, spotify, cdn…" value="${esc(query)}" style="width:100%;max-width:400px;">
        ${q ? `<p style="font-size:12px;color:var(--text-faint);margin-top:10px;">${matches.length} match${matches.length === 1 ? '' : 'es'}${matches.length > 300 ? ' (showing first 300)' : ''}</p>
          <div class="mono" style="font-size:12.5px;max-height:400px;overflow-y:auto;margin-top:6px;line-height:1.9;">
            ${matches.slice(0, 300).map(d => `<span style="display:inline-block;background:var(--surface-hi);border:1px solid var(--border-hi);border-radius:6px;padding:2px 8px;margin:2px;">${esc(d)}</span>`).join('')}
          </div>` : `<p style="font-size:12px;color:var(--text-faint);margin-top:10px;">Start typing to search — the full list is too long to browse usefully unfiltered.</p>`}
      </div>

      <div class="card" style="padding:20px;">
        <h3 style="font-size:14px;margin-bottom:4px;">Your server's custom additions</h3>
        <p style="font-size:12px;color:var(--text-faint);margin-bottom:12px;">${data.guildDomains.length} domain${data.guildDomains.length === 1 ? '' : 's'} added specifically for this server.</p>
        ${data.guildDomains.length ? data.guildDomains.map(d => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:13px;border-bottom:1px solid var(--border-hi);">
            <span class="mono">${esc(d.domain)}</span>
            ${d.redundant ? `<span class="badge badge-off" title="Already covered by the global list above — this entry isn't doing anything extra.">redundant</span>` : ''}
          </div>`).join('') : `<p style="color:var(--text-faint);font-size:13px;">Nothing added yet.</p>`}
      </div>
    `;
    qs('#domain-search').addEventListener('input', debounce((e) => { query = e.target.value; draw(); }, 200));
    qs('#domain-search').focus();
    qs('#domain-search').selectionStart = qs('#domain-search').selectionEnd = query.length;
  }
  draw();
}


// ══════════════════════════════════════════════════════════
//  VIEW: APPLICATIONS — form builder, DM preview, review queue, stats
// ══════════════════════════════════════════════════════════
async function renderApplications(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading Applications…</p></div>`;
  let data;
  try { data = await API.get(`/api/guilds/${guildId}/applications`); }
  catch (e) { root.innerHTML = errorBlock(e.message); return; }
  let pageMeta = { channels: [], roles: [] };
  try { pageMeta = await API.get(`/api/guilds/${guildId}/meta`); } catch {}
  const { content } = renderGuildShell(root, guildId, me, 'applications');
  let cfg = data.config;
  let apps = data.applications || [];
  let stats = data.stats || {};
  let filter = 'all';
  let selectedAppId = null;
  let draftQuestion = null;

  const statusMeta = {
    active: ['ACTIVE','badge-on'], completed: ['COMPLETED','badge-on'], cancelled: ['CANCELLED','badge-off'], snoozed: ['SNOOZED','badge-off']
  };
  const fmtDate = ts => ts ? new Date(ts).toLocaleString() : '—';
  const fmtDuration = ms => { if(!ms||ms<0)return '—'; const m=Math.round(ms/60000); if(m<60)return `${m}m`; const h=Math.floor(m/60), r=m%60; return `${h}h ${r}m`; };
  const fmtRemaining = ts => {
    if (!ts) return '—'; const ms = ts - Date.now(); if (ms <= 0) return 'expired';
    const mins = Math.ceil(ms / 60000); return mins >= 60 ? `${Math.floor(mins/60)}h ${mins%60}m` : `${mins}m`;
  };
  function channelOptions(value, multi=false) {
    const channels = (pageMeta.channels || me.textChannels || me.channels || []).filter(Boolean);
    return channels.length ? channels.map(c => `<option value="${esc(c.id)}" ${(!multi && String(c.id)===String(value||''))?'selected':''}>#${esc(c.name || c.id)}</option>`).join('') : '';
  }
  function roleOptions(selected=[]) {
    const sel = new Set((selected || []).map(String));
    return (pageMeta.roles || me.roles || []).map(r => `<option value="${esc(r.id)}" ${sel.has(String(r.id))?'selected':''}>@${esc(r.name)}</option>`).join('');
  }
  function statCard(label, value, icon) { return `<div class="stat-card"><div style="font-size:18px;margin-bottom:5px;">${icon}</div><div class="stat-num">${Number(value||0).toLocaleString()}</div><div class="stat-label">${label}</div></div>`; }
  function questionCard(q, i) {
    return `<div class="card app-question" draggable="true" data-qid="${esc(q.id)}" style="padding:16px 18px;margin-bottom:10px;cursor:grab;">
      <div style="display:flex;gap:12px;align-items:flex-start;">
        <div class="mono" style="color:var(--text-faint);padding-top:3px;width:24px;">☷</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
            <div><strong>${q.emoji ? esc(q.emoji)+' ' : ''}${i+1}. ${esc(q.prompt)}</strong><div style="margin-top:5px;font-size:11px;color:var(--text-faint);">${esc(q.type)} · ${q.required?'required':'optional'} · ${q.minLength||0}-${q.maxLength} chars${q.placeholder?` · placeholder: ${esc(q.placeholder)}`:''}</div></div>
            <div style="display:flex;gap:5px;">
              <button class="btn btn-ghost btn-sm q-up" data-qid="${esc(q.id)}" type="button">↑</button>
              <button class="btn btn-ghost btn-sm q-down" data-qid="${esc(q.id)}" type="button">↓</button>
              <button class="btn btn-ghost btn-sm q-edit" data-qid="${esc(q.id)}" type="button">Edit</button>
              <button class="btn btn-danger btn-sm q-delete" data-qid="${esc(q.id)}" type="button">Delete</button>
            </div>
          </div>
          ${q.type==='choice' ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:10px;">${q.choices.map(c=>`<span class="badge badge-off">${esc(c)}</span>`).join('')}</div>` : ''}
        </div>
      </div>
    </div>`;
  }
  function dmPreviewHtml() {
    const q = cfg.questions[0];
    return `<div style="max-width:560px;margin:0 auto;background:#0b0f14;border-radius:12px;padding:18px;border:1px solid var(--border);">
      <div style="font-size:11px;color:var(--text-faint);margin-bottom:8px;">Discord DM preview</div>
      <div class="card" style="padding:16px;background:#151a21;">
        <div style="font-weight:700;font-size:17px;color:var(--text);">📋 Application Started</div>
        <p style="margin-top:8px;color:var(--text-muted);white-space:pre-wrap;">${esc(renderPreviewTemplate(cfg.dmIntro))}</p>
        <div style="margin-top:12px;border:1px solid var(--border);padding:13px;border-radius:8px;background:#11161c;">
          <div style="font-weight:600;font-size:14px;">📝 Question ${q ? 1 : 0} of ${cfg.questions.length}</div>
          <p style="margin-top:7px;color:var(--text);">${q ? esc(q.prompt) : 'Add a question to preview it here.'}</p>
          ${q ? `<div style="display:flex;gap:7px;margin-top:12px;flex-wrap:wrap;"><span class="badge badge-off">${esc(q.type)}</span><span class="badge badge-off">${q.required?'required':'optional'}</span></div>
          <div style="margin-top:12px;display:flex;gap:8px;"><button class="btn btn-primary btn-sm" type="button">${q.type==='choice'?'Choose answer':'Answer'}</button><button class="btn btn-ghost btn-sm" type="button">Snooze</button><button class="btn btn-danger btn-sm" type="button">Cancel</button></div>` : ''}
        </div>
      </div>
    </div>`;
  }
  function renderPreviewTemplate(s) { return String(s||'').replaceAll('{server}', 'Selected Server').replaceAll('{user}', '@Applicant').replaceAll('{username}', 'Applicant'); }
  function draw() {
    const filtered = filter==='all' ? apps : apps.filter(a => a.status===filter);
    content.innerHTML = `<div class="content-head"><div><h1>📋 Applications</h1><p>Build the DM application flow, manage questions, review submissions, and monitor application health.</p></div><span class="status-pill"><span class="status-dot"></span>${cfg.enabled?'Enabled':'Disabled'}</span></div>
      <div class="stats-grid" style="margin-bottom:14px;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;">${statCard('Active',stats.active,'🟢')}${statCard('Completed',stats.completed,'✅')}${statCard('Cancelled',stats.cancelled,'🛑')}${statCard('Snoozed',stats.snoozed,'⏸️')}${statCard('Total',stats.total,'📚')}</div>
      <div class="card" style="padding:16px 20px;margin-bottom:14px;"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;"><div><h3>Application analytics</h3><p class="desc">Operational metrics derived from persisted application timestamps. No synthetic data is generated.</p></div><div style="display:flex;gap:7px;"><button class="btn btn-ghost btn-sm" id="app-export-json">Export JSON</button><button class="btn btn-ghost btn-sm" id="app-export-csv">Export CSV</button></div></div><div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-top:12px;"><div class="field-row"><span>Accepted</span><strong>${Number(stats.accepted||0).toLocaleString()}</strong></div><div class="field-row"><span>Rejected</span><strong>${Number(stats.rejected||0).toLocaleString()}</strong></div><div class="field-row"><span>Pending review</span><strong>${Number(stats.pendingReview||0).toLocaleString()}</strong></div><div class="field-row"><span>Acceptance rate</span><strong>${Number(stats.completionRate||0).toFixed(1)}%</strong></div></div><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:9px;font-size:12px;color:var(--text-muted);"><div>Average completion: <strong>${stats.averageCompletionMs?fmtDuration(stats.averageCompletionMs):'—'}</strong></div><div>Average review: <strong>${stats.averageReviewMs?fmtDuration(stats.averageReviewMs):'—'}</strong></div></div></div>
      <div class="card" style="padding:18px 20px;margin-bottom:14px;"><div style="display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap;"><div><h3>Application configuration</h3><p class="desc">Core workflow, reviewer access, time limits, snooze, and DM behavior.</p></div><div style="display:flex;gap:8px;"><a class="btn btn-ghost btn-sm" data-link href="/dashboard/${guildId}/verification">🔐 CAPTCHA settings</a><button class="btn btn-primary btn-sm" id="app-save">Save configuration</button></div></div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px;">
          <label class="field"><span>Applications enabled</span><select id="app-enabled"><option value="true" ${cfg.enabled?'selected':''}>Enabled</option><option value="false" ${!cfg.enabled?'selected':''}>Disabled</option></select></label>
          <label class="field"><span>Application channel</span><select id="app-channel"><option value="">— any channel —</option>${channelOptions(cfg.applyChannelId)}</select></label>
          <label class="field"><span>Review channel</span><select id="app-review-channel"><option value="">— use fallback log/appeals —</option>${channelOptions(cfg.reviewChannelId)}</select></label>
          <label class="field"><span>Reviewer roles</span><select id="app-roles" multiple style="min-height:90px;">${roleOptions(cfg.reviewerRoleIds)}</select></label>
          <label class="field"><span>Time limit (minutes)</span><input id="app-time" type="number" min="1" max="10080" value="${cfg.timeLimitMinutes}"></label>
          <label class="field"><span>Applicant snooze (minutes)</span><input id="app-snooze" type="number" min="1" max="10080" value="${cfg.snoozeMinutes}"></label>
          <label class="field"><span>Review snooze (minutes)</span><input id="app-review-snooze" type="number" min="1" max="10080" value="${cfg.reviewSnoozeMinutes}"></label>
          <label class="field"><span>Max active per user</span><input id="app-max" type="number" min="1" max="10" value="${cfg.maxActivePerUser}"></label>
          <label class="field"><span>Accepted role</span><select id="app-accepted-role"><option value="">— no automatic role —</option>${roleOptions(cfg.acceptedRoleId ? [cfg.acceptedRoleId] : [])}</select></label>
          <label class="field"><span>Rejected role</span><select id="app-rejected-role"><option value="">— no automatic role —</option>${roleOptions(cfg.rejectedRoleId ? [cfg.rejectedRoleId] : [])}</select></label>
          <label class="field"><span>Decision log/notification channel</span><select id="app-decision-channel"><option value="">— no separate channel —</option>${channelOptions(cfg.decisionChannelId)}</select></label>
          <label class="field"><span>Form title</span><input id="app-form-title" maxlength="120" value="${esc(cfg.formTitle||'📋 Server Application')}"></label>
          <label class="field"><span>Application button label</span><input id="app-button-label" maxlength="80" value="${esc(cfg.applicationButtonLabel||'Start Application')}"></label>
          <label class="field" style="grid-column:1/-1;"><span>Form description</span><textarea id="app-form-description" rows="3" maxlength="1500">${esc(cfg.formDescription||'')}</textarea></label>
          <label class="field"><span>Answer button label</span><input id="app-question-label" maxlength="80" value="${esc(cfg.questionButtonLabel||'Answer')}"></label>
          <label class="field"><span>Answer placeholder</span><input id="app-placeholder" maxlength="100" value="${esc(cfg.answerPlaceholder||'Type your answer here…')}"></label>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:12px;">
          ${[['app-cancel','Allow cancellation',cfg.allowCancel],['app-allow-snooze','Allow applicant snooze',cfg.allowSnooze],['app-decision-dm','DM review decisions',cfg.decisionDm],['app-reject-reason','Require reject reason',cfg.requireRejectReason]].map(([id,l,v])=>`<label class="check-card"><input id="${id}" type="checkbox" ${v?'checked':''}><span>${l}</span></label>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px;">
          ${[['app-accept','Allow Accept',cfg.reviewActions.accept],['app-reject','Allow Reject',cfg.reviewActions.reject],['app-review-snooze','Allow Review Snooze',cfg.reviewActions.snooze]].map(([id,l,v])=>`<label class="check-card"><input id="${id}" type="checkbox" ${v?'checked':''}><span>${l}</span></label>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px;">
          ${[['app-review-mention','Mention reviewer roles',cfg.reviewerMention],['app-delete-review','Remove review message after decision',cfg.deleteReviewMessageAfterDecision],['app-review-snooze-enabled','Allow reviewer snooze',cfg.allowReviewerSnooze]].map(([id,l,v])=>`<label class="check-card"><input id="${id}" type="checkbox" ${v?'checked':''}><span>${l}</span></label>`).join('')}
        </div>
        <div class="callout" style="margin-top:12px;"><strong>CAPTCHA protection</strong><p class="desc" style="margin-top:4px;">Applications can use the same server CAPTCHA policy as web verification. Configure the challenge mode and limits in <a href="/dashboard/${guildId}/verification" data-link>Verification → CAPTCHA</a>. Current effective policy: <strong>${esc(data.captcha?.mode || 'off')}</strong>.</p></div>
      </div>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(340px,.9fr);gap:14px;align-items:start;">
        <div class="card" style="padding:18px 20px;"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;"><div><h3>Application form builder</h3><p class="desc">Drag questions to reorder, or use the arrow controls for keyboard-friendly ordering.</p></div><button class="btn btn-primary btn-sm" id="q-add">+ Add question</button></div><div id="q-list" style="margin-top:14px;">${cfg.questions.map(questionCard).join('')}</div></div>
        <div class="card" style="padding:18px 20px;position:sticky;top:78px;"><div style="display:flex;justify-content:space-between;align-items:center;"><div><h3>DM preview</h3><p class="desc">What applicants see in their DMs.</p></div><span class="badge badge-on">LIVE</span></div><div style="margin-top:14px;">${dmPreviewHtml()}</div></div>
      </div>
      <div class="card" style="padding:18px 20px;margin-top:14px;"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;"><div><h3>Application review queue</h3><p class="desc">Inspect submitted applications and apply the configured review actions.</p></div><div style="display:flex;gap:6px;flex-wrap:wrap;">${['all','active','completed','snoozed','cancelled'].map(x=>`<button class="btn ${filter===x?'btn-primary':'btn-ghost'} btn-sm app-filter" data-filter="${x}" type="button">${x[0].toUpperCase()+x.slice(1)}</button>`).join('')}</div></div>
        <div style="margin-top:12px;display:grid;gap:8px;">${filtered.length?filtered.map(a=>`<div class="field-row" data-app="${esc(a.id)}" style="padding:12px;cursor:pointer;align-items:center;"><div style="min-width:0;flex:1;"><strong>${esc(a.username||a.userId)}</strong><div class="mono" style="font-size:10px;color:var(--text-faint);">${esc(a.id)} · ${fmtDate(a.updatedAt)}</div></div><span class="badge ${statusMeta[a.status]?.[1]||'badge-off'}">${statusMeta[a.status]?.[0]||String(a.status).toUpperCase()}</span>${a.expiresAt?`<span class="mono" style="font-size:10px;color:var(--text-faint);">${esc(fmtRemaining(a.expiresAt))}</span>`:''}</div>`).join(''):`<div class="state-block"><h3>No applications</h3><p>There are no applications matching this status filter.</p></div>`}</div>
        ${selectedAppId?`<div id="app-detail" style="margin-top:14px;"></div>`:''}
      </div>`;
    wireConfig(); wireQuestions(); wireQueue(filtered);
    if(selectedAppId) loadAppDetail(selectedAppId);
  }
  function wireConfig(){
    qs('#app-export-json')?.addEventListener('click',()=>window.location.href=`/api/guilds/${guildId}/applications/export?format=json`);
    qs('#app-export-csv')?.addEventListener('click',()=>window.location.href=`/api/guilds/${guildId}/applications/export?format=csv`);
    qs('#app-save').onclick=async e=>{
      e.target.disabled=true;
      const payload={enabled:qs('#app-enabled').value==='true',applyChannelId:qs('#app-channel').value||null,reviewChannelId:qs('#app-review-channel').value||null,
        reviewerRoleIds:Array.from(qs('#app-roles').selectedOptions).map(o=>o.value),timeLimitMinutes:Number(qs('#app-time').value),snoozeMinutes:Number(qs('#app-snooze').value),reviewSnoozeMinutes:Number(qs('#app-review-snooze').value),maxActivePerUser:Number(qs('#app-max').value),
        acceptedRoleId:qs('#app-accepted-role').value||null,rejectedRoleId:qs('#app-rejected-role').value||null,decisionChannelId:qs('#app-decision-channel').value||null,
        reviewerMention:qs('#app-review-mention').checked,deleteReviewMessageAfterDecision:qs('#app-delete-review').checked,allowReviewerSnooze:qs('#app-review-snooze-enabled').checked,
        formTitle:qs('#app-form-title').value,formDescription:qs('#app-form-description').value,applicationButtonLabel:qs('#app-button-label').value,questionButtonLabel:qs('#app-question-label').value,answerPlaceholder:qs('#app-placeholder').value,
        allowCancel:qs('#app-cancel').checked,allowSnooze:qs('#app-allow-snooze').checked,decisionDm:qs('#app-decision-dm').checked,requireRejectReason:qs('#app-reject-reason').checked,
        reviewActions:{accept:qs('#app-accept').checked,reject:qs('#app-reject').checked,snooze:qs('#app-review-snooze').checked}};
      try{const r=await API.post(`/api/guilds/${guildId}/applications/config`,payload);cfg=r.config;toast('Application settings saved','ok');draw();}catch(err){toast(err.message,'err');e.target.disabled=false;}
    };
  }
  async function saveOrder(ids){ try{const r=await API.post(`/api/guilds/${guildId}/applications/questions/reorder`,{ids});cfg.questions=r.questions;draw();toast('Question order saved','ok');}catch(e){toast(e.message,'err');} }
  function wireQuestions(){
    qs('#q-add')?.addEventListener('click',()=>openQuestionEditor());
    let dragId=null;
    qsa('.app-question').forEach(node=>{
      node.addEventListener('dragstart',()=>{dragId=node.dataset.qid;node.style.opacity='.55';});
      node.addEventListener('dragend',()=>{dragId=null;node.style.opacity='';});
      node.addEventListener('dragover',e=>e.preventDefault());
      node.addEventListener('drop',async e=>{e.preventDefault();const target=node.dataset.qid;if(!dragId||dragId===target)return;const ids=cfg.questions.map(q=>q.id);const a=ids.indexOf(dragId),b=ids.indexOf(target);ids.splice(a,1);ids.splice(ids.indexOf(target),0,dragId);await saveOrder(ids);});
    });
    qsa('.q-up').forEach(b=>b.onclick=()=>moveQuestion(b.dataset.qid,-1));
    qsa('.q-down').forEach(b=>b.onclick=()=>moveQuestion(b.dataset.qid,1));
    qsa('.q-edit').forEach(b=>b.onclick=()=>{const q=cfg.questions.find(x=>x.id===b.dataset.qid);openQuestionEditor(q);});
    qsa('.q-delete').forEach(b=>b.onclick=async()=>{if(cfg.questions.length<=1){toast('An application needs at least one question.','err');return;}if(!confirm('Delete this question? Existing submitted applications retain their saved answers.'))return;try{const r=await API.del(`/api/guilds/${guildId}/applications/questions/${encodeURIComponent(b.dataset.qid)}`);cfg.questions=r.questions;draw();toast('Question deleted','ok');}catch(e){toast(e.message,'err');}});
  }
  async function moveQuestion(id,delta){const ids=cfg.questions.map(q=>q.id),i=ids.indexOf(id),j=i+delta;if(i<0||j<0||j>=ids.length)return;[ids[i],ids[j]]=[ids[j],ids[i]];await saveOrder(ids);}
  function openQuestionEditor(q){
    const isEdit=!!q; const x=q||{id:`q${Date.now().toString(36)}`,prompt:'',type:'paragraph',required:true,maxLength:1500,choices:[]};
    const existing=qs('#app-modal');existing?.remove();
    const modal=el(`<div class="modal-backdrop" id="app-modal"><div class="modal" style="max-width:640px;"><div style="display:flex;justify-content:space-between;align-items:center;"><h3>${isEdit?'Edit':'Add'} question</h3><button class="btn btn-ghost btn-sm" id="q-close">×</button></div><div class="form-stack" style="margin-top:12px;">
      <label class="field"><span>Question prompt</span><textarea id="qe-prompt" rows="4" maxlength="1000">${esc(x.prompt)}</textarea></label>
      <label class="field"><span>Type</span><select id="qe-type"><option value="short" ${x.type==='short'?'selected':''}>Short answer</option><option value="paragraph" ${x.type==='paragraph'?'selected':''}>Paragraph</option><option value="choice" ${x.type==='choice'?'selected':''}>Multiple choice</option></select></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <label class="field"><span>Minimum answer length</span><input id="qe-min" type="number" min="0" max="4000" value="${x.minLength||0}"></label>
        <label class="field"><span>Maximum answer length</span><input id="qe-max" type="number" min="1" max="4000" value="${x.maxLength}"></label>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <label class="field"><span>Question emoji</span><input id="qe-emoji" maxlength="8" value="${esc(x.emoji||'')}" placeholder="📝"></label>
        <label class="field"><span>Answer placeholder</span><input id="qe-placeholder" maxlength="100" value="${esc(x.placeholder||'')}"></label>
      </div>
      <label class="check-card"><input id="qe-required" type="checkbox" ${x.required?'checked':''}><span>Required question</span></label>
      <label class="field" id="qe-choices-wrap"><span>Choices (one per line, max 25)</span><textarea id="qe-choices" rows="7">${esc((x.choices||[]).join('\n'))}</textarea></label>
      <div style="display:flex;justify-content:flex-end;gap:8px;"><button class="btn btn-ghost" id="qe-cancel">Cancel</button><button class="btn btn-primary" id="qe-save">${isEdit?'Save changes':'Add question'}</button></div>
    </div></div></div>`);
    document.body.appendChild(modal);
    const type=qs('#qe-type'); const choicesWrap=qs('#qe-choices-wrap'); const sync=()=>choicesWrap.style.display=type.value==='choice'?'block':'none'; type.addEventListener('change',sync);sync();
    const close=()=>modal.remove();qs('#q-close').onclick=close;qs('#qe-cancel').onclick=close;
    qs('#qe-save').onclick=async()=>{const prompt=qs('#qe-prompt').value.trim();if(!prompt){toast('Question prompt is required','err');return;}const payload={id:x.id,prompt,type:type.value,required:qs('#qe-required').checked,minLength:Number(qs('#qe-min').value),maxLength:Number(qs('#qe-max').value),emoji:qs('#qe-emoji').value,placeholder:qs('#qe-placeholder').value,choices:qs('#qe-choices').value.split(/\n/).map(s=>s.trim()).filter(Boolean)};try{const r=isEdit?await fetch(`/api/guilds/${guildId}/applications/questions/${encodeURIComponent(x.id)}`,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(API._handle):await API.post(`/api/guilds/${guildId}/applications/questions`,payload);cfg.questions=r.questions;close();draw();toast(isEdit?'Question updated':'Question added','ok');}catch(e){toast(e.message,'err');}};
  }
  function wireQueue(){qsa('.app-filter').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;draw();});qsa('[data-app]').forEach(n=>n.onclick=()=>{selectedAppId=n.dataset.app;draw();});}
  async function loadAppDetail(id){
    const box=qs('#app-detail');if(!box)return;box.innerHTML='<div class="state-block"><div class="spinner"></div><p>Loading application…</p></div>';
    try{const r=await API.get(`/api/guilds/${guildId}/applications/${encodeURIComponent(id)}`);const a=r.application;box.innerHTML=`<div class="card" style="padding:16px;background:var(--surface-hi);"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;"><div><h3>${esc(a.username||a.userId)}</h3><p class="desc">${esc(a.id)} · created ${esc(fmtDate(a.createdAt))}</p></div><span class="badge ${statusMeta[a.status]?.[1]||'badge-off'}">${esc(String(a.status).toUpperCase())}</span></div><div style="display:grid;gap:10px;margin-top:14px;">${r.questions.map((q,i)=>`<div><strong>${i+1}. ${esc(q.prompt)}</strong><div style="white-space:pre-wrap;margin-top:4px;color:var(--text-muted);">${esc(a.answers?.[q.id]||'—')}</div></div>`).join('')}</div><div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">${cfg.reviewActions.accept?'<button class="btn btn-primary btn-sm" id="app-review-accept">Accept</button>':''}${cfg.reviewActions.reject?'<button class="btn btn-danger btn-sm" id="app-review-reject">Reject</button>':''}${cfg.reviewActions.snooze?'<button class="btn btn-ghost btn-sm" id="app-review-snooze-action">Snooze review</button>':''}</div></div>`;
      qs('#app-review-accept')?.addEventListener('click',()=>review(id,'accept'));qs('#app-review-reject')?.addEventListener('click',()=>review(id,'reject'));qs('#app-review-snooze-action')?.addEventListener('click',()=>review(id,'snooze'));
    }catch(e){box.innerHTML=errorBlock(e.message);}
  }
  async function review(id,action){let reason='';if(action==='reject'){reason=prompt('Rejection reason'+(cfg.requireRejectReason?' (required)':'')+':')||'';if(cfg.requireRejectReason&&!reason)return;}if(!confirm(`Confirm ${action} for this application?`))return;try{const r=await API.post(`/api/guilds/${guildId}/applications/${encodeURIComponent(id)}/review`,{action,reason});const all=await API.get(`/api/guilds/${guildId}/applications`);apps=all.applications;stats=all.stats;cfg=all.config;toast(`Application ${action}d`,'ok');draw();}catch(e){toast(e.message,'err');}}
  draw();
}


// ══════════════════════════════════════════════════════════
//  VIEW: MEMBERS — guild member intelligence / operations center
// ══════════════════════════════════════════════════════════
async function renderMembers(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading member operations center…</p></div>`;
  const { content } = renderGuildShell(root, guildId, me, 'members');
  let query = '', selected = null, pageData = null;
  async function search(q = '') {
    try { pageData = await API.get(`/api/guilds/${guildId}/members?search=${encodeURIComponent(q)}&limit=40`); }
    catch (e) { content.innerHTML = errorBlock(e.message); return; }
    draw();
  }
  function stat(label, value, sub='') { return `<div class="stat-card"><div class="stat-value">${esc(value)}</div><div class="stat-label">${esc(label)}</div>${sub ? `<div class="stat-sub mono">${esc(sub)}</div>` : ''}</div>`; }
  function draw() {
    const rows = pageData?.members || [];
    content.innerHTML = `
      <div class="content-head">
        <div><h1>👥 Member Operations Center</h1><p>Search real members, inspect activity, leveling, economy, moderation state and application activity without leaving the dashboard.</p></div>
        <span class="status-pill"><span class="status-dot"></span>${esc(pageData?.totalCached ?? rows.length)} cached</span>
      </div>
      <div class="card" style="padding:14px 16px;margin-bottom:14px;">
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="mem-search" value="${esc(query)}" placeholder="Search username, nickname or Discord ID…" style="flex:1;">
          <button class="btn btn-primary btn-sm" id="mem-search-btn">Search</button>
          <button class="btn btn-ghost btn-sm" id="mem-clear">Clear</button>
        </div>
        <p class="desc" style="margin-top:8px;">Search uses the members currently cached by the bot; entering a numeric Discord ID performs an exact lookup when available.</p>
      </div>
      <div class="stat-grid" style="margin-bottom:14px;">
        ${stat('Shown members', rows.length)}
        ${stat('Exiled', rows.filter(m=>m.exiled).length)}
        ${stat('With XP', rows.filter(m=>(m.leveling?.totalXp||0)>0).length)}
        ${stat('With violations', rows.filter(m=>(m.moderation?.violations||0)>0).length)}
      </div>
      <div style="display:grid;grid-template-columns:minmax(280px,1fr) minmax(360px,1.4fr);gap:14px;align-items:start;">
        <div class="card" style="padding:0;overflow:hidden;"><div style="padding:14px 16px;border-bottom:1px solid var(--border);"><h3>Members</h3></div>
          <div id="member-list">${rows.length ? rows.map(m=>`
            <button type="button" class="member-row" data-member="${esc(m.id)}" style="display:flex;width:100%;text-align:left;align-items:center;gap:10px;padding:12px 14px;background:${selected===m.id?'var(--surface-hi)':'transparent'};border:0;border-bottom:1px solid var(--border);cursor:pointer;color:inherit;">
              <img src="${esc(m.avatarUrl)}" alt="" style="width:34px;height:34px;border-radius:50%;object-fit:cover;">
              <span style="min-width:0;flex:1;"><strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(m.displayName)}</strong><span class="mono" style="font-size:10px;color:var(--text-faint);">${esc(m.tag)}</span></span>
              <span class="mono" style="font-size:10px;color:${m.exiled?'var(--danger)':'var(--text-faint)'};">${m.exiled?'EXILED':`L${m.leveling?.level??0}`}</span>
            </button>`).join('') : `<div class="state-block"><h3>No members found</h3><p>Try another username, nickname, or ID.</p></div>`}</div>
        </div>
        <div id="member-detail" class="card" style="padding:18px;">${selected ? '<div class="state-block"><div class="spinner"></div><p>Loading member profile…</p></div>' : '<div class="state-block"><h3>Select a member</h3><p>Choose someone from the left to inspect their profile.</p></div>'}</div>
      </div>`;
    qs('#mem-search-btn').onclick=()=>{query=qs('#mem-search').value.trim();search(query);};
    qs('#mem-search').addEventListener('keydown',e=>{if(e.key==='Enter'){query=e.currentTarget.value.trim();search(query);}});
    qs('#mem-clear').onclick=()=>{query='';search('');};
    qsa('.member-row').forEach(btn=>btn.onclick=async()=>{selected=btn.dataset.member;draw();try{const d=await API.get(`/api/guilds/${guildId}/members/${encodeURIComponent(selected)}/profile`);renderMemberDetail(d);}catch(e){qs('#member-detail').innerHTML=errorBlock(e.message);}});
  }
  function renderMemberDetail(d){
    const u=d.user, l=d.leveling, a=d.activity, m=d.moderation, e=d.economy, ap=d.applications;
    qs('#member-detail').innerHTML=`<div style="display:flex;gap:14px;align-items:center;margin-bottom:16px;"><img src="${esc(u.avatarUrl)}" alt="" style="width:72px;height:72px;border-radius:50%;border:1px solid var(--border-hi);"><div style="min-width:0;flex:1;"><h2>${esc(u.displayName)}</h2><div class="mono" style="font-size:11px;color:var(--text-muted);">${esc(u.tag)} · ${esc(u.id)}</div><div style="margin-top:7px;display:flex;gap:6px;flex-wrap:wrap;">${u.bot?'<span class="badge badge-off">BOT</span>':''}${m.exiled?'<span class="badge" style="border-color:var(--danger);color:var(--danger);">EXILED</span>':'<span class="badge badge-on">ACTIVE</span>'}</div></div></div>
      <div class="stat-grid" style="margin-bottom:14px;">${stat('Level',l.level)}${stat('Total XP',l.totalXp.toLocaleString())}${stat('Rank',l.rank ? `#${l.rank}` : '—')}${stat('Messages',(a.messages||0).toLocaleString())}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="card"><h3>Activity</h3><p class="desc">Messages: <strong>${a.messages.toLocaleString()}</strong></p><p class="desc">Reactions given: <strong>${a.reactions.toLocaleString()}</strong></p><p class="desc">Voice time: <strong>${esc(a.voiceTimeFormatted)}</strong></p><p class="desc">Last message: <strong>${a.lastMessageAt ? new Date(a.lastMessageAt).toLocaleString() : 'Never'}</strong></p></div>
        <div class="card"><h3>Economy</h3><p class="desc">Wallet: <strong>💰 ${e.wallet.toLocaleString()}</strong></p><p class="desc">Bank: <strong>💰 ${e.bank.toLocaleString()}</strong></p><p class="desc">Net worth: <strong>💰 ${e.netWorth.toLocaleString()}</strong></p><p class="desc">Games played: <strong>${e.gamesPlayed.toLocaleString()}</strong></p></div>
        <div class="card"><h3>Moderation</h3><p class="desc">Violations: <strong>${m.violations}</strong></p><p class="desc">Recent history: <strong>${m.recentHistory.length}</strong></p><p class="desc">Exile: <strong>${m.exiled ? esc(m.exileLabel) : 'No'}</strong></p><p class="desc">Cases: <strong>${m.caseCount}</strong></p></div>
        <div class="card"><h3>Applications</h3><p class="desc">Active: <strong>${ap.active}</strong></p><p class="desc">Completed: <strong>${ap.completed}</strong></p><p class="desc">Cancelled: <strong>${ap.cancelled}</strong></p><p class="desc">Snoozed: <strong>${ap.snoozed}</strong></p></div>
      </div>
      <div class="card" style="margin-top:12px;"><h3>Roles</h3><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">${d.roles.length?d.roles.map(r=>`<span class="badge badge-off">@${esc(r.name)}</span>`).join(''):'<span class="mono" style="font-size:11px;color:var(--text-faint);">No non-default roles</span>'}</div></div>
      <div class="card" style="margin-top:12px;"><h3>Account & membership</h3><div class="kv-grid"><div><span>Account created</span><strong>${new Date(u.createdAt).toLocaleString()}</strong></div><div><span>Joined server</span><strong>${u.joinedAt?new Date(u.joinedAt).toLocaleString():'Unknown'}</strong></div><div><span>XP into level</span><strong>${l.xpIntoLevel.toLocaleString()}</strong></div><div><span>XP for next level</span><strong>${l.xpForNextLevel.toLocaleString()}</strong></div><div><span>Last activity</span><strong>${a.lastActivityAt?new Date(a.lastActivityAt).toLocaleString():'Never'}</strong></div><div><span>Primary role</span><strong>${esc(d.primaryRole||'@everyone')}</strong></div></div></div>`;
  }
  await search('');
}

// ══════════════════════════════════════════════════════════
//  VIEW: TRANSLATION — command + auto-translate + BYOK
// ══════════════════════════════════════════════════════════
async function renderTranslation(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading Translation…</p></div>`;
  let data; try { data = await API.get(`/api/guilds/${guildId}/translation`); } catch(e) { root.innerHTML=errorBlock(e.message); return; }
  let pageMeta = { channels: [], roles: [] }; try { pageMeta = await API.get(`/api/guilds/${guildId}/meta`); } catch {}
  const { content } = renderGuildShell(root,guildId,me,'translation');
  let cfg=data.config, query='';
  const langOptions=Object.entries(data.languages||{}).map(([k,v])=>`<option value="${esc(k)}">${esc(v)} (${esc(k)})</option>`).join('');
  const providerOptions=(data.providers||[]).map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');
  function modelsFor(provider,selected){return Object.entries(data.models||{}).filter(([,m])=>m.provider===provider).map(([k,m])=>`<option value="${esc(k)}" ${k===selected?'selected':''}>${esc(m.label||k)}</option>`).join('');}
  function draw(){
    content.innerHTML=`<div class="content-head"><div><h1>🌐 Translation</h1><p>Control both <code>/translate</code>/<code>!translate</code> and automatic translation. Settings are per server and use the server's encrypted BYOK AI keys.</p></div><span class="status-pill"><span class="status-dot"></span>${cfg.enabled?'Commands enabled':'Commands disabled'}</span></div>
    <div class="card" style="padding:18px 20px;margin-bottom:14px;"><h3>Command configuration</h3><p class="desc">These settings affect the slash and message command behavior. Administrators can also change them through <code>/autotranslate</code> and <code>!autotranslate</code>.</p><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px;">
      <label class="field"><span>Translation commands</span><select id="tr-enabled"><option value="true" ${cfg.enabled?'selected':''}>Enabled</option><option value="false" ${!cfg.enabled?'selected':''}>Disabled</option></select></label>
      <label class="field"><span>Output prefix</span><input id="tr-prefix" maxlength="30" value="${esc(cfg.systemPrefix||'🌐')}"></label>
      <label class="field"><span>Default source language</span><select id="tr-source">${Object.entries(data.languages||{}).map(([k,v])=>`<option value="${esc(k)}" ${k===cfg.defaultSource?'selected':''}>${esc(v)} (${esc(k)})</option>`).join('')}</select></label>
      <label class="field"><span>Default target language</span><select id="tr-target">${Object.entries(data.languages||{}).filter(([k])=>k!=='auto').map(([k,v])=>`<option value="${esc(k)}" ${k===cfg.defaultTarget?'selected':''}>${esc(v)} (${esc(k)})</option>`).join('')}</select></label>
      <label class="field"><span>Provider</span><select id="tr-provider">${providerOptions}</select></label>
      <label class="field"><span>Model</span><select id="tr-model"></select></label>
      <label class="field"><span>Maximum input characters</span><input id="tr-max" type="number" min="100" max="12000" value="${cfg.maxInputChars}"></label>
      <label class="field"><span>Minimum auto-translate characters</span><input id="tr-minchars" type="number" min="1" max="200" value="${cfg.minAutoTranslateChars||2}"></label>
      <label class="field"><span>Auto-translate cooldown (ms)</span><input id="tr-cooldown" type="number" min="250" max="60000" value="${cfg.autoCooldownMs||1500}"></label>
      <label class="field"><span>Duplicate suppression (ms)</span><input id="tr-dedupe" type="number" min="0" max="120000" value="${cfg.duplicateSuppressionMs||5000}"></label>
      <label class="field"><span>Output template</span><input id="tr-template" maxlength="1500" value="${esc(cfg.messageTemplate)}"></label>
    </div><div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:12px;">${[['tr-auto','Auto-translate enabled',cfg.autoEnabled],['tr-reply','Reply to source',cfg.autoReply],['tr-original','Show original',cfg.showOriginal],['tr-code','Preserve code blocks',cfg.preserveCodeBlocks]].map(([id,l,v])=>`<label class="check-card"><input id="${id}" type="checkbox" ${v?'checked':''}><span>${l}</span></label>`).join('')}</div>
    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:10px;">${[['tr-mentions','Preserve mentions/IDs',cfg.preserveMentions],['tr-urls','Preserve URLs',cfg.preserveUrls],['tr-commands','Ignore commands',cfg.ignoreCommands],['tr-bots','Ignore bots',cfg.ignoreBotMessages]].map(([id,l,v])=>`<label class="check-card"><input id="${id}" type="checkbox" ${v?'checked':''}><span>${l}</span></label>`).join('')}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px;"><button class="btn btn-primary btn-sm" id="tr-save">Save translation settings</button></div></div>
    <div class="card" style="padding:18px 20px;margin-bottom:14px;"><div style="display:flex;justify-content:space-between;align-items:center;"><div><h3>Auto-translate channels</h3><p class="desc">Only messages in these channels are automatically translated.</p></div><span class="badge badge-on">${(cfg.autoChannelIds||[]).length} configured</span></div><div id="tr-channel-list" style="display:flex;flex-wrap:wrap;gap:7px;margin-top:10px;">${(cfg.autoChannelIds||[]).map(id=>`<span class="badge badge-off">${esc(id)} <button type="button" class="link-btn tr-remove-ch" data-id="${esc(id)}" style="padding:0 0 0 5px;">×</button></span>`).join('')||'<span class="mono" style="font-size:11px;color:var(--text-faint);">No channels configured.</span>'}</div><div style="display:flex;gap:8px;margin-top:12px;align-items:center;"><select id="tr-add-channel"><option value="">Add a channel…</option>${(pageMeta.channels||me.textChannels||[]).map(c=>`<option value="${esc(c.id)}">#${esc(c.name)}</option>`).join('')}</select><button class="btn btn-ghost btn-sm" id="tr-add">Add</button></div></div>
    <div class="card" style="padding:18px 20px;margin-bottom:14px;"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;"><div><h3>Encrypted server BYOK</h3><p class="desc">Keys are accepted only by the backend, encrypted at rest, and never returned to the browser. The dashboard only receives the names of providers that are configured.</p></div><span class="badge ${data.configuredProviders?.length?'badge-on':'badge-off'}">${data.configuredProviders?.length||0} configured</span></div><div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-top:12px;"><select id="tr-key-provider">${providerOptions}</select><input id="tr-api-key" type="password" autocomplete="new-password" placeholder="Paste API key — never displayed again"><button class="btn btn-primary btn-sm" id="tr-save-key">Store encrypted key</button></div><div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px;">${(data.configuredProviders||[]).map(p=>`<span class="badge badge-on">${esc(p)} <button class="link-btn tr-remove-key" data-provider="${esc(p)}" type="button" style="padding:0 0 0 5px;">remove</button></span>`).join('')}</div></div>
    <div class="card" style="padding:18px 20px;"><div><h3>Translation test</h3><p class="desc">Test the real configured provider without sending a Discord message.</p></div><textarea id="tr-test-text" rows="5" style="margin-top:12px;width:100%;" maxlength="12000" placeholder="Text to translate…"></textarea><div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;"><select id="tr-test-source">${langOptions}</select><select id="tr-test-target">${langOptions}</select><button class="btn btn-primary btn-sm" id="tr-test">Translate</button></div><pre id="tr-test-output" style="white-space:pre-wrap;margin-top:12px;display:none;"></pre></div>`;
    qs('#tr-provider').value=cfg.provider||'groq';qs('#tr-model').innerHTML=modelsFor(qs('#tr-provider').value,cfg.model);qs('#tr-provider').onchange=()=>{qs('#tr-model').innerHTML=modelsFor(qs('#tr-provider').value,'');};
    qs('#tr-test-source').value=cfg.defaultSource||'auto';qs('#tr-test-target').value=cfg.defaultTarget||'en';
    qs('#tr-save').onclick=async e=>{e.target.disabled=true;const payload={enabled:qs('#tr-enabled').value==='true',systemPrefix:qs('#tr-prefix').value.trim()||'🌐',defaultSource:qs('#tr-source').value,defaultTarget:qs('#tr-target').value,provider:qs('#tr-provider').value,model:qs('#tr-model').value,maxInputChars:Number(qs('#tr-max').value),minAutoTranslateChars:Number(qs('#tr-minchars').value),autoCooldownMs:Number(qs('#tr-cooldown').value),duplicateSuppressionMs:Number(qs('#tr-dedupe').value),messageTemplate:qs('#tr-template').value,autoEnabled:qs('#tr-auto').checked,autoReply:qs('#tr-reply').checked,showOriginal:qs('#tr-original').checked,preserveCodeBlocks:qs('#tr-code').checked,preserveMentions:qs('#tr-mentions').checked,preserveUrls:qs('#tr-urls').checked,ignoreCommands:qs('#tr-commands').checked,ignoreBotMessages:qs('#tr-bots').checked};try{const r=await API.post(`/api/guilds/${guildId}/translation`,payload);cfg=r.config;toast('Translation settings saved','ok');draw();}catch(err){toast(err.message,'err');e.target.disabled=false;}};
    qs('#tr-add').onclick=async()=>{const id=qs('#tr-add-channel').value;if(!id)return;const ids=[...(cfg.autoChannelIds||[])];if(!ids.includes(id))ids.push(id);try{const r=await API.post(`/api/guilds/${guildId}/translation`,{autoChannelIds:ids});cfg=r.config;draw();toast('Channel added','ok');}catch(e){toast(e.message,'err');}};
    qsa('.tr-remove-ch').forEach(b=>b.onclick=async()=>{try{const r=await API.post(`/api/guilds/${guildId}/translation`,{autoChannelIds:(cfg.autoChannelIds||[]).filter(x=>x!==b.dataset.id)});cfg=r.config;draw();}catch(e){toast(e.message,'err');}});
    qs('#tr-save-key').onclick=async e=>{const provider=qs('#tr-key-provider').value,key=qs('#tr-api-key').value.trim();if(!key){toast('Enter an API key','err');return;}e.target.disabled=true;try{const r=await API.post(`/api/guilds/${guildId}/translation/key`,{provider,apiKey:key});data.configuredProviders=r.configuredProviders;qs('#tr-api-key').value='';toast(`${provider} key stored securely`,'ok');draw();}catch(err){toast(err.message,'err');e.target.disabled=false;}};
    qsa('.tr-remove-key').forEach(b=>b.onclick=async()=>{if(!confirm(`Remove the encrypted ${b.dataset.provider} key?`))return;try{const r=await API.del(`/api/guilds/${guildId}/translation/key/${encodeURIComponent(b.dataset.provider)}`);data.configuredProviders=r.configuredProviders;draw();toast('Provider key removed','ok');}catch(e){toast(e.message,'err');}});
    qs('#tr-test').onclick=async e=>{e.target.disabled=true;const out=qs('#tr-test-output');out.style.display='block';out.textContent='Translating…';try{const r=await API.post(`/api/guilds/${guildId}/translation/test`,{text:qs('#tr-test-text').value,source:qs('#tr-test-source').value,target:qs('#tr-test-target').value});out.textContent=r.formatted||r.result?.translation||'No result';}catch(err){out.textContent=`Error: ${err.message}`;}finally{e.target.disabled=false;}};
  }
  draw();
}

// ══════════════════════════════════════════════════════════
//  VIEW: AI SUPPORT — server-admin BYOK control center
// ══════════════════════════════════════════════════════════
async function renderAiSupport(root,guildId,me){
  root.innerHTML=`<div class="state-block"><div class="spinner"></div><p>Loading AI Support…</p></div>`;
  let data;try{data=await API.get(`/api/guilds/${guildId}/ai-support`);}catch(e){root.innerHTML=errorBlock(e.message);return;}
  const {content}=renderGuildShell(root,guildId,me,'ai-support');
  let cfg=data.config;
  const providerOptions=(data.providers||[]).map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');
  function modelsFor(provider,selected){return Object.entries(data.models||{}).filter(([,m])=>m.provider===provider).map(([k,m])=>`<option value="${esc(k)}" ${k===selected?'selected':''}>${esc(m.label||k)}</option>`).join('');}
  const chat=[];
  function draw(){content.innerHTML=`<div class="content-head"><div><h1>🤖 AI Support</h1><p>Private dashboard support assistant using a server-owned encrypted BYOK key. This assistant can explain and diagnose; it does not silently mutate configuration.</p></div><span class="status-pill"><span class="status-dot"></span>${cfg.enabled?'Enabled':'Disabled'}</span></div>
    <div class="card" style="padding:18px 20px;margin-bottom:14px;"><h3>BYOK configuration</h3><p class="desc">No provider secret is ever returned to the frontend. Only configured provider names are shown.</p><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px;">
      <label class="field"><span>Enable AI Support</span><select id="as-enabled"><option value="true" ${cfg.enabled?'selected':''}>Enabled</option><option value="false" ${!cfg.enabled?'selected':''}>Disabled</option></select></label>
      <label class="field"><span>Provider</span><select id="as-provider">${providerOptions}</select></label>
      <label class="field"><span>Model</span><select id="as-model"></select></label>
      <label class="field"><span>History messages</span><input id="as-history" type="number" min="2" max="40" value="${cfg.maxHistory}"></label>
      <label class="field" style="grid-column:1/-1;"><span>System prompt</span><textarea id="as-prompt" rows="6" maxlength="6000">${esc(cfg.systemPrompt)}</textarea></label>
    </div><div style="display:flex;justify-content:flex-end;margin-top:12px;"><button class="btn btn-primary btn-sm" id="as-save">Save support settings</button></div></div>
    <div class="card" style="padding:18px 20px;margin-bottom:14px;"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;"><div><h3>Encrypted BYOK keys</h3><p class="desc">Store a server-owned provider key. The server encrypts it and the UI never reads it back.</p></div><span class="badge ${data.configuredProviders?.length?'badge-on':'badge-off'}">${data.configuredProviders?.length||0} configured</span></div><div style="display:grid;grid-template-columns:1fr 2fr auto auto;gap:8px;margin-top:12px;"><select id="as-key-provider">${providerOptions}</select><input id="as-key" type="password" autocomplete="new-password" placeholder="API key"><button class="btn btn-primary btn-sm" id="as-store-key">Store key</button><button class="btn btn-ghost btn-sm" id="as-test-key">Test active key</button></div><div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px;">${(data.configuredProviders||[]).map(p=>`<span class="badge badge-on">${esc(p)} <button type="button" class="link-btn as-remove-key" data-provider="${esc(p)}" style="padding-left:5px;">remove</button></span>`).join('')}</div></div>
    <div class="card" style="padding:18px 20px;"><div><h3>Support chat</h3><p class="desc">Ask questions about the selected server. Responses are generated using the configured provider and model.</p></div><div id="as-chat" style="height:320px;overflow:auto;margin-top:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;"><div class="mono" style="font-size:11px;color:var(--text-faint);">No messages yet.</div></div><div style="display:flex;gap:8px;margin-top:10px;"><textarea id="as-input" rows="2" style="flex:1;resize:vertical;" maxlength="8000" placeholder="Ask about your server configuration…"></textarea><button class="btn btn-primary" id="as-send">Send</button></div></div>`;
    qs('#as-provider').value=cfg.provider;qs('#as-model').innerHTML=modelsFor(cfg.provider,cfg.model);qs('#as-provider').onchange=()=>qs('#as-model').innerHTML=modelsFor(qs('#as-provider').value,'');
    qs('#as-save').onclick=async e=>{e.target.disabled=true;try{const r=await API.post(`/api/guilds/${guildId}/ai-support`,{enabled:qs('#as-enabled').value==='true',provider:qs('#as-provider').value,model:qs('#as-model').value,maxHistory:Number(qs('#as-history').value),systemPrompt:qs('#as-prompt').value});cfg=r.config;toast('AI Support settings saved','ok');draw();}catch(err){toast(err.message,'err');e.target.disabled=false;}};
    qs('#as-store-key').onclick=async e=>{const provider=qs('#as-key-provider').value,key=qs('#as-key').value.trim();if(!key){toast('Enter an API key','err');return;}e.target.disabled=true;try{const r=await API.post(`/api/guilds/${guildId}/ai-support/key`,{provider,apiKey:key});data.configuredProviders=r.configuredProviders;qs('#as-key').value='';toast(`${provider} key stored securely`,'ok');draw();}catch(err){toast(err.message,'err');e.target.disabled=false;}};
    qs('#as-test-key').onclick=async e=>{e.target.disabled=true;try{const provider=qs('#as-key-provider').value;const model=qs('#as-model').value;const r=await API.post(`/api/guilds/${guildId}/ai-support/test-key`,{provider,model});toast(`Provider connection OK (${r.latencyMs}ms)`,'ok');}catch(err){toast(err.message,'err');}finally{e.target.disabled=false;}};
    qsa('.as-remove-key').forEach(b=>b.onclick=async()=>{if(!confirm(`Remove the encrypted ${b.dataset.provider} key?`))return;try{const r=await API.del(`/api/guilds/${guildId}/ai-support/key/${encodeURIComponent(b.dataset.provider)}`);data.configuredProviders=r.configuredProviders;toast('Provider key removed','ok');draw();}catch(e){toast(e.message,'err');}});
    const chatBox=qs('#as-chat');
    for(const m of chat){const row=el(`<div style="margin-bottom:10px;"><div class="mono" style="font-size:10px;color:var(--text-faint);margin-bottom:4px;">${m.role==='user'?'YOU':'AI SUPPORT'}</div><div style="white-space:pre-wrap;line-height:1.55;">${esc(m.content)}</div></div>`);chatBox.appendChild(row);}
    const send=async()=>{const msg=qs('#as-input').value.trim();if(!msg)return;chat.push({role:'user',content:msg});qs('#as-input').value='';draw();const btn=qs('#as-send');btn.disabled=true;try{const r=await API.post(`/api/guilds/${guildId}/ai-support/chat`,{message:msg,history:chat.slice(-cfg.maxHistory*2)});chat.push({role:'assistant',content:r.content});}catch(e){chat.push({role:'assistant',content:`Error: ${e.message}`});}draw();setTimeout(()=>qs('#as-chat')?.scrollTo(0,999999),0);};qs('#as-send').onclick=send;qs('#as-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
  }
  draw();
}

async function renderVerificationSettings(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading Verification…</p></div>`;
  let data;
  try { data = await API.get(`/api/guilds/${guildId}/verify/captcha`); }
  catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'verification');

  function draw() {
    const c = data.config;
    content.innerHTML = `
      <div class="content-head">
        <div><h1>🔐 Verification</h1><p>Controls the CAPTCHA shown on the web verification link (<code>/verify</code>). The role/message/background customization for that page is still set via <code>/verify customize</code> in Discord — not duplicated here.</p></div>
      </div>

      <div class="card" style="padding:20px;margin-bottom:14px;">
        <h3 style="font-size:14px;margin-bottom:4px;">CAPTCHA</h3>
        <p style="font-size:11.5px;color:var(--text-faint);margin-bottom:14px;">Two independent options, not a ranked pair — pick whichever fits. Neither is claimed to be unbeatable; both are one layer of deterrence, same as any CAPTCHA.</p>
        <div class="field-row">
          <div><strong style="font-size:13px;">Mode</strong></div>
          <select id="cap-mode">
            <option value="off" ${c.mode === 'off' ? 'selected' : ''}>Off</option>
            <option value="interactive" ${c.mode === 'interactive' ? 'selected' : ''}>Interactive challenge (self-hosted, no setup needed)</option>
            <option value="turnstile" ${c.mode === 'turnstile' ? 'selected' : ''}>Cloudflare Turnstile${data.turnstileConfigured ? '' : ' (not configured on this bot instance)'}</option>
            <option value="both" ${c.mode === 'both' ? 'selected' : ''}>Both (Turnstile + interactive)</option>
          </select>
        </div>
        ${!data.turnstileConfigured ? `<p style="font-size:11px;color:var(--text-faint);margin-top:4px;">Turnstile needs <code>TURNSTILE_SITE_KEY</code>/<code>TURNSTILE_SECRET_KEY</code> set on the bot itself (a Cloudflare account, free). Without those, "Turnstile" and "Both" quietly fall back to interactive-only rather than showing no challenge at all.</p>` : ''}
        <div class="field-row">
          <div><strong style="font-size:13px;">Challenges required</strong><div style="font-size:11.5px;color:var(--text-faint);">Interactive mode only.</div></div>
          <input type="number" id="cap-count" value="${c.challengeCount}" min="1" max="5" style="width:80px;">
        </div>
        <div class="field-row">
          <div><strong style="font-size:13px;">Time limit per challenge</strong></div>
          <input type="number" id="cap-time" value="${c.timeLimitSec}" min="15" max="180" style="width:80px;"> <span style="font-size:11.5px;color:var(--text-faint);">seconds</span>
        </div>
        <div class="field-row">
          <div><strong style="font-size:13px;">Max wrong attempts before cooldown</strong></div>
          <input type="number" id="cap-attempts" value="${c.maxAttempts}" min="3" max="15" style="width:80px;">
        </div>
        <div class="field-row">
          <div><strong style="font-size:13px;">Cooldown length</strong></div>
          <input type="number" id="cap-cooldown" value="${c.cooldownSec}" min="15" max="1800" style="width:80px;"> <span style="font-size:11.5px;color:var(--text-faint);">seconds</span>
        </div>
        <button class="btn btn-primary btn-sm" id="cap-save" style="margin-top:10px;">Save</button>
      </div>
    `;
    qs('#cap-save').addEventListener('click', async (e) => {
      const payload = {
        mode: qs('#cap-mode').value,
        challengeCount: Number(qs('#cap-count').value),
        timeLimitSec: Number(qs('#cap-time').value),
        maxAttempts: Number(qs('#cap-attempts').value),
        cooldownSec: Number(qs('#cap-cooldown').value),
      };
      e.target.disabled = true;
      try { const r = await API.post(`/api/guilds/${guildId}/verify/captcha`, payload); data = r; toast('Saved', 'ok'); draw(); }
      catch (err) { toast(err.message || 'Save failed', 'err'); e.target.disabled = false; }
    });
  }
  draw();
}



// Only the variables each card type actually receives in DISCOMOD.js's
// renderCard() calls — showing an unsupported token would just render as
// literal "{text}" on the real card, so this list is deliberately exact,
// not a superset "just in case".
const CARD_VARIABLES = {
  rank: ['username', 'displayName', 'level', 'rank', 'xp', 'xpNeeded', 'progressPct'],
  levelup: ['displayName', 'prevLevel', 'level'],
  welcome: ['displayName', 'server', 'count'],
  leave: ['displayName', 'server', 'count'],
  stock: ['lastUpdated', 'staleWarning', 'server', 'previousStock'],
};
const CARD_TYPE_LABELS = { rank: 'Rank Card', levelup: 'Level-Up Card', welcome: 'Welcome Card', leave: 'Leave Card', stock: 'Stock Card' };

// ══════════════════════════════════════════════════════════
//  VIEW: CARD DESIGNER — edits the exact JSON layer schema
//  card_renderer.js draws from. The preview is a real server-side render
//  (POST .../preview → PNG), never a second/fake renderer, so what you see
//  here is pixel-identical to what ships to Discord.
// ══════════════════════════════════════════════════════════
let cardEditorState = null; // { guildId, type, schema, savedSchema, selectedLayerId }

async function renderCardDesigner(root, guildId, me, initialType = 'rank') {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading Card Designer…</p></div>`;
  let res;
  try { res = await API.get(`/api/guilds/${guildId}/cards/${initialType}`); }
  catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'cards');
  cardEditorState = { guildId, type: initialType, schema: structuredClone(res.schema), savedSchema: structuredClone(res.schema), selectedLayerId: res.schema.layers.find(l => l.type !== 'background')?.id || null };

  content.innerHTML = `
    <div class="content-head"><div><h1>🎨 Card Designer</h1><p>Edit the layout used for rank, level-up, welcome, and stock cards — changes here change what the bot actually posts.</p></div></div>
    <div class="cd-tabs">
      ${Object.entries(CARD_TYPE_LABELS).map(([k, label]) => `<button class="cd-tab ${k === initialType ? 'is-active' : ''}" data-cd-tab="${k}">${label}</button>`).join('')}
    </div>
    <div id="cd-root"></div>
  `;
  qsa('[data-cd-tab]').forEach(btn => btn.addEventListener('click', () => {
    if (isCardEditorDirty() && !confirm('Discard unsaved changes to this card?')) return;
    renderCardDesigner(root, guildId, me, btn.dataset.cdTab);
  }));
  drawCardEditor(qs('#cd-root'));
  requestCardPreview();
}

function isCardEditorDirty() {
  return JSON.stringify(cardEditorState.schema) !== JSON.stringify(cardEditorState.savedSchema);
}

function drawCardEditor(mount) {
  const st = cardEditorState;
  const selected = st.schema.layers.find(l => l.id === st.selectedLayerId) || null;

  mount.innerHTML = `
    <div class="cd-layout">
      <div class="cd-panel cd-layers">
        <div class="cd-panel-head">Layers</div>
        <div class="cd-layer-list">
          ${st.schema.layers.map((l, i) => `
            <div class="cd-layer-row ${l.id === st.selectedLayerId ? 'is-active' : ''} ${l.hidden ? 'is-hidden-layer' : ''}" data-select-layer="${esc(l.id)}">
              <button class="cd-layer-vis" data-toggle-vis="${esc(l.id)}" title="Show/hide">${l.hidden ? '👁️‍🗨️' : '👁️'}</button>
              <span class="cd-layer-name">${esc(l.name || l.type)}</span>
              <span class="cd-layer-type">${esc(l.type)}</span>
              <div class="cd-layer-actions">
                <button data-move-layer="${esc(l.id)}" data-dir="up" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
                <button data-move-layer="${esc(l.id)}" data-dir="down" ${i === st.schema.layers.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
                ${l.type !== 'background' ? `<button data-delete-layer="${esc(l.id)}" title="Delete">✕</button>` : ''}
              </div>
            </div>`).join('')}
        </div>
        <div class="cd-add-layer">
          <select id="cd-add-select"><option value="">+ Add layer…</option><option value="shape">Shape</option><option value="text">Text</option></select>
        </div>
      </div>

      <div class="cd-panel cd-canvas-panel">
        <div class="cd-panel-head">Preview <span class="mono" style="font-size:10.5px;color:var(--text-faint);font-weight:400;">— rendered by the bot's real card renderer</span></div>
        <div class="cd-canvas-wrap" id="cd-canvas-wrap">
          <img id="cd-preview-img" alt="Card preview">
          <div class="cd-canvas-overlay" id="cd-canvas-overlay"></div>
          <div class="cd-canvas-loading hidden" id="cd-canvas-loading"><div class="spinner"></div></div>
        </div>
      </div>

      <div class="cd-panel cd-inspector">
        <div class="cd-panel-head">Properties</div>
        <div id="cd-inspector-body">${selected ? inspectorHtml(selected, st.type) : '<p class="cd-empty">Select a layer to edit its properties.</p>'}</div>
      </div>
    </div>
  `;
  ensureCardSaveBar();
  drawCanvasOverlay();
  wireCardEditor(mount);
}

function inspectorHtml(layer, cardType) {
  const row = (label, control) => `<div class="cd-prop-row"><label>${esc(label)}</label>${control}</div>`;
  const num = (key, val, opts = '') => `<input type="number" data-prop="${key}" value="${val ?? 0}" ${opts}>`;
  const color = (key, val) => `<input type="color" data-prop="${key}" value="${esc(colorIntToHex(val && val !== 'transparent' ? val : '#000000'))}"> <label style="font-weight:400;font-size:11px;"><input type="checkbox" data-prop-transparent="${key}" ${val === 'transparent' ? 'checked' : ''}> transparent</label>`;
  const text = (key, val) => `<input type="text" data-prop="${key}" value="${esc(val ?? '')}">`;
  const select = (key, val, options) => `<select data-prop="${key}">${options.map(o => `<option value="${o}" ${o === (val ?? '') ? 'selected' : ''}>${o || '(none)'}</option>`).join('')}</select>`;
  const check = (key, val) => `<input type="checkbox" data-prop-bool="${key}" ${val ? 'checked' : ''}>`;

  let fields = '';
  switch (layer.type) {
    case 'background':
      fields = row('Color', color('color', layer.color)) + row('Image URL', text('imageUrl', layer.imageUrl)) + row('Opacity', num('opacity', layer.opacity ?? 1, 'step="0.05" min="0" max="1"'));
      break;
    case 'shape':
      fields = row('Shape', select('shape', layer.shape, ['rect', 'circle'])) + row('X', num('x', layer.x)) + row('Y', num('y', layer.y)) + row('Width', num('w', layer.w)) + row('Height', num('h', layer.h))
        + row('Color', color('color', layer.color)) + row('Corner radius', num('radius', Array.isArray(layer.radius) ? layer.radius[0] : layer.radius))
        + row('Border width', num('borderWidth', layer.borderWidth || 0)) + row('Border color', color('borderColor', layer.borderColor || '#000000'));
      break;
    case 'avatar':
      fields = row('X', num('x', layer.x)) + row('Y', num('y', layer.y)) + row('Size', num('size', layer.size))
        + row('Shape', select('shape', layer.shape, ['circle', 'square'])) + row('Border width', num('borderWidth', layer.borderWidth || 0)) + row('Border color', color('borderColor', layer.borderColor || '#000000'));
      break;
    case 'text':
      fields = row('Text', `<textarea data-prop="text" rows="2">${esc(layer.text ?? '')}</textarea>`)
        + `<div class="cd-var-picker">${(CARD_VARIABLES[cardType] || []).map(v => `<button type="button" class="cd-var-chip" data-insert-var="${v}">{${v}}</button>`).join('')}</div>`
        + row('X', num('x', layer.x)) + row('Y', num('y', layer.y)) + row('Box width', num('w', layer.w || ''))
        + row('Font', select('font', layer.font, ['regular', 'medium', 'bold'])) + row('Size', num('size', layer.size))
        + row('Color', color('color', layer.color)) + row('Align', select('align', layer.align, ['left', 'center', 'right']))
        + row('Vertical align', select('valign', layer.valign || '', ['', 'middle'])) + row('Max width (truncate)', num('maxWidth', layer.maxWidth || ''))
        + row('Truncate', check('truncate', layer.truncate)) + row('Letter spacing', num('letterSpacing', layer.letterSpacing || 0));
      break;
    case 'progress':
      fields = row('X', num('x', layer.x)) + row('Y', num('y', layer.y)) + row('Width', num('w', layer.w)) + row('Height', num('h', layer.h)) + row('Corner radius', num('radius', layer.radius ?? ''))
        + row('Track color', color('trackColor', layer.trackColor)) + row('Fill color', color('fillColor', layer.fillColor)) + row('Fill gradient to', color('fillGradientTo', layer.fillGradientTo || layer.fillColor));
      break;
    case 'activityStats': {
      const active = new Set((layer.stats || []).map(s => s.key));
      const STAT_META = { messages: { icon: 'message', label: 'Messages sent' }, voiceTime: { icon: 'mic', label: 'Voice time' }, reactions: { icon: 'reaction', label: 'Reactions given' } };
      fields = row('X', num('x', layer.x)) + row('Y', num('y', layer.y)) + row('Width', num('w', layer.w)) + row('Height', num('h', layer.h)) + row('Corner radius', num('radius', layer.radius ?? ''))
        + row('Pill color', color('color', layer.color)) + row('Text color', color('textColor', layer.textColor)) + row('Icon color', color('iconColor', layer.iconColor)) + row('Text size', num('size', layer.size))
        + `<div class="cd-prop-row"><label>Stats shown</label><div>${Object.entries(STAT_META).map(([key, m]) => `<label style="display:flex;gap:6px;align-items:center;font-size:12px;font-weight:400;margin-bottom:4px;"><input type="checkbox" data-stat-toggle="${key}" data-stat-icon="${m.icon}" ${active.has(key) ? 'checked' : ''}> ${esc(m.label)}</label>`).join('')}</div></div>`;
      break;
    }
    case 'fruitList':
      fields = row('Data source', select('dataKey', layer.dataKey || 'fruits', ['fruits', 'previousStock']))
        + row('X', num('x', layer.x)) + row('Y', num('y', layer.y)) + row('Width', num('w', layer.w)) + row('Height', num('h', layer.h))
        + row('Text size', num('size', layer.size)) + row('Text color', color('color', layer.color))
        + row('Chip color', color('chipColor', layer.chipColor)) + row('Chip corner radius', num('chipRadius', layer.chipRadius ?? ''))
        + `<p class="cd-empty" style="margin-top:6px;">Renders live stock arrays. Current Stock uses <code>fruits</code>; Previous Stock uses <code>previousStock</code>.</p>`;
      break;
    default:
      fields = '<p class="cd-empty">This layer type has no editable properties.</p>';
  }
  return `
    <div class="cd-prop-row"><label>Name</label><input type="text" data-prop="name" value="${esc(layer.name || '')}"></div>
    ${fields}
  `;
}

function wireCardEditor(mount) {
  const st = cardEditorState;
  qsa('[data-select-layer]', mount).forEach(row => row.addEventListener('click', (e) => {
    if (e.target.closest('[data-toggle-vis], [data-move-layer], [data-delete-layer]')) return;
    st.selectedLayerId = row.dataset.selectLayer;
    drawCardEditor(mount);
  }));
  qsa('[data-toggle-vis]', mount).forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const l = st.schema.layers.find(x => x.id === btn.dataset.toggleVis);
    l.hidden = !l.hidden;
    drawCardEditor(mount); requestCardPreview(); markCardDirty();
  }));
  qsa('[data-move-layer]', mount).forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const i = st.schema.layers.findIndex(x => x.id === btn.dataset.moveLayer);
    const j = btn.dataset.dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= st.schema.layers.length) return;
    [st.schema.layers[i], st.schema.layers[j]] = [st.schema.layers[j], st.schema.layers[i]];
    drawCardEditor(mount); requestCardPreview(); markCardDirty();
  }));
  qsa('[data-delete-layer]', mount).forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm('Delete this layer?')) return;
    st.schema.layers = st.schema.layers.filter(x => x.id !== btn.dataset.deleteLayer);
    if (st.selectedLayerId === btn.dataset.deleteLayer) st.selectedLayerId = null;
    drawCardEditor(mount); requestCardPreview(); markCardDirty();
  }));
  qs('#cd-add-select', mount).addEventListener('change', (e) => {
    const type = e.target.value; if (!type) return;
    const base = { id: genLayerId(), name: `New ${type}`, x: 40, y: 40 };
    const layer = type === 'shape'
      ? { ...base, type: 'shape', shape: 'rect', w: 120, h: 40, color: '#5865F2', radius: 8 }
      : { ...base, type: 'text', text: 'New text', font: 'regular', size: 18, color: '#FFFFFF', align: 'left' };
    st.schema.layers.push(layer);
    st.selectedLayerId = layer.id;
    drawCardEditor(mount); requestCardPreview(); markCardDirty();
  });

  // ── Property inspector wiring ──
  const selected = st.schema.layers.find(l => l.id === st.selectedLayerId);
  if (!selected) return;
  qsa('[data-prop]', mount).forEach(inp => inp.addEventListener('input', debounce(() => {
    const key = inp.dataset.prop;
    let val = inp.type === 'number' ? (inp.value === '' ? undefined : Number(inp.value)) : inp.value;
    if (inp.type === 'color') { selected[key] = val; }
    else if (key === 'radius' && Array.isArray(selected.radius)) { selected.radius = val; } // collapses [tl,tr,br,bl] to uniform on first edit — a deliberate simplification, not a bug
    else selected[key] = val;
    requestCardPreview(); markCardDirty();
  }, 250)));
  qsa('[data-prop-bool]', mount).forEach(inp => inp.addEventListener('change', () => {
    selected[inp.dataset.propBool] = inp.checked;
    requestCardPreview(); markCardDirty();
  }));
  qsa('[data-prop-transparent]', mount).forEach(inp => inp.addEventListener('change', () => {
    const key = inp.dataset.propTransparent;
    selected[key] = inp.checked ? 'transparent' : qs(`[data-prop="${key}"]`, mount).value;
    requestCardPreview(); markCardDirty();
  }));
  qsa('[data-insert-var]', mount).forEach(btn => btn.addEventListener('click', () => {
    const ta = qs('[data-prop="text"]', mount);
    ta.value = ta.value + `{${btn.dataset.insertVar}}`;
    selected.text = ta.value;
    requestCardPreview(); markCardDirty();
  }));
  qsa('[data-stat-toggle]', mount).forEach(cb => cb.addEventListener('change', () => {
    selected.stats = selected.stats || [];
    if (cb.checked) selected.stats.push({ icon: cb.dataset.statIcon, key: cb.dataset.statToggle });
    else selected.stats = selected.stats.filter(s => s.key !== cb.dataset.statToggle);
    requestCardPreview(); markCardDirty();
  }));
}

// ── Canvas overlay: percentage-positioned drag handles over the real
// server-rendered PNG. Percentages (not px) so this stays correct at any
// display size without tracking a scale factor by hand. ──
function drawCanvasOverlay() {
  const st = cardEditorState;
  const overlay = qs('#cd-canvas-overlay');
  if (!overlay) return;
  const { width: W, height: H } = st.schema;
  overlay.innerHTML = st.schema.layers.filter(l => l.type !== 'background' && !l.hidden).map(l => {
    const hasBox = l.w != null && l.h != null;
    const x = l.x ?? 0, y = l.y ?? 0, w = hasBox ? l.w : 24, h = hasBox ? l.h : 24;
    return `<div class="cd-handle ${l.id === st.selectedLayerId ? 'is-selected' : ''}" data-handle="${esc(l.id)}"
      style="left:${(x / W * 100).toFixed(2)}%; top:${(y / H * 100).toFixed(2)}%; width:${(w / W * 100).toFixed(2)}%; height:${(h / H * 100).toFixed(2)}%;"></div>`;
  }).join('');
  qsa('[data-handle]', overlay).forEach(handle => {
    handle.addEventListener('mousedown', (e) => startDrag(e, handle.dataset.handle));
    handle.addEventListener('click', (e) => { e.stopPropagation(); cardEditorState.selectedLayerId = handle.dataset.handle; drawCardEditor(qs('#cd-root')); });
  });
}
function startDrag(e, layerId) {
  e.preventDefault();
  const st = cardEditorState;
  st.selectedLayerId = layerId;
  const layer = st.schema.layers.find(l => l.id === layerId);
  const wrap = qs('#cd-canvas-wrap');
  const rect = wrap.getBoundingClientRect();
  const startX = e.clientX, startY = e.clientY;
  const origX = layer.x ?? 0, origY = layer.y ?? 0;
  let moved = false;
  function onMove(ev) {
    moved = true;
    const dxPx = ev.clientX - startX, dyPx = ev.clientY - startY;
    layer.x = Math.round(origX + (dxPx / rect.width) * st.schema.width);
    layer.y = Math.round(origY + (dyPx / rect.height) * st.schema.height);
    drawCanvasOverlay(); // cheap, local — no server round-trip mid-drag
    const xInput = qs('[data-prop="x"]'), yInput = qs('[data-prop="y"]');
    if (xInput) xInput.value = layer.x; if (yInput) yInput.value = layer.y;
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (moved) { requestCardPreview(); markCardDirty(); drawCardEditor(qs('#cd-root')); }
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

let cardPreviewDebounce = null;
function requestCardPreview() {
  clearTimeout(cardPreviewDebounce);
  cardPreviewDebounce = setTimeout(async () => {
    const st = cardEditorState;
    const loading = qs('#cd-canvas-loading');
    if (loading) loading.classList.remove('hidden');
    try {
      const res = await API.post(`/api/guilds/${st.guildId}/cards/${st.type}/preview`, { schema: st.schema });
      const img = qs('#cd-preview-img');
      if (img) img.src = res.image;
    } catch (e) { toast(e.message || 'Preview render failed', 'err'); }
    finally { if (loading) loading.classList.add('hidden'); }
  }, 300);
}
function markCardDirty() { showCardSaveBar(); }

function ensureCardSaveBar() {
  if (qs('#card-save-bar')) return qs('#card-save-bar');
  const bar = el(`
    <div class="save-bar" id="card-save-bar">
      <span class="save-bar-text" id="card-save-bar-text">Unsaved changes</span>
      <button class="btn btn-ghost btn-sm" id="card-save-discard">Discard</button>
      <button class="btn btn-primary btn-sm" id="card-save-commit">Save changes</button>
    </div>
  `);
  document.body.appendChild(bar);
  qs('#card-save-discard', bar).addEventListener('click', () => {
    cardEditorState.schema = structuredClone(cardEditorState.savedSchema);
    hideCardSaveBar();
    drawCardEditor(qs('#cd-root'));
    requestCardPreview();
  });
  qs('#card-save-commit', bar).addEventListener('click', commitCardSave);
  return bar;
}
function showCardSaveBar() { ensureCardSaveBar().classList.toggle('is-visible', isCardEditorDirty()); }
function hideCardSaveBar() { qs('#card-save-bar')?.classList.remove('is-visible'); }
async function commitCardSave() {
  const btn = qs('#card-save-commit');
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await API.post(`/api/guilds/${cardEditorState.guildId}/cards/${cardEditorState.type}`, { schema: cardEditorState.schema });
    cardEditorState.savedSchema = structuredClone(cardEditorState.schema);
    hideCardSaveBar();
    toast('Card design saved', 'ok');
  } catch (e) { toast(e.message || 'Save failed', 'err'); }
  finally { btn.disabled = false; btn.textContent = original; }
}
window.addEventListener('beforeunload', (e) => {
  if (cardEditorState && isCardEditorDirty()) { e.preventDefault(); e.returnValue = ''; }
});

// ══════════════════════════════════════════════════════════
//  VIEW: LEAVE SETTINGS — same control style as Welcome
// ══════════════════════════════════════════════════════════
async function renderLeaveSettings(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading leave settings…</p></div>`;
  let gs, meta;
  try { [meta, gs] = await Promise.all([API.get(`/api/guilds/${guildId}/meta`), API.get(`/api/guilds/${guildId}/settings`)]); }
  catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'leave');
  content.innerHTML = `
    <div class="content-head"><div><h1>👋 Leave Messages</h1><p>Configure goodbye messages exactly like the Welcome system. The visual card is edited in Card Designer.</p></div></div>
    <div class="card" style="padding:20px;">
      <div class="field-row"><div><strong>Enable leave messages</strong><div class="field-help">Posts when a member leaves voluntarily (kicks are excluded).</div></div><input id="leave-enabled" type="checkbox" ${gs.leaveEnabled ? 'checked' : ''}></div>
      <div class="field-row"><div><strong>Channel</strong></div><select id="leave-channel"><option value="">Select a channel…</option>${(meta.channels||[]).map(c=>`<option value="${c.id}" ${gs.leaveChannelId===c.id?'selected':''}>#${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field-row is-col"><div><strong>Message</strong><div class="field-help">Placeholders: {user} {username} {tag} {server} {count} {id}. Mentions are disabled for leave templates.</div></div><textarea id="leave-message" rows="4">${esc(gs.leaveMessage || 'Goodbye **{username}**! {count} members remain in **{server}**.')}</textarea></div>
      <div class="field-row"><div><strong>Send as card/embed</strong><div class="field-help">When enabled, the saved Leave Card schema is rendered first; if rendering fails it falls back to an embed.</div></div><input id="leave-embed" type="checkbox" ${gs.leaveEmbedEnabled !== false ? 'checked' : ''}></div>
      <div class="field-row"><div><strong>Fallback embed color</strong></div><input id="leave-color" type="text" value="#${Number(gs.leaveEmbedColor || 0xFF667A).toString(16).padStart(6,'0').toUpperCase()}" style="width:150px"></div>
      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;"><button class="btn btn-primary btn-sm" id="leave-save">Save</button><a class="btn btn-ghost btn-sm" href="/dashboard/${guildId}/cards" data-link>🎨 Edit Leave Card</a><button class="btn btn-ghost btn-sm" id="leave-test">Send Test</button></div>
    </div>`;
  qs('#leave-save').onclick = async e => {
    e.target.disabled = true;
    try { await API.post(`/api/guilds/${guildId}/settings`, { leaveEnabled: qs('#leave-enabled').checked, leaveChannelId: qs('#leave-channel').value || null, leaveMessage: qs('#leave-message').value, leaveEmbedEnabled: qs('#leave-embed').checked, leaveEmbedColor: parseInt(qs('#leave-color').value.replace('#',''),16) || 0xFF667A }); toast('Leave settings saved','ok'); }
    catch (err) { toast(err.message || 'Save failed','err'); }
    finally { e.target.disabled = false; }
  };
  qs('#leave-test').onclick = async e => {
    e.target.disabled = true;
    try { await API.post(`/api/guilds/${guildId}/leave/test`, {}); toast('Test leave message sent','ok'); }
    catch (err) { toast(err.message || 'Test failed','err'); }
    finally { e.target.disabled = false; }
  };
}

// ══════════════════════════════════════════════════════════
//  VIEW: INVITE ATTRIBUTION
// ══════════════════════════════════════════════════════════
async function renderInviteAttribution(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading invite attribution…</p></div>`;
  let data;
  try { data = await API.get(`/api/guilds/${guildId}/invites`); } catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'invites');
  const escMention = id => id ? `<@${esc(id)}>` : 'Unknown';
  content.innerHTML = `<div class="content-head"><div><h1>🕵️ Who Invited Who</h1><p>Invite attribution recorded at join time. Vanity joins and ambiguous simultaneous invite use are reported as unknown.</p></div><button class="btn btn-primary btn-sm" id="inv-refresh">Refresh invites</button></div>
    <div class="stats-grid"><div class="stat-card"><div class="stat-value">${data.trackedJoins}</div><div class="stat-label">Tracked joins</div></div><div class="stat-card"><div class="stat-value">${data.inviteCodes}</div><div class="stat-label">Invite codes</div></div><div class="stat-card"><div class="stat-value">${data.leaderboard?.[0]?.joins || 0}</div><div class="stat-label">Top inviter joins</div></div></div>
    <div class="card" style="padding:20px;margin-top:14px;"><h3 style="font-size:14px;margin-bottom:12px;">Invite leaderboard</h3>${(data.leaderboard||[]).map((r,i)=>`<div class="field-row"><div><strong>#${i+1}</strong> ${escMention(r.inviterId)}</div><span class="badge badge-on">${r.joins} joins</span></div>`).join('') || '<div class="state-block">No attributed joins yet.</div>'}</div>
    <div class="card" style="padding:20px;margin-top:14px;"><h3 style="font-size:14px;margin-bottom:12px;">Recent joins</h3><table class="cd-preview-table"><thead><tr><th>Member</th><th>Inviter</th><th>Code</th><th>When</th></tr></thead><tbody>${(data.recent||[]).map(r=>`<tr><td>${esc(r.memberTag||r.memberId)}</td><td>${r.inviterId?escMention(r.inviterId):'Unknown'}</td><td class="mono">${esc(r.code||'—')}</td><td>${r.at?new Date(r.at).toLocaleString():'—'}</td></tr>`).join('')}</tbody></table></div>`;
  qs('#inv-refresh').onclick = async e => { e.target.disabled=true; try { await API.post(`/api/guilds/${guildId}/invites/refresh`,{}); toast('Invite snapshot refreshed','ok'); renderInviteAttribution(root,guildId,me); } catch(err){ toast(err.message||'Refresh failed','err'); } finally { e.target.disabled=false; } };
}

// ══════════════════════════════════════════════════════════
//  VIEW: OWNER MATH LAB
// ══════════════════════════════════════════════════════════
async function renderMathOwner(root, me) {
  if (!me.user?.superUser) { root.innerHTML = `<div class="state-block"><h3>Owner only</h3><p>This page is restricted to the bot owner.</p></div>`; return; }
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading Math Lab…</p></div>`;
  let cfg, status;
  try {
    [cfg, status] = await Promise.all([API.get('/api/math/config'), API.get('/api/math/status')]);
  } catch(e) { root.innerHTML = errorBlock(e.message); return; }

  const escText = v => esc(String(v ?? ''));
  const backendRows = (status.backends || []).map(b => `
    <tr>
      <td><strong>${escText(b.name)}</strong></td>
      <td class="mono">${escText(b.actual)}</td>
      <td>${b.available ? '<span class="badge badge-on">✅ Available</span>' : '<span class="badge">❌ Missing</span>'}</td>
      <td>${escText(b.description)}</td>
    </tr>`).join('');

  root.innerHTML = `<div class="app-shell"><main class="main" style="margin-left:0;max-width:1180px;margin-right:auto;">
    <div class="content-head"><div><h1>👑 Math Lab</h1><p>Owner-only controls for the full math worker, backend registry, RAM limit, timeout and precision defaults.</p></div><div style="display:flex;gap:8px;"><button class="btn btn-ghost btn-sm" id="math-refresh">↻ Refresh status</button><a class="btn btn-ghost btn-sm" href="/dashboard">← Dashboard</a></div></div>

    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value">${(status.backends||[]).filter(b=>b.available).length}</div><div class="stat-label">Available backends</div></div>
      <div class="stat-card"><div class="stat-value">${(status.backends||[]).length}</div><div class="stat-label">Configured backends</div></div>
      <div class="stat-card"><div class="stat-value">${cfg.ramLimitMb} MB</div><div class="stat-label">Math RAM limit</div></div>
      <div class="stat-card"><div class="stat-value">${cfg.timeoutS}s</div><div class="stat-label">Math timeout</div></div>
    </div>

    <div class="card" style="padding:20px;margin-top:14px;">
      <h3 style="font-size:14px;margin-bottom:12px;">⚙️ Runtime configuration</h3>
      <div class="field-row is-col"><div><strong>RAM limit</strong><div class="field-help">Shared Math Worker process limit. Range: 64–32768 MB. Updating it restarts the worker.</div></div><input id="math-ram" type="number" min="64" max="32768" step="1" value="${cfg.ramLimitMb}"></div>
      <div class="field-row is-col"><div><strong>Math computation timeout</strong><div class="field-help">Maximum seconds per backend computation. Range: 1–300 seconds. Updating it restarts the worker.</div></div><input id="math-worker-timeout" type="number" min="1" max="300" step="1" value="${cfg.timeoutS}"></div>
      <div class="field-row is-col"><div><strong>Default mpmath precision</strong><div class="field-help">Fallback used by the separate /mpmath command when a precision option is not supplied. Range: 1–100000 decimal digits.</div></div><input id="math-precision" type="number" min="1" max="100000" step="1" value="${cfg.persisted?.mathDefaultPrecision ?? 50}"></div>
      <div class="field-row is-col"><div><strong>Crash timeout setting</strong><div class="field-help">Existing bot-wide hung-process setting stored in botConfig. This remains separate from the Math Worker's own timeout.</div></div><input id="math-crash-timeout" type="number" min="0" max="3600000" step="1000" value="${cfg.persisted?.crashTimeoutMs ?? 30000}"></div>
      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;"><button class="btn btn-primary btn-sm" id="math-save">Save Math Lab settings</button><button class="btn btn-ghost btn-sm" id="math-restart">Restart Math Worker</button></div>
      <div id="math-save-note" class="field-help" style="margin-top:10px;"></div>
    </div>

    <div class="card" style="padding:20px;margin-top:14px;">
      <h3 style="font-size:14px;margin-bottom:12px;">🧮 Backend registry</h3>
      <p class="field-help" style="margin-bottom:12px;">The friendly names below map to the real Python backends used by <code>/math run</code>, <code>/math all</code> and the multiline modal.</p>
      <div style="overflow:auto;"><table class="cd-preview-table"><thead><tr><th>Dashboard name</th><th>Python backend</th><th>Status</th><th>Purpose</th></tr></thead><tbody>${backendRows || '<tr><td colspan="4">No backend metadata available.</td></tr>'}</tbody></table></div>
    </div>

    <div class="card" style="padding:20px;margin-top:14px;">
      <h3 style="font-size:14px;margin-bottom:12px;">📖 Command surface</h3>
      <div class="field-row"><div><strong>/math run</strong><div class="field-help">Choose one backend and supply an inline expression, or open the multiline modal.</div></div><code>/math run backend expression</code></div>
      <div class="field-row"><div><strong>/math all</strong><div class="field-help">Run the same code on every currently available backend.</div></div><code>/math all expression</code></div>
      <div class="field-row"><div><strong>/math status</strong><div class="field-help">Shows the availability of all registered backends.</div></div><code>/math status</code></div>
      <div class="field-row"><div><strong>/math ramset</strong><div class="field-help">Manage Messages permission required. Changes the global worker RAM limit and restarts the worker.</div></div><code>/math ramset mb</code></div>
      <div class="field-row"><div><strong>Legacy prefix commands</strong><div class="field-help">The module also supports !mathstatus, !mathramset, !mathall and !math&lt;backend&gt;.</div></div><span class="badge badge-on">Enabled</span></div>
      <div class="field-row"><div><strong>Output chunking</strong><div class="field-help">Long results are split into Discord-safe code blocks.</div></div><span class="badge badge-on">1800 chars/chunk</span></div>
      <div class="field-row"><div><strong>Modal input</strong><div class="field-help">Multiline code entry is capped at 4,000 characters and expires after 5 minutes.</div></div><span class="badge badge-on">Enabled</span></div>
    </div>
  </main></div>`;

  qs('#math-save').onclick = async e => {
    e.target.disabled = true;
    try {
      const body = {
        ramLimitMb: Number(qs('#math-ram').value),
        timeoutS: Number(qs('#math-worker-timeout').value),
        mathDefaultPrecision: Number(qs('#math-precision').value),
        crashTimeoutMs: Number(qs('#math-crash-timeout').value),
      };
      await API.post('/api/math/config', body);
      qs('#math-save-note').textContent = 'Saved. The Math Worker was restarted with the new runtime limits.';
      toast('Math Lab settings saved', 'ok');
      const fresh = await API.get('/api/math/status');
      const available = (fresh.backends || []).filter(b => b.available).length;
      const cards = root.querySelectorAll('.stat-card .stat-value');
      if (cards[0]) cards[0].textContent = available;
      if (cards[2]) cards[2].textContent = fresh.config.ramLimitMb + ' MB';
      if (cards[3]) cards[3].textContent = fresh.config.timeoutS + 's';
    } catch(err) { toast(err.message || 'Save failed', 'err'); }
    finally { e.target.disabled = false; }
  };
  qs('#math-restart').onclick = async e => {
    e.target.disabled = true;
    try { await API.post('/api/math/restart', {}); toast('Math Worker restarted', 'ok'); }
    catch(err) { toast(err.message || 'Restart failed', 'err'); }
    finally { e.target.disabled = false; }
  };
  qs('#math-refresh').onclick = () => renderMathOwner(root, me);
}

// ══════════════════════════════════════════════════════════
//  VIEW: XP CURVE — the preview table calls the bot's own
//  xpNeededForLevel/totalXpForLevel via the server, never a reimplemented
//  formula. Curve fields (curveType/baseXp/growthFactor) are the same
//  gs.leveling.* data the Settings → Leveling category writes — this page
//  is a friendlier editor over the same fields, not a parallel config.
// ══════════════════════════════════════════════════════════
async function renderXpCurve(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading XP curve…</p></div>`;
  let schema, gsData, meta;
  try {
    [meta, gsData] = await Promise.all([API.get(`/api/guilds/${guildId}/meta`), API.get(`/api/guilds/${guildId}/settings`)]);
  } catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'xpcurve');
  const lc = { curveType: 'linear', baseXp: 100, growthFactor: 50, ...gsData.leveling };
  let picked = null;

  async function refreshPreview() {
    const table = qs('#xpc-table');
    table.innerHTML = `<tr><td colspan="3" class="mono" style="color:var(--text-faint);font-size:12px;padding:10px;">Calculating…</td></tr>`;
    try {
      const q = new URLSearchParams({ curveType: qs('#xpc-type').value, baseXp: qs('#xpc-base').value, growthFactor: qs('#xpc-growth').value });
      const res = await API.get(`/api/guilds/${guildId}/leveling/curve-preview?${q}`);
      table.innerHTML = res.rows.map(r => `<tr><td>${r.level}</td><td class="mono">${r.xpForThisLevel.toLocaleString()}</td><td class="mono">${r.totalXp.toLocaleString()}</td></tr>`).join('');
    } catch (e) { table.innerHTML = `<tr><td colspan="3" style="color:var(--danger);font-size:12px;">${esc(e.message)}</td></tr>`; }
  }

  content.innerHTML = `
    <div class="content-head"><div><h1>📊 XP Curve</h1><p>Same formula the bot uses to compute levels — this table isn't a guess, it's calculated by the bot itself.</p></div></div>

    <div class="card" style="padding:20px;margin-bottom:14px;">
      <div class="field-row"><div><strong style="font-size:13px;">Curve type</strong></div>
        <select id="xpc-type">${['linear', 'quadratic', 'exponential'].map(t => `<option value="${t}" ${lc.curveType === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></div>
      <div class="field-row"><div><strong style="font-size:13px;">Base XP</strong></div><input type="number" id="xpc-base" value="${lc.baseXp}" min="0" style="width:140px;"></div>
      <div class="field-row"><div><strong style="font-size:13px;">Growth factor</strong><div style="font-size:11.5px;color:var(--text-faint);margin-top:2px;">Linear/quadratic: added per level. Exponential: % growth per level.</div></div><input type="number" id="xpc-growth" value="${lc.growthFactor}" min="0" style="width:140px;"></div>
      <div style="margin-top:14px;"><button class="btn btn-primary btn-sm" id="xpc-save">Save curve</button> <span class="mono" style="font-size:11px;color:var(--text-faint);">Table below updates live as you type — saving is separate.</span></div>
    </div>

    <div class="card" style="padding:20px;margin-bottom:14px;">
      <h3 style="font-size:14px;margin-bottom:12px;">Preview</h3>
      <table class="cd-preview-table"><thead><tr><th>Level</th><th>XP for this level</th><th>Total XP to reach it</th></tr></thead><tbody id="xpc-table"></tbody></table>
    </div>

    <div class="card" style="padding:20px;">
      <h3 style="font-size:14px;margin-bottom:14px;">Admin XP tools</h3>
      <div style="position:relative;margin-bottom:12px;">
        <input type="text" id="xpc-search" placeholder="Search a member…" style="width:100%;" autocomplete="off">
        <div id="xpc-results" class="card" style="position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:5;display:none;max-height:220px;overflow-y:auto;"></div>
      </div>
      <div id="xpc-member"></div>
    </div>
  `;
  qsa('#xpc-type, #xpc-base, #xpc-growth').forEach(inp => inp.addEventListener('input', debounce(refreshPreview, 200)));
  refreshPreview();

  qs('#xpc-save').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await API.post(`/api/guilds/${guildId}/settings`, { 'leveling.curveType': qs('#xpc-type').value, 'leveling.baseXp': Number(qs('#xpc-base').value), 'leveling.growthFactor': Number(qs('#xpc-growth').value) });
      toast('XP curve saved', 'ok');
    } catch (err) { toast(err.message || 'Save failed', 'err'); }
    finally { e.target.disabled = false; }
  });

  const searchInput = qs('#xpc-search'), resultsBox = qs('#xpc-results');
  searchInput.addEventListener('input', debounce(async () => {
    const q = searchInput.value.trim();
    if (q.length < 2) { resultsBox.style.display = 'none'; return; }
    let res;
    try { res = await API.get(`/api/guilds/${guildId}/members/search?q=${encodeURIComponent(q)}`); } catch { return; }
    if (!res.members.length) { resultsBox.style.display = 'none'; return; }
    resultsBox.innerHTML = res.members.map(m => `<div class="field-row" data-pick="${esc(m.id)}" style="cursor:pointer;padding:8px 12px;"><img src="${esc(m.avatarUrl)}" alt="" style="width:22px;height:22px;border-radius:50%;"><span style="font-size:12.5px;">${esc(m.nickname || m.tag)}</span></div>`).join('');
    resultsBox.style.display = 'block';
    qsa('[data-pick]', resultsBox).forEach(node => node.addEventListener('click', async () => {
      picked = node.dataset.pick;
      resultsBox.style.display = 'none';
      searchInput.value = res.members.find(m => m.id === picked)?.tag || '';
      await loadMemberPanel(picked);
    }));
  }, 200));

  async function loadMemberPanel(userId) {
    const box = qs('#xpc-member');
    box.innerHTML = `<div class="mono" style="font-size:12px;color:var(--text-faint);">Loading…</div>`;
    let info;
    try { info = await API.get(`/api/guilds/${guildId}/leveling/member/${userId}`); }
    catch (e) { box.innerHTML = `<div style="color:var(--danger);font-size:12.5px;">${esc(e.message)}</div>`; return; }
    box.innerHTML = `
      <div style="display:flex;gap:20px;align-items:center;margin-bottom:16px;flex-wrap:wrap;">
        <div><strong>${esc(info.tag)}</strong></div>
        <span class="mono" style="font-size:12px;color:var(--text-faint);">Level ${info.level} · ${info.xpIntoLevel}/${info.xpForNextLevel} XP · Total ${info.totalXp.toLocaleString()} · ${info.rank ? `Rank #${info.rank}` : 'Unranked'}</span>
      </div>
      <div class="stat-grid" style="margin-bottom:14px;">
        <div class="stat-card"><div class="stat-num">${Number(info.messages||0).toLocaleString()}</div><div class="stat-label">Messages</div></div>
        <div class="stat-card"><div class="stat-num">${Number(info.reactions||0).toLocaleString()}</div><div class="stat-label">Reactions given</div></div>
        <div class="stat-card"><div class="stat-num">${Math.floor((Number(info.voiceTime)||0)/3600)}h ${Math.floor(((Number(info.voiceTime)||0)%3600)/60)}m</div><div class="stat-label">Voice time</div></div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <div style="display:flex;gap:6px;align-items:center;"><input type="number" id="xpc-setlevel" placeholder="Level" style="width:90px;" min="0"><button class="btn btn-ghost btn-sm" data-xp-op="set-level">Set level</button></div>
        <div style="display:flex;gap:6px;align-items:center;"><input type="number" id="xpc-addamt" placeholder="Amount" style="width:90px;" min="0"><button class="btn btn-ghost btn-sm" data-xp-op="add-xp">Add XP</button><button class="btn btn-ghost btn-sm" data-xp-op="remove-xp">Remove XP</button></div>
      </div>
    `;
    qsa('[data-xp-op]', box).forEach(btn => btn.addEventListener('click', async () => {
      const op = btn.dataset.xpOp;
      const value = op === 'set-level' ? qs('#xpc-setlevel').value : qs('#xpc-addamt').value;
      if (!value) { toast('Enter a value first', 'err'); return; }
      btn.disabled = true;
      try { await API.post(`/api/guilds/${guildId}/leveling/member/${userId}/${op}`, { value }); toast('Updated', 'ok'); await loadMemberPanel(userId); }
      catch (e) { toast(e.message || 'Failed', 'err'); btn.disabled = false; }
    }));
  }
}

// ══════════════════════════════════════════════════════════
//  VIEW: BELI ECONOMY — read-only. Balances/inventory/streaks come from
//  coreBalance/ensureEconomy directly (the exact functions /beli's own
//  commands use), not a reimplementation. No admin "set balance" control
//  exists here on purpose — see beli_commands.js's export comment for why:
//  every earn/gamble/rob path has real game logic (cooldowns, odds) a raw
//  write would bypass, and starting balances are still hard-coded module
//  constants (STARTING_WALLET/STARTING_BANK), not per-guild settings yet.
// ══════════════════════════════════════════════════════════
async function renderBeliEconomy(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading Beli economy…</p></div>`;
  let ov;
  try { ov = await API.get(`/api/guilds/${guildId}/beli/overview`); } catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'beli');

  content.innerHTML = `
    <div class="content-head"><div><h1>💰 Beli Economy</h1><p>Live server controls for economy bootstrap, earning amounts, fishing/hunting payouts, wheel/slot tuning, and read-only economy intelligence. Changes below persist to this guild and affect the real bot where the corresponding control is supported.</p></div></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-num">${ov.playerCount}</div><div class="stat-label">Players with a balance</div></div>
      <div class="stat-card"><div class="stat-num">${ov.currencyEmoji} ${ov.totalNetWorth.toLocaleString()}</div><div class="stat-label">Top 10 combined net worth</div></div>
      <div class="stat-card"><div class="stat-num">${ov.shopItemCount}</div><div class="stat-label">Shop items</div></div>
      <div class="stat-card"><div class="stat-num">${ov.upgradeTracks.length}</div><div class="stat-label">Upgrade tracks</div></div>
    </div>

    <div class="card" style="padding:20px;margin-bottom:14px;">
      <h3 style="font-size:14px;margin-bottom:4px;">💰 Economy Core</h3>
      <p style="font-size:11.5px;color:var(--text-faint);margin-bottom:12px;">Configure new-player starting balances and the live base bank capacity for this server. Existing wallet/bank balances are preserved.</p>
      <div id="be-core-body"><div class="mono" style="font-size:12px;color:var(--text-faint);">Loading…</div></div>
    </div>

    <div class="card" style="padding:20px;margin-bottom:14px;">
      <h3 style="font-size:14px;margin-bottom:12px;">Leaderboard</h3>
      ${ov.leaderboard.length ? ov.leaderboard.map((r, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:7px 0;font-size:13px;">
          <span class="mono" style="width:22px;color:var(--text-faint);">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span>
          <span style="flex:1;">${esc(r.tag || r.userId)}</span>
          <span class="mono" style="color:var(--text-faint);">${ov.currencyEmoji} ${r.net.toLocaleString()}</span>
        </div>`).join('') : `<p style="color:var(--text-faint);font-size:13px;">Nobody has earned any ${esc(ov.currencyName)} yet.</p>`}
    </div>

    <div class="card" style="padding:20px;margin-bottom:14px;">
      <h3 style="font-size:14px;margin-bottom:4px;">Earning Actions</h3>
      <p style="font-size:11.5px;color:var(--text-faint);margin-bottom:12px;">Amounts, odds, and cooldowns for Daily/Weekly/Work/Crime/Rob/Trivia, plus win chance/edge and payout multipliers for Coinflip/Dice/Roulette/Higher-Lower/Limbo. Cooldowns are shown in minutes for readability but stored precisely. Every gambling value is still clamped server-side to a sane house edge no matter what's entered here — this can't be configured into a rigged-for-players or predatory setup.</p>
      <div id="be-earn-body"><div class="mono" style="font-size:12px;color:var(--text-faint);">Loading…</div></div>
    </div>

    <div class="card" style="padding:20px;margin-bottom:14px;">
      <h3 style="font-size:14px;margin-bottom:4px;">Fishing &amp; Hunting Payouts</h3>
      <p style="font-size:11.5px;color:var(--text-faint);margin-bottom:12px;">Weight controls how often a rarity tier comes up (higher = more common); min/max is the payout range for that tier. Rarity names and flavor text always come from the bot, not editable here.</p>
      <div class="cd-tabs" style="margin-bottom:12px;"><button class="cd-tab is-active" data-gather-tab="fish">🎣 Fish</button><button class="cd-tab" data-gather-tab="hunt">🏹 Hunt</button></div>
      <div id="be-gather-body"><div class="mono" style="font-size:12px;color:var(--text-faint);">Loading…</div></div>
    </div>

    <div class="card" style="padding:20px;margin-bottom:14px;">
      <h3 style="font-size:14px;margin-bottom:4px;">🎡 Wheel Segments</h3>
      <p style="font-size:11.5px;color:var(--text-faint);margin-bottom:12px;">Weight controls how often a segment lands (higher = more common); multiplier is applied to the bet for that segment. Segment labels always come from the bot, not editable here.</p>
      <div id="be-wheel-body"><div class="mono" style="font-size:12px;color:var(--text-faint);">Loading…</div></div>
    </div>

    <div class="card" style="padding:20px;margin-bottom:14px;">
      <h3 style="font-size:14px;margin-bottom:4px;">🎰 Slot Symbols</h3>
      <p style="font-size:11.5px;color:var(--text-faint);margin-bottom:12px;">Weight controls how often a symbol appears on a reel (higher = more common); multiplier is the payout for landing 3 of that symbol (any 2 matching pays half that symbol's multiplier, fixed). Symbols themselves always come from the bot, not editable here.</p>
      <div id="be-slots-body"><div class="mono" style="font-size:12px;color:var(--text-faint);">Loading…</div></div>
    </div>

    <div class="card" style="padding:20px;margin-bottom:14px;">
      <h3 style="font-size:14px;margin-bottom:4px;">Shop &amp; Upgrade Tracks</h3>
      <p style="font-size:11.5px;color:var(--text-faint);margin-bottom:12px;">Per-server pricing overrides. Item names, descriptions, effects, and upgrade behavior remain protected by the bot; only numeric shop prices and upgrade base costs are editable here.</p>
      <div id="be-shop-body"><div class="mono" style="font-size:12px;color:var(--text-faint);">Loading…</div></div>
    </div>
    <div class="card" style="padding:20px;margin-bottom:14px;">
      <h3 style="font-size:14px;margin-bottom:4px;">🎮 Advanced Beli Game Settings</h3>
      <p style="font-size:11.5px;color:var(--text-faint);margin-bottom:12px;">Safe, bounded server configuration for the remaining Beli game parameters. Values are validated server-side and preserve defaults when untouched.</p>
      <div id="be-games-body"><div class="mono" style="font-size:12px;color:var(--text-faint);">Loading…</div></div>
    </div>

    <div class="card" style="padding:20px;">
      <h3 style="font-size:14px;margin-bottom:12px;">Look up a member</h3>
      <div style="position:relative;">
        <input type="text" id="be-search" placeholder="Search by username or nickname…" style="width:100%;" autocomplete="off">
        <div id="be-results" class="card" style="position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:5;display:none;max-height:220px;overflow-y:auto;"></div>
      </div>
      <div id="be-member" style="margin-top:14px;"></div>
    </div>
  `;

  async function loadEconomyCore() {
    const body = qs('#be-core-body');
    try {
      const r = await API.get(`/api/guilds/${guildId}/beli/core`);
      const c = r.config;
      body.innerHTML = `
        <div class="field-row"><div><strong>Starting wallet</strong><div class="desc">Only affects brand-new economy records.</div></div><input type="number" id="be-core-wallet" value="${c.startingWallet}" min="0" max="1000000000" style="width:150px;"></div>
        <div class="field-row"><div><strong>Starting bank</strong><div class="desc">Only affects brand-new records and is capped by base capacity.</div></div><input type="number" id="be-core-bank" value="${c.startingBank}" min="0" max="1000000000" style="width:150px;"></div>
        <div class="field-row"><div><strong>Base bank capacity</strong><div class="desc">Applies immediately to future deposits before Vault upgrades.</div></div><input type="number" id="be-core-cap" value="${c.baseBankCapacity}" min="100" max="1000000000" style="width:150px;"></div>
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;"><button class="btn btn-primary btn-sm" id="be-core-save">Save economy core</button><span class="mono" style="font-size:10.5px;color:var(--text-faint);">Defaults: wallet ${r.defaults.startingWallet.toLocaleString()} · bank ${r.defaults.startingBank.toLocaleString()} · capacity ${r.defaults.baseBankCapacity.toLocaleString()}</span></div>`;
      qs('#be-core-save').onclick = async (e) => {
        e.target.disabled = true;
        try {
          await API.post(`/api/guilds/${guildId}/beli/core`, { startingWallet: Number(qs('#be-core-wallet').value), startingBank: Number(qs('#be-core-bank').value), baseBankCapacity: Number(qs('#be-core-cap').value) });
          toast('Economy core saved', 'ok'); await loadEconomyCore();
        } catch (err) { toast(err.message || 'Save failed', 'err'); e.target.disabled = false; }
      };
    } catch (e) { body.innerHTML = `<div style="color:var(--danger);font-size:12.5px;">${esc(e.message)}</div>`; }
  }
  loadEconomyCore();

  const searchInput = qs('#be-search'), resultsBox = qs('#be-results');
  searchInput.addEventListener('input', debounce(async () => {
    const q = searchInput.value.trim();
    if (q.length < 2) { resultsBox.style.display = 'none'; return; }
    let res;
    try { res = await API.get(`/api/guilds/${guildId}/members/search?q=${encodeURIComponent(q)}`); } catch { return; }
    if (!res.members.length) { resultsBox.style.display = 'none'; return; }
    resultsBox.innerHTML = res.members.map(m => `<div class="field-row" data-pick="${esc(m.id)}" style="cursor:pointer;padding:8px 12px;"><img src="${esc(m.avatarUrl)}" alt="" style="width:22px;height:22px;border-radius:50%;"><span style="font-size:12.5px;">${esc(m.nickname || m.tag)}</span></div>`).join('');
    resultsBox.style.display = 'block';
    qsa('[data-pick]', resultsBox).forEach(node => node.addEventListener('click', async () => {
      resultsBox.style.display = 'none';
      searchInput.value = res.members.find(m => m.id === node.dataset.pick)?.tag || '';
      const box = qs('#be-member');
      box.innerHTML = `<div class="mono" style="font-size:12px;color:var(--text-faint);">Loading…</div>`;
      try {
        const m = await API.get(`/api/guilds/${guildId}/beli/member/${node.dataset.pick}`);
        box.innerHTML = `
          <div style="font-weight:600;margin-bottom:8px;">${esc(m.tag)}</div>
          <div class="stat-grid">
            <div class="stat-card"><div class="stat-num">${ov.currencyEmoji} ${m.wallet.toLocaleString()}</div><div class="stat-label">Wallet</div></div>
            <div class="stat-card"><div class="stat-num">${ov.currencyEmoji} ${m.bank.toLocaleString()}/${m.cap.toLocaleString()}</div><div class="stat-label">Bank</div></div>
            <div class="stat-card"><div class="stat-num">${ov.currencyEmoji} ${m.net.toLocaleString()}</div><div class="stat-label">Net worth</div></div>
            <div class="stat-card"><div class="stat-num">${m.dailyStreak}</div><div class="stat-label">Daily streak</div></div>
          </div>
          <div class="mono" style="font-size:11.5px;color:var(--text-faint);margin-top:10px;">
            Gambling: ${m.gamesWon}W / ${Math.max(0, m.gamesPlayed - m.gamesWon)}L · Robs: ${m.robsWon}W / ${m.robsLost}L · Duels: ${m.duelsWon}W / ${m.duelsLost}L
          </div>`;
      } catch (e) { box.innerHTML = `<div style="color:var(--danger);font-size:12.5px;">${esc(e.message)}</div>`; }
    }));
  }, 200));

  // ── Fish/Hunt loot editor ──
  let gatherAction = 'fish';
  async function loadGatherTable() {
    const body = qs('#be-gather-body');
    body.innerHTML = `<div class="mono" style="font-size:12px;color:var(--text-faint);">Loading…</div>`;
    let res;
    try { res = await API.get(`/api/guilds/${guildId}/beli/gather/${gatherAction}`); }
    catch (e) { body.innerHTML = `<div style="color:var(--danger);font-size:12.5px;">${esc(e.message)}</div>`; return; }
    body.innerHTML = `
      <table class="cd-preview-table" style="margin-bottom:12px;">
        <thead><tr><th>Rarity</th><th>Weight</th><th>Min</th><th>Max</th></tr></thead>
        <tbody>${res.tiers.map((t, i) => `
          <tr>
            <td>${esc(t.rarity)}</td>
            <td><input type="number" data-gather-field="weight" data-gather-idx="${i}" value="${t.weight}" min="0" style="width:80px;"></td>
            <td><input type="number" data-gather-field="min" data-gather-idx="${i}" value="${t.min}" min="0" style="width:90px;"></td>
            <td><input type="number" data-gather-field="max" data-gather-idx="${i}" value="${t.max}" min="0" style="width:90px;"></td>
          </tr>`).join('')}</tbody>
      </table>
      <button class="btn btn-primary btn-sm" id="be-gather-save">Save ${gatherAction === 'fish' ? 'fishing' : 'hunting'} payouts</button>
      ${res.isCustom ? `<button class="btn btn-ghost btn-sm" id="be-gather-reset">Reset to defaults</button>` : ''}
    `;
    qs('#be-gather-save').addEventListener('click', async (e) => {
      const rows = res.tiers.map((_, i) => ({
        weight: Number(qs(`[data-gather-field="weight"][data-gather-idx="${i}"]`).value),
        min: Number(qs(`[data-gather-field="min"][data-gather-idx="${i}"]`).value),
        max: Number(qs(`[data-gather-field="max"][data-gather-idx="${i}"]`).value),
      }));
      e.target.disabled = true;
      try { await API.post(`/api/guilds/${guildId}/beli/gather/${gatherAction}`, { tiers: rows }); toast('Saved', 'ok'); loadGatherTable(); }
      catch (err) { toast(err.message || 'Save failed', 'err'); e.target.disabled = false; }
    });
    qs('#be-gather-reset')?.addEventListener('click', async () => {
      if (!confirm(`Reset ${gatherAction === 'fish' ? 'fishing' : 'hunting'} payouts to the bot's defaults?`)) return;
      try { await API.post(`/api/guilds/${guildId}/beli/gather/${gatherAction}`, { tiers: res.tiers.map(() => ({})) }); toast('Reset', 'ok'); loadGatherTable(); }
      catch (err) { toast(err.message || 'Reset failed', 'err'); }
    });
  }
  // ── Earning actions editor (Daily/Weekly/Work/Crime/Rob/Trivia) ──
  // Field metadata mirrors dashboard.js's EARN_FIELDS exactly — group +
  // label + unit only; the actual validation/clamping is server-side
  // (dashboard.js pre-validates for immediate feedback, getEconomyEarnConfig
  // in beli_commands.js is the real, final safety net on every read).
  const EARN_GROUPS = [
    { title: 'Daily', fields: [
      ['dailyBase', 'Base amount', ''], ['dailyStreakStep', 'Streak step (+ per day)', ''],
      ['dailyStreakCap', 'Streak cap (max bonus)', ''], ['dailyCooldownMs', 'Cooldown', 'min'],
    ] },
    { title: 'Weekly', fields: [
      ['weeklyBase', 'Base amount', ''], ['weeklyCooldownMs', 'Cooldown', 'min'],
    ] },
    { title: 'Work', fields: [
      ['workMin', 'Min payout', ''], ['workMax', 'Max payout', ''], ['workCooldownMs', 'Cooldown', 'min'],
    ] },
    { title: 'Crime', fields: [
      ['crimeSuccessChance', 'Success chance (0–0.9)', ''], ['crimeMin', 'Min payout', ''], ['crimeMax', 'Max payout', ''],
      ['crimeFineMin', 'Fine on failure, min (0–1)', ''], ['crimeFineMax', 'Fine on failure, max (0–1)', ''], ['crimeCooldownMs', 'Cooldown', 'min'],
    ] },
    { title: 'Rob', fields: [
      ['robSuccessChance', 'Success chance (0.05–0.85)', ''], ['robStealMin', 'Steal %, min (0–1)', ''], ['robStealMax', 'Steal %, max (0–1)', ''],
      ['robFailFinePct', 'Fine on failure (0–1)', ''], ['robMinVictimWallet', 'Min victim wallet to target', ''], ['robCooldownMs', 'Cooldown', 'min'],
    ] },
    { title: 'Trivia', fields: [
      ['triviaMin', 'Min payout', ''], ['triviaMax', 'Max payout', ''],
      ['triviaAnswerWindowMs', 'Answer window', 'min'], ['triviaCooldownMs', 'Cooldown', 'min'],
    ] },
    { title: 'Coinflip', fields: [
      ['coinflipWinChance', 'Win chance (0–1)', ''], ['coinflipPayoutMult', 'Payout multiplier', ''],
    ] },
    { title: 'Dice', fields: [
      ['diceEdgeFactor', 'Edge factor (0–1, lower = harder)', ''], ['dicePayoutMult', 'Payout multiplier', ''],
    ] },
    { title: 'Roulette — Color bet', fields: [
      ['rouletteColorEdgeFactor', 'Edge factor (0–1)', ''], ['rouletteColorPayoutMult', 'Payout multiplier', ''],
    ] },
    { title: 'Roulette — Number bet', fields: [
      ['rouletteNumberEdgeFactor', 'Edge factor (0–1)', ''], ['rouletteNumberPayoutMult', 'Payout multiplier', ''],
    ] },
    { title: 'Higher/Lower', fields: [
      ['higherLowerWinChance', 'Win chance (0–0.55)', ''], ['higherLowerPayoutMult', 'Payout multiplier', ''],
    ] },
    { title: 'Limbo', fields: [
      ['limboRTP', 'Return-to-player (0.5–0.99)', ''],
    ] },
  ];
  async function loadEarnConfig() {
    const body = qs('#be-earn-body');
    body.innerHTML = `<div class="mono" style="font-size:12px;color:var(--text-faint);">Loading…</div>`;
    let res;
    try { res = await API.get(`/api/guilds/${guildId}/beli/earn`); }
    catch (e) { body.innerHTML = `<div style="color:var(--danger);font-size:12.5px;">${esc(e.message)}</div>`; return; }
    const cfg = res.config;
    // ms fields are edited in minutes for readability; converted back on save.
    const isMs = (unit) => unit === 'min';
    const displayVal = (key, unit) => isMs(unit) ? +(cfg[key] / 60000).toFixed(2) : cfg[key];
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:14px;">
        ${EARN_GROUPS.map(g => `
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--text-faint);margin-bottom:6px;">${esc(g.title)}</div>
            ${g.fields.map(([key, label, unit]) => `
              <div class="field-row" style="padding:5px 0;">
                <label style="font-size:12px;">${esc(label)}${unit ? ` (${unit})` : ''}</label>
                <input type="number" data-earn-field="${key}" data-earn-unit="${unit}" value="${displayVal(key, unit)}" min="0" step="any" style="width:110px;">
              </div>`).join('')}
          </div>`).join('')}
      </div>
      <button class="btn btn-primary btn-sm" id="be-earn-save">Save earning actions</button>
      ${res.isCustom ? `<button class="btn btn-ghost btn-sm" id="be-earn-reset">Reset to defaults</button>` : ''}
    `;
    qs('#be-earn-save').addEventListener('click', async (e) => {
      const payload = {};
      for (const g of EARN_GROUPS) for (const [key, , unit] of g.fields) {
        const raw = Number(qs(`[data-earn-field="${key}"]`).value);
        payload[key] = isMs(unit) ? Math.round(raw * 60000) : raw;
      }
      e.target.disabled = true;
      try { await API.post(`/api/guilds/${guildId}/beli/earn`, payload); toast('Saved', 'ok'); loadEarnConfig(); }
      catch (err) { toast(err.message || 'Save failed', 'err'); e.target.disabled = false; }
    });
    qs('#be-earn-reset')?.addEventListener('click', async () => {
      if (!confirm(`Reset earning actions to the bot's defaults?`)) return;
      try { await API.post(`/api/guilds/${guildId}/beli/earn/reset`); toast('Reset', 'ok'); loadEarnConfig(); }
      catch (err) { toast(err.message || 'Reset failed', 'err'); }
    });
  }
  loadEarnConfig();

  qsa('[data-gather-tab]').forEach(btn => btn.addEventListener('click', () => {
    gatherAction = btn.dataset.gatherTab;
    qsa('[data-gather-tab]').forEach(b => b.classList.toggle('is-active', b === btn));
    loadGatherTable();
  }));
  loadGatherTable();

  // ── Wheel segment editor ──
  async function loadWheelTable() {
    const body = qs('#be-wheel-body');
    body.innerHTML = `<div class="mono" style="font-size:12px;color:var(--text-faint);">Loading…</div>`;
    let res;
    try { res = await API.get(`/api/guilds/${guildId}/beli/wheel`); }
    catch (e) { body.innerHTML = `<div style="color:var(--danger);font-size:12.5px;">${esc(e.message)}</div>`; return; }
    body.innerHTML = `
      <table class="cd-preview-table" style="margin-bottom:12px;">
        <thead><tr><th>Segment</th><th>Weight</th><th>Multiplier</th></tr></thead>
        <tbody>${res.segments.map((s, i) => `
          <tr>
            <td>${esc(s.label)}</td>
            <td><input type="number" data-wheel-field="weight" data-wheel-idx="${i}" value="${s.weight}" min="0" step="0.1" style="width:90px;"></td>
            <td><input type="number" data-wheel-field="mult" data-wheel-idx="${i}" value="${s.mult}" min="0" step="0.1" style="width:90px;"></td>
          </tr>`).join('')}</tbody>
      </table>
      <button class="btn btn-primary btn-sm" id="be-wheel-save">Save wheel segments</button>
      ${res.isCustom ? `<button class="btn btn-ghost btn-sm" id="be-wheel-reset">Reset to defaults</button>` : ''}
    `;
    qs('#be-wheel-save').addEventListener('click', async (e) => {
      const rows = res.segments.map((_, i) => ({
        weight: Number(qs(`[data-wheel-field="weight"][data-wheel-idx="${i}"]`).value),
        mult: Number(qs(`[data-wheel-field="mult"][data-wheel-idx="${i}"]`).value),
      }));
      e.target.disabled = true;
      try { await API.post(`/api/guilds/${guildId}/beli/wheel`, { segments: rows }); toast('Saved', 'ok'); loadWheelTable(); }
      catch (err) { toast(err.message || 'Save failed', 'err'); e.target.disabled = false; }
    });
    qs('#be-wheel-reset')?.addEventListener('click', async () => {
      if (!confirm(`Reset wheel segments to the bot's defaults?`)) return;
      try { await API.post(`/api/guilds/${guildId}/beli/wheel`, { segments: res.segments.map(() => ({})) }); toast('Reset', 'ok'); loadWheelTable(); }
      catch (err) { toast(err.message || 'Reset failed', 'err'); }
    });
  }
  loadWheelTable();

  // ── Slots editor — identical shape to the Wheel editor above, just a
  // different field name (sym vs label) and a different backend route.
  async function loadSlotsTable() {
    const body = qs('#be-slots-body');
    body.innerHTML = `<div class="mono" style="font-size:12px;color:var(--text-faint);">Loading…</div>`;
    let res;
    try { res = await API.get(`/api/guilds/${guildId}/beli/slots`); }
    catch (e) { body.innerHTML = `<div style="color:var(--danger);font-size:12.5px;">${esc(e.message)}</div>`; return; }
    body.innerHTML = `
      <table class="cd-preview-table" style="margin-bottom:12px;">
        <thead><tr><th>Symbol</th><th>Weight</th><th>Multiplier (×3 match)</th></tr></thead>
        <tbody>${res.symbols.map((s, i) => `
          <tr>
            <td style="font-size:16px;">${esc(s.sym)}</td>
            <td><input type="number" data-slots-field="weight" data-slots-idx="${i}" value="${s.weight}" min="0" step="0.1" style="width:90px;"></td>
            <td><input type="number" data-slots-field="mult" data-slots-idx="${i}" value="${s.mult}" min="0" step="0.1" style="width:90px;"></td>
          </tr>`).join('')}</tbody>
      </table>
      <button class="btn btn-primary btn-sm" id="be-slots-save">Save slot symbols</button>
      ${res.isCustom ? `<button class="btn btn-ghost btn-sm" id="be-slots-reset">Reset to defaults</button>` : ''}
    `;
    qs('#be-slots-save').addEventListener('click', async (e) => {
      const rows = res.symbols.map((_, i) => ({
        weight: Number(qs(`[data-slots-field="weight"][data-slots-idx="${i}"]`).value),
        mult: Number(qs(`[data-slots-field="mult"][data-slots-idx="${i}"]`).value),
      }));
      e.target.disabled = true;
      try { await API.post(`/api/guilds/${guildId}/beli/slots`, { symbols: rows }); toast('Saved', 'ok'); loadSlotsTable(); }
      catch (err) { toast(err.message || 'Save failed', 'err'); e.target.disabled = false; }
    });
    qs('#be-slots-reset')?.addEventListener('click', async () => {
      if (!confirm(`Reset slot symbols to the bot's defaults?`)) return;
      try { await API.post(`/api/guilds/${guildId}/beli/slots`, { symbols: res.symbols.map(() => ({})) }); toast('Reset', 'ok'); loadSlotsTable(); }
      catch (err) { toast(err.message || 'Reset failed', 'err'); }
    });
  }
  loadSlotsTable();

  // ── Shop & Upgrade Tracks — per-guild numeric editor ──
  async function loadShopBrowser() {
    const body = qs('#be-shop-body');
    body.innerHTML = `<div class="mono" style="font-size:12px;color:var(--text-faint);">Loading…</div>`;
    let res;
    try { res = await API.get(`/api/guilds/${guildId}/beli/catalog`); }
    catch (e) { body.innerHTML = `<div style="color:var(--danger);font-size:12.5px;">${esc(e.message)}</div>`; return; }
    body.innerHTML = `
      <div style="font-size:12px;font-weight:600;color:var(--text-faint);margin-bottom:8px;">Shop prices (${res.shopItems.length})</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;margin-bottom:18px;">
        ${res.shopItems.map(it => `
          <div style="border:1px solid var(--border-hi);border-radius:8px;padding:10px 12px;">
            <div style="font-size:13px;margin-bottom:2px;">${it.emoji || ''} <strong>${esc(it.name)}</strong></div>
            <div style="font-size:12px;color:var(--text-faint);margin-bottom:7px;">${esc(it.desc || '')}</div>
            <label class="field"><span>Price</span><input type="number" min="0" max="1000000000" step="1" data-shop-price="${esc(it.id)}" value="${it.price}"></label>
          </div>`).join('')}
      </div>
      <div style="font-size:12px;font-weight:600;color:var(--text-faint);margin-bottom:8px;">Upgrade base costs</div>
      ${res.upgradeTracks.map(t => `
        <div style="border:1px solid var(--border-hi);border-radius:8px;padding:10px 12px;margin-bottom:8px;">
          <div style="font-size:13px;margin-bottom:2px;"><strong>${esc(t.label)}</strong> <span style="color:var(--text-faint);font-size:11.5px;">(${t.maxTier} tiers)</span></div>
          <div style="font-size:12px;color:var(--text-faint);margin-bottom:6px;">${esc(t.desc || '')}</div>
          <div class="field-row"><div><span>Base cost</span><div class="desc">Next-tier formula uses the bot's existing tier curve.</div></div><input type="number" min="0" max="1000000000" step="1" data-upgrade-cost="${esc(t.key)}" value="${t.baseCost}" style="width:140px;"></div>
          <div class="mono" style="font-size:10.5px;color:var(--text-faint);margin-top:6px;">${t.tierCosts.map(c => c.toLocaleString()).join(' → ')}</div>
        </div>`).join('')}
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn btn-primary btn-sm" id="be-catalog-save">Save catalog</button>
        <button class="btn btn-ghost btn-sm" id="be-catalog-reset">Reset to defaults</button>
      </div>`;
    qs('#be-catalog-save').onclick=async e=>{
      e.target.disabled=true;
      try{
        const shopPrices={}; qsa('[data-shop-price]').forEach(x=>shopPrices[x.dataset.shopPrice]=Number(x.value));
        const upgradeBaseCosts={}; qsa('[data-upgrade-cost]').forEach(x=>upgradeBaseCosts[x.dataset.upgradeCost]=Number(x.value));
        await API.post(`/api/guilds/${guildId}/beli/catalog`,{shopPrices,upgradeBaseCosts}); toast('Catalog saved','ok'); loadShopBrowser();
      }catch(err){toast(err.message||'Save failed','err');e.target.disabled=false;}
    };
    qs('#be-catalog-reset').onclick=async()=>{if(!confirm('Reset shop prices and upgrade base costs for this server?'))return;try{await API.post(`/api/guilds/${guildId}/beli/catalog/reset`,{});toast('Catalog reset','ok');loadShopBrowser();}catch(e){toast(e.message||'Reset failed','err');}};
  }
  loadShopBrowser();

  async function loadAdvancedBeliGames(){
    const body=qs('#be-games-body');
    let res; try{res=await API.get(`/api/guilds/${guildId}/beli/games`);}catch(e){body.innerHTML=`<div style="color:var(--danger);font-size:12.5px;">${esc(e.message)}</div>`;return;}
    const labels={
      minesMaxMines:['Mines maximum mines','count'], minesGrowthFactor:['Mines growth factor','x'],
      crashGrowthRate:['Crash growth rate','rate'], crashRtp:['Crash RTP','0–1'], crashMaxMultiplier:['Crash max multiplier','x'],
      scratchCells:['Scratch cells','count'], lotteryTicketPrice:['Lottery ticket price','Beli'], lotteryIntervalMinutes:['Lottery draw interval','minutes'],
      blackjackNaturalMult:['Blackjack natural multiplier','x'], blackjackWinMult:['Blackjack win multiplier','x'], blackjackDealerStandAt:['Blackjack dealer stands at','score'],
      kenoLowMult:['Keno low multiplier','x'], kenoMidMult:['Keno mid multiplier','x'], kenoHighMult:['Keno high multiplier','x'], kenoLuckPayoutMult:['Keno luck payout bonus','x'],
      warPushChance:['War push chance','0–1'], warWinMult:['War win multiplier','x'], duelHouseCutPct:['Duel house cut','0–1'], duelExpiryMinutes:['Duel expiry','minutes']};
    body.innerHTML=`<div class="form-grid">${Object.entries(res.config).map(([k,v])=>`<label class="field"><span>${esc(labels[k]?.[0]||k)} <small class="mono" style="color:var(--text-faint)">${esc(labels[k]?.[1]||'')}</small></span><input type="number" step="any" data-game-field="${esc(k)}" value="${Number(v)}" min="${res.fields?.[k]?.[0]??0}" max="${res.fields?.[k]?.[1]??1000000000}"></label>`).join('')}</div><div style="display:flex;gap:8px;margin-top:12px;"><button class="btn btn-primary btn-sm" id="be-games-save">Save game settings</button></div>`;
    qs('#be-games-save').onclick=async e=>{e.target.disabled=true;const p={};qsa('[data-game-field]').forEach(x=>p[x.dataset.gameField]=Number(x.value));try{await API.post(`/api/guilds/${guildId}/beli/games`,p);toast('Advanced Beli settings saved','ok');loadAdvancedBeliGames();}catch(err){toast(err.message||'Save failed','err');e.target.disabled=false;}};
  }
  loadAdvancedBeliGames();

}

// ══════════════════════════════════════════════════════════
//  VIEW: COMMAND MANAGEMENT — parses the bot's real, currently-registered
//  command definitions (not a hand-maintained list), so this can't drift
//  out of sync. Enforcement lives in DISCOMOD.js's interactionCreate gate;
//  this page only reads/writes gs.disabledCommands, the same data that
//  gate checks on every command run. NOTE ON WHAT "DISABLED" MEANS: this
//  bot registers commands globally (Routes.applicationCommands), not per
//  guild, so a disabled command still appears in the Discord command
//  picker in this server — but running it does nothing and replies that
//  it's disabled here. True per-guild hiding would need per-guild command
//  registration, a much bigger architecture change than this page makes.
// ══════════════════════════════════════════════════════════
const IMPORTANT_PERMISSIONS = new Set(['Administrator', 'Ban Members', 'Kick Members', 'Moderate Members']);

async function renderCommandManager(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading commands…</p></div>`;
  let data;
  try { data = await API.get(`/api/guilds/${guildId}/commands/manage`); } catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'commandmanager');
  let filter = '';

  // Flatten to rows: one per top-level command, one per subcommand — each
  // independently toggleable, matching the doc's "support controlling those
  // where the actual Discord command architecture permits it." Prefix ("!")
  // commands are appended after the slash commands — same disabledCommands
  // map, just keyed with a "!" prefix so e.g. "!ban" and "/ban" toggle
  // independently.
  function buildRows() {
    const rows = [];
    for (const cmd of data.commands) {
      rows.push({ key: cmd.name, label: `/${cmd.name}`, description: cmd.description, permission: cmd.permission, isSub: false });
      for (const sub of cmd.subcommands) {
        const key = sub.group ? `${cmd.name} ${sub.group} ${sub.name}` : `${cmd.name} ${sub.name}`;
        rows.push({ key, label: `/${key}`, description: sub.description, permission: cmd.permission, isSub: true, parent: cmd.name });
      }
    }
    for (const name of (data.prefixCommands || [])) {
      rows.push({ key: `!${name}`, label: `!${name}`, description: '', permission: 'Everyone', isSub: false, isPrefix: true });
    }
    return rows;
  }

  function draw() {
    const rows = buildRows().filter(r => !filter || r.label.toLowerCase().includes(filter) || (r.description || '').toLowerCase().includes(filter));
    content.innerHTML = `
      <div class="content-head"><div><h1>🎚️ Command Management</h1><p>Disable commands for this server only — other servers aren't affected. Commands still globally exist with Discord, but a disabled one refuses to run here.</p></div></div>
      <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
        <input type="text" id="cm-search" placeholder="Search commands…" style="flex:1;min-width:200px;" value="${esc(filter)}">
        <button class="btn btn-ghost btn-sm" id="cm-enable-all">Enable all</button>
        <button class="btn btn-ghost btn-sm" id="cm-disable-all">Disable all</button>
      </div>
      <div class="card">
        ${rows.map(r => {
          const isDisabled = !!data.disabled[r.key];
          return `
          <div class="field-row" style="${r.isSub ? 'padding-left:32px;' : ''}">
            <div style="min-width:0;">
              <div style="font-size:13px;font-family:var(--font-mono);">${esc(r.label)}${r.isPrefix ? ` <span class="badge badge-off" style="font-size:9.5px;">prefix</span>` : ''}</div>
              ${r.description ? `<div style="font-size:11.5px;color:var(--text-faint);margin-top:2px;">${esc(r.description)}</div>` : ''}
              ${!r.isSub && !r.isPrefix ? `<div style="font-size:10.5px;color:var(--text-faint);margin-top:3px;">Requires: ${esc(r.permission)}</div>` : ''}
            </div>
            <label class="switch"><input type="checkbox" data-cmd-key="${esc(r.key)}" data-cmd-perm="${esc(r.permission)}" ${isDisabled ? '' : 'checked'}><span class="slider"></span></label>
          </div>`;
        }).join('') || `<div class="cd-empty" style="padding:20px;">No commands match "${esc(filter)}".</div>`}
      </div>
    `;
    bind();
  }

  async function setDisabled(key, disable) {
    await API.post(`/api/guilds/${guildId}/commands/manage/toggle`, { key, disable });
    if (disable) data.disabled[key] = true; else delete data.disabled[key];
  }

  function bind() {
    qs('#cm-search').addEventListener('input', debounce((e) => { filter = e.target.value.trim().toLowerCase(); draw(); }, 200));
    qsa('[data-cmd-key]').forEach(cb => cb.addEventListener('change', async () => {
      const key = cb.dataset.cmdKey, wantDisable = !cb.checked;
      const label = key.startsWith('!') ? key : `/${key}`;
      if (wantDisable && IMPORTANT_PERMISSIONS.has(cb.dataset.cmdPerm)) {
        if (!confirm(`Disable ${label}?\n\n⚠️ This command requires ${cb.dataset.cmdPerm} — members with that role may lose access to something they rely on in this server.`)) {
          cb.checked = true; return;
        }
      }
      cb.disabled = true;
      try { await setDisabled(key, wantDisable); toast(wantDisable ? `Disabled ${label}` : `Enabled ${label}`, 'ok'); }
      catch (e) { toast(e.message || 'Failed to update', 'err'); cb.checked = !wantDisable; }
      finally { cb.disabled = false; }
    }));
    qs('#cm-enable-all').addEventListener('click', async () => {
      if (!confirm('Enable every command on this server?')) return;
      const keys = buildRows().map(r => r.key);
      try { await API.post(`/api/guilds/${guildId}/commands/manage/bulk`, { keys, disable: false }); data.disabled = {}; toast('All commands enabled', 'ok'); draw(); }
      catch (e) { toast(e.message || 'Failed', 'err'); }
    });
    qs('#cm-disable-all').addEventListener('click', async () => {
      if (!confirm('⚠️ Disable EVERY command on this server, including moderation commands like /ban and /timeout? This is rarely what you want — consider disabling specific commands instead.')) return;
      const keys = buildRows().map(r => r.key);
      try { await API.post(`/api/guilds/${guildId}/commands/manage/bulk`, { keys, disable: true }); keys.forEach(k => data.disabled[k] = true); toast('All commands disabled', 'ok'); draw(); }
      catch (e) { toast(e.message || 'Failed', 'err'); }
    });
  }

  draw();
}

async function renderActivity(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading activity…</p></div>`;
  let data;
  try { data = await API.get(`/api/guilds/${guildId}/activity-log`); } catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'activity');

  content.innerHTML = `
    <div class="content-head"><div><h1>📝 Activity Log</h1><p>Every settings change made from this dashboard, most recent first.</p></div></div>
    ${data.entries.length ? `<div class="card">${data.entries.map(e => `
      <div class="field-row is-col">
        <div style="display:flex;justify-content:space-between;width:100%;align-items:baseline;">
          <span style="font-size:13px;"><span style="color:var(--accent);font-weight:600;">${esc(e.byName || 'Someone')}</span> changed <strong>${esc(e.label)}</strong></span>
          <span class="mono" style="font-size:11px;color:var(--text-faint);flex-shrink:0;">${timeAgo(e.at)}</span>
        </div>
        <div class="mono" style="font-size:11.5px;color:var(--text-faint);margin-top:5px;">${esc(String(e.before))} → <span style="color:var(--text);">${esc(String(e.after))}</span></div>
        ${e.category ? `<span class="badge badge-off" style="margin-top:6px;">${esc(e.category)}</span>` : ''}
      </div>
    `).join('')}</div>` : `<div class="state-block"><h3>No changes logged yet</h3><p>Edit anything in Settings and it'll show up here.</p></div>`}
  `;
}

// ══════════════════════════════════════════════════════════
//  VIEW: BLOX FRUITS CHECKER DATA BROWSER
// ══════════════════════════════════════════════════════════
async function renderBloxFruits(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading checker database…</p></div>`;
  let data;
  try { data = await API.get('/api/bloxfruits/checker'); } catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'bloxfruits');

  const totalEntries = data.categories.reduce((a, c) => a + c.count, 0);
  content.innerHTML = `
    <div class="content-head">
      <div><h1>🍎 Blox Fruits Data</h1><p>${totalEntries.toLocaleString()} tracked names across ${data.categories.length} categories — this is what the moderation checker recognizes.</p></div>
    </div>
    <div class="card" style="padding:16px 20px;margin-bottom:20px;">
      <input type="text" id="bf-search" placeholder="Search fruits, swords, bosses, trinkets, events…">
      <div id="bf-results" style="margin-top:10px;"></div>
    </div>
    <div class="toggle-grid" style="width:100%;">
      ${data.categories.map(c => `<div class="toggle-grid-item"><span>${c.label}</span><span class="mono" style="color:var(--text-faint);">${c.count}</span></div>`).join('')}
    </div>
  `;
  const resultsEl = qs('#bf-results');
  const initialQ = new URLSearchParams(location.search).get('q') || '';
  if (initialQ) { qs('#bf-search').value = initialQ; setTimeout(() => qs('#bf-search').dispatchEvent(new Event('input', { bubbles: true })), 0); }
  qs('#bf-search').addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim();
    if (!q) { resultsEl.innerHTML = ''; return; }
    try {
      const r = await API.get(`/api/bloxfruits/checker?q=${encodeURIComponent(q)}`);
      resultsEl.innerHTML = r.results.length ? r.results.map(m => `
        <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:12.5px;border-top:1px solid var(--border);">
          <span>${esc(m.label)} — ${m.isAlias ? `<code class="mono">${esc(m.match)}</code> → <strong>${esc(m.canonical)}</strong>` : `<strong>${esc(m.match)}</strong>`}</span>
        </div>
      `).join('') : `<p style="color:var(--text-faint);font-size:12.5px;padding-top:8px;">No matches.</p>`;
    } catch { /* ignore transient search errors */ }
  }, 200));
}

// ══════════════════════════════════════════════════════════
//  VIEW: BLOX FRUITS UPDATE 30 REFERENCE
// ══════════════════════════════════════════════════════════
async function renderBloxUpdates(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading Update 30 reference…</p></div>`;
  let data;
  try { data = await API.get('/api/bloxfruits/updates/30'); } catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'bloxupdates');
  const u = data.update;
  content.innerHTML = `
    <div class="content-head"><div><h1>📰 Blox Fruits Update 30</h1><p>Curated reference data kept separate from moderation detection and live stock feeds.</p></div><span class="badge ${u?.status === 'event-ended' ? 'badge-off' : 'badge-on'}">${esc(u?.status || 'UNAVAILABLE')}</span></div>
    ${u ? `<div class="grid-2">
      <div class="card" style="padding:20px;"><div style="font-size:12px;color:var(--text-faint);font-family:var(--font-mono);">${esc(u.version)} • released ${esc(u.releasedAt)}</div><h2 style="margin-top:6px;">${esc(u.emoji)} ${esc(u.title)}</h2><p class="desc" style="margin-top:10px;">${esc(u.summary)}</p><div class="callout" style="margin-top:14px;"><strong>Source</strong><p class="desc" style="margin-top:4px;">${esc(data.source)}</p></div></div>
      <div class="card" style="padding:20px;"><h3>Fruit mutation</h3><div style="font-size:18px;font-weight:600;margin-top:10px;">${u.features.fruitMutations.map(esc).join(', ')}</div><p class="desc" style="margin-top:10px;">Reference metadata only — this section does not fabricate stock or fruit values.</p></div>
    </div>
    <div class="grid-2" style="margin-top:14px;">
      ${Object.entries(u.features).filter(([k])=>k!=='fruitMutations').map(([k,arr])=>`<div class="card" style="padding:18px 20px;"><h3 style="font-size:14px;">${esc(k.replace(/([A-Z])/g,' $1').replace(/^./,x=>x.toUpperCase()))}</h3><div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px;">${arr.map(x=>`<span class="chip">${esc(x)}</span>`).join('')}</div></div>`).join('')}
    </div>
    <div class="card" style="padding:18px 20px;margin-top:14px;"><h3>Mechanics & event lifecycle</h3>${u.mechanics.map(m=>`<div class="field-row"><div><strong>${esc(m.title)}</strong><div class="desc">${esc(m.description)}</div></div><span class="badge ${m.activeDuringEventOnly?'badge-off':'badge-on'}">${m.activeDuringEventOnly?'EVENT ONLY':'ACTIVE'}</span></div>`).join('')}<div class="field-row"><span>Event end</span><strong>${esc(u.eventEndedAt || 'Unknown')}</strong></div></div>` : `<div class="state-block"><h3>Update reference unavailable</h3><p>The local reference module did not return Update 30 data.</p></div>`}
    <div class="card" style="padding:18px 20px;margin-top:14px;"><h3>Search this update</h3><input id="bf-u30-search" placeholder="Search Fiend, Cupid, Lover, Valentine…" style="width:100%;margin-top:10px;"><div id="bf-u30-results" class="desc" style="margin-top:10px;"></div></div>`;
  const out=qs('#bf-u30-results');
  qs('#bf-u30-search')?.addEventListener('input', debounce(async e=>{
    const q=e.target.value.trim(); if(!q){out.textContent='';return;}
    try{const r=await API.get(`/api/bloxfruits/updates/30?q=${encodeURIComponent(q)}`);out.innerHTML=r.update?`<div class="callout"><strong>Match found</strong><p class="desc" style="margin-top:4px;">${esc(r.update.summary)}</p></div>`:`No Update 30 entry matched “${esc(q)}”.`;}catch(err){out.textContent=err.message;}
  },180));
}

// ══════════════════════════════════════════════════════════
//  VIEW: COMMAND REFERENCE
// ══════════════════════════════════════════════════════════
async function renderCommands(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading commands…</p></div>`;
  let data;
  try { data = await API.get('/api/commands'); } catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'commands');

  const draw = (filter = '') => {
    const f = filter.trim().toLowerCase();
    const matchList = (list) => !f ? list : list.filter(c => c.name.toLowerCase().includes(f) || c.desc.toLowerCase().includes(f));
    const slash = matchList(data.slash), message = matchList(data.message);
    qs('#cmd-results').innerHTML = `
      ${slash.length ? `<div class="section-label" style="margin-top:0;">Slash commands (${slash.length})</div><div class="card">${slash.map(c => `
        <div class="field-row"><code class="mono" style="font-size:12.5px;">${esc(c.name)}</code><span style="font-size:12.5px;color:var(--text-muted);text-align:right;max-width:60%;">${esc(c.desc)}</span></div>
      `).join('')}</div>` : ''}
      ${message.length ? `<div class="section-label">Prefix commands (${message.length})</div><div class="card">${message.map(c => `
        <div class="field-row"><code class="mono" style="font-size:12.5px;">${esc(c.name)}</code><span style="font-size:12.5px;color:var(--text-muted);text-align:right;max-width:60%;">${esc(c.desc)}</span></div>
      `).join('')}</div>` : ''}
      ${!slash.length && !message.length ? `<div class="state-block"><h3>No matching commands</h3></div>` : ''}
    `;
  };

  const initialQ = new URLSearchParams(location.search).get('q') || '';
  content.innerHTML = `
    <div class="content-head"><div><h1>⌨️ Commands</h1><p>${data.slash.length + data.message.length} total commands across slash and prefix syntax.</p></div></div>
    <input type="text" id="cmd-search" placeholder="Search commands…" style="width:100%;margin-bottom:18px;" value="${esc(initialQ)}">
    <div id="cmd-results"></div>
  `;
  qs('#cmd-search').addEventListener('input', debounce((e) => draw(e.target.value), 150));
  draw(initialQ);
}

// ══════════════════════════════════════════════════════════
//  COMMAND PALETTE (Cmd/Ctrl+K) — quick jump to any page or settings
//  category without hunting through the sidebar. Only active once a
//  guild is loaded (settingsState or a guild route provides the id).
// ══════════════════════════════════════════════════════════
let paletteGuildId = null;
let paletteSchemaCache = null;   // lazy cache: GET /api/schema is guild-agnostic, fetch once per session
let paletteCommandsCache = null; // lazy cache: GET /api/commands is global, fetch once per session
let paletteCheckerCache = new Map(); // filter -> top checker matches, fetched lazily for search terms >= 3 chars
function ensurePalette() {
  if (qs('#cmdk')) return;
  const wrap = el(`
    <div class="cmdk-backdrop hidden" id="cmdk">
      <div class="cmdk-box">
        <input type="text" id="cmdk-input" placeholder="Search pages, settings, commands… (try “XP”, “scam”, “timeout”)" autocomplete="off">
        <div class="cmdk-results" id="cmdk-results"></div>
        <div class="cmdk-hint">↑↓ to navigate · ↵ to select · esc to close</div>
      </div>
    </div>
  `);
  document.body.appendChild(wrap);
  const input = qs('#cmdk-input'), results = qs('#cmdk-results');
  let items = [], activeIdx = 0;

  // Fire-and-forget: if these land after the box is already open, the next
  // keystroke (or this same one, via draw()'s re-filter) just picks them up —
  // no loading state needed for something this small and this fast.
  if (!paletteSchemaCache && !settingsState?.schema) {
    API.get('/api/schema').then(schema => { paletteSchemaCache = schema; draw(input.value); }).catch(() => {});
  }
  if (!paletteCommandsCache) {
    API.get('/api/commands').then(cmds => { paletteCommandsCache = cmds; draw(input.value); }).catch(() => {});
  }

  function buildItems() {
    const out = [];
    if (paletteGuildId) {
      NAV_ITEMS.forEach(n => out.push({ label: n.label, hint: 'Page', icon: n.icon, go: () => navigate(n.path(paletteGuildId)) }));
      out.push({ label: 'Settings', hint: 'Page', icon: '⚙️', go: () => navigate(`/dashboard/${paletteGuildId}/settings`) });
      out.push({ label: 'Setup wizard', hint: 'Page', icon: '🧭', go: () => navigate(`/dashboard/${paletteGuildId}/setup`) });
      out.push({ label: 'Reaction roles', hint: 'Page', icon: '🎭', go: () => navigate(`/dashboard/${paletteGuildId}/reaction-roles`) });
      const schema = settingsState?.schema || paletteSchemaCache;
      if (schema) {
        schema.forEach(cat => {
          out.push({
            label: cat.category, hint: 'Settings category', icon: cat.icon || '•',
            haystack: cat.category, go: () => navigate(`/dashboard/${paletteGuildId}/settings#${slug(cat.category)}`),
          });
          (cat.fields || []).forEach(field => out.push({
            label: field.label, hint: `Setting · ${cat.category}`, icon: cat.icon || '•',
            haystack: `${field.label} ${field.desc || ''} ${cat.category}`,
            go: () => navigate(`/dashboard/${paletteGuildId}/settings#${slug(cat.category)}`),
          }));
        });
      }
      if (paletteCommandsCache) {
        paletteCommandsCache.slash?.forEach(c => out.push({
          label: c.name, hint: `Command · ${c.category}`, icon: '⌨️',
          haystack: `${c.name} ${c.desc || ''} ${c.category}`,
          go: () => navigate(`/dashboard/${paletteGuildId}/commands?q=${encodeURIComponent(c.name)}`),
        }));
      }
    }
    out.push({ label: 'All servers', hint: 'Page', icon: '←', go: () => navigate('/dashboard') });
    return out;
  }
  function navigate(path) {
    closePalette();
    const [base, hash] = path.split('#');
    if (base === location.pathname + location.search) { if (hash) { location.hash = hash; } return; }
    history.pushState({}, '', base);
    router().then(() => { if (hash) location.hash = hash; });
  }
  async function enrichChecker(filter) {
    const f = String(filter || '').trim().toLowerCase();
    if (!paletteGuildId || f.length < 3 || paletteCheckerCache.has(f)) return;
    try {
      const r = await API.get(`/api/bloxfruits/checker?q=${encodeURIComponent(f)}`);
      paletteCheckerCache.set(f, Array.isArray(r.results) ? r.results.slice(0, 12) : []);
      if (paletteCheckerCache.size > 100) paletteCheckerCache.delete(paletteCheckerCache.keys().next().value);
      if (qs('#cmdk') && !qs('#cmdk').classList.contains('hidden')) draw(filter);
    } catch {}
  }
  function draw(filter = '') {
    const f = filter.trim().toLowerCase();
    items = buildItems().filter(i => !f || (i.haystack || i.label).toLowerCase().includes(f));
    if (f.length >= 3) {
      const hits = paletteCheckerCache.get(f) || [];
      hits.forEach(m => items.push({
        label: `${m.label}: ${m.match}`,
        hint: `Blox Fruits · ${m.isAlias ? `alias → ${m.canonical}` : 'database entry'}`,
        icon: '🍎',
        haystack: `${m.label} ${m.match} ${m.canonical || ''}`,
        go: () => navigate(`/dashboard/${paletteGuildId}/bloxfruits?q=${encodeURIComponent(m.match || f)}`),
      }));
    }
    activeIdx = 0;
    results.innerHTML = items.length
      ? items.map((it, i) => `<div class="cmdk-item ${i === 0 ? 'is-active' : ''}" data-idx="${i}"><span>${it.icon}</span><span class="cmdk-item-label">${esc(it.label)}</span><span class="cmdk-item-hint">${esc(it.hint)}</span></div>`).join('')
      : `<div class="cmdk-empty">No matches</div>`;
    qsa('.cmdk-item', results).forEach(node => {
      node.addEventListener('mouseenter', () => setActive(Number(node.dataset.idx)));
      node.addEventListener('click', () => items[Number(node.dataset.idx)]?.go());
    });
  }
  function setActive(i) {
    activeIdx = Math.max(0, Math.min(items.length - 1, i));
    qsa('.cmdk-item', results).forEach(n => n.classList.toggle('is-active', Number(n.dataset.idx) === activeIdx));
    qsa('.cmdk-item', results)[activeIdx]?.scrollIntoView({ block: 'nearest' });
  }
  input.addEventListener('input', () => { draw(input.value); enrichChecker(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIdx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIdx - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); items[activeIdx]?.go(); }
    else if (e.key === 'Escape') { closePalette(); }
  });
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closePalette(); });
  wrap._draw = draw;
}
function openPalette() {
  ensurePalette();
  const wrap = qs('#cmdk');
  wrap.classList.remove('hidden');
  wrap._draw('');
  setTimeout(() => qs('#cmdk-input')?.focus(), 10);
}
function closePalette() {
  qs('#cmdk')?.classList.add('hidden');
}
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
});

// ══════════════════════════════════════════════════════════
//  VIEW: SETUP WIZARD
// ══════════════════════════════════════════════════════════
async function renderSetupWizard(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading setup wizard…</p></div>`;
  let meta, gs;
  try { [meta, gs] = await Promise.all([API.get(`/api/guilds/${guildId}/meta`), API.get(`/api/guilds/${guildId}/settings`)]); }
  catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const guildInfo = (me.manageableGuilds || []).find(g => g.id === guildId) || { id: guildId, name: 'Server' };
  let step = 0;
  const draft = structuredClone(gs || {});
  draft.commandPrefix = draft.commandPrefix || '!';
  const channelOptions = (selected, allowBlank = true) => `${allowBlank ? '<option value="">— none —</option>' : ''}${meta.channels.filter(c=>c.type===0).map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>#${esc(c.name)}</option>`).join('')}`;
  const roleOptions = (selected) => `<option value="">— none —</option>${meta.roles.map(r=>`<option value="${r.id}" ${r.id===selected?'selected':''}>@${esc(r.name)}</option>`).join('')}`;
  const boolRow = (id,label,desc,key) => `<div class="field-row"><div><div class="field-label">${esc(label)}</div><div class="field-desc">${esc(desc)}</div></div><label class="switch"><input id="${id}" type="checkbox" ${draft[key]?'checked':''} data-wiz-bool="${key}"><span class="switch-track"><span class="switch-thumb"></span></span></label></div>`;
  const steps = [
    { title:'🧭 Welcome', body:()=>`<p class="desc">Set up ${esc(guildInfo.name)} with DISCOMOD. This expanded wizard covers the core operating systems while keeping advanced editors available afterward.</p><div class="card" style="margin-top:14px;padding:16px"><strong>16-step guided setup</strong><p class="desc" style="margin-top:8px">Channels, roles, moderation, verification/CAPTCHA, security, tickets, community forms, welcome, leveling, translation, AI Support, Blox Fruits, Beli, command policy, and final diagnostics.</p></div>` },
    { title:'📍 Core Channels', body:()=>`<div class="card">${[['tradeChannelId','Trade / Trading Channel'],['servicesChannelId','Services Channel'],['gamesHubId','Bot Commands Channel'],['logChannelId','Mod Log Channel'],['appealsChannelId','Appeals Channel']].map(([k,l])=>`<div class="field-row"><span>${l}</span><select data-wiz="${k}">${channelOptions(draft[k])}</select></div>`).join('')}</div>` },
    { title:'🎭 Core Roles', body:()=>`<div class="card">${[['verificationRoleId','Verification Role'],['exiledRoleId','Exiled Role'],['ticketStaffRoleId','Ticket Staff Role']].map(([k,l])=>`<div class="field-row"><span>${l}</span><select data-wiz="${k}">${roleOptions(draft[k])}</select></div>`).join('')}<p class="desc" style="margin-top:8px">Advanced multi-role selectors remain available in their dedicated pages.</p></div>` },
    { title:'🛡️ Moderation', body:()=>`<div class="card">${boolRow('wiz-am','Enable moderation detections','Scam, trade/service, and content detections.', 'automodEnabled')}${boolRow('wiz-scam','Enable scam detection','Use the existing scam/link detection pipeline.', 'scamDetectionEnabled')}${boolRow('wiz-ai','Enable AI-assisted detection','Keep disabled until an AI provider is configured.', 'aiDetectionEnabled')}</div>` },
    { title:'🚨 AutoMod & Enforcement', body:()=>`<div class="card">${boolRow('wiz-edit','Scan edited messages','Re-run supported detection logic when messages are edited.', 'scanEditedMessages')}${boolRow('wiz-noaff','Enable no-affiliation notices','Keep the existing redirect/notice behavior available.', 'noAffiliationNoticesEnabled')}<p class="desc">Use Custom AutoMod and Honeypot for word/regex rules, exemptions, actions and traps.</p></div>` },
    { title:'🔐 Verification', body:()=>`<div class="card">${boolRow('wiz-ver','Enable verification','Enable the server verification gate.', 'verificationEnabled')}<div class="field-row"><span>Verification Role</span><select data-wiz="verificationRoleId">${roleOptions(draft.verificationRoleId)}</select></div><div class="field-row"><span>Verification Channel</span><select data-wiz="verificationChannelId">${channelOptions(draft.verificationChannelId)}</select></div></div>` },
    { title:'🧩 CAPTCHA & Web Verification', body:()=>`<div class="card"><div class="callout"><strong>CAPTCHA is configured separately</strong><p class="desc" style="margin-top:6px">The existing Verification → CAPTCHA editor controls the self-hosted challenge and optional Cloudflare Turnstile settings. Open it after this wizard for challenge count, attempts, timing and provider configuration.</p></div><p class="desc" style="margin-top:10px">This prevents the wizard from creating a second competing CAPTCHA system.</p></div>` },
    { title:'🎫 Tickets', body:()=>`<div class="card">${boolRow('wiz-ticket','Enable ticket system','Allow members to open private support tickets.', 'ticketEnabled')}<div class="field-row"><span>Ticket Category</span><select data-wiz="ticketCategoryId"><option value="">— none —</option>${meta.channels.filter(c=>c.type===4).map(c=>`<option value="${c.id}" ${c.id===draft.ticketCategoryId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div><div class="field-row"><span>Ticket Staff Role</span><select data-wiz="ticketStaffRoleId">${roleOptions(draft.ticketStaffRoleId)}</select></div><div class="field-row"><span>Ticket Log Channel</span><select data-wiz="ticketLogChannelId">${channelOptions(draft.ticketLogChannelId)}</select></div></div>` },
    { title:'👋 Welcome', body:()=>`<div class="card">${boolRow('wiz-welcome','Enable welcome messages','Post a welcome when a member joins.', 'welcomeEnabled')}<div class="field-row"><span>Welcome Channel</span><select data-wiz="welcomeChannelId">${channelOptions(draft.welcomeChannelId)}</select></div><div class="field-row"><span>Welcome Embed/Card</span><select data-wiz="welcomeEmbedEnabled"><option value="true" ${draft.welcomeEmbedEnabled?'selected':''}>Enabled</option><option value="false" ${!draft.welcomeEmbedEnabled?'selected':''}>Disabled</option></select></div></div>` },
    { title:'📈 Leveling', body:()=>`<div class="card">${boolRow('wiz-level','Enable leveling','Award XP using the bot’s existing calculation engine.', 'levelingEnabled')}<div class="field-row"><span>XP Min</span><input type="number" data-wiz="leveling.xpMin" value="${Number(draft.leveling?.xpMin ?? 15)}"></div><div class="field-row"><span>XP Max</span><input type="number" data-wiz="leveling.xpMax" value="${Number(draft.leveling?.xpMax ?? 25)}"></div><div class="field-row"><span>Level-up Channel</span><select data-wiz="leveling.levelUpChannelId">${channelOptions(draft.leveling?.levelUpChannelId)}</select></div></div>` },
    { title:'📋 Applications', body:()=>`<div class="card">${boolRow('wiz-app','Enable applications','Use the existing DM-based application engine.', 'applications.enabled')}<p class="desc">The full application builder, question ordering, DM preview, timers, snooze controls, CAPTCHA policy and analytics live in Community → Applications.</p></div>` },
    { title:'🌐 Translation', body:()=>`<div class="card">${boolRow('wiz-tr','Enable translation commands','Enables the configured /translate and !translate system.', 'translation.enabled')}${boolRow('wiz-auto-tr','Enable auto-translation','Only enable after selecting a provider/key and channel policy.', 'translation.autoEnabled')}<div class="field-row"><span>Default target language</span><input data-wiz="translation.defaultTarget" value="${esc(draft.translation?.defaultTarget || 'en')}"></div></div>` },
    { title:'🤖 AI Support', body:()=>`<div class="card">${boolRow('wiz-support','Enable Dashboard AI Support','This uses the server-owned encrypted BYOK key.', 'aiSupport.enabled')}<p class="desc">AI Support is server-owned BYOK. Keys never return to the browser. Configure provider/model/key in AI Support after finishing.</p></div>` },
    { title:'🍎 Blox Fruits', body:()=>`<div class="card"><div class="field-row"><div><div class="field-label">Blox Fruits stock notifications</div><div class="field-desc">The existing provider is best-effort Normal Dealer stock and reports freshness/source status.</div></div><label class="switch"><input type="checkbox" data-wiz-bool="bfStockNotifyEnabled" ${draft.bfStockNotifyEnabled?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span></label></div><div class="field-row"><span>Stock Channel</span><select data-wiz="bfStockChannelId">${channelOptions(draft.bfStockChannelId)}</select></div><div class="field-row"><span>Stock Role</span><select data-wiz="bfStockRoleId">${roleOptions(draft.bfStockRoleId)}</select></div><p class="desc">Magnet is part of the canonical fruit detector. Mirage remains unavailable unless a real provider is configured.</p></div>` },
    { title:'💰 Beli Economy', body:()=>`<div class="card"><p class="desc">Configure safe economy defaults here; detailed earn/loot/upgrade settings remain in Beli Economy.</p><div class="field-row"><span>Starting Wallet</span><input type="number" data-wiz="beliEconomy.startingWallet" value="${Number(draft.beliEconomy?.startingWallet ?? 500)}"></div><div class="field-row"><span>Starting Bank</span><input type="number" data-wiz="beliEconomy.startingBank" value="${Number(draft.beliEconomy?.startingBank ?? 0)}"></div><div class="field-row"><span>Base Bank Capacity</span><input type="number" data-wiz="beliEconomy.baseBankCapacity" value="${Number(draft.beliEconomy?.baseBankCapacity ?? 5000)}"></div></div>` },
    { title:'⌨️ Command Policy', body:()=>`<div class="card"><p class="desc">Command Management controls per-server runtime enable/disable states. Global registration means a disabled slash command may remain visible in Discord’s picker but will be blocked at runtime.</p><div class="field-row"><span>Command Prefix</span><input data-wiz="commandPrefix" value="${esc(draft.commandPrefix)}" maxlength="8"></div></div>` },
    { title:'✅ Final Review & Finish', body:()=>`<div class="card"><div class="callout"><strong>Final health check</strong><p class="desc" style="margin-top:6px">Finish saves the wizard draft. Afterward, use the specialized dashboard editors for cards, applications, CAPTCHA, tickets, translation, AI Support, Blox Fruits and command management.</p></div><div class="field-row" style="margin-top:12px"><span>Server</span><strong>${esc(guildInfo.name)}</strong></div><div class="field-row"><span>Selected prefix</span><strong>${esc(draft.commandPrefix||'!')}</strong></div></div>` },
  ];
  function setNested(obj,path,value){const parts=path.split('.');let cur=obj;for(let i=0;i<parts.length-1;i++){if(!cur[parts[i]]||typeof cur[parts[i]]!=='object')cur[parts[i]]={};cur=cur[parts[i]];}cur[parts.at(-1)]=value;}
  function renderStep(){ root.innerHTML=`<div class="wizard-wrap"><div class="wizard-steps">${steps.map((_,i)=>`<div class="wizard-step-bar ${i<step?'is-done':''} ${i===step?'is-active':''}"></div>`).join('')}</div><div class="wizard-card"><div class="mono" style="font-size:10px;color:var(--text-faint);margin-bottom:6px">STEP ${step+1} / ${steps.length}</div><h2>${steps[step].title}</h2>${steps[step].body()}<div class="wizard-nav"><button class="btn btn-ghost" id="wiz-back" ${step===0?'disabled':''}>Back</button><button class="btn btn-primary" id="wiz-next">${step===steps.length-1?'Finish setup':'Continue'}</button></div></div></div>`;qsa('[data-wiz]').forEach(e=>e.addEventListener('change',()=>{setNested(draft,e.dataset.wiz,e.type==='checkbox'?e.checked:e.value);}));qsa('[data-wiz-bool]').forEach(e=>e.addEventListener('change',()=>{setNested(draft,e.dataset.wizBool,e.checked);}));qs('#wiz-back').onclick=()=>{step=Math.max(0,step-1);renderStep()};qs('#wiz-next').onclick=async()=>{const b=qs('#wiz-next');b.disabled=true;try{if(step===steps.length-1){await API.post(`/api/guilds/${guildId}/settings`,draft);await API.post(`/api/guilds/${guildId}/setup/complete`,{enableDetections:draft.automodEnabled!==false});toast('Setup completed','ok');history.pushState({},'',`/dashboard/${guildId}`);router();return;}if(step===1){await API.post(`/api/guilds/${guildId}/settings`,draft);}step++;renderStep();}catch(e){toast(e.message,'err');b.disabled=false;}}; }
  renderStep();
}

// ══════════════════════════════════════════════════════════
//  VIEW: REACTION ROLES
// ══════════════════════════════════════════════════════════
async function renderReactionRoles(root, guildId, me) {
  root.innerHTML = `<div class="state-block"><div class="spinner"></div><p>Loading…</p></div>`;
  let gs, meta;
  try {
    [gs, meta] = await Promise.all([
      API.get(`/api/guilds/${guildId}/settings`),
      API.get(`/api/guilds/${guildId}/meta`),
    ]);
  } catch (e) { root.innerHTML = errorBlock(e.message); return; }
  const { content } = renderGuildShell(root, guildId, me, 'reaction-roles');
  const rolesById = Object.fromEntries(meta.roles.map(r => [r.id, r.name]));

  function draw() {
    const bindings = gs.reactionRoles || {};
    const msgIds = Object.keys(bindings);
    content.innerHTML = `
        <div class="content-head">
          <div><h1>🎭 Reaction roles</h1><p>React to a message with an emoji to hand out a role automatically.</p></div>
        </div>
        <div class="card" style="padding:20px;margin-bottom:24px;">
          <h3 style="margin-bottom:14px;font-size:14.5px;">Add a binding</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <input type="text" id="rr-channel" placeholder="Channel ID">
            <input type="text" id="rr-message" placeholder="Message ID">
            <input type="text" id="rr-emoji" placeholder="Emoji (e.g. 🍎 or :name:)">
            <select id="rr-role"><option value="">Select a role…</option>${meta.roles.map(r => `<option value="${r.id}">@${esc(r.name)}</option>`).join('')}</select>
          </div>
          <button class="btn btn-primary" id="rr-add" style="margin-top:14px;">Add binding</button>
          <p class="array-hint" style="margin-top:8px;">The bot must already be able to see that message and have permission to add reactions.</p>
        </div>
        ${msgIds.length ? msgIds.map(msgId => `
          <div class="card">
            <div style="padding:12px 16px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-faint);" class="mono">Message ${esc(msgId)}</div>
            ${bindings[msgId].map((b, i) => `
              <div class="field-row rr-binding">
                <span class="rr-emoji">${esc(b.emoji)}</span>
                <span class="rr-arrow">→</span>
                <span class="rr-meta">@${esc(rolesById[b.roleId] || b.roleId)}</span>
                <button class="btn btn-danger btn-sm" data-rr-remove="${msgId}:${i}" style="margin-left:auto;">Remove</button>
              </div>`).join('')}
          </div>
        `).join('') : `<div class="state-block"><h3>No reaction roles yet</h3><p>Add your first binding above.</p></div>`}
    `;

    qs('#rr-add').addEventListener('click', async () => {
      const channelId = qs('#rr-channel').value.trim();
      const messageId = qs('#rr-message').value.trim();
      const emoji = qs('#rr-emoji').value.trim();
      const roleId = qs('#rr-role').value;
      if (!channelId || !messageId || !emoji || !roleId) { toast('Fill in every field first', 'err'); return; }
      try {
        await API.post(`/api/guilds/${guildId}/reaction-roles`, { channelId, messageId, emoji, roleId });
        gs.reactionRoles = gs.reactionRoles || {};
        gs.reactionRoles[messageId] = gs.reactionRoles[messageId] || [];
        gs.reactionRoles[messageId].push({ emoji, roleId });
        toast('Reaction role added', 'ok');
        draw();
      } catch (e) { toast(e.message || 'Could not add binding', 'err'); }
    });

    qsa('[data-rr-remove]').forEach(btn => btn.addEventListener('click', async () => {
      const [msgId, idx] = btn.dataset.rrRemove.split(':');
      try {
        await API.del(`/api/guilds/${guildId}/reaction-roles/${msgId}/${idx}`);
        gs.reactionRoles[msgId].splice(Number(idx), 1);
        if (!gs.reactionRoles[msgId].length) delete gs.reactionRoles[msgId];
        toast('Removed', 'ok');
        draw();
      } catch (e) { toast(e.message || 'Could not remove binding', 'err'); }
    }));
  }
  draw();
}

// ══════════════════════════════════════════════════════════
//  VERIFY MODE — public, unauthenticated /verify/:token page.
//  Reuses esc()/initials() from above rather than redefining them (this
//  used to be a fully separate verify-public/script.js; merged here so
//  there's one script.js instead of two, per explicit request — the
//  scoping below is what keeps it from actually colliding with the admin
//  app it now shares a file with).
// ══════════════════════════════════════════════════════════
function renderVerifyError(card, message) {
  card.innerHTML = `
    <div class="state-error">
      <div class="icon">⚠️</div>
      <h1>Verification unavailable</h1>
      <p class="desc">${esc(message)}</p>
    </div>
  `;
}
function renderVerifySuccess(card, guildName) {
  card.innerHTML = `
    <div class="state-success">
      <div class="icon">✅</div>
      <h1>You're verified!</h1>
      <p class="desc">You now have full access to <strong>${esc(guildName)}</strong>. You can close this tab and head back to Discord.</p>
    </div>
  `;
}

// Renders one CAPTCHA shape as an SVG element wrapped in a keyboard-focusable
// <g> (role="button", tabindex, Enter/Space activate it) so the visual
// challenge isn't mouse/touch-only — a screen-reader user still has the
// text-challenge toggle as the real accessible path, but this at least
// keeps keyboard-only (non-screen-reader) users from being mouse-locked.
function regularPolygonPoints(cx, cy, r, sides, rotationDeg) {
  const pts = [];
  const rot = (rotationDeg - 90) * Math.PI / 180;
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI / sides);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}
function starPoints(cx, cy, rOuter, rInner, rotationDeg) {
  const pts = [];
  const rot = (rotationDeg - 90) * Math.PI / 180;
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = rot + (i * Math.PI / 5);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}
function shapeToSvgMarkup(s) {
  const label = `${esc(s.colorName)} ${esc(s.type)}`;
  const common = `data-shape-id="${esc(s.id)}" tabindex="0" role="button" aria-label="${label}" class="captcha-shape" fill="${esc(s.colorHex)}"`;
  let inner;
  if (s.type === 'circle') inner = `<circle cx="${s.x}" cy="${s.y}" r="${s.size}" ${common}></circle>`;
  else if (s.type === 'square') inner = `<rect x="${s.x - s.size}" y="${s.y - s.size}" width="${s.size * 2}" height="${s.size * 2}" transform="rotate(${s.rotation} ${s.x} ${s.y})" ${common}></rect>`;
  else if (s.type === 'triangle') inner = `<polygon points="${regularPolygonPoints(s.x, s.y, s.size, 3, s.rotation)}" ${common}></polygon>`;
  else if (s.type === 'pentagon') inner = `<polygon points="${regularPolygonPoints(s.x, s.y, s.size, 5, s.rotation)}" ${common}></polygon>`;
  else if (s.type === 'hexagon') inner = `<polygon points="${regularPolygonPoints(s.x, s.y, s.size, 6, s.rotation)}" ${common}></polygon>`;
  else inner = `<polygon points="${starPoints(s.x, s.y, s.size, s.size * 0.45, s.rotation)}" ${common}></polygon>`;
  return inner;
}

async function runVerifyPage() {
  // This mode builds its own DOM from scratch (rather than relying on markup
  // baked into the shared index.html) so the shell stays identical for both
  // modes and neither one has to ship dead markup for the other.
  document.body.classList.add('verify-mode');
  document.body.innerHTML = `
    <div class="bg-layer" id="bg-layer"></div>
    <div class="verify-scrim"></div>
    <main class="verify-card" id="card">
      <div class="state-loading"><div class="spinner"></div><p>Loading…</p></div>
    </main>
    <button class="music-toggle hidden" id="music-toggle" type="button" aria-label="Toggle background music">🔇</button>
    <audio id="bg-audio" loop preload="none"></audio>
  `;

  const token = location.pathname.split('/').filter(Boolean).pop();
  const card = document.getElementById('card');
  if (!token) { renderVerifyError(card, 'No verification token found in the link. Go back to Discord and click Verify again.'); return; }

  let meta;
  try {
    const res = await fetch(`/api/verify/${encodeURIComponent(token)}/meta`);
    meta = await res.json();
    if (!res.ok) { renderVerifyError(card, meta.error || 'This link is invalid or has expired.'); return; }
  } catch {
    renderVerifyError(card, 'Could not reach the verification server. Check your connection and try again.');
    return;
  }

  // Apply customization
  document.documentElement.style.setProperty('--accent', meta.accentColor || '#2DE0C4');
  if (meta.backgroundUrl) {
    document.getElementById('bg-layer').style.backgroundImage = `url("${meta.backgroundUrl.replace(/"/g, '')}")`;
  }
  if (meta.musicUrl) {
    const audio = document.getElementById('bg-audio');
    const toggle = document.getElementById('music-toggle');
    audio.src = meta.musicUrl;
    toggle.classList.remove('hidden');
    let playing = false;
    toggle.addEventListener('click', () => {
      playing = !playing;
      if (playing) { audio.volume = 0.4; audio.play().catch(() => { playing = false; toggle.textContent = '🔇'; }); toggle.textContent = '🔊'; }
      else { audio.pause(); toggle.textContent = '🔇'; }
    });
  }
  document.title = meta.title || 'Verify';

  const iconHtml = meta.guildIconUrl
    ? `<img class="verify-guild-icon" src="${esc(meta.guildIconUrl)}" alt="">`
    : `<div class="verify-guild-icon-fallback">${esc(initials(meta.guildName))}</div>`;

  card.innerHTML = `
    ${iconHtml}
    <h1>${esc(meta.title)}</h1>
    <p class="desc">${esc(meta.description)}</p>
    ${meta.interactiveCaptcha ? `<div class="captcha-wrap" id="captcha-wrap"></div>` : ''}
    ${meta.turnstileEnabled ? `<div class="turnstile-wrap" id="turnstile-wrap"></div>` : (!meta.interactiveCaptcha ? `<div class="turnstile-notice">⚠️ CAPTCHA is not configured by this server's staff — this link alone is your verification.</div>` : '')}
    <div class="inline-error hidden" id="inline-error"></div>
    <button class="btn-verify" id="verify-btn" type="button">Verify</button>
    <p class="footnote">Link expires 15 minutes after it was generated · one use only</p>
  `;

  const btn = document.getElementById('verify-btn');
  const inlineError = document.getElementById('inline-error');
  let widgetId = null;
  let interactiveCaptchaDone = !meta.interactiveCaptcha; // true (i.e. "nothing to wait on") when not required at all
  let turnstileDone = !meta.turnstileEnabled;
  const refreshVerifyButton = () => { btn.disabled = !(interactiveCaptchaDone && turnstileDone); };

  // ── Interactive (self-hosted) CAPTCHA ──────────────────────────────────
  if (meta.interactiveCaptcha) {
    interactiveCaptchaDone = (meta.interactiveCaptcha.passed || 0) >= meta.interactiveCaptcha.required;
    const wrap = document.getElementById('captcha-wrap');
    let currentChallengeToken = null;
    let currentCorrectId = null; // never trust this client-side for scoring — server re-validates; only used to disable the just-clicked shape's own re-click during the brief round-trip
    let timerInterval = null;
    let textMode = false;

    function renderLocked(secondsLeft) {
      if (timerInterval) clearInterval(timerInterval);
      wrap.innerHTML = `<div class="captcha-locked">🔒 Too many incorrect attempts. Try again in <span id="captcha-lock-secs">${secondsLeft}</span>s.</div>`;
      let s = secondsLeft;
      timerInterval = setInterval(() => {
        s--;
        const el = document.getElementById('captcha-lock-secs');
        if (el) el.textContent = s;
        if (s <= 0) { clearInterval(timerInterval); loadChallenge(); }
      }, 1000);
    }

    function renderDone() {
      if (timerInterval) clearInterval(timerInterval);
      wrap.innerHTML = `<div class="captcha-done">✅ Challenge${meta.interactiveCaptcha.required > 1 ? 's' : ''} complete.</div>`;
      interactiveCaptchaDone = true;
      refreshVerifyButton();
    }

    async function loadChallenge() {
      wrap.innerHTML = `<div class="captcha-loading">Loading challenge…</div>`;
      let data;
      try {
        const res = await fetch(`/api/verify/${encodeURIComponent(token)}/captcha/new`);
        data = await res.json();
        if (!res.ok) {
          if (res.status === 429 && data.lockedUntil) { renderLocked(Math.ceil((data.lockedUntil - Date.now()) / 1000)); return; }
          wrap.innerHTML = `<div class="captcha-error">${esc(data.error || 'Could not load a challenge.')}</div>`;
          return;
        }
      } catch { wrap.innerHTML = `<div class="captcha-error">Network error loading the challenge. Refresh to try again.</div>`; return; }

      currentChallengeToken = data.challengeToken;
      currentCorrectId = null;
      renderChallenge(data);
    }

    function renderChallenge(data) {
      if (timerInterval) clearInterval(timerInterval);
      const shapesHtml = data.shapes.map(s => shapeToSvgMarkup(s)).join('');
      wrap.innerHTML = `
        <p class="captcha-progress">Challenge ${data.progress.current} of ${data.progress.total}</p>
        <p class="captcha-prompt">${esc(data.promptText)}</p>
        <svg class="captcha-svg" viewBox="0 0 ${data.canvasWidth} ${data.canvasHeight}" role="img" aria-label="${esc(data.promptText)}">${shapesHtml}</svg>
        <p class="captcha-timer">Time left: <span id="captcha-secs">${data.timeLimitSec}</span>s</p>
        <button type="button" class="captcha-alt-toggle" id="captcha-alt-toggle">${textMode ? 'Switch back to clicking the image' : 'Having trouble seeing the image? Use a text challenge instead'}</button>
        ${textMode ? `
          <div class="captcha-text-mode">
            <label for="captcha-text-input">Type the answer described above (e.g. "${esc(data.promptText.replace(/^Click /, '').replace(/\.$/, ''))}"):</label>
            <input type="text" id="captcha-text-input" autocomplete="off">
            <button type="button" class="btn-verify" id="captcha-text-submit">Submit answer</button>
          </div>` : ''}
      `;

      let secs = data.timeLimitSec;
      timerInterval = setInterval(() => {
        secs--;
        const el = document.getElementById('captcha-secs');
        if (el) el.textContent = secs;
        if (secs <= 0) { clearInterval(timerInterval); loadChallenge(); } // silently refresh — the server treats an expired token as a normal wrong-answer-free timeout, not a strike
      }, 1000);

      document.getElementById('captcha-alt-toggle').addEventListener('click', () => { textMode = !textMode; renderChallenge(data); });

      if (textMode) {
        document.getElementById('captcha-text-submit').addEventListener('click', () => {
          const val = document.getElementById('captcha-text-input').value;
          submitAnswer({ textAnswer: val });
        });
        document.getElementById('captcha-text-input').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') submitAnswer({ textAnswer: e.target.value });
        });
      } else {
        wrap.querySelectorAll('[data-shape-id]').forEach(el => {
          el.addEventListener('click', () => submitAnswer({ shapeId: el.dataset.shapeId }));
          el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); submitAnswer({ shapeId: el.dataset.shapeId }); } });
        });
      }
    }

    async function submitAnswer(answer) {
      if (!currentChallengeToken) return;
      const tokenToSubmit = currentChallengeToken;
      currentChallengeToken = null; // prevent double-submit while the request is in flight
      let data;
      try {
        const res = await fetch(`/api/verify/${encodeURIComponent(token)}/captcha/answer`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ challengeToken: tokenToSubmit, ...answer }),
        });
        data = await res.json();
        if (!res.ok) {
          if (res.status === 429 && data.lockedUntil) { renderLocked(Math.ceil((data.lockedUntil - Date.now()) / 1000)); return; }
          // Wrong answer (or an expired one) — just load a fresh challenge with the error shown briefly.
          loadChallenge();
          return;
        }
      } catch { wrap.innerHTML = `<div class="captcha-error">Network error submitting your answer. Refresh to try again.</div>`; return; }
      if (data.done) renderDone(); else loadChallenge();
    }

    if (meta.interactiveCaptcha.lockedUntil) renderLocked(Math.ceil((meta.interactiveCaptcha.lockedUntil - Date.now()) / 1000));
    else if (!interactiveCaptchaDone) loadChallenge();
    else renderDone();
  }

  if (meta.turnstileEnabled) {
    btn.disabled = true;
    // Turnstile's script tag is async — poll briefly for window.turnstile
    // rather than assuming load order against our own script.
    const waitForTurnstile = () => new Promise(resolve => {
      if (window.turnstile) return resolve();
      const iv = setInterval(() => { if (window.turnstile) { clearInterval(iv); resolve(); } }, 100);
      setTimeout(() => { clearInterval(iv); resolve(); }, 8000); // give up waiting after 8s either way
    });
    await waitForTurnstile();
    if (window.turnstile) {
      widgetId = window.turnstile.render('#turnstile-wrap', {
        sitekey: meta.turnstileSiteKey,
        theme: 'dark',
        callback: () => { turnstileDone = true; refreshVerifyButton(); },
        'expired-callback': () => { turnstileDone = false; refreshVerifyButton(); },
        'error-callback': () => { turnstileDone = false; refreshVerifyButton(); },
      });
    } else {
      document.getElementById('turnstile-wrap').outerHTML = `<div class="turnstile-notice">⚠️ CAPTCHA failed to load. Refresh the page and try again.</div>`;
    }
  }
  refreshVerifyButton();

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Verifying…';
    inlineError.classList.add('hidden');
    const turnstileToken = widgetId !== null && window.turnstile ? window.turnstile.getResponse(widgetId) : null;
    try {
      const res = await fetch(`/api/verify/${encodeURIComponent(token)}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnstileToken }),
      });
      const result = await res.json();
      if (!res.ok) {
        // A dead token (expired/already used) can't be retried here no matter
        // what the person does next — that's a real dead end, so it gets the
        // full-card explanation. Anything else (bad/expired captcha, a
        // network blip) is retryable in place.
        if (res.status === 410) { renderVerifyError(card, result.error || 'This link is no longer valid.'); return; }
        btn.disabled = false; btn.textContent = 'Verify';
        if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId);
        inlineError.textContent = result.error || 'Verification failed. Please try again.';
        inlineError.classList.remove('hidden');
        return;
      }
      renderVerifySuccess(card, meta.guildName);
    } catch {
      btn.disabled = false; btn.textContent = 'Verify';
      inlineError.textContent = 'Network error — please try again.';
      inlineError.classList.remove('hidden');
    }
  });
}

// ══════════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════════
// Verify mode branches BEFORE the admin router ever runs — a member opening
// a verify link has no session and no business loading the admin SPA's
// code paths at all, so this is a hard fork, not just a route in router().
if (location.pathname.startsWith('/verify/')) {
  runVerifyPage();
} else {
  router();
}