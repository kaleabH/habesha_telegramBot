const { Telegraf, Markup } = require('telegraf');
const mysql = require('mysql2/promise');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// MySQL Connection
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'habesha4336',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

async function initializeDatabase() {
    try {
        const db = await mysql.createPool(dbConfig);
        console.log('Database connected successfully');
        return db;
    } catch (error) {
        console.error('Failed to connect to the database:', error);
        throw new Error('Database connection failed');
    }
}

const db = initializeDatabase();

// Admin credentials
const adminId = 713655848; // Replace with your admin Telegram ID
const adminPassword = 'admin'; // Set your admin password

let isAdminAuthenticated = false;

// Middleware to check admin authentication
function isAdmin(ctx, next) {
    if (isAdminAuthenticated) {
        return next();
    } else {
        ctx.reply('You are not authorized to use admin commands.');
    }
}

// Help command to list all available commands
bot.command('help', (ctx) => {
    const commands = `
Available Commands:
/start - Start the bot
/check - Check if you have joined all required channels
/help - List all commands

Admin Commands:
/admin <password> - Authenticate as admin
/add_channel <channel_link> - Add a new channel
/remove_channel <channel_link> - Remove a channel
/add_ad <ad_type> <website_name> <ad_link> - Add an advertisement
/remove_ad <ad_link> - Remove an advertisement
/list_top_users <top> - List top users based on points
    `;
    ctx.reply(commands);
});

// Start command
bot.start(async (ctx) => {
    try {
        const connection = await db;
        const telegramId = ctx.from.id;
        const [rows] = await connection.query('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);

        if (rows.length === 0) {
            await connection.query('INSERT INTO users (telegram_id) VALUES (?)', [telegramId]);
            ctx.reply('Welcome! Please join the following channels to earn points:');
        } else {
            ctx.reply('Welcome back! Please use /check to see if you have joined all channels.');
        }

        const [channels] = await connection.query('SELECT * FROM channels');
        const channelList = channels.map(channel => `Join this channel: ${channel.channel_link}`).join('\n');
        ctx.reply(channelList);

        // Show the ad type options keyboard by default
        const adTypes = ['website', 'YouTube', 'TikTok', 'Playstore']; // Define your ad types here
        const buttons = adTypes.map(type => Markup.button.text(type));
        const keyboard = Markup.keyboard(buttons).resize();
        ctx.reply('Select ad type:', keyboard);

    } catch (error) {
        console.error('Error during start command:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

// Check command
bot.command('check', async (ctx) => {
    try {
        const connection = await db;
        const telegramId = ctx.from.id;
        const [user] = await connection.query('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);

        if (user.length > 0) {
            const [channels] = await connection.query('SELECT * FROM channels');
            const notJoinedChannels = []; // List of channels the user hasn't joined

            // This is where you would check if the user has joined each channel.
            // Since checking if a user has joined a channel requires Telegram API calls,
            // we assume the check is done and we return all channels as not joined.
            
            channels.forEach(channel => {
                notJoinedChannels.push(channel.channel_link);
            });

            if (notJoinedChannels.length > 0) {
                ctx.reply('You have not joined all required channels:');
                notJoinedChannels.forEach(channel => {
                    ctx.reply(channel);
                });
            } else {
                ctx.reply('You have joined all required channels! Here is your referral link: ' + user[0].referral_link);
            }
        } else {
            ctx.reply('You need to start the bot first using /start.');
        }
    } catch (error) {
        console.error('Error during check command:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

// Referral link generation (run this once when user joins all channels)
async function generateReferralLink(ctx, userId) {
    try {
        const connection = await db;
        const referralLink = `https://t.me/your_bot_username?start=${userId}`;
        await connection.query('UPDATE users SET referral_link = ? WHERE id = ?', [referralLink, userId]);
        ctx.reply('Here is your referral link: ' + referralLink);
    } catch (error) {
        console.error('Error generating referral link:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
}

// Admin login command
bot.command('admin', (ctx) => {
    const [_, password] = ctx.message.text.split(' ');
    if (ctx.from.id === adminId && password === adminPassword) {
        ctx.reply('Admin authenticated. You can now use admin commands.');
        isAdminAuthenticated = true;
    } else {
        ctx.reply('Incorrect password. Access denied.');
    }
});

// Admin commands to manage channels and advertisements (with authentication)
bot.command('add_channel', isAdmin, async (ctx) => {
    const channelLink = ctx.message.text.split(' ')[1];
    try {
        const connection = await db;
        await connection.query('INSERT INTO channels (channel_link) VALUES (?)', [channelLink]);
        ctx.reply('Channel added successfully.');
    } catch (error) {
        console.error('Error adding channel:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

bot.command('remove_channel', isAdmin, async (ctx) => {
    const channelLink = ctx.message.text.split(' ')[1];
    try {
        const connection = await db;
        await connection.query('DELETE FROM channels WHERE channel_link = ?', [channelLink]);
        ctx.reply('Channel removed successfully.');
    } catch (error) {
        console.error('Error removing channel:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

bot.command('add_ad', isAdmin, async (ctx) => {
    const [_, adType, websiteName, adLink] = ctx.message.text.split(' ');
    const adTypes = ['website', 'YouTube', 'TikTok', 'Playstore']; // Define your ad types here
    if (!adTypes.includes(adType)) {
        return ctx.reply('Invalid ad type. Please use one of the following: ' + adTypes.join(', '));
    }
    try {
        const connection = await db;
        await connection.query('INSERT INTO advertisements (ad_type, website_name, ad_link) VALUES (?, ?, ?)', [adType, websiteName, adLink]);
        ctx.reply('Advertisement added successfully.');
    } catch (error) {
        console.error('Error adding advertisement:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

bot.command('remove_ad', isAdmin, async (ctx) => {
    const adLink = ctx.message.text.split(' ')[1];
    try {
        const connection = await db;
        await connection.query('DELETE FROM advertisements WHERE ad_link = ?', [adLink]);
        ctx.reply('Advertisement removed successfully.');
    } catch (error) {
        console.error('Error removing advertisement:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

bot.command('list_top_users', isAdmin, async (ctx) => {
    const [_, top] = ctx.message.text.split(' ');
    try {
        const connection = await db;
        const [rows] = await connection.query('SELECT telegram_id, points FROM users ORDER BY points DESC LIMIT ?', [parseInt(top)]);
        if (rows.length > 0) {
            let response = `Top ${top} users:\n`;
            rows.forEach((user, index) => {
                response += `${index + 1}. Telegram ID: ${user.telegram_id}, Points: ${user.points}\n`;
            });
            ctx.reply(response);
        } else {
            ctx.reply('No users found.');
        }
    } catch (error) {
        console.error('Error listing top users:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

// Handler for ad_type button clicks
bot.hears(['website', 'YouTube', 'TikTok', 'Playstore'], async (ctx) => {
    const adType = ctx.message.text;
    try {
        const connection = await db;
        const [ads] = await connection.query('SELECT * FROM advertisements WHERE ad_type = ?', [adType]);
        if (ads.length > 0) {
            const buttons = ads.map(ad => Markup.button.url(ad.website_name, ad.ad_link));
            ctx.reply(`Advertisements for ${adType}:`, Markup.inlineKeyboard(buttons, { columns: 2 }));
        } else {
            ctx.reply(`No advertisements found for ${adType}.`);
        }
    } catch (error) {
        console.error(`Error fetching advertisements for ${adType}:`, error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

bot.launch();
