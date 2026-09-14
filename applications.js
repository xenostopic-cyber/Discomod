'use strict';

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ActionRowBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    PermissionFlagsBits,
} = require('discord.js');

const APP_STATUSES = Object.freeze(['active', 'completed', 'cancelled', 'snoozed']);
const QUESTION_TYPES = Object.freeze(['short', 'paragraph', 'choice']);
const DEFAULT_CONFIG = Object.freeze({
    enabled: false,
    applyChannelId: null,
    reviewChannelId: null,
    reviewerRoleIds: [],
    timeLimitMinutes: 60,
    snoozeMinutes: 60,
    reviewSnoozeMinutes: 30,
    maxActivePerUser: 1,
    allowCancel: true,
    allowSnooze: true,
    decisionDm: true,
    requireRejectReason: true,
    acceptedRoleId: null,
    rejectedRoleId: null,
    reviewerMention: true,
    decisionChannelId: null,
    deleteReviewMessageAfterDecision: false,
    allowReviewerSnooze: true,
    formTitle: '📋 Server Application',
    formDescription: 'Complete the application in your DMs. Your answers are sent privately to the server review team.',
    applicationButtonLabel: 'Start Application',
    questionButtonLabel: 'Answer',
    snoozeButtonLabel: 'Snooze',
    cancelButtonLabel: 'Cancel',
    answerPlaceholder: 'Type your answer here…',
    reviewStatusPrefix: 'Application',
    reviewActions: { accept: true, reject: true, snooze: true },
    dmIntro: '👋 **Application started!**\n\nPlease answer the questions below. You can cancel or snooze at any time.',
    dmComplete: '✅ **Application submitted!**\n\nYour application is now waiting for staff review.',
    dmCancelled: '🛑 **Application cancelled.**\n\nYou can start a new application later.',
    dmSnoozed: '⏸️ **Application snoozed.**\n\nIt will resume automatically when the snooze period ends.',
    dmResumed: '▶️ **Application resumed.**\n\nLet’s continue where you left off.',
    dmExpired: '⌛ **Application timed out.**\n\nYour application was closed because the time limit expired. You may start another one.',
    acceptedDm: '✅ **Application accepted!**\n\nThank you for applying.',
    rejectedDm: '❌ **Application declined.**\n\nReason: {reason}',
    reviewTitle: '📋 New Application',
    reviewFooter: 'DISCOMOD Applications',
    questions: [
        { id: 'q1', prompt: 'Why would you like to join the staff/team?', type: 'paragraph', required: true, maxLength: 1500, choices: [] },
        { id: 'q2', prompt: 'How active are you usually?', type: 'choice', required: true, maxLength: 200, choices: ['Very active', 'Active', 'Sometimes active', 'Rarely active'] },
        { id: 'q3', prompt: 'Tell us a little about yourself.', type: 'paragraph', required: true, maxLength: 1500, choices: [] },
    ],
});

function cloneConfig(src) {
    const base = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const cur = (src && typeof src === 'object') ? src : {};
    const merged = { ...base, ...cur };
    merged.reviewerRoleIds = Array.isArray(cur.reviewerRoleIds) ? [...new Set(cur.reviewerRoleIds.map(String))] : [];
    merged.reviewActions = { ...base.reviewActions, ...(cur.reviewActions || {}) };
    merged.questions = Array.isArray(cur.questions) ? cur.questions.map(normalizeQuestion).filter(Boolean) : base.questions.map(normalizeQuestion);
    if (!merged.questions.length) merged.questions = base.questions.map(normalizeQuestion);
    return merged;
}

function normalizeQuestion(q, index = 0) {
    if (!q || typeof q !== 'object') return null;
    const id = String(q.id || `q${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50) || `q${index + 1}`;
    const prompt = String(q.prompt || '').trim().slice(0, 1000);
    if (!prompt) return null;
    const type = QUESTION_TYPES.includes(q.type) ? q.type : 'paragraph';
    const choices = Array.isArray(q.choices) ? q.choices.map(String).map(s => s.trim()).filter(Boolean).slice(0, 25) : [];
    const minLength = Math.max(0, Math.min(4000, Number(q.minLength) || 0));
    const placeholder = String(q.placeholder || '').trim().slice(0, 100);
    const emoji = String(q.emoji || '').trim().slice(0, 8);
    return {
        id,
        prompt,
        type,
        required: q.required !== false,
        minLength: Math.min(minLength, Math.max(1, Math.min(4000, Number(q.maxLength) || (type === 'short' ? 300 : 1500)))),
        maxLength: Math.max(1, Math.min(4000, Number(q.maxLength) || (type === 'short' ? 300 : 1500))),
        placeholder,
        emoji,
        choices: type === 'choice' ? choices : [],
    };
}

function getApplicationConfig(gs) {
    gs.applications = cloneConfig(gs.applications);
    return gs.applications;
}

function ensureStore(data) {
    data.applications = data.applications && typeof data.applications === 'object' ? data.applications : {};
    return data.applications;
}

function guildApplications(data, guildId) {
    const store = ensureStore(data);
    store[guildId] = store[guildId] && typeof store[guildId] === 'object' ? store[guildId] : {};
    return store[guildId];
}

function newId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function findByUser(data, guildId, userId, includeClosed = false) {
    const apps = guildApplications(data, guildId);
    const all = Object.values(apps).filter(a => a && a.userId === String(userId));
    return includeClosed ? all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)) :
        all.find(a => ['active', 'snoozed'].includes(a.status));
}

function counts(data, guildId) {
    const apps = Object.values(guildApplications(data, guildId));
    const out = { active: 0, completed: 0, cancelled: 0, snoozed: 0, total: 0 };
    for (const a of apps) {
        if (!a || !APP_STATUSES.includes(a.status)) continue;
        out[a.status]++; out.total++;
    }
    return out;
}

function renderTemplate(text, vars = {}) {
    return String(text || '').replace(/\{([a-zA-Z]+)\}/g, (full, key) => vars[key] == null ? full : String(vars[key]));
}

function pushEvent(app, type, actorId = null, meta = {}) {
    if (!Array.isArray(app.events)) app.events = [];
    app.events.push({ type: String(type), actorId: actorId ? String(actorId) : null, at: Date.now(), ...meta });
    if (app.events.length > 100) app.events = app.events.slice(-100);
}

function applicationTiming(app) {
    const created = Number(app.createdAt) || 0;
    const submitted = Number(app.submittedAt) || 0;
    const reviewed = Number(app.reviewedAt) || 0;
    return {
        ageMs: created ? Math.max(0, Date.now() - created) : 0,
        completionMs: submitted && created ? Math.max(0, submitted - created) : null,
        reviewMs: reviewed && submitted ? Math.max(0, reviewed - submitted) : null,
        remainingMs: app.expiresAt ? Math.max(0, app.expiresAt - Date.now()) : (Number(app.remainingMs) || null),
        snoozedRemainingMs: app.snoozedUntil ? Math.max(0, app.snoozedUntil - Date.now()) : null,
    };
}

function applicationAnalytics(data, guildId) {
    const apps = Object.values(guildApplications(data, guildId)).filter(Boolean);
    const out = counts(data, guildId);
    const completedTimes = apps.filter(a => a.submittedAt && a.createdAt).map(a => a.submittedAt - a.createdAt).filter(Number.isFinite);
    const reviewTimes = apps.filter(a => a.reviewedAt && a.submittedAt).map(a => a.reviewedAt - a.submittedAt).filter(Number.isFinite);
    const median = arr => { if (!arr.length) return null; const x=[...arr].sort((a,b)=>a-b); const m=Math.floor(x.length/2); return x.length%2?x[m]:(x[m-1]+x[m])/2; };
    const avg = arr => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : null;
    const now = Date.now();
    const daily = {};
    for (const a of apps) { const d = new Date(a.createdAt || now).toISOString().slice(0,10); daily[d] = (daily[d] || 0) + 1; }
    const recentDays = Object.entries(daily).sort(([a],[b])=>a.localeCompare(b)).slice(-30).map(([date,count])=>({date,count}));
    const completionRate = out.total ? Math.round((apps.filter(a=>a.reviewStatus==='accepted').length / out.total) * 1000) / 10 : 0;
    return { ...out, accepted: apps.filter(a=>a.reviewStatus==='accepted').length, rejected: apps.filter(a=>a.reviewStatus==='rejected').length, pendingReview: apps.filter(a=>a.status==='completed' && (!a.reviewStatus || a.reviewStatus==='pending')).length, completionRate, averageCompletionMs: avg(completedTimes), medianCompletionMs: median(completedTimes), averageReviewMs: avg(reviewTimes), medianReviewMs: median(reviewTimes), recentDaily: recentDays, lastUpdatedAt: now };
}

function isReviewer(member, guildId, data, deps) {
    if (!member) return false;
    if (deps.isSuperUser?.(member.id)) return true;
    if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
    if (deps.isManagerMember?.(member, guildId, data)) return true;
    const cfg = getApplicationConfig(deps.getGuildSettings(guildId, data));
    return cfg.reviewerRoleIds.some(id => member.roles?.cache?.has(id));
}

function appAnswerCustomId(guildId, appId, qid) { return `app:answer:${guildId}:${appId}:${qid}`; }
function appChoiceCustomId(guildId, appId, qid) { return `app:choice:${guildId}:${appId}:${qid}`; }
function appSnoozeCustomId(guildId, appId) { return `app:snooze:${guildId}:${appId}`; }
function appCancelCustomId(guildId, appId) { return `app:cancel:${guildId}:${appId}`; }
function appResumeCustomId(guildId, appId) { return `app:resume:${guildId}:${appId}`; }
function reviewCustomId(action, guildId, appId) { return `app:review:${action}:${guildId}:${appId}`; }
function reviewRejectModalId(guildId, appId) { return `app:review-reject:${guildId}:${appId}`; }

async function sendCurrentQuestion(app, user, guild, cfg) {
    const q = cfg.questions[app.currentIndex];
    if (!q) return null;
    const vars = { user: `<@${user.id}>`, username: user.username, server: guild.name };
    const embed = new EmbedBuilder()
        .setColor(0x2DE0C4)
        .setTitle(`${q.emoji ? q.emoji + ' ' : '📝 '}${renderTemplate(q.prompt, vars)}`)
        .setDescription(`Question ${app.currentIndex + 1} of ${cfg.questions.length}${cfg.formDescription ? `\n\n${renderTemplate(cfg.formDescription, vars)}` : ''}`)
        .addFields(
            { name: 'Type', value: q.type === 'choice' ? 'Choose one option below' : (q.type === 'short' ? 'Short answer' : 'Long answer'), inline: true },
            { name: 'Required', value: q.required ? 'Yes' : 'No', inline: true },
        )
        .setFooter({ text: `Application ID ${app.id} • ${Math.max(0, Math.ceil(((app.expiresAt || Date.now()) - Date.now()) / 60000))}m remaining${q.minLength ? ` • minimum ${q.minLength} chars` : ''}` });

    if (q.type === 'choice') {
        const menu = new StringSelectMenuBuilder().setCustomId(appChoiceCustomId(guild.id, app.id, q.id)).setPlaceholder('Choose an answer…').addOptions(
            q.choices.map((choice, i) => new StringSelectMenuOptionBuilder().setLabel(choice.slice(0, 100)).setValue(String(i)))
        );
        return user.send({ embeds: [embed], components: [
            new ActionRowBuilder().addComponents(menu),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(appSnoozeCustomId(guild.id, app.id)).setLabel((cfg.snoozeButtonLabel || 'Snooze').slice(0, 80)).setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(appCancelCustomId(guild.id, app.id)).setLabel((cfg.cancelButtonLabel || 'Cancel').slice(0, 80)).setStyle(ButtonStyle.Danger),
            ),
        ]});
    }

    return user.send({ embeds: [embed], components: [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(appAnswerCustomId(guild.id, app.id, q.id)).setLabel((cfg.questionButtonLabel || 'Answer').slice(0, 80)).setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(appSnoozeCustomId(guild.id, app.id)).setLabel((cfg.snoozeButtonLabel || 'Snooze').slice(0, 80)).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(appCancelCustomId(guild.id, app.id)).setLabel((cfg.cancelButtonLabel || 'Cancel').slice(0, 80)).setStyle(ButtonStyle.Danger),
        ),
    ]});
}

async function startApplication({ guild, user, data, gs, saveData, sourceChannelId = null }) {
    const cfg = getApplicationConfig(gs);
    if (!cfg.enabled) return { error: 'Applications are currently disabled on this server.' };
    if (cfg.applyChannelId && sourceChannelId && String(cfg.applyChannelId) !== String(sourceChannelId)) {
        return { error: `Applications must be started in <#${cfg.applyChannelId}>.` };
    }
    const existing = findByUser(data, guild.id, user.id);
    if (existing) return { error: `You already have an application in **${existing.status}** state (ID \`${existing.id}\`).` };

    const appsForGuild = guildApplications(data, guild.id);
    const activeCount = Object.values(appsForGuild).filter(a => a?.userId === user.id && ['active', 'snoozed'].includes(a.status)).length;
    if (activeCount >= cfg.maxActivePerUser) return { error: 'You already have the maximum number of active applications.' };

    let dm;
    try { dm = await user.createDM(); } catch { return { error: 'I could not open your DMs. Please enable DMs from server members and try again.' }; }

    const now = Date.now();
    const app = {
        id: newId(), guildId: guild.id, userId: user.id,
        status: 'active', currentIndex: 0, answers: {}, createdAt: now, updatedAt: now,
        expiresAt: now + cfg.timeLimitMinutes * 60 * 1000,
        snoozedUntil: null, remainingMs: null, snoozeKind: null,
        reviewStatus: 'pending', reviewedBy: null, reviewReason: null,
        reviewMessageId: null, reviewChannelId: null,
        submittedAt: null, reviewedAt: null, cancelReason: null,
        events: [],
        version: 1,
    };
    pushEvent(app, 'created', user.id, { sourceChannelId: sourceChannelId || null });
    appsForGuild[app.id] = app;
    saveData(data);

    const intro = new EmbedBuilder().setColor(0x2DE0C4).setTitle(cfg.formTitle || '📋 Application Started')
        .setDescription(renderTemplate(cfg.dmIntro, { user: `<@${user.id}>`, username: user.username, server: guild.name }))
        .setFooter({ text: `Time limit: ${cfg.timeLimitMinutes} minutes • Application ${app.id}` });
    await dm.send({ embeds: [intro] });
    await sendCurrentQuestion(app, user, guild, cfg);
    return { ok: true, app };
}

async function answerQuestion({ app, guild, user, data, gs, saveData, answer }) {
    const cfg = getApplicationConfig(gs);
    if (app.status !== 'active') return { error: `This application is ${app.status}.` };
    if (app.expiresAt && Date.now() > app.expiresAt) {
        app.status = 'cancelled';
        app.updatedAt = Date.now();
        saveData(data);
        return { error: 'This application timed out. Start a new one with /application apply.' };
    }
    const q = cfg.questions[app.currentIndex];
    if (!q) return { error: 'Application question data is unavailable.' };
    const value = String(answer ?? '').trim();
    if (q.required && !value) return { error: 'This question is required.' };
    if (value.length < (q.minLength || 0)) return { error: `That answer is too short. Minimum: ${q.minLength} characters.` };
    if (value.length > q.maxLength) return { error: `That answer is too long. Maximum: ${q.maxLength} characters.` };
    if (q.type === 'choice' && !q.choices.includes(value)) return { error: 'Please choose one of the listed options.' };
    app.answers[q.id] = value;
    pushEvent(app, 'answer', user.id, { questionId: q.id, questionIndex: app.currentIndex });
    app.currentIndex++;
    app.updatedAt = Date.now();
    if (app.currentIndex >= cfg.questions.length) {
        app.status = 'completed';
        app.submittedAt = Date.now();
        pushEvent(app, 'submitted', user.id);
        app.expiresAt = null;
        saveData(data);
        await user.send({ embeds: [new EmbedBuilder().setColor(0x4ADE80).setTitle('✅ Application Submitted').setDescription(renderTemplate(cfg.dmComplete, { server: guild.name, user: `<@${user.id}>` }))] }).catch(() => {});
        await submitForReview({ app, guild, user, data, gs, cfg, saveData });
        return { ok: true, completed: true };
    }
    saveData(data);
    await sendCurrentQuestion(app, user, guild, cfg);
    return { ok: true, completed: false };
}

async function submitForReview({ app, guild, user, data, gs, cfg, saveData }) {
    const channelId = cfg.reviewChannelId || gs.logChannelId || gs.appealsChannelId;
    const channel = channelId ? guild.channels.cache.get(channelId) : null;
    if (!channel?.isTextBased?.()) return { error: 'No review channel is configured; application was saved as completed.' };

    const lines = [];
    for (let i = 0; i < cfg.questions.length; i++) {
        const q = cfg.questions[i];
        const ans = app.answers[q.id] || '—';
        lines.push(`**${i + 1}. ${q.prompt}**\n${ans}`);
    }
    const embed = new EmbedBuilder()
        .setColor(0xE8A23D)
        .setTitle(cfg.reviewTitle || '📋 New Application')
        .setDescription(`Applicant: <@${user.id}>\nApplication ID: \`${app.id}\`\n\n${lines.join('\n\n').slice(0, 4000)}`)
        .setFooter({ text: cfg.reviewFooter || 'DISCOMOD Applications' })
        .setTimestamp();
    const buttons = [];
    if (cfg.reviewActions.accept) buttons.push(new ButtonBuilder().setCustomId(reviewCustomId('accept', guild.id, app.id)).setLabel('Accept').setStyle(ButtonStyle.Success));
    if (cfg.reviewActions.reject) buttons.push(new ButtonBuilder().setCustomId(reviewCustomId('reject', guild.id, app.id)).setLabel('Reject').setStyle(ButtonStyle.Danger));
    if (cfg.reviewActions.snooze) buttons.push(new ButtonBuilder().setCustomId(reviewCustomId('snooze', guild.id, app.id)).setLabel((cfg.snoozeButtonLabel || 'Snooze').slice(0, 80)).setStyle(ButtonStyle.Secondary));
    try {
        const sent = await channel.send({ content: cfg.reviewerRoleIds.length ? cfg.reviewerRoleIds.map(id => `<@&${id}>`).join(' ') : undefined, embeds: [embed], components: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [] });
        app.reviewMessageId = sent.id;
        app.reviewChannelId = channel.id;
        saveData(data);
        return { ok: true };
    } catch (e) {
        return { error: `Could not send the application to the review channel: ${e.message}` };
    }
}

async function reviewApplication({ action, guild, member, app, data, gs, saveData, reason, ctx }) {
    const cfg = getApplicationConfig(gs);
    if (!ctx || !isReviewer(member, guild.id, data, ctx)) {
        return { error: 'You do not have permission to review applications.' };
    }
    if (action !== 'snooze' && !['completed', 'snoozed'].includes(app.status)) return { error: `Application is currently ${app.status}.` };
    if (action === 'snooze') {
        if (!cfg.allowReviewerSnooze) return { error: 'Reviewer snoozing is disabled for this server.' };
        app.status = 'snoozed';
        app.snoozeKind = 'review';
        app.updatedAt = Date.now();
        app.snoozedUntil = Date.now() + cfg.reviewSnoozeMinutes * 60 * 1000;
        pushEvent(app, 'snoozed', member.id, { kind: 'review', durationMs: cfg.reviewSnoozeMinutes * 60000 });
        app.remainingMs = null;
        saveData(data);
        const user = await guild.client.users.fetch(app.userId).catch(() => null);
        if (user) await user.send({ embeds: [new EmbedBuilder().setColor(0xE8A23D).setTitle('⏸️ Application Snoozed').setDescription(cfg.dmSnoozed)] }).catch(() => {});
        return { ok: true };
    }
    app.reviewStatus = action === 'accept' ? 'accepted' : 'rejected';
    app.status = 'completed';
    app.reviewedBy = member.id;
    app.reviewedAt = Date.now();
    app.reviewReason = reason || null;
    pushEvent(app, action === 'accept' ? 'accepted' : 'rejected', member.id, { reason: reason || null });
    app.updatedAt = Date.now();
    saveData(data);
    const user = await guild.client.users.fetch(app.userId).catch(() => null);
    if (action === 'accept' && cfg.acceptedRoleId) { const memberTarget = await guild.members.fetch(app.userId).catch(() => null); if (memberTarget?.roles?.add) await memberTarget.roles.add(cfg.acceptedRoleId, 'Application accepted').catch(() => {}); }
    if (action === 'reject' && cfg.rejectedRoleId) { const memberTarget = await guild.members.fetch(app.userId).catch(() => null); if (memberTarget?.roles?.add) await memberTarget.roles.add(cfg.rejectedRoleId, 'Application rejected').catch(() => {}); }
    if (user && cfg.decisionDm) {
        const text = action === 'accept' ? cfg.acceptedDm : renderTemplate(cfg.rejectedDm, { reason: reason || 'No reason provided.' });
        await user.send({ embeds: [new EmbedBuilder().setColor(action === 'accept' ? 0x4ADE80 : 0xFF6B5E).setTitle(action === 'accept' ? '✅ Application Accepted' : '❌ Application Declined').setDescription(text)] }).catch(() => {});
    }
    return { ok: true };
}

async function handleInteraction(interaction, ctx) {
    const cid = String(interaction.customId || '');
    if (!cid.startsWith('app:')) return false;
    const data = ctx.loadData();
    const pieces = cid.split(':');
    const kind = pieces[1];
    const guildId = pieces[2];
    const appId = pieces[3];
    const qid = pieces[4];
    const guild = ctx.client.guilds.cache.get(guildId);
    if (!guild) { await interaction.reply({ content: '❌ The server for this application no longer exists.', flags: 64 }).catch(() => {}); return true; }
    const gs = ctx.getGuildSettings(guildId, data);
    const cfg = getApplicationConfig(gs);
    const app = guildApplications(data, guildId)[appId];
    if (!app) { await interaction.reply({ content: '❌ Application not found.', flags: 64 }).catch(() => {}); return true; }

    const user = await ctx.client.users.fetch(app.userId).catch(() => null);
    if (!user) { await interaction.reply({ content: '❌ Applicant account could not be found.', flags: 64 }).catch(() => {}); return true; }

    if (kind === 'answer') {
        const q = cfg.questions.find(x => x.id === qid);
        if (!q) { await interaction.reply({ content: '❌ That question no longer exists. Ask staff to check the form builder.', flags: 64 }).catch(() => {}); return true; }
        const modal = new ModalBuilder().setCustomId(appAnswerCustomId(guildId, appId, qid)).setTitle(`Answer ${Math.min(cfg.questions.length, app.currentIndex + 1)}`);
        const input = new TextInputBuilder().setCustomId('answer').setLabel(q.prompt.slice(0, 45)).setStyle(q.type === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph).setRequired(q.required).setMinLength(Math.min(4000, q.minLength || 0)).setMaxLength(Math.min(4000, q.maxLength)).setPlaceholder((q.placeholder || 'Type your answer here…').slice(0, 100));
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal).catch(() => {});
        return true;
    }

    if (kind === 'choice') {
        const q = cfg.questions.find(x => x.id === qid);
        const index = Number(interaction.values?.[0]);
        if (!q || !Number.isInteger(index) || !q.choices[index]) {
            await interaction.reply({ content: '❌ That option is no longer valid.', flags: 64 }).catch(() => {});
            return true;
        }
        await interaction.deferUpdate().catch(() => {});
        const result = await answerQuestion({ app, guild, user, data, gs, saveData: ctx.saveData, answer: q.choices[index] });
        if (result.error) await user.send(`❌ ${result.error}`).catch(() => {});
        return true;
    }

    if (kind === 'answer') return true;

    if (kind === 'snooze' || kind === 'cancel' || kind === 'resume') {
        await interaction.deferUpdate().catch(() => {});
        if (app.userId !== interaction.user.id) return true;
        if (kind === 'cancel') {
            if (!cfg.allowCancel) { await user.send('❌ Cancelling applications is disabled on this server.').catch(() => {}); return true; }
            app.status = 'cancelled'; app.snoozeKind = null; app.updatedAt = Date.now(); app.cancelReason = 'user'; pushEvent(app, 'cancelled', user.id, { reason: 'user' });
            app.expiresAt = null; app.snoozedUntil = null;
            ctx.saveData(data);
            await user.send({ embeds: [new EmbedBuilder().setColor(0xFF6B5E).setTitle('🛑 Application Cancelled').setDescription(cfg.dmCancelled)] }).catch(() => {});
            return true;
        }
        if (kind === 'snooze') {
            if (!cfg.allowSnooze || app.status !== 'active') { await user.send('❌ This application cannot be snoozed right now.').catch(() => {}); return true; }
            app.status = 'snoozed'; app.snoozeKind = 'applicant'; pushEvent(app, 'snoozed', user.id, { kind: 'applicant', durationMs: cfg.snoozeMinutes * 60000 }); app.remainingMs = Math.max(0, (app.expiresAt || Date.now()) - Date.now());
            app.snoozedUntil = Date.now() + cfg.snoozeMinutes * 60 * 1000;
            app.expiresAt = null; app.updatedAt = Date.now();
            ctx.saveData(data);
            await user.send({ embeds: [new EmbedBuilder().setColor(0xE8A23D).setTitle('⏸️ Application Snoozed').setDescription(cfg.dmSnoozed)] }).catch(() => {});
            return true;
        }
        if (kind === 'resume') {
            if (app.status !== 'snoozed') { await user.send('❌ This application is not snoozed.').catch(() => {}); return true; }
            const remaining = Math.max(0, Number(app.remainingMs) || (cfg.timeLimitMinutes * 60 * 1000));
            app.status = 'active'; app.snoozeKind = null; pushEvent(app, 'resumed', user.id, { remainingMs: remaining }); app.expiresAt = Date.now() + remaining; app.snoozedUntil = null; app.remainingMs = null; app.updatedAt = Date.now();
            ctx.saveData(data);
            await user.send({ embeds: [new EmbedBuilder().setColor(0x2DE0C4).setTitle('▶️ Application Resumed').setDescription(cfg.dmResumed)] }).catch(() => {});
            await sendCurrentQuestion(app, user, guild, cfg).catch(() => {});
            return true;
        }
    }

    if (kind === 'review') {
        const action = pieces[2];
        const reviewGuildId = pieces[3];
        const reviewAppId = pieces[4];
        const reviewGuild = ctx.client.guilds.cache.get(reviewGuildId);
        const reviewData = ctx.loadData();
        const reviewGs = ctx.getGuildSettings(reviewGuildId, reviewData);
        const reviewApp = guildApplications(reviewData, reviewGuildId)[reviewAppId];
        if (!reviewGuild || !reviewApp) return true;
        const member = reviewGuild.members.cache.get(interaction.user.id) || await reviewGuild.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !isReviewer(member, reviewGuildId, reviewData, ctx)) {
            await interaction.reply({ content: '❌ You do not have permission to review applications.', flags: 64 }).catch(() => {});
            return true;
        }
        if (action === 'reject' && getApplicationConfig(reviewGs).requireRejectReason) {
            const modal = new ModalBuilder().setCustomId(reviewRejectModalId(reviewGuildId, reviewAppId)).setTitle('Reject application');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)
            ));
            await interaction.showModal(modal).catch(() => {});
            return true;
        }
        const result = await reviewApplication({ action, guild: reviewGuild, member, app: reviewApp, data: reviewData, gs: reviewGs, saveData: ctx.saveData, reason: null, ctx });
        if (result.error) await interaction.reply({ content: `❌ ${result.error}`, flags: 64 }).catch(() => {});
        else await interaction.update({ components: [], content: `✅ Application ${action}d by <@${interaction.user.id}>.` }).catch(() => {});
        return true;
    }

    if (cid.startsWith('app:review-reject:') && interaction.isModalSubmit?.()) {
        return true;
    }

    return false;
}

async function handleModalSubmit(interaction, ctx) {
    const cid = String(interaction.customId || '');
    if (!cid.startsWith('app:answer:') && !cid.startsWith('app:review-reject:')) return false;
    const parts = cid.split(':');
    if (cid.startsWith('app:answer:')) {
        const [, , guildId, appId, qid] = parts;
        const data = ctx.loadData();
        const guild = ctx.client.guilds.cache.get(guildId);
        if (!guild) { await interaction.reply({ content: '❌ Server unavailable.', flags: 64 }).catch(() => {}); return true; }
        const gs = ctx.getGuildSettings(guildId, data);
        const cfg = getApplicationConfig(gs);
        const app = guildApplications(data, guildId)[appId];
        const user = await ctx.client.users.fetch(app?.userId).catch(() => null);
        if (!app || !user || app.userId !== interaction.user.id) { await interaction.reply({ content: '❌ This application does not belong to you.', flags: 64 }).catch(() => {}); return true; }
        const q = cfg.questions.find(x => x.id === qid);
        if (!q) { await interaction.reply({ content: '❌ Question no longer exists.', flags: 64 }).catch(() => {}); return true; }
        const result = await answerQuestion({ app, guild, user, data, gs, saveData: ctx.saveData, answer: interaction.fields.getTextInputValue('answer') });
        if (result.error) {
            await interaction.reply({ content: `❌ ${result.error}`, flags: 64 }).catch(() => {});
        } else {
            await interaction.reply({ content: result.completed ? '✅ Application submitted. Check your DMs for the next steps.' : '✅ Answer saved. Check your DMs for the next question.', flags: 64 }).catch(() => {});
        }
        return true;
    }

    if (cid.startsWith('app:review-reject:')) {
        const [, , guildId, appId] = parts;
        const data = ctx.loadData();
        const guild = ctx.client.guilds.cache.get(guildId);
        const gs = guild ? ctx.getGuildSettings(guildId, data) : null;
        const app = guild ? guildApplications(data, guildId)[appId] : null;
        const member = guild ? (guild.members.cache.get(interaction.user.id) || await guild.members.fetch(interaction.user.id).catch(() => null)) : null;
        if (!guild || !gs || !app || !member || !isReviewer(member, guildId, data, ctx)) {
            await interaction.reply({ content: '❌ You do not have permission to review applications.', flags: 64 }).catch(() => {});
            return true;
        }
        const reason = interaction.fields.getTextInputValue('reason').trim();
        const result = await reviewApplication({ action: 'reject', guild, member, app, data, gs, saveData: ctx.saveData, reason, ctx });
        if (result.error) await interaction.reply({ content: `❌ ${result.error}`, flags: 64 }).catch(() => {});
        else await interaction.reply({ content: '✅ Application rejected and applicant notified.', flags: 64 }).catch(() => {});
        return true;
    }
    return false;
}

async function handleDMMessage(message, ctx) {
    if (!message || message.author?.bot || message.guild) return false;
    const data = ctx.loadData();
    let found = null;
    let guild = null;
    let gs = null;
    for (const guildId of Object.keys(data.applications || {})) {
        const app = findByUser(data, guildId, message.author.id);
        if (app) {
            guild = ctx.client.guilds.cache.get(guildId);
            if (guild) {
                gs = ctx.getGuildSettings(guildId, data);
                found = app;
                break;
            }
        }
    }
    if (!found || !guild) return false;
    const cfg = getApplicationConfig(gs);
    const result = await answerQuestion({ app: found, guild, user: message.author, data, gs, saveData: ctx.saveData, answer: message.content });
    if (result.error) {
        await message.channel.send(`❌ ${result.error}`).catch(() => {});
    }
    return true;
}

function sweep(data, client, getGuildSettings) {
    const now = Date.now();
    let changed = false;
    for (const [guildId, apps] of Object.entries(data.applications || {})) {
        const guild = client.guilds.cache.get(guildId);
        const gs = guild ? getGuildSettings(guildId, data) : null;
        if (!gs) continue;
        const cfg = getApplicationConfig(gs);
        for (const app of Object.values(apps || {})) {
            if (!app) continue;
            if (app.status === 'active' && app.expiresAt && now > app.expiresAt) {
                app.status = 'cancelled';
                app.cancelReason = 'timed_out';
                pushEvent(app, 'timed_out', null, { kind: 'application' });
                app.expiresAt = null;
                app.updatedAt = now;
                changed = true;
                client.users.fetch(app.userId).then(u => u.send({ embeds: [new EmbedBuilder().setColor(0xFF6B5E).setTitle('⌛ Application Timed Out').setDescription(cfg.dmExpired)] }).catch(() => {})).catch(() => {});
            } else if (app.status === 'snoozed' && app.snoozedUntil && now >= app.snoozedUntil) {
                // Applicant snoozes pause the remaining form timer and resume the
                // next unanswered question; reviewer snoozes pause the review
                // queue only and return the submitted application to `completed`.
                if (app.snoozeKind === 'review') {
                    app.status = 'completed';
                    pushEvent(app, 'review_resumed', null, { kind: 'review' });
                    app.snoozeKind = null;
                    app.snoozedUntil = null;
                    app.remainingMs = null;
                    app.updatedAt = now;
                    changed = true;
                    continue;
                }
                const remaining = Math.max(0, Number(app.remainingMs) || 0);
                if (!remaining) {
                    app.status = 'cancelled'; app.snoozeKind = null; app.cancelReason = 'snooze_expired_without_time'; app.updatedAt = now; changed = true;
                    continue;
                }
                app.status = 'active';
                pushEvent(app, 'resumed', null, { kind: 'applicant', remainingMs: remaining });
                app.snoozeKind = null;
                app.expiresAt = now + remaining;
                app.snoozedUntil = null;
                app.remainingMs = null;
                app.updatedAt = now;
                changed = true;
                client.users.fetch(app.userId).then(async u => {
                    await u.send({ embeds: [new EmbedBuilder().setColor(0x2DE0C4).setTitle('▶️ Application Resumed').setDescription(cfg.dmResumed)] }).catch(() => {});
                    await sendCurrentQuestion(app, u, guild, cfg).catch(() => {});
                }).catch(() => {});
            }
        }
    }
    return changed;
}

function applicationStats(data, guildId) { return applicationAnalytics(data, guildId); }

const applicationSlashCommandBuilders = [
    new SlashCommandBuilder()
        .setName('application')
        .setDescription('Start and manage server applications')
        .addSubcommand(s => s.setName('apply').setDescription('Start a new application'))
        .addSubcommand(s => s.setName('status').setDescription('Show your application status'))
        .addSubcommand(s => s.setName('cancel').setDescription('Cancel your active application'))
        .addSubcommand(s => s.setName('snooze').setDescription('Snooze your active application'))
        .addSubcommand(s => s.setName('resume').setDescription('Resume your snoozed application'))
        .addSubcommand(s => s.setName('setup').setDescription('Show application setup status')),
];

const PREFIX_COMMANDS = ['apply', 'application'];

async function handleApplicationInteraction(interaction, ctx) {
    if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'application') return false;
    const sub = interaction.options.getSubcommand();
    const data = ctx.loadData();
    const guildId = interaction.guildId;
    if (!guildId) { await interaction.reply({ content: '❌ Application commands must start in a server.', flags: 64 }).catch(() => {}); return true; }
    const guild = interaction.guild || ctx.client.guilds.cache.get(guildId);
    if (!guild) return true;
    const gs = ctx.getGuildSettings(guildId, data);
    const cfg = getApplicationConfig(gs);
    if (sub === 'apply') {
        const result = await startApplication({ guild, user: interaction.user, data, gs, saveData: ctx.saveData, sourceChannelId: interaction.channelId });
        if (result.error) await interaction.reply({ content: `❌ ${result.error}`, flags: 64 }).catch(() => {});
        else await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2DE0C4).setTitle('📨 Application DM sent').setDescription('Check your DMs to continue the application.')] }).catch(() => {});
        return true;
    }
    if (sub === 'status') {
        const app = findByUser(data, guildId, interaction.user.id, true)[0];
        if (!app) await interaction.reply({ content: 'ℹ️ You have no application for this server.', flags: 64 }).catch(() => {});
        else {
            const extra = app.status === 'active' && app.expiresAt ? `\nTime remaining: **${Math.max(0, Math.ceil((app.expiresAt - Date.now()) / 60000))} min**` : '';
            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2DE0C4).setTitle('📋 Application Status').setDescription(`Status: **${app.status}**\nApplication ID: \`${app.id}\`${extra}`)], flags: 64 }).catch(() => {});
        }
        return true;
    }
    const app = findByUser(data, guildId, interaction.user.id);
    if (sub === 'cancel') {
        if (!app) await interaction.reply({ content: '❌ No active application found.', flags: 64 }).catch(() => {});
        else if (!cfg.allowCancel) await interaction.reply({ content: '❌ Application cancellation is disabled.', flags: 64 }).catch(() => {});
        else { app.status = 'cancelled'; app.snoozeKind = null; app.cancelReason = 'user'; app.expiresAt = null; app.snoozedUntil = null; app.updatedAt = Date.now(); ctx.saveData(data); await interaction.reply({ content: '✅ Application cancelled.', flags: 64 }).catch(() => {}); }
        return true;
    }
    if (sub === 'snooze') {
        if (!app || app.status !== 'active' || !cfg.allowSnooze) { await interaction.reply({ content: '❌ No active application can be snoozed.', flags: 64 }).catch(() => {}); return true; }
        app.status = 'snoozed'; app.snoozeKind = 'applicant'; app.remainingMs = Math.max(0, app.expiresAt - Date.now()); app.expiresAt = null; app.snoozedUntil = Date.now() + cfg.snoozeMinutes * 60 * 1000; app.updatedAt = Date.now(); ctx.saveData(data);
        await interaction.reply({ content: `⏸️ Application snoozed for **${cfg.snoozeMinutes} minutes**.`, flags: 64 }).catch(() => {}); return true;
    }
    if (sub === 'resume') {
        if (!app || app.status !== 'snoozed') { await interaction.reply({ content: '❌ No snoozed application found.', flags: 64 }).catch(() => {}); return true; }
        const remaining = Math.max(0, Number(app.remainingMs) || 0);
        app.status = 'active'; app.snoozeKind = null; app.expiresAt = Date.now() + remaining; app.snoozedUntil = null; app.remainingMs = null; app.updatedAt = Date.now(); ctx.saveData(data);
        await interaction.reply({ content: '▶️ Application resumed. Check your DMs.', flags: 64 }).catch(() => {});
        await sendCurrentQuestion(app, interaction.user, guild, cfg).catch(() => {});
        return true;
    }
    if (sub === 'setup') {
        if (!ctx.isAdmin(interaction, guildId, data)) {
            await interaction.reply({ content: '❌ Administrators only.', flags: 64 }).catch(() => {});
            return true;
        }
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2DE0C4).setTitle('📋 Application Setup').setDescription(`Enabled: **${cfg.enabled ? 'YES' : 'NO'}**\nQuestions: **${cfg.questions.length}**\nReview channel: ${cfg.reviewChannelId ? `<#${cfg.reviewChannelId}>` : 'not configured'}\nReviewer roles: ${cfg.reviewerRoleIds.length ? cfg.reviewerRoleIds.map(id => `<@&${id}>`).join(', ') : 'none'}\nTime limit: **${cfg.timeLimitMinutes}m**\nSnooze: **${cfg.snoozeMinutes}m**`)], flags: 64 }).catch(() => {});
        return true;
    }
    return true;
}

async function handleApplicationPrefix(message, cmd, args, ctx) {
    if (!PREFIX_COMMANDS.includes(cmd)) return false;
    const data = ctx.loadData();
    const guildId = message.guild?.id;
    if (!guildId) return false;
    const gs = ctx.getGuildSettings(guildId, data);
    const cfg = getApplicationConfig(gs);
    const sub = String(cmd === 'apply' ? 'apply' : (args[0] || 'apply')).toLowerCase();
    if (sub === 'apply') {
        const result = await startApplication({ guild: message.guild, user: message.author, data, gs, saveData: ctx.saveData, sourceChannelId: message.channel.id });
        await message.channel.send(result.error ? `❌ ${result.error}` : '📨 Check your DMs to continue your application.').catch(() => {});
        return true;
    }
    const app = findByUser(data, guildId, message.author.id);
    if (sub === 'status') {
        await message.channel.send(app ? `📋 Application: **${app.status}** — \`${app.id}\`` : 'ℹ️ No active application.').catch(() => {});
        return true;
    }
    if (sub === 'cancel') {
        if (!app) await message.channel.send('❌ No active application.').catch(() => {});
        else if (!cfg.allowCancel) await message.channel.send('❌ Cancellation disabled.').catch(() => {});
        else { app.status = 'cancelled'; app.snoozeKind = null; app.snoozedUntil = null; app.remainingMs = null; app.updatedAt = Date.now(); app.expiresAt = null; ctx.saveData(data); await message.channel.send('✅ Application cancelled.').catch(() => {}); }
        return true;
    }
    if (sub === 'snooze') {
        if (!app || app.status !== 'active') await message.channel.send('❌ No active application.').catch(() => {});
        else if (!cfg.allowSnooze) await message.channel.send('❌ Snoozing disabled.').catch(() => {});
        else { app.status = 'snoozed'; app.snoozeKind = 'applicant'; app.remainingMs = Math.max(0, app.expiresAt - Date.now()); app.expiresAt = null; app.snoozedUntil = Date.now() + cfg.snoozeMinutes*60000; app.updatedAt = Date.now(); ctx.saveData(data); await message.channel.send('⏸️ Application snoozed.').catch(() => {}); }
        return true;
    }
    if (sub === 'resume') {
        if (!app || app.status !== 'snoozed') await message.channel.send('❌ No snoozed application.').catch(() => {});
        else { const remaining = Math.max(0, Number(app.remainingMs)||0); app.status='active'; app.snoozeKind=null; app.expiresAt=Date.now()+remaining; app.remainingMs=null; app.snoozedUntil=null; app.updatedAt=Date.now(); ctx.saveData(data); await message.channel.send('▶️ Application resumed; check your DMs.').catch(() => {}); await sendCurrentQuestion(app,message.author,message.guild,cfg).catch(()=>{}); }
        return true;
    }
    return true;
}

module.exports = {
    APP_STATUSES,
    QUESTION_TYPES,
    DEFAULT_CONFIG,
    getApplicationConfig,
    ensureStore,
    guildApplications,
    findByUser,
    applicationStats,
    applicationAnalytics,
    applicationTiming,
    pushEvent,
    startApplication,
    handleInteraction,
    handleModalSubmit,
    handleDMMessage,
    handleApplicationInteraction,
    handleApplicationPrefix,
    reviewApplication,
    applicationSlashCommandBuilders,
    PREFIX_COMMANDS,
    sweep,
    normalizeQuestion,
    renderTemplate,
};