const { Telegraf, Markup } = require('telegraf');
const mysql = require('mysql2/promise');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// MySQL Connection
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'habesha4338',
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

        // Show the ad type options keyboard by default
        const adTypes = ['website', 'YouTube', 'TikTok', 'Playstore']; // Define your ad types here
        const buttons = adTypes.map(type => Markup.button.text(type));
        const keyboard = Markup.keyboard(buttons).resize();
        ctx.reply('ad type:', keyboard);

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

// Admin actions handlers
bot.action('add_channel', isAdmin, (ctx) => {
    ctx.reply('Please enter the channel link to add:', Markup.forceReply());
    bot.on('text', async (ctx) => {
        const channelLink = ctx.message.text;
        try {
            const connection = await db;
            await connection.query('INSERT INTO channels (channel_link) VALUES (?)', [channelLink]);
            ctx.reply('Channel added successfully.');
        } catch (error) {
            console.error('Error adding channel:', error);
            ctx.reply('An error occurred. Please try again later.');
        }
    });
});

bot.action('remove_channel', isAdmin, (ctx) => {
    ctx.reply('Please enter the channel link to remove:', Markup.forceReply());
    bot.on('text', async (ctx) => {
        const channelLink = ctx.message.text;
        try {
            const connection = await db;
            await connection.query('DELETE FROM channels WHERE channel_link = ?', [channelLink]);
            ctx.reply('Channel removed successfully.');
        } catch (error) {
            console.error('Error removing channel:', error);
            ctx.reply('An error occurred. Please try again later.');
        }
    });
});

bot.action('add_ad', isAdmin, (ctx) => {
    ctx.reply('Please enter the ad details in the format: ad_type website_name ad_link', Markup.forceReply());
    bot.on('text', async (ctx) => {
        const [adType, websiteName, adLink] = ctx.message.text.split(' ');
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
});

bot.action('remove_ad', isAdmin, (ctx) => {
    ctx.reply('Please enter the ad link to remove:', Markup.forceReply());
    bot.on('text', async (ctx) => {
        const adLink = ctx.message.text;
        try {
            const connection = await db;
            await connection.query('DELETE FROM advertisements WHERE ad_link = ?', [adLink]);
            ctx.reply('Advertisement removed successfully.');
        } catch (error) {
            console.error('Error removing advertisement:', error);
            ctx.reply('An error occurred. Please try again later.');
        }
    });
});

bot.action('list_top_users', isAdmin, async (ctx) => {
    try {
        const connection = await db;
        const [rows] = await connection.query('SELECT telegram_id, points FROM users ORDER BY points DESC LIMIT 10');
        if (rows.length > 0) {
            let response = 'Top 10 users:\n';
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

// Admin command to list all referrals
bot.action('list_referrals', isAdmin, async (ctx) => {
    try {
        const connection = await db;
        const [referrals] = await connection.query(`
            SELECT 
                u1.telegram_id AS user_id, 
                u1.username AS user_username, 
                u2.telegram_id AS referred_user_id, 
                u2.username AS referred_user_username
            FROM users u1
            JOIN users u2 ON u1.id = u2.referrer_id
        `);

        if (referrals.length > 0) {
            let response = 'Referrals:\n';
            referrals.forEach(referral => {
                response += `User: ${referral.user_username} (ID: ${referral.user_id}), Referred User: ${referral.referred_user_username} (ID: ${referral.referred_user_id})\n`;
            });
            ctx.reply(response);
        } else {
            ctx.reply('No referrals found.');
        }
    } catch (error) {
        console.error('Error listing referrals:', error);
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
