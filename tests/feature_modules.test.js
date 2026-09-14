'use strict';
const assert = require('assert');
const Module = require('module');

function chain() {
  const x = {};
  const methods = ['setColor','setTitle','setDescription','setFooter','addFields','setTimestamp','setCustomId','setLabel','setStyle','setPlaceholder','addOptions','setName','setDescription','setDefaultMemberPermissions','addSubcommand','addStringOption','setRequired','setMaxLength','setMinLength','addChannelOption'];
  for (const m of methods) x[m] = () => x;
  return x;
}
class SlashCommandBuilderStub extends (class {}) { constructor(){ super(); return chain(); } }
class EmbedBuilderStub { constructor(){ return chain(); } }
class ButtonBuilderStub { constructor(){ return chain(); } }
class ActionRowBuilderStub { constructor(){ return chain(); } }
class ModalBuilderStub { constructor(){ return chain(); } }
class TextInputBuilderStub { constructor(){ return chain(); } }
class StringSelectMenuBuilderStub { constructor(){ return chain(); } }
class StringSelectMenuOptionBuilderStub { constructor(){ return chain(); } }
const fakeDiscord = {
  SlashCommandBuilder: SlashCommandBuilderStub,
  EmbedBuilder: EmbedBuilderStub,
  ButtonBuilder: ButtonBuilderStub,
  ActionRowBuilder: ActionRowBuilderStub,
  ButtonStyle: { Primary: 1, Secondary: 2, Success: 3, Danger: 4 },
  ModalBuilder: ModalBuilderStub,
  TextInputBuilder: TextInputBuilderStub,
  TextInputStyle: { Short: 1, Paragraph: 2 },
  StringSelectMenuBuilder: StringSelectMenuBuilderStub,
  StringSelectMenuOptionBuilder: StringSelectMenuOptionBuilderStub,
  PermissionFlagsBits: { Administrator: 8, ManageChannels: 16 },
  ChannelType: { GuildText: 0 },
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain){ if(request === 'discord.js') return fakeDiscord; return originalLoad.apply(this, arguments); };
try {
  const appeals = require('../appeals');
  const carry = require('../carry_service');
  const gs = {};
  const ac = appeals.getAppealConfig(gs);
  assert.ok(ac.questions.length >= 1);
  ac.questions.push({id:'x',prompt:'X',type:'short'});
  const data = { customAppeals: { g: { a: { id:'a',userId:'u',status:'accepted',createdAt:100,reviewedAt:300 }, b:{id:'b',userId:'u',status:'pending',createdAt:200} } } };
  assert.strictEqual(appeals.stats(data,'g').accepted,1);
  const cc = carry.getCarryConfig({});
  assert.ok(cc.services.length >= 1);
  const cd = { carryRequests: { g: { a:{id:'a',status:'open',serviceId:'raid',serviceName:'Raid Carry',createdAt:100}, b:{id:'b',status:'completed',serviceId:'raid',serviceName:'Raid Carry',createdAt:100,completedAt:300} } } };
  assert.strictEqual(carry.counts(cd,'g').open,1);
  assert.strictEqual(carry.requestMetrics(cd,'g').byService[0].completed,1);
  assert.strictEqual(carry.validateRequestInput(cc,'missing','x').error, 'That service is unavailable.');
  console.log('feature module tests: PASS');
} finally {
  Module._load = originalLoad;
}
