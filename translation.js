'use strict';

const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} = require('discord.js');

const DEFAULT_TRANSLATION_CONFIG = Object.freeze({
    enabled: true,
    provider: 'groq',
    model: 'groq',
    defaultSource: 'auto',
    defaultTarget: 'en',
    autoEnabled: false,
    autoChannelIds: [],
    autoReply: true,
    showOriginal: true,
    messageTemplate: '🌐 **{target}** — {translation}',
    systemPrefix: '🌐',
    maxInputChars: 4000,
    preserveCodeBlocks: true,
    preserveMentions: true,
    preserveUrls: true,
    ignoreCommands: true,
    ignoreBotMessages: true,
    minAutoTranslateChars: 2,
    autoCooldownMs: 1500,
    duplicateSuppressionMs: 5000,
    adminOnlyConfig: true,
});

const translationRuntime = { byGuildUser: new Map(), byGuildMessage: new Map() };

const LANGUAGE_NAMES = {
    auto: 'Auto-detect', en: 'English', es: 'Spanish', fr: 'French', de: 'German',
    it: 'Italian', pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', tr: 'Turkish',
    ru: 'Russian', uk: 'Ukrainian', ar: 'Arabic', hi: 'Hindi', bn: 'Bengali',
    ja: 'Japanese', ko: 'Korean', zh: 'Chinese', id: 'Indonesian', vi: 'Vietnamese',
    sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', cs: 'Czech',
    ro: 'Romanian', el: 'Greek', he: 'Hebrew',
};


const TRANSLATION_VARIABLES = Object.freeze([
    { key: 'translation', label: 'Translation', description: 'Translated text returned by the provider.' },
    { key: 'original', label: 'Original', description: 'Original message text.' },
    { key: 'source', label: 'Source language', description: 'Detected/configured source language.' },
    { key: 'target', label: 'Target language', description: 'Target language.' },
    { key: 'provider', label: 'Provider/model', description: 'Configured AI model label.' },
    { key: 'prefix', label: 'Prefix', description: 'Configured translation prefix.' },
    { key: 'user', label: 'User', description: 'Display name where an interaction context exists.' },
    { key: 'channel', label: 'Channel', description: 'Channel name where automatic translation ran.' },
]);

const SUPPORTED_LANGUAGE_CODES = Object.freeze(Object.keys(LANGUAGE_NAMES));

function normalizeLanguage(code, fallback = 'auto') {
    const value = String(code || '').trim().toLowerCase();
    return LANGUAGE_NAMES[value] ? value : fallback;
}

function translationConfigDiagnostics(gs, ai, data = null, guildId = null) {
    const c = ensureTranslationConfig(gs);
    const catalog = ai?.AI_MODEL_CATALOG?.[c.model] || null;
    const configuredProviders = (data && guildId && ai?.listGuildApiKeys) ? ai.listGuildApiKeys(data, guildId) : [];
    const keyConfigured = configuredProviders.includes(c.provider);
    return {
        enabled: c.enabled !== false,
        autoEnabled: !!c.autoEnabled,
        provider: c.provider,
        model: c.model,
        providerKnown: Array.isArray(ai?.AI_PROVIDERS) ? ai.AI_PROVIDERS.includes(c.provider) : false,
        modelKnown: !!catalog,
        modelProviderMatches: !!catalog && catalog.provider === c.provider,
        sourceValid: !!LANGUAGE_NAMES[c.defaultSource],
        targetValid: !!LANGUAGE_NAMES[c.defaultTarget] && c.defaultTarget !== 'auto',
        channelCount: c.autoChannelIds.length,
        maxInputChars: c.maxInputChars,
        duplicateSuppressionMs: c.duplicateSuppressionMs,
        autoCooldownMs: c.autoCooldownMs,
        keyConfigured,
    };
}

function sanitizeTemplate(template) {
    const allowed = new Set(TRANSLATION_VARIABLES.map(v => v.key));
    return String(template || '').replace(/\{([a-zA-Z]+)\}/g, (full, key) => allowed.has(key) ? full : '');
}

function validateTranslationConfig(input, current = DEFAULT_TRANSLATION_CONFIG, ai = {}) {
    const c = { ...DEFAULT_TRANSLATION_CONFIG, ...(current || {}) };
    const body = input && typeof input === 'object' ? input : {};
    if (body.enabled !== undefined) c.enabled = !!body.enabled;
    if (body.autoEnabled !== undefined) c.autoEnabled = !!body.autoEnabled;
    if (body.autoReply !== undefined) c.autoReply = !!body.autoReply;
    if (body.showOriginal !== undefined) c.showOriginal = !!body.showOriginal;
    if (body.preserveCodeBlocks !== undefined) c.preserveCodeBlocks = !!body.preserveCodeBlocks;
    if (body.preserveMentions !== undefined) c.preserveMentions = !!body.preserveMentions;
    if (body.preserveUrls !== undefined) c.preserveUrls = !!body.preserveUrls;
    if (body.ignoreCommands !== undefined) c.ignoreCommands = !!body.ignoreCommands;
    if (body.ignoreBotMessages !== undefined) c.ignoreBotMessages = !!body.ignoreBotMessages;
    if (body.adminOnlyConfig !== undefined) c.adminOnlyConfig = !!body.adminOnlyConfig;
    c.defaultSource = normalizeLanguage(body.defaultSource ?? c.defaultSource, 'auto');
    c.defaultTarget = normalizeLanguage(body.defaultTarget ?? c.defaultTarget, 'en');
    if (c.defaultTarget === 'auto') c.defaultTarget = 'en';
    c.provider = String(body.provider ?? c.provider).toLowerCase().slice(0, 40);
    c.model = String(body.model ?? c.model).slice(0, 120);
    const n = Number(body.maxInputChars ?? c.maxInputChars);
    c.maxInputChars = Number.isFinite(n) ? Math.max(100, Math.min(12000, Math.floor(n))) : DEFAULT_TRANSLATION_CONFIG.maxInputChars;
    const minChars = Number(body.minAutoTranslateChars ?? c.minAutoTranslateChars);
    c.minAutoTranslateChars = Number.isFinite(minChars) ? Math.max(1, Math.min(200, Math.floor(minChars))) : 2;
    const autoCooldown = Number(body.autoCooldownMs ?? c.autoCooldownMs);
    c.autoCooldownMs = Number.isFinite(autoCooldown) ? Math.max(250, Math.min(60000, Math.floor(autoCooldown))) : 1500;
    const dup = Number(body.duplicateSuppressionMs ?? c.duplicateSuppressionMs);
    c.duplicateSuppressionMs = Number.isFinite(dup) ? Math.max(0, Math.min(120000, Math.floor(dup))) : 5000;
    c.systemPrefix = String(body.systemPrefix ?? c.systemPrefix).slice(0, 30);
    c.messageTemplate = sanitizeTemplate(String(body.messageTemplate ?? c.messageTemplate).slice(0, 1500)) || DEFAULT_TRANSLATION_CONFIG.messageTemplate;
    c.autoChannelIds = Array.isArray(body.autoChannelIds) ? [...new Set(body.autoChannelIds.map(String).filter(Boolean))].slice(0, 100) : (Array.isArray(c.autoChannelIds) ? [...new Set(c.autoChannelIds.map(String))].slice(0, 100) : []);
    if (Array.isArray(ai.AI_PROVIDERS) && ai.AI_PROVIDERS.length && !ai.AI_PROVIDERS.includes(c.provider)) {
        c.provider = ai.AI_PROVIDERS[0];
        const firstModel = Object.entries(ai.AI_MODEL_CATALOG || {}).find(([, m]) => m?.provider === c.provider);
        c.model = firstModel?.[0] || c.model;
    }
    const model = ai.AI_MODEL_CATALOG?.[c.model];
    if (model && model.provider !== c.provider) {
        const compatible = Object.entries(ai.AI_MODEL_CATALOG || {}).find(([, m]) => m?.provider === c.provider);
        c.model = compatible?.[0] || c.model;
    }
    return c;
}

function ensureTranslationConfig(gs) {
    const current = (gs.translation && typeof gs.translation === 'object') ? gs.translation : {};
    gs.translation = validateTranslationConfig(current, DEFAULT_TRANSLATION_CONFIG, {});
    return gs.translation;
}

function translationConfigSummary(gs) {
    const c = ensureTranslationConfig(gs);
    return {
        ...c,
        provider: String(c.provider),
        model: String(c.model),
        defaultSource: String(c.defaultSource || 'auto'),
        defaultTarget: String(c.defaultTarget || 'en'),
        languageNames: LANGUAGE_NAMES,
    };
}

function findModelKey(catalog, preferred) {
    if (preferred && catalog?.[preferred]) return preferred;
    return Object.keys(catalog || {})[0] || null;
}

function buildPrompt(text, source, target) {
    const sourceLabel = LANGUAGE_NAMES[source] || source || 'the detected source language';
    const targetLabel = LANGUAGE_NAMES[target] || target || target;
    return [
        'Translate the following text.',
        `Source language: ${source === 'auto' ? 'auto-detect' : sourceLabel}.`,
        `Target language: ${targetLabel}.`,
        'Return ONLY the translation, with no explanation, no quotes, and no language label.',
        'Preserve Markdown, URLs, emoji, mentions, code blocks, usernames, IDs, Discord commands, code syntax, and proper nouns exactly where possible.',
        'Do not translate Discord mentions, IDs, URLs, commands, or code syntax.',
        'Do not add commentary, explanations, notes, quotes, or formatting that was not present in the input.',
        '',
        text,
    ].join('\n');
}

async function translateText({ text, source, target, cfg, data, guildId, ai }) {
    const input = String(text || '').trim();
    if (!input) return { error: 'Please provide text to translate.' };
    const max = Math.max(100, Math.min(12000, Number(cfg.maxInputChars) || DEFAULT_TRANSLATION_CONFIG.maxInputChars));
    if (input.length > max) return { error: `That text is too long for this server's translation limit (${max.toLocaleString()} characters).` };

    const provider = String(cfg.provider || DEFAULT_TRANSLATION_CONFIG.provider);
    const modelKey = findModelKey(ai.AI_MODEL_CATALOG, String(cfg.model || ''));
    if (!modelKey) return { error: 'The configured translation model is unavailable.' };
    const catalog = ai.AI_MODEL_CATALOG[modelKey];
    const key = ai.getGuildApiKey(data, guildId, catalog.provider);
    if (!key) {
        return { error: `Translation is configured for ${catalog.label}, but this server has no encrypted ${catalog.provider} BYOK key. An administrator must add one in Dashboard → AI Support or with \`/autotranslate config key\`.` };
    }

    try {
        const result = await ai.callAIProvider(catalog, key, [
            { role: 'user', content: buildPrompt(input, source, target) },
        ]);
        return {
            source,
            target,
            provider: catalog.provider,
            model: catalog.label,
            translation: String(result || '').trim() || '(empty translation)',
            original: input,
        };
    } catch (e) {
        return { error: `Translation provider failed: ${e.message}` };
    }
}

function formatTranslationResult(result, cfg) {
    const template = String(cfg.messageTemplate || DEFAULT_TRANSLATION_CONFIG.messageTemplate);
    const rendered = template
        .replace(/\{target\}/g, LANGUAGE_NAMES[result.target] || result.target)
        .replace(/\{source\}/g, result.source === 'auto' ? 'Auto-detected' : (LANGUAGE_NAMES[result.source] || result.source))
        .replace(/\{translation\}/g, result.translation)
        .replace(/\{original\}/g, result.original)
        .replace(/\{provider\}/g, result.model);
    if (!cfg.showOriginal) return rendered.replace(/\{original\}/g, '').replace(/\n{3,}/g, '\n\n');
    return rendered;
}

function isAdmin(interactionOrMessage, guildId, data, deps) {
    if (deps.isSuperUser?.(interactionOrMessage.user?.id || interactionOrMessage.author?.id)) return true;
    const member = interactionOrMessage.member;
    return !!(member?.permissions?.has(PermissionFlagsBits.Administrator) ||
        deps.isManagerMember?.(member, guildId, data));
}

function parsePrefixArgs(raw) {
    const s = String(raw || '').trim();
    if (!s) return { target: null, text: '' };
    const m = s.match(/^([a-z]{2,8})\s+([\s\S]+)$/i);
    if (m && LANGUAGE_NAMES[m[1].toLowerCase()]) return { target: m[1].toLowerCase(), text: m[2].trim() };
    return { target: null, text: s };
}

async function handleTranslateInteraction(interaction, data, gs, guild, deps) {
    if (!interaction.isChatInputCommand?.()) return false;
    const name = interaction.commandName;
    if (name !== 'translate' && name !== 'autotranslate') return false;
    const cfg = ensureTranslationConfig(gs);

    if (name === 'translate') {
        if (cfg.enabled === false) { await interaction.reply({ content: '❌ Translation commands are disabled on this server.', flags: 64 }).catch(() => {}); return true; }
        const text = interaction.options.getString('text', true);
        const source = (interaction.options.getString('source') || cfg.defaultSource || 'auto').toLowerCase();
        const target = (interaction.options.getString('target') || cfg.defaultTarget || 'en').toLowerCase();
        await interaction.deferReply();
        const result = await translateText({ text, source, target, cfg, data, guildId: guild.id, ai: deps.ai });
        if (result.error) {
            await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🌐 Translation').setColor(0xFF6B5E).setDescription(result.error)] }).catch(() => {});
            return true;
        }
        if (typeof deps.sendLongResponse === 'function') {
            await deps.sendLongResponse(interaction, formatTranslationResult(result, cfg));
        } else {
            await interaction.editReply({ content: formatTranslationResult(result, cfg) }).catch(() => {});
        }
        return true;
    }

    const sub = interaction.options.getSubcommand();
    if (!isAdmin(interaction, guild.id, data, deps)) {
        await interaction.reply({ content: '❌ Administrators or bot managers only.', flags: 64 }).catch(() => {});
        return true;
    }



    if (sub === 'status') {
        const keys = deps.ai.listGuildApiKeys(data, guild.id);
        const desc = [
            `Enabled: **${cfg.autoEnabled ? 'YES' : 'NO'}**`,
            `Target: **${LANGUAGE_NAMES[cfg.defaultTarget] || cfg.defaultTarget}**`,
            `Source: **${LANGUAGE_NAMES[cfg.defaultSource] || cfg.defaultSource}**`,
            `Translate commands: **${cfg.enabled ? 'enabled' : 'disabled'}**`,
            `Provider/model: **${cfg.model}**`,
            `Output prefix: **${cfg.systemPrefix || '🌐'}**`,
            `Auto channels: **${cfg.autoChannelIds.length}**`,
            `BYOK providers configured: **${keys.length ? keys.join(', ') : 'none'}**`,
        ].join('\n');
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🌐 Auto-Translate Status').setColor(0x2DE0C4).setDescription(desc)], flags: 64 }).catch(() => {});
        return true;
    }

    if (sub === 'enable' || sub === 'disable') {
        cfg.autoEnabled = sub === 'enable';
        gs.translation = cfg;
        deps.saveData(data);
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🌐 Auto-Translate').setColor(0x2DE0C4).setDescription(`Automatic translation is now **${cfg.autoEnabled ? 'enabled' : 'disabled'}**.`)], flags: 64 }).catch(() => {});
        return true;
    }

    if (sub === 'channel_add' || sub === 'channel_remove') {
        const ch = interaction.options.getChannel('channel', true);
        cfg.autoChannelIds = cfg.autoChannelIds || [];
        if (sub === 'channel_add') {
            if (!cfg.autoChannelIds.includes(ch.id)) cfg.autoChannelIds.push(ch.id);
            await interaction.reply({ content: `✅ ${ch} added to auto-translate channels.`, flags: 64 }).catch(() => {});
        } else {
            cfg.autoChannelIds = cfg.autoChannelIds.filter(id => id !== ch.id);
            await interaction.reply({ content: `✅ ${ch} removed from auto-translate channels.`, flags: 64 }).catch(() => {});
        }
        gs.translation = cfg;
        deps.saveData(data);
        return true;
    }

    if (sub === 'target') {
        const target = interaction.options.getString('language', true).toLowerCase();
        if (!LANGUAGE_NAMES[target] || target === 'auto') {
            await interaction.reply({ content: '❌ Use a supported two-letter language code such as `en`, `es`, `fr`, `de`, `nl`, `ja`, or `ko`.', flags: 64 }).catch(() => {});
            return true;
        }
        cfg.defaultTarget = target;
        gs.translation = cfg;
        deps.saveData(data);
        await interaction.reply({ content: `✅ Default target language set to **${LANGUAGE_NAMES[target]}**.`, flags: 64 }).catch(() => {});
        return true;
    }

    if (sub === 'source') {
        const source = interaction.options.getString('language', true).toLowerCase();
        if (!LANGUAGE_NAMES[source]) {
            await interaction.reply({ content: '❌ Unsupported language code.', flags: 64 }).catch(() => {});
            return true;
        }
        cfg.defaultSource = source;
        gs.translation = cfg;
        deps.saveData(data);
        await interaction.reply({ content: `✅ Default source language set to **${LANGUAGE_NAMES[source]}**.`, flags: 64 }).catch(() => {});
        return true;
    }

    if (sub === 'provider') {
        const provider = interaction.options.getString('provider', true);
        const model = interaction.options.getString('model', true);
        if (!deps.ai.AI_PROVIDERS.includes(provider)) {
            await interaction.reply({ content: '❌ Unsupported provider.', flags: 64 }).catch(() => {});
            return true;
        }
        if (!deps.ai.AI_MODEL_CATALOG[model] || deps.ai.AI_MODEL_CATALOG[model].provider !== provider) {
            await interaction.reply({ content: '❌ That model does not belong to the selected provider.', flags: 64 }).catch(() => {});
            return true;
        }
        cfg.provider = provider;
        cfg.model = model;
        gs.translation = cfg;
        deps.saveData(data);
        await interaction.reply({ content: `✅ Translation provider set to **${deps.ai.AI_MODEL_CATALOG[model].label}**.`, flags: 64 }).catch(() => {});
        return true;
    }

    if (sub === 'key') {
        const provider = interaction.options.getString('provider', true);
        const key = interaction.options.getString('api_key', true).trim();
        if (!deps.ai.AI_PROVIDERS.includes(provider)) {
            await interaction.reply({ content: '❌ Unsupported provider.', flags: 64 }).catch(() => {});
            return true;
        }
        try {
            deps.ai.setGuildApiKey(data, guild.id, provider, key);
            deps.saveData(data);
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔐 Translation BYOK').setColor(0x2DE0C4).setDescription(`The **${provider}** key was encrypted and stored for this server. It will never be returned to the dashboard or command output.`)], flags: 64 }).catch(() => {});
        } catch (e) {
            await interaction.reply({ content: `❌ Couldn't save the key securely: ${e.message}`, flags: 64 }).catch(() => {});
        }
        return true;
    }

    if (sub === 'remove_key') {
        const provider = interaction.options.getString('provider', true);
        const removed = deps.ai.removeGuildApiKey(data, guild.id, provider);
        deps.saveData(data);
        await interaction.reply({ content: removed ? `✅ Removed the ${provider} server BYOK key.` : `ℹ️ No ${provider} server key was stored.`, flags: 64 }).catch(() => {});
        return true;
    }

    if (sub === 'prefix') {
        cfg.systemPrefix = interaction.options.getString('value', true).slice(0, 30); gs.translation = cfg; deps.saveData(data);
        await interaction.reply({ content: `✅ Translation output prefix set to **${cfg.systemPrefix}**.`, flags: 64 }).catch(() => {}); return true;
    }

    if (sub === 'template') {
        const template = interaction.options.getString('value', true);
        if (template.length > 1500) {
            await interaction.reply({ content: '❌ Template must be 1500 characters or fewer.', flags: 64 }).catch(() => {});
            return true;
        }
        cfg.messageTemplate = template;
        gs.translation = cfg;
        deps.saveData(data);
        await interaction.reply({ content: '✅ Translation template updated.', flags: 64 }).catch(() => {});
        return true;
    }

    return false;
}

function parseBooleanWord(value) { return /^(on|true|yes|1|enable|enabled)$/i.test(String(value || '')); }

function translationStatusText(c, configuredProviders = []) {
    return [
        '🌐 **Translation Configuration**',
        `Commands: **${c.enabled ? 'enabled' : 'disabled'}**`,
        `Auto-translate: **${c.autoEnabled ? 'enabled' : 'disabled'}**`,
        `Source: **${LANGUAGE_NAMES[c.defaultSource] || c.defaultSource}**`,
        `Target: **${LANGUAGE_NAMES[c.defaultTarget] || c.defaultTarget}**`,
        `Provider/model: **${c.provider} / ${c.model}**`,
        `Auto reply: **${c.autoReply ? 'yes' : 'no'}**`,
        `Show original: **${c.showOriginal ? 'yes' : 'no'}**`,
        `Channels: **${c.autoChannelIds.length}**`,
        `Input limit: **${Number(c.maxInputChars).toLocaleString()}**`,
        `Prefix: **${c.systemPrefix || '🌐'}**`,
        `Template: ${c.messageTemplate}`,
        `BYOK providers: **${configuredProviders.length ? configuredProviders.join(', ') : 'none'}**`,
    ].join('\n');
}

function isConfiguredAutoChannel(message, cfg) {
    return !!message?.channel?.id && cfg.autoChannelIds.includes(String(message.channel.id));
}

function shouldSkipAutoTranslation(message, cfg) {
    const content = String(message?.content || '').trim();
    if (!content || content.length < cfg.minAutoTranslateChars) return true;
    if (cfg.ignoreBotMessages && message.author?.bot) return true;
    if (cfg.systemPrefix && content.startsWith(cfg.systemPrefix)) return true;
    if (cfg.ignoreCommands && /^[!/.]?\w+(?:\s|$)/.test(content) && /^[!/.]/.test(content)) return true;
    return false;
}

async function handleTranslatePrefix(message, cmd, args, data, gs, deps) {
    const c = ensureTranslationConfig(gs);
    if (cmd === 'translate') {
        if (['config','settings','status'].includes(String(args[0] || '').toLowerCase())) {
            if (!isAdmin(message, message.guild.id, data, deps)) { await message.channel.send('❌ Administrators or bot managers only.').catch(() => {}); return true; }
            if (String(args[0] || '').toLowerCase() === 'status') { await message.channel.send(translationStatusText(c, deps.ai.listGuildApiKeys?.(data, message.guild.id) || [])).catch(() => {}); return true; }
            const sub = String(args[1] || '').toLowerCase();
            const val = args.slice(2).join(' ').trim();
            if (!sub) { await message.channel.send(translationStatusText(c, deps.ai.listGuildApiKeys?.(data, message.guild.id) || [])).catch(() => {}); return true; }
            const boolKeys = { enabled:'enabled', autoreply:'autoReply', showoriginal:'showOriginal', preservecode:'preserveCodeBlocks', preservementions:'preserveMentions', preserveurls:'preserveUrls', ignorecommands:'ignoreCommands', ignorebots:'ignoreBotMessages' };
            if (boolKeys[sub]) { c[boolKeys[sub]] = parseBooleanWord(val); }
            else if (sub === 'target') c.defaultTarget = normalizeLanguage(val, c.defaultTarget);
            else if (sub === 'source') c.defaultSource = normalizeLanguage(val, c.defaultSource);
            else if (sub === 'prefix') c.systemPrefix = val.slice(0,30);
            else if (sub === 'template') c.messageTemplate = sanitizeTemplate(val.slice(0,1500)) || c.messageTemplate;
            else if (sub === 'maxinput') { const n=Number(val); if(!Number.isInteger(n)||n<100||n>12000){await message.channel.send('❌ maxinput must be 100-12000.').catch(()=>{});return true;} c.maxInputChars=n; }
            else if (sub === 'minchars') { const n=Number(val); if(!Number.isInteger(n)||n<1||n>200){await message.channel.send('❌ minchars must be 1-200.').catch(()=>{});return true;} c.minAutoTranslateChars=n; }
            else if (sub === 'cooldown') { const n=Number(val); if(!Number.isInteger(n)||n<250||n>60000){await message.channel.send('❌ cooldown must be 250-60000ms.').catch(()=>{});return true;} c.autoCooldownMs=n; }
            else if (sub === 'dedupe') { const n=Number(val); if(!Number.isInteger(n)||n<0||n>120000){await message.channel.send('❌ dedupe must be 0-120000ms.').catch(()=>{});return true;} c.duplicateSuppressionMs=n; }
            else { await message.channel.send('❌ Unknown !translate config option. Try: status, enabled, target, source, prefix, template, maxinput, minchars, cooldown, dedupe, autoreply, showoriginal, preservecode, preservementions, preserveurls, ignorecommands, ignorebots.').catch(()=>{}); return true; }
            gs.translation = validateTranslationConfig(c,c,deps.ai); deps.saveData(data);
            await message.channel.send(`✅ Translation setting updated.\n\n${translationStatusText(c, deps.ai.listGuildApiKeys?.(data, message.guild.id) || [])}`).catch(()=>{});
            return true;
        }
        if (c.enabled === false) { await message.channel.send('❌ Translation commands are disabled on this server.').catch(() => {}); return true; }
        const parsed = parsePrefixArgs(args.join(' '));
        if (!parsed.text) { await message.channel.send('❌ Usage: !translate <target?> <text>').catch(() => {}); return true; }
        const target = parsed.target || c.defaultTarget || 'en';
        const result = await translateText({ text: parsed.text, source: c.defaultSource || 'auto', target, cfg: c, data, guildId: message.guild.id, ai: deps.ai });
        if (result.error) {
            await message.channel.send({ embeds: [new EmbedBuilder().setTitle('🌐 Translation').setColor(0xFF6B5E).setDescription(result.error)] }).catch(() => {});
            return true;
        }
        const out = formatTranslationResult(result, c);
        if (typeof deps.sendLongResponse === 'function') await deps.sendLongResponse(message.channel, out);
        else await message.channel.send({ content: out }).catch(() => {});
        return true;
    }

    if (cmd !== 'autotranslate') return false;
    if (!isAdmin(message, message.guild.id, data, deps)) {
        await message.channel.send('❌ Administrators or bot managers only.').catch(() => {});
        return true;
    }
    const sub = String(args[0] || 'status').toLowerCase();
    if (sub === 'translate_enabled' && args[1]) {
        c.enabled = parseBooleanWord(args[1]); gs.translation = c; deps.saveData(data);
        await message.channel.send(`✅ /translate and !translate are now **${c.enabled ? 'enabled' : 'disabled'}**.`).catch(() => {}); return true;
    }
    if (sub === 'prefix' && args[1]) {
        c.systemPrefix = args.slice(1).join(' ').slice(0, 30); gs.translation = c; deps.saveData(data);
        await message.channel.send(`✅ Translation output prefix set to **${c.systemPrefix}**.`).catch(() => {}); return true;
    }
    if (sub === 'enable' || sub === 'disable') {
        c.autoEnabled = sub === 'enable';
        gs.translation = c; deps.saveData(data);
        await message.channel.send(`✅ Auto-translate ${c.autoEnabled ? 'enabled' : 'disabled'}.`).catch(() => {});
        return true;
    }


    if (sub === 'status') {
        const keys = deps.ai.listGuildApiKeys(data, message.guild.id);
        await message.channel.send([
            '🌐 **Auto-Translate Status**',
            `Enabled: **${c.autoEnabled ? 'yes' : 'no'}**`,
            `Target: **${LANGUAGE_NAMES[c.defaultTarget] || c.defaultTarget}**`,
            `Source: **${LANGUAGE_NAMES[c.defaultSource] || c.defaultSource}**`,
            `Provider/model: **${c.model}**`,
            `Auto reply: **${c.autoReply ? 'yes' : 'no'}**`,
            `Show original: **${c.showOriginal ? 'yes' : 'no'}**`,
            `Max input: **${Number(c.maxInputChars).toLocaleString()}**`,
            `Channels: ${c.autoChannelIds.length ? c.autoChannelIds.map(id => `<#${id}>`).join(', ') : 'none'}`,
            `BYOK providers: **${keys.length ? keys.join(', ') : 'none'}**`,
        ].join('\n')).catch(() => {});
        return true;
    }
    if (sub === 'channel' && args[1]) {
        const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[1]);
        if (!channel) { await message.channel.send('❌ Mention a valid channel or provide its ID.').catch(() => {}); return true; }
        const op = String(args[2] || 'add').toLowerCase();
        c.autoChannelIds = c.autoChannelIds || [];
        if (op === 'remove') c.autoChannelIds = c.autoChannelIds.filter(id => id !== channel.id);
        else if (op === 'add' && !c.autoChannelIds.includes(channel.id)) c.autoChannelIds.push(channel.id);
        else if (!['add','remove'].includes(op)) { await message.channel.send('❌ Use `add` or `remove`.').catch(() => {}); return true; }
        gs.translation = c; deps.saveData(data);
        await message.channel.send(`✅ ${channel} ${op === 'remove' ? 'removed from' : 'added to'} auto-translate channels.`).catch(() => {});
        return true;
    }
    if (sub === 'target' && args[1]) {
        const lang = args[1].toLowerCase();
        if (!LANGUAGE_NAMES[lang] || lang === 'auto') { await message.channel.send('❌ Unsupported target language.').catch(() => {}); return true; }
        c.defaultTarget = lang; gs.translation = c; deps.saveData(data);
        await message.channel.send(`✅ Default target set to **${LANGUAGE_NAMES[lang]}**.`).catch(() => {});
        return true;
    }
    if (sub === 'source' && args[1]) {
        const lang = args[1].toLowerCase();
        if (!LANGUAGE_NAMES[lang]) { await message.channel.send('❌ Unsupported source language.').catch(() => {}); return true; }
        c.defaultSource = lang; gs.translation = c; deps.saveData(data);
        await message.channel.send(`✅ Default source set to **${LANGUAGE_NAMES[lang]}**.`).catch(() => {});
        return true;
    }
    if (sub === 'provider' && args[1] && args[2]) {
        const provider = args[1].toLowerCase(), model = args[2];
        if (!deps.ai.AI_PROVIDERS.includes(provider)) { await message.channel.send('❌ Unsupported provider.').catch(() => {}); return true; }
        const catalog = deps.ai.AI_MODEL_CATALOG[model];
        if (!catalog || catalog.provider !== provider) { await message.channel.send('❌ That model does not belong to the selected provider.').catch(() => {}); return true; }
        c.provider = provider; c.model = model; gs.translation = c; deps.saveData(data);
        await message.channel.send(`✅ Translation model set to **${catalog.label}**.`).catch(() => {});
        return true;
    }
    if (sub === 'key' && args[1] && args[2]) {
        const provider = args[1].toLowerCase(), rawKey = args.slice(2).join(' ').trim();
        if (!deps.ai.AI_PROVIDERS.includes(provider)) { await message.channel.send('❌ Unsupported provider.').catch(() => {}); return true; }
        try { deps.ai.setGuildApiKey(data, message.guild.id, provider, rawKey); deps.saveData(data); await message.channel.send(`✅ ${provider} server BYOK key encrypted and saved.`).catch(() => {}); }
        catch (e) { await message.channel.send(`❌ Couldn't save the key: ${e.message}`).catch(() => {}); }
        return true;
    }
    if (sub === 'remove_key' && args[1]) {
        const provider = args[1].toLowerCase();
        const removed = deps.ai.removeGuildApiKey(data, message.guild.id, provider);
        deps.saveData(data);
        await message.channel.send(removed ? `✅ Removed the ${provider} server BYOK key.` : `ℹ️ No ${provider} server key was stored.`).catch(() => {});
        return true;
    }
    if (sub === 'autoreply' && args[1]) {
        c.autoReply = /^(on|true|yes|1)$/i.test(args[1]); gs.translation = c; deps.saveData(data);
        await message.channel.send(`✅ Auto-translate reply mode is now **${c.autoReply ? 'on' : 'off'}**.`).catch(() => {}); return true;
    }
    if (sub === 'showoriginal' && args[1]) {
        c.showOriginal = /^(on|true|yes|1)$/i.test(args[1]); gs.translation = c; deps.saveData(data);
        await message.channel.send(`✅ Showing the original text is now **${c.showOriginal ? 'on' : 'off'}**.`).catch(() => {}); return true;
    }
    if (sub === 'maxinput' && args[1]) {
        const n = Number(args[1]);
        if (!Number.isInteger(n) || n < 100 || n > 12000) { await message.channel.send('❌ Max input must be between 100 and 12,000 characters.').catch(() => {}); return true; }
        c.maxInputChars = n; gs.translation = c; deps.saveData(data);
        await message.channel.send(`✅ Translation input limit set to **${n.toLocaleString()}** characters.`).catch(() => {}); return true;
    }
    if (sub === 'minchars' && args[1]) { const n=Number(args[1]); if(!Number.isInteger(n)||n<1||n>200){await message.channel.send('❌ Min chars must be 1-200.').catch(()=>{});return true;} c.minAutoTranslateChars=n; gs.translation=c; deps.saveData(data); await message.channel.send(`✅ Auto-translate minimum message length set to **${n}**.`).catch(()=>{}); return true; }
    if (sub === 'cooldown' && args[1]) { const n=Number(args[1]); if(!Number.isInteger(n)||n<250||n>60000){await message.channel.send('❌ Cooldown must be 250-60000ms.').catch(()=>{});return true;} c.autoCooldownMs=n; gs.translation=c; deps.saveData(data); await message.channel.send(`✅ Auto-translate cooldown set to **${n}ms**.`).catch(()=>{}); return true; }
    if (sub === 'dedupe' && args[1]) { const n=Number(args[1]); if(!Number.isInteger(n)||n<0||n>120000){await message.channel.send('❌ Dedupe window must be 0-120000ms.').catch(()=>{});return true;} c.duplicateSuppressionMs=n; gs.translation=c; deps.saveData(data); await message.channel.send(`✅ Duplicate suppression set to **${n}ms**.`).catch(()=>{}); return true; }
    for (const [name,key] of [['preservecode','preserveCodeBlocks'],['preservementions','preserveMentions'],['preserveurls','preserveUrls'],['ignorecommands','ignoreCommands'],['ignorebots','ignoreBotMessages']]) {
        if (sub===name && args[1]) { c[key]=parseBooleanWord(args[1]); gs.translation=c; deps.saveData(data); await message.channel.send(`✅ ${name} is now **${c[key]?'on':'off'}**.`).catch(()=>{}); return true; }
    }
    if (sub === 'template') {
        const template = args.slice(1).join(' ').trim();
        if (!template || template.length > 1500) { await message.channel.send('❌ Provide a template up to 1,500 characters.').catch(() => {}); return true; }
        c.messageTemplate = template; gs.translation = c; deps.saveData(data);
        await message.channel.send('✅ Translation output template updated.').catch(() => {}); return true;
    }
    await message.channel.send('❌ Unknown auto-translate option. Try: enable, disable, status, translate_enabled on|off, channel add/remove, target, source, provider, key, remove_key, autoreply, showoriginal, maxinput, minchars, cooldown, dedupe, preservecode, preservementions, preserveurls, ignorecommands, ignorebots, template, prefix.').catch(() => {});
    return true;
}

async function handleAutoTranslateMessage(message, data, gs, deps) {
    if (!message?.guild) return false;
    const c = ensureTranslationConfig(gs);
    if (!c.autoEnabled || !isConfiguredAutoChannel(message, c)) return false;
    if (shouldSkipAutoTranslation(message, c)) return false;
    const now = Date.now();
    const guildKey = `${message.guild.id}:${message.author?.id || 'unknown'}`;
    const last = translationRuntime.byGuildUser.get(guildKey) || 0;
    if (now - last < c.autoCooldownMs) return false;
    const messageKey = `${message.guild.id}:${message.channel.id}:${String(message.content).trim()}`;
    const lastMessageAt = translationRuntime.byGuildMessage.get(messageKey) || 0;
    if (now - lastMessageAt < c.duplicateSuppressionMs) return false;
    translationRuntime.byGuildUser.set(guildKey, now);
    translationRuntime.byGuildMessage.set(messageKey, now);
    const target = c.defaultTarget || 'en';
    const result = await translateText({ text: message.content, source: c.defaultSource || 'auto', target, cfg: c, data, guildId: message.guild.id, ai: deps.ai });
    if (result.error) return false;
    const out = formatTranslationResult(result, c);
    if (c.autoReply) {
        if (typeof deps.sendLongResponse === 'function') await deps.sendLongResponse(message, out);
        else await message.reply({ content: out }).catch(() => {});
    } else {
        if (typeof deps.sendLongResponse === 'function') await deps.sendLongResponse(message.channel, out);
        else await message.channel.send({ content: out }).catch(() => {});
    }
    return true;
}

const PROVIDER_CHOICES = [
    { name: 'Claude', value: 'claude' }, { name: 'OpenAI', value: 'openai' },
    { name: 'Gemini', value: 'gemini' }, { name: 'Groq', value: 'groq' },
    { name: 'DeepSeek', value: 'deepseek' }, { name: 'Mistral', value: 'mistral' },
    { name: 'Grok', value: 'grok' },
];

const slashCommandBuilders = [
    new SlashCommandBuilder()
        .setName('translate')
        .setDescription('Translate text using this server\'s encrypted BYOK AI key and server translation settings')
        .addStringOption(o => o.setName('text').setDescription('Text to translate').setRequired(true).setMaxLength(4000))
        .addStringOption(o => o.setName('target').setDescription('Target language code (default: server setting, e.g. en)').setRequired(false))
        .addStringOption(o => o.setName('source').setDescription('Source language code, or auto').setRequired(false)),
    new SlashCommandBuilder()
        .setName('autotranslate')
        .setDescription('Configure automatic translation for this server')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(s => s.setName('status').setDescription('Show auto-translate status'))
        .addSubcommand(s => s.setName('translate_enabled').setDescription('Enable or disable /translate and !translate')
            .addBooleanOption(o => o.setName('enabled').setDescription('On/off').setRequired(true)))
        .addSubcommand(s => s.setName('enable').setDescription('Enable auto-translation'))
        .addSubcommand(s => s.setName('disable').setDescription('Disable auto-translation'))
        .addSubcommand(s => s.setName('channel_add').setDescription('Add a channel to auto-translate')
            .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)))
        .addSubcommand(s => s.setName('channel_remove').setDescription('Remove a channel from auto-translate')
            .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)))
        .addSubcommand(s => s.setName('target').setDescription('Set default target language')
            .addStringOption(o => o.setName('language').setDescription('Language code').setRequired(true)))
        .addSubcommand(s => s.setName('source').setDescription('Set default source language')
            .addStringOption(o => o.setName('language').setDescription('Language code or auto').setRequired(true)))
        .addSubcommand(s => s.setName('provider').setDescription('Set translation provider/model')
            .addStringOption(o => o.setName('provider').setDescription('Provider').setRequired(true).addChoices(...PROVIDER_CHOICES))
            .addStringOption(o => o.setName('model').setDescription('Model key from the server catalog').setRequired(true)))
        .addSubcommand(s => s.setName('key').setDescription('Save an encrypted server BYOK key')
            .addStringOption(o => o.setName('provider').setDescription('Provider').setRequired(true).addChoices(...PROVIDER_CHOICES))
            .addStringOption(o => o.setName('api_key').setDescription('API key (stored encrypted; never echoed)').setRequired(true)))
        .addSubcommand(s => s.setName('remove_key').setDescription('Delete an encrypted server BYOK key')
            .addStringOption(o => o.setName('provider').setDescription('Provider').setRequired(true).addChoices(...PROVIDER_CHOICES)))
        .addSubcommand(s => s.setName('autoreply').setDescription('Toggle whether auto-translation replies to the source message')
            .addBooleanOption(o => o.setName('enabled').setDescription('On/off').setRequired(true)))
        .addSubcommand(s => s.setName('showoriginal').setDescription('Toggle whether the original text is included')
            .addBooleanOption(o => o.setName('enabled').setDescription('On/off').setRequired(true)))
        .addSubcommand(s => s.setName('maxinput').setDescription('Set maximum translation input length')
            .addIntegerOption(o => o.setName('characters').setDescription('100-12000 characters').setRequired(true).setMinValue(100).setMaxValue(12000)))
        .addSubcommand(s => s.setName('template').setDescription('Set the auto-translation output template')
            .addStringOption(o => o.setName('value').setDescription('Use {translation}, {original}, {target}, {source}, {provider}').setRequired(true).setMaxLength(1500)))
        .addSubcommand(s => s.setName('prefix').setDescription('Set the prefix used to identify bot auto-translation messages')
            .addStringOption(o => o.setName('value').setDescription('Prefix, up to 30 characters').setRequired(true).setMaxLength(30)))
        .addSubcommand(s => s.setName('minchars').setDescription('Set minimum message length for auto-translation')
            .addIntegerOption(o => o.setName('characters').setDescription('1-200').setRequired(true).setMinValue(1).setMaxValue(200)))
        .addSubcommand(s => s.setName('cooldown').setDescription('Set per-user auto-translation cooldown')
            .addIntegerOption(o => o.setName('milliseconds').setDescription('250-60000ms').setRequired(true).setMinValue(250).setMaxValue(60000)))
        .addSubcommand(s => s.setName('dedupe').setDescription('Set duplicate-message suppression window')
            .addIntegerOption(o => o.setName('milliseconds').setDescription('0-120000ms').setRequired(true).setMinValue(0).setMaxValue(120000)))
        .addSubcommand(s => s.setName('preservecode').setDescription('Preserve code blocks')
            .addBooleanOption(o => o.setName('enabled').setDescription('On/off').setRequired(true)))
        .addSubcommand(s => s.setName('preservementions').setDescription('Preserve Discord mentions and IDs')
            .addBooleanOption(o => o.setName('enabled').setDescription('On/off').setRequired(true)))
        .addSubcommand(s => s.setName('preserveurls').setDescription('Preserve URLs')
            .addBooleanOption(o => o.setName('enabled').setDescription('On/off').setRequired(true)))
        .addSubcommand(s => s.setName('ignorecommands').setDescription('Skip messages that look like commands')
            .addBooleanOption(o => o.setName('enabled').setDescription('On/off').setRequired(true)))
        .addSubcommand(s => s.setName('ignorebots').setDescription('Skip messages authored by bots')
            .addBooleanOption(o => o.setName('enabled').setDescription('On/off').setRequired(true))),
];

const prefixCommandNames = [
    { name: '!translate <target?> <text>', category: 'Translation', desc: 'Translate text using the selected server BYOK AI key.' },
    { name: '!autotranslate enable|disable|status|channel|target|source|key ...', category: 'Translation', desc: 'Configure automatic translation per server.' },
];

module.exports = {
    DEFAULT_TRANSLATION_CONFIG,
    LANGUAGE_NAMES,
    ensureTranslationConfig,
    translateText,
    formatTranslationResult,
    translationConfigSummary,
    TRANSLATION_VARIABLES,
    SUPPORTED_LANGUAGE_CODES,
    normalizeLanguage,
    validateTranslationConfig,
    translationConfigDiagnostics,
    translationStatusText,
    shouldSkipAutoTranslation,
    handleTranslateInteraction,
    handleTranslatePrefix,
    handleAutoTranslateMessage,
    slashCommandBuilders,
    prefixCommandNames,
};
