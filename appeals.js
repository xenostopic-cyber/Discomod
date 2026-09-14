'use strict';

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, PermissionFlagsBits,
} = require('discord.js');

/**
 * DISCOMOD Appeals Studio
 * -----------------------
 * A guild-scoped custom appeal form engine that deliberately sits beside the
 * existing built-in exile/warn/timeout/ban/honeypot appeal flows. It provides
 * a configurable general-appeal experience without rewriting those mature
 * handlers. Configuration is JSON-friendly so the dashboard and bot consume
 * exactly the same shape.
 */

const STATUS = Object.freeze(['pending', 'accepted', 'rejected', 'withdrawn']);
const QUESTION_TYPES = Object.freeze(['short', 'paragraph', 'choice', 'yesno']);
const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  channelId: null,
  reviewerRoleIds: [],
  title: '📩 Server Appeal',
  description: 'Complete this appeal privately. Your answers will be reviewed by the server team.',
  startButtonLabel: 'Submit Appeal',
  answerButtonLabel: 'Answer',
  cancelButtonLabel: 'Cancel',
  formIntro: 'Please answer each question honestly and provide enough context for staff to review your appeal.',
  completionMessage: '✅ Your appeal has been submitted for review.',
  acceptedMessage: '✅ Your appeal was accepted. Thank you for providing additional context.',
  rejectedMessage: '❌ Your appeal was rejected.\n\nReason: {reason}',
  maxActivePerUser: 1,
  timeLimitMinutes: 120,
  allowCancel: true,
  allowBack: true,
  requireRejectReason: true,
  notifyReviewer: true,
  reviewerMention: true,
  autoCloseOnDecision: true,
  decisionDm: true,
  questions: [
    { id: 'q1', prompt: 'What action are you appealing?', type: 'choice', required: true, choices: ['Warning', 'Timeout', 'Ban', 'Exile', 'Other'], minLength: 1, maxLength: 100 },
    { id: 'q2', prompt: 'Why do you believe the action should be reconsidered?', type: 'paragraph', required: true, choices: [], minLength: 30, maxLength: 2000 },
    { id: 'q3', prompt: 'Is there any additional context or evidence staff should consider?', type: 'paragraph', required: false, choices: [], minLength: 0, maxLength: 2000 },
  ],
});

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function idSafe(v, fallback = 'q') {
  const x = String(v || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  return x || fallback;
}
function normalizeQuestion(q, index = 0) {
  if (!q || typeof q !== 'object') return null;
  const type = QUESTION_TYPES.includes(q.type) ? q.type : 'paragraph';
  const prompt = String(q.prompt || '').trim().slice(0, 1000);
  if (!prompt) return null;
  const maxDefault = type === 'short' || type === 'yesno' ? 300 : 2000;
  const maxLength = Math.max(1, Math.min(4000, Number(q.maxLength) || maxDefault));
  const minLength = Math.max(0, Math.min(maxLength, Number(q.minLength) || 0));
  const choices = type === 'choice'
    ? [...new Set((Array.isArray(q.choices) ? q.choices : []).map(x => String(x).trim()).filter(Boolean))].slice(0, 25)
    : [];
  return {
    id: idSafe(q.id, `q${index + 1}`), prompt, type, required: q.required !== false,
    minLength, maxLength, choices,
  };
}
function normalizeConfig(src) {
  const base = clone(DEFAULT_CONFIG);
  const cur = src && typeof src === 'object' ? src : {};
  const out = { ...base, ...cur };
  out.reviewerRoleIds = [...new Set((Array.isArray(cur.reviewerRoleIds) ? cur.reviewerRoleIds : []).map(String).filter(Boolean))].slice(0, 25);
  out.questions = (Array.isArray(cur.questions) ? cur.questions : base.questions).map(normalizeQuestion).filter(Boolean);
  if (!out.questions.length) out.questions = base.questions.map(normalizeQuestion);
  for (const k of ['maxActivePerUser', 'timeLimitMinutes']) {
    const n = Number(out[k]);
    out[k] = Number.isInteger(n) ? Math.max(1, Math.min(k === 'timeLimitMinutes' ? 10080 : 10, n)) : base[k];
  }
  return out;
}
function getAppealConfig(gs) { gs.customAppeals = normalizeConfig(gs.customAppeals); return gs.customAppeals; }
function ensureStore(data) {
  data.customAppeals = data.customAppeals && typeof data.customAppeals === 'object' ? data.customAppeals : {};
  return data.customAppeals;
}
function guildStore(data, guildId) {
  const s = ensureStore(data);
  s[guildId] = s[guildId] && typeof s[guildId] === 'object' ? s[guildId] : {};
  return s[guildId];
}
function newId(prefix = 'appeal') { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }
function activeForUser(data, guildId, userId) {
  return Object.values(guildStore(data, guildId)).find(a => a && a.userId === String(userId) && ['pending'].includes(a.status));
}
function stats(data, guildId) {
  const all = Object.values(guildStore(data, guildId));
  const out = { pending: 0, accepted: 0, rejected: 0, withdrawn: 0, total: 0 };
  for (const a of all) if (STATUS.includes(a?.status)) { out[a.status]++; out.total++; }
  out.averageReviewMinutes = null;
  const reviewed = all.filter(a => a.reviewedAt && a.createdAt).map(a => (a.reviewedAt - a.createdAt) / 60000).filter(Number.isFinite);
  if (reviewed.length) out.averageReviewMinutes = Math.round((reviewed.reduce((a,b)=>a+b,0) / reviewed.length) * 10) / 10;
  out.acceptanceRate = out.total ? Math.round((out.accepted / out.total) * 1000) / 10 : 0;
  return out;
}
function pushEvent(app, type, actorId = null, meta = {}) {
  if (!Array.isArray(app.events)) app.events = [];
  app.events.push({ type, actorId: actorId ? String(actorId) : null, at: Date.now(), ...meta });
  if (app.events.length > 100) app.events.splice(0, app.events.length - 100);
}
function renderTemplate(text, vars = {}) {
  return String(text || '').replace(/\{([A-Za-z0-9_]+)\}/g, (m, k) => vars[k] == null ? m : String(vars[k]));
}
function isReviewer(member, guildId, data, deps) {
  if (!member) return false;
  if (deps?.isSuperUser?.(member.id)) return true;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (deps?.isManagerMember?.(member, guildId, data)) return true;
  const cfg = getAppealConfig(deps.getGuildSettings(guildId, data));
  return cfg.reviewerRoleIds.some(id => member.roles?.cache?.has(id));
}
function answerId(guildId, appealId, qid) { return `capp:answer:${guildId}:${appealId}:${qid}`; }
function choiceId(guildId, appealId, qid) { return `capp:choice:${guildId}:${appealId}:${qid}`; }
function controlId(kind, guildId, appealId) { return `capp:${kind}:${guildId}:${appealId}`; }
function reviewId(kind, guildId, appealId) { return `capp:review:${kind}:${guildId}:${appealId}`; }
function rejectModalId(guildId, appealId) { return `capp:reject:${guildId}:${appealId}`; }

function questionPromptEmbed(app, user, guild, cfg) {
  const q = cfg.questions[app.currentIndex];
  if (!q) return null;
  const vars = { user: `<@${user.id}>`, username: user.username, server: guild.name, number: app.currentIndex + 1, total: cfg.questions.length };
  const embed = new EmbedBuilder().setColor(0x2DE0C4).setTitle(`${q.id === 'q1' ? '📝' : '❓'} Question ${app.currentIndex + 1} of ${cfg.questions.length}`).setDescription(`${renderTemplate(q.prompt, vars)}\n\n${cfg.formIntro}`).setFooter({ text: `Appeal ID: ${app.id}` });
  if (q.type === 'choice') embed.addFields({ name: 'Choose one', value: q.choices.map((x, i) => `${i + 1}. ${x}`).join('\n') || 'No choices configured.' });
  if (q.minLength) embed.addFields({ name: 'Answer requirements', value: `Minimum ${q.minLength} characters. Maximum ${q.maxLength}.` });
  return embed;
}

async function sendQuestion(app, user, guild, cfg) {
  const q = cfg.questions[app.currentIndex];
  if (!q) return false;
  const components = [];
  if (q.type === 'choice') {
    components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(choiceId(guild.id, app.id, q.id)).setPlaceholder('Choose an option').addOptions(q.choices.map((x, i) => new StringSelectMenuOptionBuilder().setLabel(x.slice(0, 100)).setValue(String(i))))));
  } else {
    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(answerId(guild.id, app.id, q.id)).setLabel(cfg.answerButtonLabel).setStyle(ButtonStyle.Primary)));
  }
  const nav = [];
  if (cfg.allowBack && app.currentIndex > 0) nav.push(new ButtonBuilder().setCustomId(controlId('back', guild.id, app.id)).setLabel('◀ Back').setStyle(ButtonStyle.Secondary));
  if (cfg.allowCancel) nav.push(new ButtonBuilder().setCustomId(controlId('cancel', guild.id, app.id)).setLabel(cfg.cancelButtonLabel).setStyle(ButtonStyle.Danger));
  if (nav.length) components.push(new ActionRowBuilder().addComponents(nav));
  await user.send({ embeds: [questionPromptEmbed(app, user, guild, cfg)], components }).catch(() => {});
  return true;
}

async function startAppeal({ guild, user, data, gs, saveData, source = 'bot' }) {
  const cfg = getAppealConfig(gs);
  if (!cfg.enabled) return { error: 'The custom appeal form is disabled on this server.' };
  const existing = activeForUser(data, guild.id, user.id);
  if (existing) return { error: `You already have an active appeal (${existing.id}).` };
  const id = newId();
  const app = {
    id, guildId: guild.id, userId: user.id, username: user.username,
    status: 'pending', reviewStatus: 'pending', currentIndex: 0, answers: {},
    createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + cfg.timeLimitMinutes * 60000,
    submittedAt: null, reviewedAt: null, reviewedBy: null, reviewReason: null,
    source, events: [],
  };
  pushEvent(app, 'created', user.id, { source });
  const store = guildStore(data, guild.id); store[id] = app; saveData(data);
  try {
    await user.send({
      embeds: [new EmbedBuilder()
        .setColor(0x2DE0C4)
        .setTitle(cfg.title)
        .setDescription(cfg.description)
        .addFields(
          { name: 'Time limit', value: `${cfg.timeLimitMinutes} minutes`, inline: true },
          { name: 'Questions', value: String(cfg.questions.length), inline: true }
        )],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(controlId('begin', guild.id, id)).setLabel(cfg.answerButtonLabel).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(controlId('cancel', guild.id, id)).setLabel(cfg.cancelButtonLabel).setStyle(ButtonStyle.Danger)
      )]
    });
  } catch { delete store[id]; saveData(data); return { error: 'I could not DM you. Please enable DMs from server members and try again.' }; }
  return { application: app };
}

async function completeAppeal(app, guild, user, cfg, data, saveData) {
  app.submittedAt = Date.now();
  app.updatedAt = Date.now();
  app.status = 'pending';
  app.reviewStatus = 'pending';
  pushEvent(app, 'submitted', user.id);
  const channelId = cfg.channelId;
  const ch = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
  if (ch?.isTextBased?.()) {
    const lines = cfg.questions.map((q, i) => `**${i + 1}. ${q.prompt}**\n${String(app.answers?.[q.id] || '—').slice(0, 1800)}`).join('\n\n');
    const mention = cfg.reviewerMention && cfg.reviewerRoleIds.length ? cfg.reviewerRoleIds.map(id => `<@&${id}>`).join(' ') + '\n' : '';
    const embed = new EmbedBuilder().setColor(0xE8A23D).setTitle(cfg.title).setDescription(`${mention}${lines.slice(0, 3900)}`).addFields({ name: 'Applicant', value: `<@${user.id}>`, inline: true }, { name: 'Application ID', value: `\`${app.id}\``, inline: true }).setFooter({ text: 'Custom Appeals' }).setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(reviewId('accept', guild.id, app.id)).setLabel('✅ Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(reviewId('reject', guild.id, app.id)).setLabel('❌ Reject').setStyle(ButtonStyle.Danger),
    );
    const msg = await ch.send({ content: cfg.notifyReviewer ? mention || undefined : undefined, embeds: [embed], components: [row], allowedMentions: { parse: cfg.notifyReviewer ? ['roles'] : [] } }).catch(() => null);
    if (msg) { app.reviewChannelId = ch.id; app.reviewMessageId = msg.id; }
  }
  saveData(data);
  try { await user.send({ embeds: [new EmbedBuilder().setColor(0x2DE0C4).setTitle('✅ Appeal Submitted').setDescription(cfg.completionMessage)] }); } catch {}
}

async function handleDMMessage(message, deps) {
  if (!message.author || message.author.bot || message.guild) return false;
  const data = deps.loadData();
  const guilds = Object.entries(data.customAppeals || {});
  for (const [guildId, apps] of guilds) {
    for (const app of Object.values(apps || {})) {
      if (!app || app.userId !== message.author.id || app.status !== 'pending' || !app.dmWaitingForAnswer) continue;
      const guild = deps.client.guilds.cache.get(guildId); if (!guild) continue;
      const cfg = getAppealConfig(deps.getGuildSettings(guildId, data));
      const q = cfg.questions[app.currentIndex]; if (!q) continue;
      const answer = String(message.content || '').trim();
      if (answer.length < q.minLength) { await message.channel.send(`❌ Your answer is too short. Minimum: ${q.minLength} characters.`).catch(() => {}); return true; }
      if (answer.length > q.maxLength) { await message.channel.send(`❌ Your answer is too long. Maximum: ${q.maxLength} characters.`).catch(() => {}); return true; }
      app.answers[q.id] = answer; app.dmWaitingForAnswer = false; app.updatedAt = Date.now();
      pushEvent(app, 'answer', message.author.id, { questionId: q.id, answerLength: answer.length });
      if (app.currentIndex + 1 >= cfg.questions.length) await completeAppeal(app, guild, message.author, cfg, data, deps.saveData);
      else { app.currentIndex++; deps.saveData(data); await sendQuestion(app, message.author, guild, cfg); }
      return true;
    }
  }
  return false;
}

async function handleInteraction(interaction, deps) {
  const cid = String(interaction.customId || '');
  if (!cid.startsWith('capp:')) return false;
  const p = cid.split(':');
  const kind = p[1];
  const reviewAction = kind === 'review' ? p[2] : null;
  const guildId = kind === 'review' ? p[3] : p[2];
  const appealId = kind === 'review' ? p[4] : p[3];
  const data = deps.loadData();
  const guild = deps.client.guilds.cache.get(guildId) || interaction.guild;
  const app = guild ? guildStore(data, guildId)[appealId] : null;
  if (!app || app.status !== 'pending') { await interaction.reply({ content: '❌ This appeal is no longer active.', ephemeral: true }).catch(() => {}); return true; }
  const cfg = getAppealConfig(deps.getGuildSettings(guildId, data));
  if (interaction.user.id === app.userId) {
    if (kind === 'begin' || kind === 'answer') {
      if (kind === 'answer') { app.dmWaitingForAnswer = true; deps.saveData(data); await interaction.reply({ content: '✏️ Send your answer as your next DM message.', ephemeral: true }).catch(() => {}); }
      else { app.dmWaitingForAnswer = true; await interaction.reply({ embeds: [questionPromptEmbed(app, interaction.user, guild, cfg)], content: 'Please answer this question in your next DM message.' }).catch(() => {}); deps.saveData(data); }
      return true;
    }
    if (kind === 'choice') {
      const q = cfg.questions[app.currentIndex]; const idx = Number(interaction.values?.[0] || -1); const answer = q?.choices?.[idx];
      if (!q || !answer) { await interaction.reply({ content: '❌ Invalid choice.', ephemeral: true }).catch(() => {}); return true; }
      app.answers[q.id] = answer; app.updatedAt = Date.now(); pushEvent(app, 'answer', interaction.user.id, { questionId: q.id, choice: idx });
      if (app.currentIndex + 1 >= cfg.questions.length) await completeAppeal(app, guild, interaction.user, cfg, data, deps.saveData);
      else { app.currentIndex++; deps.saveData(data); await interaction.reply({ content: '✅ Saved. Check your DMs for the next question.' }).catch(() => {}); await sendQuestion(app, interaction.user, guild, cfg); }
      return true;
    }
    if (kind === 'cancel') {
      if (!cfg.allowCancel) { await interaction.reply({ content: '❌ Cancellation is disabled.', ephemeral: true }).catch(() => {}); return true; }
      app.status = 'withdrawn'; app.updatedAt = Date.now(); pushEvent(app, 'withdrawn', interaction.user.id); deps.saveData(data);
      await interaction.reply({ content: '🛑 Your appeal has been withdrawn.', ephemeral: true }).catch(() => {}); return true;
    }
    if (kind === 'back') {
      if (!cfg.allowBack || app.currentIndex <= 0) { await interaction.reply({ content: '❌ You cannot go back from here.', ephemeral: true }).catch(() => {}); return true; }
      app.currentIndex--; app.dmWaitingForAnswer = true; deps.saveData(data); await interaction.reply({ content: '◀️ Going back one question. Check your DMs.', ephemeral: true }).catch(() => {}); await sendQuestion(app, interaction.user, guild, cfg); return true;
    }
  }
  if (kind === 'review') {
    const member = guild.members.cache.get(interaction.user.id) || await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!isReviewer(member, guildId, data, deps)) { await interaction.reply({ content: '❌ You are not authorized to review appeals.', ephemeral: true }).catch(() => {}); return true; }
    const action = reviewAction;
    if (action === 'accept' || action === 'reject') {
      if (action === 'reject' && cfg.requireRejectReason) {
        const modal = new ModalBuilder().setCustomId(rejectModalId(guildId, appealId)).setTitle('Reject Appeal');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Rejection reason').setStyle(TextInputStyle.Paragraph).setMinLength(1).setMaxLength(1000).setRequired(true)));
        await interaction.showModal(modal).catch(() => {}); return true;
      }
      await decideAppeal({ action, reason: '', guild, member, app, cfg, data, saveData: deps.saveData, interaction }); return true;
    }
  }
  return true;
}

async function handleModalSubmit(interaction, deps) {
  const cid = String(interaction.customId || '');
  if (!cid.startsWith('capp:reject:')) return false;
  const [, , guildId, appealId] = cid.split(':');
  const data = deps.loadData(); const guild = deps.client.guilds.cache.get(guildId); const app = guildStore(data, guildId)[appealId];
  if (!guild || !app) { await interaction.reply({ content: '❌ Appeal not found.', ephemeral: true }).catch(() => {}); return true; }
  const member = guild.members.cache.get(interaction.user.id) || await guild.members.fetch(interaction.user.id).catch(() => null);
  const cfg = getAppealConfig(deps.getGuildSettings(guildId, data));
  if (!isReviewer(member, guildId, data, deps)) { await interaction.reply({ content: '❌ Not authorized.', ephemeral: true }).catch(() => {}); return true; }
  return decideAppeal({ action: 'reject', reason: interaction.fields.getTextInputValue('reason'), guild, member, app, cfg, data, saveData: deps.saveData, interaction }).then(() => true);
}

async function decideAppeal({ action, reason, guild, member, app, cfg, data, saveData, interaction }) {
  app.reviewStatus = action === 'accept' ? 'accepted' : 'rejected';
  app.status = app.reviewStatus; app.reviewedAt = Date.now(); app.reviewedBy = member.id; app.reviewReason = reason || ''; app.updatedAt = Date.now();
  pushEvent(app, action, member.id, { reason: reason || null });
  saveData(data);
  if (app.reviewMessageId && app.reviewChannelId) {
    const ch = guild.channels.cache.get(app.reviewChannelId);
    const msg = ch?.isTextBased?.() ? await ch.messages.fetch(app.reviewMessageId).catch(() => null) : null;
    if (msg) await msg.edit({ components: [], content: `✅ Appeal ${action}d by <@${member.id}>.` }).catch(() => {});
  }
  if (cfg.decisionDm) {
    const user = await guild.client.users.fetch(app.userId).catch(() => null);
    if (user) {
      const text = action === 'accept' ? cfg.acceptedMessage : renderTemplate(cfg.rejectedMessage, { reason: reason || 'No reason supplied' });
      await user.send({ embeds: [new EmbedBuilder().setColor(action === 'accept' ? 0x4ADE80 : 0xFF6B5E).setTitle(action === 'accept' ? '✅ Appeal Accepted' : '❌ Appeal Rejected').setDescription(text)] }).catch(() => {});
    }
  }
  if (interaction) await interaction.reply({ content: `✅ Appeal ${action}ed.`, ephemeral: true }).catch(() => {});
  return app;
}

async function handleCommand(interaction, deps) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'appeal') return false;
  let sub = '';
  try { sub = interaction.options.getSubcommand(); } catch { return false; }
  const guildId = interaction.guildId;
  if (!guildId || !interaction.guild) { await interaction.reply({ content: '❌ This command must be used in a server.', ephemeral: true }).catch(() => {}); return true; }
  const data = deps.loadData(); const gs = deps.getGuildSettings(guildId, data); const cfg = getAppealConfig(gs);
  if (sub === 'formstatus') {
    const c = stats(data, guildId);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2DE0C4).setTitle('📩 Custom Appeal Form').setDescription(`Enabled: **${cfg.enabled ? 'YES' : 'NO'}**\nQuestions: **${cfg.questions.length}**\nReview channel: ${cfg.channelId ? `<#${cfg.channelId}>` : 'not configured'}\nReviewers: **${cfg.reviewerRoleIds.length}**\n\nPending: **${c.pending}**\nAccepted: **${c.accepted}**\nRejected: **${c.rejected}**\nWithdrawn: **${c.withdrawn}**\nAcceptance rate: **${c.acceptanceRate}%**`)] , ephemeral: true }).catch(() => {});
    return true;
  }
  if (sub === 'form') {
    const result = await startAppeal({ guild: interaction.guild, user: interaction.user, data, gs, saveData: deps.saveData, source: 'slash' });
    if (result.error) await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true }).catch(() => {});
    else await interaction.reply({ content: '📨 Check your DMs to continue your custom appeal.', ephemeral: true }).catch(() => {});
    return true;
  }
  if (sub === 'formtoggle') {
    const admin = deps.isAdmin ? deps.isAdmin(interaction, guildId, data) : (interaction.member?.permissions?.has(PermissionFlagsBits.Administrator) || deps.isManagerMember?.(interaction.member,guildId,data) || deps.isSuperUser?.(interaction.user.id));
    if (!admin) { await interaction.reply({ content: '❌ Administrators/bot managers only.', ephemeral: true }).catch(() => {}); return true; }
    cfg.enabled = !cfg.enabled; gs.customAppeals = cfg; deps.saveData(data);
    await interaction.reply({ content: `${cfg.enabled ? '✅' : '🛑'} Custom appeal form ${cfg.enabled ? 'enabled' : 'disabled'} for this server.`, ephemeral: true }).catch(() => {}); return true;
  }
  return false;
}

async function handlePrefix(message, cmd, args, deps) {
  if (cmd !== 'appealform') return false;
  const guildId = message.guild?.id; if (!guildId) return false;
  const data = deps.loadData(); const gs = deps.getGuildSettings(guildId,data); const cfg = getAppealConfig(gs);
  const sub = String(args.shift() || 'status').toLowerCase();
  if (sub === 'status') { const c=stats(data,guildId); await message.channel.send(`📩 Custom Appeal Form — ${cfg.enabled?'enabled':'disabled'} | Pending ${c.pending} | Accepted ${c.accepted} | Rejected ${c.rejected} | Withdrawn ${c.withdrawn}`).catch(()=>{}); return true; }
  const admin = message.member?.permissions?.has(PermissionFlagsBits.Administrator) || deps.isManagerMember?.(message.member,guildId,data) || deps.isSuperUser?.(message.author.id);
  if (!admin) { await message.channel.send('❌ Administrators/bot managers only.').catch(()=>{}); return true; }
  if (sub === 'enable' || sub === 'disable' || sub === 'toggle') { cfg.enabled = sub==='toggle' ? !cfg.enabled : sub==='enable'; gs.customAppeals=cfg; deps.saveData(data); await message.channel.send(`${cfg.enabled?'✅':'🛑'} Custom appeal form ${cfg.enabled?'enabled':'disabled'}.`).catch(()=>{}); return true; }
  if (sub === 'open') { const result=await startAppeal({guild:message.guild,user:message.author,data,gs,saveData:deps.saveData,source:'prefix'}); await message.channel.send(result.error?`❌ ${result.error}`:`✅ Check your DMs to complete appeal \`${result.application?.id || result.appeal?.id || 'created'}\`.`).catch(()=>{}); return true; }
  return true;
}

function sweep(data, client, getGuildSettings, saveData) {
  let changed = false; const now = Date.now();
  for (const [guildId, store] of Object.entries(data.customAppeals || {})) {
    const guild = client.guilds.cache.get(guildId); if (!guild) continue;
    const cfg = getAppealConfig(getGuildSettings(guildId, data));
    for (const app of Object.values(store || {})) {
      if (!app || app.status !== 'pending') continue;
      if (app.expiresAt && app.expiresAt <= now) {
        app.status = 'withdrawn'; app.reviewStatus = 'expired'; app.reviewedAt = now; app.updatedAt = now; pushEvent(app, 'expired'); changed = true;
        client.users.fetch(app.userId).then(u => u.send({ content: '⌛ Your appeal form expired before it was submitted or reviewed.' }).catch(() => {})).catch(() => {});
      }
    }
  }
  if (changed) saveData?.(data); return changed;
}

function exportData(data, guildId) {
  return Object.values(guildStore(data, guildId)).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).map(a=>({...a, events:Array.isArray(a.events)?a.events.slice(-100):[]}));
}

function configForDashboard(gs) { return normalizeConfig(gs?.customAppeals); }

const slashCommandBuilders = [];
const prefixCommands = new Set(['appealform']);

function augmentExistingAppealBuilder(builder) {
  // Kept as a helper for integrations that want to attach form actions to an
  // existing /appeal builder. The current bot can also use the standalone
  // /appealform route when command consolidation is preferred.
  return builder;
}

module.exports = {
  STATUS, QUESTION_TYPES, DEFAULT_CONFIG, normalizeQuestion, normalizeConfig,
  getAppealConfig, ensureStore, guildStore, stats, startAppeal, handleInteraction,
  handleModalSubmit, handleDMMessage, handleCommand, handlePrefix, sweep, configForDashboard, renderTemplate,
  isReviewer, decideAppeal, augmentExistingAppealBuilder, slashCommandBuilders,
  prefixCommands, exportData,
};
