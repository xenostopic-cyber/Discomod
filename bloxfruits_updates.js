'use strict';

// Curated Blox Fruits update reference data used by the dashboard and AI-support
// context. This is intentionally reference metadata, not a stock provider.
// Source of the current Update 30 facts: Blox Fruits Wiki's Updates page.
// Keep this separate from FRUITS/stock detection so changing reference prose
// cannot accidentally change moderation matching.

const SOURCE = 'Blox Fruits Wiki (community-maintained reference)';
const VERSION = '2026-09-13';

const UPDATE_30 = Object.freeze({
  id: '30',
  version: '30.0',
  title: "Valentine's Day Event",
  emoji: '💞',
  releasedAt: '2026-02-14',
  eventEndedAt: '2026-02-22',
  status: 'event-ended',
  summary: 'Valentine-themed seasonal content introduced a new fruit mutation, accessories, NPCs, a questline, event activities, and profile backgrounds.',
  features: Object.freeze({
    fruitMutations: ['Fiend'],
    accessories: ["Cupid's Top Hat", 'Romantic Bouquet'],
    npcs: ['Cupid Valentine Quest Giver', 'Valentines Gacha Dealer', 'Valentines Delivery NPC', 'Event Shop'],
    profileBackgrounds: ['Lover', 'Heartbreak'],
    quests: ['Valentines Delivery', 'Cupid Valentine Quest Giver'],
    events: ['Valentines Delivery'],
  }),
  mechanics: Object.freeze([
    {
      id: 'npc-damage-scaling',
      title: 'NPC damage scaling',
      description: 'NPC damage was temporarily changed to scale with NPC level, removing the need for stat points during the event; the feature was disabled after the event ended.',
      activeDuringEventOnly: true,
    },
  ]),
  dashboardTags: Object.freeze(['update-30', 'valentines', '2026', 'fiend', 'seasonal', 'event']),
});

const RELATED_UPDATES = Object.freeze([
  Object.freeze({ id: '29.0', title: 'Control Update', date: '2025-12-23', highlights: ['Control rework', 'Dungeon Mode', 'Trinkets', 'new inventory organization'] }),
  Object.freeze({ id: '31', title: 'Easter Event', date: '2026-03-28', highlights: ['Easter Gifts', 'Easter Egg Hunt Codex', 'Cracked Egg Helmet', 'Easter Bunny Cape', 'Easter Shop'] }),
]);

function cloneUpdate30() {
  return JSON.parse(JSON.stringify(UPDATE_30));
}

function searchUpdate(query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return cloneUpdate30();
  const haystack = JSON.stringify(UPDATE_30).toLowerCase();
  return haystack.includes(q) ? cloneUpdate30() : null;
}

function listUpdate30Entries() {
  const out = [];
  for (const group of Object.entries(UPDATE_30.features)) {
    for (const value of group[1]) out.push({ category: group[0], name: value });
  }
  for (const m of UPDATE_30.mechanics) out.push({ category: 'mechanics', name: m.title });
  return out;
}

function getKnowledgeSnippet() {
  return [
    `Update 30 (${UPDATE_30.releasedAt}): ${UPDATE_30.title}.`,
    `Fruit mutation: ${UPDATE_30.features.fruitMutations.join(', ')}.`,
    `Accessories: ${UPDATE_30.features.accessories.join(', ')}.`,
    `NPCs: ${UPDATE_30.features.npcs.join(', ')}.`,
    `Profile backgrounds: ${UPDATE_30.features.profileBackgrounds.join(', ')}.`,
    `Quests: ${UPDATE_30.features.quests.join(', ')}.`,
    'Seasonal event ended February 22, 2026.',
  ].join(' ');
}

function validate() {
  const errors = [];
  if (UPDATE_30.id !== '30') errors.push('invalid update id');
  if (!UPDATE_30.features.fruitMutations.length) errors.push('missing fruit mutations');
  if (!UPDATE_30.features.accessories.length) errors.push('missing accessories');
  if (!UPDATE_30.features.npcs.length) errors.push('missing NPC list');
  if (!UPDATE_30.releasedAt) errors.push('missing release date');
  return { ok: errors.length === 0, errors };
}

module.exports = {
  SOURCE,
  VERSION,
  UPDATE_30,
  RELATED_UPDATES,
  cloneUpdate30,
  searchUpdate,
  listUpdate30Entries,
  getKnowledgeSnippet,
  validate,
};
