'use strict';
const assert = require('assert');
const Module = require('module');
function chain(){const x={}; for(const m of ['setColor','setTitle','setDescription','setFooter','addFields','setTimestamp','setCustomId','setLabel','setStyle','setPlaceholder','addOptions','setName','setDefaultMemberPermissions','addSubcommand','addStringOption','setRequired','setMaxLength','setMinLength','addChannelOption','addIntegerOption','addSubcommandGroup','setEmoji','setMinValue','setMaxValue','setAutocomplete','addNumberOption']) x[m]=()=>x; return x;}
const fake={
  SlashCommandBuilder:class{constructor(){return chain();}}, EmbedBuilder:class{constructor(){return chain();}}, ButtonBuilder:class{constructor(){return chain();}}, ActionRowBuilder:class{constructor(){return chain();}}, ModalBuilder:class{constructor(){return chain();}}, TextInputBuilder:class{constructor(){return chain();}}, StringSelectMenuBuilder:class{constructor(){return chain();}}, StringSelectMenuOptionBuilder:class{constructor(){return chain();}},
  ButtonStyle:{Primary:1,Secondary:2,Success:3,Danger:4}, TextInputStyle:{Short:1,Paragraph:2}, PermissionFlagsBits:{Administrator:8,ManageChannels:16}, ChannelType:{GuildText:0}
};
const orig=Module._load; Module._load=function(req,parent,isMain){if(req==='discord.js') return fake; return orig.apply(this,arguments);};
try {
 const beli=require('../beli_commands');
 const clean={beliGameConfig:{}};
 const baseline=beli.getGuildShopItems(clean);
 assert.ok(baseline.length>0);
 const id=baseline[0].id;
 const originalPrice=baseline[0].price;
 const gs={beliGameConfig:{shopPrices:{[id]:originalPrice+12345},upgradeBaseCosts:{luck:9876}}};
 const items=beli.getGuildShopItems(gs);
 assert.strictEqual(items.find(x=>x.id===id).price,originalPrice+12345);
 assert.strictEqual(beli.getGuildShopPrice(beli.SHOP_ITEMS.find(x=>x.id===id),gs),originalPrice+12345);
 const base=beli.getGuildUpgradeBaseCost('luck',gs);
 assert.strictEqual(base,9876);
 const defaultCost=beli.upgradeCost('luck',0,{});
 assert.notStrictEqual(beli.upgradeCost('luck',0,gs),defaultCost);
 assert.strictEqual(beli.upgradeCost('luck',0,gs),Math.round(9876*Math.pow(1,1.55)));
 const econ=beli.getEconomyEarnConfig({beliEarn:{minesMaxMines:7,crashMaxMultiplier:123,lotteryTicketPrice:777,blackjackDealerStandAt:18,warPushChance:0.1}});
 assert.strictEqual(econ.minesMaxMines,7);
 assert.strictEqual(econ.crashMaxMultiplier,123);
 assert.strictEqual(econ.lotteryTicketPrice,777);
 assert.strictEqual(econ.blackjackDealerStandAt,18);
 assert.strictEqual(econ.warPushChance,0.1);
 console.log('finish17.test.js: PASS');
} finally { Module._load=orig; }
