// ══════════════════════════════════════════════════════════════════════════
//  bloxfruits_stock.js — Normal Dealer stock, scraped from the (fan-run,
//  human-edited) Blox Fruits Wiki.
//
//  ⚠️ IMPORTANT, READ BEFORE RELYING ON THIS:
//  This wiki has NO official API. Its own editing rules literally say
//  "make sure you check twice before inserting a fruit" — it's people
//  typing in what they saw in-game, not a feed. That means:
//    1. Data can be wrong, stale, or briefly vandalized before a mod reverts it.
//    2. The page's HTML can change at any time with zero notice, which breaks
//       the parsing below. There's no version-pinned contract to code against.
//    3. This page explicitly does NOT track Mirage stock — their own editing
//       rules say not to bother, because it rotates too fast to document
//       reliably. So this module only ever reports Normal Dealer stock.
//       Mirage support would need a different source.
//    4. This was written against a fetch of the page's rendered text taken
//       during development, NOT verified end-to-end against a live request —
//       the sandbox this was built in can't reach fandom.com at all (network
//       egress is locked to package registries only). The parsing selectors
//       below are best-effort against standard MediaWiki conventions, not
//       confirmed to match this page's actual current DOM. Watch the bot's
//       logs after deploying this; if scrapeNormalStock() logs a parse
//       failure, the page structure likely moved and this needs a real fix
//       against the live HTML, which requires access this environment
//       didn't have.
//
//  Because of all of the above, every consumer of this module MUST treat
//  its output as "best available, possibly stale" — never as ground truth.
//  getNormalStock() always returns a `stale` flag and a `lastSuccessAt`
//  timestamp so callers can decide whether to show/trust it.
// ══════════════════════════════════════════════════════════════════════════

const STOCK_PAGE_URL = 'https://blox-fruits.fandom.com/wiki/Blox_Fruits_%22Stock%22';
const MIN_REFETCH_INTERVAL_MS = 30 * 60 * 1000; // don't hit the wiki more than every 30 min — normal stock only rotates every 4h anyway
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;      // if we haven't had a *successful* parse in 6h, flag the cached result as stale rather than silently serving day-old data as current

let cache = {
    fruits: null,          // string[] | null — canonical lowercase fruit names, cross-checked against FRUITS
    lastStock: null,       // string[] | null
    beforeLastStock: null, // string[] | null
    lastSuccessAt: null,   // epoch ms of the last time a parse actually produced validated fruit names
    lastAttemptAt: null,
    lastError: null,
};

/**
 * Fetch and parse the wiki's "Current Stock" line.
 * knownFruitNames: pass DISCOMOD.js's FRUITS array (lowercased, de-emoji'd)
 * so extracted names can be validated against something real rather than
 * trusted blindly — if nothing extracted matches a known fruit, that's
 * treated as a failed parse, not "the game added a brand new fruit."
 */
async function scrapeNormalStock(knownFruitNames) {
    cache.lastAttemptAt = Date.now();
    let html;
    try {
        const res = await fetch(STOCK_PAGE_URL, {
            headers: { 'User-Agent': 'DISCOMOD-DiscordBot/1.0 (+stock-checker; contact via server owner)' },
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
    } catch (e) {
        cache.lastError = `fetch failed: ${e.message}`;
        return currentSnapshot();
    }

    try {
        const parsed = parseStockHtml(html, knownFruitNames);
        if (!parsed.fruits.length) throw new Error('parsed zero valid fruit names — page structure likely changed');
        cache.fruits = parsed.fruits;
        cache.lastStock = parsed.lastStock;
        cache.beforeLastStock = parsed.beforeLastStock;
        cache.lastSuccessAt = Date.now();
        cache.lastError = null;
    } catch (e) {
        cache.lastError = `parse failed: ${e.message}`;
    }
    return currentSnapshot();
}

// Best-effort MediaWiki-convention parsing. Looks for a "Current Stock:"
// label (Fandom infobox/paragraph text, not a specific CSS class we can't
// verify) followed by a comma-separated fruit list, same for Last/Before
// Last. Deliberately text-anchored rather than selector-anchored since
// exact class names weren't verifiable from this environment.
function parseStockHtml(html, knownFruitNames) {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    const known = new Set((knownFruitNames || []).map(n => String(n).toLowerCase().trim()).filter(n => /^[a-z\- ]+$/.test(n)));

    const extractList = (label) => {
        const m = text.match(new RegExp(`${label}\\s*:\\s*([^.]{0,200}?)(?:Last Stock|Before Last|Next Stock|Rules for|$)`, 'i'));
        if (!m) return [];
        return m[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
            .map(s => s.replace(/[^a-z\- ]/g, '').trim()).filter(Boolean)
            .filter(name => known.size === 0 || known.has(name)); // drop anything that isn't a recognized fruit name — catches vandalism/parse noise
    };

    return {
        fruits: extractList('Current Stock'),
        lastStock: extractList('Last Stock'),
        beforeLastStock: extractList('Before Last Stock'),
    };
}

function currentSnapshot() {
    const stale = !cache.lastSuccessAt || (Date.now() - cache.lastSuccessAt) > STALE_AFTER_MS;
    return {
        fruits: cache.fruits, lastStock: cache.lastStock, beforeLastStock: cache.beforeLastStock,
        lastSuccessAt: cache.lastSuccessAt, lastAttemptAt: cache.lastAttemptAt, lastError: cache.lastError,
        stale, hasData: !!cache.fruits,
        mirageSupported: false, // explicit, not just absent — see file header
    };
}

/** Returns cached data immediately; only re-fetches if the cache is older than MIN_REFETCH_INTERVAL_MS. */
async function getNormalStock(knownFruitNames) {
    if (cache.lastAttemptAt && (Date.now() - cache.lastAttemptAt) < MIN_REFETCH_INTERVAL_MS) return currentSnapshot();
    return scrapeNormalStock(knownFruitNames);
}

module.exports = { getNormalStock, scrapeNormalStock, currentSnapshot, parseStockHtml, STOCK_PAGE_URL };
