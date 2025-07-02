const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
// The GUILD_ID from your index.js, for registering commands to a specific server.
const GUILD_ID = '1372572233930903592'; 

const commands = [
    new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Mutes a user for a specified duration.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to mute.')
                .setRequired(true))
        .addStringOption(option => // Using String to match the fix in index.js
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
]
.map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        // The put method is used to fully refresh all commands in the guild with the current set
        const data = await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands },
        );

        console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        console.error(error);
    }
})();
