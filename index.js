const { Telegraf, Markup } = require('telegraf');
const mysql = require('mysql2/promise');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// MySQL Connection
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'habesha4339',
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
const userStates = {}; // Store states for users

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
    `;
    ctx.reply(commands);
});

// Start command
bot.start(async (ctx) => {
    try {
        const connection = await db;
        const telegramId = ctx.from.id;
        const username = ctx.from.username || ''; // Get the username or use an empty string if not available
        const [rows] = await connection.query('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);

        if (rows.length === 0) {
            const referrerId = ctx.startPayload ? parseInt(ctx.startPayload, 10) : null;
            await connection.query('INSERT INTO users (telegram_id, referrer_id, username) VALUES (?, ?, ?)', [telegramId, referrerId, username]);
            ctx.reply('Welcome! Please join the following channels to earn points:');
            ctx.reply('እንኳን ደና መጡ! ሁሉንም ቻናሎች በመቀላቀል ሽልማት ያግኙ:በመቀጠል  "/check"  ሲሉ  "referal link" ያገኛሉ');
        } else {
            ctx.reply('Welcome back! Please use /check to see if you have joined all channels.');
            ctx.reply('እንኳን ደና መጡ! ሁሉንም ቻናሎች በመቀላቀል ሽልማት ያግኙ:በመቀጠል  "/check"  ሲሉ  "referal link" ያገኛሉ');
        }

        const [channels] = await connection.query('SELECT * FROM channels');
        const channelList = channels.map(channel => `Join this channel: ${channel.channel_link}`).join('\n');
        ctx.reply(channelList);

        // Fetch ad types and links from the database
        const [ads] = await connection.query('SELECT ad_type FROM advertisements');
        const adTypes = ads.map(ad => ad.ad_type);
        const keyboard = Markup.keyboard(adTypes.map(type => [type])).resize().oneTime();
        ctx.reply('Select an ad type:', keyboard);

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
            const userId = user[0].id;
            const [channels] = await connection.query('SELECT * FROM channels');
            let joinedAllChannels = true;
            let notJoinedChannels = [];

            // Check if the user has joined each channel
            for (const channel of channels) {
                let chatId = channel.channel_link;

                // Extract the username if the link is in the format https://t.me/username
                if (chatId.startsWith('https://t.me/')) {
                    chatId = chatId.replace('https://t.me/', '@');
                }

                try {
                    const member = await bot.telegram.getChatMember(chatId, telegramId);
                    if (member.status === 'left' || member.status === 'kicked') {
                        joinedAllChannels = false;
                        notJoinedChannels.push(channel.channel_link);
                    }
                } catch (error) {
                    if (error.response && (error.response.error_code === 400 || error.response.error_code === 403)) {
                        // Treat errors like "user not found" or "chat not found" as the user being joined
                        console.warn(`Error checking membership for ${channel.channel_link}: ${error.description}`);
                    } else {
                        console.error(`Unexpected error checking membership for ${channel.channel_link}:`, error);
                        joinedAllChannels = false;
                        notJoinedChannels.push(channel.channel_link);
                    }
                }
            }

            if (joinedAllChannels) {
                ctx.reply('You have joined all required channels.');
                await generateReferralLink(ctx, userId);
            } else {
                let notJoinedMessage = 'You have not joined all required channels. Please join the following channels:\n';
                notJoinedMessage += notJoinedChannels.map(link => `- ${link}`).join('\n');
                ctx.reply(notJoinedMessage);
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
        const referralLink = `https://t.me/${ctx.botInfo.username}?start=${userId}`;
        await connection.query('UPDATE users SET referral_link = ?, points = points + 1 WHERE id = ?', [referralLink, userId]);
        ctx.reply('Here is your referral link: ' + referralLink);

        // Award point to referrer if exists
        const [user] = await connection.query('SELECT referrer_id FROM users WHERE id = ?', [userId]);
        if (user[0].referrer_id) {
            await connection.query('UPDATE users SET points = points + 1 WHERE id = ?', [user[0].referrer_id]);
        }
    } catch (error) {
        console.error('Error generating referral link:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
}

// Admin login command
bot.command('admin', (ctx) => {
    const [_, password] = ctx.message.text.split(' ');
    if (ctx.from.id === adminId && password === adminPassword) {
        ctx.reply('Admin authenticated. You can now use admin commands.', Markup.inlineKeyboard([
            [Markup.button.callback('Add Channel', 'add_channel')],
            [Markup.button.callback('Remove Channel', 'remove_channel')],
            [Markup.button.callback('Add Advertisement', 'add_ad')],
            [Markup.button.callback('Remove Advertisement', 'remove_ad')],
            [Markup.button.callback('List Top Users', 'list_top_users')],
            [Markup.button.callback('List Referrals', 'list_referrals')]
        ]));
        isAdminAuthenticated = true;
    } else {
        ctx.reply('Incorrect password. Access denied.');
    }
});

// Admin action handlers
// Add Channel Command
bot.action('add_channel', isAdmin, (ctx) => {
    userStates[ctx.from.id] = 'awaiting_channel_link';
    ctx.reply('Please enter the channel link to add (e.g., https://t.me/yourchannel):', Markup.forceReply());
});

bot.on('text', async (ctx) => {
    const adminId = ctx.from.id;

    if (userStates[adminId] === 'awaiting_channel_link') {
        const channelLink = ctx.message.text;

        // Validate Telegram channel link format
        const validChannelFormat = /^https:\/\/t\.me\/.+/;
        if (!validChannelFormat.test(channelLink)) {
            ctx.reply('Invalid channel link format. Please provide a valid Telegram channel link (e.g., https://t.me/yourchannel).');
            return;
        }

        try {
            const connection = await db;
            const [existingChannels] = await connection.query('SELECT * FROM channels WHERE channel_link = ?', [channelLink]);

            if (existingChannels.length > 0) {
                ctx.reply('Channel already exists.');
            } else {
                await connection.query('INSERT INTO channels (channel_link) VALUES (?)', [channelLink]);
                ctx.reply('Channel added successfully.');
            }
        } catch (error) {
            console.error('Error adding channel:', error);
            ctx.reply('An error occurred while adding the channel. Please try again later.');
        } finally {
            delete userStates[adminId]; // Reset the state
        }
    } else if (userStates[adminId] === 'awaiting_channel_removal') {
        const channelLink = ctx.message.text;

        try {
            const connection = await db;
            const [existingChannels] = await connection.query('SELECT * FROM channels WHERE channel_link = ?', [channelLink]);

            if (existingChannels.length > 0) {
                await connection.query('DELETE FROM channels WHERE channel_link = ?', [channelLink]);
                ctx.reply('Channel removed successfully.');
            } else {
                ctx.reply('Channel not found.');
            }
        } catch (error) {
            console.error('Error removing channel:', error);
            ctx.reply('An error occurred while removing the channel. Please try again later.');
        } finally {
            delete userStates[adminId]; // Reset the state
        }
    } else {
        const adTypes = await getAdTypesFromDatabase();
        if (adTypes.includes(ctx.message.text)) {
            // User selected an ad type
            await sendAdLink(ctx, ctx.message.text);
        } else {
            ctx.reply('Unknown command. Please use /help to see the list of available commands.');
        }
    }
});

// ----------------   remove channel ----------------
bot.action('remove_channel', isAdmin, async (ctx) => {
    try {
        const connection = await db;
        const [channels] = await connection.query('SELECT * FROM channels');
        const keyboard = Markup.inlineKeyboard(channels.map(channel => [Markup.button.callback(channel.channel_link, `remove_channel_${channel.id}`)]));
        ctx.reply('Select a channel to remove:', keyboard);
    } catch (error) {
        console.error('Error fetching channels:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

bot.action(/^remove_channel_(\d+)$/, isAdmin, async (ctx) => {
    const channelId = ctx.match[1];
    try {
        const connection = await db;
        await connection.query('DELETE FROM channels WHERE id = ?', [channelId]);
        ctx.reply('Channel removed successfully.');
    } catch (error) {
        console.error('Error removing channel:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

// ------------------ADD AD COMMAND ----------------
// Add Advertisement Command
bot.action('add_ad', isAdmin, (ctx) => {
    userStates[ctx.from.id] = 'awaiting_ad_details';
    ctx.reply('Please enter the advertisement type and link in the following format:\n\nad_type, ad_link');
});

bot.on('text', async (ctx) => {
    const adminId = ctx.from.id;

    if (userStates[adminId] === 'awaiting_ad_details') {
        const adInput = ctx.message.text.split(',').map(item => item.trim());
        if (adInput.length !== 2) {
            ctx.reply('Invalid format. Please provide the advertisement type and link in the format:\n\nad_type, ad_link');
            return;
        }

        const [adType, adLink] = adInput;

        // Validate URL format
        const validUrlFormat = /^https?:\/\/.+/;
        if (!validUrlFormat.test(adLink)) {
            ctx.reply('Invalid ad link format. Please provide a valid URL (e.g., https://example.com).');
            return;
        }

        try {
            const connection = await db;
            const [existingAds] = await connection.query('SELECT * FROM advertisements WHERE ad_type = ? AND ad_link = ?', [adType, adLink]);

            if (existingAds.length > 0) {
                ctx.reply('Advertisement already exists.');
            } else {
                await connection.query('INSERT INTO advertisements (ad_type, ad_link) VALUES (?, ?)', [adType, adLink]);
                ctx.reply('Advertisement added successfully.');
            }
        } catch (error) {
            console.error('Error adding advertisement:', error);
            ctx.reply('An error occurred while adding the advertisement. Please try again later.');
        } finally {
            delete userStates[adminId]; // Reset the state
        }
    } else if (userStates[adminId] === 'awaiting_channel_link') {
        // Existing add_channel handling
        const channelLink = ctx.message.text;

        // Validate Telegram channel link format
        const validChannelFormat = /^https:\/\/t\.me\/.+/;
        if (!validChannelFormat.test(channelLink)) {
            ctx.reply('Invalid channel link format. Please provide a valid Telegram channel link (e.g., https://t.me/yourchannel).');
            return;
        }

        try {
            const connection = await db;
            const [existingChannels] = await connection.query('SELECT * FROM channels WHERE channel_link = ?', [channelLink]);

            if (existingChannels.length > 0) {
                ctx.reply('Channel already exists.');
            } else {
                await connection.query('INSERT INTO channels (channel_link) VALUES (?)', [channelLink]);
                ctx.reply('Channel added successfully.');
            }
        } catch (error) {
            console.error('Error adding channel:', error);
            ctx.reply('An error occurred while adding the channel. Please try again later.');
        } finally {
            delete userStates[adminId]; // Reset the state
        }
    } else if (userStates[adminId] === 'awaiting_channel_removal') {
        // Existing remove_channel handling
        const channelLink = ctx.message.text;

        try {
            const connection = await db;
            const [existingChannels] = await connection.query('SELECT * FROM channels WHERE channel_link = ?', [channelLink]);

            if (existingChannels.length > 0) {
                await connection.query('DELETE FROM channels WHERE channel_link = ?', [channelLink]);
                ctx.reply('Channel removed successfully.');
            } else {
                ctx.reply('Channel not found.');
            }
        } catch (error) {
            console.error('Error removing channel:', error);
            ctx.reply('An error occurred while removing the channel. Please try again later.');
        } finally {
            delete userStates[adminId]; // Reset the state
        }
    } else {
        const adTypes = await getAdTypesFromDatabase();
        if (adTypes.includes(ctx.message.text)) {
            // User selected an ad type
            await sendAdLink(ctx, ctx.message.text);
        } else {
            ctx.reply('Unknown command. Please use /help to see the list of available commands.');
        }
    }
});


// -----------Remove Add ----------
bot.action('remove_ad', isAdmin, async (ctx) => {
    try {
        const connection = await db;
        const [ads] = await connection.query('SELECT * FROM advertisements');
        const keyboard = Markup.inlineKeyboard(ads.map(ad => [Markup.button.callback(`${ad.ad_type} - ${ad.ad_link}`, `remove_ad_${ad.id}`)]));
        ctx.reply('Select an ad to remove:', keyboard);
    } catch (error) {
        console.error('Error fetching ads:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

bot.action(/^remove_ad_(\d+)$/, isAdmin, async (ctx) => {
    const adId = ctx.match[1];
    try {
        const connection = await db;
        await connection.query('DELETE FROM advertisements WHERE id = ?', [adId]);
        ctx.reply('Ad removed successfully.');
    } catch (error) {
        console.error('Error removing ad:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

//----------List top users ------------

bot.action('list_top_users', isAdmin, async (ctx) => {
    try {
        const connection = await db;
        const [topUsers] = await connection.query('SELECT username, points FROM users ORDER BY points DESC LIMIT 200');
        let message = 'Top 200 Users:\n';
        topUsers.forEach((user, index) => {
            message += `${index + 1}. ${user.username} - ${user.points} points\n`;
        });
        ctx.reply(message);
    } catch (error) {
        console.error('Error listing top users:', error);
        ctx.reply('An error occurred while listing top users. Please try again later.');
    }
});


//----------------List Referrals ------
bot.action('list_referrals', isAdmin, async (ctx) => {
    try {
        const connection = await db;
        const [users] = await connection.query(`
            SELECT u1.username AS referrer, u2.username AS referred
            FROM users u1
            JOIN users u2 ON u1.id = u2.referrer_id
            ORDER BY u1.username, u2.username
        `);
        const referralsList = users.map(user => `Referrer: ${user.referrer || 'Unknown'} - Referred: ${user.referred || 'Unknown'}`).join('\n');
        ctx.reply('Referrals List:\n' + referralsList);
    } catch (error) {
        console.error('Error fetching referrals:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
});

// Fetch ad types from the database
async function getAdTypesFromDatabase() {
    const connection = await db;
    const [ads] = await connection.query('SELECT ad_type FROM advertisements');
    return ads.map(ad => ad.ad_type);
}

// Send ad link based on selected ad type
async function sendAdLink(ctx, adType) {
    try {
        const connection = await db;
        const [ad] = await connection.query('SELECT ad_link FROM advertisements WHERE ad_type = ?', [adType]);
        if (ad.length > 0) {
            ctx.reply(`Ad Link for ${adType}: ${ad[0].ad_link}`);
        } else {
            ctx.reply('No ad link found for the selected ad type.');
        }
    } catch (error) {
        console.error('Error fetching ad link:', error);
        ctx.reply('An error occurred. Please try again later.');
    }
}

// Error handling
bot.catch((err) => {
    console.error('Bot error:', err);
});

// Start the bot
bot.launch().then(() => {
    console.log('Bot started successfully');
});
