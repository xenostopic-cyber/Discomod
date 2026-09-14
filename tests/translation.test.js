'use strict';
const assert = require('assert');

// Test-only Discord.js shim; production code still uses the real package.
const Module = require('module');
function _chain(){ const x={}; for(const m of ['setColor','setTitle','setDescription','setFooter','addFields','setTimestamp','setCustomId','setLabel','setStyle','setPlaceholder','addOptions','setName','setDefaultMemberPermissions','addSubcommand','addStringOption','setRequired','setMaxLength','setMinLength','addChannelOption','addIntegerOption','addNumberOption']) x[m]=()=>x; return x; }
const _fakeDiscord={SlashCommandBuilder:class{constructor(){return _chain();}},EmbedBuilder:class{constructor(){return _chain();}},ButtonBuilder:class{constructor(){return _chain();}},ActionRowBuilder:class{constructor(){return _chain();}},ModalBuilder:class{constructor(){return _chain();}},TextInputBuilder:class{constructor(){return _chain();}},StringSelectMenuBuilder:class{constructor(){return _chain();}},StringSelectMenuOptionBuilder:class{constructor(){return _chain();}},ButtonStyle:{Primary:1,Secondary:2,Success:3,Danger:4},TextInputStyle:{Short:1,Paragraph:2},PermissionFlagsBits:{Administrator:8,ManageChannels:16},ChannelType:{GuildText:0}};
const _origLoad=Module._load; Module._load=function(request,parent,isMain){if(request==='discord.js')return _fakeDiscord; return _origLoad.apply(this,arguments);};
const t = require('../translation');

(function testLanguages() {
  assert.equal(t.normalizeLanguage('NL'),'nl');
  assert.equal(t.normalizeLanguage('not-a-language'),'auto');
  assert.equal(t.normalizeLanguage('not-a-language','en'),'en');
  assert.ok(t.SUPPORTED_LANGUAGE_CODES.includes('en'));
})();

(function testConfigValidation() {
  const cfg = t.validateTranslationConfig({
    enabled:false,autoEnabled:true,defaultSource:'nl',defaultTarget:'de',
    maxInputChars:99999,minAutoTranslateChars:0,autoCooldownMs:1,duplicateSuppressionMs:999999,
    systemPrefix:'🌍',messageTemplate:'[{target}] {translation} {notAllowed}',
    preserveCodeBlocks:false,ignoreCommands:false,
  }, t.DEFAULT_TRANSLATION_CONFIG, {AI_PROVIDERS:['groq','openai'],AI_MODEL_CATALOG:{g:{provider:'groq'}}});
  assert.equal(cfg.enabled,false);
  assert.equal(cfg.autoEnabled,true);
  assert.equal(cfg.defaultSource,'nl');
  assert.equal(cfg.defaultTarget,'de');
  assert.equal(cfg.maxInputChars,12000);
  assert.equal(cfg.minAutoTranslateChars,1);
  assert.equal(cfg.autoCooldownMs,250);
  assert.equal(cfg.duplicateSuppressionMs,120000);
  assert.equal(cfg.systemPrefix,'🌍');
  assert.ok(!cfg.messageTemplate.includes('{notAllowed}'));
})();

(function testFormat() {
  const c = t.ensureTranslationConfig({translation:{messageTemplate:'{source}->{target}: {translation} | {provider}',showOriginal:true}});
  const out = t.formatTranslationResult({source:'nl',target:'en',translation:'hello',model:'Groq Test',original:'hoi'},c);
  assert.equal(out,'Dutch->English: hello | Groq Test');
})();

(function testSkipRules() {
  const cfg = t.ensureTranslationConfig({translation:{ignoreCommands:true,ignoreBotMessages:true,minAutoTranslateChars:3,systemPrefix:'🌐'}});
  assert.equal(t.shouldSkipAutoTranslation({content:'hi',author:{bot:false}},cfg),true);
  assert.equal(t.shouldSkipAutoTranslation({content:'!help something',author:{bot:false}},cfg),true);
  assert.equal(t.shouldSkipAutoTranslation({content:'hello world',author:{bot:true}},cfg),true);
  assert.equal(t.shouldSkipAutoTranslation({content:'🌐 already translated',author:{bot:false}},cfg),true);
  assert.equal(t.shouldSkipAutoTranslation({content:'hello world',author:{bot:false}},cfg),false);
})();

(function testStatus() {
  const c=t.ensureTranslationConfig({translation:{autoEnabled:true,autoChannelIds:['1','2'],provider:'groq',model:'groq'}});
  const s=t.translationStatusText(c,['groq']);
  assert.ok(s.includes('Auto-translate: **enabled**'));
  assert.ok(s.includes('Channels: **2**'));
  assert.ok(s.includes('BYOK providers: **groq**'));
})();

console.log('translation.test.js: all assertions passed');

Module._load = _origLoad;
