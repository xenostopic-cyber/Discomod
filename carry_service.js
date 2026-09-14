'use strict';

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, PermissionFlagsBits, ChannelType, ModalBuilder,
  TextInputBuilder, TextInputStyle,
} = require('discord.js');

/**
 * DISCOMOD Carry Service
 * ----------------------
 * A guild-scoped carry/service queue that turns a request into a private
 * support channel. It is intentionally generic: admins define the services,
 * staff roles, category, templates, queue limits and status messages.
 * The module does not pretend to automate game actions; it manages Discord
 * workflow, intake, assignment and completion.
 */

const STATUSES = Object.freeze(['open', 'claimed', 'paused', 'completed', 'cancelled']);
const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  categoryId: null,
  staffRoleIds: [],
  logChannelId: null,
  panelChannelId: null,
  panelTitle: '🎮 Carry & Service Center',
  panelDescription: 'Choose a service and open a private request. Staff will claim it when available.',
  panelButtonLabel: 'Request a Service',
  channelNameTemplate: 'carry-{counter}-{user}',
  openMessage: 'Hey {user}! Your service request is open.\n\n**Service:** {service}\n**Details:** {details}\n\nA staff member will claim this request shortly.',
  claimMessage: '✅ {staff} claimed this request.',
  pauseMessage: '⏸️ This request has been paused. A staff member will resume it when available.',
  completeMessage: '✅ {user}, your service request has been completed.',
  cancelMessage: '🛑 This service request was cancelled.',
  staffMention: true,
  oneOpenPerUser: true,
  maxOpenRequests: 100,
  autoArchiveOnComplete: true,
  archiveDelaySeconds: 15,
  requireReason: true,
  requireService: true,
  services: [
    { id: 'raid', name: 'Raid Carry', description: 'Help with a raid.', emoji: '⚔️', enabled: true },
    { id: 'boss', name: 'Boss Carry', description: 'Boss assistance.', emoji: '👹', enabled: true },
    { id: 'mastery', name: 'Mastery Grind', description: 'Mastery support.', emoji: '📈', enabled: true },
    { id: 'race', name: 'Race V4 / Trials', description: 'Race/trial assistance.', emoji: '🏁', enabled: true },
    { id: 'custom', name: 'Other Service', description: 'Anything else supported by your staff team.', emoji: '🛠️', enabled: true },
  ],
});

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function cleanText(v, max = 2000) { return String(v ?? '').trim().slice(0, max); }
function normalizeService(x, index = 0) {
  if (!x || typeof x !== 'object') return null;
  const name = cleanText(x.name, 80); if (!name) return null;
  const id = cleanText(x.id || `service${index + 1}`, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '') || `service${index + 1}`;
  return { id, name, description: cleanText(x.description, 250), emoji: cleanText(x.emoji || '🎮', 8), enabled: x.enabled !== false };
}
function normalizeConfig(src) {
  const cur = src && typeof src === 'object' ? src : {};
  const out = { ...clone(DEFAULT_CONFIG), ...cur };
  out.staffRoleIds = [...new Set((Array.isArray(cur.staffRoleIds) ? cur.staffRoleIds : []).map(String).filter(Boolean))].slice(0, 25);
  out.services = (Array.isArray(cur.services) ? cur.services : DEFAULT_CONFIG.services).map(normalizeService).filter(Boolean).slice(0, 50);
  out.maxOpenRequests = Math.max(1, Math.min(1000, Number(out.maxOpenRequests) || DEFAULT_CONFIG.maxOpenRequests));
  out.archiveDelaySeconds = Math.max(0, Math.min(3600, Number(out.archiveDelaySeconds) || 0));
  return out;
}
function getCarryConfig(gs) { gs.carryService = normalizeConfig(gs.carryService); return gs.carryService; }
function ensureStore(data) { data.carryRequests = data.carryRequests && typeof data.carryRequests === 'object' ? data.carryRequests : {}; return data.carryRequests; }
function guildStore(data, guildId) { const s = ensureStore(data); s[guildId] = s[guildId] && typeof s[guildId] === 'object' ? s[guildId] : {}; return s[guildId]; }
function newId() { return `carry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`; }
function enabledServices(cfg) { return cfg.services.filter(x => x.enabled); }
function findOpenByUser(data, guildId, userId) { return Object.values(guildStore(data, guildId)).find(r => r && r.userId === String(userId) && ['open','claimed','paused'].includes(r.status)); }
function counts(data, guildId) { const out = { open:0, claimed:0, paused:0, completed:0, cancelled:0, total:0 }; for (const r of Object.values(guildStore(data,guildId))) if (STATUSES.includes(r?.status)) { out[r.status]++; out.total++; } return out; }
function pushEvent(req, type, actorId = null, meta = {}) { if (!Array.isArray(req.events)) req.events = []; req.events.push({ type, actorId: actorId ? String(actorId) : null, at: Date.now(), ...meta }); if (req.events.length > 100) req.events.splice(0, req.events.length-100); }
function render(text, vars={}) { return cleanText(text, 4000).replace(/\{([A-Za-z0-9_]+)\}/g, (m,k)=>vars[k] == null ? m : String(vars[k])); }
function staffAllowed(member, guildId, data, deps) { if (!member) return false; if (deps?.isSuperUser?.(member.id)) return true; if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true; if (deps?.isManagerMember?.(member,guildId,data)) return true; const cfg=getCarryConfig(deps.getGuildSettings(guildId,data)); return cfg.staffRoleIds.some(id=>member.roles?.cache?.has(id)); }
function customId(kind,guildId,requestId) { return `carry:${kind}:${guildId}:${requestId}`; }

function buildPanel(cfg, guildName) {
  const embed = new EmbedBuilder().setColor(0x2DE0C4).setTitle(cfg.panelTitle).setDescription(cfg.panelDescription).setFooter({ text: `${guildName} • Carry Service` });
  if (enabledServices(cfg).length) embed.addFields(enabledServices(cfg).slice(0,25).map(s=>({name:`${s.emoji} ${s.name}`,value:s.description || 'Available service',inline:true})));
  return { embeds:[embed], components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('carry:panel').setLabel(cfg.panelButtonLabel).setStyle(ButtonStyle.Primary))] };
}

async function createRequest({guild,user,serviceId,details,data,gs,saveData,client}) {
  const cfg=getCarryConfig(gs); if(!cfg.enabled) return {error:'Carry Service is disabled on this server.'};
  const service=cfg.services.find(x=>x.id===serviceId && x.enabled); if(!service) return {error:'That service is not available.'};
  const existing=findOpenByUser(data,guild.id,user.id); if(cfg.oneOpenPerUser && existing) return {error:`You already have an open request: <#${existing.channelId}>.`};
  const c=counts(data,guild.id); if(c.open+c.claimed+c.paused>=cfg.maxOpenRequests) return {error:'The service queue is currently full. Please try again later.'};
  const store=guildStore(data,guild.id); const id=newId(); const counter=Number(gs.carryCounter||0)+1; gs.carryCounter=counter;
  const name=render(cfg.channelNameTemplate,{counter,user:user.username.replace(/[^a-z0-9-]/gi,'').slice(0,20)||'user',service:service.id}).toLowerCase().slice(0,90);
  const overwrites=[{id:guild.roles.everyone.id,deny:['ViewChannel']} ,{id:user.id,allow:['ViewChannel','SendMessages','ReadMessageHistory','AttachFiles']}];
  for(const roleId of cfg.staffRoleIds){ if(guild.roles.cache.has(roleId)) overwrites.push({id:roleId,allow:['ViewChannel','SendMessages','ReadMessageHistory','AttachFiles','ManageMessages']}); }
  let channel; try { channel=await guild.channels.create({name,type:ChannelType.GuildText,parent:cfg.categoryId||undefined,permissionOverwrites:overwrites}); } catch(e) { return {error:`Could not create the request channel: ${e.message}`}; }
  const req={id,guildId:guild.id,userId:user.id,username:user.username,channelId:channel.id,serviceId:service.id,serviceName:service.name,details:cleanText(details,2500),status:'open',claimedBy:null,createdAt:Date.now(),updatedAt:Date.now(),completedAt:null,cancelledAt:null,cancelReason:null,events:[]};
  pushEvent(req,'created',user.id,{serviceId:service.id}); store[id]=req; saveData(data);
  const roleMentions=cfg.staffMention && cfg.staffRoleIds.length ? cfg.staffRoleIds.map(x=>`<@&${x}>`).join(' ') : '';
  const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(customId('claim',guild.id,id)).setLabel('✅ Claim').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId(customId('pause',guild.id,id)).setLabel('⏸️ Pause').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId(customId('complete',guild.id,id)).setLabel('✔️ Complete').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(customId('cancel',guild.id,id)).setLabel('🛑 Cancel').setStyle(ButtonStyle.Danger));
  const embed=new EmbedBuilder().setColor(0x2DE0C4).setTitle(`${service.emoji} ${service.name}`).setDescription(render(cfg.openMessage,{user:`<@${user.id}>`,service:service.name,details:req.details,request:id})).addFields({name:'Requester',value:`<@${user.id}>`,inline:true},{name:'Request ID',value:`\`${id}\``,inline:true},{name:'Status',value:'OPEN',inline:true}).setTimestamp();
  await channel.send({content:roleMentions||undefined,embeds:[embed],components:[row],allowedMentions:{parse:roleMentions?['roles']:[]}}).catch(()=>{});
  return {request:req,channel};
}

async function handleInteraction(interaction,deps) {
  const cid=String(interaction.customId||''); if(!cid.startsWith('carry:')) return false;
  if(cid==='carry:panel'){
    const data=deps.loadData(); const guild=interaction.guild; const cfg=getCarryConfig(deps.getGuildSettings(guild.id,data));
    if(!cfg.enabled){await interaction.reply({content:'❌ Carry Service is disabled.',ephemeral:true}).catch(()=>{});return true;}
    const services=enabledServices(cfg); if(!services.length){await interaction.reply({content:'❌ No services are currently configured.',ephemeral:true}).catch(()=>{});return true;}
    const modal=new ModalBuilder().setCustomId(`carry:request:${guild.id}`).setTitle('Service Request');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('service').setLabel('Service ID').setStyle(TextInputStyle.Short).setRequired(cfg.requireService).setMaxLength(40).setPlaceholder(services.map(s=>s.id).join(', '))),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('details').setLabel('What do you need?').setStyle(TextInputStyle.Paragraph).setRequired(cfg.requireReason).setMaxLength(1500)));
    await interaction.showModal(modal).catch(()=>{}); return true;
  }
  const p=cid.split(':'); const action=p[1],guildId=p[2],requestId=p[3]; const data=deps.loadData(); const guild=deps.client.guilds.cache.get(guildId)||interaction.guild; const req=guildStore(data,guildId)[requestId];
  if(!req){await interaction.reply({content:'❌ Request not found.',ephemeral:true}).catch(()=>{});return true;}
  const member=guild.members.cache.get(interaction.user.id)||await guild.members.fetch(interaction.user.id).catch(()=>null);
  const isStaff=staffAllowed(member,guildId,data,deps);
  if(action==='cancel' && (isStaff||interaction.user.id===req.userId)){
    req.status='cancelled'; req.cancelledAt=Date.now(); req.updatedAt=Date.now(); req.cancelReason=interaction.user.id===req.userId?'requester':'staff'; pushEvent(req,'cancelled',interaction.user.id); deps.saveData(data);
    await interaction.reply({content:'🛑 Request cancelled.',ephemeral:true}).catch(()=>{});
    await guild.channels.cache.get(req.channelId)?.send({content:render(getCarryConfig(deps.getGuildSettings(guildId,data)).cancelMessage,{user:`<@${req.userId}>`})}).catch(()=>{}); return true;
  }
  if(!isStaff){await interaction.reply({content:'❌ Staff only.',ephemeral:true}).catch(()=>{});return true;}
  if(action==='claim'){
    if(!['open','paused'].includes(req.status)){await interaction.reply({content:'❌ This request cannot be claimed in its current state.',ephemeral:true}).catch(()=>{});return true;}
    req.status='claimed';req.claimedBy=interaction.user.id;req.updatedAt=Date.now();pushEvent(req,'claimed',interaction.user.id);deps.saveData(data);
    await interaction.reply({content:'✅ Request claimed.',ephemeral:true}).catch(()=>{}); await guild.channels.cache.get(req.channelId)?.send({content:render(getCarryConfig(deps.getGuildSettings(guildId,data)).claimMessage,{staff:`<@${interaction.user.id}>`})}).catch(()=>{}); return true;
  }
  if(action==='pause'){
    if(!['open','claimed'].includes(req.status)){await interaction.reply({content:'❌ This request cannot be paused.',ephemeral:true}).catch(()=>{});return true;}
    req.status='paused';req.updatedAt=Date.now();pushEvent(req,'paused',interaction.user.id);deps.saveData(data);await interaction.reply({content:'⏸️ Request paused.',ephemeral:true}).catch(()=>{});return true;
  }
  if(action==='complete'){
    if(!['open','claimed','paused'].includes(req.status)){await interaction.reply({content:'❌ This request is already closed.',ephemeral:true}).catch(()=>{});return true;}
    req.status='completed';req.completedAt=Date.now();req.updatedAt=Date.now();pushEvent(req,'completed',interaction.user.id);deps.saveData(data);await interaction.reply({content:'✔️ Request marked completed.',ephemeral:true}).catch(()=>{});
    const cfg=getCarryConfig(deps.getGuildSettings(guildId,data)); const ch=guild.channels.cache.get(req.channelId); if(ch) { await ch.send({content:render(cfg.completeMessage,{user:`<@${req.userId}>`})}).catch(()=>{}); if(cfg.autoArchiveOnComplete) setTimeout(()=>ch.delete('Carry request completed').catch(()=>{}),Math.max(0,cfg.archiveDelaySeconds*1000)); } return true;
  }
  return true;
}

async function handleModalSubmit(interaction,deps){
  const cid=String(interaction.customId||''); if(!cid.startsWith('carry:request:')) return false; const guildId=cid.split(':')[2]; const data=deps.loadData(); const guild=deps.client.guilds.cache.get(guildId)||interaction.guild; const gs=deps.getGuildSettings(guildId,data);
  const serviceId=String(interaction.fields.getTextInputValue('service')||'').trim().toLowerCase(); const details=String(interaction.fields.getTextInputValue('details')||'').trim(); const result=await createRequest({guild,user:interaction.user,serviceId,details,data,gs,saveData:deps.saveData,client:deps.client});
  if(result.error){await interaction.reply({content:`❌ ${result.error}`,ephemeral:true}).catch(()=>{});return true;}
  await interaction.reply({content:`✅ Request created: <#${result.request.channelId}>`,ephemeral:true}).catch(()=>{}); return true;
}

async function handleCommand(interaction,deps){
  if(!interaction.isChatInputCommand?.()||interaction.commandName!=='carry') return false;
  const sub=interaction.options.getSubcommand(); const data=deps.loadData(); const guildId=interaction.guildId; const guild=interaction.guild; const gs=deps.getGuildSettings(guildId,data); const cfg=getCarryConfig(gs);
  if(sub==='panel') { if(!deps.isAdmin?.(interaction,guildId,data) && !interaction.member?.permissions?.has(PermissionFlagsBits.ManageChannels)){await interaction.reply({content:'❌ Managers only.',ephemeral:true}).catch(()=>{});return true;} const channel=interaction.options.getChannel('channel')||interaction.channel; await channel.send(buildPanel(cfg,guild.name)).then(()=>interaction.reply({content:'✅ Carry Service panel posted.',ephemeral:true})).catch(()=>interaction.reply({content:'❌ Could not post the panel.',ephemeral:true})); return true; }
  if(sub==='status'){const c=counts(data,guildId);await interaction.reply({embeds:[new EmbedBuilder().setColor(0x2DE0C4).setTitle('🎮 Carry Service Status').setDescription(`Enabled: **${cfg.enabled?'YES':'NO'}**\nOpen: **${c.open}**\nClaimed: **${c.claimed}**\nPaused: **${c.paused}**\nCompleted: **${c.completed}**\nCancelled: **${c.cancelled}**`)] ,ephemeral:true}).catch(()=>{});return true;}
  return false;
}

async function handlePrefix(message,cmd,args,deps){if(cmd!=='carry')return false;const data=deps.loadData();const guild=message.guild;if(!guild)return false;const gs=deps.getGuildSettings(guild.id,data);const cfg=getCarryConfig(gs);const sub=String(args.shift()||'request').toLowerCase();if(sub==='request'){const serviceId=String(args.shift()||'').toLowerCase();const details=args.join(' ').trim();const result=await createRequest({guild,user:message.author,serviceId,details,data,gs,saveData:deps.saveData,client:deps.client});await message.channel.send(result.error?`❌ ${result.error}`:`✅ Request created: <#${result.request.channelId}>`).catch(()=>{});return true;}if(sub==='status'){const c=counts(data,guild.id);await message.channel.send(`🎮 Carry Service — Open: ${c.open}, Claimed: ${c.claimed}, Paused: ${c.paused}, Completed: ${c.completed}`).catch(()=>{});return true;}return true;}


function getRequest(data, guildId, requestId) { return guildStore(data, guildId)[requestId] || null; }
function requestAgeMs(r, now=Date.now()) { return Math.max(0, now - (Number(r.createdAt)||now)); }
function requestDurationMs(r, now=Date.now()) {
  if (r.completedAt) return Math.max(0, r.completedAt - (r.createdAt||r.completedAt));
  if (r.cancelledAt) return Math.max(0, r.cancelledAt - (r.createdAt||r.cancelledAt));
  return requestAgeMs(r, now);
}
function requestsByStatus(data,guildId,status){return Object.values(guildStore(data,guildId)).filter(r=>r&&r.status===status);}
function requestMetrics(data,guildId){
  const rows=Object.values(guildStore(data,guildId)).filter(Boolean), byService={};
  for(const r of rows){const k=r.serviceId||'unknown';if(!byService[k])byService[k]={serviceId:k,serviceName:r.serviceName||k,total:0,open:0,claimed:0,paused:0,completed:0,cancelled:0,avgCompletionMs:null};byService[k].total++;if(byService[k][r.status]!==undefined)byService[k][r.status]++;}
  for(const x of Object.values(byService)){const completed=rows.filter(r=>(r.serviceId||'unknown')===x.serviceId&&r.completedAt&&r.createdAt).map(r=>r.completedAt-r.createdAt);if(completed.length)x.avgCompletionMs=Math.round(completed.reduce((a,b)=>a+b,0)/completed.length);}
  return {counts:counts(data,guildId),byService:Object.values(byService).sort((a,b)=>b.total-a.total),openAgeMs:requestsByStatus(data,guildId,'open').map(r=>requestAgeMs(r)),generatedAt:Date.now()};
}
function serviceUsage(data,guildId,serviceId){return Object.values(guildStore(data,guildId)).filter(r=>r&&r.serviceId===serviceId).length;}
function canStartRequest(data,guildId,userId,cfg){
  const existing=findOpenByUser(data,guildId,userId); if(cfg.oneOpenPerUser&&existing)return {ok:false,reason:'open_request'};
  return {ok:true};
}
function validateRequestInput(cfg,serviceId,details){
  const service=cfg.services.find(s=>s.id===String(serviceId).toLowerCase()&&s.enabled);if(!service)return {error:'That service is unavailable.'};
  const body=String(details||'').trim(); if(cfg.requireReason&&!body)return {error:'Request details are required.'};
  if(body.length>2500)return {error:'Request details are too long (2,500 characters maximum).'};
  return {service,details:body};
}
function buildRequestEmbed(req,cfg){
  return new EmbedBuilder().setColor(req.status==='completed'?0x4ADE80:req.status==='cancelled'?0xFF6B5E:0x2DE0C4)
    .setTitle(`${req.serviceName||'Service Request'} • ${String(req.status).toUpperCase()}`)
    .setDescription(render(cfg.openMessage,{user:`<@${req.userId}>`,service:req.serviceName||req.serviceId,details:req.details||'',request:req.id}))
    .addFields(
      {name:'Requester',value:`<@${req.userId}>`,inline:true},
      {name:'Status',value:String(req.status).toUpperCase(),inline:true},
      {name:'Request ID',value:`\`${req.id}\``,inline:true},
      {name:'Claimed by',value:req.claimedBy?`<@${req.claimedBy}>`:'Unclaimed',inline:true},
      {name:'Created',value:`<t:${Math.floor((req.createdAt||Date.now())/1000)}:R>`,inline:true},
    ).setTimestamp(req.updatedAt||req.createdAt||Date.now());
}
async function claimRequest(data,guildId,requestId,staffId,saveData){const r=getRequest(data,guildId,requestId);if(!r)return {error:'Request not found.'};if(!['open','paused'].includes(r.status))return {error:'Request is not claimable.'};r.status='claimed';r.claimedBy=String(staffId);r.updatedAt=Date.now();pushEvent(r,'claimed',staffId);saveData(data);return {request:r};}
async function pauseRequest(data,guildId,requestId,staffId,saveData){const r=getRequest(data,guildId,requestId);if(!r)return {error:'Request not found.'};if(!['open','claimed'].includes(r.status))return {error:'Request is not pausable.'};r.status='paused';r.updatedAt=Date.now();pushEvent(r,'paused',staffId);saveData(data);return {request:r};}
async function completeRequest(data,guildId,requestId,staffId,saveData){const r=getRequest(data,guildId,requestId);if(!r)return {error:'Request not found.'};if(!['open','claimed','paused'].includes(r.status))return {error:'Request is already closed.'};r.status='completed';r.completedAt=Date.now();r.updatedAt=r.completedAt;pushEvent(r,'completed',staffId);saveData(data);return {request:r};}
async function cancelRequest(data,guildId,requestId,actorId,reason,saveData){const r=getRequest(data,guildId,requestId);if(!r)return {error:'Request not found.'};if(['completed','cancelled'].includes(r.status))return {error:'Request is already closed.'};r.status='cancelled';r.cancelledAt=Date.now();r.updatedAt=r.cancelledAt;r.cancelReason=cleanText(reason||'',500);pushEvent(r,'cancelled',actorId,{reason:r.cancelReason});saveData(data);return {request:r};}
async function reopenRequest(data,guildId,requestId,staffId,saveData){const r=getRequest(data,guildId,requestId);if(!r)return {error:'Request not found.'};if(!['completed','cancelled'].includes(r.status))return {error:'Only completed/cancelled requests can be reopened.'};r.status='open';r.claimedBy=null;r.completedAt=null;r.cancelledAt=null;r.cancelReason=null;r.updatedAt=Date.now();pushEvent(r,'reopened',staffId);saveData(data);return {request:r};}
async function transferRequest(data,guildId,requestId,staffId,newStaffId,saveData){const r=getRequest(data,guildId,requestId);if(!r)return {error:'Request not found.'};if(r.status!=='claimed')return {error:'Only claimed requests can be transferred.'};r.claimedBy=String(newStaffId);r.updatedAt=Date.now();pushEvent(r,'transferred',staffId,{to:String(newStaffId)});saveData(data);return {request:r};}
function exportCsv(data,guildId){const rows=exportData(data,guildId);const headers=['id','userId','username','serviceId','serviceName','status','claimedBy','createdAt','updatedAt','completedAt','cancelledAt','details'];const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;return [headers.join(','),...rows.map(r=>headers.map(h=>q(r[h])).join(','))].join('\n');}
function dashboardSnapshot(data,guildId){const rows=exportData(data,guildId);return {stats:counts(data,guildId),metrics:requestMetrics(data,guildId),requests:rows.slice(0,250)};}
async function configure(gs,patch){const cur=normalizeConfig(gs.carryService);const next=normalizeConfig({...cur,...patch});gs.carryService=next;return next;}
function exportData(data,guildId){return Object.values(guildStore(data,guildId)).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).map(r=>({...r,events:Array.isArray(r.events)?r.events.slice(-100):[]}));}

const slashCommandBuilders=[new SlashCommandBuilder().setName('carry').setDescription('Carry & service request system').addSubcommand(s=>s.setName('request').setDescription('Open a private carry/service request').addStringOption(o=>o.setName('service').setDescription('Service ID').setRequired(true)).addStringOption(o=>o.setName('details').setDescription('What you need').setRequired(true))).addSubcommand(s=>s.setName('status').setDescription('Show carry queue status')).addSubcommand(s=>s.setName('panel').setDescription('Post the carry service panel').addChannelOption(o=>o.setName('channel').setDescription('Panel channel').setRequired(false)))];

module.exports={STATUSES,DEFAULT_CONFIG,normalizeConfig,getCarryConfig,ensureStore,guildStore,counts,enabledServices,createRequest,handleInteraction,handleModalSubmit,handleCommand,handlePrefix,configure,exportData,exportCsv,dashboardSnapshot,requestMetrics,getRequest,validateRequestInput,buildRequestEmbed,claimRequest,pauseRequest,completeRequest,cancelRequest,reopenRequest,transferRequest,buildPanel,slashCommandBuilders,pushEvent,staffAllowed};