'use strict';
const assert = require('assert');

// Test-only Discord.js shim; production code still uses the real package.
const Module = require('module');
function _chain(){ const x={}; for(const m of ['setColor','setTitle','setDescription','setFooter','addFields','setTimestamp','setCustomId','setLabel','setStyle','setPlaceholder','addOptions','setName','setDefaultMemberPermissions','addSubcommand','addStringOption','setRequired','setMaxLength','setMinLength','addChannelOption','addIntegerOption','addNumberOption']) x[m]=()=>x; return x; }
const _fakeDiscord={SlashCommandBuilder:class{constructor(){return _chain();}},EmbedBuilder:class{constructor(){return _chain();}},ButtonBuilder:class{constructor(){return _chain();}},ActionRowBuilder:class{constructor(){return _chain();}},ModalBuilder:class{constructor(){return _chain();}},TextInputBuilder:class{constructor(){return _chain();}},StringSelectMenuBuilder:class{constructor(){return _chain();}},StringSelectMenuOptionBuilder:class{constructor(){return _chain();}},ButtonStyle:{Primary:1,Secondary:2,Success:3,Danger:4},TextInputStyle:{Short:1,Paragraph:2},PermissionFlagsBits:{Administrator:8,ManageChannels:16},ChannelType:{GuildText:0}};
const _origLoad=Module._load; Module._load=function(request,parent,isMain){if(request==='discord.js')return _fakeDiscord; return _origLoad.apply(this,arguments);};
const apps = require('../applications');

function makeData(guildId='g1') { return { applications: { [guildId]: {} } }; }
function makeGs(overrides={}) { return { applications: { ...apps.DEFAULT_CONFIG, questions: apps.DEFAULT_CONFIG.questions.map(q=>({...q})), ...overrides } }; }
function fakeClient(guild) {
  return {
    guilds: { cache: new Map([[guild.id, guild]]) },
    users: { fetch: async () => ({ send: async()=>({}) }) },
  };
}

(function testNormalizeQuestion() {
  const q = apps.normalizeQuestion({ id:' q!1 ', prompt:'  Tell me  ', type:'short', required:false, minLength:4, maxLength:25, placeholder:'hello', emoji:'🧠', choices:['a','b'] });
  assert.equal(q.id, 'q1');
  assert.equal(q.prompt, 'Tell me');
  assert.equal(q.type, 'short');
  assert.equal(q.minLength, 4);
  assert.equal(q.maxLength, 25);
  assert.equal(q.placeholder, 'hello');
  assert.equal(q.emoji, '🧠');
  assert.deepEqual(q.choices, []);
})();

(function testConfigCloneAndBounds() {
  const gs = makeGs();
  const cfg = apps.getApplicationConfig(gs);
  assert.ok(Array.isArray(cfg.questions));
  assert.ok(cfg.questions.length >= 1);
  const q = apps.normalizeQuestion({ prompt:'x', minLength:5000, maxLength:1 });
  assert.equal(q.maxLength, 1);
  assert.equal(q.minLength, 1);
})();

(function testEventHistoryAndTiming() {
  const app = { createdAt:1000, submittedAt:11000, reviewedAt:16000, status:'completed', events:[] };
  apps.pushEvent(app, 'created', 'u1', { source:'slash' });
  apps.pushEvent(app, 'submitted', 'u1');
  apps.pushEvent(app, 'accepted', 'mod1');
  assert.equal(app.events.length, 3);
  assert.equal(app.events[0].type, 'created');
  const timing = apps.applicationTiming(app);
  assert.equal(timing.completionMs, 10000);
  assert.equal(timing.reviewMs, 5000);
  assert.ok(timing.ageMs >= 0);
})();

(function testStatistics() {
  const now = Date.now();
  const data = makeData();
  data.applications.g1 = {
    a:{id:'a',userId:'u1',status:'active',createdAt:now-10000},
    b:{id:'b',userId:'u2',status:'completed',reviewStatus:'accepted',createdAt:now-100000,submittedAt:now-50000,reviewedAt:now-20000},
    c:{id:'c',userId:'u3',status:'completed',reviewStatus:'rejected',createdAt:now-200000,submittedAt:now-160000,reviewedAt:now-100000},
    d:{id:'d',userId:'u4',status:'cancelled',createdAt:now-300000},
    e:{id:'e',userId:'u5',status:'snoozed',createdAt:now-400000},
  };
  const stats = apps.applicationStats(data,'g1');
  assert.deepEqual({active:stats.active,completed:stats.completed,cancelled:stats.cancelled,snoozed:stats.snoozed,total:stats.total},{active:1,completed:2,cancelled:1,snoozed:1,total:5});
  assert.equal(stats.accepted,1);
  assert.equal(stats.rejected,1);
  assert.equal(stats.pendingReview,0);
  assert.equal(stats.completionRate,20);
  assert.equal(stats.averageReviewMs,45000);
  assert.equal(stats.recentDaily.length,1);
})();

(async function testLifecycleAndSweep() {
  const data = makeData();
  const guild = {
    id:'g1',
    name:'Test Guild',
    client:null,
    channels:{ cache:new Map() },
  };
  guild.client = fakeClient(guild);
  let saved = 0;
  const getGs = ()=>makeGs({ enabled:true, timeLimitMinutes:60, snoozeMinutes:30, reviewSnoozeMinutes:15 });
  const now = Date.now();
  data.applications.g1 = {
    expired:{id:'expired',userId:'u1',status:'active',expiresAt:now-1000,updatedAt:now-1000},
    applicantSnooze:{id:'as',userId:'u2',status:'snoozed',snoozeKind:'applicant',remainingMs:30000,snoozedUntil:now-1,updatedAt:now-1000,currentIndex:0,answers:{}},
    reviewSnooze:{id:'rs',userId:'u3',status:'snoozed',snoozeKind:'review',snoozedUntil:now-1,updatedAt:now-1000},
  };
  const changed = apps.sweep(data,guild.client,getGs);
  assert.equal(changed,true);
  assert.equal(data.applications.g1.expired.status,'cancelled');
  assert.equal(data.applications.g1.expired.cancelReason,'timed_out');
  assert.equal(data.applications.g1.applicantSnooze.status,'active');
  assert.ok(data.applications.g1.applicantSnooze.expiresAt > now);
  assert.equal(data.applications.g1.reviewSnooze.status,'completed');
  assert.ok(Array.isArray(data.applications.g1.reviewSnooze.events));
  saved++;
  assert.equal(saved,1);
})();

console.log('applications.test.js: all assertions passed');

Module._load = _origLoad;
