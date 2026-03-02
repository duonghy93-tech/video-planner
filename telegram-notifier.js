// ============================================
// Telegram Notification Service
// Sends activity notifications to admin Telegram
// ============================================
const https = require('https');

const BOT_TOKEN = process.env.NOTIFY_BOT_TOKEN || '8508908512:AAEKM-RT3_T5wNR3KfIV83lJIsi0BoN_6nc';
const ADMIN_CHAT_ID = process.env.NOTIFY_CHAT_ID || '5287769272';

/**
 * Send a message to Telegram
 * @param {string} text - Message text (supports HTML)
 * @param {string} [chatId] - Override chat ID
 */
function send(text, chatId) {
    if (!BOT_TOKEN || !ADMIN_CHAT_ID && !chatId) return;
    const target = chatId || ADMIN_CHAT_ID;

    const data = JSON.stringify({
        chat_id: target,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
    });

    const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    }, (res) => {
        // Consume response silently
        res.on('data', () => { });
    });

    req.on('error', (e) => {
        console.error('[TG Notify] Error:', e.message);
    });

    req.write(data);
    req.end();
}

// ============ NOTIFICATION HELPERS ============

function userLogin(username, ip) {
    send(`🔑 <b>Login</b>\n👤 ${esc(username)}\n🌐 ${esc(ip || 'unknown')}`);
}

function userRegister(username, name, role) {
    send(`🆕 <b>New User Registered</b>\n👤 ${esc(username)} (${esc(name)})\n🎭 Role: ${esc(role)}`);
}

function channelCreated(username, channelName, niche) {
    send(`📺 <b>Channel Created</b>\n👤 ${esc(username)}\n📌 ${esc(channelName)}\n🏷 Niche: ${esc(niche || '-')}`);
}

function channelDeleted(username, channelName) {
    send(`🗑 <b>Channel Deleted</b>\n👤 ${esc(username)}\n📌 ${esc(channelName)}`);
}

function roadmapGenerated(username, channelName, roadmapName, totalVideos) {
    send(`🗓 <b>Roadmap Generated</b>\n👤 ${esc(username)}\n📺 ${esc(channelName)}\n📋 ${esc(roadmapName || 'Untitled')}\n🎬 ${totalVideos || '?'} videos`);
}

function planGenerated(username, videoTitle) {
    send(`📝 <b>Plan Generated</b>\n👤 ${esc(username)}\n🎬 ${esc(videoTitle || 'Untitled')}`);
}

function imageGenerated(username, model, prompt) {
    const shortPrompt = (prompt || '').substring(0, 100);
    send(`🖼 <b>Image Generated</b>\n👤 ${esc(username)}\n🤖 Model: ${esc(model || 'unknown')}\n📝 ${esc(shortPrompt)}...`);
}

function videoAnalyzed(username, type, source) {
    send(`🔍 <b>Video Analyzed</b>\n👤 ${esc(username)}\n📊 Type: ${esc(type || 'analysis')}\n📹 ${esc((source || '').substring(0, 80))}`);
}

function videoReviewed(username, source) {
    send(`⭐ <b>Video Reviewed</b>\n👤 ${esc(username)}\n📹 ${esc((source || '').substring(0, 80))}`);
}

function chatMessage(username, model, messagePreview) {
    const short = (messagePreview || '').substring(0, 80);
    send(`💬 <b>Chat</b>\n👤 ${esc(username)}\n🤖 ${esc(model || 'default')}\n📝 ${esc(short)}...`);
}

function presetSaved(username, presetName) {
    send(`💾 <b>Preset Saved</b>\n👤 ${esc(username)}\n📋 ${esc(presetName || 'Untitled')}`);
}

function characterCreated(username, charName) {
    send(`🎭 <b>Character Created</b>\n👤 ${esc(username)}\n🧑 ${esc(charName || 'Untitled')}`);
}

function strategyChat(username, channelName) {
    send(`🎯 <b>Strategy Chat</b>\n👤 ${esc(username)}\n📺 ${esc(channelName)}`);
}

function error(context, errorMsg) {
    send(`❌ <b>Error</b>\n📍 ${esc(context)}\n💥 ${esc((errorMsg || '').substring(0, 200))}`);
}

// HTML escape helper
function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

module.exports = {
    send,
    userLogin,
    userRegister,
    channelCreated,
    channelDeleted,
    roadmapGenerated,
    planGenerated,
    imageGenerated,
    videoAnalyzed,
    videoReviewed,
    chatMessage,
    presetSaved,
    characterCreated,
    strategyChat,
    error,
};
