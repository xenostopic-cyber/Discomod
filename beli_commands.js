// ╔══════════════════════════════════════════════════════════════════════╗
// ║  DISCOMOD — BELI EXPANSION MODULE                                    ║
// ║  Custom AutoMod (words/regex/wildcards) + Economy/Gambling/Shop/      ║
// ║  Upgrades — all consolidated under ONE slash command (/beli) because  ║
// ║  DISCOMOD.js was sitting at 99/100 registered top-level commands.     ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

const crypto = require('crypto');

// ─── HOW TO INTEGRATE INTO DISCOMOD.js (mirrors math_commands.js) ───────────
//
//  1. At the top of DISCOMOD.js, near `const mathMod = require('./math_commands');`, add:
//       const beliMod = require('./beli_commands');
//
//  2. Inside the big `slashCommands` array (before the `.map(c => c.toJSON())`),
//     add at the end:
//       ...beliMod.beliSlashCommandBuilders,
//
//     This adds ONE new /beli command (6 subcommand groups, 53 actions total)
//     instead of 53 separate commands — keeps you at exactly 100/100.
//
//  3. In the FIRST client.on('interactionCreate', ...) handler, right after
//     `const gs = getGuildSettings(guildId, data);` (and after `imm` if present), add:
//       if (await beliMod.handleBeliInteraction(interaction, data, gs, guild, saveData, client)) return;
//
//  4. In the messageCreate handler, right after `immune`/`immCfg` are established
//     (before the Leveling block), add:
//       if (!immune && gs.automodEnabled) {
//           const _amHit = await beliMod.checkCustomAutomod(message, gs, data, isStaff, saveData, client);
//           if (_amHit) return;
//       }
//
//  5. Inside handlePrefixCommands, right after the generic checkPrefixArgs guard
//     block, add:
//       if (beliMod.BELI_PREFIX_COMMANDS.has(cmd)) {
//           return beliMod.handleBeliPrefixCommand(message, cmd, args, data, gs, isAdmin, isMod, saveData, client);
//       }
//
//  6. Right after `const PREFIX_CMD_SPECS = { ... };` closes, add:
//       Object.assign(PREFIX_CMD_SPECS, beliMod.BELI_PREFIX_SPECS);
//
//  7. Inside getGuildSettings' default-settings object literal, add the automod*
//     fields (see automod_default_fields.txt for the exact block to paste in).
//
//  8. OPTIONAL cross-integration: in the Leveling XP-gain block, change:
//       const gain = Math.floor(Math.random() * (lc.xpMax - lc.xpMin + 1)) + lc.xpMin;
//     to:
//       let gain = Math.floor(Math.random() * (lc.xpMax - lc.xpMin + 1)) + lc.xpMin;
//       gain = Math.round(gain * beliMod.getActiveBoostMultiplier(data, guildId, uid, 'xp'));
//     so the shop's XP Booster item actually does something.
//
// ─────────────────────────────────────────────────────────────────────────────

const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    ChannelType,
    ButtonBuilder,
    ActionRowBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');

// ══════════════════════════════════════════════════════════
//  CURRENCY / FORMATTING
// ══════════════════════════════════════════════════════════
const CURRENCY_NAME  = 'Beli';
const CURRENCY_EMOJI = '💰'; // swap for a custom server emoji string any time, e.g. '<:beli:123456789012345678>'

function fmtBeli(n) {
    const v = Math.max(0, Math.floor(Number(n) || 0));
    return `${CURRENCY_EMOJI} ${v.toLocaleString('en-US')} ${CURRENCY_NAME}`;
}
function fmtNum(n) {
    return Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('en-US');
}

const COLOR_OK      = 0x00FF88;
const COLOR_BAD      = 0xFF4444;
const COLOR_INFO     = 0x5865F2;
const COLOR_GOLD     = 0xFFC94D;
const COLOR_GAMBLE_W = 0x00CC66;
const COLOR_GAMBLE_L = 0xCC0000;

// ══════════════════════════════════════════════════════════
//  ECONOMY BASE CONFIG
// ══════════════════════════════════════════════════════════
const STARTING_WALLET      = 500;
const STARTING_BANK        = 0;
const BASE_BANK_CAPACITY   = 5000;

// Per-guild economy bootstrap/capacity settings. These intentionally affect
// new-player bootstrap values and the live bank capacity calculation, while
// never rewriting existing wallets/banks behind the admin's back.
function getEconomyBaseConfig(gs) {
    const c = gs?.beliEconomy || {};
    return {
        startingWallet: Number.isFinite(c.startingWallet) ? Math.max(0, Math.min(1000000000, Math.floor(c.startingWallet))) : STARTING_WALLET,
        startingBank: Number.isFinite(c.startingBank) ? Math.max(0, Math.min(1000000000, Math.floor(c.startingBank))) : STARTING_BANK,
        baseBankCapacity: Number.isFinite(c.baseBankCapacity) ? Math.max(100, Math.min(1000000000, Math.floor(c.baseBankCapacity))) : BASE_BANK_CAPACITY,
    };
}

const COOLDOWNS_MS = {
    daily:   24 * 60 * 60 * 1000,
    weekly:   7 * 24 * 60 * 60 * 1000,
    work:     60 * 60 * 1000,
    crime:    45 * 60 * 1000,
    fish:     20 * 60 * 1000,
    hunt:     25 * 60 * 1000,
    rob:       2 * 60 * 60 * 1000,
    trivia:   30 * 1000,
};

// ══════════════════════════════════════════════════════════
//  UPGRADE TRACKS  (5 tracks × 10 tiers, cost curve = base * tier^1.55)
// ══════════════════════════════════════════════════════════
const UPGRADE_TRACKS = {
    luck: {
        label: '🍀 Luck Charm',
        desc: 'Improves odds on every gamble in /beli gamble.',
        maxTier: 10,
        baseCost: 4000,
        effectPerTier: 0.006, // +0.6% win-chance nudge per tier, capped in game math
    },
    income: {
        label: '💼 Income Boost',
        desc: 'Increases payouts from work, crime, fish, and hunt.',
        maxTier: 10,
        baseCost: 3500,
        effectPerTier: 0.05, // +5% payout per tier
    },
    vault: {
        label: '🏦 Vault Capacity',
        desc: 'Raises your bank storage limit.',
        maxTier: 10,
        baseCost: 3000,
        effectPerTier: 2500, // +2,500 capacity per tier (flat, not %)
    },
    security: {
        label: '🛡️ Security Detail',
        desc: 'Reduces the odds that someone successfully robs you.',
        maxTier: 10,
        baseCost: 4500,
        effectPerTier: 0.03, // -3% rob success chance against you, per tier
    },
    stamina: {
        label: '⚡ Stamina Training',
        desc: 'Shortens cooldowns on work, crime, fish, hunt, and rob.',
        maxTier: 10,
        baseCost: 3800,
        effectPerTier: 0.045, // -4.5% cooldown per tier
    },
};
const UPGRADE_TRACK_KEYS = Object.keys(UPGRADE_TRACKS);

function getGuildBeliConfig(gs) {
    const c = gs?.beliGameConfig || {};
    return c && typeof c === 'object' ? c : {};
}
function getGuildShopPrice(item, gs) {
    const c = getGuildBeliConfig(gs);
    const n = Number(c.shopPrices?.[item.id]);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : item.price;
}
function getGuildUpgradeBaseCost(track, gs) {
    const cfg = UPGRADE_TRACKS[track];
    const c = getGuildBeliConfig(gs);
    const n = Number(c.upgradeBaseCosts?.[track]);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : cfg?.baseCost;
}
function upgradeCost(track, currentTier, gs = null) {
    const cfg = UPGRADE_TRACKS[track];
    if (!cfg) return null;
    const nextTier = currentTier + 1;
    if (nextTier > cfg.maxTier) return null;
    const baseCost = getGuildUpgradeBaseCost(track, gs);
    return Math.round(baseCost * Math.pow(nextTier, 1.55));
}

// ══════════════════════════════════════════════════════════
//  SHOP ITEMS  (all consumables are time-boxed boosts; cosmetics are flair only)
// ══════════════════════════════════════════════════════════
const SHOP_ITEMS = [
    { id: 'xpboost',    name: 'XP Booster (1h)',        price: 3000,  type: 'consumable', boost: 'xp',      durationMs: 60 * 60 * 1000, mult: 2.0,  emoji: '📈', desc: 'Doubles leveling XP gain for 1 hour.' },
    { id: 'beliboost',  name: 'Beli Booster (1h)',      price: 4000,  type: 'consumable', boost: 'earn',    durationMs: 60 * 60 * 1000, mult: 1.5,  emoji: '💹', desc: '+50% Beli from work/crime/fish/hunt for 1 hour.' },
    { id: 'luckcharm',  name: 'Lucky Charm (1h)',       price: 6000,  type: 'consumable', boost: 'gamble',  durationMs: 60 * 60 * 1000, mult: 0.10, emoji: '🍀', desc: '+10% win chance on gambles for 1 hour.' },
    { id: 'robshield',  name: 'Rob Shield (2h)',        price: 5000,  type: 'consumable', boost: 'shield',  durationMs: 2 * 60 * 60 * 1000, mult: 1, emoji: '🛡️', desc: 'Immune to /beli earn rob for 2 hours.' },
    { id: 'treasuremap',name: 'Treasure Map',            price: 2500,  type: 'consumable', boost: 'map',     durationMs: 0, mult: 1, emoji: '🗺️', desc: 'Guarantees your rarest fish/hunt result on next use.' },
    { id: 'dfcrate',    name: 'Devil Fruit Crate',       price: 10000, type: 'consumable', boost: 'crate',   durationMs: 0, mult: 1, emoji: '🍈', desc: 'A mystery crate — cracks open into a random reward.' },
    { id: 'badge_marine', name: 'Marine Badge',          price: 5000,  type: 'cosmetic',  boost: null, durationMs: 0, mult: 1, emoji: '⚓', desc: 'Profile flair badge.' },
    { id: 'badge_bounty', name: 'Bounty Poster Frame',   price: 8000,  type: 'cosmetic',  boost: null, durationMs: 0, mult: 1, emoji: '📜', desc: 'Profile flair badge.' },
    { id: 'badge_pk',     name: 'Pirate King Badge',     price: 20000, type: 'cosmetic',  boost: null, durationMs: 0, mult: 1, emoji: '👑', desc: 'Profile flair badge — flex item.' },
    { id: 'duelinsurance', name: 'Duel Insurance',       price: 4000,  type: 'consumable', boost: 'duelinsurance', durationMs: 0, mult: 1, emoji: '📋', desc: 'Refunds your stake if you lose your next duel.' },
    { id: 'minesradar',   name: 'Mines Radar',           price: 3500,  type: 'consumable', boost: 'minesradar', durationMs: 0, mult: 1, emoji: '📡', desc: 'Reveals whether your first mines tile is safe before you click it.' },
    { id: 'secondchance', name: 'Second Chance Token',   price: 5000,  type: 'consumable', boost: 'secondchance', durationMs: 0, mult: 1, emoji: '🔄', desc: 'If your next blackjack hit busts you, undo it once instead.' },
];
function getGuildShopItems(gs) {
    return SHOP_ITEMS.map(item => ({ ...item, price: getGuildShopPrice(item, gs) }));
}
function findShopItem(idOrName, gs = null) {
    const key = String(idOrName || '').trim().toLowerCase();
    const item = SHOP_ITEMS.find(i => i.id === key || i.name.toLowerCase() === key) || null;
    return item ? { ...item, price: getGuildShopPrice(item, gs) } : null;
}

// ══════════════════════════════════════════════════════════
//  FLAVOR TEXT — WORK
// ══════════════════════════════════════════════════════════
const WORK_SCENARIOS = [
    'You delivered cargo to Marineford and earned {amount}.',
    'You guided a rookie through the First Sea and they tipped you {amount}.',
    'You worked a shift at the Marine outpost armory and earned {amount}.',
    'You sold spare Devil Fruit awakening materials for {amount}.',
    'You ran a boat-taxi between islands and made {amount}.',
    'You helped a merchant restock a general store for {amount}.',
    'You did some freelance blacksmithing and earned {amount}.',
    'You escorted a trading vessel through pirate waters for {amount}.',
    'You gave fighting-style lessons to a new recruit and made {amount}.',
    'You picked up bounty paperwork filing at HQ for {amount}.',
    'You repaired a fishing boat\'s hull for {amount}.',
    'You worked the counter at a weapons shop and earned {amount}.',
    'You ran supply crates to a sea-tower outpost for {amount}.',
    'You tuned someone\'s gun stats at the enhancement shop for {amount}.',
    'You busked in port town and passersby gave you {amount}.',
];

// ══════════════════════════════════════════════════════════
//  FLAVOR TEXT — CRIME
// ══════════════════════════════════════════════════════════
const CRIME_SUCCESS = [
    'You slipped past a sleeping Marine and lifted {amount} from the outpost safe.',
    'You pickpocketed a rich merchant in port and got away with {amount}.',
    'You raided an abandoned pirate stash and found {amount}.',
    'You ran a shady back-alley trade and pocketed {amount}.',
    'You bluffed your way past a checkpoint carrying contraband worth {amount}.',
    'You looted a shipwreck before the Marines arrived, worth {amount}.',
    'You conned a gullible tourist out of {amount}.',
    'You hacked a bounty office ledger and diverted {amount} to yourself.',
];
const CRIME_FAIL = [
    'A Marine patrol caught you red-handed — you paid a {amount} fine.',
    'Your heist went sideways and you had to bribe your way out for {amount}.',
    'You tripped an alarm and got fined {amount} on the spot.',
    'The merchant recognized you from last time — {amount} fine and a warning.',
    'You got cornered by bounty hunters and had to pay {amount} to walk away.',
    'Your plan fell apart immediately — {amount} in damages billed to you.',
];

// ══════════════════════════════════════════════════════════
//  LOOT TABLES — FISH / HUNT  (rarity tiers, weighted)
// ══════════════════════════════════════════════════════════
const FISH_LOOT = [
    { rarity: 'Common',    weight: 60, min: 50,   max: 200,  names: ['a Sea Bass', 'a Reef Crab', 'a handful of Kelp', 'a rusty Anchor Chain'] },
    { rarity: 'Uncommon',  weight: 25, min: 200,  max: 600,  names: ['a Silverfin Tuna', 'a Pearl Oyster', 'a chest of soggy coins'] },
    { rarity: 'Rare',      weight: 12, min: 600,  max: 1800, names: ['a Kraken Scale', 'a Sunken Treasure Crate', 'an ancient Sea Chart'] },
    { rarity: 'Legendary', weight: 3,  min: 2000, max: 6000, names: ['a Sea King Fang', 'a Poneglyph Fragment', 'a chest stamped with a Jolly Roger'] },
];
const HUNT_LOOT = [
    { rarity: 'Common',    weight: 55, min: 80,   max: 250,  names: ['a Marine\'s discarded rations', 'a low-tier Bounty poster reward', 'scrap Seastone'] },
    { rarity: 'Uncommon',  weight: 28, min: 250,  max: 700,  names: ['a mid-tier Bounty payout', 'a pirate\'s coin pouch', 'salvaged weapon parts'] },
    { rarity: 'Rare',      weight: 13, min: 700,  max: 2200, names: ['a high-tier Bounty payout', 'a Vice Admiral\'s confiscated stash'] },
    { rarity: 'Legendary', weight: 4,  min: 2500, max: 7000, names: ['a Yonko-tier Bounty payout', 'a legendary swordsman\'s bounty chest'] },
];
function pickWeighted(table) {
    const total = table.reduce((s, t) => s + t.weight, 0);
    let roll = Math.random() * total;
    for (const t of table) {
        if (roll < t.weight) return t;
        roll -= t.weight;
    }
    return table[table.length - 1];
}

// ══════════════════════════════════════════════════════════
//  TRIVIA BANK  (Blox Fruits themed)
// ══════════════════════════════════════════════════════════
const TRIVIA_QUESTIONS = [
    { q: 'What is the in-game currency called?', choices: ['Beli', 'Berry', 'Coins', 'Gold'], correct: 0 },
    { q: 'Which sea do new players start in?', choices: ['First Sea', 'Second Sea', 'Third Sea', 'Grand Line'], correct: 0 },
    { q: 'What stat determines your health pool?', choices: ['Melee', 'Defense', 'Sword', 'Gun'], correct: 1 },
    { q: 'What do you call fruits that grant elemental/logia-type powers?', choices: ['Zoan', 'Paramecia', 'Logia', 'Special'], correct: 2 },
    { q: 'What currency is used for trading rare fruits typically valued in?', choices: ['Beli only', 'Fruit-for-fruit or Robux value', 'XP', 'Fragments'], correct: 1 },
    { q: 'What is the max level cap historically associated with endgame content?', choices: ['1000', '1500', '2400+', '100'], correct: 2 },
    { q: 'Which weapon type scales with the Sword stat?', choices: ['Guns', 'Swords/blades', 'Fruits', 'Fists'], correct: 1 },
    { q: 'What do you call the safe zone where players usually cannot be attacked?', choices: ['Sanctuary', 'Safe zone/spawn', 'Warzone', 'PvP arena'], correct: 1 },
    { q: 'What is a "grind" in the context of this kind of game?', choices: ['A cosmetic dance', 'Repetitive farming for XP/loot', 'A trading term', 'A boss fight'], correct: 1 },
    { q: 'What term describes awakened fruit abilities?', choices: ['V2/Awakened', 'Mastery', 'Fusion', 'Overdrive'], correct: 0 },
    { q: 'What do players call an item duplication or unfair advantage exploit?', choices: ['A feature', 'A glitch/exploit', 'An update', 'A trade'], correct: 1 },
    { q: 'What is commonly required before trading large amounts of currency in a Discord server?', choices: ['Nothing', 'Following the server\'s trade-channel rules', 'A subscription', 'A captcha only'], correct: 1 },
    { q: 'What is a "fruit notifier" typically used for?', choices: ['Cooking recipes', 'Alerting when a rare fruit spawns in the shop', 'Leveling up', 'PvP matchmaking'], correct: 1 },
    { q: 'What is the term for stat points you allocate as you level up?', choices: ['Skill points', 'Stat points', 'Talent points', 'Ability points'], correct: 1 },
    { q: 'What do most servers call a person who scams during trades?', choices: ['A scammer', 'A merchant', 'A moderator', 'A booster'], correct: 0 },
    { q: 'What is "PvP" short for?', choices: ['Player vs Puzzle', 'Player vs Player', 'Points vs Points', 'Power vs Power'], correct: 1 },
    { q: 'What kind of channel does a moderation bot usually redirect off-topic trades to?', choices: ['A trade/trading channel', 'The announcements channel', 'DMs', 'A voice channel'], correct: 0 },
    { q: 'What is a "raid" in this genre typically?', choices: ['A group PvE event/dungeon', 'A server attack', 'A trade dispute', 'A cosmetic event'], correct: 0 },
    { q: 'What does "AFK" stand for?', choices: ['Away From Keyboard', 'Always Fighting Kraken', 'A Fine Kill', 'Attack From Kingdom'], correct: 0 },
    { q: 'In card games, what does "push" mean?', choices: ['A loss', 'A tie — bet returned', 'A double win', 'An automatic fold'], correct: 1 },
    { q: 'In blackjack, what beats a dealer bust?', choices: ['Nothing, you always lose', 'Any hand you have that has not busted', 'Only a natural 21', 'Only a pair'], correct: 1 },
    { q: 'What does "RNG" stand for?', choices: ['Random Number Generator', 'Rare Name Grant', 'Real Number Group', 'Ranked New Game'], correct: 0 },
    { q: 'What is a "cooldown" in game design?', choices: ['A weather effect', 'A required wait time before reusing an action', 'A chat filter', 'A trading fee'], correct: 1 },
    { q: 'What does "meta" mean in gaming slang?', choices: ['A metadata file', 'The current most effective strategy/build', 'A type of currency', 'A server region'], correct: 1 },
    { q: 'What is a "nerf" in game balance terms?', choices: ['A weapon buff', 'A weakening of something previously strong', 'A cosmetic change', 'A new game mode'], correct: 1 },
    { q: 'What is a "buff" in game balance terms?', choices: ['A strengthening of something', 'A weakening of something', 'A ban', 'A currency reset'], correct: 0 },
    { q: 'What is an "exploit"?', choices: ['An intended feature', 'An unintended advantage from a bug', 'A trading term', 'A leaderboard rank'], correct: 1 },
    { q: 'What does "OP" usually mean in gaming chat?', choices: ['Original Poster / Overpowered depending on context', 'Only Player', 'Offline Player', 'Open Portal'], correct: 0 },
    { q: 'What is "power creep"?', choices: ['A villain type', 'New content gradually making old content weaker by comparison', 'A currency tax', 'A chat moderation term'], correct: 1 },
    { q: 'What does a "cash out" mean in a crash-style gamble?', choices: ['Quitting the server', 'Locking in your current multiplier before it crashes', 'Depositing to your bank', 'Refunding a purchase'], correct: 1 },
    { q: 'In roulette, what color is the number 0 typically?', choices: ['Red', 'Black', 'Green', 'Gold'], correct: 2 },
    { q: 'What is a "house edge" in gambling?', choices: ['A wall texture', 'The statistical advantage the game keeps for itself', 'A VIP area', 'A bonus for new players'], correct: 1 },
    { q: 'What is a Discord "cooldown role" typically used to prevent?', choices: ['Spam or command abuse', 'Voice chat access', 'Nickname changes only', 'Emoji reactions'], correct: 0 },
    { q: 'What does a moderation bot "warn" system usually track?', choices: ['Nothing, warnings vanish instantly', 'A count of rule violations per user', 'Only bans', 'Only mutes'], correct: 1 },
    { q: 'What is the purpose of an AutoMod word filter?', choices: ['To automatically delete/flag messages matching banned terms', 'To translate messages', 'To rename users', 'To generate memes'], correct: 0 },
];

// ══════════════════════════════════════════════════════════
//  CARDS  (blackjack + higher/lower)
// ══════════════════════════════════════════════════════════
const CARD_RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const CARD_SUITS = ['♠','♥','♦','♣'];
function drawCard() {
    const rank = CARD_RANKS[Math.floor(Math.random() * CARD_RANKS.length)];
    const suit = CARD_SUITS[Math.floor(Math.random() * CARD_SUITS.length)];
    return { rank, suit };
}
function cardValue(rank) {
    if (rank === 'A') return 11;
    if (['J','Q','K'].includes(rank)) return 10;
    return parseInt(rank, 10);
}
function cardDisplay(c) { return `${c.rank}${c.suit}`; }
function handValue(cards) {
    let total = cards.reduce((s, c) => s + cardValue(c.rank), 0);
    let aces = cards.filter(c => c.rank === 'A').length;
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
}
function highLowRank(rank) { return CARD_RANKS.indexOf(rank); } // A is LOW (index 0) for higher/lower purposes

// ══════════════════════════════════════════════════════════
//  SLOTS
// ══════════════════════════════════════════════════════════
const SLOT_SYMBOLS = [
    { sym: '🍒', weight: 35, mult: 1.5 },
    { sym: '🍋', weight: 28, mult: 2 },
    { sym: '🍇', weight: 18, mult: 3 },
    { sym: '⭐', weight: 12, mult: 6 },
    { sym: '💎', weight: 6,  mult: 12 },
    { sym: '7️⃣', weight: 2,  mult: 40 },
];
function spinReel(symbols = SLOT_SYMBOLS) {
    const total = symbols.reduce((s, x) => s + x.weight, 0);
    let roll = Math.random() * total;
    for (const s of symbols) {
        if (roll < s.weight) return s;
        roll -= s.weight;
    }
    return symbols[0];
}

// ══════════════════════════════════════════════════════════
//  ECONOMY DATA HELPERS  (mirrors the data.levels[guildId][userId] convention
//  already used elsewhere in DISCOMOD.js — same lazy-init style, same
//  saveData(data) persistence, no parallel storage system introduced)
// ══════════════════════════════════════════════════════════
function ensureEconomy(data, guildId, userId) {
    data.economy = data.economy || {};
    data.economy[guildId] = data.economy[guildId] || {};
    if (!data.economy[guildId][userId]) {
        const baseCfg = getEconomyBaseConfig(data.guildSettings?.[guildId]);
        data.economy[guildId][userId] = {
            wallet: baseCfg.startingWallet,
            bank: Math.min(baseCfg.startingBank, baseCfg.baseBankCapacity),
            upgrades: {},
            inventory: {},
            boosts: {},
            cooldowns: {},
            dailyStreak: 0,
            gamesPlayed: 0,
            gamesWon: 0,
            totalEarned: 0,
            robsWon: 0,
            robsLost: 0,
            duelsWon: 0,
            duelsLost: 0,
            questDay: null,
            questProgress: {},
            questClaimed: false,
        };
    }
    return data.economy[guildId][userId];
}
function peekEconomy(data, guildId, userId) {
    return data?.economy?.[guildId]?.[userId] || null;
}

function getUpgradeTier(rec, track) { return rec.upgrades?.[track] || 0; }
function setUpgradeTier(rec, track, tier) { rec.upgrades = rec.upgrades || {}; rec.upgrades[track] = tier; }

function getBankCapacity(rec, gs) {
    const tier = getUpgradeTier(rec, 'vault');
    return getEconomyBaseConfig(gs).baseBankCapacity + tier * UPGRADE_TRACKS.vault.effectPerTier;
}
function getIncomeMultiplier(rec) {
    return 1 + getUpgradeTier(rec, 'income') * UPGRADE_TRACKS.income.effectPerTier;
}
function getLuckBonus(rec) {
    return getUpgradeTier(rec, 'luck') * UPGRADE_TRACKS.luck.effectPerTier;
}
function getSecurityBonus(rec) {
    return getUpgradeTier(rec, 'security') * UPGRADE_TRACKS.security.effectPerTier;
}
function getCooldownMultiplier(rec) {
    return Math.max(0.4, 1 - getUpgradeTier(rec, 'stamina') * UPGRADE_TRACKS.stamina.effectPerTier);
}

function addWallet(rec, amount) {
    if (amount > 0) rec.totalEarned = (rec.totalEarned || 0) + amount;
    rec.wallet = Math.max(0, Math.round((rec.wallet || 0) + amount));
    return rec.wallet;
}
function removeWallet(rec, amount) { rec.wallet = Math.max(0, Math.round((rec.wallet || 0) - amount)); return rec.wallet; }
function addBank(rec, amount) { rec.bank = Math.max(0, Math.round((rec.bank || 0) + amount)); return rec.bank; }
function removeBank(rec, amount) { rec.bank = Math.max(0, Math.round((rec.bank || 0) - amount)); return rec.bank; }
function netWorth(rec) { return (rec.wallet || 0) + (rec.bank || 0); }

function getItemQty(rec, itemId) { return rec.inventory?.[itemId] || 0; }
function addItemQty(rec, itemId, qty) { rec.inventory = rec.inventory || {}; rec.inventory[itemId] = (rec.inventory[itemId] || 0) + qty; }
function removeItemQty(rec, itemId, qty) {
    rec.inventory = rec.inventory || {};
    rec.inventory[itemId] = Math.max(0, (rec.inventory[itemId] || 0) - qty);
    if (rec.inventory[itemId] <= 0) delete rec.inventory[itemId];
}

// ── Boosts (time-boxed, all share one mechanism incl. the single-use "map") ─
function setBoost(rec, boostType, durationMs) {
    rec.boosts = rec.boosts || {};
    rec.boosts[boostType] = Date.now() + durationMs;
}
function isBoostActive(rec, boostType) {
    return !!(rec.boosts && rec.boosts[boostType] && rec.boosts[boostType] > Date.now());
}
function clearBoost(rec, boostType) { if (rec.boosts) delete rec.boosts[boostType]; }
function boostTimeLeft(rec, boostType) {
    if (!isBoostActive(rec, boostType)) return 0;
    return rec.boosts[boostType] - Date.now();
}
// Exposed to DISCOMOD.js for the optional leveling cross-integration (step 8).
function getActiveBoostMultiplier(data, guildId, userId, boostType, fallback = 1) {
    const rec = peekEconomy(data, guildId, userId);
    if (!rec) return fallback;
    if (isBoostActive(rec, boostType)) {
        const item = SHOP_ITEMS.find(i => i.boost === boostType);
        return item?.mult || fallback;
    }
    return fallback;
}

// ── Cooldowns ────────────────────────────────────────────────────────────
function cooldownRemaining(rec, action, rawMs) {
    const scalable = ['work', 'crime', 'fish', 'hunt', 'rob'].includes(action);
    const mult = scalable ? getCooldownMultiplier(rec) : 1;
    const effectiveMs = Math.round(rawMs * mult);
    const last = rec.cooldowns?.[action] || 0;
    const remaining = (last + effectiveMs) - Date.now();
    return remaining > 0 ? remaining : 0;
}
function setCooldown(rec, action) { rec.cooldowns = rec.cooldowns || {}; rec.cooldowns[action] = Date.now(); }
function fmtDuration(ms) {
    if (ms <= 0) return '0s';
    const s = Math.ceil(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const parts = [];
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    if (sec || !parts.length) parts.push(`${sec}s`);
    return parts.join(' ');
}

// ── Bet parsing ("all" / "half" / raw number) ───────────────────────────
function parseBet(raw, wallet) {
    const s = String(raw ?? '').trim().toLowerCase();
    if (s === 'all' || s === 'max') return wallet;
    if (s === 'half') return Math.floor(wallet / 2);
    const n = Math.floor(Number(s.replace(/,/g, '')));
    if (!Number.isFinite(n)) return null;
    return n;
}

function buildEconomyLeaderboard(data, guildId, limit = 10) {
    const guildEcon = data.economy?.[guildId] || {};
    return Object.entries(guildEcon)
        .map(([uid, rec]) => ({ uid, net: netWorth(rec) }))
        .filter(r => r.net > 0)
        .sort((a, b) => b.net - a.net)
        .slice(0, limit);
}

// ══════════════════════════════════════════════════════════
//  AUTOMOD CONFIG HELPERS  (stored as flat gs.automod* fields, same
//  convention as gs.raid*/gs.verify*/gs.timeout* already in getGuildSettings)
// ══════════════════════════════════════════════════════════
const AUTOMOD_DEFAULTS = {
    automodEnabled: false,
    automodWords: [],
    automodRegexRules: [],
    automodExemptRoleIds: [],
    automodExemptChannelIds: [],
    automodAction: 'delete',
    automodTimeoutMinutes: 10,
    automodLogChannelId: null,
    automodDeleteMessage: true,
};
const MAX_AUTOMOD_WORDS = 200;
const MAX_AUTOMOD_REGEX = 50;
const MAX_PATTERN_LENGTH = 200;

function getAutomodConfig(gs) {
    // Defensive: still works even if the getGuildSettings default-object edit
    // (integration step 7) hasn't been pasted in — fills gaps at read time.
    for (const [k, v] of Object.entries(AUTOMOD_DEFAULTS)) {
        if (gs[k] === undefined) gs[k] = Array.isArray(v) ? [...v] : v;
    }
    return gs;
}

function buildWordRegex(word) {
    const esc = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-zA-Z0-9])${esc}(?:[^a-zA-Z0-9]|$)`, 'i');
}
// Coarse ReDoS smell-test: nested quantifiers like (a+)+ or (.*)* are the
// classic catastrophic-backtracking shape. Not exhaustive, but blocks the
// obvious cases before a bad pattern ever gets saved to guild config.
function looksCatastrophic(pattern) {
    return /\([^)]{0,40}[+*][^)]{0,10}\)[+*]/.test(pattern);
}
function validateRegexPattern(pattern, flags) {
    const p = String(pattern || '');
    if (!p || p.length > MAX_PATTERN_LENGTH) return `Pattern must be 1-${MAX_PATTERN_LENGTH} characters.`;
    if (looksCatastrophic(p)) return 'Pattern looks like it could catastrophically backtrack (nested quantifiers) — simplify it.';
    try { new RegExp(p, flags || 'i'); } catch (e) { return `Invalid regex: ${e.message}`; }
    return null;
}
function testAutomodMatch(content, cfg) {
    if (!content) return null;
    const clean = String(content).slice(0, 2000);
    for (const w of (cfg.automodWords || [])) {
        try { if (buildWordRegex(w).test(clean)) return { type: 'word', rule: w }; } catch {}
    }
    for (const r of (cfg.automodRegexRules || [])) {
        try {
            const re = new RegExp(r.pattern, r.flags || 'i');
            if (re.test(clean)) return { type: 'regex', rule: r.pattern };
        } catch {}
    }
    return null;
}

async function applyAutomodAction(message, cfg, match, saveData, data, client) {
    const action = cfg.automodAction || 'delete';
    if (action === 'delete' || !message.member) return;
    const reason = `Custom AutoMod: matched ${match.type} rule "${match.rule}"`.slice(0, 400);
    try {
        if (action === 'warn') {
            await message.author.send(`⚠️ You were warned in **${message.guild.name}**: ${reason}`).catch(() => {});
        } else if (action === 'timeout') {
            const mins = Math.max(1, Math.min(40320, cfg.automodTimeoutMinutes || 10));
            if (message.member.moderatable) await message.member.timeout(mins * 60 * 1000, reason);
        } else if (action === 'kick') {
            if (message.member.kickable) await message.member.kick(reason);
        } else if (action === 'ban') {
            if (message.member.bannable) await message.member.ban({ reason });
        }
    } catch (e) { console.error('[beli automod] action failed:', e.message); }
}

async function checkCustomAutomod(message, gs, data, isStaff, saveData, client) {
    const cfg = getAutomodConfig(gs);
    if (!cfg.automodEnabled) return false;
    const content = String(message.content || '');
    if (!content.trim()) return false;

    const memberRoles = message.member?.roles?.cache;
    if (memberRoles && (cfg.automodExemptRoleIds || []).some(rid => memberRoles.has(rid))) return false;
    if ((cfg.automodExemptChannelIds || []).includes(message.channel.id)) return false;

    const match = testAutomodMatch(content, cfg);
    if (!match) return false;

    if (cfg.automodDeleteMessage !== false) {
        try { await message.delete(); } catch {}
    }
    try {
        const notice = await message.channel.send({
            embeds: [new EmbedBuilder()
                .setTitle('🚫 Custom AutoMod')
                .setDescription(`<@${message.author.id}>, your message was removed for violating a custom filter rule.`)
                .setColor(COLOR_BAD)]
        });
        setTimeout(() => notice.delete().catch(() => {}), 8000);
    } catch {}

    await applyAutomodAction(message, cfg, match, saveData, data, client);

    if (cfg.automodLogChannelId) {
        try {
            const ch = await client.channels.fetch(cfg.automodLogChannelId).catch(() => null);
            if (ch) await ch.send({
                embeds: [new EmbedBuilder()
                    .setTitle('🚫 Custom AutoMod Triggered')
                    .setColor(COLOR_BAD)
                    .addFields(
                        { name: 'User', value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
                        { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                        { name: 'Matched', value: `${match.type === 'word' ? 'Word' : 'Regex'}: \`${match.rule.slice(0,100)}\``, inline: false },
                        { name: 'Content', value: content.slice(0, 1000) || '*(empty)*', inline: false },
                        { name: 'Action', value: cfg.automodAction, inline: true },
                    ).setTimestamp()]
            });
        } catch {}
    }
    try { saveData(data); } catch {}
    return true;
}

// ══════════════════════════════════════════════════════════
//  SHARED USER-RESOLUTION HELPER  (mirrors "<@user|id>" style used
//  throughout the rest of DISCOMOD.js's prefix commands)
// ══════════════════════════════════════════════════════════
async function resolveUserArg(message, arg) {
    const mention = message.mentions.users.first();
    if (mention) return mention;
    if (!arg) return null;
    const idMatch = String(arg).match(/^<@!?(\d{15,20})>$/) || String(arg).match(/^(\d{15,20})$/);
    const id = idMatch ? idMatch[1] : null;
    if (!id) return null;
    return await message.client.users.fetch(id).catch(() => null);
}

// ══════════════════════════════════════════════════════════
//  ECONOMY GROUP — core logic (shared by slash + prefix)
// ══════════════════════════════════════════════════════════
function coreBalance(data, guildId, userId, gs) {
    const rec = ensureEconomy(data, guildId, userId);
    return { wallet: rec.wallet, bank: rec.bank, cap: getBankCapacity(rec, gs), net: netWorth(rec) };
}
function coreDeposit(data, guildId, userId, amountRaw, gs) {
    const rec = ensureEconomy(data, guildId, userId);
    const cap = getBankCapacity(rec, gs);
    let amount = parseBet(amountRaw, rec.wallet);
    if (amount === null) return { error: "That's not a valid amount." };
    if (amount <= 0) return { error: 'Enter an amount greater than 0.' };
    if (amount > rec.wallet) return { error: `You only have ${fmtBeli(rec.wallet)} in your wallet.` };
    const room = cap - rec.bank;
    if (room <= 0) return { error: `Your bank is already full (${fmtBeli(cap)} capacity — an Upgrade Vault tier raises this).` };
    if (amount > room) amount = room;
    removeWallet(rec, amount); addBank(rec, amount);
    return { amount, wallet: rec.wallet, bank: rec.bank, cap };
}
function coreWithdraw(data, guildId, userId, amountRaw) {
    const rec = ensureEconomy(data, guildId, userId);
    let amount = parseBet(amountRaw, rec.bank);
    if (amount === null) return { error: "That's not a valid amount." };
    if (amount <= 0) return { error: 'Enter an amount greater than 0.' };
    if (amount > rec.bank) return { error: `You only have ${fmtBeli(rec.bank)} in your bank.` };
    removeBank(rec, amount); addWallet(rec, amount);
    return { amount, wallet: rec.wallet, bank: rec.bank };
}
function corePay(data, guildId, fromId, toId, amountRaw) {
    if (fromId === toId) return { error: "You can't pay yourself." };
    const fromRec = ensureEconomy(data, guildId, fromId);
    let amount = parseBet(amountRaw, fromRec.wallet);
    if (amount === null) return { error: "That's not a valid amount." };
    if (amount <= 0) return { error: 'Enter an amount greater than 0.' };
    if (amount > fromRec.wallet) return { error: `You only have ${fmtBeli(fromRec.wallet)} in your wallet.` };
    const toRec = ensureEconomy(data, guildId, toId);
    removeWallet(fromRec, amount); addWallet(toRec, amount);
    return { amount, fromWallet: fromRec.wallet, toWallet: toRec.wallet };
}

function buildBalanceEmbed(targetUser, isSelf, bal) {
    return new EmbedBuilder()
        .setTitle(`${CURRENCY_EMOJI} ${isSelf ? 'Your' : `${targetUser.username}'s`} Balance`)
        .addFields(
            { name: 'Wallet', value: fmtBeli(bal.wallet), inline: true },
            { name: 'Bank', value: `${fmtBeli(bal.bank)} / ${fmtBeli(bal.cap)}`, inline: true },
            { name: 'Net Worth', value: fmtBeli(bal.net), inline: true },
        ).setColor(COLOR_INFO).setThumbnail(targetUser.displayAvatarURL());
}
async function buildLeaderboardEmbed(guild, data, guildId) {
    const rows = buildEconomyLeaderboard(data, guildId, 10);
    if (!rows.length) {
        return new EmbedBuilder().setTitle(`${CURRENCY_EMOJI} Beli Leaderboard`)
            .setDescription("Nobody has any Beli yet — be the first with `/beli earn daily`!").setColor(COLOR_INFO);
    }
    const lines = [];
    for (let i = 0; i < rows.length; i++) {
        const member = await guild.members.fetch(rows[i].uid).catch(() => null);
        const name = member ? member.user.username : `Unknown User`;
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        lines.push(`${medal} ${name} — ${fmtBeli(rows[i].net)}`);
    }
    return new EmbedBuilder().setTitle(`${CURRENCY_EMOJI} Beli Leaderboard — ${guild.name}`)
        .setDescription(lines.join('\n')).setColor(COLOR_GOLD).setTimestamp();
}
function buildProfileEmbed(targetUser, isSelf, rec) {
    const badges = SHOP_ITEMS.filter(i => i.type === 'cosmetic' && getItemQty(rec, i.id) > 0).map(i => i.emoji).join(' ') || 'None yet';
    const upgradeLines = UPGRADE_TRACK_KEYS.map(k => `${UPGRADE_TRACKS[k].label}: Tier ${getUpgradeTier(rec, k)}/${UPGRADE_TRACKS[k].maxTier}`).join('\n');
    const totalGames = rec.gamesPlayed || 0;
    const winRate = totalGames ? `${((rec.gamesWon / totalGames) * 100).toFixed(1)}%` : 'N/A';
    return new EmbedBuilder()
        .setTitle(`${isSelf ? 'Your' : `${targetUser.username}'s`} Profile`)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
            { name: '💰 Net Worth', value: fmtBeli(netWorth(rec)), inline: true },
            { name: '🔥 Daily Streak', value: `${rec.dailyStreak || 0} days`, inline: true },
            { name: '🎮 Gambling Record', value: `${rec.gamesWon || 0}W / ${totalGames - (rec.gamesWon || 0)}L (${winRate})`, inline: true },
            { name: '🦹 Rob Record', value: `${rec.robsWon || 0}W / ${rec.robsLost || 0}L`, inline: true },
            { name: '⚔️ Duel Record', value: `${rec.duelsWon || 0}W / ${rec.duelsLost || 0}L`, inline: true },
            { name: '🎖️ Badges', value: badges, inline: false },
            { name: '⬆️ Upgrades', value: upgradeLines, inline: false },
        ).setColor(COLOR_GOLD).setTimestamp();
}
function errEmbed(msg) { return new EmbedBuilder().setDescription(`❌ ${msg}`).setColor(COLOR_BAD); }
function okEmbed(title, msg) { return new EmbedBuilder().setTitle(title).setDescription(msg).setColor(COLOR_OK); }

// ── Slash handlers ───────────────────────────────────────────────────────
async function slashEconomyBalance(interaction, data, guildId) {
    const target = interaction.options.getUser('user') || interaction.user;
    const bal = coreBalance(data, guildId, target.id, data.guildSettings?.[guildId]);
    await interaction.reply({ embeds: [buildBalanceEmbed(target, target.id === interaction.user.id, bal)] });
}
async function slashEconomyLeaderboard(interaction, data, guildId, guild) {
    await interaction.deferReply();
    const embed = await buildLeaderboardEmbed(guild, data, guildId);
    await interaction.editReply({ embeds: [embed] });
}
async function slashEconomyDeposit(interaction, data, guildId) {
    const amountRaw = interaction.options.getString('amount');
    const res = coreDeposit(data, guildId, interaction.user.id, amountRaw, data.guildSettings?.[guildId]);
    if (res.error) return interaction.reply({ embeds: [errEmbed(res.error)], flags: 64 });
    await interaction.reply({ embeds: [okEmbed('🏦 Deposited', `Moved ${fmtBeli(res.amount)} into your bank.\nWallet: ${fmtBeli(res.wallet)} • Bank: ${fmtBeli(res.bank)}/${fmtBeli(res.cap)}`)] });
}
async function slashEconomyWithdraw(interaction, data, guildId) {
    const amountRaw = interaction.options.getString('amount');
    const res = coreWithdraw(data, guildId, interaction.user.id, amountRaw);
    if (res.error) return interaction.reply({ embeds: [errEmbed(res.error)], flags: 64 });
    await interaction.reply({ embeds: [okEmbed('🏦 Withdrew', `Moved ${fmtBeli(res.amount)} into your wallet.\nWallet: ${fmtBeli(res.wallet)} • Bank: ${fmtBeli(res.bank)}`)] });
}
async function slashEconomyPay(interaction, data, guildId) {
    const target = interaction.options.getUser('user');
    const amountRaw = interaction.options.getString('amount');
    if (target.bot) return interaction.reply({ embeds: [errEmbed("You can't pay a bot.")], flags: 64 });
    const res = corePay(data, guildId, interaction.user.id, target.id, amountRaw);
    if (res.error) return interaction.reply({ embeds: [errEmbed(res.error)], flags: 64 });
    await interaction.reply({ embeds: [okEmbed('💸 Payment Sent', `You sent ${fmtBeli(res.amount)} to <@${target.id}>.\nYour wallet: ${fmtBeli(res.fromWallet)}`)] });
}
async function slashEconomyProfile(interaction, data, guildId) {
    const target = interaction.options.getUser('user') || interaction.user;
    const rec = ensureEconomy(data, guildId, target.id);
    await interaction.reply({ embeds: [buildProfileEmbed(target, target.id === interaction.user.id, rec)] });
}

// ── Prefix handlers ──────────────────────────────────────────────────────
async function prefixEconomyBalance(message, data, guildId, args) {
    const target = await resolveUserArg(message, args[0]) || message.author;
    const bal = coreBalance(data, guildId, target.id, data.guildSettings?.[guildId]);
    await message.channel.send({ embeds: [buildBalanceEmbed(target, target.id === message.author.id, bal)] });
}
async function prefixEconomyLeaderboard(message, data, guildId) {
    const embed = await buildLeaderboardEmbed(message.guild, data, guildId);
    await message.channel.send({ embeds: [embed] });
}
async function prefixEconomyDeposit(message, data, guildId, args) {
    const res = coreDeposit(data, guildId, message.author.id, args[0], data.guildSettings?.[guildId]);
    if (res.error) return message.channel.send({ embeds: [errEmbed(res.error)] });
    await message.channel.send({ embeds: [okEmbed('🏦 Deposited', `Moved ${fmtBeli(res.amount)} into your bank.\nWallet: ${fmtBeli(res.wallet)} • Bank: ${fmtBeli(res.bank)}/${fmtBeli(res.cap)}`)] });
}
async function prefixEconomyWithdraw(message, data, guildId, args) {
    const res = coreWithdraw(data, guildId, message.author.id, args[0]);
    if (res.error) return message.channel.send({ embeds: [errEmbed(res.error)] });
    await message.channel.send({ embeds: [okEmbed('🏦 Withdrew', `Moved ${fmtBeli(res.amount)} into your wallet.\nWallet: ${fmtBeli(res.wallet)} • Bank: ${fmtBeli(res.bank)}`)] });
}
async function prefixEconomyPay(message, data, guildId, args) {
    const target = await resolveUserArg(message, args[0]);
    if (!target) return message.channel.send({ embeds: [errEmbed('Mention a valid user or give their ID.')] });
    if (target.bot) return message.channel.send({ embeds: [errEmbed("You can't pay a bot.")] });
    const amountArg = message.mentions.users.size ? args[1] : args[1];
    const res = corePay(data, guildId, message.author.id, target.id, amountArg);
    if (res.error) return message.channel.send({ embeds: [errEmbed(res.error)] });
    await message.channel.send({ embeds: [okEmbed('💸 Payment Sent', `You sent ${fmtBeli(res.amount)} to <@${target.id}>.\nYour wallet: ${fmtBeli(res.fromWallet)}`)] });
}
async function prefixEconomyProfile(message, data, guildId, args) {
    const target = await resolveUserArg(message, args[0]) || message.author;
    const rec = ensureEconomy(data, guildId, target.id);
    await message.channel.send({ embeds: [buildProfileEmbed(target, target.id === message.author.id, rec)] });
}

// ══════════════════════════════════════════════════════════
//  EARN GROUP — tuning constants + core logic
// ══════════════════════════════════════════════════════════
const WORK_MIN = 150, WORK_MAX = 500;
const CRIME_MIN = 300, CRIME_MAX = 1200, CRIME_SUCCESS_CHANCE = 0.55;
const CRIME_FINE_MIN = 0.10, CRIME_FINE_MAX = 0.20;
const ROB_SUCCESS_BASE = 0.35, ROB_STEAL_MIN = 0.15, ROB_STEAL_MAX = 0.30;
const ROB_MIN_VICTIM_WALLET = 200, ROB_FAIL_FINE_PCT = 0.10;

function earnBoostMult(rec) { return isBoostActive(rec, 'earn') ? SHOP_ITEMS.find(i => i.boost === 'earn').mult : 1; }
function gambleBoostBonus(rec) { return isBoostActive(rec, 'gamble') ? SHOP_ITEMS.find(i => i.boost === 'gamble').mult : 0; }

// Per-guild overrides for Daily/Weekly — the two earn actions with no RNG/odds
// involved, which is why they're first. gs is optional and defaults preserve
// the exact original hard-coded numbers, so a guild that's never touched this
// config sees byte-identical behavior to before this change.
function getEconomyEarnConfig(gs) {
    const c = gs?.beliEarn || {};
    return {
        dailyBase: Number.isFinite(c.dailyBase) ? c.dailyBase : 1000,
        dailyStreakCap: Number.isFinite(c.dailyStreakCap) ? c.dailyStreakCap : 2000,
        dailyStreakStep: Number.isFinite(c.dailyStreakStep) ? c.dailyStreakStep : 100,
        dailyCooldownMs: Number.isFinite(c.dailyCooldownMs) ? c.dailyCooldownMs : COOLDOWNS_MS.daily,
        weeklyBase: Number.isFinite(c.weeklyBase) ? c.weeklyBase : 5000,
        weeklyCooldownMs: Number.isFinite(c.weeklyCooldownMs) ? c.weeklyCooldownMs : COOLDOWNS_MS.weekly,
        workMin: Number.isFinite(c.workMin) ? c.workMin : WORK_MIN,
        workMax: Number.isFinite(c.workMax) ? c.workMax : WORK_MAX,
        workCooldownMs: Number.isFinite(c.workCooldownMs) ? c.workCooldownMs : COOLDOWNS_MS.work,
        crimeSuccessChance: Number.isFinite(c.crimeSuccessChance) ? Math.max(0, Math.min(0.9, c.crimeSuccessChance)) : CRIME_SUCCESS_CHANCE,
        crimeMin: Number.isFinite(c.crimeMin) ? c.crimeMin : CRIME_MIN,
        crimeMax: Number.isFinite(c.crimeMax) ? c.crimeMax : CRIME_MAX,
        crimeFineMin: Number.isFinite(c.crimeFineMin) ? Math.max(0, Math.min(1, c.crimeFineMin)) : CRIME_FINE_MIN,
        crimeFineMax: Number.isFinite(c.crimeFineMax) ? Math.max(0, Math.min(1, c.crimeFineMax)) : CRIME_FINE_MAX,
        crimeCooldownMs: Number.isFinite(c.crimeCooldownMs) ? c.crimeCooldownMs : COOLDOWNS_MS.crime,
        fishLoot: mergeLootTable(c.fishLoot, FISH_LOOT),
        huntLoot: mergeLootTable(c.huntLoot, HUNT_LOOT),
        wheelSegments: mergeWeightTable(c.wheelSegments, WHEEL_SEGMENTS),
        slotSymbols: mergeWeightTable(c.slotSymbols, SLOT_SYMBOLS),
        // Limbo's whole house edge lives in this one constant — the roll
        // formula is `RTP / uniform_random(0,1)`, so RTP IS the long-run
        // return-to-player fraction (0.97 = 97% RTP = 3% house edge).
        // Bounded well short of 1.0 (break-even) and 0 (nonsensical).
        limboRTP: Number.isFinite(c.limboRTP) ? Math.max(0.5, Math.min(0.99, c.limboRTP)) : 0.97,
        robSuccessChance: Number.isFinite(c.robSuccessChance) ? Math.max(0.05, Math.min(0.85, c.robSuccessChance)) : ROB_SUCCESS_BASE,
        robStealMin: Number.isFinite(c.robStealMin) ? Math.max(0, Math.min(1, c.robStealMin)) : ROB_STEAL_MIN,
        robStealMax: Number.isFinite(c.robStealMax) ? Math.max(0, Math.min(1, c.robStealMax)) : ROB_STEAL_MAX,
        robFailFinePct: Number.isFinite(c.robFailFinePct) ? Math.max(0, Math.min(1, c.robFailFinePct)) : ROB_FAIL_FINE_PCT,
        robMinVictimWallet: Number.isFinite(c.robMinVictimWallet) ? Math.max(0, c.robMinVictimWallet) : ROB_MIN_VICTIM_WALLET,
        robCooldownMs: Number.isFinite(c.robCooldownMs) ? c.robCooldownMs : COOLDOWNS_MS.rob,
        triviaMin: Number.isFinite(c.triviaMin) ? c.triviaMin : 200,
        triviaMax: Number.isFinite(c.triviaMax) ? c.triviaMax : 500,
        triviaAnswerWindowMs: Number.isFinite(c.triviaAnswerWindowMs) ? c.triviaAnswerWindowMs : 60000,
        triviaCooldownMs: Number.isFinite(c.triviaCooldownMs) ? c.triviaCooldownMs : COOLDOWNS_MS.trivia,
        ...(() => {
            const rawWinChance = Number.isFinite(c.coinflipWinChance) ? Math.max(0.05, Math.min(0.9, c.coinflipWinChance)) : 0.475;
            const payoutMult = Number.isFinite(c.coinflipPayoutMult) ? Math.max(1, Math.min(3, c.coinflipPayoutMult)) : 1.95;
            return { coinflipWinChance: clampHouseEdge(rawWinChance, payoutMult), coinflipPayoutMult: payoutMult };
        })(),
        ...(() => {
            // Dice's true odds are fixed at 1-in-6 (six-sided, one guess) —
            // only the "edge factor" applied on top and the payout multiplier
            // are configurable. clampHouseEdge takes an effective win chance,
            // so it's computed here as (1/6 * edgeFactor) before being passed
            // through, same protection as coinflip against either direction
            // of misconfiguration.
            const edgeFactor = Number.isFinite(c.diceEdgeFactor) ? Math.max(0.5, Math.min(1, c.diceEdgeFactor)) : 0.92;
            const payoutMult = Number.isFinite(c.dicePayoutMult) ? Math.max(1, Math.min(10, c.dicePayoutMult)) : 5;
            const rawWinChance = Math.min(0.5, (1 / 6) * edgeFactor);
            const safeWinChance = clampHouseEdge(rawWinChance, payoutMult);
            return { diceWinChance: Math.min(0.5, safeWinChance), dicePayoutMult: payoutMult };
        })(),
        ...(() => {
            // Roulette bundles two genuinely different bets with very
            // different INTENDED house edges — color (~12.7%, even-money-ish)
            // and number/green (~65.2%, high-payout-low-probability, same
            // logic as real roulette's single-number bet being much steeper
            // than red/black). clampHouseEdge's 0-40% band is wrong for the
            // number bet by design, not by oversight — so this only guards
            // against the one thing that's ALWAYS wrong regardless of bet
            // type: a negative edge (guaranteed player profit) or an edge so
            // extreme (>90%) it's not a "steep bet," it's a broken one.
            const guardWide = (winChance, payoutMult) => {
                const edge = 1 - winChance * payoutMult;
                if (edge >= -0.02 && edge <= 0.90) return winChance;
                const targetEdge = edge < -0.02 ? 0.05 : 0.90;
                return Math.max(0.01, Math.min(0.9, (1 - targetEdge) / payoutMult));
            };
            const colorEdgeFactor = Number.isFinite(c.rouletteColorEdgeFactor) ? Math.max(0.5, Math.min(1, c.rouletteColorEdgeFactor)) : 0.92;
            const colorPayoutMult = Number.isFinite(c.rouletteColorPayoutMult) ? Math.max(1, Math.min(3, c.rouletteColorPayoutMult)) : 1.95;
            const numberEdgeFactor = Number.isFinite(c.rouletteNumberEdgeFactor) ? Math.max(0.5, Math.min(1, c.rouletteNumberEdgeFactor)) : 0.92;
            const numberPayoutMult = Number.isFinite(c.rouletteNumberPayoutMult) ? Math.max(1, Math.min(36, c.rouletteNumberPayoutMult)) : 14;
            return {
                rouletteColorWinChance: guardWide(Math.min(0.5, (18 / 37) * colorEdgeFactor), colorPayoutMult),
                rouletteColorPayoutMult: colorPayoutMult,
                rouletteNumberWinChance: guardWide(Math.min(0.5, (1 / 37) * numberEdgeFactor), numberPayoutMult),
                rouletteNumberPayoutMult: numberPayoutMult,
            };
        })(),
        ...(() => {
            const rawWinChance = Number.isFinite(c.higherLowerWinChance) ? Math.max(0.05, Math.min(0.55, c.higherLowerWinChance)) : 0.46;
            const payoutMult = Number.isFinite(c.higherLowerPayoutMult) ? Math.max(1, Math.min(3, c.higherLowerPayoutMult)) : 1.9;
            return { higherLowerWinChance: Math.min(0.55, clampHouseEdge(rawWinChance, payoutMult)), higherLowerPayoutMult: payoutMult };
        })(),
        // Advanced games — bounded, backwards-compatible defaults. These preserve
        // the original constants for untouched guilds while making the remaining
        // games genuinely configurable through the same per-guild pipeline.
        minesMaxMines: Number.isFinite(c.minesMaxMines) ? Math.max(1, Math.min(19, Math.floor(c.minesMaxMines))) : 19,
        minesGrowthFactor: Number.isFinite(c.minesGrowthFactor) ? Math.max(0.5, Math.min(1.5, c.minesGrowthFactor)) : 0.97,
        crashGrowthRate: Number.isFinite(c.crashGrowthRate) ? Math.max(0.01, Math.min(1, c.crashGrowthRate)) : CRASH_GROWTH_RATE,
        crashRtp: Number.isFinite(c.crashRtp) ? Math.max(0.50, Math.min(0.99, c.crashRtp)) : 0.97,
        crashMaxMultiplier: Number.isFinite(c.crashMaxMultiplier) ? Math.max(2, Math.min(10000, c.crashMaxMultiplier)) : 1000,
        scratchSymbols: mergeWeightTable(c.scratchSymbols, SCRATCH_SYMBOLS),
        scratchCells: Number.isFinite(c.scratchCells) ? Math.max(3, Math.min(9, Math.floor(c.scratchCells))) : 5,
        lotteryTicketPrice: Number.isFinite(c.lotteryTicketPrice) ? Math.max(1, Math.min(1000000, Math.floor(c.lotteryTicketPrice))) : LOTTERY_TICKET_PRICE,
        lotteryIntervalMs: Number.isFinite(c.lotteryIntervalMs) ? Math.max(5 * 60 * 1000, Math.min(30 * 24 * 60 * 60 * 1000, Math.floor(c.lotteryIntervalMs))) : LOTTERY_DRAW_INTERVAL_MS,
        blackjackNaturalMult: Number.isFinite(c.blackjackNaturalMult) ? Math.max(1, Math.min(5, c.blackjackNaturalMult)) : 2.5,
        blackjackWinMult: Number.isFinite(c.blackjackWinMult) ? Math.max(1, Math.min(3, c.blackjackWinMult)) : 2,
        blackjackDealerStandAt: Number.isFinite(c.blackjackDealerStandAt) ? Math.max(15, Math.min(21, Math.floor(c.blackjackDealerStandAt))) : 17,
        kenoLowMult: Number.isFinite(c.kenoLowMult) ? Math.max(0, Math.min(10, c.kenoLowMult)) : 0.4,
        kenoMidMult: Number.isFinite(c.kenoMidMult) ? Math.max(0, Math.min(20, c.kenoMidMult)) : 1.2,
        kenoHighMult: Number.isFinite(c.kenoHighMult) ? Math.max(0, Math.min(50, c.kenoHighMult)) : 3,
        kenoLuckPayoutMult: Number.isFinite(c.kenoLuckPayoutMult) ? Math.max(0, Math.min(5, c.kenoLuckPayoutMult)) : 0.3,
        warPushChance: Number.isFinite(c.warPushChance) ? Math.max(0, Math.min(0.5, c.warPushChance)) : 0.06,
        warWinMult: Number.isFinite(c.warWinMult) ? Math.max(1, Math.min(5, c.warWinMult)) : 1.95,
        duelHouseCutPct: Number.isFinite(c.duelHouseCutPct) ? Math.max(0, Math.min(0.25, c.duelHouseCutPct)) : 0.05,
        duelExpiryMs: Number.isFinite(c.duelExpiryMs) ? Math.max(30 * 1000, Math.min(60 * 60 * 1000, Math.floor(c.duelExpiryMs))) : DUEL_EXPIRY_MS,
    };
}
// A house edge outside roughly [-2%, 40%] almost certainly means a
// misconfiguration (negative = the game pays out more than it takes in on
// average, guaranteeing player profit over time; 40%+ is predatory even by
// casual-server standards) — bump the win chance back toward a sane edge
// rather than trusting whatever combination was saved. Small negative
// tolerance (-2%) exists so intentionally generous-but-still-house-favored
// configs aren't blocked by floating-point boundary cases.
function clampHouseEdge(winChance, payoutMult) {
    const edge = 1 - winChance * payoutMult;
    if (edge >= -0.02 && edge <= 0.40) return winChance;
    const targetEdge = edge < -0.02 ? 0.05 : 0.40;
    return Math.max(0.05, Math.min(0.9, (1 - targetEdge) / payoutMult));
}

// Merges a saved per-guild loot table with the real defaults tier-by-tier —
// only weight/min/max are ever overridable; rarity name and flavor-text
// `names` always come from the bot's own table, never from saved config, so
// a guild's override can't rename a rarity tier or inject arbitrary text
// into what's essentially a reward-flavor string shown to players. If the
// saved table is missing a tier, malformed, or the wrong length, that tier
// (or the whole table) just falls back to the real default rather than
// producing a shorter/broken table pickWeighted could mishandle.
function mergeLootTable(saved, defaults) {
    if (!Array.isArray(saved) || saved.length !== defaults.length) return defaults;
    return defaults.map((tier, i) => {
        const s = saved[i];
        if (!s || typeof s !== 'object') return tier;
        const weight = Number.isFinite(s.weight) ? Math.max(0, s.weight) : tier.weight;
        const min = Number.isFinite(s.min) ? Math.max(0, s.min) : tier.min;
        const maxRaw = Number.isFinite(s.max) ? Math.max(0, s.max) : tier.max;
        return { ...tier, weight, min: Math.min(min, maxRaw), max: Math.max(min, maxRaw) };
    });
}
// Merges a saved per-guild Wheel segment table with the real defaults,
// segment-by-segment — only mult/weight are ever overridable; label always
// comes from the bot's own table, never saved config, same protection
// mergeLootTable gives fish/hunt tiers (a guild override can't rename or
// relabel a segment). A missing/malformed/wrong-length saved table falls
// back to the full default table rather than producing a shorter or
// reordered wheel pickWeighted() could mishandle.
function mergeWeightTable(saved, defaults) {
    if (!Array.isArray(saved) || saved.length !== defaults.length) return defaults;
    return defaults.map((seg, i) => {
        const s = saved[i];
        if (!s || typeof s !== 'object') return seg;
        const mult = Number.isFinite(s.mult) ? Math.max(0, s.mult) : seg.mult;
        const weight = Number.isFinite(s.weight) ? Math.max(0, s.weight) : seg.weight;
        return { ...seg, mult, weight };
    });
}
function coreDaily(rec, ec = getEconomyEarnConfig(null)) {
    const remaining = cooldownRemaining(rec, 'daily', ec.dailyCooldownMs);
    if (remaining > 0) return { error: `Come back in ${fmtDuration(remaining)}.` };
    const last = rec.cooldowns?.daily || 0;
    const withinStreak = last && (Date.now() - last) < ec.dailyCooldownMs * 2;
    rec.dailyStreak = withinStreak ? (rec.dailyStreak || 0) + 1 : 1;
    const streakBonus = Math.min(ec.dailyStreakCap, (rec.dailyStreak - 1) * ec.dailyStreakStep);
    const amount = Math.round((ec.dailyBase + streakBonus) * getIncomeMultiplier(rec));
    addWallet(rec, amount);
    setCooldown(rec, 'daily');
    return { amount, streak: rec.dailyStreak, wallet: rec.wallet };
}
function coreWeekly(rec, ec = getEconomyEarnConfig(null)) {
    const remaining = cooldownRemaining(rec, 'weekly', ec.weeklyCooldownMs);
    if (remaining > 0) return { error: `Come back in ${fmtDuration(remaining)}.` };
    const amount = Math.round(ec.weeklyBase * getIncomeMultiplier(rec));
    addWallet(rec, amount);
    setCooldown(rec, 'weekly');
    return { amount, wallet: rec.wallet };
}
function coreWork(rec, ec = getEconomyEarnConfig(null)) {
    const remaining = cooldownRemaining(rec, 'work', ec.workCooldownMs);
    if (remaining > 0) return { error: `You're tired — rest for ${fmtDuration(remaining)}.` };
    setCooldown(rec, 'work');
    const lo = Math.min(ec.workMin, ec.workMax), hi = Math.max(ec.workMin, ec.workMax);
    const base = lo + Math.random() * (hi - lo);
    const amount = Math.round(base * getIncomeMultiplier(rec) * earnBoostMult(rec));
    addWallet(rec, amount);
    const text = WORK_SCENARIOS[Math.floor(Math.random() * WORK_SCENARIOS.length)].replace('{amount}', fmtBeli(amount));
    return { amount, wallet: rec.wallet, text };
}
function coreCrime(rec, ec = getEconomyEarnConfig(null)) {
    const remaining = cooldownRemaining(rec, 'crime', ec.crimeCooldownMs);
    if (remaining > 0) return { error: `Lay low for ${fmtDuration(remaining)} first.` };
    setCooldown(rec, 'crime');
    const chance = Math.min(0.9, ec.crimeSuccessChance + getLuckBonus(rec) + gambleBoostBonus(rec));
    if (Math.random() < chance) {
        const lo = Math.min(ec.crimeMin, ec.crimeMax), hi = Math.max(ec.crimeMin, ec.crimeMax);
        const amount = Math.round((lo + Math.random() * (hi - lo)) * getIncomeMultiplier(rec) * earnBoostMult(rec));
        addWallet(rec, amount);
        const text = CRIME_SUCCESS[Math.floor(Math.random() * CRIME_SUCCESS.length)].replace('{amount}', fmtBeli(amount));
        return { success: true, amount, wallet: rec.wallet, text };
    }
    const fLo = Math.min(ec.crimeFineMin, ec.crimeFineMax), fHi = Math.max(ec.crimeFineMin, ec.crimeFineMax);
    const fine = Math.round(rec.wallet * (fLo + Math.random() * (fHi - fLo)));
    removeWallet(rec, fine);
    const text = CRIME_FAIL[Math.floor(Math.random() * CRIME_FAIL.length)].replace('{amount}', fmtBeli(fine));
    return { success: false, amount: fine, wallet: rec.wallet, text };
}
function coreGather(rec, action, lootTable, rawCooldown) {
    const remaining = cooldownRemaining(rec, action, rawCooldown);
    if (remaining > 0) return { error: `Wait ${fmtDuration(remaining)} before you ${action} again.` };
    setCooldown(rec, action);
    let tier, usedMap = false;
    if (isBoostActive(rec, 'map')) { tier = lootTable[lootTable.length - 1]; clearBoost(rec, 'map'); usedMap = true; }
    else tier = pickWeighted(lootTable);
    const amount = Math.round((tier.min + Math.random() * (tier.max - tier.min)) * getIncomeMultiplier(rec) * earnBoostMult(rec));
    addWallet(rec, amount);
    const itemName = tier.names[Math.floor(Math.random() * tier.names.length)];
    return { amount, wallet: rec.wallet, rarity: tier.rarity, itemName, usedMap };
}

const activeTrivia = new Map(); // `${guildId}:${userId}` -> { qIndex, expiresAt }
function coreTriviaStart(rec, guildId, userId, ec = getEconomyEarnConfig(null)) {
    const remaining = cooldownRemaining(rec, 'trivia', ec.triviaCooldownMs);
    if (remaining > 0) return { error: `Wait ${fmtDuration(remaining)}.` };
    setCooldown(rec, 'trivia');
    const qIndex = Math.floor(Math.random() * TRIVIA_QUESTIONS.length);
    activeTrivia.set(`${guildId}:${userId}`, { qIndex, expiresAt: Date.now() + ec.triviaAnswerWindowMs });
    return { question: TRIVIA_QUESTIONS[qIndex], answerWindowMs: ec.triviaAnswerWindowMs };
}
function coreTriviaAnswer(rec, guildId, userId, letterRaw, ec = getEconomyEarnConfig(null)) {
    const key = `${guildId}:${userId}`;
    const active = activeTrivia.get(key);
    if (!active || active.expiresAt < Date.now()) { activeTrivia.delete(key); return { error: 'No active question — start one first.' }; }
    const idx = ['A', 'B', 'C', 'D'].indexOf(String(letterRaw || '').trim().toUpperCase());
    if (idx === -1) return { error: 'Answer with A, B, C, or D.' };
    activeTrivia.delete(key);
    const q = TRIVIA_QUESTIONS[active.qIndex];
    rec.gamesPlayed = (rec.gamesPlayed || 0) + 1;
    if (idx === q.correct) {
        rec.gamesWon = (rec.gamesWon || 0) + 1;
        const lo = Math.min(ec.triviaMin, ec.triviaMax), hi = Math.max(ec.triviaMin, ec.triviaMax);
        const amount = Math.round((lo + Math.random() * (hi - lo)) * getIncomeMultiplier(rec));
        addWallet(rec, amount);
        return { correct: true, amount, wallet: rec.wallet, correctChoice: q.choices[q.correct] };
    }
    return { correct: false, wallet: rec.wallet, correctChoice: q.choices[q.correct] };
}
function coreRob(data, guildId, robberId, victimId, ec = getEconomyEarnConfig(null)) {
    if (robberId === victimId) return { error: "You can't rob yourself." };
    const robberRec = ensureEconomy(data, guildId, robberId);
    const remaining = cooldownRemaining(robberRec, 'rob', ec.robCooldownMs);
    if (remaining > 0) return { error: `Lay low for ${fmtDuration(remaining)} before your next heist.` };
    const victimRec = ensureEconomy(data, guildId, victimId);
    if (isBoostActive(victimRec, 'shield')) return { error: 'That player has an active Rob Shield — try someone else.' };
    if (victimRec.wallet < ec.robMinVictimWallet) return { error: `They don't have enough on hand to be worth robbing (need ${fmtBeli(ec.robMinVictimWallet)}+ in wallet).` };
    setCooldown(robberRec, 'rob');
    const chance = Math.max(0.05, Math.min(0.85, ec.robSuccessChance + getLuckBonus(robberRec) - getSecurityBonus(victimRec)));
    if (Math.random() < chance) {
        const lo = Math.min(ec.robStealMin, ec.robStealMax), hi = Math.max(ec.robStealMin, ec.robStealMax);
        const amount = Math.round(victimRec.wallet * (lo + Math.random() * (hi - lo)));
        removeWallet(victimRec, amount); addWallet(robberRec, amount);
        robberRec.robsWon = (robberRec.robsWon || 0) + 1; victimRec.robsLost = (victimRec.robsLost || 0) + 1;
        return { success: true, amount, robberWallet: robberRec.wallet };
    }
    const fine = Math.round(robberRec.wallet * ec.robFailFinePct);
    removeWallet(robberRec, fine); robberRec.robsLost = (robberRec.robsLost || 0) + 1;
    return { success: false, amount: fine, robberWallet: robberRec.wallet };
}

// ── Slash handlers ───────────────────────────────────────────────────────
async function slashEarnDaily(interaction, data, guildId, gs) {
    const rec = ensureEconomy(data, guildId, interaction.user.id);
    const r = coreDaily(rec, getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [okEmbed('☀️ Daily Claimed', `You earned ${fmtBeli(r.amount)} (streak: ${r.streak} days).\nWallet: ${fmtBeli(r.wallet)}`)] });
}
async function slashEarnWeekly(interaction, data, guildId, gs) {
    const rec = ensureEconomy(data, guildId, interaction.user.id);
    const r = coreWeekly(rec, getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [okEmbed('📅 Weekly Claimed', `You earned ${fmtBeli(r.amount)}.\nWallet: ${fmtBeli(r.wallet)}`)] });
}
async function slashEarnWork(interaction, data, guildId, gs) {
    const rec = ensureEconomy(data, guildId, interaction.user.id);
    const r = coreWork(rec, getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [okEmbed('💼 Work Complete', `${r.text}\nWallet: ${fmtBeli(r.wallet)}`)] });
}
async function slashEarnCrime(interaction, data, guildId, gs) {
    const rec = ensureEconomy(data, guildId, interaction.user.id);
    const r = coreCrime(rec, getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle(r.success ? '🦹 Crime Successful' : '🚨 Busted').setDescription(`${r.text}\nWallet: ${fmtBeli(r.wallet)}`).setColor(r.success ? COLOR_OK : COLOR_BAD)] });
}
async function slashEarnGather(interaction, data, guildId, gs, action, lootTable, title, verb) {
    const rec = ensureEconomy(data, guildId, interaction.user.id);
    const ec = getEconomyEarnConfig(gs);
    const resolvedTable = action === 'fish' ? ec.fishLoot : action === 'hunt' ? ec.huntLoot : lootTable;
    const r = coreGather(rec, action, resolvedTable, COOLDOWNS_MS[action]);
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    const mapNote = r.usedMap ? '\n🗺️ Your Treasure Map guaranteed this catch!' : '';
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle(title).setDescription(`You ${verb} **${r.itemName}** (${r.rarity}) worth ${fmtBeli(r.amount)}!${mapNote}\nWallet: ${fmtBeli(r.wallet)}`).setColor(COLOR_OK)] });
}
async function slashEarnTrivia(interaction, data, guildId, gs) {
    const rec = ensureEconomy(data, guildId, interaction.user.id);
    const r = coreTriviaStart(rec, guildId, interaction.user.id, getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    const opts = ['A', 'B', 'C', 'D'].map((l, i) => `**${l}.** ${r.question.choices[i]}`).join('\n');
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('❓ Blox Fruits Trivia').setDescription(`${r.question.q}\n\n${opts}\n\nAnswer with \`/beli earn trivia-answer\` within ${Math.round(r.answerWindowMs / 1000)} seconds.`).setColor(COLOR_INFO)] });
}
async function slashEarnTriviaAnswer(interaction, data, guildId, gs) {
    const rec = ensureEconomy(data, guildId, interaction.user.id);
    const letter = interaction.options.getString('answer');
    const r = coreTriviaAnswer(rec, guildId, interaction.user.id, letter, getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle(r.correct ? '✅ Correct!' : '❌ Incorrect').setDescription(`${r.correct ? `You earned ${fmtBeli(r.amount)}!` : `The correct answer was **${r.correctChoice}**.`}\nWallet: ${fmtBeli(r.wallet)}`).setColor(r.correct ? COLOR_OK : COLOR_BAD)] });
}
async function slashEarnRob(interaction, data, guildId, gs) {
    const target = interaction.options.getUser('user');
    if (target.bot) return interaction.reply({ embeds: [errEmbed("You can't rob a bot.")], flags: 64 });
    if (target.id === interaction.user.id) return interaction.reply({ embeds: [errEmbed("You can't rob yourself.")], flags: 64 });
    const r = coreRob(data, guildId, interaction.user.id, target.id, getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle(r.success ? '🦹 Heist Successful' : '🚔 Caught!')
        .setDescription(r.success ? `You stole ${fmtBeli(r.amount)} from <@${target.id}>!\nWallet: ${fmtBeli(r.robberWallet)}` : `You got caught trying to rob <@${target.id}> and paid a ${fmtBeli(r.amount)} fine.\nWallet: ${fmtBeli(r.robberWallet)}`)
        .setColor(r.success ? COLOR_OK : COLOR_BAD)] });
}

// ── Prefix handlers ──────────────────────────────────────────────────────
async function prefixEarnDaily(message, data, guildId, gs) {
    const r = coreDaily(ensureEconomy(data, guildId, message.author.id), getEconomyEarnConfig(gs));
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [okEmbed('☀️ Daily Claimed', `You earned ${fmtBeli(r.amount)} (streak: ${r.streak} days).\nWallet: ${fmtBeli(r.wallet)}`)] });
}
async function prefixEarnWeekly(message, data, guildId, gs) {
    const r = coreWeekly(ensureEconomy(data, guildId, message.author.id), getEconomyEarnConfig(gs));
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [okEmbed('📅 Weekly Claimed', `You earned ${fmtBeli(r.amount)}.\nWallet: ${fmtBeli(r.wallet)}`)] });
}
async function prefixEarnWork(message, data, guildId, gs) {
    const r = coreWork(ensureEconomy(data, guildId, message.author.id), getEconomyEarnConfig(gs));
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [okEmbed('💼 Work Complete', `${r.text}\nWallet: ${fmtBeli(r.wallet)}`)] });
}
async function prefixEarnCrime(message, data, guildId, gs) {
    const r = coreCrime(ensureEconomy(data, guildId, message.author.id), getEconomyEarnConfig(gs));
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [new EmbedBuilder().setTitle(r.success ? '🦹 Crime Successful' : '🚨 Busted').setDescription(`${r.text}\nWallet: ${fmtBeli(r.wallet)}`).setColor(r.success ? COLOR_OK : COLOR_BAD)] });
}
async function prefixEarnGather(message, data, guildId, gs, action, lootTable, title, verb) {
    const ec = getEconomyEarnConfig(gs);
    const resolvedTable = action === 'fish' ? ec.fishLoot : action === 'hunt' ? ec.huntLoot : lootTable;
    const r = coreGather(ensureEconomy(data, guildId, message.author.id), action, resolvedTable, COOLDOWNS_MS[action]);
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    const mapNote = r.usedMap ? '\n🗺️ Your Treasure Map guaranteed this catch!' : '';
    await message.channel.send({ embeds: [new EmbedBuilder().setTitle(title).setDescription(`You ${verb} **${r.itemName}** (${r.rarity}) worth ${fmtBeli(r.amount)}!${mapNote}\nWallet: ${fmtBeli(r.wallet)}`).setColor(COLOR_OK)] });
}
async function prefixEarnTrivia(message, data, guildId, gs, args) {
    const rec = ensureEconomy(data, guildId, message.author.id);
    const ec = getEconomyEarnConfig(gs);
    if (args[0]) {
        const r = coreTriviaAnswer(rec, guildId, message.author.id, args[0], ec);
        if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
        return message.channel.send({ embeds: [new EmbedBuilder().setTitle(r.correct ? '✅ Correct!' : '❌ Incorrect').setDescription(`${r.correct ? `You earned ${fmtBeli(r.amount)}!` : `The correct answer was **${r.correctChoice}**.`}\nWallet: ${fmtBeli(r.wallet)}`).setColor(r.correct ? COLOR_OK : COLOR_BAD)] });
    }
    const r = coreTriviaStart(rec, guildId, message.author.id, ec);
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    const opts = ['A', 'B', 'C', 'D'].map((l, i) => `**${l}.** ${r.question.choices[i]}`).join('\n');
    await message.channel.send({ embeds: [new EmbedBuilder().setTitle('❓ Blox Fruits Trivia').setDescription(`${r.question.q}\n\n${opts}\n\nAnswer with \`!trivia <letter>\` within ${Math.round(r.answerWindowMs / 1000)} seconds.`).setColor(COLOR_INFO)] });
}
async function prefixEarnRob(message, data, guildId, gs, args) {
    const target = await resolveUserArg(message, args[0]);
    if (!target) return message.channel.send({ embeds: [errEmbed('Mention a valid user or give their ID.')] });
    if (target.bot) return message.channel.send({ embeds: [errEmbed("You can't rob a bot.")] });
    const r = coreRob(data, guildId, message.author.id, target.id, getEconomyEarnConfig(gs));
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [new EmbedBuilder().setTitle(r.success ? '🦹 Heist Successful' : '🚔 Caught!')
        .setDescription(r.success ? `You stole ${fmtBeli(r.amount)} from <@${target.id}>!\nWallet: ${fmtBeli(r.robberWallet)}` : `You got caught trying to rob <@${target.id}> and paid a ${fmtBeli(r.amount)} fine.\nWallet: ${fmtBeli(r.robberWallet)}`)
        .setColor(r.success ? COLOR_OK : COLOR_BAD)] });
}

// ══════════════════════════════════════════════════════════
//  GAMBLE GROUP — core game logic
//  (every game rolls WIN/LOSE first against a probability that already
//  bakes in a small house edge + luck/boost bonuses, then generates a
//  flavor result consistent with that outcome — standard pattern for
//  this kind of virtual-currency minigame, keeps upgrades meaningful)
// ══════════════════════════════════════════════════════════
function coreSlots(rec, betRaw, ec = getEconomyEarnConfig(null)) {
    let bet = parseBet(betRaw, rec.wallet);
    if (bet === null) return { error: "That's not a valid bet." };
    if (bet <= 0) return { error: 'Bet must be greater than 0.' };
    if (bet > rec.wallet) return { error: `You only have ${fmtBeli(rec.wallet)}.` };
    removeWallet(rec, bet);
    rec.gamesPlayed = (rec.gamesPlayed || 0) + 1;
    const symbols = ec.slotSymbols;
    const luckEdge = getLuckBonus(rec) + gambleBoostBonus(rec);
    let reels = [spinReel(symbols), spinReel(symbols), spinReel(symbols)];
    if (luckEdge > 0 && Math.random() < luckEdge * 3) {
        const counts = {};
        reels.forEach(r => counts[r.sym] = (counts[r.sym] || 0) + 1);
        const [majoritySym, majorityCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (majorityCount === 2) {
            const majorityObj = symbols.find(s => s.sym === majoritySym);
            reels = reels.map(r => r.sym === majoritySym ? r : majorityObj);
        }
    }
    let mult = 0;
    if (reels[0].sym === reels[1].sym && reels[1].sym === reels[2].sym) mult = reels[0].mult;
    else if (reels[0].sym === reels[1].sym || reels[1].sym === reels[2].sym || reels[0].sym === reels[2].sym) mult = 0.5;
    const payout = Math.round(bet * mult);
    if (payout > 0) addWallet(rec, payout);
    if (payout > bet) rec.gamesWon = (rec.gamesWon || 0) + 1;
    return { bet, payout, win: payout > bet, reels: reels.map(r => r.sym), wallet: rec.wallet, net: payout - bet };
}

function coreCoinflip(rec, betRaw, choiceRaw, ec = getEconomyEarnConfig(null)) {
    let bet = parseBet(betRaw, rec.wallet);
    if (bet === null) return { error: "That's not a valid bet." };
    if (bet <= 0) return { error: 'Bet must be greater than 0.' };
    if (bet > rec.wallet) return { error: `You only have ${fmtBeli(rec.wallet)}.` };
    const side = String(choiceRaw || '').toLowerCase() === 'tails' ? 'tails' : 'heads';
    removeWallet(rec, bet);
    rec.gamesPlayed = (rec.gamesPlayed || 0) + 1;
    const winChance = Math.min(0.9, ec.coinflipWinChance + getLuckBonus(rec) + gambleBoostBonus(rec));
    const won = Math.random() < winChance;
    const result = won ? side : (side === 'heads' ? 'tails' : 'heads');
    let payout = 0;
    if (won) { payout = Math.round(bet * ec.coinflipPayoutMult); addWallet(rec, payout); rec.gamesWon = (rec.gamesWon || 0) + 1; }
    return { bet, won, side, result, payout, wallet: rec.wallet, net: payout - bet };
}

function coreDice(rec, betRaw, guessRaw, ec = getEconomyEarnConfig(null)) {
    let bet = parseBet(betRaw, rec.wallet);
    if (bet === null) return { error: "That's not a valid bet." };
    if (bet <= 0) return { error: 'Bet must be greater than 0.' };
    if (bet > rec.wallet) return { error: `You only have ${fmtBeli(rec.wallet)}.` };
    const guess = Math.floor(Number(guessRaw));
    if (!Number.isFinite(guess) || guess < 1 || guess > 6) return { error: 'Guess a number 1-6.' };
    removeWallet(rec, bet);
    rec.gamesPlayed = (rec.gamesPlayed || 0) + 1;
    const winChance = Math.min(0.5, ec.diceWinChance + getLuckBonus(rec) + gambleBoostBonus(rec));
    const won = Math.random() < winChance;
    let roll;
    if (won) roll = guess;
    else { do { roll = 1 + Math.floor(Math.random() * 6); } while (roll === guess); }
    let payout = 0;
    if (won) { payout = Math.round(bet * ec.dicePayoutMult); addWallet(rec, payout); rec.gamesWon = (rec.gamesWon || 0) + 1; }
    return { bet, won, roll, guess, payout, wallet: rec.wallet, net: payout - bet };
}

const ROULETTE_RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function rouletteColorOf(n) { return n === 0 ? 'green' : (ROULETTE_RED.has(n) ? 'red' : 'black'); }
function coreRoulette(rec, betRaw, choiceRaw, ec = getEconomyEarnConfig(null)) {
    let bet = parseBet(betRaw, rec.wallet);
    if (bet === null) return { error: "That's not a valid bet." };
    if (bet <= 0) return { error: 'Bet must be greater than 0.' };
    if (bet > rec.wallet) return { error: `You only have ${fmtBeli(rec.wallet)}.` };
    const choice = String(choiceRaw || '').trim().toLowerCase();
    let betType, betNumber = null;
    if (choice === 'red' || choice === 'black' || choice === 'green') betType = choice;
    else {
        const n = parseInt(choice, 10);
        if (!Number.isFinite(n) || n < 0 || n > 36) return { error: 'Choose red, black, green, or a number 0-36.' };
        betType = 'number'; betNumber = n;
    }
    removeWallet(rec, bet);
    rec.gamesPlayed = (rec.gamesPlayed || 0) + 1;
    const isNumberFamily = betType === 'number' || betType === 'green';
    const baseWinChance = isNumberFamily ? ec.rouletteNumberWinChance : ec.rouletteColorWinChance;
    const winChance = Math.min(0.5, baseWinChance + getLuckBonus(rec) + gambleBoostBonus(rec));
    const won = Math.random() < winChance;
    let landed;
    if (won) {
        if (betType === 'number') landed = betNumber;
        else if (betType === 'green') landed = 0;
        else {
            const pool = Array.from({ length: 37 }, (_, i) => i).filter(n => rouletteColorOf(n) === betType);
            landed = pool[Math.floor(Math.random() * pool.length)];
        }
    } else {
        do { landed = Math.floor(Math.random() * 37); }
        while (betType === 'number' ? landed === betNumber : rouletteColorOf(landed) === betType);
    }
    const payoutMult = isNumberFamily ? ec.rouletteNumberPayoutMult : ec.rouletteColorPayoutMult;
    let payout = 0;
    if (won) { payout = Math.round(bet * payoutMult); addWallet(rec, payout); rec.gamesWon = (rec.gamesWon || 0) + 1; }
    return { bet, won, landed, landedColor: rouletteColorOf(landed), betType, betNumber, payout, wallet: rec.wallet, net: payout - bet };
}

function coreHigherLower(rec, betRaw, guessRaw, ec = getEconomyEarnConfig(null)) {
    let bet = parseBet(betRaw, rec.wallet);
    if (bet === null) return { error: "That's not a valid bet." };
    if (bet <= 0) return { error: 'Bet must be greater than 0.' };
    if (bet > rec.wallet) return { error: `You only have ${fmtBeli(rec.wallet)}.` };
    const guess = String(guessRaw || '').toLowerCase() === 'lower' ? 'lower' : 'higher';
    removeWallet(rec, bet);
    rec.gamesPlayed = (rec.gamesPlayed || 0) + 1;
    const cardA = drawCard();
    const rankA = highLowRank(cardA.rank);
    const higherPool = CARD_RANKS.filter((r, i) => i > rankA);
    const lowerPool  = CARD_RANKS.filter((r, i) => i < rankA);
    const winPool  = guess === 'higher' ? higherPool : lowerPool;
    const losePool = guess === 'higher' ? [...lowerPool, cardA.rank] : [...higherPool, cardA.rank];
    let won = false;
    if (winPool.length) won = Math.random() < Math.min(0.55, ec.higherLowerWinChance + getLuckBonus(rec) + gambleBoostBonus(rec));
    const pool = won ? winPool : (losePool.length ? losePool : CARD_RANKS);
    const rank = pool[Math.floor(Math.random() * pool.length)];
    const cardB = { rank, suit: CARD_SUITS[Math.floor(Math.random() * CARD_SUITS.length)] };
    let payout = 0;
    if (won) { payout = Math.round(bet * ec.higherLowerPayoutMult); addWallet(rec, payout); rec.gamesWon = (rec.gamesWon || 0) + 1; }
    return { bet, won, cardA, cardB, guess, payout, wallet: rec.wallet, net: payout - bet };
}

// ── Mines (interactive: click tiles, cash out anytime) — 4x5 grid, 5th
//    button row reserved for Cash Out since Discord caps messages at 5
//    action rows x 5 buttons = 25 total components ────────────────────────
const MINES_COLS = 5, MINES_ROWS = 4, MINES_TILES = MINES_COLS * MINES_ROWS;
const activeMines = new Map(); // `${guildId}:${userId}` -> state

function coreMinesStart(rec, guildId, userId, betRaw, minesRaw, ec = getEconomyEarnConfig(null)) {
    const key = `${guildId}:${userId}`;
    if (activeMines.has(key)) return { error: 'You already have a mines game in progress.' };
    let bet = parseBet(betRaw, rec.wallet);
    if (bet === null) return { error: "That's not a valid bet." };
    if (bet <= 0) return { error: 'Bet must be greater than 0.' };
    if (bet > rec.wallet) return { error: `You only have ${fmtBeli(rec.wallet)}.` };
    const mineCount = Math.floor(Number(minesRaw));
    if (!Number.isFinite(mineCount) || mineCount < 1 || mineCount > Math.min(MINES_TILES - 1, ec.minesMaxMines)) return { error: `Mines must be 1-${Math.min(MINES_TILES - 1, ec.minesMaxMines)}.` };
    removeWallet(rec, bet);
    rec.gamesPlayed = (rec.gamesPlayed || 0) + 1;
    const positions = Array.from({ length: MINES_TILES }, (_, i) => i);
    for (let i = positions.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[positions[i], positions[j]] = [positions[j], positions[i]]; }
    const minePositions = new Set(positions.slice(0, mineCount));
    let radarNote = null;
    if (isBoostActive(rec, 'minesradar')) {
        clearBoost(rec, 'minesradar');
        radarNote = !minePositions.has(0);
    }
    const state = { bet, mineCount, minePositions, revealed: new Set(), multiplier: 1, growthFactor: ec.minesGrowthFactor, tilesRemaining: MINES_TILES, safeRemaining: MINES_TILES - mineCount, ended: false };
    activeMines.set(key, state);
    return { state, radarNote };
}
function coreMinesReveal(rec, guildId, userId, tileIdx, ec = getEconomyEarnConfig(null)) {
    const key = `${guildId}:${userId}`;
    const state = activeMines.get(key);
    if (!state) return { error: 'No active mines game.' };
    if (state.ended || state.revealed.has(tileIdx)) return { error: 'That tile is not available.' };
    if (state.minePositions.has(tileIdx)) {
        state.ended = true;
        activeMines.delete(key);
        return { hitMine: true, state };
    }
    state.revealed.add(tileIdx);
    state.multiplier *= (state.tilesRemaining / state.safeRemaining) * (state.growthFactor || ec.minesGrowthFactor);
    state.tilesRemaining--; state.safeRemaining--;
    if (state.safeRemaining === 0) {
        const payout = Math.round(state.bet * state.multiplier);
        addWallet(rec, payout);
        rec.gamesWon = (rec.gamesWon || 0) + 1;
        state.ended = true;
        activeMines.delete(key);
        return { cleared: true, payout, wallet: rec.wallet, net: payout - state.bet, state };
    }
    return { safe: true, state };
}
function coreMinesCashout(rec, guildId, userId) {
    const key = `${guildId}:${userId}`;
    const state = activeMines.get(key);
    if (!state) return { error: 'No active mines game.' };
    if (state.revealed.size === 0) return { error: 'Reveal at least one tile before cashing out.' };
    const payout = Math.round(state.bet * state.multiplier);
    addWallet(rec, payout);
    rec.gamesWon = (rec.gamesWon || 0) + 1;
    state.ended = true;
    activeMines.delete(key);
    return { cashedOut: true, payout, wallet: rec.wallet, net: payout - state.bet, state };
}

// ── Crash ─────────────────────────────────────────────────────────────
const activeCrashGames = new Map(); // `${guildId}:${userId}` -> { bet, crashPoint, startTime, ended }
const CRASH_GROWTH_RATE = 0.13; // multiplier = e^(rate * elapsedSeconds)
function rollCrashPoint(rec, ec = getEconomyEarnConfig(null)) {
    const r = Math.max(0.0001, Math.random());
    let crashPoint = Math.max(1.00, Math.min(ec.crashMaxMultiplier, ec.crashRtp / r));
    crashPoint *= (1 + Math.min(0.15, getLuckBonus(rec) + gambleBoostBonus(rec)));
    return crashPoint;
}
function currentCrashMultiplier(game) {
    const elapsedSec = (Date.now() - game.startTime) / 1000;
    return Math.min(game.maxMultiplier || 10000, Math.exp((game.growthRate || CRASH_GROWTH_RATE) * elapsedSec));
}
function coreCrashStart(rec, guildId, userId, betRaw, ec = getEconomyEarnConfig(null)) {
    const key = `${guildId}:${userId}`;
    if (activeCrashGames.has(key)) return { error: 'You already have a crash game running.' };
    let bet = parseBet(betRaw, rec.wallet);
    if (bet === null) return { error: "That's not a valid bet." };
    if (bet <= 0) return { error: 'Bet must be greater than 0.' };
    if (bet > rec.wallet) return { error: `You only have ${fmtBeli(rec.wallet)}.` };
    removeWallet(rec, bet);
    rec.gamesPlayed = (rec.gamesPlayed || 0) + 1;
    const game = { bet, crashPoint: rollCrashPoint(rec, ec), startTime: Date.now(), ended: false, growthRate: ec.crashGrowthRate, maxMultiplier: ec.crashMaxMultiplier };
    activeCrashGames.set(key, game);
    return { game };
}
function coreCrashCashout(rec, guildId, userId) {
    const key = `${guildId}:${userId}`;
    const game = activeCrashGames.get(key);
    if (!game || game.ended) return { error: 'No active crash game.' };
    const mult = currentCrashMultiplier(game);
    if (mult >= game.crashPoint) return { error: 'Already crashed!' };
    game.ended = true;
    activeCrashGames.delete(key);
    const payout = Math.round(game.bet * mult);
    addWallet(rec, payout);
    rec.gamesWon = (rec.gamesWon || 0) + 1;
    return { payout, multiplier: mult, wallet: rec.wallet, net: payout - game.bet };
}

// ── Wheel of Fortune ─────────────────────────────────────────────────────
const WHEEL_SEGMENTS = [
    { mult: 0, weight: 20, label: '💀 Bust' }, { mult: 0.5, weight: 20, label: '0.5x' },
    { mult: 1, weight: 20, label: '1x' }, { mult: 1.5, weight: 15, label: '1.5x' },
    { mult: 2, weight: 12, label: '2x' }, { mult: 3, weight: 7, label: '3x' },
    { mult: 5, weight: 4, label: '5x' }, { mult: 10, weight: 1.8, label: '10x' },
    { mult: 25, weight: 0.2, label: '💎 25x JACKPOT' },
];
function coreWheel(rec, betRaw, ec = getEconomyEarnConfig(null)) {
    let bet = parseBet(betRaw, rec.wallet);
    if (bet === null) return { error: "That's not a valid bet." };
    if (bet <= 0) return { error: 'Bet must be greater than 0.' };
    if (bet > rec.wallet) return { error: `You only have ${fmtBeli(rec.wallet)}.` };
    removeWallet(rec, bet);
    rec.gamesPlayed = (rec.gamesPlayed || 0) + 1;
    const segments = ec.wheelSegments;
    let segment = pickWeighted(segments);
    if (Math.random() < Math.min(0.2, getLuckBonus(rec) + gambleBoostBonus(rec))) {
        const idx = segments.indexOf(segment);
        if (idx < segments.length - 1) segment = segments[idx + 1];
    }
    const payout = Math.round(bet * segment.mult);
    if (payout > 0) addWallet(rec, payout);
    if (payout > bet) rec.gamesWon = (rec.gamesWon || 0) + 1;
    return { bet, segment, payout, wallet: rec.wallet, net: payout - bet };
}

// ── Scratch Card ──────────────────────────────────────────────────────
const SCRATCH_SYMBOLS = [
    { sym: '🍀', weight: 30, mult: 1 }, { sym: '⭐', weight: 22, mult: 2 },
    { sym: '💰', weight: 15, mult: 3 }, { sym: '💎', weight: 8, mult: 6 }, { sym: '👑', weight: 3, mult: 15 },
];
function coreScratch(rec, betRaw, ec = getEconomyEarnConfig(null)) {
    let bet = parseBet(betRaw, rec.wallet);
    if (bet === null) return { error: "That's not a valid bet." };
    if (bet <= 0) return { error: 'Bet must be greater than 0.' };
    if (bet > rec.wallet) return { error: `You only have ${fmtBeli(rec.wallet)}.` };
    removeWallet(rec, bet);
    rec.gamesPlayed = (rec.gamesPlayed || 0) + 1;
    const luckEdge = getLuckBonus(rec) + gambleBoostBonus(rec);
    let cells = Array.from({ length: ec.scratchCells }, () => pickWeighted(ec.scratchSymbols));
    if (luckEdge > 0 && Math.random() < luckEdge * 3) {
        const counts = {};
        cells.forEach(c => counts[c.sym] = (counts[c.sym] || 0) + 1);
        const bestSym = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
        const bestObj = ec.scratchSymbols.find(s => s.sym === bestSym);
        const idx = cells.findIndex(c => c.sym !== bestSym);
        if (idx !== -1) cells[idx] = bestObj;
    }
    const counts = {};
    cells.forEach(c => counts[c.sym] = (counts[c.sym] || 0) + 1);
    const [bestSym, bestCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    let mult = 0;
    if (bestCount >= 3) {
        const obj = ec.scratchSymbols.find(s => s.sym === bestSym);
        mult = obj.mult * (bestCount === 5 ? 5 : bestCount === 4 ? 2 : 1);
    }
    const payout = Math.round(bet * mult);
    if (payout > 0) addWallet(rec, payout);
    if (payout > bet) rec.gamesWon = (rec.gamesWon || 0) + 1;
    return { bet, cells: cells.map(c => c.sym), payout, wallet: rec.wallet, net: payout - bet };
}

// ── Lottery (persistent, server-wide pooled jackpot, resolved on next
//    access after the draw interval elapses — no timers needed) ─────────
const LOTTERY_TICKET_PRICE = 100;
const LOTTERY_DRAW_INTERVAL_MS = 24 * 60 * 60 * 1000;
function ensureLottery(data, guildId) {
    data.lottery = data.lottery || {};
    if (!data.lottery[guildId]) data.lottery[guildId] = { pot: 0, tickets: {}, lastDrawAt: Date.now() };
    return data.lottery[guildId];
}
function maybeResolveLottery(data, guildId, intervalMs = LOTTERY_DRAW_INTERVAL_MS) {
    const lot = ensureLottery(data, guildId);
    if (Date.now() - lot.lastDrawAt < intervalMs) return null;
    const entries = Object.entries(lot.tickets);
    if (!entries.length || lot.pot <= 0) { lot.lastDrawAt = Date.now(); return null; }
    const totalTickets = entries.reduce((s, [, c]) => s + c, 0);
    let roll = Math.random() * totalTickets;
    let winnerId = entries[entries.length - 1][0];
    for (const [uid, count] of entries) { if (roll < count) { winnerId = uid; break; } roll -= count; }
    const wonAmount = lot.pot;
    addWallet(ensureEconomy(data, guildId, winnerId), wonAmount);
    const result = { winnerId, amount: wonAmount, totalTickets };
    lot.pot = 0; lot.tickets = {}; lot.lastDrawAt = Date.now();
    return result;
}
function coreLotteryBuy(data, guildId, userId, countRaw, ec = getEconomyEarnConfig(null)) {
    const drawResult = maybeResolveLottery(data, guildId, ec.lotteryIntervalMs);
    const rec = ensureEconomy(data, guildId, userId);
    const count = Math.floor(Number(countRaw));
    if (!Number.isFinite(count) || count < 1 || count > 100) return { error: 'Buy 1-100 tickets at a time.', drawResult };
    const cost = count * ec.lotteryTicketPrice;
    if (cost > rec.wallet) return { error: `${count} tickets costs ${fmtBeli(cost)} but you only have ${fmtBeli(rec.wallet)}.`, drawResult };
    removeWallet(rec, cost);
    const lot = ensureLottery(data, guildId);
    lot.pot += cost;
    lot.tickets[userId] = (lot.tickets[userId] || 0) + count;
    return { count, cost, pot: lot.pot, yourTickets: lot.tickets[userId], wallet: rec.wallet, drawResult };
}
function coreLotteryInfo(data, guildId, userId, ec = getEconomyEarnConfig(null)) {
    const drawResult = maybeResolveLottery(data, guildId, ec.lotteryIntervalMs);
    const lot = ensureLottery(data, guildId);
    const totalTickets = Object.values(lot.tickets).reduce((s, c) => s + c, 0);
    return { pot: lot.pot, totalTickets, yourTickets: lot.tickets[userId] || 0, msRemaining: Math.max(0, ec.lotteryIntervalMs - (Date.now() - lot.lastDrawAt)), drawResult };
}

// ── Blackjack (stateful: deal → hit*/stand) ──────────────────────────────
const activeBlackjack = new Map(); // `${guildId}:${userId}` -> { playerCards, dealerCards, bet }
function blackjackCardsStr(cards) { return cards.map(cardDisplay).join(' '); }
function coreBlackjackDeal(rec, guildId, userId, betRaw, ec = getEconomyEarnConfig(null)) {
    const key = `${guildId}:${userId}`;
    if (activeBlackjack.has(key)) return { error: 'You already have a blackjack hand in progress — hit or stand first.' };
    let bet = parseBet(betRaw, rec.wallet);
    if (bet === null) return { error: "That's not a valid bet." };
    if (bet <= 0) return { error: 'Bet must be greater than 0.' };
    if (bet > rec.wallet) return { error: `You only have ${fmtBeli(rec.wallet)}.` };
    removeWallet(rec, bet);
    rec.gamesPlayed = (rec.gamesPlayed || 0) + 1;
    const playerCards = [drawCard(), drawCard()];
    const dealerCards = [drawCard(), drawCard()];
    const playerTotal = handValue(playerCards), dealerTotal = handValue(dealerCards);
    if (playerTotal === 21) {
        if (dealerTotal === 21) { addWallet(rec, bet); return { done: true, result: 'push', playerCards, dealerCards, playerTotal, dealerTotal, payout: bet, net: 0, wallet: rec.wallet }; }
        const payout = Math.round(bet * ec.blackjackNaturalMult);
        addWallet(rec, payout); rec.gamesWon = (rec.gamesWon || 0) + 1;
        return { done: true, result: 'blackjack', playerCards, dealerCards, playerTotal, dealerTotal, payout, net: payout - bet, wallet: rec.wallet };
    }
    activeBlackjack.set(key, { playerCards, dealerCards, bet, naturalMult: ec.blackjackNaturalMult, winMult: ec.blackjackWinMult, dealerStandAt: ec.blackjackDealerStandAt });
    return { done: false, playerCards, dealerUpcard: dealerCards[0], playerTotal };
}
function coreBlackjackHit(rec, guildId, userId) {
    const key = `${guildId}:${userId}`;
    const game = activeBlackjack.get(key);
    if (!game) return { error: 'No active blackjack hand — deal first with a bet.' };
    game.playerCards.push(drawCard());
    const playerTotal = handValue(game.playerCards);
    if (playerTotal > 21) {
        if (isBoostActive(rec, 'secondchance')) {
            clearBoost(rec, 'secondchance');
            game.playerCards.pop();
            return { done: false, playerCards: game.playerCards, playerTotal: handValue(game.playerCards), savedBySecondChance: true };
        }
        activeBlackjack.delete(key);
        return { done: true, result: 'bust', playerCards: game.playerCards, dealerCards: game.dealerCards, playerTotal, dealerTotal: handValue(game.dealerCards), payout: 0, net: -game.bet, wallet: rec.wallet };
    }
    return { done: false, playerCards: game.playerCards, playerTotal };
}
function coreBlackjackStand(rec, guildId, userId, ec = getEconomyEarnConfig(null)) {
    const key = `${guildId}:${userId}`;
    const game = activeBlackjack.get(key);
    if (!game) return { error: 'No active blackjack hand — deal first with a bet.' };
    activeBlackjack.delete(key);
    let dealerTotal = handValue(game.dealerCards);
    while (dealerTotal < (game.dealerStandAt || ec.blackjackDealerStandAt)) { game.dealerCards.push(drawCard()); dealerTotal = handValue(game.dealerCards); }
    const playerTotal = handValue(game.playerCards);
    let result, payout;
    if (dealerTotal > 21 || playerTotal > dealerTotal) { result = 'win'; payout = game.bet * (game.winMult || ec.blackjackWinMult); }
    else if (playerTotal === dealerTotal) { result = 'push'; payout = game.bet; }
    else { result = 'loss'; payout = 0; }
    if (payout > 0) addWallet(rec, payout);
    if (result === 'win') rec.gamesWon = (rec.gamesWon || 0) + 1;
    return { done: true, result, playerCards: game.playerCards, dealerCards: game.dealerCards, playerTotal, dealerTotal, payout, net: payout - game.bet, wallet: rec.wallet };
}

// ══════════════════════════════════════════════════════════
//  DUEL GROUP — winner-take-all 1v1 stakes battle
// ══════════════════════════════════════════════════════════
const pendingDuels = new Map(); // `${guildId}:${targetUserId}` -> { challengerId, bet, expiresAt }
const DUEL_EXPIRY_MS = 5 * 60 * 1000;
function coreDuelChallenge(data, guildId, challengerId, targetId, betRaw, ec = getEconomyEarnConfig(null)) {
    if (challengerId === targetId) return { error: "You can't duel yourself." };
    const challengerRec = ensureEconomy(data, guildId, challengerId);
    let bet = parseBet(betRaw, challengerRec.wallet);
    if (bet === null) return { error: "That's not a valid bet." };
    if (bet <= 0) return { error: 'Bet must be greater than 0.' };
    if (bet > challengerRec.wallet) return { error: `You only have ${fmtBeli(challengerRec.wallet)}.` };
    pendingDuels.set(`${guildId}:${targetId}`, { challengerId, bet, expiresAt: Date.now() + ec.duelExpiryMs });
    return { bet };
}
function coreDuelResolve(data, guildId, targetId, accept, ec = getEconomyEarnConfig(null)) {
    const key = `${guildId}:${targetId}`;
    const pending = pendingDuels.get(key);
    if (!pending || pending.expiresAt < Date.now()) { pendingDuels.delete(key); return { error: 'No pending duel challenge for you (it may have expired after 5 minutes).' }; }
    pendingDuels.delete(key);
    if (!accept) return { declined: true, challengerId: pending.challengerId };
    const challengerRec = ensureEconomy(data, guildId, pending.challengerId);
    const targetRec = ensureEconomy(data, guildId, targetId);
    if (challengerRec.wallet < pending.bet) return { error: 'The challenger no longer has enough Beli — duel cancelled.' };
    if (targetRec.wallet < pending.bet) return { error: `You need ${fmtBeli(pending.bet)} to accept this duel.` };
    removeWallet(challengerRec, pending.bet);
    removeWallet(targetRec, pending.bet);
    const challengerEdge = 0.5 + getLuckBonus(challengerRec) - getLuckBonus(targetRec);
    const challengerWins = Math.random() < Math.max(0.1, Math.min(0.9, challengerEdge));
    const pot = pending.bet * 2;
    const payout = pot - Math.round(pot * ec.duelHouseCutPct); // 5% house cut, a sink like everything else
    const winnerId = challengerWins ? pending.challengerId : targetId;
    const loserId = challengerWins ? targetId : pending.challengerId;
    const winnerRec = challengerWins ? challengerRec : targetRec;
    const loserRec = challengerWins ? targetRec : challengerRec;
    let insuranceUsed = false;
    if (isBoostActive(loserRec, 'duelinsurance')) {
        // Insurance voids the duel financially instead of refunding on top of an
        // unchanged payout: both stakes were already taken above via removeWallet,
        // so paying the winner the full pot AND refunding the loser's stake would
        // mint `payout - pending.bet` in brand-new currency out of nothing every
        // time it triggered. Returning both stakes as-is keeps money conserved —
        // the loser is made whole (the promise of the item) and the winner isn't
        // penalized for facing an insured opponent, just doesn't profit from it.
        clearBoost(loserRec, 'duelinsurance');
        addWallet(loserRec, pending.bet);
        addWallet(winnerRec, pending.bet);
        insuranceUsed = true;
    } else {
        addWallet(winnerRec, payout);
    }
    winnerRec.duelsWon = (winnerRec.duelsWon || 0) + 1;
    loserRec.duelsLost = (loserRec.duelsLost || 0) + 1;
    return { accepted: true, winnerId, loserId, bet: pending.bet, payout: insuranceUsed ? pending.bet : payout, insuranceUsed };
}
function coreDuelStats(rec) { return { won: rec.duelsWon || 0, lost: rec.duelsLost || 0 }; }

// ══════════════════════════════════════════════════════════
//  QUESTS GROUP — 3 daily objectives, flat bonus for completing all
// ══════════════════════════════════════════════════════════
const QUEST_DEFS = [
    { id: 'earn', label: 'Use any earn command (work, crime, fish, hunt, trivia, rob)' },
    { id: 'gamble', label: 'Play any gamble game' },
    { id: 'daily', label: 'Claim your daily reward' },
];
const QUEST_REWARD = 2000;
function todayKey() { return new Date().toISOString().slice(0, 10); }
function ensureQuestDay(rec) {
    const today = todayKey();
    if (rec.questDay !== today) { rec.questDay = today; rec.questProgress = {}; rec.questClaimed = false; }
}
function markQuestProgress(rec, category) {
    ensureQuestDay(rec);
    rec.questProgress[category] = true;
}
function coreQuestsView(rec) {
    ensureQuestDay(rec);
    return QUEST_DEFS.map(q => ({ ...q, done: !!rec.questProgress[q.id] }));
}
function coreQuestsClaim(rec) {
    ensureQuestDay(rec);
    if (rec.questClaimed) return { error: "You've already claimed today's quest reward." };
    const doneCount = QUEST_DEFS.filter(q => rec.questProgress[q.id]).length;
    if (doneCount < QUEST_DEFS.length) return { error: `Complete all ${QUEST_DEFS.length} quests first (${doneCount}/${QUEST_DEFS.length} done).` };
    rec.questClaimed = true;
    addWallet(rec, QUEST_REWARD);
    return { amount: QUEST_REWARD, wallet: rec.wallet };
}

// ── Gamble embeds ────────────────────────────────────────────────────────
function gambleEmbed(title, description, net) {
    return new EmbedBuilder().setTitle(title).setDescription(description).setColor(net >= 0 ? COLOR_GAMBLE_W : COLOR_GAMBLE_L);
}
function slotsEmbed(r) {
    const desc = `**[ ${r.reels.join(' | ')} ]**\n\n${r.win ? `You won ${fmtBeli(r.payout)}!` : (r.payout > 0 ? `Small consolation: ${fmtBeli(r.payout)} back.` : `No match — you lost ${fmtBeli(r.bet)}.`)}\nWallet: ${fmtBeli(r.wallet)}`;
    return gambleEmbed('🎰 Slots', desc, r.net);
}
function coinflipEmbed(r) {
    return gambleEmbed('🪙 Coinflip', `The coin landed on **${r.result}**!\n${r.won ? `You won ${fmtBeli(r.payout)}!` : `You lost ${fmtBeli(r.bet)}.`}\nWallet: ${fmtBeli(r.wallet)}`, r.net);
}
function diceEmbed(r) {
    return gambleEmbed('🎲 Dice', `The die landed on **${r.roll}** (you guessed ${r.guess}).\n${r.won ? `You won ${fmtBeli(r.payout)}!` : `You lost ${fmtBeli(r.bet)}.`}\nWallet: ${fmtBeli(r.wallet)}`, r.net);
}
function rouletteEmbed(r) {
    const betLabel = r.betType === 'number' ? `#${r.betNumber}` : r.betType;
    return gambleEmbed('🎡 Roulette', `The ball landed on **${r.landed} (${r.landedColor})**. You bet on **${betLabel}**.\n${r.won ? `You won ${fmtBeli(r.payout)}!` : `You lost ${fmtBeli(r.bet)}.`}\nWallet: ${fmtBeli(r.wallet)}`, r.net);
}
function higherLowerEmbed(r) {
    return gambleEmbed('🔼🔽 Higher/Lower', `First card: **${cardDisplay(r.cardA)}**\nSecond card: **${cardDisplay(r.cardB)}** (you guessed ${r.guess})\n${r.won ? `You won ${fmtBeli(r.payout)}!` : `You lost ${fmtBeli(r.bet)}.`}\nWallet: ${fmtBeli(r.wallet)}`, r.net);
}
function minesEmbedInteractive(state, extra = '') {
    const potential = fmtBeli(Math.round(state.bet * state.multiplier));
    const statusColor = state.ended ? (state.revealed.size > 0 ? COLOR_GAMBLE_W : COLOR_GAMBLE_L) : COLOR_INFO;
    return new EmbedBuilder().setTitle('💣 Mines').setColor(statusColor)
        .setDescription(`Bet: ${fmtBeli(state.bet)} | Mines: ${state.mineCount}/${MINES_TILES}\nSafe reveals: ${state.revealed.size} | Current multiplier: **${state.multiplier.toFixed(2)}x** (worth ${potential})\n${extra}`.trim());
}
function buildMinesComponents(state, revealMines = false) {
    if (state.ended) {
        // freeze the board in its final revealed state, all disabled
    }
    const rows = [];
    for (let r = 0; r < MINES_ROWS; r++) {
        const row = new ActionRowBuilder();
        for (let c = 0; c < MINES_COLS; c++) {
            const idx = r * MINES_COLS + c;
            const isRevealed = state.revealed.has(idx);
            const isMine = state.minePositions.has(idx);
            let style = ButtonStyle.Secondary, label = '❓', disabled = state.ended;
            if (isRevealed) { label = '💎'; style = ButtonStyle.Success; disabled = true; }
            else if (revealMines && isMine) { label = '💣'; style = ButtonStyle.Danger; disabled = true; }
            row.addComponents(new ButtonBuilder().setCustomId(`bmt_${idx}`).setLabel(label).setStyle(style).setDisabled(disabled));
        }
        rows.push(row);
    }
    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('bmc').setLabel(state.ended ? 'Game Over' : `💰 Cash Out (${state.multiplier.toFixed(2)}x)`).setStyle(ButtonStyle.Primary).setDisabled(state.ended || state.revealed.size === 0)
    ));
    return rows;
}
function attachMinesCollector(msg, rec, guildId, userId, data, saveData) {
    const key = `${guildId}:${userId}`;
    let collector;
    try { collector = msg.createMessageComponentCollector({ filter: (i) => i.user.id === userId, time: 5 * 60 * 1000 }); }
    catch (e) { console.error('[beli mines] collector setup failed:', e.message); return; }
    collector.on('collect', async (i) => {
        try {
            const state = activeMines.get(key);
            if (!state) { await i.reply({ embeds: [errEmbed('This game has ended.')], flags: 64 }); return; }
            if (i.customId === 'bmc') {
                const r = coreMinesCashout(rec, guildId, userId);
                if (r.error) { await i.reply({ embeds: [errEmbed(r.error)], flags: 64 }); return; }
                await i.update({ embeds: [minesEmbedInteractive(r.state, `✅ Cashed out for ${fmtBeli(r.payout)}!`)], components: buildMinesComponents(r.state) });
                saveData(data); collector.stop('cashout'); return;
            }
            const tileIdx = parseInt(i.customId.split('_')[1], 10);
            const r = coreMinesReveal(rec, guildId, userId, tileIdx);
            if (r.error) { await i.reply({ embeds: [errEmbed(r.error)], flags: 64 }); return; }
            if (r.hitMine) { await i.update({ embeds: [minesEmbedInteractive(r.state, `💥 Boom! You hit a mine and lost ${fmtBeli(r.state.bet)}.`)], components: buildMinesComponents(r.state, true) }); saveData(data); collector.stop('mine'); return; }
            if (r.cleared) { await i.update({ embeds: [minesEmbedInteractive(r.state, `🎉 Board cleared! You won ${fmtBeli(r.payout)}!`)], components: buildMinesComponents(r.state) }); saveData(data); collector.stop('cleared'); return; }
            await i.update({ embeds: [minesEmbedInteractive(r.state)], components: buildMinesComponents(r.state) });
            saveData(data);
        } catch (e) { console.error('[beli mines collector]', e); }
    });
    collector.on('end', (_c, reason) => {
        if (reason === 'time') {
            const state = activeMines.get(key);
            if (state && !state.ended) { activeMines.delete(key); msg.edit({ embeds: [minesEmbedInteractive(state, '⏱️ Timed out — bet forfeited.')], components: buildMinesComponents(state, true) }).catch(() => {}); }
        }
    });
}

function crashLiveEmbed(game, statusNote = '') {
    const mult = game.ended ? game.finalMult : currentCrashMultiplier(game);
    return new EmbedBuilder().setTitle('🚀 Crash').setColor(game.ended ? (game.won ? COLOR_GAMBLE_W : COLOR_GAMBLE_L) : COLOR_INFO)
        .setDescription(`Bet: ${fmtBeli(game.bet)}\n\nMultiplier: **${mult.toFixed(2)}x**\n${statusNote}`.trim());
}
function buildCrashComponents(ended) {
    if (ended) return [];
    return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('bcrash_cashout').setLabel('💰 Cash Out').setStyle(ButtonStyle.Primary))];
}
function attachCrashLiveLoop(msg, rec, guildId, userId, data, saveData) {
    const key = `${guildId}:${userId}`;
    const game = activeCrashGames.get(key);
    if (!game) return;
    let collector;
    try { collector = msg.createMessageComponentCollector({ filter: (i) => i.user.id === userId, time: 60000 }); }
    catch (e) { console.error('[beli crash] collector setup failed:', e.message); }

    const interval = setInterval(async () => {
        const g = activeCrashGames.get(key);
        if (!g || g.ended) { clearInterval(interval); return; }
        const mult = currentCrashMultiplier(g);
        if (mult >= g.crashPoint) {
            g.ended = true; g.won = false; g.finalMult = g.crashPoint;
            activeCrashGames.delete(key);
            clearInterval(interval);
            if (collector) collector.stop('crashed');
            try { await msg.edit({ embeds: [crashLiveEmbed(g, `💥 **CRASHED** at ${g.crashPoint.toFixed(2)}x! You lost ${fmtBeli(g.bet)}.`)], components: [] }); } catch { clearInterval(interval); }
            saveData(data);
            return;
        }
        try { await msg.edit({ embeds: [crashLiveEmbed(g)], components: buildCrashComponents(false) }); }
        catch { clearInterval(interval); } // message gone/rate-limited past recovery - stop trying
    }, 1000);

    if (collector) {
        collector.on('collect', async (i) => {
            if (i.customId !== 'bcrash_cashout') return;
            const r = coreCrashCashout(rec, guildId, userId);
            clearInterval(interval);
            if (r.error) { try { await i.reply({ embeds: [errEmbed(r.error)], flags: 64 }); } catch {} return; }
            try { await i.update({ embeds: [gambleEmbed('🚀 Crash', `Cashed out at **${r.multiplier.toFixed(2)}x** — you won ${fmtBeli(r.payout)}!\nWallet: ${fmtBeli(r.wallet)}`, r.net)], components: [] }); } catch {}
            saveData(data);
            collector.stop('cashout');
        });
        collector.on('end', (_c, reason) => {
            clearInterval(interval);
            if (reason === 'time') {
                const g = activeCrashGames.get(key);
                if (g && !g.ended) { activeCrashGames.delete(key); msg.edit({ components: [] }).catch(() => {}); }
            }
        });
    }
}
function wheelEmbed(r) {
    return gambleEmbed('🎡 Wheel of Fortune', `The wheel landed on **${r.segment.label}**!\n${r.payout > 0 ? `You won ${fmtBeli(r.payout)}!` : `You lost ${fmtBeli(r.bet)}.`}\nWallet: ${fmtBeli(r.wallet)}`, r.net);
}
function scratchEmbed(r) {
    return gambleEmbed('🎫 Scratch Card', `[ ${r.cells.join(' | ')} ]\n${r.payout > 0 ? `Matched enough to win ${fmtBeli(r.payout)}!` : `No luck — you lost ${fmtBeli(r.bet)}.`}\nWallet: ${fmtBeli(r.wallet)}`, r.net);
}
function lotteryDrawNote(drawResult) {
    if (!drawResult) return '';
    return `\n🎉 **A draw just happened!** <@${drawResult.winnerId}> won the ${fmtBeli(drawResult.amount)} jackpot (${drawResult.totalTickets} tickets were in play)!\n`;
}
function lotteryBuyEmbed(r) {
    if (r.error) return errEmbed(r.error + lotteryDrawNote(r.drawResult));
    return okEmbed('🎟️ Tickets Bought', `Bought ${r.count} ticket(s) for ${fmtBeli(r.cost)}.\nJackpot is now ${fmtBeli(r.pot)} — you hold ${r.yourTickets} ticket(s).\nWallet: ${fmtBeli(r.wallet)}${lotteryDrawNote(r.drawResult)}`);
}
function lotteryInfoEmbed(r) {
    return new EmbedBuilder().setTitle('🎟️ Server Lottery').setColor(COLOR_GOLD)
        .setDescription(`Current jackpot: ${fmtBeli(r.pot)}\nTotal tickets in play: ${r.totalTickets}\nYour tickets: ${r.yourTickets}\nNext draw in: ${fmtDuration(r.msRemaining)}\nTickets are ${fmtBeli(LOTTERY_TICKET_PRICE)} each — buy with \`/beli gamble lottery-buy\`.${lotteryDrawNote(r.drawResult)}`);
}
function duelChallengeEmbed(challengerId, targetId, bet) {
    return new EmbedBuilder().setTitle('⚔️ Duel Challenge').setColor(COLOR_INFO)
        .setDescription(`<@${challengerId}> has challenged <@${targetId}> to a duel for ${fmtBeli(bet)}!\n<@${targetId}>, use \`/beli duel accept\` or \`/beli duel decline\` within 5 minutes.`);
}
function duelResultEmbed(r) {
    if (r.declined) return okEmbed('⚔️ Duel Declined', `The challenge from <@${r.challengerId}> was declined.`);
    const outcome = r.insuranceUsed
        ? `<@${r.winnerId}> defeated <@${r.loserId}>, but Duel Insurance kicked in — both stakes were simply returned (won nothing extra, lost nothing).\n📋 <@${r.loserId}>'s stake of ${fmtBeli(r.bet)} was refunded.`
        : `<@${r.winnerId}> defeated <@${r.loserId}> and won ${fmtBeli(r.payout)} (staked ${fmtBeli(r.bet)} each, 5% house cut)!`;
    return new EmbedBuilder().setTitle('⚔️ Duel Resolved').setColor(COLOR_GAMBLE_W).setDescription(outcome);
}
function questsViewEmbed(quests) {
    const lines = quests.map(q => `${q.done ? '✅' : '⬜'} ${q.label}`);
    const allDone = quests.every(q => q.done);
    return new EmbedBuilder().setTitle("📋 Today's Quests").setColor(allDone ? COLOR_OK : COLOR_INFO)
        .setDescription(`${lines.join('\n')}\n\n${allDone ? `All done! Claim your ${fmtBeli(QUEST_REWARD)} with \`/beli quests claim\`.` : 'Complete all 3 for a bonus reward.'}`);
}

function blackjackInProgressEmbed(r) {
    return new EmbedBuilder().setTitle('🃏 Blackjack')
        .setDescription(`Your hand: ${blackjackCardsStr(r.playerCards)} (**${r.playerTotal}**)\nDealer shows: ${cardDisplay(r.dealerUpcard)}\n\nClick a button below, or use \`/beli gamble blackjack-hit\` / \`blackjack-stand\` (\`!bjhit\` / \`!bjstand\`).`)
        .setColor(COLOR_INFO);
}
function blackjackHitEmbed(r) {
    if (!r.done) return new EmbedBuilder().setTitle(r.savedBySecondChance ? '🔄 Second Chance Used!' : '🃏 Blackjack — Hit').setDescription(`Your hand: ${blackjackCardsStr(r.playerCards)} (**${r.playerTotal}**)\n\nHit again or stand.`).setColor(COLOR_INFO);
    return blackjackResultEmbed(r);
}
function blackjackResultEmbed(r) {
    const labels = { win: '✅ You win!', blackjack: '🃏 Blackjack! You win!', push: '🤝 Push — bet returned.', loss: '❌ You lose.', bust: '💥 Bust! You lose.' };
    const desc = `Your hand: ${blackjackCardsStr(r.playerCards)} (**${r.playerTotal}**)\nDealer hand: ${blackjackCardsStr(r.dealerCards)} (**${r.dealerTotal}**)\n\n${labels[r.result]}\nWallet: ${fmtBeli(r.wallet)}`;
    return gambleEmbed('🃏 Blackjack', desc, r.net);
}
function buildBlackjackComponents(done) {
    if (done) return [];
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('bbj_hit').setLabel('Hit').setEmoji('🃏').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('bbj_stand').setLabel('Stand').setEmoji('✋').setStyle(ButtonStyle.Secondary),
    )];
}
function attachBlackjackCollector(msg, rec, guildId, userId, data, saveData) {
    const key = `${guildId}:${userId}`;
    let collector;
    try { collector = msg.createMessageComponentCollector({ filter: (i) => i.user.id === userId, time: 5 * 60 * 1000 }); }
    catch (e) { console.error('[beli blackjack] collector setup failed:', e.message); return; }
    collector.on('collect', async (i) => {
        try {
            if (!activeBlackjack.has(key)) { await i.reply({ embeds: [errEmbed('This hand already ended.')], flags: 64 }); return; }
            if (i.customId === 'bbj_hit') {
                const r = coreBlackjackHit(rec, guildId, userId);
                if (r.error) { await i.reply({ embeds: [errEmbed(r.error)], flags: 64 }); return; }
                await i.update({ embeds: [r.done ? blackjackResultEmbed(r) : blackjackHitEmbed(r)], components: buildBlackjackComponents(r.done) });
                saveData(data);
                if (r.done) collector.stop('done');
            } else if (i.customId === 'bbj_stand') {
                const r = coreBlackjackStand(rec, guildId, userId);
                if (r.error) { await i.reply({ embeds: [errEmbed(r.error)], flags: 64 }); return; }
                await i.update({ embeds: [blackjackResultEmbed(r)], components: [] });
                saveData(data); collector.stop('done');
            }
        } catch (e) { console.error('[beli blackjack collector]', e); }
    });
    collector.on('end', (_c, reason) => {
        if (reason === 'time') {
            // Matches the same forfeit-on-timeout pattern already used by mines/crash —
            // without deleting the map entry here, activeBlackjack.has(key) would stay
            // true forever, permanently blocking this player from ever dealing a new
            // hand again (their buttons are already gone by this point, so there'd be
            // no way for them to resolve the stuck one either).
            const game = activeBlackjack.get(key);
            if (game) {
                activeBlackjack.delete(key);
                msg.edit({ embeds: [gambleEmbed('🃏 Blackjack', 'Hand timed out — bet forfeited.', -game.bet)], components: [] }).catch(() => {});
            }
        }
    });
}


// ── Slash handlers ───────────────────────────────────────────────────────
async function slashGambleSlots(interaction, data, guildId, gs) {
    const r = coreSlots(ensureEconomy(data, guildId, interaction.user.id), interaction.options.getString('bet'), getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [slotsEmbed(r)] });
}
async function slashGambleCoinflip(interaction, data, guildId, gs) {
    const r = coreCoinflip(ensureEconomy(data, guildId, interaction.user.id), interaction.options.getString('bet'), interaction.options.getString('side'), getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [coinflipEmbed(r)] });
}
async function slashGambleDice(interaction, data, guildId, gs) {
    const r = coreDice(ensureEconomy(data, guildId, interaction.user.id), interaction.options.getString('bet'), interaction.options.getInteger('guess'), getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [diceEmbed(r)] });
}
async function slashGambleRoulette(interaction, data, guildId, gs) {
    const r = coreRoulette(ensureEconomy(data, guildId, interaction.user.id), interaction.options.getString('bet'), interaction.options.getString('choice'), getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [rouletteEmbed(r)] });
}
async function slashGambleHigherLower(interaction, data, guildId, gs) {
    const r = coreHigherLower(ensureEconomy(data, guildId, interaction.user.id), interaction.options.getString('bet'), interaction.options.getString('guess'), getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [higherLowerEmbed(r)] });
}
async function slashGambleMines(interaction, data, guildId, gs, saveData) {
    const rec = ensureEconomy(data, guildId, interaction.user.id);
    const r = coreMinesStart(rec, guildId, interaction.user.id, interaction.options.getString('bet'), interaction.options.getInteger('mines'), getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    const radarNote = r.radarNote === null ? '' : `📡 Radar: top-left tile is **${r.radarNote ? 'SAFE' : 'A MINE'}**!`;
    await interaction.reply({ embeds: [minesEmbedInteractive(r.state, radarNote)], components: buildMinesComponents(r.state) });
    const msg = await interaction.fetchReply();
    attachMinesCollector(msg, rec, guildId, interaction.user.id, data, saveData);
}
async function slashGambleBlackjack(interaction, data, guildId, gs, saveData) {
    const rec = ensureEconomy(data, guildId, interaction.user.id);
    const r = coreBlackjackDeal(rec, guildId, interaction.user.id, interaction.options.getString('bet'), getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [r.done ? blackjackResultEmbed(r) : blackjackInProgressEmbed(r)], components: buildBlackjackComponents(r.done) });
    if (!r.done) { const msg = await interaction.fetchReply(); attachBlackjackCollector(msg, rec, guildId, interaction.user.id, data, saveData); }
}
async function slashGambleBlackjackHit(interaction, data, guildId) {
    const r = coreBlackjackHit(ensureEconomy(data, guildId, interaction.user.id), guildId, interaction.user.id);
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [blackjackHitEmbed(r)] });
}
async function slashGambleBlackjackStand(interaction, data, guildId, gs) {
    const r = coreBlackjackStand(ensureEconomy(data, guildId, interaction.user.id), guildId, interaction.user.id, getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [blackjackResultEmbed(r)], components: [] });
}
async function slashGambleCrash(interaction, data, guildId, gs, saveData) {
    const rec = ensureEconomy(data, guildId, interaction.user.id);
    const r = coreCrashStart(rec, guildId, interaction.user.id, interaction.options.getString('bet'), getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [crashLiveEmbed(r.game)], components: buildCrashComponents(false) });
    const msg = await interaction.fetchReply();
    attachCrashLiveLoop(msg, rec, guildId, interaction.user.id, data, saveData);
}
async function slashGambleWheel(interaction, data, guildId, gs) {
    const r = coreWheel(ensureEconomy(data, guildId, interaction.user.id), interaction.options.getString('bet'), getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [wheelEmbed(r)] });
}
async function slashGambleScratch(interaction, data, guildId, gs) {
    const r = coreScratch(ensureEconomy(data, guildId, interaction.user.id), interaction.options.getString('bet'), getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [scratchEmbed(r)] });
}
async function slashGambleLotteryBuy(interaction, data, guildId, gs) {
    const r = coreLotteryBuy(data, guildId, interaction.user.id, interaction.options.getInteger('count'), getEconomyEarnConfig(gs));
    await interaction.reply({ embeds: [lotteryBuyEmbed(r)], flags: r.error ? 64 : undefined });
}
async function slashGambleLotteryInfo(interaction, data, guildId, gs) {
    const r = coreLotteryInfo(data, guildId, interaction.user.id, getEconomyEarnConfig(gs));
    await interaction.reply({ embeds: [lotteryInfoEmbed(r)] });
}

async function slashDuelChallenge(interaction, data, guildId, gs) {
    const target = interaction.options.getUser('user');
    if (target.bot) return interaction.reply({ embeds: [errEmbed("You can't duel a bot.")], flags: 64 });
    const r = coreDuelChallenge(data, guildId, interaction.user.id, target.id, interaction.options.getString('bet'), getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [duelChallengeEmbed(interaction.user.id, target.id, r.bet)] });
}
async function slashDuelResolve(interaction, data, guildId, gs, accept) {
    const r = coreDuelResolve(data, guildId, interaction.user.id, accept, getEconomyEarnConfig(gs));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [duelResultEmbed(r)] });
}
async function slashDuelStats(interaction, data, guildId) {
    const target = interaction.options.getUser('user') || interaction.user;
    const r = coreDuelStats(ensureEconomy(data, guildId, target.id));
    await interaction.reply({ embeds: [okEmbed('⚔️ Duel Record', `${target.id === interaction.user.id ? 'You have' : `<@${target.id}> has`} won **${r.won}** and lost **${r.lost}** duels.`)] });
}

async function slashQuestsView(interaction, data, guildId) {
    const rec = ensureEconomy(data, guildId, interaction.user.id);
    await interaction.reply({ embeds: [questsViewEmbed(coreQuestsView(rec))] });
}
async function slashQuestsClaim(interaction, data, guildId) {
    const rec = ensureEconomy(data, guildId, interaction.user.id);
    const r = coreQuestsClaim(rec);
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [okEmbed('🎉 Quest Reward Claimed', `You earned ${fmtBeli(r.amount)}!\nWallet: ${fmtBeli(r.wallet)}`)] });
}

// ── Prefix handlers ──────────────────────────────────────────────────────
async function prefixGambleSlots(message, data, guildId, gs, args) {
    const r = coreSlots(ensureEconomy(data, guildId, message.author.id), args[0], getEconomyEarnConfig(gs));
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [slotsEmbed(r)] });
}
async function prefixGambleCoinflip(message, data, guildId, gs, args) {
    const r = coreCoinflip(ensureEconomy(data, guildId, message.author.id), args[0], args[1], getEconomyEarnConfig(gs));
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [coinflipEmbed(r)] });
}
async function prefixGambleDice(message, data, guildId, gs, args) {
    const r = coreDice(ensureEconomy(data, guildId, message.author.id), args[0], args[1], getEconomyEarnConfig(gs));
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [diceEmbed(r)] });
}
async function prefixGambleRoulette(message, data, guildId, gs, args) {
    const r = coreRoulette(ensureEconomy(data, guildId, message.author.id), args[0], args[1], getEconomyEarnConfig(gs));
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [rouletteEmbed(r)] });
}
async function prefixGambleHigherLower(message, data, guildId, gs, args) {
    const r = coreHigherLower(ensureEconomy(data, guildId, message.author.id), args[0], args[1], getEconomyEarnConfig(gs));
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [higherLowerEmbed(r)] });
}
async function prefixGambleMines(message, data, guildId, gs, args, saveData) {
    const rec = ensureEconomy(data, guildId, message.author.id);
    const r = coreMinesStart(rec, guildId, message.author.id, args[0], args[1], getEconomyEarnConfig(gs));
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    const radarNote = r.radarNote === null ? '' : `📡 Radar: top-left tile is **${r.radarNote ? 'SAFE' : 'A MINE'}**!`;
    const msg = await message.channel.send({ embeds: [minesEmbedInteractive(r.state, radarNote)], components: buildMinesComponents(r.state) });
    attachMinesCollector(msg, rec, guildId, message.author.id, data, saveData);
}
async function prefixGambleBlackjack(message, data, guildId, gs, args, saveData) {
    const rec = ensureEconomy(data, guildId, message.author.id);
    const r = coreBlackjackDeal(rec, guildId, message.author.id, args[0], getEconomyEarnConfig(gs));
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    const msg = await message.channel.send({ embeds: [r.done ? blackjackResultEmbed(r) : blackjackInProgressEmbed(r)], components: buildBlackjackComponents(r.done) });
    if (!r.done) attachBlackjackCollector(msg, rec, guildId, message.author.id, data, saveData);
}
async function prefixGambleBjHit(message, data, guildId) {
    const r = coreBlackjackHit(ensureEconomy(data, guildId, message.author.id), guildId, message.author.id);
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [blackjackHitEmbed(r)] });
}
async function prefixGambleBjStand(message, data, guildId, gs) {
    const r = coreBlackjackStand(ensureEconomy(data, guildId, message.author.id), guildId, message.author.id, getEconomyEarnConfig(gs));
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [blackjackResultEmbed(r)], components: [] });
}
async function prefixGambleCrash(message, data, guildId, gs, args, saveData) {
    const rec = ensureEconomy(data, guildId, message.author.id);
    const r = coreCrashStart(rec, guildId, message.author.id, args[0], getEconomyEarnConfig(gs));
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    const msg = await message.channel.send({ embeds: [crashLiveEmbed(r.game)], components: buildCrashComponents(false) });
    attachCrashLiveLoop(msg, rec, guildId, message.author.id, data, saveData);
}
async function prefixGambleWheel(message, data, guildId, gs, args) {
    const r = coreWheel(ensureEconomy(data, guildId, message.author.id), args[0], getEconomyEarnConfig(gs));
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [wheelEmbed(r)] });
}
async function prefixGambleScratch(message, data, guildId, gs, args) {
    const r = coreScratch(ensureEconomy(data, guildId, message.author.id), args[0], getEconomyEarnConfig(gs));
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [scratchEmbed(r)] });
}
async function prefixLottery(message, data, guildId, gs, args) {
    if (!args[0]) { const r = coreLotteryInfo(data, guildId, message.author.id, getEconomyEarnConfig(gs)); return message.channel.send({ embeds: [lotteryInfoEmbed(r)] }); }
    const r = coreLotteryBuy(data, guildId, message.author.id, args[0], getEconomyEarnConfig(gs));
    await message.channel.send({ embeds: [lotteryBuyEmbed(r)] });
}
async function prefixDuel(message, data, guildId, gs, args) {
    const action = (args[0] || '').toLowerCase();
    if (action === 'accept' || action === 'decline') {
        const r = coreDuelResolve(data, guildId, message.author.id, action === 'accept', getEconomyEarnConfig(gs));
        if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
        return message.channel.send({ embeds: [duelResultEmbed(r)] });
    }
    if (action === 'stats') {
        const target = await resolveUserArg(message, args[1]) || message.author;
        const r = coreDuelStats(ensureEconomy(data, guildId, target.id));
        return message.channel.send({ embeds: [okEmbed('⚔️ Duel Record', `${target.id === message.author.id ? 'You have' : `<@${target.id}> has`} won **${r.won}** and lost **${r.lost}** duels.`)] });
    }
    // default: treat as a challenge — !duel @user <bet>
    const target = await resolveUserArg(message, args[0]);
    if (!target) return message.channel.send({ embeds: [errEmbed('Usage: `!duel <@user> <bet>` or `!duel accept`/`decline`/`stats [@user]`.')] });
    if (target.bot) return message.channel.send({ embeds: [errEmbed("You can't duel a bot.")] });
    const r = coreDuelChallenge(data, guildId, message.author.id, target.id, args[1], getEconomyEarnConfig(gs));
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [duelChallengeEmbed(message.author.id, target.id, r.bet)] });
}
async function prefixQuests(message, data, guildId, args) {
    const rec = ensureEconomy(data, guildId, message.author.id);
    if ((args[0] || '').toLowerCase() === 'claim') {
        const r = coreQuestsClaim(rec);
        if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
        return message.channel.send({ embeds: [okEmbed('🎉 Quest Reward Claimed', `You earned ${fmtBeli(r.amount)}!\nWallet: ${fmtBeli(r.wallet)}`)] });
    }
    await message.channel.send({ embeds: [questsViewEmbed(coreQuestsView(rec))] });
}

// ══════════════════════════════════════════════════════════
//  SHOP GROUP — core logic + embeds
// ══════════════════════════════════════════════════════════
function coreShopBuy(rec, itemIdOrName, qtyRaw, gs = null) {
    const item = findShopItem(itemIdOrName, gs);
    if (!item) return { error: 'Item not found — check `/beli shop view` for the list.' };
    const qty = Math.max(1, Math.floor(Number(qtyRaw) || 1));
    const cost = item.price * qty;
    if (cost > rec.wallet) return { error: `You need ${fmtBeli(cost)} but only have ${fmtBeli(rec.wallet)}.` };
    removeWallet(rec, cost);
    addItemQty(rec, item.id, qty);
    return { item, qty, cost, wallet: rec.wallet };
}
function coreShopSell(rec, itemIdOrName, qtyRaw, gs = null) {
    const item = findShopItem(itemIdOrName, gs);
    if (!item) return { error: 'Item not found.' };
    const owned = getItemQty(rec, item.id);
    const qty = Math.max(1, Math.floor(Number(qtyRaw) || 1));
    if (qty > owned) return { error: `You only have ${owned}x ${item.name}.` };
    const refund = Math.round(item.price * 0.5 * qty);
    removeItemQty(rec, item.id, qty);
    addWallet(rec, refund);
    return { item, qty, refund, wallet: rec.wallet };
}
function coreShopUse(rec, itemIdOrName) {
    const item = findShopItem(itemIdOrName);
    if (!item) return { error: 'Item not found.' };
    if (item.type !== 'consumable') return { error: 'That item is cosmetic — nothing to use, it just shows on your profile.' };
    if (getItemQty(rec, item.id) < 1) return { error: `You don't own any ${item.name}.` };
    removeItemQty(rec, item.id, 1);
    if (item.boost === 'crate') {
        if (Math.random() < 0.6) {
            const amount = Math.round(1000 + Math.random() * 6000);
            addWallet(rec, amount);
            return { item, crateResult: 'beli', amount, wallet: rec.wallet };
        }
        const cosmetics = SHOP_ITEMS.filter(i => i.type === 'cosmetic');
        const won = cosmetics[Math.floor(Math.random() * cosmetics.length)];
        addItemQty(rec, won.id, 1);
        return { item, crateResult: 'cosmetic', wonItem: won, wallet: rec.wallet };
    }
    setBoost(rec, item.boost, item.durationMs || (10 * 60 * 1000));
    return { item, boosted: true, durationMs: item.durationMs, wallet: rec.wallet };
}
function coreGift(data, guildId, fromId, toId, itemIdOrName, qtyRaw) {
    if (fromId === toId) return { error: "You can't gift yourself." };
    const item = findShopItem(itemIdOrName);
    if (!item) return { error: 'Item not found.' };
    const fromRec = ensureEconomy(data, guildId, fromId);
    const owned = getItemQty(fromRec, item.id);
    const qty = Math.max(1, Math.floor(Number(qtyRaw) || 1));
    if (qty > owned) return { error: `You only have ${owned}x ${item.name}.` };
    const toRec = ensureEconomy(data, guildId, toId);
    removeItemQty(fromRec, item.id, qty);
    addItemQty(toRec, item.id, qty);
    return { item, qty };
}
function shopViewEmbed(gs = null) {
    const items = getGuildShopItems(gs);
    const consumables = items.filter(i => i.type === 'consumable').map(i => `${i.emoji} **${i.name}** — ${fmtBeli(i.price)}\n${i.desc}`).join('\n\n');
    const cosmetics = items.filter(i => i.type === 'cosmetic').map(i => `${i.emoji} **${i.name}** — ${fmtBeli(i.price)}`).join('\n');
    return new EmbedBuilder().setTitle('🛒 Beli Shop')
        .addFields({ name: 'Consumables', value: consumables, inline: false }, { name: 'Cosmetics', value: cosmetics, inline: false })
        .setFooter({ text: 'Buy with /beli shop buy <item> — or !buy <item>' }).setColor(COLOR_GOLD);
}
function inventoryEmbed(targetUser, isSelf, rec) {
    const entries = Object.entries(rec.inventory || {}).filter(([, q]) => q > 0);
    if (!entries.length) return new EmbedBuilder().setTitle(`${isSelf ? 'Your' : `${targetUser.username}'s`} Inventory`).setDescription('Empty — visit `/beli shop view`.').setColor(COLOR_INFO);
    const lines = entries.map(([id, qty]) => { const item = SHOP_ITEMS.find(i => i.id === id); return `${item ? item.emoji : '📦'} **${item ? item.name : id}** x${qty}`; });
    return new EmbedBuilder().setTitle(`${isSelf ? 'Your' : `${targetUser.username}'s`} Inventory`).setDescription(lines.join('\n')).setColor(COLOR_INFO);
}
function useResultEmbed(r) {
    if (r.crateResult === 'beli') return okEmbed('🍈 Crate Opened!', `You cracked the ${r.item.name} and found ${fmtBeli(r.amount)}!`);
    if (r.crateResult === 'cosmetic') return okEmbed('🍈 Crate Opened!', `You cracked the ${r.item.name} and found a **${r.wonItem.name}** ${r.wonItem.emoji}!`);
    return okEmbed('✅ Item Used', `Activated **${r.item.name}** for ${fmtDuration(r.durationMs)}.`);
}

// ── Slash handlers ───────────────────────────────────────────────────────
async function slashShopView(interaction, data, guildId, gs) { await interaction.reply({ embeds: [shopViewEmbed(gs)] }); }
async function slashShopBuy(interaction, data, guildId, gs) {
    const r = coreShopBuy(ensureEconomy(data, guildId, interaction.user.id), interaction.options.getString('item'), interaction.options.getInteger('quantity'), gs);
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [okEmbed('🛒 Purchased', `Bought ${r.qty}x ${r.item.emoji} **${r.item.name}** for ${fmtBeli(r.cost)}.\nWallet: ${fmtBeli(r.wallet)}`)] });
}
async function slashShopSell(interaction, data, guildId, gs) {
    const r = coreShopSell(ensureEconomy(data, guildId, interaction.user.id), interaction.options.getString('item'), interaction.options.getInteger('quantity'), gs);
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [okEmbed('🛒 Sold', `Sold ${r.qty}x ${r.item.emoji} **${r.item.name}** for ${fmtBeli(r.refund)}.\nWallet: ${fmtBeli(r.wallet)}`)] });
}
async function slashShopInventory(interaction, data, guildId) {
    const target = interaction.options.getUser('user') || interaction.user;
    await interaction.reply({ embeds: [inventoryEmbed(target, target.id === interaction.user.id, ensureEconomy(data, guildId, target.id))] });
}
async function slashShopUse(interaction, data, guildId, gs) {
    const r = coreShopUse(ensureEconomy(data, guildId, interaction.user.id), interaction.options.getString('item'));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [useResultEmbed(r)] });
}
async function slashShopGift(interaction, data, guildId) {
    const target = interaction.options.getUser('user');
    if (target.bot) return interaction.reply({ embeds: [errEmbed("You can't gift a bot.")], flags: 64 });
    const r = coreGift(data, guildId, interaction.user.id, target.id, interaction.options.getString('item'), interaction.options.getInteger('quantity'));
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [okEmbed('🎁 Gift Sent', `Sent ${r.qty}x ${r.item.emoji} **${r.item.name}** to <@${target.id}>.`)] });
}

// ── Prefix handlers ──────────────────────────────────────────────────────
async function prefixShopView(message, gs) { await message.channel.send({ embeds: [shopViewEmbed(gs)] }); }
async function prefixShopBuy(message, data, guildId, gs, args) {
    const r = coreShopBuy(ensureEconomy(data, guildId, message.author.id), args[0], parseInt(args[1], 10) || 1, gs);
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [okEmbed('🛒 Purchased', `Bought ${r.qty}x ${r.item.emoji} **${r.item.name}** for ${fmtBeli(r.cost)}.\nWallet: ${fmtBeli(r.wallet)}`)] });
}
async function prefixShopSell(message, data, guildId, gs, args) {
    const r = coreShopSell(ensureEconomy(data, guildId, message.author.id), args[0], parseInt(args[1], 10) || 1, gs);
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [okEmbed('🛒 Sold', `Sold ${r.qty}x ${r.item.emoji} **${r.item.name}** for ${fmtBeli(r.refund)}.\nWallet: ${fmtBeli(r.wallet)}`)] });
}
async function prefixShopInventory(message, data, guildId, args) {
    const target = await resolveUserArg(message, args[0]) || message.author;
    await message.channel.send({ embeds: [inventoryEmbed(target, target.id === message.author.id, ensureEconomy(data, guildId, target.id))] });
}
async function prefixShopUse(message, data, guildId, args) {
    const r = coreShopUse(ensureEconomy(data, guildId, message.author.id), args[0]);
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [useResultEmbed(r)] });
}
async function prefixShopGift(message, data, guildId, args) {
    const target = await resolveUserArg(message, args[0]);
    if (!target) return message.channel.send({ embeds: [errEmbed('Mention a valid user or give their ID.')] });
    if (target.bot) return message.channel.send({ embeds: [errEmbed("You can't gift a bot.")] });
    const itemArg = message.mentions.users.size ? args[1] : args[1];
    const r = coreGift(data, guildId, message.author.id, target.id, itemArg, parseInt(args[2], 10) || 1);
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [okEmbed('🎁 Gift Sent', `Sent ${r.qty}x ${r.item.emoji} **${r.item.name}** to <@${target.id}>.`)] });
}

// ══════════════════════════════════════════════════════════
//  UPGRADE GROUP — core logic + embeds
// ══════════════════════════════════════════════════════════
function coreUpgradeInfo(rec, gs = null) {
    return UPGRADE_TRACK_KEYS.map(k => {
        const tier = getUpgradeTier(rec, k), cfg = UPGRADE_TRACKS[k];
        return { key: k, label: cfg.label, desc: cfg.desc, tier, maxTier: cfg.maxTier, nextCost: upgradeCost(k, tier, gs) };
    });
}
function coreUpgradeBuy(rec, trackRaw, gs = null) {
    const track = String(trackRaw || '').toLowerCase();
    if (!UPGRADE_TRACKS[track]) return { error: `Unknown track. Choose one of: ${UPGRADE_TRACK_KEYS.join(', ')}.` };
    const tier = getUpgradeTier(rec, track);
    const cost = upgradeCost(track, tier, gs);
    if (cost === null) return { error: 'That track is already maxed out!' };
    if (cost > rec.wallet) return { error: `You need ${fmtBeli(cost)} but only have ${fmtBeli(rec.wallet)}.` };
    removeWallet(rec, cost);
    setUpgradeTier(rec, track, tier + 1);
    return { track, newTier: tier + 1, cost, wallet: rec.wallet };
}
function upgradeViewEmbed(rec, gs = null) {
    const lines = coreUpgradeInfo(rec, gs).map(i => `**${i.label}** — Tier ${i.tier}/${i.maxTier}\n${i.desc}\n${i.nextCost !== null ? `Next tier: ${fmtBeli(i.nextCost)}` : '**MAXED**'}`);
    return new EmbedBuilder().setTitle('⬆️ Upgrades').setDescription(lines.join('\n\n')).setFooter({ text: 'Buy with /beli upgrade buy <track> — or !upgrade <track>' }).setColor(COLOR_GOLD);
}

async function slashUpgradeView(interaction, data, guildId, gs) {
    await interaction.reply({ embeds: [upgradeViewEmbed(ensureEconomy(data, guildId, interaction.user.id), gs)] });
}
async function slashUpgradeBuy(interaction, data, guildId, gs) {
    const r = coreUpgradeBuy(ensureEconomy(data, guildId, interaction.user.id), interaction.options.getString('track'), gs);
    if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 });
    await interaction.reply({ embeds: [okEmbed('⬆️ Upgraded', `${UPGRADE_TRACKS[r.track].label} is now Tier ${r.newTier} (cost ${fmtBeli(r.cost)}).\nWallet: ${fmtBeli(r.wallet)}`)] });
}
async function prefixUpgrade(message, data, guildId, gs, args) {
    const rec = ensureEconomy(data, guildId, message.author.id);
    if (!args[0]) return message.channel.send({ embeds: [upgradeViewEmbed(rec, gs)] });
    const r = coreUpgradeBuy(rec, args[0], gs);
    if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] });
    await message.channel.send({ embeds: [okEmbed('⬆️ Upgraded', `${UPGRADE_TRACKS[r.track].label} is now Tier ${r.newTier} (cost ${fmtBeli(r.cost)}).\nWallet: ${fmtBeli(r.wallet)}`)] });
}

// ══════════════════════════════════════════════════════════
//  AUTOMOD GROUP — management commands (admin-only: gated on
//  ManageGuild/Administrator by the dispatcher before any of these run)
// ══════════════════════════════════════════════════════════
function hasAutomodPerm(member) {
    return !!(member?.permissions?.has(PermissionFlagsBits.ManageGuild) || member?.permissions?.has(PermissionFlagsBits.Administrator));
}
function coreAutomodWordAdd(gs, word) {
    const cfg = getAutomodConfig(gs);
    const w = String(word || '').trim().toLowerCase();
    if (!w) return { error: 'Give a word or phrase to block.' };
    if (w.length > 100) return { error: 'Keep it under 100 characters.' };
    if (cfg.automodWords.length >= MAX_AUTOMOD_WORDS) return { error: `You've hit the limit of ${MAX_AUTOMOD_WORDS} blocked words.` };
    if (cfg.automodWords.includes(w)) return { error: 'That word is already blocked.' };
    cfg.automodWords.push(w);
    return { word: w, count: cfg.automodWords.length };
}
function coreAutomodWordRemove(gs, word) {
    const cfg = getAutomodConfig(gs);
    const w = String(word || '').trim().toLowerCase();
    const idx = cfg.automodWords.indexOf(w);
    if (idx === -1) return { error: 'That word is not in your blocked list.' };
    cfg.automodWords.splice(idx, 1);
    return { word: w, count: cfg.automodWords.length };
}
function coreAutomodWordList(gs) { return getAutomodConfig(gs).automodWords; }
function coreAutomodWordClear(gs) {
    const cfg = getAutomodConfig(gs);
    const count = cfg.automodWords.length;
    cfg.automodWords = [];
    return { count };
}
function coreAutomodRegexAdd(gs, pattern, flags) {
    const cfg = getAutomodConfig(gs);
    if (cfg.automodRegexRules.length >= MAX_AUTOMOD_REGEX) return { error: `You've hit the limit of ${MAX_AUTOMOD_REGEX} regex rules.` };
    const err = validateRegexPattern(pattern, flags);
    if (err) return { error: err };
    const safeFlags = String(flags || 'i').replace(/[^gimsuy]/g, '') || 'i';
    if (cfg.automodRegexRules.some(r => r.pattern === pattern && r.flags === safeFlags)) return { error: 'That exact pattern is already added.' };
    cfg.automodRegexRules.push({ pattern, flags: safeFlags });
    return { pattern, flags: safeFlags, count: cfg.automodRegexRules.length };
}
function coreAutomodRegexRemove(gs, pattern) {
    const cfg = getAutomodConfig(gs);
    const idx = cfg.automodRegexRules.findIndex(r => r.pattern === pattern);
    if (idx === -1) return { error: 'That pattern is not in your regex list.' };
    cfg.automodRegexRules.splice(idx, 1);
    return { pattern, count: cfg.automodRegexRules.length };
}
function coreAutomodRegexClear(gs) {
    const cfg = getAutomodConfig(gs);
    const count = cfg.automodRegexRules.length;
    cfg.automodRegexRules = [];
    return { count };
}
function coreAutomodExemptRole(gs, roleId) {
    const cfg = getAutomodConfig(gs);
    if (cfg.automodExemptRoleIds.includes(roleId)) return { error: 'That role is already exempt.' };
    cfg.automodExemptRoleIds.push(roleId);
    return { roleId };
}
function coreAutomodUnexemptRole(gs, roleId) {
    const cfg = getAutomodConfig(gs);
    const idx = cfg.automodExemptRoleIds.indexOf(roleId);
    if (idx === -1) return { error: 'That role is not exempt.' };
    cfg.automodExemptRoleIds.splice(idx, 1);
    return { roleId };
}
function coreAutomodExemptChannel(gs, channelId) {
    const cfg = getAutomodConfig(gs);
    if (cfg.automodExemptChannelIds.includes(channelId)) return { error: 'That channel is already exempt.' };
    cfg.automodExemptChannelIds.push(channelId);
    return { channelId };
}
function coreAutomodUnexemptChannel(gs, channelId) {
    const cfg = getAutomodConfig(gs);
    const idx = cfg.automodExemptChannelIds.indexOf(channelId);
    if (idx === -1) return { error: 'That channel is not exempt.' };
    cfg.automodExemptChannelIds.splice(idx, 1);
    return { channelId };
}
function coreAutomodSetAction(gs, action) {
    const cfg = getAutomodConfig(gs);
    const valid = ['delete', 'warn', 'timeout', 'kick', 'ban'];
    if (!valid.includes(action)) return { error: `Action must be one of: ${valid.join(', ')}.` };
    cfg.automodAction = action;
    return { action };
}
function coreAutomodSetTimeout(gs, minutes) {
    const cfg = getAutomodConfig(gs);
    const m = Math.floor(Number(minutes));
    if (!Number.isFinite(m) || m < 1 || m > 40320) return { error: 'Timeout must be 1-40320 minutes (28 days max).' };
    cfg.automodTimeoutMinutes = m;
    return { minutes: m };
}
function coreAutomodSetLogChannel(gs, channelId) { getAutomodConfig(gs).automodLogChannelId = channelId; return { channelId }; }
function coreAutomodEnable(gs) { getAutomodConfig(gs).automodEnabled = true; return {}; }
function coreAutomodDisable(gs) { getAutomodConfig(gs).automodEnabled = false; return {}; }
function coreAutomodReset(gs) { Object.assign(gs, JSON.parse(JSON.stringify(AUTOMOD_DEFAULTS))); return {}; }
function coreAutomodTest(gs, text) { const cfg = getAutomodConfig(gs); return { matched: !!testAutomodMatch(text, cfg), match: testAutomodMatch(text, cfg) }; }

function automodStatusEmbed(gs) {
    const cfg = getAutomodConfig(gs);
    const exemptRoles = cfg.automodExemptRoleIds.map(id => `<@&${id}>`).join(', ') || 'None';
    const exemptChannels = cfg.automodExemptChannelIds.map(id => `<#${id}>`).join(', ') || 'None';
    return new EmbedBuilder().setTitle('🚫 Custom AutoMod Status')
        .addFields(
            { name: 'Enabled', value: cfg.automodEnabled ? '✅ Yes' : '❌ No', inline: true },
            { name: 'Action', value: cfg.automodAction, inline: true },
            { name: 'Timeout Duration', value: `${cfg.automodTimeoutMinutes}m`, inline: true },
            { name: 'Delete Messages', value: cfg.automodDeleteMessage ? 'Yes' : 'No', inline: true },
            { name: 'Log Channel', value: cfg.automodLogChannelId ? `<#${cfg.automodLogChannelId}>` : 'None', inline: true },
            { name: `Blocked Words (${cfg.automodWords.length}/${MAX_AUTOMOD_WORDS})`, value: (cfg.automodWords.length ? cfg.automodWords.slice(0, 30).map(w => `\`${w}\``).join(', ') + (cfg.automodWords.length > 30 ? '…' : '') : 'None').slice(0, 1024), inline: false },
            { name: `Regex Rules (${cfg.automodRegexRules.length}/${MAX_AUTOMOD_REGEX})`, value: (cfg.automodRegexRules.length ? cfg.automodRegexRules.slice(0, 15).map(r => `\`/${r.pattern}/${r.flags}\``).join(', ') : 'None').slice(0, 1024), inline: false },
            { name: 'Exempt Roles', value: exemptRoles.slice(0, 1024), inline: false },
            { name: 'Exempt Channels', value: exemptChannels.slice(0, 1024), inline: false },
        ).setColor(cfg.automodEnabled ? COLOR_OK : COLOR_BAD);
}

// ── Slash handlers (21) ──────────────────────────────────────────────────
async function slashAutomodWordAdd(interaction, gs) { const r = coreAutomodWordAdd(gs, interaction.options.getString('word')); if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 }); await interaction.reply({ embeds: [okEmbed('🚫 Word Blocked', `Added \`${r.word}\` (${r.count}/${MAX_AUTOMOD_WORDS}).`)] }); }
async function slashAutomodWordRemove(interaction, gs) { const r = coreAutomodWordRemove(gs, interaction.options.getString('word')); if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 }); await interaction.reply({ embeds: [okEmbed('✅ Word Unblocked', `Removed \`${r.word}\` (${r.count} remaining).`)] }); }
async function slashAutomodWordList(interaction, gs) { const words = coreAutomodWordList(gs); await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`🚫 Blocked Words (${words.length})`).setDescription((words.length ? words.map(w => `\`${w}\``).join(', ') : 'None yet.').slice(0, 4000)).setColor(COLOR_INFO)], flags: 64 }); }
async function slashAutomodWordClear(interaction, gs) { const r = coreAutomodWordClear(gs); await interaction.reply({ embeds: [okEmbed('🗑️ Cleared', `Removed all ${r.count} blocked words.`)] }); }
async function slashAutomodRegexAdd(interaction, gs) { const r = coreAutomodRegexAdd(gs, interaction.options.getString('pattern'), interaction.options.getString('flags')); if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 }); await interaction.reply({ embeds: [okEmbed('🚫 Regex Added', `Added \`/${r.pattern}/${r.flags}\` (${r.count}/${MAX_AUTOMOD_REGEX}).`)] }); }
async function slashAutomodRegexRemove(interaction, gs) { const r = coreAutomodRegexRemove(gs, interaction.options.getString('pattern')); if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 }); await interaction.reply({ embeds: [okEmbed('✅ Regex Removed', `Removed \`${r.pattern}\` (${r.count} remaining).`)] }); }
async function slashAutomodRegexList(interaction, gs) { const cfg = getAutomodConfig(gs); await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`🚫 Regex Rules (${cfg.automodRegexRules.length})`).setDescription((cfg.automodRegexRules.length ? cfg.automodRegexRules.map(r => `\`/${r.pattern}/${r.flags}\``).join('\n') : 'None yet.').slice(0, 4000)).setColor(COLOR_INFO)], flags: 64 }); }
async function slashAutomodRegexClear(interaction, gs) { const r = coreAutomodRegexClear(gs); await interaction.reply({ embeds: [okEmbed('🗑️ Cleared', `Removed all ${r.count} regex rules.`)] }); }
async function slashAutomodExemptRole(interaction, gs) { const role = interaction.options.getRole('role'); const r = coreAutomodExemptRole(gs, role.id); if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 }); await interaction.reply({ embeds: [okEmbed('✅ Role Exempted', `<@&${role.id}> is now exempt.`)] }); }
async function slashAutomodUnexemptRole(interaction, gs) { const role = interaction.options.getRole('role'); const r = coreAutomodUnexemptRole(gs, role.id); if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 }); await interaction.reply({ embeds: [okEmbed('✅ Exemption Removed', `<@&${role.id}> is no longer exempt.`)] }); }
async function slashAutomodExemptChannel(interaction, gs) { const channel = interaction.options.getChannel('channel'); const r = coreAutomodExemptChannel(gs, channel.id); if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 }); await interaction.reply({ embeds: [okEmbed('✅ Channel Exempted', `<#${channel.id}> is now exempt.`)] }); }
async function slashAutomodUnexemptChannel(interaction, gs) { const channel = interaction.options.getChannel('channel'); const r = coreAutomodUnexemptChannel(gs, channel.id); if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 }); await interaction.reply({ embeds: [okEmbed('✅ Exemption Removed', `<#${channel.id}> is no longer exempt.`)] }); }
async function slashAutomodExemptList(interaction, gs) { await interaction.reply({ embeds: [automodStatusEmbed(gs)], flags: 64 }); }
async function slashAutomodAction(interaction, gs) { const r = coreAutomodSetAction(gs, interaction.options.getString('type')); if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 }); await interaction.reply({ embeds: [okEmbed('⚙️ Action Set', `Custom AutoMod will now **${r.action}** on a match.`)] }); }
async function slashAutomodTimeoutDuration(interaction, gs) { const r = coreAutomodSetTimeout(gs, interaction.options.getInteger('minutes')); if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 }); await interaction.reply({ embeds: [okEmbed('⚙️ Timeout Duration Set', `Timeouts will now last ${r.minutes} minutes.`)] }); }
async function slashAutomodLogChannel(interaction, gs) { const channel = interaction.options.getChannel('channel'); coreAutomodSetLogChannel(gs, channel.id); await interaction.reply({ embeds: [okEmbed('⚙️ Log Channel Set', `Custom AutoMod hits will be logged to <#${channel.id}>.`)] }); }
async function slashAutomodEnable(interaction, gs) { coreAutomodEnable(gs); await interaction.reply({ embeds: [okEmbed('✅ Custom AutoMod Enabled', 'Your word/regex rules are now active.')] }); }
async function slashAutomodDisable(interaction, gs) { coreAutomodDisable(gs); await interaction.reply({ embeds: [okEmbed('🛑 Custom AutoMod Disabled', 'Your rules are saved but inactive.')] }); }
async function slashAutomodStatus(interaction, gs) { await interaction.reply({ embeds: [automodStatusEmbed(gs)] }); }
async function slashAutomodReset(interaction, gs) { coreAutomodReset(gs); await interaction.reply({ embeds: [okEmbed('🗑️ Reset', 'Custom AutoMod configuration wiped back to defaults.')] }); }
async function slashAutomodTest(interaction, gs) { const r = coreAutomodTest(gs, interaction.options.getString('text')); await interaction.reply({ embeds: [new EmbedBuilder().setTitle(r.matched ? '🚫 Would Be Blocked' : '✅ Would Pass').setDescription(r.matched ? `Matched ${r.match.type} rule: \`${r.match.rule}\`` : 'No rule matches this text.').setColor(r.matched ? COLOR_BAD : COLOR_OK)], flags: 64 }); }

// ── Prefix dispatcher (single `!automod <action> [...args]` command) ────
async function handleAutomodPrefixAction(message, gs, action, args) {
    const send = (embeds) => message.channel.send({ embeds });
    switch (action) {
        case 'word-add': case 'wordadd': { const r = coreAutomodWordAdd(gs, args.join(' ')); return send([r.error ? errEmbed(r.error) : okEmbed('🚫 Word Blocked', `Added \`${r.word}\` (${r.count}/${MAX_AUTOMOD_WORDS}).`)]); }
        case 'word-remove': case 'wordremove': { const r = coreAutomodWordRemove(gs, args.join(' ')); return send([r.error ? errEmbed(r.error) : okEmbed('✅ Word Unblocked', `Removed \`${r.word}\` (${r.count} remaining).`)]); }
        case 'word-list': case 'wordlist': { const words = coreAutomodWordList(gs); return send([new EmbedBuilder().setTitle(`🚫 Blocked Words (${words.length})`).setDescription((words.length ? words.map(w => `\`${w}\``).join(', ') : 'None yet.').slice(0, 4000)).setColor(COLOR_INFO)]); }
        case 'word-clear': case 'wordclear': { const r = coreAutomodWordClear(gs); return send([okEmbed('🗑️ Cleared', `Removed all ${r.count} blocked words.`)]); }
        case 'regex-add': case 'regexadd': {
            let flags = 'i'; let patternArgs = args.slice();
            if (patternArgs.length > 1 && /^[gimsuy]+$/.test(patternArgs[patternArgs.length - 1])) flags = patternArgs.pop();
            const r = coreAutomodRegexAdd(gs, patternArgs.join(' '), flags);
            return send([r.error ? errEmbed(r.error) : okEmbed('🚫 Regex Added', `Added \`/${r.pattern}/${r.flags}\` (${r.count}/${MAX_AUTOMOD_REGEX}).`)]);
        }
        case 'regex-remove': case 'regexremove': { const r = coreAutomodRegexRemove(gs, args.join(' ')); return send([r.error ? errEmbed(r.error) : okEmbed('✅ Regex Removed', `Removed \`${r.pattern}\` (${r.count} remaining).`)]); }
        case 'regex-list': case 'regexlist': { const cfg = getAutomodConfig(gs); return send([new EmbedBuilder().setTitle(`🚫 Regex Rules (${cfg.automodRegexRules.length})`).setDescription((cfg.automodRegexRules.length ? cfg.automodRegexRules.map(r => `\`/${r.pattern}/${r.flags}\``).join('\n') : 'None yet.').slice(0, 4000)).setColor(COLOR_INFO)]); }
        case 'regex-clear': case 'regexclear': { const r = coreAutomodRegexClear(gs); return send([okEmbed('🗑️ Cleared', `Removed all ${r.count} regex rules.`)]); }
        case 'exempt-role': case 'exemptrole': { const role = message.mentions.roles.first(); if (!role) return send([errEmbed('Mention a role.')]); const r = coreAutomodExemptRole(gs, role.id); return send([r.error ? errEmbed(r.error) : okEmbed('✅ Role Exempted', `<@&${role.id}> is now exempt.`)]); }
        case 'unexempt-role': case 'unexemptrole': { const role = message.mentions.roles.first(); if (!role) return send([errEmbed('Mention a role.')]); const r = coreAutomodUnexemptRole(gs, role.id); return send([r.error ? errEmbed(r.error) : okEmbed('✅ Exemption Removed', `<@&${role.id}> is no longer exempt.`)]); }
        case 'exempt-channel': case 'exemptchannel': { const channel = message.mentions.channels.first(); if (!channel) return send([errEmbed('Mention a channel.')]); const r = coreAutomodExemptChannel(gs, channel.id); return send([r.error ? errEmbed(r.error) : okEmbed('✅ Channel Exempted', `<#${channel.id}> is now exempt.`)]); }
        case 'unexempt-channel': case 'unexemptchannel': { const channel = message.mentions.channels.first(); if (!channel) return send([errEmbed('Mention a channel.')]); const r = coreAutomodUnexemptChannel(gs, channel.id); return send([r.error ? errEmbed(r.error) : okEmbed('✅ Exemption Removed', `<#${channel.id}> is no longer exempt.`)]); }
        case 'exempt-list': case 'exemptlist': return send([automodStatusEmbed(gs)]);
        case 'action': { const r = coreAutomodSetAction(gs, (args[0] || '').toLowerCase()); return send([r.error ? errEmbed(r.error) : okEmbed('⚙️ Action Set', `Custom AutoMod will now **${r.action}** on a match.`)]); }
        case 'timeout': case 'timeout-duration': { const r = coreAutomodSetTimeout(gs, args[0]); return send([r.error ? errEmbed(r.error) : okEmbed('⚙️ Timeout Duration Set', `Timeouts will now last ${r.minutes} minutes.`)]); }
        case 'logchannel': { const channel = message.mentions.channels.first(); if (!channel) return send([errEmbed('Mention a channel.')]); coreAutomodSetLogChannel(gs, channel.id); return send([okEmbed('⚙️ Log Channel Set', `Custom AutoMod hits will be logged to <#${channel.id}>.`)]); }
        case 'enable': coreAutomodEnable(gs); return send([okEmbed('✅ Custom AutoMod Enabled', 'Your word/regex rules are now active.')]);
        case 'disable': coreAutomodDisable(gs); return send([okEmbed('🛑 Custom AutoMod Disabled', 'Your rules are saved but inactive.')]);
        case 'status': return send([automodStatusEmbed(gs)]);
        case 'reset': coreAutomodReset(gs); return send([okEmbed('🗑️ Reset', 'Custom AutoMod configuration wiped back to defaults.')]);
        case 'test': { const r = coreAutomodTest(gs, args.join(' ')); return send([new EmbedBuilder().setTitle(r.matched ? '🚫 Would Be Blocked' : '✅ Would Pass').setDescription(r.matched ? `Matched ${r.match.type} rule: \`${r.match.rule}\`` : 'No rule matches this text.').setColor(r.matched ? COLOR_BAD : COLOR_OK)]); }
        default: return send([errEmbed('Unknown automod action. Try: word-add, word-remove, word-list, word-clear, regex-add, regex-remove, regex-list, regex-clear, exempt-role, exempt-channel, unexempt-role, unexempt-channel, action, timeout, logchannel, enable, disable, status, reset, test.')]);
    }
}

// ══════════════════════════════════════════════════════════
//  THE SLASH COMMAND  —  ONE top-level command, 6 subcommand groups,
//  53 total actions. This is the entire slot-budget cost: 1/1 remaining.
// ══════════════════════════════════════════════════════════
// Same model catalog already used elsewhere in the bot (roast/AI-config), so
// "every model" here means the same familiar set, not a different list.
// (Defined ahead of the builder below since its ai/help groups reference
// these to build option choices.)
const AI_MODEL_CATALOG = {
    'claude-sonnet':     { provider: 'claude',   model: 'claude-sonnet-5',        label: 'Claude — Sonnet 5' },
    'claude-opus':       { provider: 'claude',   model: 'claude-opus-4-8',        label: 'Claude — Opus 4.8' },
    'claude-haiku':      { provider: 'claude',   model: 'claude-haiku-4-5-20251001', label: 'Claude — Haiku 4.5 (fast)' },
    'openai-gpt4o':      { provider: 'openai',   model: 'gpt-4o',                 label: 'OpenAI — gpt-4o' },
    'openai-gpt4omini':  { provider: 'openai',   model: 'gpt-4o-mini',            label: 'OpenAI — gpt-4o-mini' },
    'openai-gpt55':      { provider: 'openai',   model: 'gpt-5.5',                label: 'OpenAI — GPT-5.5 (flagship)' },
    'gemini':            { provider: 'gemini',   model: 'gemini-2.5-flash',       label: 'Gemini — 2.5 Flash (fast)' },
    'gemini-pro':        { provider: 'gemini',   model: 'gemini-2.5-pro',         label: 'Gemini — 2.5 Pro (powerful)' },
    'gemini-31pro':      { provider: 'gemini',   model: 'gemini-3.1-pro-preview', label: 'Gemini — 3.1 Pro (reasoning)' },
    'groq':              { provider: 'groq',     model: 'openai/gpt-oss-120b',    label: 'Groq — GPT-OSS 120B' },
    'groq-qwen':         { provider: 'groq',     model: 'qwen/qwen3.6-27b',       label: 'Groq — Qwen3.6 27B' },
    'mistral':           { provider: 'mistral',  model: 'mistral-large-latest',   label: 'Mistral — Large' },
    'deepseek':          { provider: 'deepseek', model: 'deepseek-v4-flash',      label: 'DeepSeek — V4 Flash' },
    'deepseek-reasoner': { provider: 'deepseek', model: 'deepseek-v4-pro',        label: 'DeepSeek — V4 Pro (reasoning)' },
    'grok':              { provider: 'grok',     model: 'grok-4.3',               label: 'xAI — Grok 4.3' },
};
const OPENAI_COMPAT_BASE_URLS = {
    openai: 'https://api.openai.com/v1', groq: 'https://api.groq.com/openai/v1',
    deepseek: 'https://api.deepseek.com', mistral: 'https://api.mistral.ai/v1', grok: 'https://api.x.ai/v1',
};
const PROVIDER_KEY_HINT = {
    claude: 'Anthropic API key (starts with sk-ant-)', openai: 'OpenAI API key (starts with sk-)',
    gemini: 'Google AI Studio API key', groq: 'Groq API key (starts with gsk_)',
    deepseek: 'DeepSeek API key', mistral: 'Mistral API key', grok: 'xAI API key',
};
const AI_PROVIDERS = Object.keys(PROVIDER_KEY_HINT);

const beliCommand = new SlashCommandBuilder()
    .setName('beli')
    .setDescription('Economy, gambling, shop, upgrades & custom AutoMod — DISCOMOD expansion')
    .addSubcommandGroup(group => group
        .setName('economy')
        .setDescription('Balance, bank, and transfers')
        .addSubcommand(sub => sub.setName('balance').setDescription("Check your or someone else's Beli balance")
            .addUserOption(o => o.setName('user').setDescription('Whose balance to check').setRequired(false)))
        .addSubcommand(sub => sub.setName('leaderboard').setDescription('See the richest players in this server'))
        .addSubcommand(sub => sub.setName('deposit').setDescription('Move Beli from wallet to bank')
            .addStringOption(o => o.setName('amount').setDescription('Amount, "half", or "all"').setRequired(true)))
        .addSubcommand(sub => sub.setName('withdraw').setDescription('Move Beli from bank to wallet')
            .addStringOption(o => o.setName('amount').setDescription('Amount, "half", or "all"').setRequired(true)))
        .addSubcommand(sub => sub.setName('pay').setDescription('Send Beli to another player')
            .addUserOption(o => o.setName('user').setDescription('Who to pay').setRequired(true))
            .addStringOption(o => o.setName('amount').setDescription('Amount, "half", or "all"').setRequired(true)))
        .addSubcommand(sub => sub.setName('profile').setDescription("View your or someone else's full profile")
            .addUserOption(o => o.setName('user').setDescription('Whose profile to view').setRequired(false)))
    )
    .addSubcommandGroup(group => group
        .setName('earn')
        .setDescription('Ways to earn Beli')
        .addSubcommand(sub => sub.setName('daily').setDescription('Claim your daily Beli reward'))
        .addSubcommand(sub => sub.setName('weekly').setDescription('Claim your weekly Beli reward'))
        .addSubcommand(sub => sub.setName('work').setDescription('Work a random job for Beli'))
        .addSubcommand(sub => sub.setName('crime').setDescription('Attempt a risky crime for a bigger payout'))
        .addSubcommand(sub => sub.setName('fish').setDescription('Go fishing for Beli and rare loot'))
        .addSubcommand(sub => sub.setName('hunt').setDescription('Go bounty hunting for Beli and rare loot'))
        .addSubcommand(sub => sub.setName('trivia').setDescription('Get a Blox Fruits trivia question for bonus Beli'))
        .addSubcommand(sub => sub.setName('trivia-answer').setDescription('Answer your active trivia question')
            .addStringOption(o => o.setName('answer').setDescription('Your answer').setRequired(true)
                .addChoices({ name: 'A', value: 'A' }, { name: 'B', value: 'B' }, { name: 'C', value: 'C' }, { name: 'D', value: 'D' })))
        .addSubcommand(sub => sub.setName('rob').setDescription("Attempt to rob another player's wallet")
            .addUserOption(o => o.setName('user').setDescription('Who to rob').setRequired(true)))
    )
    .addSubcommandGroup(group => group
        .setName('gamble')
        .setDescription('Casino-style Beli minigames')
        .addSubcommand(sub => sub.setName('slots').setDescription('Spin the slot machine')
            .addStringOption(o => o.setName('bet').setDescription('Amount, "half", or "all"').setRequired(true)))
        .addSubcommand(sub => sub.setName('coinflip').setDescription('Flip a coin')
            .addStringOption(o => o.setName('bet').setDescription('Amount, "half", or "all"').setRequired(true))
            .addStringOption(o => o.setName('side').setDescription('Heads or tails').setRequired(true)
                .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' })))
        .addSubcommand(sub => sub.setName('blackjack').setDescription('Deal a hand of blackjack')
            .addStringOption(o => o.setName('bet').setDescription('Amount, "half", or "all"').setRequired(true)))
        .addSubcommand(sub => sub.setName('blackjack-hit').setDescription('Hit on your active blackjack hand'))
        .addSubcommand(sub => sub.setName('blackjack-stand').setDescription('Stand on your active blackjack hand'))
        .addSubcommand(sub => sub.setName('dice').setDescription('Guess the die roll 1-6 for a 5x payout')
            .addStringOption(o => o.setName('bet').setDescription('Amount, "half", or "all"').setRequired(true))
            .addIntegerOption(o => o.setName('guess').setDescription('Your guess (1-6)').setRequired(true).setMinValue(1).setMaxValue(6)))
        .addSubcommand(sub => sub.setName('roulette').setDescription('Bet on red/black/green or an exact number')
            .addStringOption(o => o.setName('bet').setDescription('Amount, "half", or "all"').setRequired(true))
            .addStringOption(o => o.setName('choice').setDescription('red, black, green, or 0-36').setRequired(true)))
        .addSubcommand(sub => sub.setName('higherlower').setDescription('Guess if the next card is higher or lower')
            .addStringOption(o => o.setName('bet').setDescription('Amount, "half", or "all"').setRequired(true))
            .addStringOption(o => o.setName('guess').setDescription('Higher or lower').setRequired(true)
                .addChoices({ name: 'Higher', value: 'higher' }, { name: 'Lower', value: 'lower' })))
        .addSubcommand(sub => sub.setName('mines').setDescription('Click tiles, cash out anytime')
            .addStringOption(o => o.setName('bet').setDescription('Amount, "half", or "all"').setRequired(true))
            .addIntegerOption(o => o.setName('mines').setDescription('Number of mines (1-19)').setRequired(true).setMinValue(1).setMaxValue(19)))
        .addSubcommand(sub => sub.setName('crash').setDescription('Live crash game — cash out before it crashes')
            .addStringOption(o => o.setName('bet').setDescription('Amount, "half", or "all"').setRequired(true)))
        .addSubcommand(sub => sub.setName('wheel').setDescription('Spin the wheel of fortune')
            .addStringOption(o => o.setName('bet').setDescription('Amount, "half", or "all"').setRequired(true)))
        .addSubcommand(sub => sub.setName('scratch').setDescription('Scratch a card — match 3+ symbols to win')
            .addStringOption(o => o.setName('bet').setDescription('Amount, "half", or "all"').setRequired(true)))
        .addSubcommand(sub => sub.setName('lottery-buy').setDescription('Buy jackpot tickets (100 Beli each)')
            .addIntegerOption(o => o.setName('count').setDescription('Number of tickets').setRequired(true).setMinValue(1).setMaxValue(100)))
        .addSubcommand(sub => sub.setName('lottery-info').setDescription('View the jackpot, your tickets, and time to draw'))
        .addSubcommand(sub => { sub.setName('keno').setDescription('Pick 1-10 numbers from 1-40, match the draw');
            sub.addStringOption(o => o.setName('bet').setDescription('Amount, "half", or "all"').setRequired(true));
            sub.addStringOption(o => o.setName('numbers').setDescription('Comma-separated, e.g. 3,17,29').setRequired(true));
            return sub; })
        .addSubcommand(sub => { sub.setName('limbo').setDescription('Pick a target multiplier, one instant roll');
            sub.addStringOption(o => o.setName('bet').setDescription('Amount, "half", or "all"').setRequired(true));
            sub.addNumberOption(o => o.setName('target').setDescription('1.01-1000').setRequired(true).setMinValue(1.01).setMaxValue(1000));
            return sub; })
        .addSubcommand(sub => sub.setName('war').setDescription('One card each — highest wins')
            .addStringOption(o => o.setName('bet').setDescription('Amount, "half", or "all"').setRequired(true)))
    )
    .addSubcommandGroup(group => group
        .setName('duel')
        .setDescription('Winner-take-all Beli duel vs another player')
        .addSubcommand(sub => sub.setName('challenge').setDescription('Challenge someone to a duel')
            .addUserOption(o => o.setName('user').setDescription('Who to challenge').setRequired(true))
            .addStringOption(o => o.setName('bet').setDescription('Amount to stake').setRequired(true)))
        .addSubcommand(sub => sub.setName('accept').setDescription('Accept a pending duel challenge against you'))
        .addSubcommand(sub => sub.setName('decline').setDescription('Decline a pending duel challenge against you'))
        .addSubcommand(sub => sub.setName('stats').setDescription("View your or someone else's duel record")
            .addUserOption(o => o.setName('user').setDescription('Whose record to view').setRequired(false)))
    )
    .addSubcommandGroup(group => group
        .setName('quests')
        .setDescription('Daily quests for bonus Beli')
        .addSubcommand(sub => sub.setName('view').setDescription("View today's quests and your progress"))
        .addSubcommand(sub => sub.setName('claim').setDescription('Claim your reward once all of today\'s quests are done'))
    )
    .addSubcommandGroup(group => group
        .setName('security')
        .setDescription('Honeypot traps: channels, a role, fake commands (Manage Server)')
        .addSubcommand(sub => sub.setName('honeypot-enable').setDescription('Enable honeypot traps'))
        .addSubcommand(sub => sub.setName('honeypot-disable').setDescription('Disable honeypot traps'))
        .addSubcommand(sub => sub.setName('honeypot-status').setDescription('View current honeypot configuration'))
        .addSubcommand(sub => sub.setName('honeypot-action').setDescription('Set the action taken when a trap fires')
            .addStringOption(o => o.setName('type').setDescription('Action type').setRequired(true)
                .addChoices({ name: 'Softban (ban+unban — wipes last hour of messages, not permanent)', value: 'softban' }, { name: 'Ban', value: 'ban' }, { name: 'Kick', value: 'kick' }, { name: 'Timeout (28 days)', value: 'timeout' })))
        .addSubcommand(sub => sub.setName('honeypot-reinvite').setDescription('DM a one-time invite back in after a softban/kick (not applicable to ban/timeout)')
            .addBooleanOption(o => o.setName('enabled').setDescription('Send the reinvite DM').setRequired(true)))
        .addSubcommand(sub => sub.setName('honeypot-messages').setDescription('Customize the Warning/DM/Log messages honeypots send (opens a form)'))
        .addSubcommand(sub => sub.setName('honeypot-post-warning').setDescription('Post (and pin) the Warning message in every configured honeypot channel'))
        .addSubcommand(sub => sub.setName('honeypot-logchannel').setDescription('Set the channel for honeypot hit logs')
            .addChannelOption(o => o.setName('channel').setDescription('Log channel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub => sub.setName('honeypot-channel-add').setDescription('Turn a channel into a honeypot trap')
            .addChannelOption(o => o.setName('channel').setDescription('Channel to trap').setRequired(true)))
        .addSubcommand(sub => sub.setName('honeypot-channel-remove').setDescription('Remove a channel from the honeypot list')
            .addChannelOption(o => o.setName('channel').setDescription('Channel to un-trap').setRequired(true)))
        .addSubcommand(sub => sub.setName('honeypot-role-set').setDescription('Set a role as a trap (granting it triggers the action)')
            .addRoleOption(o => o.setName('role').setDescription('Trap role').setRequired(true)))
        .addSubcommand(sub => sub.setName('honeypot-role-clear').setDescription('Clear the trap role'))
        .addSubcommand(sub => sub.setName('honeypot-command-add').setDescription('Add a fake prefix command name as a trap')
            .addStringOption(o => o.setName('name').setDescription('Fake command name (no prefix)').setRequired(true)))
        .addSubcommand(sub => sub.setName('honeypot-command-remove').setDescription('Remove a trap command name')
            .addStringOption(o => o.setName('name').setDescription('Command name to remove').setRequired(true)))
    )
    .addSubcommandGroup(group => group
        .setName('shop')
        .setDescription('Buy, sell, and use items')
        .addSubcommand(sub => sub.setName('view').setDescription('Browse the shop'))
        .addSubcommand(sub => { sub.setName('buy').setDescription('Buy an item');
            sub.addStringOption(o => { o.setName('item').setDescription('Item to buy').setRequired(true); SHOP_ITEMS.forEach(i => o.addChoices({ name: i.name, value: i.id })); return o; });
            sub.addIntegerOption(o => o.setName('quantity').setDescription('How many (default 1)').setRequired(false).setMinValue(1));
            return sub; })
        .addSubcommand(sub => { sub.setName('sell').setDescription('Sell an item back for 50% of its price');
            sub.addStringOption(o => { o.setName('item').setDescription('Item to sell').setRequired(true); SHOP_ITEMS.forEach(i => o.addChoices({ name: i.name, value: i.id })); return o; });
            sub.addIntegerOption(o => o.setName('quantity').setDescription('How many (default 1)').setRequired(false).setMinValue(1));
            return sub; })
        .addSubcommand(sub => sub.setName('inventory').setDescription("View your or someone else's inventory")
            .addUserOption(o => o.setName('user').setDescription('Whose inventory to view').setRequired(false)))
        .addSubcommand(sub => sub.setName('use').setDescription('Use/activate a consumable item')
            .addStringOption(o => { o.setName('item').setDescription('Item to use').setRequired(true); SHOP_ITEMS.filter(i => i.type === 'consumable').forEach(i => o.addChoices({ name: i.name, value: i.id })); return o; }))
        .addSubcommand(sub => { sub.setName('gift').setDescription('Gift an item to another player');
            sub.addUserOption(o => o.setName('user').setDescription('Who to gift').setRequired(true));
            sub.addStringOption(o => { o.setName('item').setDescription('Item to gift').setRequired(true); SHOP_ITEMS.forEach(i => o.addChoices({ name: i.name, value: i.id })); return o; });
            sub.addIntegerOption(o => o.setName('quantity').setDescription('How many (default 1)').setRequired(false).setMinValue(1));
            return sub; })
    )
    .addSubcommandGroup(group => group
        .setName('upgrade')
        .setDescription('Permanent Beli-funded upgrades')
        .addSubcommand(sub => sub.setName('view').setDescription('View all upgrade tracks and your current tiers'))
        .addSubcommand(sub => sub.setName('buy').setDescription('Buy the next tier of an upgrade track')
            .addStringOption(o => { o.setName('track').setDescription('Which upgrade track').setRequired(true); UPGRADE_TRACK_KEYS.forEach(k => o.addChoices({ name: UPGRADE_TRACKS[k].label, value: k })); return o; }))
    )
    .addSubcommandGroup(group => group
        .setName('automod')
        .setDescription('Custom word/regex AutoMod config (Manage Server)')
        .addSubcommand(sub => sub.setName('word-add').setDescription('Block a word or phrase')
            .addStringOption(o => o.setName('word').setDescription('Word or phrase to block').setRequired(true)))
        .addSubcommand(sub => sub.setName('word-remove').setDescription('Unblock a word or phrase')
            .addStringOption(o => o.setName('word').setDescription('Word or phrase to remove').setRequired(true)))
        .addSubcommand(sub => sub.setName('word-list').setDescription('List all blocked words'))
        .addSubcommand(sub => sub.setName('word-clear').setDescription('Clear all blocked words'))
        .addSubcommand(sub => sub.setName('regex-add').setDescription('Add a regex filter rule')
            .addStringOption(o => o.setName('pattern').setDescription('Regex pattern (no slashes)').setRequired(true))
            .addStringOption(o => o.setName('flags').setDescription('Regex flags e.g. "i" (default: i)').setRequired(false)))
        .addSubcommand(sub => sub.setName('regex-remove').setDescription('Remove a regex filter rule')
            .addStringOption(o => o.setName('pattern').setDescription('Exact pattern to remove').setRequired(true)))
        .addSubcommand(sub => sub.setName('regex-list').setDescription('List all regex rules'))
        .addSubcommand(sub => sub.setName('regex-clear').setDescription('Clear all regex rules'))
        .addSubcommand(sub => sub.setName('exempt-role').setDescription('Exempt a role from Custom AutoMod')
            .addRoleOption(o => o.setName('role').setDescription('Role to exempt').setRequired(true)))
        .addSubcommand(sub => sub.setName('exempt-channel').setDescription('Exempt a channel from Custom AutoMod')
            .addChannelOption(o => o.setName('channel').setDescription('Channel to exempt').setRequired(true).addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub => sub.setName('unexempt-role').setDescription('Remove a role exemption')
            .addRoleOption(o => o.setName('role').setDescription('Role to un-exempt').setRequired(true)))
        .addSubcommand(sub => sub.setName('unexempt-channel').setDescription('Remove a channel exemption')
            .addChannelOption(o => o.setName('channel').setDescription('Channel to un-exempt').setRequired(true).addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub => sub.setName('exempt-list').setDescription('List all current exemptions'))
        .addSubcommand(sub => sub.setName('action').setDescription('Set the action taken on a match')
            .addStringOption(o => o.setName('type').setDescription('Action type').setRequired(true)
                .addChoices({ name: 'Delete only', value: 'delete' }, { name: 'Warn (DM)', value: 'warn' }, { name: 'Timeout', value: 'timeout' }, { name: 'Kick', value: 'kick' }, { name: 'Ban', value: 'ban' })))
        .addSubcommand(sub => sub.setName('timeout-duration').setDescription('Set the timeout duration in minutes')
            .addIntegerOption(o => o.setName('minutes').setDescription('1-40320 (28 days max)').setRequired(true).setMinValue(1).setMaxValue(40320)))
        .addSubcommand(sub => sub.setName('logchannel').setDescription('Set the channel for AutoMod hit logs')
            .addChannelOption(o => o.setName('channel').setDescription('Log channel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub => sub.setName('enable').setDescription('Enable Custom AutoMod'))
        .addSubcommand(sub => sub.setName('disable').setDescription('Disable Custom AutoMod'))
        .addSubcommand(sub => sub.setName('status').setDescription('View the current Custom AutoMod configuration'))
        .addSubcommand(sub => sub.setName('reset').setDescription('Wipe Custom AutoMod config back to defaults'))
        .addSubcommand(sub => sub.setName('test').setDescription('Test a string against current rules (dry run)')
            .addStringOption(o => o.setName('text').setDescription('Text to test').setRequired(true)))
    )
    .addSubcommandGroup(group => group
        .setName('ai')
        .setDescription('Bring-your-own-key AI chat, any model')
        .addSubcommand(sub => { sub.setName('setkey').setDescription('Set your own API key for a provider (private form)');
            sub.addStringOption(o => { o.setName('provider').setDescription('Which provider').setRequired(true); AI_PROVIDERS.forEach(p => o.addChoices({ name: p, value: p })); return o; });
            return sub; })
        .addSubcommand(sub => { sub.setName('removekey').setDescription('Delete a stored API key');
            sub.addStringOption(o => { o.setName('provider').setDescription('Which provider').setRequired(true); AI_PROVIDERS.forEach(p => o.addChoices({ name: p, value: p })); return o; });
            return sub; })
        .addSubcommand(sub => sub.setName('mykeys').setDescription('See which providers you have a key set for'))
        .addSubcommand(sub => { sub.setName('chat').setDescription('Start an AI chat thread using your own key');
            sub.addStringOption(o => { o.setName('model').setDescription('Which model').setRequired(true); Object.entries(AI_MODEL_CATALOG).forEach(([k, v]) => o.addChoices({ name: v.label, value: k })); return o; });
            return sub; })
        .addSubcommand(sub => sub.setName('end').setDescription('End your active AI chat thread'))
    )
    .addSubcommandGroup(group => group
        .setName('help')
        .setDescription('Searchable help for every /beli command')
        .addSubcommand(sub => sub.setName('lookup').setDescription('Find and get detailed help for any /beli command')
            .addStringOption(o => o.setName('query').setDescription('Start typing to search — pick a result from the dropdown').setRequired(true).setAutocomplete(true)))
    );

// ══════════════════════════════════════════════════════════
//  SLASH DISPATCHER
// ══════════════════════════════════════════════════════════
async function handleBeliInteraction(interaction, data, gs, guild, saveData, client) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'beli') return false;
    const guildId = interaction.guildId;
    try {
        const group = interaction.options.getSubcommandGroup();
        const sub = interaction.options.getSubcommand();

        if (group === 'automod') {
            if (!hasAutomodPerm(interaction.member)) {
                await interaction.reply({ embeds: [errEmbed('You need Manage Server permission to configure Custom AutoMod.')], flags: 64 });
                return true;
            }
            switch (sub) {
                case 'word-add': await slashAutomodWordAdd(interaction, gs); break;
                case 'word-remove': await slashAutomodWordRemove(interaction, gs); break;
                case 'word-list': await slashAutomodWordList(interaction, gs); break;
                case 'word-clear': await slashAutomodWordClear(interaction, gs); break;
                case 'regex-add': await slashAutomodRegexAdd(interaction, gs); break;
                case 'regex-remove': await slashAutomodRegexRemove(interaction, gs); break;
                case 'regex-list': await slashAutomodRegexList(interaction, gs); break;
                case 'regex-clear': await slashAutomodRegexClear(interaction, gs); break;
                case 'exempt-role': await slashAutomodExemptRole(interaction, gs); break;
                case 'exempt-channel': await slashAutomodExemptChannel(interaction, gs); break;
                case 'unexempt-role': await slashAutomodUnexemptRole(interaction, gs); break;
                case 'unexempt-channel': await slashAutomodUnexemptChannel(interaction, gs); break;
                case 'exempt-list': await slashAutomodExemptList(interaction, gs); break;
                case 'action': await slashAutomodAction(interaction, gs); break;
                case 'timeout-duration': await slashAutomodTimeoutDuration(interaction, gs); break;
                case 'logchannel': await slashAutomodLogChannel(interaction, gs); break;
                case 'enable': await slashAutomodEnable(interaction, gs); break;
                case 'disable': await slashAutomodDisable(interaction, gs); break;
                case 'status': await slashAutomodStatus(interaction, gs); break;
                case 'reset': await slashAutomodReset(interaction, gs); break;
                case 'test': await slashAutomodTest(interaction, gs); break;
            }
            saveData(data);
            return true;
        }
        if (group === 'ai') {
            switch (sub) {
                case 'setkey': await slashAiSetKey(interaction, data, saveData); break;
                case 'removekey': await slashAiRemoveKey(interaction, data, saveData); break;
                case 'mykeys': await slashAiMyKeys(interaction, data); break;
                case 'chat': await slashAiChat(interaction, data, guildId, saveData); break;
                case 'end': await slashAiEnd(interaction, data, saveData); break;
            }
            return true; // each ai handler manages its own saveData timing
        }
        if (group === 'help') {
            if (sub === 'lookup') await slashHelpLookup(interaction);
            return true;
        }
        if (group === 'economy') {
            switch (sub) {
                case 'balance': await slashEconomyBalance(interaction, data, guildId); break;
                case 'leaderboard': await slashEconomyLeaderboard(interaction, data, guildId, guild); break;
                case 'deposit': await slashEconomyDeposit(interaction, data, guildId); break;
                case 'withdraw': await slashEconomyWithdraw(interaction, data, guildId); break;
                case 'pay': await slashEconomyPay(interaction, data, guildId); break;
                case 'profile': await slashEconomyProfile(interaction, data, guildId); break;
            }
            saveData(data);
            return true;
        }
        if (group === 'earn') {
            switch (sub) {
                case 'daily': await slashEarnDaily(interaction, data, guildId, gs); break;
                case 'weekly': await slashEarnWeekly(interaction, data, guildId, gs); break;
                case 'work': await slashEarnWork(interaction, data, guildId, gs); break;
                case 'crime': await slashEarnCrime(interaction, data, guildId, gs); break;
                case 'fish': await slashEarnGather(interaction, data, guildId, gs, 'fish', FISH_LOOT, '🎣 Fishing Trip', 'reeled in'); break;
                case 'hunt': await slashEarnGather(interaction, data, guildId, gs, 'hunt', HUNT_LOOT, '🏹 Bounty Hunt', 'brought in'); break;
                case 'trivia': await slashEarnTrivia(interaction, data, guildId, gs); break;
                case 'trivia-answer': await slashEarnTriviaAnswer(interaction, data, guildId, gs); break;
                case 'rob': await slashEarnRob(interaction, data, guildId, gs); break;
            }
            const _erec = ensureEconomy(data, guildId, interaction.user.id);
            markQuestProgress(_erec, 'earn');
            if (sub === 'daily') markQuestProgress(_erec, 'daily');
            saveData(data);
            return true;
        }
        if (group === 'gamble') {
            switch (sub) {
                case 'slots': await slashGambleSlots(interaction, data, guildId, gs); break;
                case 'coinflip': await slashGambleCoinflip(interaction, data, guildId, gs); break;
                case 'blackjack': await slashGambleBlackjack(interaction, data, guildId, gs, saveData); break;
                case 'blackjack-hit': await slashGambleBlackjackHit(interaction, data, guildId); break;
                case 'blackjack-stand': await slashGambleBlackjackStand(interaction, data, guildId); break;
                case 'dice': await slashGambleDice(interaction, data, guildId, gs); break;
                case 'roulette': await slashGambleRoulette(interaction, data, guildId, gs); break;
                case 'higherlower': await slashGambleHigherLower(interaction, data, guildId, gs); break;
                case 'mines': await slashGambleMines(interaction, data, guildId, gs, saveData); break;
                case 'crash': await slashGambleCrash(interaction, data, guildId, gs, saveData); break;
                case 'wheel': await slashGambleWheel(interaction, data, guildId, gs); break;
                case 'scratch': await slashGambleScratch(interaction, data, guildId, gs); break;
                case 'lottery-buy': await slashGambleLotteryBuy(interaction, data, guildId); break;
                case 'lottery-info': await slashGambleLotteryInfo(interaction, data, guildId); break;
                case 'keno': await slashGambleKeno(interaction, data, guildId, gs); break;
                case 'limbo': await slashGambleLimbo(interaction, data, guildId, gs); break;
                case 'war': await slashGambleWar(interaction, data, guildId, gs); break;
            }
            markQuestProgress(ensureEconomy(data, guildId, interaction.user.id), 'gamble');
            saveData(data);
            return true;
        }
        if (group === 'duel') {
            switch (sub) {
                case 'challenge': await slashDuelChallenge(interaction, data, guildId); break;
                case 'accept': await slashDuelResolve(interaction, data, guildId, true); break;
                case 'decline': await slashDuelResolve(interaction, data, guildId, false); break;
                case 'stats': await slashDuelStats(interaction, data, guildId); break;
            }
            saveData(data);
            return true;
        }
        if (group === 'quests') {
            switch (sub) {
                case 'view': await slashQuestsView(interaction, data, guildId); break;
                case 'claim': await slashQuestsClaim(interaction, data, guildId); break;
            }
            saveData(data);
            return true;
        }
        if (group === 'security') {
            if (!hasAutomodPerm(interaction.member)) {
                await interaction.reply({ embeds: [errEmbed('You need Manage Server permission to configure security settings.')], flags: 64 });
                return true;
            }
            switch (sub) {
                case 'honeypot-enable': await slashSecurityHoneypotEnable(interaction, gs); break;
                case 'honeypot-disable': await slashSecurityHoneypotDisable(interaction, gs); break;
                case 'honeypot-status': await slashSecurityHoneypotStatus(interaction, gs); break;
                case 'honeypot-action': await slashSecurityHoneypotAction(interaction, gs); break;
                case 'honeypot-reinvite': await slashSecurityHoneypotReinvite(interaction, gs); break;
                case 'honeypot-messages': await slashSecurityHoneypotMessages(interaction, gs); break;
                case 'honeypot-post-warning': await slashSecurityHoneypotPostWarning(interaction, gs); break;
                case 'honeypot-logchannel': await slashSecurityHoneypotLogChannel(interaction, gs); break;
                case 'honeypot-channel-add': await slashSecurityHoneypotChannelAdd(interaction, gs); break;
                case 'honeypot-channel-remove': await slashSecurityHoneypotChannelRemove(interaction, gs); break;
                case 'honeypot-role-set': await slashSecurityHoneypotRoleSet(interaction, gs); break;
                case 'honeypot-role-clear': await slashSecurityHoneypotRoleClear(interaction, gs); break;
                case 'honeypot-command-add': await slashSecurityHoneypotCommandAdd(interaction, gs); break;
                case 'honeypot-command-remove': await slashSecurityHoneypotCommandRemove(interaction, gs); break;
            }
            saveData(data);
            return true;
        }
        if (group === 'shop') {
            switch (sub) {
                case 'view': await slashShopView(interaction, data, guildId, gs); break;
                case 'buy': await slashShopBuy(interaction, data, guildId); break;
                case 'sell': await slashShopSell(interaction, data, guildId); break;
                case 'inventory': await slashShopInventory(interaction, data, guildId); break;
                case 'use': await slashShopUse(interaction, data, guildId); break;
                case 'gift': await slashShopGift(interaction, data, guildId); break;
            }
            saveData(data);
            return true;
        }
        if (group === 'upgrade') {
            switch (sub) {
                case 'view': await slashUpgradeView(interaction, data, guildId, gs); break;
                case 'buy': await slashUpgradeBuy(interaction, data, guildId, gs); break;
            }
            saveData(data);
            return true;
        }
        await interaction.reply({ embeds: [errEmbed('Unknown /beli subcommand.')], flags: 64 });
        return true;
    } catch (e) {
        console.error('[beli] interaction handler error:', e);
        try {
            const payload = { embeds: [errEmbed('Something went wrong running that — try again in a moment.')], flags: 64 };
            if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
            else await interaction.reply(payload);
        } catch {}
        return true;
    }
}

// ══════════════════════════════════════════════════════════
//  PREFIX DISPATCHER
// ══════════════════════════════════════════════════════════
const BELI_PREFIX_COMMANDS = new Set([
    'balance', 'bal', 'leaderboard', 'lb', 'deposit', 'withdraw', 'pay', 'profile',
    'daily', 'weekly', 'work', 'crime', 'fish', 'hunt', 'trivia', 'rob',
    'slots', 'coinflip', 'blackjack', 'bjhit', 'bjstand', 'dice', 'roulette', 'higherlower', 'mines',
    'crash', 'wheel', 'scratch', 'lottery', 'keno', 'limbo', 'war',
    'duel', 'quests', 'honeypot',
    'aimykeys', 'airemovekey', 'aichat', 'aiend', 'help',
    'shop', 'buy', 'sell', 'inventory', 'inv', 'use', 'gift',
    'upgrade', 'upgrades',
    'automod',
]);

const BELI_PREFIX_SPECS = {
    pay:         { need: 2, names: ['user', 'amount'], usage: '!pay <@user> <amount>' },
    deposit:     { need: 1, names: ['amount'], usage: '!deposit <amount|half|all>' },
    withdraw:    { need: 1, names: ['amount'], usage: '!withdraw <amount|half|all>' },
    rob:         { need: 1, names: ['user'], usage: '!rob <@user>' },
    slots:       { need: 1, names: ['bet'], usage: '!slots <bet|half|all>' },
    coinflip:    { need: 2, names: ['bet', 'side'], usage: '!coinflip <bet> <heads|tails>' },
    blackjack:   { need: 1, names: ['bet'], usage: '!blackjack <bet>' },
    dice:        { need: 2, names: ['bet', 'guess'], usage: '!dice <bet> <1-6>' },
    roulette:    { need: 2, names: ['bet', 'choice'], usage: '!roulette <bet> <red|black|green|0-36>' },
    higherlower: { need: 2, names: ['bet', 'guess'], usage: '!higherlower <bet> <higher|lower>' },
    mines:       { need: 2, names: ['bet', 'mines'], usage: '!mines <bet> <mines 1-19>' },
    crash:       { need: 1, names: ['bet'], usage: '!crash <bet|half|all>' },
    honeypot:    { need: 1, names: ['action'], usage: '!honeypot <enable|disable|status|action|reinvite|logchannel|channel-add|channel-remove|role-set|role-clear|command-add|command-remove> [...args]' },
    airemovekey: { need: 1, names: ['provider'], usage: '!airemovekey <provider>' },
    aichat:      { need: 1, names: ['model'], usage: '!aichat <model-key> (see /beli ai chat for the list)' },
    help:        { need: 1, names: ['query'], usage: '!help <search term>' },
    wheel:       { need: 1, names: ['bet'], usage: '!wheel <bet|half|all>' },
    keno:        { need: 2, names: ['bet', 'numbers'], usage: '!keno <bet> <numbers comma-separated>' },
    limbo:       { need: 2, names: ['bet', 'target'], usage: '!limbo <bet> <target multiplier>' },
    war:         { need: 1, names: ['bet'], usage: '!war <bet|half|all>' },
    scratch:     { need: 1, names: ['bet'], usage: '!scratch <bet|half|all>' },
    duel:        { need: 1, names: ['user or action'], usage: '!duel <@user> <bet>  |  !duel accept  |  !duel decline  |  !duel stats [@user]' },
    buy:         { need: 1, names: ['item'], usage: '!buy <item> [qty]' },
    sell:        { need: 1, names: ['item'], usage: '!sell <item> [qty]' },
    use:         { need: 1, names: ['item'], usage: '!use <item>' },
    gift:        { need: 2, names: ['user', 'item'], usage: '!gift <@user> <item> [qty]' },
    upgrade:     { need: 0, names: [], usage: '!upgrade [track]' },
    lottery:     { need: 0, names: [], usage: '!lottery [ticket count]' },
    quests:      { need: 0, names: [], usage: '!quests [claim]' },
    automod:     { need: 1, names: ['action'], usage: '!automod <word-add|word-remove|word-list|word-clear|regex-add|regex-remove|regex-list|regex-clear|exempt-role|exempt-channel|unexempt-role|unexempt-channel|exempt-list|action|timeout|logchannel|enable|disable|status|reset|test> [...args]' },
};

async function handleBeliPrefixCommand(message, cmd, args, data, gs, isAdmin, isMod, saveData, client) {
    const guildId = message.guild.id;
    try {
        if (cmd === 'automod') {
            if (!hasAutomodPerm(message.member) && !isAdmin && !isMod) {
                await message.channel.send({ embeds: [errEmbed('You need Manage Server permission to configure Custom AutoMod.')] });
                return;
            }
            await handleAutomodPrefixAction(message, gs, (args[0] || '').toLowerCase(), args.slice(1));
            saveData(data);
            return;
        }
        if (cmd === 'honeypot') {
            if (!hasAutomodPerm(message.member) && !isAdmin && !isMod) {
                await message.channel.send({ embeds: [errEmbed('You need Manage Server permission to configure security settings.')] });
                return;
            }
            await handleHoneypotPrefixAction(message, gs, (args[0] || '').toLowerCase(), args.slice(1));
            saveData(data);
            return;
        }
        const EARN_CMDS = new Set(['daily', 'weekly', 'work', 'crime', 'fish', 'hunt', 'trivia', 'rob']);
        const GAMBLE_CMDS = new Set(['slots', 'coinflip', 'blackjack', 'bjhit', 'bjstand', 'dice', 'roulette', 'higherlower', 'mines', 'crash', 'wheel', 'scratch', 'keno', 'limbo', 'war']);
        switch (cmd) {
            case 'balance': case 'bal': await prefixEconomyBalance(message, data, guildId, args); break;
            case 'leaderboard': case 'lb': await prefixEconomyLeaderboard(message, data, guildId); break;
            case 'deposit': await prefixEconomyDeposit(message, data, guildId, args); break;
            case 'withdraw': await prefixEconomyWithdraw(message, data, guildId, args); break;
            case 'pay': await prefixEconomyPay(message, data, guildId, args); break;
            case 'profile': await prefixEconomyProfile(message, data, guildId, args); break;

            case 'daily': await prefixEarnDaily(message, data, guildId, gs); break;
            case 'weekly': await prefixEarnWeekly(message, data, guildId, gs); break;
            case 'work': await prefixEarnWork(message, data, guildId, gs); break;
            case 'crime': await prefixEarnCrime(message, data, guildId, gs); break;
            case 'fish': await prefixEarnGather(message, data, guildId, gs, 'fish', FISH_LOOT, '🎣 Fishing Trip', 'reeled in'); break;
            case 'hunt': await prefixEarnGather(message, data, guildId, gs, 'hunt', HUNT_LOOT, '🏹 Bounty Hunt', 'brought in'); break;
            case 'trivia': await prefixEarnTrivia(message, data, guildId, gs, args); break;
            case 'rob': await prefixEarnRob(message, data, guildId, gs, args); break;

            case 'slots': await prefixGambleSlots(message, data, guildId, gs, args); break;
            case 'coinflip': await prefixGambleCoinflip(message, data, guildId, gs, args); break;
            case 'blackjack': await prefixGambleBlackjack(message, data, guildId, gs, args, saveData); break;
            case 'bjhit': await prefixGambleBjHit(message, data, guildId); break;
            case 'bjstand': await prefixGambleBjStand(message, data, guildId, gs); break;
            case 'dice': await prefixGambleDice(message, data, guildId, gs, args); break;
            case 'roulette': await prefixGambleRoulette(message, data, guildId, gs, args); break;
            case 'higherlower': await prefixGambleHigherLower(message, data, guildId, gs, args); break;
            case 'mines': await prefixGambleMines(message, data, guildId, gs, args, saveData); break;
            case 'crash': await prefixGambleCrash(message, data, guildId, gs, args, saveData); break;
            case 'wheel': await prefixGambleWheel(message, data, guildId, gs, args); break;
            case 'scratch': await prefixGambleScratch(message, data, guildId, gs, args); break;
            case 'lottery': await prefixLottery(message, data, guildId, gs, args); break;
            case 'keno': await prefixGambleKeno(message, data, guildId, gs, args); break;
            case 'limbo': await prefixGambleLimbo(message, data, guildId, gs, args); break;
            case 'war': await prefixGambleWar(message, data, guildId, gs, args); break;

            case 'duel': await prefixDuel(message, data, guildId, gs, args); break;
            case 'quests': await prefixQuests(message, data, guildId, args); break;

            case 'shop': await prefixShopView(message, gs); break;
            case 'buy': await prefixShopBuy(message, data, guildId, gs, args); break;
            case 'sell': await prefixShopSell(message, data, guildId, gs, args); break;
            case 'inventory': case 'inv': await prefixShopInventory(message, data, guildId, args); break;
            case 'use': await prefixShopUse(message, data, guildId, args); break;
            case 'gift': await prefixShopGift(message, data, guildId, args); break;

            case 'upgrade': case 'upgrades': await prefixUpgrade(message, data, guildId, gs, args); break;

            case 'aimykeys': await prefixAiMyKeys(message, data); break;
            case 'airemovekey': await prefixAiRemoveKey(message, data, saveData, args); break;
            case 'aichat': await prefixAiChat(message, data, guildId, saveData, args); break;
            case 'aiend': await prefixAiEnd(message, data, saveData); break;
            case 'help': await prefixHelpLookup(message, args); break;
        }
        if (EARN_CMDS.has(cmd) || GAMBLE_CMDS.has(cmd)) {
            const _prec = ensureEconomy(data, guildId, message.author.id);
            if (EARN_CMDS.has(cmd)) { markQuestProgress(_prec, 'earn'); if (cmd === 'daily') markQuestProgress(_prec, 'daily'); }
            if (GAMBLE_CMDS.has(cmd)) markQuestProgress(_prec, 'gamble');
        }
        saveData(data);
    } catch (e) {
        console.error('[beli] prefix handler error:', e);
        try { await message.channel.send({ embeds: [errEmbed('Something went wrong running that — try again in a moment.')] }); } catch {}
    }

}

// ══════════════════════════════════════════════════════════
//  HONEYPOT DEFAULTS/CONSTANTS — moved up here (ahead of their original
//  "SECURITY GROUP" section further down) because module.exports below
//  references them directly. `const` bindings aren't hoisted like function
//  declarations are — referencing one from an object literal built earlier
//  in the file than its own declaration throws "Cannot access before
//  initialization" the moment this module is require()'d. Function
//  declarations (getHoneypotConfig, coreHoneypot*, etc.) don't have this
//  problem and were left in their original place further down.
// ══════════════════════════════════════════════════════════
const HONEYPOT_DEFAULTS = {
    honeypotEnabled: false,
    honeypotChannelIds: [],
    honeypotRoleId: null,
    honeypotTrapCommands: [],
    honeypotAction: 'ban', // ban | softban | kick | timeout
    honeypotLogChannelId: null,
    honeypotReinvite: false, // after softban/kick, DM a fresh one-time invite back in
    // Templates — {{variable}} placeholders, rendered by renderHoneypotTemplate().
    // Empty string/null means "use the built-in default" (matches the reference
    // UI's "leave empty to reset to default" behavior) rather than baking the
    // default text into every guild's saved settings.
    honeypotWarningMessage: null, // posted in the honeypot channel itself
    honeypotDmMessage: null,      // DMed to the user who triggered it
    honeypotLogMessage: null,     // posted in the log channel
};
const MAX_HONEYPOT_CHANNELS = 25, MAX_HONEYPOT_COMMANDS = 25;
const HONEYPOT_TEMPLATE_DEFAULTS = {
    warning: '## DO NOT SEND MESSAGES IN THIS CHANNEL\n\nThis channel is used to catch spam bots and compromised accounts. Any message sent here will result in **{{action:text}}**.',
    dm: '## Honeypot Triggered\n\nHey {{user:mention}}, you have been **{{action:text}}** from **{{server:name}}** for {{trigger:text}}.\n\nThis may have happened if someone gained access to your account through malware, stolen sessions, or a leaked password. If you believe this was a mistake, you can appeal below.',
    log: '{{user:mention}} was {{action:text}} for triggering the honeypot ({{trigger:text}}).\n-# User ID: `{{user:id}}`',
};

// ══════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════
module.exports = {
    getGuildBeliConfig, getGuildShopPrice, getGuildUpgradeBaseCost, getGuildShopItems,

    beliSlashCommandBuilders: [beliCommand],
    handleBeliInteraction,
    handleBeliPrefixCommand,
    handleBeliAutocomplete,
    checkCustomAutomod,
    checkHoneypotChannel,
    checkHoneypotRoleGrant,
    checkHoneypotCommand,
    checkAiThreadMessage,
    BELI_PREFIX_COMMANDS,
    BELI_PREFIX_SPECS,
    getActiveBoostMultiplier,
    AUTOMOD_DEFAULTS,
    // Pure gs-in/result-out functions behind /beli automod's subcommands —
    // exported so the dashboard's automod manager calls the exact same logic
    // the slash command does, rather than a second implementation of it.
    getAutomodConfig,
    coreAutomodWordAdd, coreAutomodWordRemove, coreAutomodWordClear,
    coreAutomodRegexAdd, coreAutomodRegexRemove, coreAutomodRegexClear,
    coreAutomodExemptRole, coreAutomodUnexemptRole,
    coreAutomodExemptChannel, coreAutomodUnexemptChannel,
    coreAutomodSetAction, coreAutomodSetTimeout, coreAutomodSetLogChannel,
    coreAutomodEnable, coreAutomodDisable, coreAutomodReset, coreAutomodTest,
    MAX_AUTOMOD_WORDS, MAX_AUTOMOD_REGEX, MAX_PATTERN_LENGTH,
    // Read-only economy accessors for the dashboard's Beli overview — no
    // write path exported here on purpose. Balances/inventory changing hands
    // stays exclusively through the real commands (rob/pay/gamble/etc all
    // have game logic — cooldowns, odds, streaks — that a raw dashboard
    // "set balance" control would bypass entirely, which is exactly the
    // "no fake features" / "don't expose internals that would break the
    // architecture" line. This page is read-only until each writable value
    // gets a proper `core*()` function backing it, same as automod's did.
    ensureEconomy, netWorth, buildEconomyLeaderboard, coreBalance,
    getEconomyEarnConfig, mergeLootTable, FISH_LOOT, HUNT_LOOT,
    mergeWeightTable, WHEEL_SEGMENTS, SLOT_SYMBOLS, getEconomyBaseConfig, STARTING_WALLET, STARTING_BANK, BASE_BANK_CAPACITY,
    CURRENCY_NAME, CURRENCY_EMOJI,
    UPGRADE_TRACK_KEYS, UPGRADE_TRACKS, SHOP_ITEMS, upgradeCost,
    // Same reasoning as automod's exports above — the dashboard's honeypot
    // manager calls these exact functions, not a second implementation.
    getHoneypotConfig, HONEYPOT_DEFAULTS, HONEYPOT_TEMPLATE_DEFAULTS,
    coreHoneypotChannelAdd, coreHoneypotChannelRemove,
    coreHoneypotCommandAdd, coreHoneypotCommandRemove,
    coreHoneypotSetEnabled, coreHoneypotSetAction, coreHoneypotSetReinvite,
    coreHoneypotSetRole, coreHoneypotSetLogChannel, coreHoneypotSetMessage, coreHoneypotReset,
    MAX_HONEYPOT_CHANNELS, MAX_HONEYPOT_COMMANDS,
    // Guild-level BYOK + provider dispatch — used by the /translate feature
    // (and available for future guild-scoped AI features) so translation
    // never has to duplicate provider-calling or encryption logic.
    getGuildApiKey, setGuildApiKey, removeGuildApiKey, listGuildApiKeys,
    AI_PROVIDERS, PROVIDER_KEY_HINT, AI_MODEL_CATALOG, callAIProvider,
};

// ══════════════════════════════════════════════════════════
//  SECURITY GROUP — Honeypots (channels, a trap role, trap commands).
//  Deliberately dashboard/command-configurable but with ZERO new
//  top-level slash slots — lives as a 6th... 8th group inside /beli.
//  (HONEYPOT_DEFAULTS, MAX_HONEYPOT_CHANNELS/COMMANDS, and
//  HONEYPOT_TEMPLATE_DEFAULTS moved up above module.exports — see there.)
// ══════════════════════════════════════════════════════════
function getHoneypotConfig(gs) {
    for (const [k, v] of Object.entries(HONEYPOT_DEFAULTS)) if (gs[k] === undefined) gs[k] = Array.isArray(v) ? [...v] : v;
    return gs;
}

const HONEYPOT_ACTION_TEXT = { ban: 'banned', softban: 'kicked', kick: 'kicked', timeout: 'timed out' };
// Renders a honeypot message template, substituting {{namespace:key}} placeholders.
// Unknown placeholders are left as-is rather than silently dropped, so a typo in
// a custom template is visible instead of just vanishing.
function renderHoneypotTemplate(template, vars) {
    return String(template).replace(/\{\{([a-z]+):([a-z]+)\}\}/gi, (full, ns, key) => {
        const v = vars[`${ns}:${key}`];
        return v !== undefined ? v : full;
    });
}
function buildHoneypotVars({ member, guild, action, triggerText, honeypotChannel }) {
    return {
        'user:mention': member ? member.toString() : 'Someone',
        'user:id': member ? member.id : 'unknown',
        'user:tag': member ? member.user.tag : 'unknown',
        'action:text': HONEYPOT_ACTION_TEXT[action] || 'actioned',
        'server:name': guild ? guild.name : 'this server',
        'trigger:text': triggerText || 'triggering the honeypot',
        'honeypot:channel:mention': honeypotChannel ? `<#${honeypotChannel.id}>` : 'the honeypot channel',
        'honeypot:channel:link': honeypotChannel ? `https://discord.com/channels/${guild.id}/${honeypotChannel.id}` : '',
    };
}
async function applyHoneypotAction(member, cfg, reason, data, saveData) {
    // Record the hit BEFORE acting, and DM the member while they're still a
    // current member (DMing after a ban/kick can silently fail — Discord's DM
    // permission model leans heavily on shared-server context). Honeypots are
    // rare, serious security events, but "rare" isn't "never a false positive"
    // (a compromised or careless legit member can still trip one), so every
    // trigger gets the same appeal path as a warn/timeout/ban — the DM just
    // has to arrive first.
    const hpId = `hp_${Date.now()}_${member.id}`;
    data.honeypotHits = data.honeypotHits || {};
    data.honeypotHits[member.guild.id] = data.honeypotHits[member.guild.id] || {};
    data.honeypotHits[member.guild.id][member.id] = { hpId, action: cfg.honeypotAction, reason, triggeredAt: Date.now() };
    try { saveData(data); } catch (e) { console.error('[honeypot] failed to persist hit record:', e.message); }

    const firstHpChannel = cfg.honeypotChannelIds?.[0]
        ? await member.guild.channels.fetch(cfg.honeypotChannelIds[0]).catch(() => null)
        : null;
    const vars = buildHoneypotVars({ member, guild: member.guild, action: cfg.honeypotAction, triggerText: reason, honeypotChannel: firstHpChannel });

    try {
        const dmTemplate = cfg.honeypotDmMessage || HONEYPOT_TEMPLATE_DEFAULTS.dm;
        const guildIcon = member.guild.iconURL({ dynamic: true });
        const dmEmbed = new EmbedBuilder()
            .setTitle('🍯 You Tripped a Security Trap')
            .setColor(0xB35B00)
            .setThumbnail(guildIcon || null)
            .setAuthor({ name: member.guild.name, iconURL: guildIcon || undefined })
            .setDescription(renderHoneypotTemplate(dmTemplate, vars).slice(0, 4000))
            .setFooter({ text: 'You may submit exactly 1 appeal per trigger.' })
            .setTimestamp();
        const appealRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`open_honeypot_appeal_${member.guild.id}_${hpId}`).setLabel('📩 Appeal this').setStyle(ButtonStyle.Primary));
        await member.send({ embeds: [dmEmbed], components: [appealRow] }).catch(() => {});
    } catch {}

    let reinviteUrl = null;
    try {
        // Each configured action only ever attempts ITS OWN action. Previously
        // "kick"/"timeout" silently fell through to a full ban whenever the
        // specific permission/hierarchy check failed (e.g. bot has Ban Members
        // but not Kick Members) — a much harsher, unintended escalation for a
        // security feature where the whole point is doing exactly what's
        // configured, not something stronger.
        if (cfg.honeypotAction === 'softban') {
            // Ban (which lets Discord delete their recent messages) then immediately
            // unban — net effect is "kicked, and the last hour of their messages in
            // this server got cleaned up with them" rather than a permanent ban.
            if (member.bannable) {
                await member.ban({ reason, deleteMessageSeconds: 3600 });
                await member.guild.bans.remove(member.id, `${reason} (softban — auto-unbanned)`).catch(() => {});
                if (cfg.honeypotReinvite) reinviteUrl = await createBestEffortInviteBeli(member.guild).catch(() => null);
            } else console.error(`[honeypot] configured action is "softban" but ${member.id} isn't bannable (permissions or role hierarchy) — no action taken.`);
        } else if (cfg.honeypotAction === 'kick') {
            if (member.kickable) {
                await member.kick(reason);
                if (cfg.honeypotReinvite) reinviteUrl = await createBestEffortInviteBeli(member.guild).catch(() => null);
            } else console.error(`[honeypot] configured action is "kick" but ${member.id} isn't kickable (permissions or role hierarchy) — no action taken.`);
        } else if (cfg.honeypotAction === 'timeout') {
            if (member.moderatable) await member.timeout(28 * 24 * 60 * 60 * 1000, reason);
            else console.error(`[honeypot] configured action is "timeout" but ${member.id} isn't moderatable (permissions or role hierarchy) — no action taken.`);
        } else {
            if (member.bannable) await member.ban({ reason });
            else console.error(`[honeypot] configured action is "ban" but ${member.id} isn't bannable (permissions or role hierarchy) — no action taken.`);
        }
    } catch (e) { console.error('[honeypot] action failed:', e.message); }

    if (reinviteUrl) {
        member.send({ embeds: [new EmbedBuilder().setTitle('🔁 One-time invite back in').setDescription(`You were **${HONEYPOT_ACTION_TEXT[cfg.honeypotAction]}**, not permanently banned. If you'd like to return: ${reinviteUrl}\n\nThis link works once and expires in 7 days.`).setColor(0xB35B00)] }).catch(() => {});
    }
}
// Best-effort invite generator (beli-side copy — DISCOMOD.js has its own for the
// appeal-accept "kick" case; kept separate rather than threading yet another
// cross-module dependency through for a small helper).
async function createBestEffortInviteBeli(guild) {
    const candidates = [guild.systemChannel, ...guild.channels.cache.filter(c => c.isTextBased?.() && c.viewable).values()].filter(Boolean);
    for (const ch of candidates) {
        try {
            const invite = await ch.createInvite({ maxAge: 7 * 24 * 60 * 60, maxUses: 1, unique: true, reason: 'Honeypot reinvite' });
            return invite.url;
        } catch { continue; }
    }
    return null;
}
async function logHoneypotHit(guild, cfg, client, fields, vars) {
    if (!cfg.honeypotLogChannelId) return;
    try {
        const ch = await client.channels.fetch(cfg.honeypotLogChannelId).catch(() => null);
        const logTemplate = cfg.honeypotLogMessage || HONEYPOT_TEMPLATE_DEFAULTS.log;
        const description = vars ? renderHoneypotTemplate(logTemplate, vars).slice(0, 4000) : null;
        const embed = new EmbedBuilder().setTitle('🍯 Honeypot Triggered').setColor(COLOR_BAD).addFields(fields).setTimestamp();
        if (description) embed.setDescription(description);
        if (ch) await ch.send({ embeds: [embed] });
    } catch {}
}
async function checkHoneypotChannel(message, gs, data, saveData, client) {
    const cfg = getHoneypotConfig(gs);
    if (!cfg.honeypotEnabled || !cfg.honeypotChannelIds.length || !message.member) return false;
    if (!cfg.honeypotChannelIds.includes(message.channel.id)) return false;
    try { await message.delete(); } catch {}
    await applyHoneypotAction(message.member, cfg, 'Honeypot channel triggered', data, saveData);
    const chVars = buildHoneypotVars({ member: message.member, guild: message.guild, action: cfg.honeypotAction, triggerText: `posting in <#${message.channel.id}>`, honeypotChannel: message.channel });
    await logHoneypotHit(message.guild, cfg, client, [
        { name: 'User', value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
        { name: 'Trigger', value: `Posted in honeypot channel <#${message.channel.id}>`, inline: true },
        { name: 'Action', value: cfg.honeypotAction, inline: true },
    ], chVars);
    return true;
}
async function checkHoneypotRoleGrant(newMember, addedRoleIds, gs, client, data, saveData) {
    const cfg = getHoneypotConfig(gs);
    if (!cfg.honeypotEnabled || !cfg.honeypotRoleId) return false;
    if (!addedRoleIds.includes(cfg.honeypotRoleId)) return false;
    await applyHoneypotAction(newMember, cfg, 'Honeypot role granted unexpectedly', data, saveData);
    const rVars = buildHoneypotVars({ member: newMember, guild: newMember.guild, action: cfg.honeypotAction, triggerText: 'being granted the honeypot role' });
    await logHoneypotHit(newMember.guild, cfg, client, [
        { name: 'User', value: `<@${newMember.id}> (${newMember.user.tag})`, inline: true },
        { name: 'Trigger', value: `Gained honeypot role <@&${cfg.honeypotRoleId}>`, inline: true },
        { name: 'Action', value: cfg.honeypotAction, inline: true },
    ], rVars);
    return true;
}
async function checkHoneypotCommand(message, gs, cmd, client, data, saveData) {
    const cfg = getHoneypotConfig(gs);
    if (!cfg.honeypotEnabled || !cfg.honeypotTrapCommands.length || !message.member) return false;
    if (!cfg.honeypotTrapCommands.includes(cmd)) return false;
    await applyHoneypotAction(message.member, cfg, `Triggered trap command "${cmd}"`, data, saveData);
    const cVars = buildHoneypotVars({ member: message.member, guild: message.guild, action: cfg.honeypotAction, triggerText: `running the trap command \`${cmd}\`` });
    await logHoneypotHit(message.guild, cfg, client, [
        { name: 'User', value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
        { name: 'Trigger', value: `Ran trap command \`${cmd}\``, inline: true },
        { name: 'Action', value: cfg.honeypotAction, inline: true },
    ], cVars);
    return true;
}

// ── core config mutators ──────────────────────────────────────────────
function coreHoneypotChannelAdd(gs, channelId) { const cfg = getHoneypotConfig(gs); if (cfg.honeypotChannelIds.includes(channelId)) return { error: 'Already a honeypot channel.' }; if (cfg.honeypotChannelIds.length >= MAX_HONEYPOT_CHANNELS) return { error: `Limit of ${MAX_HONEYPOT_CHANNELS} reached.` }; cfg.honeypotChannelIds.push(channelId); return {}; }
function coreHoneypotChannelRemove(gs, channelId) { const cfg = getHoneypotConfig(gs); const i = cfg.honeypotChannelIds.indexOf(channelId); if (i === -1) return { error: 'Not a honeypot channel.' }; cfg.honeypotChannelIds.splice(i, 1); return {}; }
function coreHoneypotCommandAdd(gs, name) { const cfg = getHoneypotConfig(gs); const n = String(name || '').toLowerCase().trim(); if (!n) return { error: 'Give a command name.' }; if (cfg.honeypotTrapCommands.includes(n)) return { error: 'Already a trap command.' }; if (cfg.honeypotTrapCommands.length >= MAX_HONEYPOT_COMMANDS) return { error: `Limit of ${MAX_HONEYPOT_COMMANDS} reached.` }; if (BELI_PREFIX_COMMANDS.has(n)) return { error: 'That name collides with a real command — pick something else.' }; cfg.honeypotTrapCommands.push(n); return { name: n }; }
function coreHoneypotCommandRemove(gs, name) { const cfg = getHoneypotConfig(gs); const n = String(name || '').toLowerCase().trim(); const i = cfg.honeypotTrapCommands.indexOf(n); if (i === -1) return { error: 'Not a trap command.' }; cfg.honeypotTrapCommands.splice(i, 1); return {}; }
// The slash/prefix commands above set these simple fields inline; these
// wrappers exist so the dashboard (added later) can call the exact same
// validation instead of a second copy of it, same reasoning as automod's
// core*() functions. Purely additive — no existing handler above was changed.
function coreHoneypotSetEnabled(gs, enabled) { getHoneypotConfig(gs).honeypotEnabled = !!enabled; return { enabled: !!enabled }; }
function coreHoneypotSetAction(gs, action) {
    const cfg = getHoneypotConfig(gs);
    const valid = ['ban', 'softban', 'kick', 'timeout'];
    if (!valid.includes(action)) return { error: `Action must be one of: ${valid.join(', ')}.` };
    cfg.honeypotAction = action;
    return { action };
}
function coreHoneypotSetReinvite(gs, enabled) { getHoneypotConfig(gs).honeypotReinvite = !!enabled; return { reinvite: !!enabled }; }
function coreHoneypotSetRole(gs, roleId) { getHoneypotConfig(gs).honeypotRoleId = roleId || null; return { roleId: roleId || null }; }
function coreHoneypotSetLogChannel(gs, channelId) { getHoneypotConfig(gs).honeypotLogChannelId = channelId || null; return { channelId: channelId || null }; }
function coreHoneypotSetMessage(gs, type, text) {
    const cfg = getHoneypotConfig(gs);
    const fieldMap = { warning: 'honeypotWarningMessage', dm: 'honeypotDmMessage', log: 'honeypotLogMessage' };
    const field = fieldMap[type];
    if (!field) return { error: 'Message type must be one of: warning, dm, log.' };
    const t = String(text || '').trim();
    if (t.length > 4000) return { error: 'Message must be 4000 characters or fewer.' };
    cfg[field] = t || null; // empty string resets to the built-in default, same "leave empty to reset" behavior as the modal
    return { type, text: t || null };
}
function coreHoneypotReset(gs) { Object.assign(gs, JSON.parse(JSON.stringify(HONEYPOT_DEFAULTS))); return {}; }

function honeypotStatusEmbed(gs) {
    const cfg = getHoneypotConfig(gs);
    const customTemplateCount = ['honeypotWarningMessage', 'honeypotDmMessage', 'honeypotLogMessage'].filter(k => cfg[k]).length;
    return new EmbedBuilder().setTitle('🍯 Honeypot Status').setColor(cfg.honeypotEnabled ? COLOR_OK : COLOR_BAD)
        .addFields(
            { name: 'Enabled', value: cfg.honeypotEnabled ? '✅ Yes' : '❌ No', inline: true },
            { name: 'Action', value: cfg.honeypotAction, inline: true },
            { name: 'Reinvite', value: cfg.honeypotReinvite ? '✅ On (softban/kick only)' : '❌ Off', inline: true },
            { name: 'Log Channel', value: cfg.honeypotLogChannelId ? `<#${cfg.honeypotLogChannelId}>` : 'None', inline: true },
            { name: 'Custom Messages', value: customTemplateCount ? `${customTemplateCount}/3 customized — see \`/beli security honeypot-messages\`` : 'Using defaults', inline: true },
            { name: `Honeypot Channels (${cfg.honeypotChannelIds.length})`, value: cfg.honeypotChannelIds.map(id => `<#${id}>`).join(' ') || 'None', inline: false },
            { name: 'Trap Role', value: cfg.honeypotRoleId ? `<@&${cfg.honeypotRoleId}>` : 'None', inline: false },
            { name: `Trap Commands (${cfg.honeypotTrapCommands.length})`, value: cfg.honeypotTrapCommands.map(c => `\`${c}\``).join(', ') || 'None', inline: false },
        );
}

// ── slash handlers ────────────────────────────────────────────────────
async function slashSecurityHoneypotEnable(interaction, gs) { getHoneypotConfig(gs).honeypotEnabled = true; await interaction.reply({ embeds: [okEmbed('✅ Honeypots Enabled', 'Active honeypot channels/role/commands will now trigger actions.')] }); }
async function slashSecurityHoneypotDisable(interaction, gs) { getHoneypotConfig(gs).honeypotEnabled = false; await interaction.reply({ embeds: [okEmbed('🛑 Honeypots Disabled', 'Configuration is saved but inactive.')] }); }
async function slashSecurityHoneypotStatus(interaction, gs) { await interaction.reply({ embeds: [honeypotStatusEmbed(gs)] }); }
async function slashSecurityHoneypotAction(interaction, gs) { getHoneypotConfig(gs).honeypotAction = interaction.options.getString('type'); await interaction.reply({ embeds: [okEmbed('⚙️ Action Set', `Honeypots will now **${gs.honeypotAction}**.`)] }); }
async function slashSecurityHoneypotReinvite(interaction, gs) {
    const enabled = interaction.options.getBoolean('enabled');
    getHoneypotConfig(gs).honeypotReinvite = enabled;
    await interaction.reply({ embeds: [okEmbed('⚙️ Reinvite Updated', `${enabled ? 'Will now' : 'Will no longer'} DM a one-time invite back in after a softban/kick.\n${enabled ? '_Has no effect when the action is set to Ban or Timeout, since those don\'t remove server access the same way._' : ''}`)] });
}
async function slashSecurityHoneypotPostWarning(interaction, gs) {
    const cfg = getHoneypotConfig(gs);
    if (!cfg.honeypotChannelIds.length) { await interaction.reply({ embeds: [errEmbed('No honeypot channels configured yet — add one with `/beli security honeypot-channel-add` first.')] }); return; }
    await interaction.deferReply({ flags: 64 });
    const template = cfg.honeypotWarningMessage || HONEYPOT_TEMPLATE_DEFAULTS.warning;
    let posted = 0, failed = 0;
    for (const chId of cfg.honeypotChannelIds) {
        try {
            const ch = await interaction.guild.channels.fetch(chId);
            const vars = buildHoneypotVars({ member: null, guild: interaction.guild, action: cfg.honeypotAction, honeypotChannel: ch });
            const msg = await ch.send({ embeds: [new EmbedBuilder().setDescription(renderHoneypotTemplate(template, vars).slice(0, 4000)).setColor(0xB35B00)] });
            await msg.pin().catch(() => {}); // best-effort — missing Manage Messages shouldn't fail the whole post
            posted++;
        } catch { failed++; }
    }
    await interaction.editReply({ embeds: [okEmbed('🍯 Warning Posted', `Posted in ${posted} channel${posted === 1 ? '' : 's'}${failed ? ` (${failed} failed — check the bot's permissions there)` : ''}.`)] });
}
async function slashSecurityHoneypotMessages(interaction, gs) {
    const cfg = getHoneypotConfig(gs);
    const modal = new ModalBuilder().setCustomId('honeypot_messages_modal').setTitle('🍯 Honeypot Messages');
    const field = (id, label, value) => new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Paragraph)
            .setRequired(false).setMaxLength(4000).setValue((value || '').slice(0, 4000))
    );
    modal.addComponents(
        field('hp_msg_warning', 'Channel Warning (shown in the trap channel)', cfg.honeypotWarningMessage || HONEYPOT_TEMPLATE_DEFAULTS.warning),
        field('hp_msg_dm', 'DM Message (sent to the user)', cfg.honeypotDmMessage || HONEYPOT_TEMPLATE_DEFAULTS.dm),
        field('hp_msg_log', 'Log Message (sent in the log channel)', cfg.honeypotLogMessage || HONEYPOT_TEMPLATE_DEFAULTS.log),
    );
    await interaction.showModal(modal);
}
async function slashSecurityHoneypotLogChannel(interaction, gs) { const ch = interaction.options.getChannel('channel'); getHoneypotConfig(gs).honeypotLogChannelId = ch.id; await interaction.reply({ embeds: [okEmbed('⚙️ Log Channel Set', `Honeypot hits will log to <#${ch.id}>.`)] }); }
async function slashSecurityHoneypotChannelAdd(interaction, gs) { const ch = interaction.options.getChannel('channel'); const r = coreHoneypotChannelAdd(gs, ch.id); if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 }); await interaction.reply({ embeds: [okEmbed('🍯 Honeypot Channel Added', `<#${ch.id}> is now a trap — any message there triggers the configured action.`)] }); }
async function slashSecurityHoneypotChannelRemove(interaction, gs) { const ch = interaction.options.getChannel('channel'); const r = coreHoneypotChannelRemove(gs, ch.id); if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 }); await interaction.reply({ embeds: [okEmbed('✅ Removed', `<#${ch.id}> is no longer a honeypot.`)] }); }
async function slashSecurityHoneypotRoleSet(interaction, gs) { const role = interaction.options.getRole('role'); getHoneypotConfig(gs).honeypotRoleId = role.id; await interaction.reply({ embeds: [okEmbed('🍯 Trap Role Set', `Granting <@&${role.id}> to anyone now triggers the configured action.`)] }); }
async function slashSecurityHoneypotRoleClear(interaction, gs) { getHoneypotConfig(gs).honeypotRoleId = null; await interaction.reply({ embeds: [okEmbed('✅ Cleared', 'No trap role configured.')] }); }
async function slashSecurityHoneypotCommandAdd(interaction, gs) { const r = coreHoneypotCommandAdd(gs, interaction.options.getString('name')); if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 }); await interaction.reply({ embeds: [okEmbed('🍯 Trap Command Added', `Anyone running \`${r.name}\` as a prefix command now triggers the configured action.`)] }); }
async function slashSecurityHoneypotCommandRemove(interaction, gs) { const r = coreHoneypotCommandRemove(gs, interaction.options.getString('name')); if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 }); await interaction.reply({ embeds: [okEmbed('✅ Removed', 'That trap command is gone.')] }); }

// ── prefix dispatcher (single `!honeypot <action> [...args]` command) ───
async function handleHoneypotPrefixAction(message, gs, action, args) {
    const send = (embeds) => message.channel.send({ embeds });
    switch (action) {
        case 'enable': getHoneypotConfig(gs).honeypotEnabled = true; return send([okEmbed('✅ Honeypots Enabled', 'Active honeypot channels/role/commands will now trigger actions.')]);
        case 'disable': getHoneypotConfig(gs).honeypotEnabled = false; return send([okEmbed('🛑 Honeypots Disabled', 'Configuration is saved but inactive.')]);
        case 'status': return send([honeypotStatusEmbed(gs)]);
        case 'action': { const t = (args[0] || '').toLowerCase(); if (!['ban', 'softban', 'kick', 'timeout'].includes(t)) return send([errEmbed('Action must be ban, softban, kick, or timeout.')]); getHoneypotConfig(gs).honeypotAction = t; return send([okEmbed('⚙️ Action Set', `Honeypots will now **${t}**.`)]); }
        case 'reinvite': { const t = (args[0] || '').toLowerCase(); if (!['on', 'off', 'true', 'false'].includes(t)) return send([errEmbed('Usage: `!honeypot reinvite on|off`')]); const enabled = t === 'on' || t === 'true'; getHoneypotConfig(gs).honeypotReinvite = enabled; return send([okEmbed('⚙️ Reinvite Updated', `${enabled ? 'Will now' : 'Will no longer'} DM a one-time invite back in after a softban/kick.`)]); }
        case 'messages': return send([errEmbed('Editing the message templates needs a form — use `/beli security honeypot-messages` instead of the `!honeypot` prefix command.')]);
        case 'post-warning': return send([errEmbed('Use `/beli security honeypot-post-warning` for this one (needs to reply per-channel).')]);
        case 'logchannel': { const ch = message.mentions.channels.first(); if (!ch) return send([errEmbed('Mention a channel.')]); getHoneypotConfig(gs).honeypotLogChannelId = ch.id; return send([okEmbed('⚙️ Log Channel Set', `Honeypot hits will log to <#${ch.id}>.`)]); }
        case 'channel-add': case 'channeladd': { const ch = message.mentions.channels.first(); if (!ch) return send([errEmbed('Mention a channel.')]); const r = coreHoneypotChannelAdd(gs, ch.id); return send([r.error ? errEmbed(r.error) : okEmbed('🍯 Honeypot Channel Added', `<#${ch.id}> is now a trap.`)]); }
        case 'channel-remove': case 'channelremove': { const ch = message.mentions.channels.first(); if (!ch) return send([errEmbed('Mention a channel.')]); const r = coreHoneypotChannelRemove(gs, ch.id); return send([r.error ? errEmbed(r.error) : okEmbed('✅ Removed', `<#${ch.id}> is no longer a honeypot.`)]); }
        case 'role-set': case 'roleset': { const role = message.mentions.roles.first(); if (!role) return send([errEmbed('Mention a role.')]); getHoneypotConfig(gs).honeypotRoleId = role.id; return send([okEmbed('🍯 Trap Role Set', `Granting <@&${role.id}> now triggers the configured action.`)]); }
        case 'role-clear': case 'roleclear': getHoneypotConfig(gs).honeypotRoleId = null; return send([okEmbed('✅ Cleared', 'No trap role configured.')]);
        case 'command-add': case 'commandadd': { const r = coreHoneypotCommandAdd(gs, args[0]); return send([r.error ? errEmbed(r.error) : okEmbed('🍯 Trap Command Added', `Running \`${r.name}\` now triggers the configured action.`)]); }
        case 'command-remove': case 'commandremove': { const r = coreHoneypotCommandRemove(gs, args[0]); return send([r.error ? errEmbed(r.error) : okEmbed('✅ Removed', 'That trap command is gone.')]); }
        default: return send([errEmbed('Unknown honeypot action. Try: enable, disable, status, action, reinvite, logchannel, channel-add, channel-remove, role-set, role-clear, command-add, command-remove. (messages/post-warning need the slash command version.)')]);
    }
}

// ══════════════════════════════════════════════════════════
//  AI GROUP — encryption, provider callers, key management
// ══════════════════════════════════════════════════════════
const AI_KEY_SECRET = process.env.AI_KEY_ENCRYPTION_SECRET || process.env.DASHBOARD_SESSION_SECRET || '';
function aiEncrypt(text) {
    if (!AI_KEY_SECRET) throw new Error('AI_KEY_ENCRYPTION_SECRET is not set — cannot store keys securely.');
    const key = crypto.createHash('sha256').update(AI_KEY_SECRET).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}
function aiDecrypt(b64) {
    const key = crypto.createHash('sha256').update(AI_KEY_SECRET).digest();
    const buf = Buffer.from(b64, 'base64');
    const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
function getUserApiKey(data, userId, provider) {
    const enc = data.userApiKeys?.[userId]?.[provider];
    if (!enc) return null;
    try { return aiDecrypt(enc); } catch { return null; }
}
function setUserApiKey(data, userId, provider, rawKey) {
    data.userApiKeys = data.userApiKeys || {};
    data.userApiKeys[userId] = data.userApiKeys[userId] || {};
    data.userApiKeys[userId][provider] = aiEncrypt(rawKey);
}
function removeUserApiKey(data, userId, provider) {
    if (data.userApiKeys?.[userId]?.[provider]) { delete data.userApiKeys[userId][provider]; return true; }
    return false;
}
function listUserApiKeys(data, userId) { return AI_PROVIDERS.filter(p => !!data.userApiKeys?.[userId]?.[p]); }

// Guild-level BYOK storage — same encrypt/decrypt as the per-user keys above,
// different namespace (data.guildApiKeys, not data.userApiKeys). This is what
// the dashboard's "AI Support" BYOK section writes to: a guild admin's own
// key, used for that guild's translate feature (and, later, other guild-
// scoped AI features) instead of the bot owner's shared/global key.
function getGuildApiKey(data, guildId, provider) {
    const enc = data.guildApiKeys?.[guildId]?.[provider];
    if (!enc) return null;
    try { return aiDecrypt(enc); } catch { return null; }
}
function setGuildApiKey(data, guildId, provider, rawKey) {
    data.guildApiKeys = data.guildApiKeys || {};
    data.guildApiKeys[guildId] = data.guildApiKeys[guildId] || {};
    data.guildApiKeys[guildId][provider] = aiEncrypt(rawKey);
}
function removeGuildApiKey(data, guildId, provider) {
    if (data.guildApiKeys?.[guildId]?.[provider]) { delete data.guildApiKeys[guildId][provider]; return true; }
    return false;
}
function listGuildApiKeys(data, guildId) { return AI_PROVIDERS.filter(p => !!data.guildApiKeys?.[guildId]?.[p]); }

async function callClaudeAPI(apiKey, model, history) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 1024, messages: history }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    return (json.content || []).map(b => b.text || '').join('') || '(empty response)';
}
async function callOpenAICompatAPI(baseUrl, apiKey, model, history) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: history, max_tokens: 1024 }),
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    return json.choices?.[0]?.message?.content || '(empty response)';
}
async function callGeminiAPI(apiKey, model, history) {
    const contents = history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents }),
    });
    if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '(empty response)';
}
async function callAIProvider(catalogEntry, apiKey, history) {
    const trimmed = history.slice(-40).map(m => ({ role: m.role, content: m.content }));
    if (catalogEntry.provider === 'claude') return callClaudeAPI(apiKey, catalogEntry.model, trimmed);
    if (catalogEntry.provider === 'gemini') return callGeminiAPI(apiKey, catalogEntry.model, trimmed);
    const base = OPENAI_COMPAT_BASE_URLS[catalogEntry.provider];
    if (!base) throw new Error(`Unknown provider "${catalogEntry.provider}".`);
    return callOpenAICompatAPI(base, apiKey, catalogEntry.model, trimmed);
}
function chunkText(text, max) {
    const chunks = []; let s = String(text || '');
    while (s.length > max) { chunks.push(s.slice(0, max)); s = s.slice(max); }
    chunks.push(s); return chunks;
}

// ── Slash handlers ───────────────────────────────────────────────────────
function aiThreadEmbed(catalog, extra = '') {
    return new EmbedBuilder().setTitle(`🤖 ${catalog.label}`).setColor(COLOR_INFO)
        .setDescription(`Chat away — just send messages in this thread and I'll relay them to ${catalog.label} using your own API key.\nUse \`/beli ai end\` (in this thread) when you're done.${extra}`);
}
async function slashAiSetKey(interaction, data, saveData) {
    const provider = interaction.options.getString('provider');
    if (!AI_PROVIDERS.includes(provider)) return interaction.reply({ embeds: [errEmbed('Unknown provider.')], flags: 64 });
    const modal = new ModalBuilder().setCustomId(`beli_setkey_${provider}_${interaction.id}`).setTitle(`Set ${provider} API Key`);
    const input = new TextInputBuilder().setCustomId('key').setLabel(PROVIDER_KEY_HINT[provider]).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(300);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    try {
        const submitted = await interaction.awaitModalSubmit({ filter: (i) => i.customId === modal.data.custom_id && i.user.id === interaction.user.id, time: 120000 });
        const rawKey = submitted.fields.getTextInputValue('key').trim();
        if (!rawKey) { await submitted.reply({ embeds: [errEmbed('Empty key — nothing saved.')], flags: 64 }); return; }
        setUserApiKey(data, interaction.user.id, provider, rawKey);
        saveData(data);
        await submitted.reply({ embeds: [okEmbed('🔑 Key Saved', `Your **${provider}** API key is encrypted at rest and never shown again. Start a chat with \`/beli ai chat\`.`)], flags: 64 });
    } catch (e) { /* modal timed out or was dismissed */ }
}
async function slashAiRemoveKey(interaction, data, saveData) {
    const provider = interaction.options.getString('provider');
    const removed = removeUserApiKey(data, interaction.user.id, provider);
    saveData(data);
    await interaction.reply({ embeds: [removed ? okEmbed('✅ Key Removed', `Your **${provider}** key has been deleted.`) : errEmbed(`No ${provider} key was on file.`)], flags: 64 });
}
async function slashAiMyKeys(interaction, data) {
    const set = listUserApiKeys(data, interaction.user.id);
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔑 Your AI Keys').setColor(COLOR_INFO)
        .setDescription(set.length ? `Configured: ${set.map(p => `**${p}**`).join(', ')}` : 'No keys set yet — use `/beli ai setkey`.')], flags: 64 });
}
async function slashAiChat(interaction, data, guildId, saveData) {
    const modelKey = interaction.options.getString('model');
    const catalog = AI_MODEL_CATALOG[modelKey];
    if (!catalog) return interaction.reply({ embeds: [errEmbed('Unknown model.')], flags: 64 });
    const apiKey = getUserApiKey(data, interaction.user.id, catalog.provider);
    if (!apiKey) return interaction.reply({ embeds: [errEmbed(`Set your own ${catalog.provider} key first with \`/beli ai setkey\` — this is bring-your-own-key only.`)], flags: 64 });
    if (!interaction.channel || typeof interaction.channel.threads?.create !== 'function') return interaction.reply({ embeds: [errEmbed('This has to be used in a regular text channel (not a thread/DM).')], flags: 64 });
    await interaction.deferReply();
    let thread;
    try { thread = await interaction.channel.threads.create({ name: `🤖 ${interaction.user.username} — ${catalog.label}`.slice(0, 100), autoArchiveDuration: 1440, reason: 'AI chat thread' }); }
    catch (e) { return interaction.editReply({ embeds: [errEmbed(`Couldn't create a thread here: ${e.message}`)] }); }
    data.aiThreads = data.aiThreads || {};
    data.aiThreads[thread.id] = { userId: interaction.user.id, guildId, modelKey, history: [], createdAt: Date.now() };
    saveData(data);
    await thread.send({ embeds: [aiThreadEmbed(catalog)] });
    await interaction.editReply({ embeds: [okEmbed('✅ Thread Created', `Started: <#${thread.id}>`)] });
}
async function slashAiEnd(interaction, data, saveData) {
    const rec = data.aiThreads?.[interaction.channel?.id];
    if (!rec || rec.userId !== interaction.user.id) return interaction.reply({ embeds: [errEmbed('This is not one of your active AI chat threads.')], flags: 64 });
    delete data.aiThreads[interaction.channel.id];
    saveData(data);
    await interaction.reply({ embeds: [okEmbed('✅ Chat Ended', 'This thread will no longer relay messages to the AI.')] });
    try { await interaction.channel.setArchived(true, 'AI chat ended'); } catch {}
}
async function checkAiThreadMessage(message, data, saveData) {
    if (!data.aiThreads) return false;
    const rec = data.aiThreads[message.channel.id];
    if (!rec) return false;
    if (message.author.bot) return false;
    if (message.author.id !== rec.userId) return false;
    const catalog = AI_MODEL_CATALOG[rec.modelKey];
    if (!catalog) return false;
    const apiKey = getUserApiKey(data, rec.userId, catalog.provider);
    if (!apiKey) { try { await message.reply({ embeds: [errEmbed(`Your ${catalog.provider} key is no longer set — use /beli ai setkey to continue.`)] }); } catch {} return true; }
    rec.history.push({ role: 'user', content: String(message.content || '').slice(0, 4000) });
    if (rec.history.length > 40) rec.history = rec.history.slice(-40);
    try {
        if (message.channel.sendTyping) await message.channel.sendTyping().catch(() => {});
        const reply = await callAIProvider(catalog, apiKey, rec.history);
        rec.history.push({ role: 'assistant', content: reply });
        for (const chunk of chunkText(reply, 1900)) await message.channel.send(chunk);
    } catch (e) {
        await message.channel.send({ embeds: [errEmbed(`AI request failed: ${e.message.slice(0, 300)}`)] }).catch(() => {});
    }
    saveData(data);
    return true;
}

// ── Prefix equivalents (setkey is intentionally slash-only) ─────────────
async function prefixAiMyKeys(message, data) {
    const set = listUserApiKeys(data, message.author.id);
    await message.channel.send({ embeds: [new EmbedBuilder().setTitle('🔑 Your AI Keys').setColor(COLOR_INFO).setDescription(set.length ? `Configured: ${set.map(p => `**${p}**`).join(', ')}` : 'No keys set yet — use `/beli ai setkey` (slash only, for security).')] });
}
async function prefixAiRemoveKey(message, data, saveData, args) {
    const provider = (args[0] || '').toLowerCase();
    if (!AI_PROVIDERS.includes(provider)) return message.channel.send({ embeds: [errEmbed(`Provider must be one of: ${AI_PROVIDERS.join(', ')}.`)] });
    const removed = removeUserApiKey(data, message.author.id, provider);
    saveData(data);
    await message.channel.send({ embeds: [removed ? okEmbed('✅ Key Removed', `Your **${provider}** key has been deleted.`) : errEmbed(`No ${provider} key was on file.`)] });
}
async function prefixAiEnd(message, data, saveData) {
    const rec = data.aiThreads?.[message.channel.id];
    if (!rec || rec.userId !== message.author.id) return message.channel.send({ embeds: [errEmbed('This is not one of your active AI chat threads.')] });
    delete data.aiThreads[message.channel.id];
    saveData(data);
    await message.channel.send({ embeds: [okEmbed('✅ Chat Ended', 'This thread will no longer relay messages to the AI.')] });
    try { await message.channel.setArchived(true, 'AI chat ended'); } catch {}
}
async function prefixAiChat(message, data, guildId, saveData, args) {
    const modelKey = (args[0] || '').toLowerCase();
    const catalog = AI_MODEL_CATALOG[modelKey];
    if (!catalog) return message.channel.send({ embeds: [errEmbed(`Unknown model. Try: ${Object.keys(AI_MODEL_CATALOG).join(', ')}`)] });
    const apiKey = getUserApiKey(data, message.author.id, catalog.provider);
    if (!apiKey) return message.channel.send({ embeds: [errEmbed(`Set your own ${catalog.provider} key first with \`/beli ai setkey\` (slash only, for security) — this is bring-your-own-key only.`)] });
    if (typeof message.channel.threads?.create !== 'function') return message.channel.send({ embeds: [errEmbed('This has to be used in a regular text channel.')] });
    let thread;
    try { thread = await message.channel.threads.create({ name: `🤖 ${message.author.username} — ${catalog.label}`.slice(0, 100), autoArchiveDuration: 1440, reason: 'AI chat thread' }); }
    catch (e) { return message.channel.send({ embeds: [errEmbed(`Couldn't create a thread here: ${e.message}`)] }); }
    data.aiThreads = data.aiThreads || {};
    data.aiThreads[thread.id] = { userId: message.author.id, guildId, modelKey, history: [], createdAt: Date.now() };
    saveData(data);
    await thread.send({ embeds: [aiThreadEmbed(catalog)] });
    await message.channel.send({ embeds: [okEmbed('✅ Thread Created', `Started: <#${thread.id}>`)] });
}

// ══════════════════════════════════════════════════════════
//  HELP GROUP — entries derived from beliCommand.toJSON() itself, so this
//  can never drift out of sync with the real command shape.
// ══════════════════════════════════════════════════════════
const HELP_NOTES = {
    'automod.word-add': 'Requires Manage Server. Blocks whole-word/phrase matches, case-insensitive.',
    'automod.regex-add': 'Requires Manage Server. Rejected if the pattern looks like it could catastrophically backtrack.',
    'security.honeypot-channel-add': 'Requires Manage Server. Any message from a non-immune member in this channel triggers the configured action immediately.',
    'gamble.blackjack': 'Also shows live Hit/Stand buttons on the deal message.',
    'gamble.mines': 'Fully interactive — click tiles to reveal them, cash out any time after your first safe pick.',
    'gamble.crash': 'Multiplier climbs live in the message; click Cash Out before it crashes.',
    'gamble.lottery-buy': 'Draws automatically once 24h have passed since the last draw.',
    'ai.setkey': 'Opens a private modal — your key is never sent as a visible command parameter, never logged, encrypted at rest.',
    'ai.chat': 'Requires your own API key for that provider (set via /beli ai setkey first). Creates a dedicated thread for the conversation.',
    'shop.use': 'Consumables only — cosmetics just display on your profile.',
    'upgrade.buy': 'Costs scale roughly with tier^1.55.',
};
const PREFIX_MAP = {
    'economy.balance': 'balance / bal', 'economy.leaderboard': 'leaderboard / lb', 'economy.deposit': 'deposit',
    'economy.withdraw': 'withdraw', 'economy.pay': 'pay', 'economy.profile': 'profile',
    'earn.daily': 'daily', 'earn.weekly': 'weekly', 'earn.work': 'work', 'earn.crime': 'crime',
    'earn.fish': 'fish', 'earn.hunt': 'hunt', 'earn.trivia': 'trivia', 'earn.rob': 'rob',
    'gamble.slots': 'slots', 'gamble.coinflip': 'coinflip', 'gamble.blackjack': 'blackjack',
    'gamble.blackjack-hit': 'bjhit', 'gamble.blackjack-stand': 'bjstand', 'gamble.dice': 'dice',
    'gamble.roulette': 'roulette', 'gamble.higherlower': 'higherlower', 'gamble.mines': 'mines',
    'gamble.crash': 'crash', 'gamble.wheel': 'wheel', 'gamble.scratch': 'scratch', 'gamble.lottery-buy': 'lottery <count>',
    'gamble.lottery-info': 'lottery', 'shop.view': 'shop', 'shop.buy': 'buy', 'shop.sell': 'sell',
    'shop.inventory': 'inventory / inv', 'shop.use': 'use', 'shop.gift': 'gift',
    'upgrade.view': 'upgrade', 'upgrade.buy': 'upgrade <track>', 'duel.challenge': 'duel <@user> <bet>',
    'duel.accept': 'duel accept', 'duel.decline': 'duel decline', 'duel.stats': 'duel stats [@user]',
    'quests.view': 'quests', 'quests.claim': 'quests claim',
    'automod.word-add': 'automod word-add <word>', 'automod.enable': 'automod enable', 'automod.disable': 'automod disable',
    'automod.status': 'automod status', 'security.honeypot-enable': 'honeypot enable', 'security.honeypot-status': 'honeypot status',
    'ai.mykeys': 'aimykeys', 'ai.removekey': 'airemovekey <provider>', 'ai.chat': 'aichat <model-key>', 'ai.end': 'aiend',
    'help.lookup': 'help <search term>',
};
function getAllHelpEntries() {
    const json = beliCommand.toJSON();
    const entries = [];
    for (const group of json.options) {
        for (const sub of (group.options || [])) {
            const id = `${group.name}.${sub.name}`;
            entries.push({ id, group: group.name, name: sub.name, description: sub.description, options: sub.options || [],
                slashUsage: `/beli ${group.name} ${sub.name}` + (sub.options || []).map(o => o.required ? ` <${o.name}>` : ` [${o.name}]`).join('') });
        }
    }
    return entries;
}
function buildHelpDetailEmbed(entry) {
    const optionsText = entry.options.length
        ? entry.options.map(o => `\`${o.name}\` ${o.required ? '**(required)**' : '(optional)'} — ${o.description}`).join('\n')
        : '_No parameters._';
    const fields = [{ name: 'Slash Usage', value: `\`${entry.slashUsage}\``, inline: false }, { name: 'Parameters', value: optionsText, inline: false }];
    if (PREFIX_MAP[entry.id]) fields.push({ name: 'Prefix Equivalent', value: `\`!${PREFIX_MAP[entry.id]}\``, inline: false });
    if (HELP_NOTES[entry.id]) fields.push({ name: 'Notes', value: HELP_NOTES[entry.id], inline: false });
    return new EmbedBuilder().setTitle(`📖 /beli ${entry.group} ${entry.name}`).setColor(COLOR_INFO).setDescription(entry.description).addFields(fields);
}
async function handleBeliAutocomplete(interaction) {
    if (!interaction.isAutocomplete() || interaction.commandName !== 'beli') return false;
    try {
        const focused = interaction.options.getFocused(true);
        if (focused.name !== 'query') { await interaction.respond([]); return true; }
        const q = String(focused.value || '').toLowerCase();
        const entries = getAllHelpEntries();
        const scored = entries.map(e => ({ e, hay: `${e.group} ${e.name} ${e.description}`.toLowerCase() })).filter(({ hay }) => !q || hay.includes(q)).slice(0, 25);
        await interaction.respond(scored.map(({ e }) => ({ name: `${e.group} ${e.name} — ${e.description}`.slice(0, 100), value: e.id })));
    } catch (e) { console.error('[beli] autocomplete error:', e.message); try { await interaction.respond([]); } catch {} }
    return true;
}
async function slashHelpLookup(interaction) {
    const id = interaction.options.getString('query');
    const entry = getAllHelpEntries().find(e => e.id === id);
    if (!entry) return interaction.reply({ embeds: [errEmbed("Pick a command from the dropdown as you type — free text won't match.")], flags: 64 });
    await interaction.reply({ embeds: [buildHelpDetailEmbed(entry)], flags: 64 });
}
async function prefixHelpLookup(message, args) {
    const q = args.join(' ').toLowerCase();
    if (!q) {
        const groups = [...new Set(getAllHelpEntries().map(e => e.group))];
        return message.channel.send({ embeds: [new EmbedBuilder().setTitle('📖 Beli Help').setColor(COLOR_INFO).setDescription(`Try \`!help <search term>\`, or use \`/beli help lookup\` for a searchable dropdown.\n\nGroups: ${groups.map(g => `**${g}**`).join(', ')}`)] });
    }
    const entries = getAllHelpEntries();
    const match = entries.find(e => `${e.group} ${e.name}`.toLowerCase() === q) || entries.find(e => `${e.group}.${e.name}`.toLowerCase().includes(q) || e.description.toLowerCase().includes(q));
    if (!match) return message.channel.send({ embeds: [errEmbed(`No match for "${q}". Try /beli help lookup for a searchable dropdown.`)] });
    await message.channel.send({ embeds: [buildHelpDetailEmbed(match)] });
}

// ══════════════════════════════════════════════════════════
//  KENO / LIMBO / WAR — 3 more genuinely distinct gamble mechanics
// ══════════════════════════════════════════════════════════
function coreKeno(rec, betRaw, picksRaw, ec = getEconomyEarnConfig(null)) {
    let bet = parseBet(betRaw, rec.wallet);
    if (bet === null) return { error: "That's not a valid bet." };
    if (bet <= 0) return { error: 'Bet must be greater than 0.' };
    if (bet > rec.wallet) return { error: `You only have ${fmtBeli(rec.wallet)}.` };
    const picks = [...new Set(String(picksRaw || '').split(/[,\s]+/).map(n => parseInt(n, 10)).filter(n => Number.isFinite(n) && n >= 1 && n <= 40))].slice(0, 10);
    if (!picks.length) return { error: 'Pick 1-10 numbers from 1-40, e.g. "3,17,29".' };
    removeWallet(rec, bet);
    rec.gamesPlayed = (rec.gamesPlayed || 0) + 1;
    const pool = Array.from({ length: 40 }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[pool[i], pool[j]] = [pool[j], pool[i]]; }
    const drawn = new Set(pool.slice(0, 10));
    const matches = picks.filter(n => drawn.has(n)).length;
    const ratio = matches / picks.length;
    let mult = 0;
    if (ratio >= 0.8) mult = picks.length * ec.kenoHighMult;
    else if (ratio >= 0.6) mult = picks.length * ec.kenoMidMult;
    else if (ratio >= 0.4) mult = picks.length * ec.kenoLowMult;
    if (mult === 0 && Math.random() < Math.min(0.1, getLuckBonus(rec) + gambleBoostBonus(rec))) mult = ec.kenoLuckPayoutMult;
    const payout = Math.round(bet * mult);
    if (payout > 0) addWallet(rec, payout);
    if (payout > bet) rec.gamesWon = (rec.gamesWon || 0) + 1;
    return { bet, picks, drawn: [...drawn].sort((a, b) => a - b), matches, payout, wallet: rec.wallet, net: payout - bet };
}
function coreLimbo(rec, betRaw, targetRaw, ec = getEconomyEarnConfig(null)) {
    let bet = parseBet(betRaw, rec.wallet);
    if (bet === null) return { error: "That's not a valid bet." };
    if (bet <= 0) return { error: 'Bet must be greater than 0.' };
    if (bet > rec.wallet) return { error: `You only have ${fmtBeli(rec.wallet)}.` };
    const target = Number(targetRaw);
    if (!Number.isFinite(target) || target < 1.01 || target > 1000) return { error: 'Target must be 1.01x-1000x.' };
    removeWallet(rec, bet);
    rec.gamesPlayed = (rec.gamesPlayed || 0) + 1;
    const r = Math.max(0.0001, Math.random());
    let rollPoint = Math.max(1.00, Math.min(10000, ec.limboRTP / r));
    rollPoint *= (1 + Math.min(0.15, getLuckBonus(rec) + gambleBoostBonus(rec)));
    const won = rollPoint >= target;
    let payout = 0;
    if (won) { payout = Math.round(bet * target); addWallet(rec, payout); rec.gamesWon = (rec.gamesWon || 0) + 1; }
    return { bet, won, target, rollPoint: rollPoint.toFixed(2), payout, wallet: rec.wallet, net: payout - bet };
}
function coreWar(rec, betRaw, ec = getEconomyEarnConfig(null)) {
    let bet = parseBet(betRaw, rec.wallet);
    if (bet === null) return { error: "That's not a valid bet." };
    if (bet <= 0) return { error: 'Bet must be greater than 0.' };
    if (bet > rec.wallet) return { error: `You only have ${fmtBeli(rec.wallet)}.` };
    removeWallet(rec, bet);
    rec.gamesPlayed = (rec.gamesPlayed || 0) + 1;
    const playerCard = drawCard();
    if (Math.random() < ec.warPushChance) {
        const dealerCard = { rank: playerCard.rank, suit: CARD_SUITS[Math.floor(Math.random() * CARD_SUITS.length)] };
        addWallet(rec, bet);
        return { bet, result: 'push', playerCard, dealerCard, payout: bet, wallet: rec.wallet, net: 0 };
    }
    const pRank = highLowRank(playerCard.rank);
    const higherPool = CARD_RANKS.filter((r, i) => i > pRank);
    const lowerPool = CARD_RANKS.filter((r, i) => i < pRank);
    let won = false;
    if (lowerPool.length) won = Math.random() < Math.min(0.52, 0.47 + getLuckBonus(rec) + gambleBoostBonus(rec));
    const pool = won ? lowerPool : (higherPool.length ? higherPool : CARD_RANKS);
    const dealerCard = { rank: pool[Math.floor(Math.random() * pool.length)], suit: CARD_SUITS[Math.floor(Math.random() * CARD_SUITS.length)] };
    let payout = 0;
    if (won) { payout = Math.round(bet * ec.warWinMult); addWallet(rec, payout); rec.gamesWon = (rec.gamesWon || 0) + 1; }
    return { bet, result: won ? 'win' : 'loss', playerCard, dealerCard, payout, wallet: rec.wallet, net: payout - bet };
}

function kenoEmbed(r) {
    return gambleEmbed('🔢 Keno', `Your picks: ${r.picks.join(', ')}\nDrawn: ${r.drawn.join(', ')}\nMatches: **${r.matches}/${r.picks.length}**\n${r.payout > 0 ? `You won ${fmtBeli(r.payout)}!` : `You lost ${fmtBeli(r.bet)}.`}\nWallet: ${fmtBeli(r.wallet)}`, r.net);
}
function limboEmbed(r) {
    return gambleEmbed('📉 Limbo', `Target: **${r.target}x** | Rolled: **${r.rollPoint}x**\n${r.won ? `You won ${fmtBeli(r.payout)}!` : `You lost ${fmtBeli(r.bet)}.`}\nWallet: ${fmtBeli(r.wallet)}`, r.net);
}
function warEmbed(r) {
    const labels = { win: '✅ You win!', loss: '❌ Dealer wins.', push: '🤝 Push — bet returned.' };
    return gambleEmbed('⚔️ War', `You: ${cardDisplay(r.playerCard)} vs Dealer: ${cardDisplay(r.dealerCard)}\n${labels[r.result]}\nWallet: ${fmtBeli(r.wallet)}`, r.net);
}

async function slashGambleKeno(interaction, data, guildId, gs) { const r = coreKeno(ensureEconomy(data, guildId, interaction.user.id), interaction.options.getString('bet'), interaction.options.getString('numbers'), getEconomyEarnConfig(gs)); if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 }); await interaction.reply({ embeds: [kenoEmbed(r)] }); }
async function slashGambleLimbo(interaction, data, guildId, gs) { const r = coreLimbo(ensureEconomy(data, guildId, interaction.user.id), interaction.options.getString('bet'), interaction.options.getNumber('target'), getEconomyEarnConfig(gs)); if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 }); await interaction.reply({ embeds: [limboEmbed(r)] }); }
async function slashGambleWar(interaction, data, guildId, gs) { const r = coreWar(ensureEconomy(data, guildId, interaction.user.id), interaction.options.getString('bet'), getEconomyEarnConfig(gs)); if (r.error) return interaction.reply({ embeds: [errEmbed(r.error)], flags: 64 }); await interaction.reply({ embeds: [warEmbed(r)] }); }
async function prefixGambleKeno(message, data, guildId, gs, args) { const r = coreKeno(ensureEconomy(data, guildId, message.author.id), args[0], args.slice(1).join(','), getEconomyEarnConfig(gs)); if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] }); await message.channel.send({ embeds: [kenoEmbed(r)] }); }
async function prefixGambleLimbo(message, data, guildId, gs, args) { const r = coreLimbo(ensureEconomy(data, guildId, message.author.id), args[0], args[1], getEconomyEarnConfig(gs)); if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] }); await message.channel.send({ embeds: [limboEmbed(r)] }); }
async function prefixGambleWar(message, data, guildId, gs, args) { const r = coreWar(ensureEconomy(data, guildId, message.author.id), args[0], getEconomyEarnConfig(gs)); if (r.error) return message.channel.send({ embeds: [errEmbed(r.error)] }); await message.channel.send({ embeds: [warEmbed(r)] }); }