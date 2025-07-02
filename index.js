// bot.js
const fs = require('node:fs');
const path = require('node:path');
// MODIFIED: Removed InteractionResponseFlags as it's no longer needed.
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    Events,
    REST,
    Routes,
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
require('dotenv').config();

// --- CONFIGURATION ---
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = '1372572233930903592';
const MOD_ROLE_IDS = ['1372979474857197688', '1381232791198367754'];
const MUTE_ROLE_ID = '1374410305991610520';
const BANNED_ROLE_ID = '1382000757200654427';
const LOG_CHANNEL_ID = '1381652662642147439';
// Channel for logging bot errors
const BOT_LOG_CHANNEL_ID = '1383481711651721307';
const PUNISH_FILE = path.join(__dirname, 'punishments.json');
const WARN_FILE = path.join(__dirname, 'warns.json');
const WARN_EXPIRE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// ---------------------

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

let punishmentData = {};
let warnData = {};
let botLogChannel = null;

async function reportError(error) {
    console.error(error);
    if (botLogChannel) {
        const message = `Error: ${error && error.stack ? error.stack : error}`;
        await botLogChannel.send(message).catch(() => {});
    }
}

function isExempt(member) {
    return member.id === member.guild.ownerId ||
        member.roles.cache.some(r => MOD_ROLE_IDS.includes(r.id));
}

// --- SLASH COMMAND REGISTRATION ---
const commands = [
    new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Mutes a user for a specified duration.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to mute.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Duration of the mute (e.g., "30m", "2h", "1d").')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for the mute.')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warns a user. Warns expire after 30 days.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to warn.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for the warning.')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('remove-punishment')
        .setDescription('Removes a mute or ban by its ID.')
        .addStringOption(option =>
            option.setName('id')
                .setDescription('The ID of the punishment to remove.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for removal.')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('mod-log')
        .setDescription("Checks a user's current active punishments.")
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to check.')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('clear-message')
        .setDescription('Bulk deletes a number of recent messages.')
        .addIntegerOption(option =>
            option.setName('count')
                .setDescription('Number of messages to delete (max 100).')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Only delete messages from this user.')
                .setRequired(false)),
].map(command => command.toJSON());

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        const data = await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands }
        );
        console.log(`Registered ${data.length} application commands.`);
    } catch (error) {
        await reportError(`Failed to register commands: ${error}`);
    }
}

// --- DATA HANDLING ---
function loadData() {
    try {
        if (fs.existsSync(PUNISH_FILE)) {
            const fileContent = fs.readFileSync(PUNISH_FILE, 'utf8');
            punishmentData = JSON.parse(fileContent);
        } else {
            punishmentData = {};
        }
        if (fs.existsSync(WARN_FILE)) {
            const warnContent = fs.readFileSync(WARN_FILE, 'utf8');
            warnData = JSON.parse(warnContent);
        } else {
            warnData = {};
        }
    } catch (error) {
        reportError(`Failed to load moderation data: ${error}`);
        punishmentData = {};
        warnData = {};
    }
}

function saveData() {
    try {
        fs.writeFileSync(PUNISH_FILE, JSON.stringify(punishmentData, null, 4));
        fs.writeFileSync(WARN_FILE, JSON.stringify(warnData, null, 4));
    } catch (error) {
        reportError(`Failed to save moderation data: ${error}`);
    }
}

// --- TASKS ---
async function checkPunishments() {
    const now = Date.now();
    const toRemove = [];
    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (!guild) return;

    for (const [pid, info] of Object.entries(punishmentData)) {
        if (now >= info.endTime) {
            try {
                const member = await guild.members.fetch(info.userId).catch(() => null);
                if (member) {
                    if (info.type === 'mute') {
                        await member.roles.remove(MUTE_ROLE_ID, 'Mute expired');
                    } else if (info.type === 'ban') {
                        await member.roles.remove(BANNED_ROLE_ID, 'Ban expired');
                    }

                    const title = info.type === 'ban' ? 'Your ban has expired' : 'You have been unmuted';
                    const embed = new EmbedBuilder()
                        .setTitle(`${title} in ${guild.name}`)
                        .setColor(0x57F287)
                        .setDescription('Your punishment has expired and your permissions have been restored.')
                        .setTimestamp();
                    await member.send({ embeds: [embed] }).catch(() => {});
                }

                const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle(`Member ${info.type === 'ban' ? 'Ban' : 'Mute'} Expired`)
                        .setColor(0x57F287)
                        .addFields(
                            { name: 'User', value: member ? member.toString() : `<@${info.userId}>`, inline: true },
                            { name: 'Reason', value: info.reason, inline: true },
                            { name: 'Punishment ID', value: `\`${pid}\`` }
                        )
                        .setTimestamp()
                        .setFooter({ text: 'Automated Action' });
                    await logChannel.send({ embeds: [logEmbed] });
                }
            } catch (error) {
                await reportError(`Error processing expired punishment for user ${info.userId}: ${error}`);
            }
            toRemove.push(pid);
        }
    }

    if (toRemove.length > 0) {
        toRemove.forEach(id => delete punishmentData[id]);
        saveData();
    }

    // Expire old warnings
    for (const [uid, warns] of Object.entries(warnData)) {
        warnData[uid] = warns.filter(w => now - w.timestamp <= 30 * 24 * 60 * 60 * 1000);
        if (warnData[uid].length === 0) delete warnData[uid];
    }
    saveData();
}

function addWarn(userId, reason) {
    const warns = warnData[userId] || [];
    const warnId = `${Date.now()}-${userId.slice(-4)}`;
    warns.push({ id: warnId, reason, timestamp: Date.now() });
    warnData[userId] = warns;
    saveData();
    return { warnId, warnCount: warns.length };
}

function parseDuration(input) {
    let total = 0;
    const regex = /(\d+)([smhd]?)/gi;
    let match;
    while ((match = regex.exec(input)) !== null) {
        const value = parseInt(match[1], 10);
        const unit = match[2] || 'm';
        if (unit === 's') total += value / 60;
        else if (unit === 'h') total += value * 60;
        else if (unit === 'd') total += value * 1440;
        else total += value;
    }
    return Math.round(total);
}

function formatDuration(minutes) {
    const units = [
        { label: 'month', value: 43200 },
        { label: 'day', value: 1440 },
        { label: 'hour', value: 60 },
        { label: 'minute', value: 1 }
    ];
    const parts = [];
    for (const { label, value } of units) {
        if (minutes >= value) {
            const amount = Math.floor(minutes / value);
            if (amount > 0) {
                parts.push(`${amount} ${label}${amount === 1 ? '' : 's'}`);
                minutes %= value;
            }
        }
    }
    return parts.join(' ');
}

async function applyPunishment(member, type, durationMinutes, reason, moderatorId) {
    let punishId = `${Date.now()}-${member.id.slice(-4)}`;
    let endTime = Date.now() + durationMinutes * 60 * 1000;

    // --- STACKING LOGIC FOR MUTES ---
    if (type === 'mute') {
        for (const [id, data] of Object.entries(punishmentData)) {
            if (data.userId === member.id && data.guildId === member.guild.id && data.type === 'mute') {
                // Extend existing mute
                endTime = Math.max(data.endTime, Date.now()) + durationMinutes * 60 * 1000;
                punishmentData[id].endTime = endTime;
                punishmentData[id].reason = reason; // update reason to latest
                punishId = id;
                saveData();
                const roleId = MUTE_ROLE_ID;
                await member.roles.add(roleId, reason);
                return { punishId, endTime };
            }
        }
    }

    punishmentData[punishId] = {
        userId: member.id,
        guildId: member.guild.id,
        moderatorId,
        reason,
        endTime,
        type
    };
    saveData();

    const roleId = type === 'ban' ? BANNED_ROLE_ID : MUTE_ROLE_ID;
    await member.roles.add(roleId, reason);
    return { punishId, endTime };
}

// --- EVENTS ---
client.once(Events.ClientReady, async c => {
    console.log(`Logged in as ${c.user.tag}`);
    await registerCommands();
    loadData();
    botLogChannel = await client.channels.fetch(BOT_LOG_CHANNEL_ID).catch(() => null);
    setInterval(checkPunishments, 30 * 1000); // Check every 30 seconds
});


client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isButton()) {
        const [action, userId, page] = interaction.customId.split(':');
        if (action === 'show_warns') {
            const warns = warnData[userId] || [];
            const pageNum = parseInt(page, 10) || 0;
            const perPage = 5;
            const start = pageNum * perPage;
            const slice = warns.slice(start, start + perPage);
            const member = await interaction.guild.members.fetch(userId).catch(() => null);
            const embed = new EmbedBuilder()
                .setTitle(`Warns for ${member ? member.user.tag : userId}`)
                .setColor(0x5865F2)
                .setTimestamp();

            slice.forEach(w => {
                embed.addFields({
                    name: `Warn ID: \`${w.id}\``,
                    value: `**Reason:** ${w.reason}\n**Expires:** <t:${Math.floor((w.timestamp + WARN_EXPIRE_MS)/1000)}:R>`
                });
            });

            const maxPage = Math.ceil(warns.length / perPage);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`show_warns:${userId}:${pageNum - 1}`)
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(pageNum <= 0),
                new ButtonBuilder()
                    .setCustomId(`show_warns:${userId}:${pageNum + 1}`)
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(pageNum >= maxPage - 1)
            );

            await interaction.update({ embeds: [embed], components: [row] });
            return;
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    try {

    // Permission check for all moderation commands
    if (['mute', 'warn', 'remove-punishment', 'mod-log', 'clear-message'].includes(commandName)) {
        if (!interaction.member.roles.cache.some(r => MOD_ROLE_IDS.includes(r.id))) {
             // FIXED: Use ephemeral: true for private replies.
             return interaction.reply({ content: 'You do not have the required permissions to use this command.', ephemeral: true });
        }
    }

    if (commandName === 'mute') {
        const user = interaction.options.getMember('user');
        const durationInput = interaction.options.getString('duration');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        if (isExempt(user)) {
            return interaction.reply({ content: 'You cannot mute the server owner or staff members.', ephemeral: true });
        }
        
        const duration = parseDuration(durationInput);
        const prettyDuration = formatDuration(duration);
        if (isNaN(duration) || duration <= 0) {
            return interaction.reply({ content: 'Please provide a valid duration such as "30m", "2h", or "1d".', ephemeral: true });
        }
        
        // --- HIERARCHY CHECKS ---
        if (user.id === interaction.guild.ownerId) {
            // FIXED: Use ephemeral: true
            return interaction.reply({ content: "You cannot mute the server owner.", ephemeral: true });
        }
        
        const botMember = await interaction.guild.members.fetch(client.user.id);
        if (user.roles.highest.position >= botMember.roles.highest.position) {
            // FIXED: Use ephemeral: true
            return interaction.reply({ content: "I cannot mute this user because they have a role equal to or higher than mine.", ephemeral: true });
        }

        if (user.roles.highest.position >= interaction.member.roles.highest.position) {
            // FIXED: Use ephemeral: true
            return interaction.reply({ content: "You cannot mute this user because they have a role equal to or higher than yours.", ephemeral: true });
        }
        // --- END OF HIERARCHY CHECKS ---

        await interaction.deferReply({ ephemeral: true });

        try {
            const { punishId, endTime } = await applyPunishment(user, 'mute', duration, reason, interaction.user.id);

            await interaction.editReply({ content: `Successfully muted ${user.toString()} for ${prettyDuration}.` });

            await user.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`You have been muted in ${interaction.guild.name}`)
                        .setColor(0xED4245) // Red
                        .addFields(
                            { name: "Reason", value: reason },
                            { name: "Duration", value: prettyDuration },
                            { name: "Expires", value: `<t:${Math.floor(endTime / 1000)}:R>` }
                        )
                        .setTimestamp()
                ]
            }).catch(() => {});
            
            const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle("Member Muted")
                    .setColor(0xED4245) // Red
                    .addFields(
                        { name: "User", value: user.toString(), inline: true },
                        { name: "Moderator", value: interaction.user.toString(), inline: true },
                        { name: "Duration", value: prettyDuration, inline: true },
                        { name: "Reason", value: reason },
                        { name: "Expires", value: `<t:${Math.floor(endTime / 1000)}:F>` },
                        { name: "Punishment ID", value: `\`${punishId}\`` }
                    )
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] });
            }

        } catch (error) {
            await reportError(error);
            await interaction.editReply({ content: 'Failed to mute user. Please double-check my role permissions and hierarchy.' });
        }
    } else if (commandName === 'warn') {
        const user = interaction.options.getMember('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        if (isExempt(user)) {
            return interaction.reply({ content: 'You cannot warn the server owner or staff members.', ephemeral: true });
        }

        // --- HIERARCHY CHECKS ---
        if (user.id === interaction.guild.ownerId) {
            return interaction.reply({ content: 'You cannot warn the server owner.', ephemeral: true });
        }

        const botMember = await interaction.guild.members.fetch(client.user.id);
        if (user.roles.highest.position >= botMember.roles.highest.position) {
            return interaction.reply({ content: 'I cannot warn this user because they have a role equal to or higher than mine.', ephemeral: true });
        }

        if (user.roles.highest.position >= interaction.member.roles.highest.position) {
            return interaction.reply({ content: 'You cannot warn this user because they have a role equal to or higher than yours.', ephemeral: true });
        }
        // --- END OF HIERARCHY CHECKS ---

        await interaction.deferReply({ ephemeral: true });

        try {
            const { warnId, warnCount } = addWarn(user.id, reason);
            const expireTs = Math.floor((Date.now() + WARN_EXPIRE_MS) / 1000);

            await interaction.editReply({ content: `Warned ${user.toString()} (warn #${warnCount}).` });

            await user.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`You have been warned in ${interaction.guild.name}`)
                        .setColor(0xED4245)
                        .addFields(
                            { name: 'Reason', value: reason },
                            { name: 'Warn Count', value: `${warnCount}` },
                            { name: 'Warn ID', value: `\`${warnId}\`` },
                            { name: 'Expires', value: `<t:${expireTs}:R>` }
                        )
                        .setTimestamp()
                ]
            }).catch(() => {});

            const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('Member Warned')
                    .setColor(0xFEE75C)
                    .addFields(
                        { name: 'User', value: user.toString(), inline: true },
                        { name: 'Moderator', value: interaction.user.toString(), inline: true },
                        { name: 'Reason', value: reason },
                        { name: 'Warn Count', value: `${warnCount}`, inline: true },
                        { name: 'Warn ID', value: `\`${warnId}\`` },
                        { name: 'Expires', value: `<t:${expireTs}:R>` }
                    )
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] });
            }
        } catch (error) {
            await reportError(error);
            await interaction.editReply({ content: 'Failed to warn user. Please double-check my role permissions and hierarchy.' });
        }
    } else if (commandName === 'remove-punishment') {
        const punishId = interaction.options.getString('id');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        let info = punishmentData[punishId];
        let isWarn = false;
        let warnUserId = null;

        if (!info) {
            for (const [uid, warns] of Object.entries(warnData)) {
                const idx = warns.findIndex(w => w.id === punishId);
                if (idx !== -1) {
                    info = warns[idx];
                    warnUserId = uid;
                    isWarn = true;
                    warns.splice(idx, 1);
                    if (warns.length === 0) delete warnData[uid];
                    break;
                }
            }
            if (!info) {
                return interaction.reply({ content: `Punishment ID \`${punishId}\` not found.`, ephemeral: true });
            }
        }

        const user = await interaction.guild.members.fetch(isWarn ? warnUserId : info.userId).catch(() => null);

        await interaction.deferReply({ ephemeral: true });

        try {
            if (user && !isWarn) {
                const roleId = info.type === 'ban' ? BANNED_ROLE_ID : MUTE_ROLE_ID;
                await user.roles.remove(roleId, reason);
                await user.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle(`Your punishment was removed in ${interaction.guild.name}`)
                            .setColor(0x57F287)
                            .setDescription(`Your permissions have been restored by a moderator.`)
                            .addFields({ name: "Reason", value: reason })
                            .setTimestamp()
                    ]
                }).catch(() => {});
            } else if (user && isWarn) {
                await user.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle(`Your warning was removed in ${interaction.guild.name}`)
                            .setColor(0x57F287)
                            .addFields({ name: 'Reason', value: reason })
                            .setTimestamp()
                    ]
                }).catch(() => {});
            }

            const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
            if (logChannel) {
                const title = isWarn ? 'Warning Removed' : 'Punishment Removed';
                const logEmbed = new EmbedBuilder()
                    .setTitle(title)
                    .setColor(0x57F287)
                    .addFields(
                        { name: 'User', value: user ? user.toString() : `<@${isWarn ? warnUserId : info.userId}>`, inline: true },
                        { name: 'Moderator', value: interaction.user.toString(), inline: true },
                        { name: 'Reason', value: reason, inline: false },
                        { name: 'Original ID', value: `\`${punishId}\`` }
                    )
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] });
            }

            if (!isWarn) {
                delete punishmentData[punishId];
            }
            saveData();
            await interaction.editReply({ content: `Successfully removed ${isWarn ? 'warning' : 'punishment'} from ${user ? user.toString() : `user ID ${isWarn ? warnUserId : info.userId}`}.` });
        } catch (error) {
            await reportError(error);
            await interaction.editReply({ content: 'Failed to remove punishment. Please check my permissions.' });
        }

    } else if (commandName === 'mod-log') {
        const user = interaction.options.getUser('user');
        const activePunishments = Object.entries(punishmentData).filter(([, data]) => data.userId === user.id && data.guildId === interaction.guild.id);
        const userWarns = warnData[user.id] || [];
        let totalMuteMs = 0;

        await interaction.deferReply({ ephemeral: true });

        const embed = new EmbedBuilder()
            .setTitle(`Active Punishments for ${user.tag}`)
            .setColor(0x5865F2) // Blurple
            .setThumbnail(user.displayAvatarURL())
            .setTimestamp();

        activePunishments.forEach(([mid, data]) => {
            const moderator = interaction.guild.members.cache.get(data.moderatorId);
            if (data.type === 'mute') {
                totalMuteMs += Math.max(0, data.endTime - Date.now());
            }
            embed.addFields({
                name: `${data.type === 'ban' ? 'Ban' : 'Mute'} ID: \`${mid}\``,
                value: `**Reason:** ${data.reason}\n` +
                       `**Moderator:** ${moderator ? moderator.toString() : 'Unknown'}\n` +
                       `**Expires:** <t:${Math.floor(data.endTime / 1000)}:R>`
            });
        });

        if (activePunishments.length === 0) {
            embed.setDescription(`${user.toString()} has no active punishments.`);
        }

        if (totalMuteMs > 0) {
            embed.addFields({ name: 'Total Mute Time', value: `${Math.ceil(totalMuteMs / 60000)} minutes` });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`show_warns:${user.id}:0`)
                .setLabel(`Show Warns (${userWarns.length})`)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(userWarns.length === 0)
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
    } else if (commandName === 'clear-message') {
        const count = interaction.options.getInteger('count');
        const targetUser = interaction.options.getUser('user');

        if (count <= 0 || count > 100) {
            return interaction.reply({ content: 'Count must be between 1 and 100.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            let messages = await interaction.channel.messages.fetch({ limit: 100 });
            if (targetUser) {
                messages = messages.filter(m => m.author.id === targetUser.id);
            }
            const toDelete = messages.first(count);
            const deleted = await interaction.channel.bulkDelete(toDelete, true);
            await interaction.editReply({ content: `Deleted ${deleted.size} messages${targetUser ? ` from ${targetUser.tag}` : ''}.` });
        } catch (error) {
            await reportError(error);
            await interaction.editReply({ content: 'Failed to delete messages. Please check my permissions.' });
        }
    }
    } catch (error) {
        await reportError(error);
        if (!interaction.replied) {
            await interaction.reply({ content: 'An unexpected error occurred.', ephemeral: true });
        }
    }
});

// Add a general error handler to prevent unexpected crashes
client.on('error', reportError);
process.on('unhandledRejection', error => {
    reportError(error);
});

client.login(TOKEN);
