// ════════════════════════════════════════════════════════════════════════
//  card_renderer.js — DISCOMOD layered card renderer
//
//  Renders rank cards, level-up cards, and welcome cards from a JSON
//  "layer schema" — the same shape the dashboard's Visual Editor edits.
//  This keeps the bot and the dashboard preview pixel-identical: both
//  walk the same layer array and draw the same primitives.
//
//  Layer types: background, avatar, shape, text, progress, activityStats
// ════════════════════════════════════════════════════════════════════════

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');

// ── Font registration ──────────────────────────────────────────────────
// Ship 2-3 weights so text layers can pick 'regular' | 'medium' | 'bold'.
// Falls back silently (system default) if the font files aren't present —
// keeps this from hard-crashing on a fresh checkout before assets are added.
const FONT_DIR = path.join(__dirname, 'assets', 'fonts');
const FONT_FAMILY = 'Inter';
try {
    if (fs.existsSync(path.join(FONT_DIR, 'Inter-Regular.ttf')))
        GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Inter-Regular.ttf'), 'Inter');
    if (fs.existsSync(path.join(FONT_DIR, 'Inter-Medium.ttf')))
        GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Inter-Medium.ttf'), 'Inter Medium');
    if (fs.existsSync(path.join(FONT_DIR, 'Inter-Bold.ttf')))
        GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Inter-Bold.ttf'), 'Inter Bold');
} catch (_) { /* fonts optional at dev time */ }

const FONT_WEIGHT_MAP = { regular: 'Inter', medium: 'Inter Medium', bold: 'Inter Bold' };

// ── Default schema: Rank Card (global leveling card, per-user) ──────────
// Mirrors the reference layout: dark card, left avatar column with a
// colored strip, right column with nickname/discriminator, progress bar
// + XP text, level pill, and a stats pill row (messages / voice / reactions).
const DEFAULT_RANK_CARD_SCHEMA = {
    width: 934, height: 282, cornerRadius: 24,
    layers: [
        { id: 'background', type: 'background', name: 'Background', color: '#12151B', imageUrl: null, opacity: 1 },
        { id: 'leftStrip', type: 'shape', name: 'Left Strip', shape: 'rect', x: 0, y: 0, w: 210, h: 282, color: '#1A1E26', radius: [24, 0, 0, 24] },
        { id: 'avatar', type: 'avatar', name: 'Avatar', x: 40, y: 40, size: 130, shape: 'circle', borderWidth: 0, borderColor: '#5865F2' },
        { id: 'handle', type: 'text', name: 'Handle', x: 40, y: 190, w: 170, text: '{username}', font: 'bold', size: 26, color: '#FFFFFF', align: 'center', maxLines: 1, truncate: true },
        { id: 'levelPillBase', type: 'shape', name: 'Level Pill Base', shape: 'rect', x: 40, y: 226, w: 170, h: 40, color: '#252A33', radius: 10 },
        { id: 'levelPillText', type: 'text', name: 'Level Pill Text', x: 40, y: 226, w: 170, h: 40, text: 'Level {level}', font: 'bold', size: 17, color: '#FFFFFF', align: 'center', valign: 'middle' },
        { id: 'displayName', type: 'text', name: 'Display Name', x: 240, y: 44, text: '{displayName}', font: 'bold', size: 40, color: '#FFFFFF', align: 'left', maxWidth: 550, truncate: true },
        { id: 'rank', type: 'text', name: 'Rank', x: 894, y: 44, text: '#{rank}', font: 'bold', size: 34, color: '#FFFFFF', align: 'right' },
        { id: 'progressLabel', type: 'text', name: 'Progress Label', x: 240, y: 128, text: 'Progress {progressPct}%', font: 'medium', size: 18, color: '#B7C0CC', align: 'left' },
        { id: 'xpText', type: 'text', name: 'XP Text', x: 894, y: 128, text: '{xp} / {xpNeeded} XP', font: 'medium', size: 18, color: '#B7C0CC', align: 'right' },
        { id: 'progressBar', type: 'progress', name: 'Progress Bar', x: 240, y: 158, w: 654, h: 24, radius: 12, trackColor: '#252A33', fillColor: '#FFFFFF', fillGradientTo: null },
        { id: 'activityStats', type: 'activityStats', name: 'Activity Stats', x: 240, y: 202, w: 654, h: 56, radius: 12, color: '#1D2129', textColor: '#B7C0CC', iconColor: '#B7C0CC', size: 16,
          stats: [
              { icon: 'message', key: 'messages' },
              { icon: 'mic', key: 'voiceTime' },
              { icon: 'reaction', key: 'reactions' },
          ] },
    ],
};

// ── Default schema: Level-Up Card (posted on level-up events) ───────────
// Same visual language as the rank card but square-ish and celebratory —
// bigger avatar, bold "LEVEL UP" label, old→new level, no XP bar clutter.
const DEFAULT_LEVELUP_CARD_SCHEMA = {
    width: 700, height: 260, cornerRadius: 24,
    layers: [
        { id: 'background', type: 'background', name: 'Background', color: '#12151B', imageUrl: null, opacity: 1 },
        { id: 'accentGlow', type: 'shape', name: 'Accent Glow', shape: 'rect', x: 0, y: 0, w: 700, h: 6, color: '#2DE0C4', radius: 0 },
        { id: 'avatar', type: 'avatar', name: 'Avatar', x: 48, y: 60, size: 140, shape: 'circle', borderWidth: 4, borderColor: '#2DE0C4' },
        { id: 'kicker', type: 'text', name: 'Kicker', x: 224, y: 62, text: 'LEVEL UP', font: 'bold', size: 16, color: '#2DE0C4', align: 'left', letterSpacing: 2 },
        { id: 'displayName', type: 'text', name: 'Display Name', x: 224, y: 92, text: '{displayName}', font: 'bold', size: 34, color: '#FFFFFF', align: 'left', maxWidth: 430, truncate: true },
        { id: 'levelTransition', type: 'text', name: 'Level Transition', x: 224, y: 148, text: 'Level {prevLevel}  →  Level {level}', font: 'medium', size: 24, color: '#B7C0CC', align: 'left' },
    ],
};

// ── Default schema: Welcome Card (posted on member join) ────────────────
const DEFAULT_WELCOME_CARD_SCHEMA = {
    width: 900, height: 320, cornerRadius: 24,
    layers: [
        { id: 'background', type: 'background', name: 'Background', color: '#12151B', imageUrl: null, opacity: 1 },
        { id: 'avatarRing', type: 'shape', name: 'Avatar Ring', shape: 'circle', x: 350, y: 40, w: 200, h: 200, color: 'transparent', borderWidth: 4, borderColor: '#5865F2', radius: 100 },
        { id: 'avatar', type: 'avatar', name: 'Avatar', x: 360, y: 50, size: 180, shape: 'circle', borderWidth: 0, borderColor: null },
        { id: 'kicker', type: 'text', name: 'Kicker', x: 450, y: 250, text: 'WELCOME TO {server}', font: 'medium', size: 15, color: '#8DA0AC', align: 'center', letterSpacing: 2 },
        { id: 'displayName', type: 'text', name: 'Display Name', x: 450, y: 274, text: '{displayName}', font: 'bold', size: 30, color: '#FFFFFF', align: 'center', maxWidth: 700, truncate: true },
        { id: 'memberCount', type: 'text', name: 'Member Count', x: 450, y: 306, text: "You're member #{count}", font: 'regular', size: 15, color: '#5F6E79', align: 'center' },
    ],
};

// ── Default schema: Leave Card (posted on member leave) ────────────────
const DEFAULT_LEAVE_CARD_SCHEMA = {
    width: 900, height: 320, cornerRadius: 24,
    layers: [
        { id: 'background', type: 'background', name: 'Background', color: '#12151B', imageUrl: null, opacity: 1 },
        { id: 'avatarRing', type: 'shape', name: 'Avatar Ring', shape: 'circle', x: 350, y: 40, w: 200, h: 200, color: 'transparent', borderWidth: 4, borderColor: '#FF667A', radius: 100 },
        { id: 'avatar', type: 'avatar', name: 'Avatar', x: 360, y: 50, size: 180, shape: 'circle', borderWidth: 0, borderColor: null },
        { id: 'kicker', type: 'text', name: 'Kicker', x: 0, y: 204, w: 900, text: 'GOODBYE', font: 'bold', size: 16, color: '#FF667A', align: 'center', letterSpacing: 2 },
        { id: 'displayName', type: 'text', name: 'Display Name', x: 60, y: 234, w: 780, text: '{displayName}', font: 'bold', size: 34, color: '#FFFFFF', align: 'center', maxLines: 1, truncate: true },
        { id: 'server', type: 'text', name: 'Server', x: 60, y: 278, w: 780, text: 'Left {server} · {count} members remain', font: 'medium', size: 18, color: '#B7C0CC', align: 'center', maxLines: 1, truncate: true },
    ],
};

// ── Default schema: Blox Fruits Stock Card (posted on stock-change) ────
// Uses the same layer/schema architecture as rank/level-up/welcome — the
// only new piece is the 'fruitList' layer type below, since the fruit
// count varies tick to tick and none of the existing layer types render a
// variable-length list. Everything else (background, title, footer) reuses
// existing layer types unchanged.
const DEFAULT_STOCK_CARD_SCHEMA = {
    width: 700, height: 430, cornerRadius: 24,
    layers: [
        { id: 'background', type: 'background', name: 'Background', color: '#12151B', imageUrl: null, opacity: 1 },
        { id: 'accentGlow', type: 'shape', name: 'Accent Glow', shape: 'rect', x: 0, y: 0, w: 700, h: 6, color: '#FF6B35', radius: 0 },
        { id: 'title', type: 'text', name: 'Title', x: 32, y: 30, text: '🍎 Blox Fruits — Normal Dealer Stock', font: 'bold', size: 24, color: '#FFFFFF', align: 'left' },
        { id: 'currentHeading', type: 'text', name: 'Current Heading', x: 32, y: 64, text: 'Current Stock', font: 'bold', size: 14, color: '#FFB08A', align: 'left' },
        { id: 'fruitRows', type: 'fruitList', name: 'Fruit List', x: 32, y: 84, w: 636, h: 172, size: 16, color: '#FFFFFF', chipColor: '#1D2129', chipRadius: 10 },
        { id: 'previousHeading', type: 'text', name: 'Previous Heading', x: 32, y: 270, text: 'Previous Stock', font: 'bold', size: 14, color: '#8DA0AC', align: 'left' },
        { id: 'previousRows', type: 'fruitList', name: 'Previous Stock', x: 32, y: 292, w: 636, h: 72, size: 13, color: '#B7C0CC', chipColor: '#1A2028', chipRadius: 8 },
        { id: 'footer', type: 'text', name: 'Footer', x: 32, y: 390, text: 'Last confirmed {lastUpdated}{staleWarning}', font: 'regular', size: 13, color: '#5F6E79', align: 'left', maxWidth: 636, truncate: true },
    ],
};

// ── Utility: rounded-rect path ───────────────────────────────────────────
function roundRectPath(ctx, x, y, w, h, radius) {
    let r = radius;
    if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
    else r = { tl: r[0] ?? 0, tr: r[1] ?? 0, br: r[2] ?? 0, bl: r[3] ?? 0 };
    ctx.beginPath();
    ctx.moveTo(x + r.tl, y);
    ctx.lineTo(x + w - r.tr, y);
    ctx.arcTo(x + w, y, x + w, y + r.tr, r.tr);
    ctx.lineTo(x + w, y + h - r.br);
    ctx.arcTo(x + w, y + h, x + w - r.br, y + h, r.br);
    ctx.lineTo(x + r.bl, y + h);
    ctx.arcTo(x, y + h, x, y + h - r.bl, r.bl);
    ctx.lineTo(x, y + r.tl);
    ctx.arcTo(x, y, x + r.tl, y, r.tl);
    ctx.closePath();
}

// ── Utility: template substitution ({user}, {level}, etc.) ──────────────
function fillTemplate(str, data) {
    if (typeof str !== 'string') return str;
    return str.replace(/\{(\w+)\}/g, (m, key) => (key in data ? String(data[key]) : m));
}

// ── Utility: truncate text to fit maxWidth, appending an ellipsis ───────
function truncateToWidth(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const candidate = text.slice(0, mid) + '…';
        if (ctx.measureText(candidate).width <= maxWidth) lo = mid; else hi = mid - 1;
    }
    return text.slice(0, lo) + '…';
}

function setFont(ctx, layer) {
    const weight = FONT_WEIGHT_MAP[layer.font] || FONT_WEIGHT_MAP.regular;
    ctx.font = `${layer.size || 16}px "${weight}", "${FONT_FAMILY}", sans-serif`;
}

// ── Icon glyphs for activity stats (simple vector icons, no image assets needed) ──
function drawStatIcon(ctx, icon, cx, cy, size, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.5, size * 0.12);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const s = size;
    switch (icon) {
        case 'message': {
            roundRectPath(ctx, cx - s / 2, cy - s / 2.6, s, s * 0.75, s * 0.22);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx - s * 0.15, cy + s * 0.22);
            ctx.lineTo(cx - s * 0.3, cy + s * 0.45);
            ctx.lineTo(cx + s * 0.05, cy + s * 0.22);
            ctx.closePath();
            ctx.fill();
            break;
        }
        case 'mic': {
            roundRectPath(ctx, cx - s * 0.18, cy - s / 2, s * 0.36, s * 0.6, s * 0.18);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(cx, cy + s * 0.08, s * 0.34, 0.15 * Math.PI, 0.85 * Math.PI, false);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx, cy + s * 0.42);
            ctx.lineTo(cx, cy + s * 0.5);
            ctx.moveTo(cx - s * 0.16, cy + s * 0.5);
            ctx.lineTo(cx + s * 0.16, cy + s * 0.5);
            ctx.stroke();
            break;
        }
        case 'reaction': {
            ctx.beginPath();
            ctx.arc(cx, cy, s / 2, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(cx, cy + s * 0.05, s * 0.28, 0.15 * Math.PI, 0.85 * Math.PI, false);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(cx - s * 0.16, cy - s * 0.14, s * 0.05, 0, Math.PI * 2);
            ctx.arc(cx + s * 0.16, cy - s * 0.14, s * 0.05, 0, Math.PI * 2);
            ctx.fill();
            break;
        }
        default: {
            ctx.beginPath();
            ctx.arc(cx, cy, s / 3, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
    ctx.restore();
}

const STAT_LABEL = {
    messages: (v) => `${formatCompact(v)}`,
    voiceTime: (v) => formatDuration(v),
    reactions: (v) => `${formatCompact(v)}`,
};

function formatWithCommas(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-US');
}

function formatCompact(n) {
    n = Number(n) || 0;
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
}
function formatDuration(seconds) {
    seconds = Number(seconds) || 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

// ── Layer drawers ─────────────────────────────────────────────────────
async function drawBackground(ctx, layer, W, H) {
    if (layer.imageUrl) {
        try {
            const img = await loadImageSafe(layer.imageUrl);
            ctx.save();
            ctx.globalAlpha = layer.opacity ?? 1;
            // cover-fit
            const scale = Math.max(W / img.width, H / img.height);
            const dw = img.width * scale, dh = img.height * scale;
            ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
            ctx.restore();
            return;
        } catch (_) { /* fall through to solid color */ }
    }
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.fillStyle = layer.color || '#12151B';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
}

// Wraps loadImage with a hard timeout so a slow/unreachable CDN can never
// hang a card render (and therefore an interaction reply) indefinitely.
async function loadImageSafe(url, timeoutMs = 4000) {
    return Promise.race([
        loadImage(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('image load timeout')), timeoutMs)),
    ]);
}

async function drawAvatar(ctx, layer, avatarUrl) {
    const { x, y, size } = layer;
    try {
        const img = await loadImageSafe(avatarUrl);
        ctx.save();
        if (layer.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
            ctx.clip();
        } else {
            roundRectPath(ctx, x, y, size, size, layer.radius ?? 16);
            ctx.clip();
        }
        ctx.drawImage(img, x, y, size, size);
        ctx.restore();
    } catch (_) { /* skip if avatar fails to load */ }

    if (layer.borderWidth && layer.borderColor) {
        ctx.save();
        ctx.lineWidth = layer.borderWidth;
        ctx.strokeStyle = layer.borderColor;
        if (layer.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(x + size / 2, y + size / 2, size / 2 - layer.borderWidth / 2, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            roundRectPath(ctx, x + layer.borderWidth / 2, y + layer.borderWidth / 2, size - layer.borderWidth, size - layer.borderWidth, layer.radius ?? 16);
            ctx.stroke();
        }
        ctx.restore();
    }
}

function drawShape(ctx, layer) {
    ctx.save();
    if (layer.color && layer.color !== 'transparent') {
        ctx.fillStyle = layer.color;
        if (layer.shape === 'circle') {
            ctx.beginPath();
            ctx.ellipse(layer.x + layer.w / 2, layer.y + layer.h / 2, layer.w / 2, layer.h / 2, 0, 0, Math.PI * 2);
            ctx.fill();
        } else {
            roundRectPath(ctx, layer.x, layer.y, layer.w, layer.h, layer.radius ?? 0);
            ctx.fill();
        }
    }
    if (layer.borderWidth && layer.borderColor) {
        ctx.lineWidth = layer.borderWidth;
        ctx.strokeStyle = layer.borderColor;
        if (layer.shape === 'circle') {
            ctx.beginPath();
            ctx.ellipse(layer.x + layer.w / 2, layer.y + layer.h / 2, (layer.w - layer.borderWidth) / 2, (layer.h - layer.borderWidth) / 2, 0, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            roundRectPath(ctx, layer.x + layer.borderWidth / 2, layer.y + layer.borderWidth / 2, layer.w - layer.borderWidth, layer.h - layer.borderWidth, layer.radius ?? 0);
            ctx.stroke();
        }
    }
    ctx.restore();
}

function drawText(ctx, layer, data) {
    ctx.save();
    setFont(ctx, layer);
    ctx.fillStyle = layer.color || '#FFFFFF';
    ctx.textBaseline = layer.valign === 'middle' ? 'middle' : 'alphabetic';
    ctx.textAlign = layer.align === 'center' ? 'center' : layer.align === 'right' ? 'right' : 'left';

    let text = fillTemplate(layer.text, data);
    if (layer.letterSpacing) {
        // manual letter-spaced draw (canvas has no native letterSpacing in @napi-rs/canvas reliably)
        drawLetterSpaced(ctx, text, layer, data);
        ctx.restore();
        return;
    }
    const truncateWidth = layer.maxWidth || layer.w;
    if (truncateWidth && layer.truncate) text = truncateToWidth(ctx, text, truncateWidth);

    // Horizontal anchor: if the layer declares a box width (w), center/right
    // align resolve against that box, not against x itself — otherwise a
    // centered layer just centers on its left edge and clips.
    let drawX = layer.x;
    if (layer.w) {
        if (layer.align === 'center') drawX = layer.x + layer.w / 2;
        else if (layer.align === 'right') drawX = layer.x + layer.w;
    }
    let drawY;
    if (layer.valign === 'middle' && layer.h) {
        drawY = layer.y + layer.h / 2;
    } else {
        drawY = layer.y + (layer.size || 16); // treat y as top when no explicit box height
    }
    ctx.fillText(text, drawX, drawY);
    ctx.restore();
}

function drawLetterSpaced(ctx, text, layer, data) {
    const spacing = layer.letterSpacing || 0;
    let totalWidth = 0;
    for (const ch of text) totalWidth += ctx.measureText(ch).width + spacing;
    totalWidth -= spacing;
    let startX = layer.x;
    if (layer.align === 'center') startX = layer.x - totalWidth / 2;
    else if (layer.align === 'right') startX = layer.x - totalWidth;
    ctx.textAlign = 'left';
    let cx = startX;
    const drawY = layer.y + (layer.size || 16);
    for (const ch of text) {
        ctx.fillText(ch, cx, drawY);
        cx += ctx.measureText(ch).width + spacing;
    }
}

function drawProgress(ctx, layer, data) {
    const { x, y, w, h, radius } = layer;
    const pct = Math.max(0, Math.min(1, (data.xp || 0) / Math.max(1, data.xpNeeded || 1)));
    ctx.save();
    roundRectPath(ctx, x, y, w, h, radius ?? h / 2);
    ctx.fillStyle = layer.trackColor || '#252A33';
    ctx.fill();
    ctx.restore();

    const fillW = Math.max(h, w * pct); // never render narrower than the rounded cap
    ctx.save();
    roundRectPath(ctx, x, y, Math.min(w, fillW), h, radius ?? h / 2);
    ctx.clip();
    if (layer.fillGradientTo) {
        const grad = ctx.createLinearGradient(x, 0, x + w, 0);
        grad.addColorStop(0, layer.fillColor);
        grad.addColorStop(1, layer.fillGradientTo);
        ctx.fillStyle = grad;
    } else {
        ctx.fillStyle = layer.fillColor || '#FFFFFF';
    }
    ctx.fillRect(x, y, w, h);
    ctx.restore();
}

function drawActivityStats(ctx, layer, data) {
    const { x, y, w, h, radius } = layer;
    ctx.save();
    roundRectPath(ctx, x, y, w, h, radius ?? 12);
    ctx.fillStyle = layer.color || '#1D2129';
    ctx.fill();
    ctx.restore();

    const stats = layer.stats || [];
    if (!stats.length) return;
    const segW = w / stats.length;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `500 ${layer.size || 16}px "Inter Medium", "${FONT_FAMILY}", sans-serif`;
    stats.forEach((stat, i) => {
        const value = data[stat.key];
        const label = STAT_LABEL[stat.key] ? STAT_LABEL[stat.key](value) : String(value ?? '—');
        const segX = x + i * segW;
        const iconCx = segX + 26;
        const iconCy = y + h / 2;
        drawStatIcon(ctx, stat.icon, iconCx, iconCy, (layer.size || 16) * 1.3, layer.iconColor || layer.textColor || '#B7C0CC');
        ctx.fillStyle = layer.textColor || '#B7C0CC';
        ctx.fillText(label, iconCx + 20, iconCy);
        // separator dot (not on the last segment)
        if (i < stats.length - 1) {
            ctx.beginPath();
            ctx.arc(segX + segW - 4, iconCy, 2, 0, Math.PI * 2);
            ctx.fillStyle = layer.textColor || '#B7C0CC';
            ctx.fill();
        }
    });
    ctx.restore();
}

// Renders data.fruits (a string array — the current Normal Dealer stock) as
// left-to-right, wrapping chips within the layer's box. Never overflows the
// box: if the list is too long to fit, stops and draws a "+N more" chip
// instead of drawing outside layer.h or silently cutting names off mid-chip.
// data.fruits (or another layer-selected dataKey) may legitimately be empty
// (e.g. a wiki-parse hiccup) — that's shown as explanatory text, never a blank card.
function drawFruitList(ctx, layer, data) {
    const { x, y, w, h } = layer;
    const key = layer.dataKey || 'fruits';
    const fruits = Array.isArray(data[key]) ? data[key] : [];
    ctx.save();
    ctx.font = `500 ${layer.size || 16}px "Inter Medium", "${FONT_FAMILY}", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    if (!fruits.length) {
        ctx.fillStyle = layer.color || '#8DA0AC';
        ctx.fillText(data.stale ? 'Stock data unavailable' : 'No fruits currently in stock', x, y + (layer.size || 16));
        ctx.restore();
        return;
    }

    const chipH = (layer.size || 16) + 16;
    const chipGap = 10, rowGap = 10;
    let cx = x, cy = y, shown = 0;

    const drawChip = (label, atX, atY) => {
        const chipW = ctx.measureText(label).width + 28;
        ctx.save();
        roundRectPath(ctx, atX, atY, chipW, chipH, layer.chipRadius ?? chipH / 2);
        ctx.fillStyle = layer.chipColor || '#252A33';
        ctx.fill();
        ctx.fillStyle = layer.color || '#FFFFFF';
        ctx.fillText(label, atX + 14, atY + chipH / 2);
        ctx.restore();
        return chipW;
    };

    for (let i = 0; i < fruits.length; i++) {
        const label = String(fruits[i]);
        const chipW = ctx.measureText(label).width + 28;
        if (cx + chipW > x + w && cx !== x) { cx = x; cy += chipH + rowGap; }
        if (cy + chipH > y + h) {
            const remaining = fruits.length - shown;
            if (remaining > 0) drawChip(`+${remaining} more`, cx, cy);
            ctx.restore();
            return;
        }
        cx += drawChip(label, cx, cy) + chipGap;
        shown++;
    }
    ctx.restore();
}

// ── Main render entrypoint ───────────────────────────────────────────────
// schema: the layer-schema object (width/height/cornerRadius/layers[])
// data: { username, displayName, avatarUrl, level, prevLevel, rank, xp,
//         xpNeeded, progressPct, messages, voiceTime, reactions, server, count }
// Returns a Buffer (PNG).
async function renderCard(schema, data) {
    const W = schema.width || 900;
    const H = schema.height || 280;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Clip the whole canvas to the outer corner radius so every layer
    // (including background images) respects the card's rounded shape.
    ctx.save();
    roundRectPath(ctx, 0, 0, W, H, schema.cornerRadius ?? 0);
    ctx.clip();

    // `enriched` is for TEXT layers only — comma-formatted numbers for display.
    // `data` (raw, numeric) stays untouched and is what drawProgress does math against.
    const enriched = {
        ...data,
        progressPct: data.progressPct ?? (data.xpNeeded ? Math.round((data.xp / data.xpNeeded) * 100) : 0),
        xp: data.xp !== undefined ? formatWithCommas(data.xp) : data.xp,
        xpNeeded: data.xpNeeded !== undefined ? formatWithCommas(data.xpNeeded) : data.xpNeeded,
    };

    for (const layer of schema.layers) {
        if (layer.hidden) continue;
        switch (layer.type) {
            case 'background': await drawBackground(ctx, layer, W, H); break;
            case 'avatar': await drawAvatar(ctx, layer, data.avatarUrl); break;
            case 'shape': drawShape(ctx, layer); break;
            case 'text': drawText(ctx, layer, enriched); break;
            case 'progress': drawProgress(ctx, layer, data); break;
            case 'activityStats': drawActivityStats(ctx, layer, enriched); break;
            case 'fruitList': drawFruitList(ctx, layer, enriched); break;
            default: break; // unknown layer types are skipped, not fatal
        }
    }

    ctx.restore();
    return canvas.toBuffer('image/png');
}

module.exports = {
    renderCard,
    DEFAULT_RANK_CARD_SCHEMA,
    DEFAULT_LEVELUP_CARD_SCHEMA,
    DEFAULT_WELCOME_CARD_SCHEMA,
    DEFAULT_LEAVE_CARD_SCHEMA,
    DEFAULT_STOCK_CARD_SCHEMA,
    fillTemplate,
    formatCompact,
    formatDuration,
};
