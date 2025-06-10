// bot.js
const fs = require('node:fs');
const path = require('node:path');
// MODIFIED: Removed InteractionResponseFlags as it's no longer needed.
const { Client, GatewayIntentBits, EmbedBuilder, Events } = require('discord.js');
require('dotenv').config();

// --- CONFIGURATION ---
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = '1372572233930903592';
const MOD_ROLE_IDS = ['1372979474857197688', '1381232791198367754'];
const MUTE_ROLE_ID = '1374410305991610520';
const LOG_CHANNEL_ID = '1381652662642147439';
// --- NEW: CHANNELS TO IGNORE FOR AUTO-MOD ---
const IGNORED_CHANNEL_IDS = ['1380834420189298718'];
const DATA_FILE = path.join(__dirname, 'mute_data.json');
// ---------------------

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

let muteData = {};
const userMessageCache = new Map();

// --- DATA HANDLING ---
function loadMuteData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const fileContent = fs.readFileSync(DATA_FILE, 'utf8');
            muteData = JSON.parse(fileContent);
        } else {
            muteData = {};
        }
    } catch (error) {
        console.error("Failed to load mute data:", error);
        muteData = {};
    }
}

function saveMuteData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(muteData, null, 4));
    } catch (error) {
        console.error("Failed to save mute data:", error);
    }
}

// --- TASKS ---
async function checkMutes() {
    const now = Date.now();
    const toRemove = [];
    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (!guild) return;

    for (const [muteId, info] of Object.entries(muteData)) {
        if (now >= info.endTime) {
            try {
                const member = await guild.members.fetch(info.userId).catch(() => null);
                if (member) {
                    await member.roles.remove(MUTE_ROLE_ID, 'Mute expired');
                    
                    const unmuteEmbed = new EmbedBuilder()
                        .setTitle(`You have been unmuted in ${guild.name}`)
                        .setColor(0x57F287) // Green
                        .setDescription("Your mute has expired and your permissions have been restored.")
                        .setTimestamp();
                    await member.send({ embeds: [unmuteEmbed] }).catch(() => {});
                }
                
                const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle("Member Unmuted (Automatic)")
                        .setColor(0x57F287) // Green
                        .addFields(
                            { name: "User", value: member ? member.toString() : `<@${info.userId}>`, inline: true },
                            { name: "Reason", value: "Mute duration expired", inline: true },
                            { name: "Punishment ID", value: `\`${muteId}\`` }
                        )
                        .setTimestamp()
                        .setFooter({ text: "Automated Action" });
                    await logChannel.send({ embeds: [logEmbed] });
                }
            } catch (error) {
                console.error(`Error processing expired mute for user ${info.userId}:`, error);
            }
            toRemove.push(muteId);
        }
    }

    if (toRemove.length > 0) {
        toRemove.forEach(id => delete muteData[id]);
        saveMuteData();
    }
}

// --- AUTO-MODERATION HELPER ---
async function alertAndLog(message, reason) {
    const embed = new EmbedBuilder()
        .setAuthor({ name: "Auto-Moderation Alert", iconURL: message.guild.iconURL() })
        .setColor(0xFEE75C) // Yellow
        .addFields(
            { name: "Triggered By", value: message.author.toString(), inline: true },
            { name: "In Channel", value: message.channel.toString(), inline: true },
            { name: "Reason", value: reason, inline: false },
            { name: "Message Content", value: `\`\`\`${message.content.substring(0, 500)}\`\`\`` }
        )
        .setTimestamp();

    try {
        const dmEmbed = new EmbedBuilder()
            .setTitle("Your Message Was Removed")
            .setColor(0xED4245) // Red
            .setDescription(`Your message in **${message.guild.name}** was automatically removed.`)
            .addFields({ name: "Reason", value: reason });
        await message.author.send({ embeds: [dmEmbed] });
    } catch (error) {
        // Can't DM user
    }

    const logChannel = message.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (logChannel) {
        await logChannel.send({ embeds: [embed] });
    }
}

// --- EVENTS ---
client.once(Events.ClientReady, c => {
    console.log(`Logged in as ${c.user.tag}`);
    loadMuteData();
    setInterval(checkMutes, 30 * 1000); // Check every 30 seconds for responsiveness
});

client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.guild) return;

    // --- NEW: Check if the message is in an ignored channel ---
    if (IGNORED_CHANNEL_IDS.includes(message.channel.id)) {
        return; // Skip all auto-moderation for this channel
    }

    // Spam Detection
    const now = Date.now();
    const userCache = userMessageCache.get(message.author.id) || [];
    const filteredCache = userCache.filter(ts => now - ts <= 5000); // 5 messages in 5 seconds
    filteredCache.push(now);
    userMessageCache.set(message.author.id, filteredCache);

    if (filteredCache.length > 5) {
        await message.delete().catch(() => {});
        await alertAndLog(message, "Spamming messages too quickly");
        userMessageCache.delete(message.author.id); // Clear cache after triggering
        return;
    }

    // Line Bypass Detection
    if ((message.content.match(/\n/g) || []).length > 10) {
        await message.delete().catch(() => {});
        await alertAndLog(message, "Excessive line breaks");
        return;
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    
    // Permission check for all moderation commands
    if (['mute', 'unmute', 'mod-log'].includes(commandName)) {
        if (!interaction.member.roles.cache.some(r => MOD_ROLE_IDS.includes(r.id))) {
             // FIXED: Use ephemeral: true for private replies.
             return interaction.reply({ content: 'You do not have the required permissions to use this command.', ephemeral: true });
        }
    }

    if (commandName === 'mute') {
        const user = interaction.options.getMember('user');
        const durationInput = interaction.options.getString('duration');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        
        const duration = parseInt(durationInput, 10);
        if (isNaN(duration) || duration <= 0) {
            // FIXED: Use ephemeral: true
            return interaction.reply({ content: 'Please provide a valid, positive number for the duration in minutes.', ephemeral: true });
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

        try {
            await user.roles.add(MUTE_ROLE_ID, reason);

            const muteId = `${Date.now()}-${user.id.slice(-4)}`;
            const endTime = Date.now() + duration * 60 * 1000;

            muteData[muteId] = {
                userId: user.id,
                guildId: interaction.guild.id,
                moderatorId: interaction.user.id,
                reason: reason,
                endTime: endTime,
            };
            saveMuteData();
            
            // FIXED: Use ephemeral: true
            await interaction.reply({ content: `Successfully muted ${user.toString()} for ${duration} minutes.`, ephemeral: true });

            await user.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`You have been muted in ${interaction.guild.name}`)
                        .setColor(0xED4245) // Red
                        .addFields(
                            { name: "Reason", value: reason },
                            { name: "Duration", value: `${duration} minutes` },
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
                        { name: "Duration", value: `${duration} minutes`, inline: true },
                        { name: "Reason", value: reason },
                        { name: "Expires", value: `<t:${Math.floor(endTime / 1000)}:F>` },
                        { name: "Punishment ID", value: `\`${muteId}\`` }
                    )
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] });
            }

        } catch (error) {
            console.error(error);
            // FIXED: Use ephemeral: true
            await interaction.reply({ content: 'Failed to mute user. Please double-check my role permissions and hierarchy.', ephemeral: true });
        }
    } else if (commandName === 'unmute') {
        const muteId = interaction.options.getString('mute_id');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        if (!muteData[muteId]) {
            // FIXED: Use ephemeral: true
            return interaction.reply({ content: `Mute ID \`${muteId}\` not found.`, ephemeral: true });
        }

        const info = muteData[muteId];
        const user = await interaction.guild.members.fetch(info.userId).catch(() => null);

        if (user) {
            await user.roles.remove(MUTE_ROLE_ID, reason);
            await user.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`You have been unmuted in ${interaction.guild.name}`)
                        .setColor(0x57F287) // Green
                        .setDescription(`Your permissions have been restored by a moderator.`)
                        .addFields({ name: "Reason", value: reason })
                        .setTimestamp()
                ]
            }).catch(() => {});
        }
        
        const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle("Member Unmuted (Manual)")
                .setColor(0x57F287) // Green
                .addFields(
                    { name: "User", value: user ? user.toString() : `<@${info.userId}>`, inline: true },
                    { name: "Moderator", value: interaction.user.toString(), inline: true },
                    { name: "Reason", value: reason, inline: false },
                    { name: "Original Punishment ID", value: `\`${muteId}\`` }
                )
                .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
        }
        
        delete muteData[muteId];
        saveMuteData();
        // FIXED: Use ephemeral: true
        await interaction.reply({ content: `Successfully unmuted ${user ? user.toString() : `user ID ${info.userId}`}.`, ephemeral: true });

    } else if (commandName === 'mod-log') {
        const user = interaction.options.getUser('user');
        const activeMutes = Object.entries(muteData).filter(([, data]) => data.userId === user.id && data.guildId === interaction.guild.id);

        if (activeMutes.length === 0) {
            // FIXED: Use ephemeral: true
            return interaction.reply({ content: `${user.toString()} has no active mutes.`, ephemeral: true });
        }
        
        const embed = new EmbedBuilder()
            .setTitle(`Active Punishments for ${user.tag}`)
            .setColor(0x5865F2) // Blurple
            .setThumbnail(user.displayAvatarURL())
            .setTimestamp();

        activeMutes.forEach(([mid, data]) => {
            const moderator = interaction.guild.members.cache.get(data.moderatorId);
            embed.addFields({
                name: `Mute ID: \`${mid}\``,
                value: `**Reason:** ${data.reason}\n` +
                       `**Moderator:** ${moderator ? moderator.toString() : 'Unknown'}\n` +
                       `**Expires:** <t:${Math.floor(data.endTime / 1000)}:R>`
            });
        });
        
        // FIXED: Use ephemeral: true
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

// Add a general error handler to prevent unexpected crashes
client.on('error', console.error);
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

client.login(TOKEN);