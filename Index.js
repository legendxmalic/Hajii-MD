require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, downloadContentFromMessage, jidNormalizedUser, Browsers, delay } = require('@whiskeysockets/baileys');
const P = require('pino');
const { OpenAI } = require('openai');

const app = express();
const server = http.createServer(app);

const tgToken = "8851917106:AAHTzgg5nrAjDiNb16vbgfIbEpgNaTTfsaU";
const tgBot = new TelegramBot(tgToken, { polling: true });

const io = socketIo(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

let openai = null;
if (process.env.OPENAI_API_KEY) {
    try {
        openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: process.env.AI_BASE_URL || "https://api.openai.com/v1"
        });
    } catch (e) {}
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>HAJII-MD Bot</title></head>
            <body style="font-family:Arial;text-align:center;padding:50px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;color:white;">
                <div style="background:rgba(255,255,255,0.1);padding:40px;border-radius:20px;max-width:500px;margin:auto;">
                    <h1 style="font-size:60px;">🤖</h1>
                    <h1>HAJII-MD BOT</h1>
                    <p>✅ Bot is Online</p>
                    <p>Type .menu in WhatsApp</p>
                    <br>
                    <a href="https://t.me/anonymousworld02" style="color:white;text-decoration:none;background:#0088cc;padding:10px 20px;border-radius:10px;margin:5px;display:inline-block;">📢 Telegram</a>
                    <a href="https://whatsapp.com/channel/0029Vb5pzYl0VycOzcB4fU0B" style="color:white;text-decoration:none;background:#25d366;padding:10px 20px;border-radius:10px;margin:5px;display:inline-block;">📱 WhatsApp</a>
                    <br><br>
                    <p>⚡ Powered by MR HAJII</p>
                </div>
            </body>
        </html>
    `);
});

app.get('/api/status', (req, res) => {
    res.json({ status: 'online', bot: 'HAJII-MD', uptime: process.uptime(), timestamp: new Date() });
});

const AUTH_DIR = './auth_info';
const DATA_FILE = './data/bot_data.json';
const WARNINGS_FILE = './data/antilink_warnings.json';
fs.ensureDirSync(AUTH_DIR);
fs.ensureDirSync('./data');

let botData = { 
    antilinkGroups: {}, totalBots: 0, registeredBots: [], statusSettings: {}, 
    antiDelete: {}, userNames: {}, antiCall: {}, antiAdmin: {}
};

let antilinkWarnings = {};
if (fs.existsSync(WARNINGS_FILE)) {
    try { antilinkWarnings = fs.readJsonSync(WARNINGS_FILE); } catch (e) { antilinkWarnings = {}; }
}

function saveWarnings() {
    try { fs.writeJsonSync(WARNINGS_FILE, antilinkWarnings); } catch (e) {}
}

if (fs.existsSync(DATA_FILE)) {
    try { botData = fs.readJsonSync(DATA_FILE); } catch (e) {}
}

function saveBotData() {
    fs.writeJsonSync(DATA_FILE, botData);
}

const sessions = {}; 
const userSockets = {}; 
const messageLogs = {}; 

async function loadExistingSessions() {
    try {
        const authDirs = await fs.readdir(AUTH_DIR);
        for (const userId of authDirs) {
            const authPath = path.join(AUTH_DIR, userId);
            const stats = await fs.stat(authPath);
            if (stats.isDirectory()) {
                const credsFile = path.join(authPath, 'creds.json');
                if (fs.existsSync(credsFile)) {
                    console.log(`[System] Found existing session for: ${userId}. Initializing...`);
                    if (!sessions[userId]) {
                        sessions[userId] = new BotSession(userId);
                        sessions[userId].initialize().catch(err => {
                            console.error(`[System] Failed to auto-initialize session ${userId}:`, err.message);
                        });
                    }
                }
            }
        }
    } catch (err) {
        console.error('[System] Error loading existing sessions:', err.message);
    }
}

const toBold = (text) => {
    const boldChars = {
        'a': '𝗮', 'b': '𝗯', 'c': '𝗰', 'd': '𝗱', 'e': '𝗲', 'f': '𝗳', 'g': '𝗴', 'h': '𝗵', 'i': '𝗶', 'j': '𝗷', 'k': '𝗸', 'l': '𝗹', 'm': '𝗺', 'n': '𝗻', 'o': '𝗼', 'p': '𝗽', 'q': '𝗾', 'r': '𝗿', 's': '𝘀', 't': '𝘁', 'u': '𝘂', 'v': '𝘃', 'w': '𝘄', 'x': '𝘅', 'y': '𝘆', 'z': '𝘇',
        'A': '𝗔', 'B': '𝗕', 'C': '𝗖', 'D': '𝗗', 'E': '𝗘', 'F': '𝗙', 'G': '𝗚', 'H': '𝗛', 'I': '𝗜', 'J': '𝗝', 'K': '𝗞', 'L': '𝗟', 'M': '𝗠', 'N': '𝗡', 'O': '𝗢', 'P': '𝗣', 'Q': '𝗤', 'R': '𝗥', 'S': '𝘀', 't': '𝘁', 'u': '𝘂', 'v': '𝘃', 'w': '𝘄', 'x': '𝘅', 'y': '𝘆', 'z': '𝘇',
        '0': '𝟬', '1': '𝟭', '2': '𝟮', '3': '𝟯', '4': '𝟰', '5': '𝟱', '6': '𝟲', '7': '𝟳', '8': '𝟴', '9': '𝟵'
    };
    return text.split('').map(c => boldChars[c] || c).join('');
};

// ============== COMMAND HANDLERS ==============

async function handleAdd(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    const jid = args[0];
    if (!jid) return await sock.sendMessage(from, { text: "❌ Number required!\nExample: .add 923000000000" });
    try {
        let formattedJid = jid.includes('@') ? jid : jid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await sock.groupParticipantsUpdate(from, [formattedJid], "add");
        await sock.sendMessage(from, { text: `✅ Added @${jid}`, mentions: [formattedJid] });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleKick(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    const jid = args[0] || mentioned;
    if (!jid) return await sock.sendMessage(from, { text: "❌ Mention or provide number!\nExample: .kick @user" });
    try {
        let formattedJid = jid.includes('@') ? jid : jid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await sock.groupParticipantsUpdate(from, [formattedJid], "remove");
        await sock.sendMessage(from, { text: `✅ Kicked @${jid}`, mentions: [formattedJid] });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handlePromote(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    const jid = args[0] || mentioned;
    if (!jid) return await sock.sendMessage(from, { text: "❌ Mention or provide number!\nExample: .promote @user" });
    try {
        let formattedJid = jid.includes('@') ? jid : jid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await sock.groupParticipantsUpdate(from, [formattedJid], "promote");
        await sock.sendMessage(from, { text: `⭐ Promoted @${jid} to admin!`, mentions: [formattedJid] });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleDemote(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    const jid = args[0] || mentioned;
    if (!jid) return await sock.sendMessage(from, { text: "❌ Mention or provide number!\nExample: .demote @user" });
    try {
        let formattedJid = jid.includes('@') ? jid : jid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await sock.groupParticipantsUpdate(from, [formattedJid], "demote");
        await sock.sendMessage(from, { text: `👎 Demoted @${jid} from admin!`, mentions: [formattedJid] });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleMute(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    try {
        await sock.groupSettingUpdate(from, 'announcement');
        await sock.sendMessage(from, { text: "🔇 Group muted! Only admins can send messages." });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleUnmute(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    try {
        await sock.groupSettingUpdate(from, 'not_announcement');
        await sock.sendMessage(from, { text: "🔊 Group unmuted! All members can send messages." });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleTagAll(sock, from, msg, isAdmin, args) {
    try {
        const meta = await sock.groupMetadata(from);
        const participants = meta.participants;
        const mentions = participants.map(p => p.id);
        let text = "👥 *TAG ALL*\n\n";
        text += args.join(' ') || "Attention everyone!";
        text += "\n\n━━━━━━━━━━━━━━━━━━━━━\n";
        participants.forEach((p, i) => {
            text += `${i+1}. @${p.id.split('@')[0]}\n`;
        });
        await sock.sendMessage(from, { text, mentions });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleHideTag(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    try {
        const meta = await sock.groupMetadata(from);
        const participants = meta.participants;
        const mentions = participants.map(p => p.id);
        let text = "🔇 *HIDDEN TAG*\n\n";
        text += args.join(' ') || "Attention everyone!";
        await sock.sendMessage(from, { text, mentions });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleInviteLink(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    try {
        const code = await sock.groupInviteCode(from);
        await sock.sendMessage(from, { text: `🔗 Invite Link:\nhttps://chat.whatsapp.com/${code}` });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleRevoke(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    try {
        await sock.groupRevokeInvite(from);
        const code = await sock.groupInviteCode(from);
        await sock.sendMessage(from, { text: `🔄 New Invite Link:\nhttps://chat.whatsapp.com/${code}` });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleGName(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    const name = args.join(' ');
    if (!name) return await sock.sendMessage(from, { text: "❌ Provide group name!\nExample: .gname My Group" });
    try {
        await sock.groupUpdateSubject(from, name);
        await sock.sendMessage(from, { text: `✅ Group name changed to: ${name}` });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleGDesc(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    const desc = args.join(' ');
    if (!desc) return await sock.sendMessage(from, { text: "❌ Provide description!\nExample: .gdesc Welcome to our group" });
    try {
        await sock.groupUpdateDescription(from, desc);
        await sock.sendMessage(from, { text: `✅ Group description updated!` });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleAdmins(sock, from, msg, isAdmin, args) {
    try {
        const meta = await sock.groupMetadata(from);
        const admins = meta.participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
        let text = "👑 *GROUP ADMINS*\n\n";
        admins.forEach((p, i) => {
            text += `${i+1}. @${p.id.split('@')[0]}\n`;
        });
        if (admins.length === 0) text = "ℹ️ No admins found.";
        await sock.sendMessage(from, { text, mentions: admins.map(p => p.id) });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleInfo(sock, from, msg, isAdmin, args) {
    try {
        const meta = await sock.groupMetadata(from);
        const admins = meta.participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
        let text = "📊 *GROUP INFO*\n\n";
        text += `📝 Name: ${meta.subject}\n`;
        text += `👥 Members: ${meta.participants.length}\n`;
        text += `👑 Admins: ${admins.length}\n`;
        text += `📅 Created: ${new Date(meta.creation * 1000).toLocaleDateString()}\n`;
        if (meta.desc) text += `\n📝 ${meta.desc}`;
        await sock.sendMessage(from, { text });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleLeave(sock, from, msg, isAdmin, args) {
    try {
        await sock.sendMessage(from, { text: "👋 Goodbye! I'm leaving this group." });
        await delay(1000);
        await sock.groupLeave(from);
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleAntiLink(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    const action = args[0]?.toLowerCase();
    if (!action) return await sock.sendMessage(from, { text: "❌ Please specify on/off/kick!\nExample: .antilink on" });
    if (action === 'on') {
        botData.antilinkGroups[from] = 'warn';
        saveBotData();
        await sock.sendMessage(from, { text: "🛡️ Anti-link is now ENABLED (warn mode)" });
    } else if (action === 'off') {
        delete botData.antilinkGroups[from];
        saveBotData();
        await sock.sendMessage(from, { text: "🛡️ Anti-link is now DISABLED" });
    } else if (action === 'kick') {
        botData.antilinkGroups[from] = 'kick';
        saveBotData();
        await sock.sendMessage(from, { text: "🛡️ Anti-link is now ENABLED (kick mode)" });
    } else {
        await sock.sendMessage(from, { text: "❌ Invalid option! Use: on, off, or kick" });
    }
}

async function handleAccept(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    const jid = args[0] || mentioned;
    if (!jid) return await sock.sendMessage(from, { text: "❌ Mention or provide number!\nExample: .accept @user" });
    try {
        let formattedJid = jid.includes('@') ? jid : jid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await sock.groupRequestParticipantsUpdate(from, [formattedJid], 'approve');
        await sock.sendMessage(from, { text: `✅ Accepted @${jid}`, mentions: [formattedJid] });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handlePoll(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    const pollText = args.join(' ');
    if (!pollText) return await sock.sendMessage(from, { text: "❌ Format: .poll question? option1, option2, option3" });
    const parts = pollText.split('?');
    if (parts.length < 2) return await sock.sendMessage(from, { text: "❌ Format: question? option1, option2, option3" });
    const question = parts[0].trim();
    const options = parts[1].split(',').map(o => o.trim()).filter(o => o.length > 0);
    if (options.length < 2) return await sock.sendMessage(from, { text: "❌ At least 2 options!" });
    try {
        await sock.sendMessage(from, { poll: { name: question, values: options } });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handlePin(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    try {
        if (msg.message?.extendedTextMessage?.contextInfo?.stanzaId) {
            const key = {
                remoteJid: from,
                id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                fromMe: false,
                participant: msg.message.extendedTextMessage.contextInfo.participant || from
            };
            await sock.sendMessage(from, { pin: key });
            await sock.sendMessage(from, { text: "📌 Message pinned!" });
        } else {
            await sock.sendMessage(from, { text: "❌ Reply to a message to pin!" });
        }
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleUnpin(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    try {
        if (msg.message?.extendedTextMessage?.contextInfo?.stanzaId) {
            const key = {
                remoteJid: from,
                id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                fromMe: false,
                participant: msg.message.extendedTextMessage.contextInfo.participant || from
            };
            await sock.sendMessage(from, { unpin: key });
            await sock.sendMessage(from, { text: "📌 Message unpinned!" });
        } else {
            await sock.sendMessage(from, { text: "❌ Reply to a pinned message!" });
        }
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleLock(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    try {
        await sock.groupSettingUpdate(from, 'locked');
        await sock.sendMessage(from, { text: "🔒 Group locked!" });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleUnlock(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    try {
        await sock.groupSettingUpdate(from, 'unlocked');
        await sock.sendMessage(from, { text: "🔓 Group unlocked!" });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleRequests(sock, from, msg, isAdmin, args) {
    if (!isAdmin) return await sock.sendMessage(from, { text: "❌ Admin only!" });
    try {
        const requests = await sock.groupRequestParticipantsList(from);
        if (requests.length === 0) return await sock.sendMessage(from, { text: "ℹ️ No pending requests." });
        let text = "📥 *PENDING REQUESTS*\n\n";
        requests.forEach((r, i) => {
            text += `${i+1}. @${r.jid.split('@')[0]}\n`;
        });
        await sock.sendMessage(from, { text, mentions: requests.map(r => r.jid) });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handleAllMembers(sock, from, msg, isAdmin, args) {
    try {
        const meta = await sock.groupMetadata(from);
        const participants = meta.participants.map(p => p.id);
        let text = "👥 *ALL MEMBERS*\n\n";
        text += `Total: ${participants.length}\n\n`;
        participants.forEach((p, i) => {
            text += `${i+1}. ${p}\n`;
        });
        await sock.sendMessage(from, { text });
    } catch (e) {
        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
    }
}

async function handlePing(sock, from, msg) {
    const start = Date.now();
    await sock.sendMessage(from, { text: "🏓 Pinging..." });
    const end = Date.now();
    await sock.sendMessage(from, { text: `🏓 Pong! ${end - start}ms` });
}

async function handleOwner(sock, from, msg) {
    await sock.sendMessage(from, { 
        text: "👑 *OWNER*\n\nName: MR HAJII\nNumber: 923000000000\n\n━━━━━━━━━━━━━━━━━━━━━\n📢 Join Our Channels:\n🔹 Telegram: https://t.me/anonymousworld02\n🔹 WhatsApp: https://whatsapp.com/channel/0029Vb5pzYl0VycOzcB4fU0B"
    });
}

async function handleVV(sock, from, msg) {
    if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        await sock.sendMessage(from, { 
            text: "📨 *View Once Message*\n\nThis message was sent as view once.",
            quoted: msg
        });
    } else {
        await sock.sendMessage(from, { text: "❌ Reply to a view once message with .vv" });
    }
}

async function handleDP(sock, from, msg) {
    try {
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        const jid = mentioned || from;
        const pp = await sock.profilePictureUrl(jid, 'image');
        await sock.sendMessage(from, { image: { url: pp }, caption: `🖼️ Profile Picture` });
    } catch (e) {
        await sock.sendMessage(from, { text: "❌ No profile picture found!" });
    }
}

// ============== BOT SESSION CLASS ==============

class BotSession {
    constructor(userId) {
        this.userId = userId;
        this.sock = null;
        this.isConnected = false;
        this.aiEnabled = false;
        this.autoReact = false;
        this.isPublic = false;
        this.authPath = path.join(AUTH_DIR, userId);
        this.processedMessages = new Set();
        this.activeInterval = null;
        this.isInitializing = false;
        this.lastConnectMessageTime = null;
        this.tgChatId = null;
        this.adminCache = {};
        this.pairingCode = null;
    }

    sendLog(message, type = 'info') {
        if (type === 'error' || type === 'success') {
            const logEntry = { timestamp: new Date().toLocaleTimeString(), message, type };
            const socketId = userSockets[this.userId];
            if (socketId) io.to(socketId).emit('console', logEntry);
            console.log(`[${this.userId}] ${message}`);
        }
    }

    sendConnectionStatus() {
        if (this._lastStatusUpdate && Date.now() - this._lastStatusUpdate < 2000) return;
        this._lastStatusUpdate = Date.now();
        const socketId = userSockets[this.userId];
        if (socketId) {
            io.to(socketId).emit('connection-status', {
                connected: this.isConnected,
                user: this.userId
            });
        }
        io.emit('total-active', Object.values(sessions).filter(s => s.isConnected).length);
    }

    startActiveCheck() {
        if (this.activeInterval) clearInterval(this.activeInterval);
        this.activeInterval = setInterval(async () => {
            if (this.isConnected && this.sock?.user) {
                try {
                    const botNumber = jidNormalizedUser(this.sock.user.id);
                    await this.sock.sendMessage(botNumber, { 
                        text: "𝗛𝗔𝗝𝗜𝗜-𝗠𝗗-𝗕𝗢𝗧 𝗜𝗦 𝗢𝗡𝗟𝗜𝗡𝗘 🚀\n\n_24/7 Active System Working..._" 
                    });
                } catch (e) {}
            }
        }, 60 * 60 * 1000);
    }

    async getAIResponse(userJid, userMessage) {
        if (!openai) return "❌ AI is not configured.";
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const completion = await openai.chat.completions.create({
                model: process.env.AI_MODEL || "gpt-3.5-turbo",
                messages: [{ role: "system", content: "Helpful assistant." }, { role: "user", content: userMessage }],
                max_tokens: 100
            }, { signal: controller.signal });
            clearTimeout(timeoutId);
            return completion.choices[0].message.content.trim();
        } catch (error) {
            return "❌ AI Error: " + error.message;
        }
    }

    async initialize(pairingNumber = null) {
        if (this.isInitializing) {
            this.sendLog("Initialization already in progress...", "info");
            return;
        }
        this.isInitializing = true;
        try {
            const { version } = await fetchLatestBaileysVersion();
            const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
            
            this.sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'fatal' })),
                },
                printQRInTerminal: false,
                logger: P({ level: 'fatal' }),
                browser: Browsers.ubuntu('Chrome'),
                syncFullHistory: false,
                shouldSyncHistoryMessage: () => false,
                markOnlineOnConnect: true,
                keepAliveIntervalMs: 30000,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                emitOwnEvents: true,
                retryRequestDelayMs: 5000,
                maxMsgRetryCount: 5,
                linkPreviewImageThumbnailWidth: 192,
                transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
                getMessage: async (key) => {
                    if (messageLogs[key.id]) {
                        return { conversation: messageLogs[key.id].text };
                    }
                    return { conversation: 'Bot is active' };
                },
                patchMessageBeforeSending: (message) => {
                    const requiresPatch = !!(
                        message.buttonsMessage ||
                        message.templateMessage ||
                        message.listMessage
                    );
                    if (requiresPatch) {
                        return {
                            viewOnceMessage: {
                                message: {
                                    messageContextInfo: {
                                        deviceListMetadata: {},
                                        deviceListMetadataVersion: 2
                                    },
                                    ...message
                                }
                            }
                        };
                    }
                    return message;
                },
                generateHighQualityLinkPreview: true,
            });

            if (pairingNumber && !state.creds.registered) {
                if (!this.sock.authState.creds.registered) {
                    await delay(3000);
                    try {
                        let code = await this.sock.requestPairingCode(pairingNumber);
                        code = code?.match(/.{1,4}/g)?.join("-") || code;
                        this.pairingCode = code;
                        this.sendLog(`🔑 Pairing Code: ${code}`, 'success');
                        
                        if (this.tgChatId) {
                            await tgBot.sendMessage(this.tgChatId, 
                                "🔑 𝗬𝗢𝗨𝗥 𝗣𝗔𝗜𝗥𝗜𝗡𝗚 𝗖𝗢𝗗𝗘: " + code + "\n\n" +
                                "━━━━━━━━━━━━━━━━━━━━━\n" +
                                "📢 Join Our Channels:\n" +
                                "🔹 Telegram: https://t.me/anonymousworld02\n" +
                                "🔹 WhatsApp: https://whatsapp.com/channel/0029Vb5pzYl0VycOzcB4fU0B"
                            );
                        }

                        const socketId = userSockets[this.userId];
                        if (socketId) io.to(socketId).emit('pairing-code', code);
                    } catch (err) {
                        this.sendLog(`❌ Pairing error: ${err.message}`, 'error');
                    }
                }
            }

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('call', async (calls) => {
                if (botData.antiCall[this.userId]) {
                    for (const call of calls) {
                        if (call.status === 'offer') {
                            try {
                                await this.sock.rejectCall(call.id, call.from);
                                await this.sock.sendMessage(call.from, { text: "⚠️ *ANTI-CALL:* I don't accept calls." });
                            } catch (e) {}
                        }
                    }
                }
            });

            this.sock.ev.on('messages.upsert', async (m) => {
                if (m.type !== 'notify') return;
                
                await Promise.all(m.messages.map(async (msg) => {
                    try {
                        const from = msg.key.remoteJid;
                        const isMe = msg.key.fromMe;
                        const isGroup = from.endsWith('@g.us');
                        const isStatus = from === 'status@broadcast';
                        
                        const messageContent = msg.message?.ephemeralMessage?.message || 
                                             msg.message?.viewOnceMessage?.message || 
                                             msg.message?.viewOnceMessageV2?.message || 
                                             msg.message;
                        if (!messageContent) return;
                        
                        let type = Object.keys(messageContent)[0];
                        const text = (messageContent.conversation || 
                                     messageContent.extendedTextMessage?.text || 
                                     messageContent.imageMessage?.caption || 
                                     messageContent.videoMessage?.caption || '').trim();

                        const botNumber = jidNormalizedUser(this.sock.user.id);
                        const sender = msg.key.participant || from;
                        const isOwner = isMe || sender.includes(botNumber.split('@')[0]);
                        
                        let isAdmin = isOwner;
                        if (!isAdmin && isGroup) {
                            const cacheKey = `${from}_admin_check`;
                            if (this.adminCache && this.adminCache[cacheKey] && 
                                Date.now() - this.adminCache[cacheKey].timestamp < 5000) {
                                isAdmin = this.adminCache[cacheKey].isAdmin;
                            } else {
                                try {
                                    const groupMetadata = await this.sock.groupMetadata(from);
                                    const participant = groupMetadata.participants.find(p => p.id === sender);
                                    isAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
                                    if (!this.adminCache) this.adminCache = {};
                                    this.adminCache[cacheKey] = { isAdmin, timestamp: Date.now() };
                                } catch (e) {
                                    isAdmin = false;
                                }
                            }
                        }

                        // ANTI-LINK
                        if (isGroup && botData.antilinkGroups && botData.antilinkGroups[from] && !isAdmin) {
                            const linkPatterns = [
                                /https?:\/\/[^\s]+/gi,
                                /chat\.whatsapp\.com\/[A-Za-z0-9]+/gi,
                                /wa\.me\/[0-9]+/gi,
                                /t\.me\/[A-Za-z0-9_]+/gi,
                                /[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/gi
                            ];
                            
                            let hasLink = false;
                            for (const pattern of linkPatterns) {
                                if (text.match(pattern)) {
                                    hasLink = true;
                                    break;
                                }
                            }
                            
                            if (hasLink) {
                                const mode = botData.antilinkGroups[from];
                                const key = `${from}_${sender}`;
                                
                                if (!antilinkWarnings[key]) {
                                    antilinkWarnings[key] = { count: 0, lastWarn: Date.now() };
                                }
                                
                                if (Date.now() - antilinkWarnings[key].lastWarn > 3600000) {
                                    antilinkWarnings[key].count = 0;
                                }
                                
                                antilinkWarnings[key].count++;
                                antilinkWarnings[key].lastWarn = Date.now();
                                saveWarnings();
                                
                                try {
                                    await this.sock.sendMessage(from, { delete: msg.key });
                                } catch (e) {}
                                
                                const warnCount = antilinkWarnings[key].count;
                                
                                let warnMessage = `⚠️ *ANTI-LINK WARNING #${warnCount}/3*\n\n`;
                                warnMessage += `@${sender.split('@')[0]} links are NOT allowed!\n\n`;
                                
                                if (warnCount < 3) {
                                    warnMessage += `🔹 ${3 - warnCount} warnings remaining!`;
                                } else {
                                    warnMessage += `🚫 You will be kicked!`;
                                }
                                
                                await this.sock.sendMessage(from, { 
                                    text: warnMessage,
                                    mentions: [sender]
                                });
                                
                                if (mode === 'kick' && warnCount >= 3) {
                                    try {
                                        await this.sock.groupParticipantsUpdate(from, [sender], "remove");
                                        antilinkWarnings[key].count = 0;
                                        saveWarnings();
                                        await this.sock.sendMessage(from, { 
                                            text: `🚫 Kicked @${sender.split('@')[0]} for links!`,
                                            mentions: [sender]
                                        });
                                    } catch (e) {}
                                }
                                return;
                            }
                        }

                        // ANTI-ADMIN
                        if (isGroup && botData.antiAdmin && botData.antiAdmin[from]) {
                            const isPromotion = msg.message?.groupParticipantUpdate?.action === 'promote';
                            if (isPromotion && !isMe && !isOwner) {
                                const participants = msg.message?.groupParticipantUpdate?.participants || [];
                                for (const participant of participants) {
                                    try {
                                        await this.sock.groupParticipantsUpdate(from, [participant], "demote");
                                    } catch (e) {}
                                }
                                await this.sock.sendMessage(from, { 
                                    text: `⚠️ Anti-Admin: @${sender.split('@')[0]} tried to promote someone!`,
                                    mentions: [sender]
                                });
                                return;
                            }
                        }

                        if (!isMe && !isStatus) {
                            if (botData.statusSettings[this.userId]?.autoSeen) {
                                try { await this.sock.readMessages([msg.key]); } catch (e) {}
                            }
                        }

                        if (msg.message?.protocolMessage?.type === 0) {
                            if (botData.antiDelete && botData.antiDelete[this.userId]) {
                                try {
                                    const deletedMsg = msg.message.protocolMessage.key;
                                    if (deletedMsg) {
                                        await this.sock.sendMessage(from, { 
                                            text: `🗑️ A message was deleted!\nFrom: @${deletedMsg.participant?.split('@')[0] || 'unknown'}`,
                                            mentions: [deletedMsg.participant]
                                        });
                                    }
                                } catch (e) {}
                            }
                            return;
                        }

                        const msgId = msg.key.id;
                        if (this.processedMessages.has(msgId)) return;
                        this.processedMessages.add(msgId);
                        if (this.processedMessages.size > 1000) this.processedMessages.delete(this.processedMessages.values().next().value);

                        if (this.autoReact && !isMe && !isStatus) {
                            if (type === 'conversation' || type === 'extendedTextMessage') {
                                const emojis = ['❤️', '👍', '🔥', '👏', '😮', '😂', '🙌', '✨', '⭐', '✅'];
                                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                                this.sock.sendMessage(from, { react: { text: randomEmoji, key: msg.key } }).catch(() => {});
                            }
                        }

                        if (this.aiEnabled && !isMe && !isStatus && !isGroup && text && !text.startsWith('.')) {
                            try {
                                const aiResponse = await this.getAIResponse(from, text);
                                await this.sock.sendMessage(from, { text: aiResponse }, { quoted: msg });
                            } catch (e) {
                                console.error("AI Auto-Reply Error:", e);
                            }
                        }

                        if (!this.isPublic && !isOwner) return;

                        const cmd = text.toLowerCase();
                        const args = text.split(' ').slice(1);
                        const q = args.join(' ');

                        if (cmd.startsWith('.')) {
                            const commandName = cmd.slice(1).split(' ')[0];
                            (async () => {
                                try {
                                    switch (commandName) {
                                        case 'add': await handleAdd(this.sock, from, msg, isAdmin, args); break;
                                        case 'kick': await handleKick(this.sock, from, msg, isAdmin, args); break;
                                        case 'promote': await handlePromote(this.sock, from, msg, isAdmin, args); break;
                                        case 'demote': await handleDemote(this.sock, from, msg, isAdmin, args); break;
                                        case 'mute': await handleMute(this.sock, from, msg, isAdmin, args); break;
                                        case 'unmute': await handleUnmute(this.sock, from, msg, isAdmin, args); break;
                                        case 'tagall': await handleTagAll(this.sock, from, msg, isAdmin, args); break;
                                        case 'hidetag': await handleHideTag(this.sock, from, msg, isAdmin, args); break;
                                        case 'invitelink': await handleInviteLink(this.sock, from, msg, isAdmin, args); break;
                                        case 'revoke': await handleRevoke(this.sock, from, msg, isAdmin, args); break;
                                        case 'gname': await handleGName(this.sock, from, msg, isAdmin, args); break;
                                        case 'gdesc': await handleGDesc(this.sock, from, msg, isAdmin, args); break;
                                        case 'admins': await handleAdmins(this.sock, from, msg, isAdmin, args); break;
                                        case 'info': await handleInfo(this.sock, from, msg, isAdmin, args); break;
                                        case 'leave': await handleLeave(this.sock, from, msg, isAdmin, args); break;
                                        case 'antilink': await handleAntiLink(this.sock, from, msg, isAdmin, args); break;
                                        case 'accept': await handleAccept(this.sock, from, msg, isAdmin, args); break;
                                        case 'poll': await handlePoll(this.sock, from, msg, isAdmin, args); break;
                                        case 'pin': await handlePin(this.sock, from, msg, isAdmin, args); break;
                                        case 'unpin': await handleUnpin(this.sock, from, msg, isAdmin, args); break;
                                        case 'lock': await handleLock(this.sock, from, msg, isAdmin, args); break;
                                        case 'unlock': await handleUnlock(this.sock, from, msg, isAdmin, args); break;
                                        case 'requests': await handleRequests(this.sock, from, msg, isAdmin, args); break;
                                        case 'allmembers': await handleAllMembers(this.sock, from, msg, isAdmin, args); break;
                                        case 'ping': await handlePing(this.sock, from, msg); break;
                                        case 'owner': await handleOwner(this.sock, from, msg); break;
                                        case 'vv': await handleVV(this.sock, from, msg); break;
                                        case 'dp': await handleDP(this.sock, from, msg); break;
                                        
                                        case 'menu':
                                        case 'help':
                                            const loadEmojis = ['⏳', '⌛', '🚀', '✨'];
                                            for (const emoji of loadEmojis) await this.sock.sendMessage(from, { react: { text: emoji, key: msg.key } });
                                            
                                            const customName = botData.userNames[this.userId] || msg.pushName || 'User';
                                            const menuText = `╭━━━〔 ${toBold("HAJII-MD")} 〕━━━┈⊷\n` +
                                                            `┃ 👤 ${toBold("User:")} ${customName}\n` +
                                                            `┃ 🤖 ${toBold("Status:")} ${toBold("Online ✅")}\n` +
                                                            `┃ ⚙️ ${toBold("Mode:")} ${this.isPublic ? toBold('Public 🌍') : toBold('Private 🔐')}\n` +
                                                            `╰━━━━━━━━━━━━━━━━━━┈⊷\n\n` +
                                                            `╭━━━〔 ${toBold("𝗚𝗥𝗢𝗨𝗣 𝗠𝗔𝗡𝗔𝗚𝗘𝗠𝗘𝗡𝗧")} 〕━━━┈⊷\n` +
                                                            `┃ ⋄ ${toBold(".𝗮𝗱𝗱")} - Add member\n` +
                                                            `┃ ⋄ ${toBold(".𝗸𝗶𝗰𝗸")} - Remove member\n` +
                                                            `┃ ⋄ ${toBold(".𝗽𝗿𝗼𝗺𝗼𝘁𝗲")} - Make admin\n` +
                                                            `┃ ⋄ ${toBold(".𝗱𝗲𝗺𝗼𝘁𝗲")} - Remove admin\n` +
                                                            `┃ ⋄ ${toBold(".𝗺𝘂𝘁𝗲")} - Mute group\n` +
                                                            `┃ ⋄ ${toBold(".𝘂𝗻𝗺𝘂𝘁𝗲")} - Unmute group\n` +
                                                            `┃ ⋄ ${toBold(".𝘁𝗮𝗴𝗮𝗹𝗹")} - Tag all\n` +
                                                            `┃ ⋄ ${toBold(".𝗵𝗶𝗱𝗲𝘁𝗮𝗴")} - Hidden tag\n` +
                                                            `┃ ⋄ ${toBold(".𝗶𝗻𝘃𝗶𝘁𝗲𝗹𝗶𝗻𝗸")} - Get invite link\n` +
                                                            `┃ ⋄ ${toBold(".𝗿𝗲𝘃𝗼𝗸𝗲")} - Revoke link\n` +
                                                            `┃ ⋄ ${toBold(".𝗴𝗻𝗮𝗺𝗲")} - Change name\n` +
                                                            `┃ ⋄ ${toBold(".𝗴𝗱𝗲𝘀𝗰")} - Change description\n` +
                                                            `┃ ⋄ ${toBold(".𝗮𝗱𝗺𝗶𝗻𝘀")} - List admins\n` +
                                                            `┃ ⋄ ${toBold(".𝗶𝗻𝗳𝗼")} - Group info\n` +
                                                            `┃ ⋄ ${toBold(".𝗹𝗲𝗮𝘃𝗲")} - Bot leaves\n` +
                                                            `┃ ⋄ ${toBold(".𝗮𝗻𝘁𝗶𝗹𝗶𝗻𝗸")} - Anti-link\n` +
                                                            `┃ ⋄ ${toBold(".𝗮𝗰𝗰𝗲𝗽𝘁")} - Accept request\n` +
                                                            `┃ ⋄ ${toBold(".𝗽𝗼𝗹𝗹")} - Create poll\n` +
                                                            `┃ ⋄ ${toBold(".𝗽𝗶𝗻")} - Pin message\n` +
                                                            `┃ ⋄ ${toBold(".𝘂𝗻𝗽𝗶𝗻")} - Unpin message\n` +
                                                            `┃ ⋄ ${toBold(".𝗹𝗼𝗰𝗸")} - Lock group\n` +
                                                            `┃ ⋄ ${toBold(".𝘂𝗻𝗹𝗼𝗰𝗸")} - Unlock group\n` +
                                                            `┃ ⋄ ${toBold(".𝗿𝗲𝗾𝘂𝗲𝘀𝘁𝘀")} - Join requests\n` +
                                                            `┃ ⋄ ${toBold(".𝗮𝗹𝗹𝗺𝗲𝗺𝗯𝗲𝗿𝘀")} - All members\n` +
                                                            `╰━━━━━━━━━━━━━━━━━━┈⊷\n\n` +
                                                            `╭━━━〔 ${toBold("𝗨𝗦𝗘𝗥 𝗖𝗠𝗗𝗦")} 〕━━━┈⊷\n` +
                                                            `┃ ⋄ ${toBold(".𝗽𝗶𝗻𝗴")} - Check bot\n` +
                                                            `┃ ⋄ ${toBold(".𝗼𝘄𝗻𝗲𝗿")} - Bot owner\n` +
                                                            `┃ ⋄ ${toBold(".𝘃𝘃")} - View once\n` +
                                                            `┃ ⋄ ${toBold(".𝗱𝗽")} - Profile pic\n` +
                                                            `╰━━━━━━━━━━━━━━━━━━┈⊷\n\n` +
                                                            `╭━━━〔 ${toBold("𝗔𝗖𝗧𝗜𝗩𝗘 𝗙𝗘𝗔𝗧𝗨𝗥𝗘𝗦")} 〕━━━┈⊷\n` +
                                                            `┃ 🤖 ${toBold("𝗔𝗜:")} ${this.aiEnabled ? '✅' : '❌'}\n` +
                                                            `┃ 🔄 ${toBold("𝗔𝘂𝘁𝗼-𝗥𝗲𝗮𝗰𝘁:")} ${this.autoReact ? '✅' : '❌'}\n` +
                                                            `┃ 🛡️ ${toBold("𝗔𝗻𝘁𝗶-𝗔𝗱𝗺𝗶𝗻:")} ${(botData.antiAdmin && botData.antiAdmin[from]) ? '✅' : '❌'}\n` +
                                                            `╰━━━━━━━━━━━━━━━━━━┈⊷\n\n` +
                                                            `╭━━━〔 ${toBold("𝗝𝗢𝗜𝗡 𝗢𝗨𝗥 𝗖𝗛𝗔𝗡𝗡𝗘𝗟𝗦")} 〕━━━┈⊷\n` +
                                                            `┃ 📢 ${toBold("𝗧𝗲𝗹𝗲𝗴𝗿𝗮𝗺:")}\n` +
                                                            `┃ https://t.me/anonymousworld02\n` +
                                                            `┃ 📱 ${toBold("𝗪𝗵𝗮𝘁𝘀𝗔𝗽𝗽:")}\n` +
                                                            `┃ https://whatsapp.com/channel/0029Vb5pzYl0VycOzcB4fU0B\n` +
                                                            `╰━━━━━━━━━━━━━━━━━━┈⊷\n\n` +
                                                            `⚡ ${toBold("𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬: 𝗠𝗥 𝗛𝗔𝗝𝗜𝗜")}`;
                                            
                                            try {
                                                await this.sock.sendMessage(from, { 
                                                    image: { url: 'https://kommodo.ai/i/lBkdPbX6qFHhsi0paB5a' }, 
                                                    caption: menuText 
                                                });
                                            } catch (e) { 
                                                await this.sock.sendMessage(from, { text: menuText }); 
                                            }
                                            break;
                                        
                                        case 'private':
                                            await this.sock.sendMessage(from, { text: "🔐 Bot is now PRIVATE!" });
                                            this.isPublic = false;
                                            if (!botData.statusSettings[this.userId]) botData.statusSettings[this.userId] = {};
                                            botData.statusSettings[this.userId].isPublic = false;
                                            saveBotData();
                                            break;
                                            
                                        case 'public':
                                            await this.sock.sendMessage(from, { text: "🌍 Bot is now PUBLIC!" });
                                            this.isPublic = true;
                                            if (!botData.statusSettings[this.userId]) botData.statusSettings[this.userId] = {};
                                            botData.statusSettings[this.userId].isPublic = true;
                                            saveBotData();
                                            break;
                                            
                                        case 'ai':
                                            if (!isAdmin) return await this.sock.sendMessage(from, { text: "❌ Admin only!" });
                                            const aiAction = args[0]?.toLowerCase();
                                            if (aiAction === 'on') {
                                                this.aiEnabled = true;
                                                await this.sock.sendMessage(from, { text: "🤖 AI is now ENABLED!" });
                                            } else if (aiAction === 'off') {
                                                this.aiEnabled = false;
                                                await this.sock.sendMessage(from, { text: "🤖 AI is now DISABLED!" });
                                            } else {
                                                await this.sock.sendMessage(from, { text: "❌ Use: .ai on/off" });
                                            }
                                            break;
                                            
                                        case 'autoreacts':
                                            if (!isAdmin) return await this.sock.sendMessage(from, { text: "❌ Admin only!" });
                                            const reactAction = args[0]?.toLowerCase();
                                            if (reactAction === 'on') {
                                                this.autoReact = true;
                                                await this.sock.sendMessage(from, { text: "✅ Auto-react is now ENABLED!" });
                                            } else if (reactAction === 'off') {
                                                this.autoReact = false;
                                                await this.sock.sendMessage(from, { text: "❌ Auto-react is now DISABLED!" });
                                            } else {
                                                await this.sock.sendMessage(from, { text: "❌ Use: .autoreacts on/off" });
                                            }
                                            break;
                                            
                                        case 'antiadmin':
                                            if (!isAdmin) return await this.sock.sendMessage(from, { text: "❌ Admin only!" });
                                            const aaAction = args[0]?.toLowerCase();
                                            if (aaAction === 'on') {
                                                if (!botData.antiAdmin) botData.antiAdmin = {};
                                                botData.antiAdmin[from] = true;
                                                saveBotData();
                                                await this.sock.sendMessage(from, { text: "🛡️ Anti-Admin is now ENABLED!" });
                                            } else if (aaAction === 'off') {
                                                if (botData.antiAdmin) {
                                                    delete botData.antiAdmin[from];
                                                    saveBotData();
                                                    await this.sock.sendMessage(from, { text: "🛡️ Anti-Admin is now DISABLED!" });
                                                }
                                            } else {
                                                await this.sock.sendMessage(from, { text: "❌ Use: .antiadmin on/off" });
                                            }
                                            break;
                                            
                                        case 'antidelete':
                                            if (!isAdmin) return await this.sock.sendMessage(from, { text: "❌ Admin only!" });
                                            const adAction = args[0]?.toLowerCase();
                                            if (adAction === 'on') {
                                                botData.antiDelete[this.userId] = true;
                                                saveBotData();
                                                await this.sock.sendMessage(from, { text: "🗑️ Anti-Delete is now ENABLED!" });
                                            } else if (adAction === 'off') {
                                                delete botData.antiDelete[this.userId];
                                                saveBotData();
                                                await this.sock.sendMessage(from, { text: "🗑️ Anti-Delete is now DISABLED!" });
                                            } else {
                                                await this.sock.sendMessage(from, { text: "❌ Use: .antidelete on/off" });
                                            }
                                            break;
                                            
                                        case 'anticall':
                                            if (!isAdmin) return await this.sock.sendMessage(from, { text: "❌ Admin only!" });
                                            const acAction = args[0]?.toLowerCase();
                                            if (acAction === 'on') {
                                                botData.antiCall[this.userId] = true;
                                                saveBotData();
                                                await this.sock.sendMessage(from, { text: "📵 Anti-Call is now ENABLED!" });
                                            } else if (acAction === 'off') {
                                                delete botData.antiCall[this.userId];
                                                saveBotData();
                                                await this.sock.sendMessage(from, { text: "📵 Anti-Call is now DISABLED!" });
                                            } else {
                                                await this.sock.sendMessage(from, { text: "❌ Use: .anticall on/off" });
                                            }
                                            break;
                                            
                                        case 'setname':
                                            if (!isAdmin) return await this.sock.sendMessage(from, { text: "❌ Admin only!" });
                                            const name = args.join(' ');
                                            if (!name) return await this.sock.sendMessage(from, { text: "❌ Provide a name!\nExample: .setname My Bot" });
                                            botData.userNames[this.userId] = name;
                                            saveBotData();
                                            await this.sock.sendMessage(from, { text: `✅ Bot name set to: ${name}` });
                                            break;
                                    }
                                } catch (e) {
                                    this.sendLog(`Command error (${commandName}): ` + e.message, 'error');
                                    await this.sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
                                }
                            })();
                        }
                    } catch (e) {
                        console.error('Message Processing Error:', e);
                    }
                }));
            });

            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;
                if (qr) {
                    const socketId = userSockets[this.userId];
                    if (socketId) io.to(socketId).emit('qr', qr);
                }

                if (connection === 'close') {
                    const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                    this.isConnected = false;
                    this.isInitializing = false;
                    this.sendLog(`Connection closed. Reconnecting: ${shouldReconnect}`, 'warning');
                    this.sendConnectionStatus();
                    const statusCode = (lastDisconnect.error)?.output?.statusCode;
                    
                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        this.sendLog('Session expired or logged out.', 'error');
                        try {
                            if (fs.existsSync(this.authPath)) {
                                const backupPath = `${this.authPath}_backup_${Date.now()}`;
                                fs.moveSync(this.authPath, backupPath);
                            }
                        } catch (e) {
                            if (fs.existsSync(this.authPath)) fs.removeSync(this.authPath);
                        }
                        delete sessions[this.userId];
                        this.sendConnectionStatus();
                    } else {
                        this.sendLog(`Connection closed. Reconnecting in 5s...`, 'info');
                        setTimeout(() => this.initialize(), 5000);
                    }
                } else if (connection === 'open') {
                    this.isConnected = true;
                    this.isInitializing = false;
                    this.sendLog('Connected successfully! ✅', 'success');
                    this.sendConnectionStatus();
                    this.startActiveCheck();
                    
                    const botNumber = jidNormalizedUser(this.sock.user.id);
                    const botName = botData.userNames[this.userId] || (this.sock.user && this.sock.user.name) || this.userId;
                    
                    if (this.tgChatId) {
                        await tgBot.sendMessage(this.tgChatId, 
                            "✅ 𝗪𝗛𝗔𝗧𝗦𝗔𝗣𝗣 𝗖𝗢𝗡𝗡𝗘𝗖𝗧𝗘𝗗 𝗦𝗨𝗖𝗖𝗘𝗦𝗦𝗙𝗨𝗟𝗟𝗬!\n\nYour bot is now active."
                        );
                    }

                    this.sendLog(`Bot ${botName} is online.`, 'success');

                    if (!this.lastConnectMessageTime || (Date.now() - this.lastConnectMessageTime > 60 * 60 * 1000)) {
                        await this.sock.sendMessage(botNumber, { 
                            text: "𝗕𝗢𝗧 𝗖𝗢𝗡𝗡𝗘𝗖𝗧𝗘𝗗 𝗦𝗨𝗖𝗖𝗘𝗦𝗦𝗙𝗨𝗟𝗟𝗬 ✅\n\n🤖 I'm HAJII-MD Bot. Type .menu to see my commands.\n\n📢 Join Our Channels:\n🔹 Telegram: https://t.me/anonymousworld02\n🔹 WhatsApp: https://whatsapp.com/channel/0029Vb5pzYl0VycOzcB4fU0B" 
                        });
                        this.lastConnectMessageTime = Date.now();
                    }
                }
            });

        } catch (err) {
            this.isInitializing = false;
            this.sendLog(`Initialization failed: ${err.message}. Retrying in 10s...`, 'error');
            setTimeout(() => this.initialize(), 10000);
        }
    }
}

// ============== SOCKET.IO ==============

io.on('connection', (socket) => {
    socket.on('set-user', (userId) => {
        userSockets[userId] = socket.id;
        if (!sessions[userId]) sessions[userId] = new BotSession(userId);
        sessions[userId].sendConnectionStatus();
    });

    socket.on('pair-request', async ({ userId, number }) => {
        if (sessions[userId]) {
            if (!botData.statusSettings[userId]) {
                botData.statusSettings[userId] = { 
                    autoStatus: false, autoSeen: false, autoLike: false, autoDownload: false, isPublic: false
                };
                saveBotData();
            }
            await sessions[userId].initialize(number);
        }
    });

    socket.on('logout', async (userId) => {
        if (sessions[userId]) {
            if (sessions[userId].sock) {
                try { await sessions[userId].sock.logout(); } catch (e) {}
            }
            const authPath = path.join(AUTH_DIR, userId);
            if (fs.existsSync(authPath)) fs.removeSync(authPath);
            delete sessions[userId];
            io.emit('total-active', Object.values(sessions).filter(s => s.isConnected).length);
            const socketId = userSockets[userId];
            if (socketId) io.to(socketId).emit('connection-status', { connected: false, user: userId });
        }
    });

    socket.on('disconnect', () => {
        for (const userId in userSockets) {
            if (userSockets[userId] === socket.id) {
                delete userSockets[userId];
                break;
            }
        }
    });
});

// ============== TELEGRAM BOT ==============

tgBot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === '/start') {
        await tgBot.sendMessage(chatId, 
            "𝗪𝗘𝗟𝗖𝗢𝗠𝗘 𝗧𝗢 𝗛𝗔𝗝𝗜𝗜-𝗠𝗗-𝗕𝗢𝗧\n\n" +
            "𝗘𝗡𝗧𝗘𝗥 𝗬𝗢𝗨𝗥 𝗪𝗛𝗔𝗧𝗦𝗔𝗣𝗣 𝗡𝗨𝗠𝗕𝗘𝗥\n" +
            "(Example: 923000000000)\n\n" +
            "📢 Join Our Channels:\n" +
            "🔹 Telegram: https://t.me/anonymousworld02\n" +
            "🔹 WhatsApp: https://whatsapp.com/channel/0029Vb5pzYl0VycOzcB4fU0B"
        );
        return;
    }

    if (/^\d+$/.test(text)) {
        const userId = chatId.toString();
        if (!sessions[userId]) {
            sessions[userId] = new BotSession(userId);
        }
        
        if (!botData.statusSettings[userId]) {
            botData.statusSettings[userId] = { 
                autoStatus: false, autoSeen: false, autoLike: false, autoDownload: false, isPublic: false
            };
            saveBotData();
        }

        await tgBot.sendMessage(chatId, 
            "⏳ Requesting Pairing Code for " + text + "...\n\n" +
            "📢 Join Our Channels:\n" +
            "🔹 Telegram: https://t.me/anonymousworld02\n" +
            "🔹 WhatsApp: https://whatsapp.com/channel/0029Vb5pzYl0VycOzcB4fU0B"
        );
        sessions[userId].tgChatId = chatId;
        await sessions[userId].initialize(text);
    }
});

// ============== SERVER ==============

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    loadExistingSessions();
});

// Keep alive
setInterval(async () => {
    try {
        await axios.get(`http://localhost:${PORT}/api/status`);
        console.log("Anti-Sleep Ping: Server is active. ⚡");
    } catch (e) {
        console.log("Anti-Sleep Ping: " + e.message);
    }
}, 5 * 60 * 1000);
