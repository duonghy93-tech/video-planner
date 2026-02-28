require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const sharp = require('sharp');
let gemini = require('./gemini-service');
const auth = require('./auth');

// Cross-platform yt-dlp path
function getYtdlpCmd() {
    const bin = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    const localPath = path.join(__dirname, bin);
    if (fs.existsSync(localPath)) return localPath;
    // Fallback: system-installed yt-dlp
    try {
        require('child_process').execSync('yt-dlp --version', { stdio: 'ignore' });
        return 'yt-dlp';
    } catch (e) { return null; }
}

// YouTube Data API v3 — for cloud scanning (no IP blocking)
async function scanYouTubeAPI(url) {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) return null;

    // Extract video ID from URL
    let videoId = null;
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) { videoId = m[1]; break; }
    }
    if (!videoId) return null;

    try {
        const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=${videoId}&key=${apiKey}`;
        const res = await new Promise((resolve, reject) => {
            https.get(apiUrl, (resp) => {
                let data = '';
                resp.on('data', chunk => data += chunk);
                resp.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                });
            }).on('error', reject);
        });

        if (!res.items || res.items.length === 0) return null;
        const item = res.items[0];
        return {
            views: parseInt(item.statistics.viewCount) || 0,
            likes: parseInt(item.statistics.likeCount) || 0,
            comments: parseInt(item.statistics.commentCount) || 0,
            title: item.snippet.title || '',
            duration: item.contentDetails.duration || '',
            scannedAt: new Date().toISOString()
        };
    } catch (e) {
        console.error('[YouTube API] Error:', e.message);
        return null;
    }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));
app.use(express.static('public'));
app.use('/output', express.static('output'));

// Per-user API key middleware: read from x-api-key header
app.use((req, res, next) => {
    const headerKey = req.headers['x-api-key'];
    if (headerKey && headerKey.length >= 10) {
        process.env.GEMINI_API_KEY = headerKey;
        // Re-initialize gemini service with this user's key
        delete require.cache[require.resolve('./gemini-service')];
        gemini = require('./gemini-service');
    }
    next();
});

// Multer config — 500MB limit
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only video files (MP4, WebM, MOV, AVI) are allowed'));
        }
    }
});

// Ensure output directory
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Ensure data directory for presets & characters
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const PRESETS_FILE = path.join(dataDir, 'presets.json');
const CHARACTERS_FILE = path.join(dataDir, 'characters.json');
const HISTORY_FILE = path.join(dataDir, 'history.json');
const TEMPLATES_FILE = path.join(dataDir, 'templates.json');

// ============ JSON STORAGE HELPERS ============
function readJsonFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        console.error(`[storage] Error reading ${filePath}:`, e.message);
    }
    return [];
}

function writeJsonFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ============ API ROUTES ============

// Health check
app.get('/api/health', (req, res) => {
    const hasKey = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_api_key_here';
    res.json({
        status: 'ok',
        apiConfigured: hasKey,
        timestamp: new Date().toISOString()
    });
});

// ============ AUTH ROUTES ============
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Thiếu username hoặc password' });
        const result = await auth.loginUser(username, password);
        res.json(result);
    } catch (err) {
        res.status(401).json({ error: err.message });
    }
});

app.post('/api/auth/register', auth.authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ admin mới tạo tài khoản' });
        const { username, password, name, role } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Thiếu username hoặc password' });
        const user = await auth.registerUser(username, password, name, role);
        res.json({ success: true, user });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/auth/users', auth.authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    res.json(auth.getUsers());
});

app.delete('/api/auth/users/:id', auth.authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    try {
        auth.deleteUser(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/auth/me', auth.authMiddleware, (req, res) => {
    res.json({ user: req.user });
});

// ============ ADMIN ROUTES (admin only) ============
app.get('/api/admin/overview', auth.authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const users = auth.getUsers();
    const chPath = path.join(dataDir, 'channels.json');
    const rmPath = path.join(dataDir, 'roadmaps.json');
    const channels = readJsonFile(chPath);
    const roadmaps = readJsonFile(rmPath);
    console.log(`[admin-overview] channels.json exists=${fs.existsSync(chPath)}, count=${channels.length}, roadmaps count=${roadmaps.length}`);
    res.json({
        users: users.length,
        channels: channels.length,
        roadmaps: roadmaps.length,
        userList: users.map(u => ({
            id: u.id, username: u.username, name: u.name, role: u.role,
            channelCount: channels.filter(c => c.userId === u.id).length,
            roadmapCount: roadmaps.filter(r => r.userId === u.id).length
        }))
    });
});

app.get('/api/admin/channels', auth.authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const users = auth.getUsers();
    const channels = readJsonFile(path.join(dataDir, 'channels.json'));
    res.json(channels.map(c => ({
        ...c,
        ownerName: users.find(u => u.id === c.userId)?.username || 'unknown'
    })));
});

app.get('/api/admin/roadmaps', auth.authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const users = auth.getUsers();
    const channels = readJsonFile(path.join(dataDir, 'channels.json'));
    const roadmaps = readJsonFile(path.join(dataDir, 'roadmaps.json'));
    res.json(roadmaps.map(r => ({
        ...r,
        ownerName: users.find(u => u.id === r.userId)?.username || 'unknown',
        channelName: channels.find(c => c.id === r.channelId)?.name || 'unknown'
    })));
});

// ============ STRATEGY CHAT ============
app.post('/api/channels/:id/strategy', auth.authMiddleware, async (req, res) => {
    try {
        const { messages } = req.body;
        const channels = readJsonFile(path.join(dataDir, 'channels.json'));
        const channel = channels.find(c => c.id === req.params.id && c.userId === req.user.id);
        if (!channel) return res.status(404).json({ error: 'Kh\u00f4ng t\u00ecm th\u1ea5y k\u00eanh' });

        const result = await gemini.strategyChat(channel, messages || []);

        // If AI returned a brief, save it to channel
        if (result.done && result.brief) {
            channel.brief = result.brief;
            writeJsonFile(path.join(dataDir, 'channels.json'), channels);
            console.log(`\u2705 Channel brief saved for "${channel.name}"`);
        }

        res.json(result);
    } catch (err) {
        console.error('[strategy-chat] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============ CHANNEL ROUTES ============
const CHANNELS_FILE = path.join(dataDir, 'channels.json');
const ROADMAPS_FILE = path.join(dataDir, 'roadmaps.json');
const SETTINGS_FILE = path.join(dataDir, 'settings.json');

// YouTube API key management (GUI-configurable)
app.post('/api/settings/youtube-key', auth.authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Missing key' });
    const settings = readJsonFile(SETTINGS_FILE) || {};
    settings.youtubeApiKey = key;
    writeJsonFile(SETTINGS_FILE, settings);
    process.env.YOUTUBE_API_KEY = key; // Also set in memory
    console.log('\u2705 YouTube API Key updated from GUI');
    res.json({ success: true });
});

app.get('/api/settings/youtube-key', auth.authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const settings = readJsonFile(SETTINGS_FILE) || {};
    res.json({ hasKey: !!settings.youtubeApiKey, key: settings.youtubeApiKey ? '***' + settings.youtubeApiKey.slice(-4) : '' });
});

// Get user's channels
app.get('/api/channels', auth.authMiddleware, (req, res) => {
    const allChannels = readJsonFile(CHANNELS_FILE);
    const userChannels = allChannels.filter(c => c.userId === req.user.id);
    res.json(userChannels);
});

// Create channel
app.post('/api/channels', auth.authMiddleware, (req, res) => {
    try {
        const { name, niche, description, presetId, socialLinks, postsPerDay, language } = req.body;
        if (!name) return res.status(400).json({ error: 'T\u00ean k\u00eanh kh\u00f4ng \u0111\u01b0\u1ee3c \u0111\u1ec3 tr\u1ed1ng' });

        const channel = {
            id: 'ch_' + Date.now().toString(36),
            userId: req.user.id,
            name,
            niche: niche || '',
            description: description || '',
            presetId: presetId || null,
            socialLinks: socialLinks || {},
            postsPerDay: postsPerDay || 2,
            language: language || 'US',
            createdAt: new Date().toISOString()
        };

        const channels = readJsonFile(CHANNELS_FILE);
        channels.push(channel);
        writeJsonFile(CHANNELS_FILE, channels);
        res.json({ success: true, channel });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update channel
app.put('/api/channels/:id', auth.authMiddleware, (req, res) => {
    try {
        const channels = readJsonFile(CHANNELS_FILE);
        const idx = channels.findIndex(c => c.id === req.params.id && c.userId === req.user.id);
        if (idx === -1) return res.status(404).json({ error: 'Kh\u00f4ng t\u00ecm th\u1ea5y k\u00eanh' });

        const updates = req.body;
        channels[idx] = { ...channels[idx], ...updates, id: channels[idx].id, userId: channels[idx].userId };
        writeJsonFile(CHANNELS_FILE, channels);
        res.json({ success: true, channel: channels[idx] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// GET single channel detail (with roadmaps)
app.get('/api/channels/:id', auth.authMiddleware, (req, res) => {
    try {
        const channels = readJsonFile(CHANNELS_FILE);
        const channel = channels.find(c => c.id === req.params.id && c.userId === req.user.id);
        if (!channel) return res.status(404).json({ error: 'Không tìm thấy kênh' });
        const roadmaps = readJsonFile(ROADMAPS_FILE);
        const channelRoadmaps = roadmaps.filter(r => r.channelId === channel.id);
        res.json({ channel, roadmaps: channelRoadmaps });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// UPDATE channel
app.put('/api/channels/:id', auth.authMiddleware, (req, res) => {
    try {
        const channels = readJsonFile(CHANNELS_FILE);
        const idx = channels.findIndex(c => c.id === req.params.id && c.userId === req.user.id);
        if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy kênh' });
        const { name, niche, description, socialLinks, language, postsPerDay, presetId } = req.body;
        if (name) channels[idx].name = name;
        if (niche !== undefined) channels[idx].niche = niche;
        if (description !== undefined) channels[idx].description = description;
        if (socialLinks) channels[idx].socialLinks = socialLinks;
        if (language) channels[idx].language = language;
        if (postsPerDay) channels[idx].postsPerDay = postsPerDay;
        if (presetId !== undefined) channels[idx].presetId = presetId;
        channels[idx].updatedAt = new Date().toISOString();
        writeJsonFile(CHANNELS_FILE, channels);
        res.json({ success: true, channel: channels[idx] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin: GET any channel detail
app.get('/api/admin/channels/:id', auth.authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    try {
        const channels = readJsonFile(CHANNELS_FILE);
        const channel = channels.find(c => c.id === req.params.id);
        if (!channel) return res.status(404).json({ error: 'Không tìm thấy kênh' });
        const roadmaps = readJsonFile(ROADMAPS_FILE);
        const channelRoadmaps = roadmaps.filter(r => r.channelId === channel.id);
        const users = auth.getUsers();
        const owner = users.find(u => u.id === channel.userId);
        res.json({ channel, roadmaps: channelRoadmaps, ownerName: owner?.username || 'N/A' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete channel
app.delete('/api/channels/:id', auth.authMiddleware, (req, res) => {
    try {
        const channels = readJsonFile(CHANNELS_FILE);
        const filtered = channels.filter(c => !(c.id === req.params.id && c.userId === req.user.id));
        if (filtered.length === channels.length) return res.status(404).json({ error: 'Kh\u00f4ng t\u00ecm th\u1ea5y k\u00eanh' });
        writeJsonFile(CHANNELS_FILE, filtered);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get roadmaps for a specific channel
app.get('/api/channels/:id/roadmaps', auth.authMiddleware, (req, res) => {
    const roadmaps = readJsonFile(ROADMAPS_FILE) || [];
    const channelRoadmaps = roadmaps.filter(r => r.channelId === req.params.id && r.userId === req.user.id);
    res.json(channelRoadmaps);
});

// ============ ROADMAP ROUTES ============

// Generate new roadmap for a channel
app.post('/api/roadmaps/generate', auth.authMiddleware, async (req, res) => {
    try {
        const { channelId, startDate, days } = req.body;
        if (!channelId) return res.status(400).json({ error: 'Thi\u1ebfu channelId' });

        // Find channel (must belong to user)
        const channels = readJsonFile(CHANNELS_FILE);
        const channel = channels.find(c => c.id === channelId && c.userId === req.user.id);
        if (!channel) return res.status(404).json({ error: 'Kh\u00f4ng t\u00ecm th\u1ea5y k\u00eanh' });

        // Load preset if linked
        let preset = null;
        if (channel.presetId) {
            const presets = readJsonFile(PRESETS_FILE);
            const found = presets.find(p => p.id === channel.presetId);
            if (found) preset = found.data;
        }

        console.log(`\ud83d\uddd3\ufe0f Generating roadmap for "${channel.name}" (${days || 7} days)...`);
        const roadmapData = await gemini.generateRoadmap(channel, preset, startDate, days || 7);

        const roadmap = {
            id: 'rm_' + Date.now().toString(36),
            channelId,
            userId: req.user.id,
            ...roadmapData,
            createdAt: new Date().toISOString()
        };

        let roadmaps = readJsonFile(ROADMAPS_FILE);
        // Remove old roadmaps for this channel (keep only latest)
        roadmaps = roadmaps.filter(r => !(r.channelId === channelId && r.userId === req.user.id));
        roadmaps.push(roadmap);
        writeJsonFile(ROADMAPS_FILE, roadmaps);

        console.log(`\u2705 Roadmap created: ${roadmap.roadmap_name || 'untitled'} (${roadmapData.total_videos} videos)`);
        res.json({ success: true, roadmap });
    } catch (err) {
        console.error('[roadmap] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Get roadmaps for a channel
app.get('/api/roadmaps/:channelId', auth.authMiddleware, (req, res) => {
    const roadmaps = readJsonFile(ROADMAPS_FILE);
    const channelRoadmaps = roadmaps
        .filter(r => r.channelId === req.params.channelId && r.userId === req.user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(channelRoadmaps);
});

// Update video status in a roadmap
app.put('/api/roadmaps/:id/video-status', auth.authMiddleware, (req, res) => {
    try {
        const { day, slot, status, publishedUrl } = req.body;
        const roadmaps = readJsonFile(ROADMAPS_FILE);
        const rm = roadmaps.find(r => r.id === req.params.id && r.userId === req.user.id);
        if (!rm) return res.status(404).json({ error: 'Kh\u00f4ng t\u00ecm th\u1ea5y roadmap' });

        const dayObj = rm.days?.find(d => d.day === parseInt(day));
        if (!dayObj) return res.status(404).json({ error: 'Không tìm thấy ngày' });

        const video = dayObj.videos?.find(v => v.slot === parseInt(slot));
        if (!video) return res.status(404).json({ error: 'Kh\u00f4ng t\u00ecm th\u1ea5y video' });

        if (status) video.status = status;
        if (publishedUrl) video.publishedUrl = publishedUrl;

        writeJsonFile(ROADMAPS_FILE, roadmaps);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Generate next roadmap based on previous performance
app.post('/api/roadmaps/:id/next', auth.authMiddleware, async (req, res) => {
    try {
        const roadmaps = readJsonFile(ROADMAPS_FILE);
        const prevRoadmap = roadmaps.find(r => r.id === req.params.id && r.userId === req.user.id);
        if (!prevRoadmap) return res.status(404).json({ error: 'Kh\u00f4ng t\u00ecm th\u1ea5y roadmap' });

        const channels = readJsonFile(CHANNELS_FILE);
        const channel = channels.find(c => c.id === prevRoadmap.channelId && c.userId === req.user.id);
        if (!channel) return res.status(404).json({ error: 'Kh\u00f4ng t\u00ecm th\u1ea5y k\u00eanh' });

        let preset = null;
        if (channel.presetId) {
            const presets = readJsonFile(PRESETS_FILE);
            const found = presets.find(p => p.id === channel.presetId);
            if (found) preset = found.data;
        }

        // Collect performance data from prev roadmap videos
        const performance = [];
        prevRoadmap.days?.forEach(d => {
            d.videos?.forEach(v => {
                performance.push({
                    title: v.title,
                    status: v.status || 'not_published',
                    views: v.metrics?.views,
                    likes: v.metrics?.likes
                });
            });
        });

        console.log(`\ud83d\udd04 Generating next roadmap based on "${prevRoadmap.roadmap_name}"...`);
        const roadmapData = await gemini.generateNextRoadmap(channel, preset, prevRoadmap, performance);

        const newRoadmap = {
            id: 'rm_' + Date.now().toString(36),
            channelId: channel.id,
            userId: req.user.id,
            prevRoadmapId: prevRoadmap.id,
            ...roadmapData,
            createdAt: new Date().toISOString()
        };

        roadmaps.push(newRoadmap);
        writeJsonFile(ROADMAPS_FILE, roadmaps);

        console.log(`\u2705 Next roadmap: ${newRoadmap.roadmap_name || 'untitled'}`);
        res.json({ success: true, roadmap: newRoadmap });
    } catch (err) {
        console.error('[roadmap-next] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============ SCAN PUBLISHED VIDEO (Phase 4) ============
app.post('/api/scan-published', auth.authMiddleware, async (req, res) => {
    try {
        const { url, roadmapId, day, slot, platform } = req.body;
        if (!url) return res.status(400).json({ error: 'Thiếu URL video' });

        console.log(`🔍 Scanning: ${url} (${platform || 'default'})`);

        let metrics = null;
        const isYouTube = /youtube\.com|youtu\.be/i.test(url);

        // Try YouTube Data API first (cloud-friendly)
        if (isYouTube) {
            metrics = await scanYouTubeAPI(url);
            if (metrics) console.log('[YouTube API] ✅ Success');
        }

        // Fallback to yt-dlp
        if (!metrics) {
            const ytdlpPath = getYtdlpCmd();
            if (ytdlpPath) {
                try {
                    const isTikTok = /tiktok\.com/i.test(url);
                    const isFacebook = /facebook\.com|fb\.watch/i.test(url);
                    const args = [
                        '--dump-json', '--no-download',
                        '--no-check-certificates',
                        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    ];
                    if (isTikTok) {
                        args.push('--extractor-args', 'tiktok:api_hostname=api22-normal-c-alisg.tiktokv.com');
                    }
                    args.push(url);

                    const metadata = await new Promise((resolve, reject) => {
                        execFile(ytdlpPath, args,
                            { timeout: 45000 }, (err, stdout) => {
                                if (err) return reject(err);
                                try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
                            });
                    });
                    metrics = {
                        views: metadata.view_count || 0,
                        likes: metadata.like_count || 0,
                        comments: metadata.comment_count || 0,
                        duration: metadata.duration || 0,
                        title: metadata.title || metadata.description?.substring(0, 80) || '',
                        scannedAt: new Date().toISOString()
                    };
                    console.log(`[yt-dlp] ${isTikTok ? 'TikTok' : isFacebook ? 'Facebook' : 'Video'} — views: ${metrics.views}, likes: ${metrics.likes}, comments: ${metrics.comments}`);
                } catch (e) {
                    console.error('[yt-dlp] Failed:', e.message?.substring(0, 200));
                }
            }
        }

        if (!metrics) {
            let msg = 'Không thể quét video';
            if (isYouTube && !process.env.YOUTUBE_API_KEY) msg = 'Thêm YOUTUBE_API_KEY vào env để quét YouTube';
            return res.status(500).json({ error: msg });
        }

        // Save metrics to roadmap if provided
        if (roadmapId && day && slot) {
            const roadmaps = readJsonFile(ROADMAPS_FILE);
            const rm = roadmaps.find(r => r.id === roadmapId && r.userId === req.user.id);
            if (rm) {
                const dayObj = rm.days?.find(d => d.day === parseInt(day));
                const video = dayObj?.videos?.find(v => v.slot === parseInt(slot));
                if (video) {
                    if (platform) {
                        if (!video.publishedUrls) video.publishedUrls = {};
                        video.publishedUrls[platform] = url;
                        if (!video.metrics) video.metrics = {};
                        video.metrics[platform] = metrics;
                    } else {
                        video.metrics = metrics;
                        video.publishedUrl = url;
                    }
                    video.status = 'published';
                    writeJsonFile(ROADMAPS_FILE, roadmaps);
                }
            }
        }

        console.log(`✅ Scanned: ${metrics.title} — ${metrics.views} views, ${metrics.likes} likes`);
        res.json({ success: true, metrics });
    } catch (err) {
        console.error('[scan] Error:', err.message);
        // Friendly error message
        let msg = 'Không thể quét video';
        if (err.message.includes('429')) msg = 'YouTube tạm chặn, thử lại sau 5 phút';
        else if (err.message.includes('not a bot')) msg = 'Cần cookies YouTube để quét trên cloud';
        else if (err.message.includes('JavaScript')) msg = 'Platform này chưa hỗ trợ quét trên cloud';
        res.status(500).json({ error: msg });
    }
});

// ============ AUTO-SCAN SCHEDULER ============
async function scanSingleUrl(url) {
    // Try YouTube API first for YouTube URLs
    const isYouTube = /youtube\.com|youtu\.be/i.test(url);
    if (isYouTube) {
        const apiResult = await scanYouTubeAPI(url);
        if (apiResult) return apiResult;
    }

    const ytdlpPath = getYtdlpCmd();
    if (!ytdlpPath) return null;

    return new Promise((resolve) => {
        execFile(ytdlpPath, ['--dump-json', '--no-download', url], { timeout: 30000 }, (err, stdout) => {
            if (err) { resolve(null); return; }
            try {
                const m = JSON.parse(stdout);
                resolve({
                    views: m.view_count || 0,
                    likes: m.like_count || 0,
                    comments: m.comment_count || 0,
                    duration: m.duration || 0,
                    title: m.title || '',
                    scannedAt: new Date().toISOString()
                });
            } catch (e) { resolve(null); }
        });
    });
}

async function autoScanAllPublished() {
    console.log('\n\ud83d\udd04 [Auto-Scan] B\u1eaft \u0111\u1ea7u qu\u00e9t t\u1ea5t c\u1ea3 video \u0111\u00e3 \u0111\u0103ng...');
    const roadmaps = readJsonFile(ROADMAPS_FILE);
    let scanned = 0, failed = 0;

    for (const rm of roadmaps) {
        if (!rm.days) continue;
        for (const day of rm.days) {
            if (!day.videos) continue;
            for (const video of day.videos) {
                if (video.status !== 'published') continue;

                // Scan multi-platform URLs
                if (video.publishedUrls) {
                    for (const [platform, pUrl] of Object.entries(video.publishedUrls)) {
                        if (!pUrl) continue;
                        const m = await scanSingleUrl(pUrl);
                        if (m) {
                            if (!video.metrics) video.metrics = {};
                            video.metrics[platform] = m;
                            scanned++;
                        } else { failed++; }
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }
                // Legacy single URL
                else if (video.publishedUrl) {
                    const m = await scanSingleUrl(video.publishedUrl);
                    if (m) {
                        if (!video.metricsHistory) video.metricsHistory = [];
                        if (video.metrics && video.metrics.scannedAt) video.metricsHistory.push(video.metrics);
                        if (video.metricsHistory.length > 30) video.metricsHistory = video.metricsHistory.slice(-30);
                        video.metrics = m;
                        scanned++;
                    } else { failed++; }
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        }
    }

    writeJsonFile(ROADMAPS_FILE, roadmaps);
    console.log(`\u2705 [Auto-Scan] Ho\u00e0n th\u00e0nh: ${scanned} th\u00e0nh c\u00f4ng, ${failed} l\u1ed7i`);
    return { scanned, failed };
}

// Schedule auto-scan at 9:00 AM and 9:00 PM (UTC+7 Vietnam time)
function scheduleNextScan() {
    const now = new Date();
    const vnOffset = 7 * 60; // UTC+7
    const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
    const vnNow = new Date(utcMs + (vnOffset * 60000));

    const h = vnNow.getHours();
    let nextHour;
    if (h < 9) nextHour = 9;
    else if (h < 21) nextHour = 21;
    else nextHour = 9; // next day

    const nextScan = new Date(vnNow);
    nextScan.setHours(nextHour, 0, 0, 0);
    if (nextHour <= h) nextScan.setDate(nextScan.getDate() + 1);

    // Convert back to local time
    const delayMs = nextScan.getTime() - vnNow.getTime();

    console.log(`\u23f0 Auto-scan ti\u1ebfp theo l\u00fac ${nextHour}:00 (VN) — c\u00f2n ${Math.round(delayMs / 60000)} ph\u00fat`);

    setTimeout(async () => {
        await autoScanAllPublished();
        scheduleNextScan(); // schedule next one
    }, delayMs);
}
scheduleNextScan();

// Admin: manual trigger auto-scan
app.post('/api/admin/auto-scan', auth.authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    try {
        const result = await autoScanAllPublished();
        res.json({ success: true, ...result });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Weekly summary endpoint
app.get('/api/roadmaps/:id/summary', auth.authMiddleware, (req, res) => {
    try {
        const roadmaps = readJsonFile(ROADMAPS_FILE);
        const rm = roadmaps.find(r => r.id === req.params.id);
        if (!rm) return res.status(404).json({ error: 'Kh\u00f4ng t\u00ecm th\u1ea5y roadmap' });

        let totalViews = 0, totalLikes = 0, totalComments = 0;
        let publishedCount = 0, bestVideo = null;

        rm.days?.forEach(d => {
            d.videos?.forEach(v => {
                if (v.metrics) {
                    totalViews += v.metrics.views || 0;
                    totalLikes += v.metrics.likes || 0;
                    totalComments += v.metrics.comments || 0;
                    publishedCount++;
                    if (!bestVideo || (v.metrics.views || 0) > (bestVideo.views || 0)) {
                        bestVideo = { title: v.title, views: v.metrics.views, likes: v.metrics.likes };
                    }
                }
            });
        });

        res.json({
            roadmapName: rm.roadmap_name,
            weekStart: rm.week_start,
            totalViews, totalLikes, totalComments, publishedCount,
            avgViews: publishedCount ? Math.round(totalViews / publishedCount) : 0,
            bestVideo
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ PROFILE ============
app.get('/api/profile', auth.authMiddleware, (req, res) => {
    res.json({ id: req.user.id, username: req.user.username, name: req.user.name || '', role: req.user.role });
});

app.put('/api/profile', auth.authMiddleware, (req, res) => {
    try {
        const { name } = req.body;
        const users = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf-8'));
        const user = users.find(u => u.id === req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (name !== undefined) user.name = name;
        fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify(users, null, 2));
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/profile/password', auth.authMiddleware, (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Mật khẩu tối thiểu 4 ký tự' });
        const bcrypt = require('bcryptjs');
        const users = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf-8'));
        const user = users.find(u => u.id === req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        user.passwordHash = bcrypt.hashSync(newPassword, 10);
        fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify(users, null, 2));
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Configure API key at runtime (per-session, not saved to disk)
app.post('/api/config', (req, res) => {
    try {
        const { apiKey } = req.body;
        if (!apiKey || apiKey.trim().length < 10) {
            return res.status(400).json({ error: 'API key không hợp lệ' });
        }

        process.env.GEMINI_API_KEY = apiKey.trim();

        // Re-initialize gemini service with new key
        delete require.cache[require.resolve('./gemini-service')];
        gemini = require('./gemini-service');

        console.log('✅ API Key configured via UI (session only)');
        res.json({ success: true, message: 'API Key đã được cấu hình thành công! (chỉ cho phiên này)' });
    } catch (err) {
        console.error('[config] Error:', err.message);
        res.status(500).json({ error: 'Lỗi khi cấu hình: ' + err.message });
    }
});

// POST /api/analyze-video — Analyze uploaded video
app.post('/api/analyze-video', upload.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No video file uploaded' });
        }

        console.log(`[analyze-video] Received: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)}MB)`);
        const langFormat = req.body.langFormat || 'VN';

        const plan = await gemini.analyzeVideo(req.file.buffer, req.file.mimetype, langFormat);

        const projectName = plan.project_name || 'video_project';
        const planDir = path.join(outputDir, projectName + '_' + Date.now());
        fs.mkdirSync(planDir, { recursive: true });
        fs.writeFileSync(path.join(planDir, 'plan.json'), JSON.stringify(plan, null, 2));

        res.json({ success: true, plan, outputDir: planDir });
    } catch (error) {
        console.error('[analyze-video] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/analyze-dna — Deep DNA analysis of uploaded video
app.post('/api/analyze-dna', upload.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No video file uploaded' });
        }

        console.log(`[analyze-dna] Received: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)}MB)`);
        const langFormat = req.body.langFormat || 'VN';

        const dna = await gemini.analyzeVideoDNA(req.file.buffer, req.file.mimetype, langFormat);

        const dnaDir = path.join(outputDir, 'dna_' + Date.now());
        fs.mkdirSync(dnaDir, { recursive: true });
        fs.writeFileSync(path.join(dnaDir, 'dna.json'), JSON.stringify(dna, null, 2));

        res.json({ success: true, dna, outputDir: dnaDir });
    } catch (error) {
        console.error('[analyze-dna] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/analyze-dna-url — DNA analysis from URL
app.post('/api/analyze-dna-url', async (req, res) => {
    try {
        const { url, langFormat } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'Missing video URL' });
        }

        console.log(`[analyze-dna-url] Downloading from: ${url}`);
        const videoBuffer = await downloadVideoFromUrl(url);
        console.log(`[analyze-dna-url] Downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`);

        const dna = await gemini.analyzeVideoDNA(videoBuffer, 'video/mp4', langFormat || 'VN');

        const dnaDir = path.join(outputDir, 'dna_' + Date.now());
        fs.mkdirSync(dnaDir, { recursive: true });
        fs.writeFileSync(path.join(dnaDir, 'dna.json'), JSON.stringify(dna, null, 2));

        res.json({ success: true, dna, outputDir: dnaDir });
    } catch (error) {
        console.error('[analyze-dna-url] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/analyze-url — Download video from URL then analyze
app.post('/api/analyze-url', async (req, res) => {
    try {
        const { url, langFormat } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'Missing video URL' });
        }

        console.log(`[analyze-url] Downloading from: ${url}`);

        const videoBuffer = await downloadVideoFromUrl(url);
        console.log(`[analyze-url] Downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`);

        const plan = await gemini.analyzeVideo(videoBuffer, 'video/mp4', langFormat || 'VN');

        const projectName = plan.project_name || 'url_project';
        const planDir = path.join(outputDir, projectName + '_' + Date.now());
        fs.mkdirSync(planDir, { recursive: true });
        fs.writeFileSync(path.join(planDir, 'plan.json'), JSON.stringify(plan, null, 2));

        res.json({ success: true, plan, outputDir: planDir });
    } catch (error) {
        console.error('[analyze-url] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============ SMART VIDEO DOWNLOADER ============

const SOCIAL_MEDIA_PATTERNS = [
    /youtube\.com|youtu\.be/i,
    /tiktok\.com/i,
    /facebook\.com|fb\.watch|fb\.com/i,
    /instagram\.com/i,
    /twitter\.com|x\.com/i,
    /vimeo\.com/i,
    /dailymotion\.com/i,
    /reddit\.com/i,
    /twitch\.tv/i
];

function isSocialMediaUrl(url) {
    return SOCIAL_MEDIA_PATTERNS.some(pattern => pattern.test(url));
}

async function downloadVideoFromUrl(url) {
    if (isSocialMediaUrl(url)) {
        console.log('[download] Social media URL detected → using yt-dlp');
        return downloadWithYtDlp(url);
    } else {
        console.log('[download] Direct URL → using HTTP');
        return downloadDirect(url);
    }
}

// Download using yt-dlp (YouTube, TikTok, FB, IG, Twitter, etc.)
function downloadWithYtDlp(url) {
    return new Promise((resolve, reject) => {
        const tempDir = path.join(__dirname, 'output', 'temp_' + Date.now());
        fs.mkdirSync(tempDir, { recursive: true });
        const outputTemplate = path.join(tempDir, 'video.%(ext)s');
        const ytdlpCmd = getYtdlpCmd();

        if (!ytdlpCmd) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            return reject(new Error('yt-dlp không tìm thấy. Cài đặt: pip install yt-dlp'));
        }

        const args = [
            url,
            '-o', outputTemplate,
            '-f', 'best[ext=mp4]/best',
            '--merge-output-format', 'mp4',
            '--no-playlist',
            '--max-filesize', '500M',
            '--socket-timeout', '30',
            '--retries', '3'
        ];

        console.log(`[yt-dlp] Starting download...`);

        execFile(ytdlpCmd, args, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { }
                console.error('[yt-dlp] Error:', stderr || error.message);
                const lastLine = (stderr || error.message).toString().split('\n').filter(Boolean).pop();
                return reject(new Error('Không thể tải video: ' + lastLine));
            }

            try {
                const files = fs.readdirSync(tempDir);
                const videoFile = files.find(f => /\.(mp4|webm|mkv|avi|mov)$/i.test(f));

                if (!videoFile) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    return reject(new Error('yt-dlp chạy xong nhưng không tìm thấy file video'));
                }

                const videoPath = path.join(tempDir, videoFile);
                const videoBuffer = fs.readFileSync(videoPath);
                console.log(`[yt-dlp] ✅ Downloaded: ${videoFile} (${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB)`);

                // Clean up temp
                try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { }
                resolve(videoBuffer);
            } catch (readError) {
                try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { }
                reject(new Error('Lỗi đọc file video: ' + readError.message));
            }
        });
    });
}

// Direct HTTP download (for .mp4 links etc)
function downloadDirect(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;

        const request = protocol.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 120000
        }, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                return downloadDirect(response.headers.location).then(resolve).catch(reject);
            }
            if (response.statusCode !== 200) {
                return reject(new Error(`Download failed: HTTP ${response.statusCode}`));
            }
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        });

        request.on('error', reject);
        request.on('timeout', () => {
            request.destroy();
            reject(new Error('Download timeout (120s)'));
        });
    });
}

// ============ OTHER API ROUTES ============

// POST /api/analyze-text — Generate plan from text
app.post('/api/analyze-text', auth.optionalAuth || ((req, res, next) => next()), async (req, res) => {
    try {
        const { description, duration, langFormat, presetId } = req.body;
        if (!description || !duration) {
            return res.status(400).json({ error: 'Missing description or duration' });
        }

        // Load preset if specified
        let preset = null;
        let presetName = '';
        if (presetId) {
            const presets = readJsonFile(PRESETS_FILE);
            const found = presets.find(p => p.id === presetId);
            if (found) {
                console.log(`[analyze-text] Using preset: ${found.name}`);
                presetName = found.name;
                preset = found.data; // extract the DNA data
            }
        }

        console.log(`[analyze-text] "${description.substring(0, 50)}..." duration: ${duration}s, lang: ${langFormat || 'VN'}${preset ? ', with preset' : ''}`);

        const plan = await gemini.generatePlan(description, parseInt(duration), langFormat || 'VN', preset);

        const projectName = plan.project_name || 'text_project';
        const planDir = path.join(outputDir, projectName + '_' + Date.now());
        fs.mkdirSync(planDir, { recursive: true });
        fs.writeFileSync(path.join(planDir, 'plan.json'), JSON.stringify(plan, null, 2));

        // Save to history per user
        const userId = req.user?.id || 'anonymous';
        let history = readJsonFile(HISTORY_FILE) || {};
        if (Array.isArray(history)) history = {}; // safeguard
        if (!history[userId]) history[userId] = [];
        history[userId].unshift({
            id: 'h_' + Date.now().toString(36),
            username: req.user?.username || 'anonymous',
            description: description.substring(0, 200),
            duration: parseInt(duration),
            clipCount: plan.clips?.length || 0,
            projectName: plan.project_name || projectName,
            presetName: presetName || null,
            langFormat: langFormat || 'VN',
            channelId: req.body.channelId || null,
            channelName: req.body.channelName || null,
            roadmapTask: req.body.roadmapTask || null,
            templateStyle: req.body.templateStyle || null,
            plan: plan, // full plan data
            outputDir: planDir,
            createdAt: new Date().toISOString()
        });
        // Keep max 30 per user
        if (history[userId].length > 30) history[userId] = history[userId].slice(0, 30);
        writeJsonFile(HISTORY_FILE, history);

        res.json({ success: true, plan, outputDir: planDir });
    } catch (error) {
        console.error('[analyze-text] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/history — Get generation history for current user
app.get('/api/history', auth.optionalAuth || ((req, res, next) => next()), (req, res) => {
    const userId = req.user?.id || 'anonymous';
    const history = readJsonFile(HISTORY_FILE) || {};
    res.json(history[userId] || []);
});

// DELETE /api/history/:id — Delete a history item
app.delete('/api/history/:id', auth.optionalAuth || ((req, res, next) => next()), (req, res) => {
    const userId = req.user?.id || 'anonymous';
    const history = readJsonFile(HISTORY_FILE) || {};
    if (history[userId]) {
        history[userId] = history[userId].filter(h => h.id !== req.params.id);
        writeJsonFile(HISTORY_FILE, history);
    }
    res.json({ success: true });
});


// ============ TEMPLATE LIBRARY ============
app.get('/api/templates', (req, res) => {
    const templates = readJsonFile(TEMPLATES_FILE) || [];
    res.json(templates);
});

app.post('/api/templates', auth.authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { name, category, thumbnail, description, defaultDuration, defaultLang, tags } = req.body;
    if (!name || !description) return res.status(400).json({ error: 'Thiếu tên hoặc mô tả' });
    const templates = readJsonFile(TEMPLATES_FILE) || [];
    const tpl = {
        id: 'tpl_' + Date.now().toString(36),
        name, category: category || 'custom', thumbnail: thumbnail || '📝',
        description, defaultDuration: defaultDuration || 24, defaultLang: defaultLang || 'VN',
        tags: tags || [], custom: true
    };
    templates.push(tpl);
    writeJsonFile(TEMPLATES_FILE, templates);
    res.json({ success: true, template: tpl });
});

app.delete('/api/templates/:id', auth.authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    let templates = readJsonFile(TEMPLATES_FILE) || [];
    templates = templates.filter(t => t.id !== req.params.id);
    writeJsonFile(TEMPLATES_FILE, templates);
    res.json({ success: true });
});

// ============ EXPORT / IMPORT ROADMAPS ============
app.get('/api/roadmaps/:id/export', auth.authMiddleware, (req, res) => {
    const roadmaps = readJsonFile(ROADMAPS_FILE);
    const rm = roadmaps.find(r => r.id === req.params.id);
    if (!rm) return res.status(404).json({ error: 'Không tìm thấy roadmap' });

    const format = req.query.format || 'json';
    if (format === 'csv') {
        let csv = 'Day,Date,Theme,Title,Idea,Hook Type,Post Time,Hashtags,Status,YouTube Views,TikTok Views,FB Views\n';
        rm.days?.forEach(d => {
            d.videos?.forEach(v => {
                const ytViews = v.metrics?.youtube?.views || v.metrics?.views || 0;
                const ttViews = v.metrics?.tiktok?.views || 0;
                const fbViews = v.metrics?.facebook?.views || 0;
                csv += `${d.day},"${d.date || ''}","${d.theme || ''}","${(v.title || '').replace(/"/g, '""')}","${(v.idea || '').replace(/"/g, '""')}","${v.hook_type || ''}","${v.post_time || ''}","${(v.hashtags || []).join(' ')}",${v.status || 'pending'},${ytViews},${ttViews},${fbViews}\n`;
            });
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${rm.roadmap_name || 'roadmap'}.csv"`);
        return res.send('\uFEFF' + csv); // BOM for Excel UTF-8
    }

    // JSON format
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${rm.roadmap_name || 'roadmap'}.json"`);
    res.json(rm);
});

app.post('/api/roadmaps/import', auth.authMiddleware, (req, res) => {
    try {
        const rmData = req.body;
        if (!rmData.days || !rmData.roadmap_name) {
            return res.status(400).json({ error: 'Invalid roadmap format: cần roadmap_name và days' });
        }
        const roadmaps = readJsonFile(ROADMAPS_FILE) || [];
        const newRm = {
            ...rmData,
            id: 'rm_' + Date.now().toString(36),
            userId: req.user.id,
            channelId: rmData.channelId || null,
            importedAt: new Date().toISOString()
        };
        roadmaps.push(newRm);
        writeJsonFile(ROADMAPS_FILE, roadmaps);
        res.json({ success: true, roadmap: newRm });
    } catch (e) {
        res.status(400).json({ error: 'Lỗi import: ' + e.message });
    }
});

// ============ ANALYTICS ============
app.get('/api/admin/analytics', auth.authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const roadmaps = readJsonFile(ROADMAPS_FILE) || [];

    // Aggregate by platform
    const platformStats = { youtube: { views: 0, likes: 0, comments: 0, count: 0 }, tiktok: { views: 0, likes: 0, comments: 0, count: 0 }, facebook: { views: 0, likes: 0, comments: 0, count: 0 } };
    // Aggregate by date
    const dailyStats = {};
    let totalPublished = 0, totalPending = 0;

    roadmaps.forEach(rm => {
        rm.days?.forEach(d => {
            d.videos?.forEach(v => {
                if (v.status === 'published') totalPublished++;
                else totalPending++;

                if (v.metrics) {
                    // Per-platform metrics
                    for (const p of ['youtube', 'tiktok', 'facebook']) {
                        if (v.metrics[p]) {
                            platformStats[p].views += v.metrics[p].views || 0;
                            platformStats[p].likes += v.metrics[p].likes || 0;
                            platformStats[p].comments += v.metrics[p].comments || 0;
                            platformStats[p].count++;
                        }
                    }
                    // Legacy single metrics
                    if (v.metrics.views && !v.metrics.youtube && !v.metrics.tiktok && !v.metrics.facebook) {
                        platformStats.youtube.views += v.metrics.views || 0;
                        platformStats.youtube.likes += v.metrics.likes || 0;
                        platformStats.youtube.comments += v.metrics.comments || 0;
                        platformStats.youtube.count++;
                    }
                    // Daily aggregation
                    const date = v.metrics.scannedAt?.substring(0, 10) || d.date || 'unknown';
                    if (!dailyStats[date]) dailyStats[date] = { views: 0, likes: 0, comments: 0 };
                    const allViews = (v.metrics.youtube?.views || 0) + (v.metrics.tiktok?.views || 0) + (v.metrics.facebook?.views || 0) + (v.metrics.views || 0);
                    const allLikes = (v.metrics.youtube?.likes || 0) + (v.metrics.tiktok?.likes || 0) + (v.metrics.facebook?.likes || 0) + (v.metrics.likes || 0);
                    dailyStats[date].views += allViews;
                    dailyStats[date].likes += allLikes;
                }
            });
        });
    });

    // Sort daily stats by date
    const sortedDaily = Object.entries(dailyStats).sort(([a], [b]) => a.localeCompare(b)).slice(-30);

    res.json({
        platformStats,
        dailyStats: sortedDaily.map(([date, stats]) => ({ date, ...stats })),
        totalPublished,
        totalPending,
        totalVideos: totalPublished + totalPending
    });
});

// ============ USER-SCOPED ANALYTICS ============
app.get('/api/user/analytics', auth.authMiddleware, (req, res) => {
    const channels = readJsonFile(CHANNELS_FILE) || [];
    const userChannels = channels.filter(c => c.userId === req.user.id);
    const channelIds = userChannels.map(c => c.id);
    const roadmaps = (readJsonFile(ROADMAPS_FILE) || []).filter(rm => channelIds.includes(rm.channelId));

    const platformStats = { youtube: { views: 0, likes: 0, comments: 0, count: 0 }, tiktok: { views: 0, likes: 0, comments: 0, count: 0 }, facebook: { views: 0, likes: 0, comments: 0, count: 0 } };
    const dailyStats = {};
    let totalPublished = 0, totalPending = 0;

    roadmaps.forEach(rm => {
        rm.days?.forEach(d => {
            d.videos?.forEach(v => {
                if (v.status === 'published') totalPublished++;
                else totalPending++;
                if (v.metrics) {
                    for (const p of ['youtube', 'tiktok', 'facebook']) {
                        if (v.metrics[p]) {
                            platformStats[p].views += v.metrics[p].views || 0;
                            platformStats[p].likes += v.metrics[p].likes || 0;
                            platformStats[p].comments += v.metrics[p].comments || 0;
                            platformStats[p].count++;
                        }
                    }
                    if (v.metrics.views && !v.metrics.youtube && !v.metrics.tiktok && !v.metrics.facebook) {
                        platformStats.youtube.views += v.metrics.views || 0;
                        platformStats.youtube.likes += v.metrics.likes || 0;
                        platformStats.youtube.count++;
                    }
                    const date = v.metrics.scannedAt?.substring(0, 10) || d.date || 'unknown';
                    if (!dailyStats[date]) dailyStats[date] = { views: 0, likes: 0 };
                    const allViews = (v.metrics.youtube?.views || 0) + (v.metrics.tiktok?.views || 0) + (v.metrics.facebook?.views || 0) + (v.metrics.views || 0);
                    const allLikes = (v.metrics.youtube?.likes || 0) + (v.metrics.tiktok?.likes || 0) + (v.metrics.facebook?.likes || 0) + (v.metrics.likes || 0);
                    dailyStats[date].views += allViews;
                    dailyStats[date].likes += allLikes;
                }
            });
        });
    });

    const sortedDaily = Object.entries(dailyStats).sort(([a], [b]) => a.localeCompare(b)).slice(-30);
    res.json({
        channelCount: userChannels.length,
        roadmapCount: roadmaps.length,
        platformStats,
        dailyStats: sortedDaily.map(([date, stats]) => ({ date, ...stats })),
        totalPublished, totalPending, totalVideos: totalPublished + totalPending
    });
});

// User scan their own channels
app.post('/api/user/scan-channels', auth.authMiddleware, async (req, res) => {
    const channels = readJsonFile(CHANNELS_FILE) || [];
    const userChannels = channels.filter(c => c.userId === req.user.id);
    if (!userChannels.length) return res.json({ success: true, message: 'Không có kênh nào' });

    const channelIds = userChannels.map(c => c.id);
    const roadmaps = (readJsonFile(ROADMAPS_FILE) || []).filter(rm => channelIds.includes(rm.channelId));

    let scanned = 0, errors = 0;
    for (const rm of roadmaps) {
        for (const d of (rm.days || [])) {
            for (const v of (d.videos || [])) {
                if (v.status === 'published' && v.url) {
                    try {
                        const { execSync } = require('child_process');
                        const raw = execSync(`yt-dlp --dump-json --no-download "${v.url}" 2>/dev/null`, { timeout: 30000 }).toString();
                        const info = JSON.parse(raw);
                        const platform = v.url.includes('tiktok') ? 'tiktok' : v.url.includes('facebook') || v.url.includes('fb.') ? 'facebook' : 'youtube';
                        if (!v.metrics) v.metrics = {};
                        v.metrics[platform] = { views: info.view_count || 0, likes: info.like_count || 0, comments: info.comment_count || 0 };
                        v.metrics.scannedAt = new Date().toISOString();
                        scanned++;
                    } catch (e) { errors++; }
                }
            }
        }
    }
    writeJsonFile(ROADMAPS_FILE, readJsonFile(ROADMAPS_FILE).map(rm => {
        const updated = roadmaps.find(r => r.id === rm.id);
        return updated || rm;
    }));
    res.json({ success: true, scanned, errors });
});

// ============ AI CHATBOT (Multi-conversation) ============
const CHAT_HISTORY_FILE = path.join(dataDir, 'chat_history.json');

function getUserChats(userId) {
    let all = readJsonFile(CHAT_HISTORY_FILE);
    if (Array.isArray(all) || !all) all = {};
    if (!all[userId]) all[userId] = { convs: [] };
    // Migrate old flat array format to new format
    if (Array.isArray(all[userId])) {
        const oldMessages = all[userId];
        all[userId] = { convs: oldMessages.length ? [{ id: 'conv_migrated', title: 'Chat cũ', messages: oldMessages, createdAt: oldMessages[0]?.time || new Date().toISOString() }] : [] };
        writeJsonFile(CHAT_HISTORY_FILE, all);
    }
    return all;
}

// List conversations
app.get('/api/chat/conversations', auth.authMiddleware, (req, res) => {
    const all = getUserChats(req.user.id);
    const convs = (all[req.user.id]?.convs || []).map(c => ({
        id: c.id, title: c.title, messageCount: c.messages.length, channelId: c.channelId || null,
        lastMessage: c.messages.length ? c.messages[c.messages.length - 1].time : c.createdAt
    }));
    res.json(convs);
});

// Create new conversation
app.post('/api/chat/conversations', auth.authMiddleware, (req, res) => {
    const all = getUserChats(req.user.id);
    const conv = {
        id: 'conv_' + Date.now().toString(36),
        title: req.body.title || 'New Chat',
        messages: [],
        createdAt: new Date().toISOString(),
        ...(req.body.channelId ? { channelId: req.body.channelId } : {})
    };
    all[req.user.id].convs.unshift(conv);
    writeJsonFile(CHAT_HISTORY_FILE, all);
    res.json(conv);
});

// Delete conversation (admin only)
app.delete('/api/chat/conversations/:convId', auth.authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ admin mới được xóa cuộc hội thoại' });
    const all = getUserChats(req.user.id);
    all[req.user.id].convs = all[req.user.id].convs.filter(c => c.id !== req.params.convId);
    writeJsonFile(CHAT_HISTORY_FILE, all);
    res.json({ success: true });
});

// Rename conversation
app.patch('/api/chat/conversations/:convId', auth.authMiddleware, (req, res) => {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const all = getUserChats(req.user.id);
    const conv = all[req.user.id].convs.find(c => c.id === req.params.convId);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    conv.title = title.substring(0, 80);
    writeJsonFile(CHAT_HISTORY_FILE, all);
    res.json({ success: true, title: conv.title });
});

// Get conversation messages
app.get('/api/chat/conversations/:convId', auth.authMiddleware, (req, res) => {
    const all = getUserChats(req.user.id);
    const conv = all[req.user.id].convs.find(c => c.id === req.params.convId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conv);
});

// Chat file upload multer
const chatUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime', 'audio/mp3', 'audio/mpeg', 'audio/wav', 'application/pdf', 'text/plain', 'text/csv'];
        cb(null, allowed.includes(file.mimetype));
    }
});

// Send message to a conversation (with optional file)
app.post('/api/chat', auth.authMiddleware, chatUpload.single('file'), async (req, res) => {
    try {
        const message = req.body.message;
        const convId = req.body.convId;
        const file = req.file;
        if (!message && !file) return res.status(400).json({ error: 'Message or file required' });

        const all = getUserChats(req.user.id);
        let conv;

        if (convId) {
            conv = all[req.user.id].convs.find(c => c.id === convId);
        }
        if (!conv) {
            conv = { id: 'conv_' + Date.now().toString(36), title: (message || 'File upload').substring(0, 40), messages: [], createdAt: new Date().toISOString() };
            all[req.user.id].convs.unshift(conv);
        }

        // Load user context
        const channels = (readJsonFile(CHANNELS_FILE) || []).filter(c => c.userId === req.user.id);
        const channelIds = channels.map(c => c.id);
        const roadmaps = (readJsonFile(ROADMAPS_FILE) || []).filter(rm => channelIds.includes(rm.channelId));

        // Build channel-specific context if this is a per-channel conversation
        let channelContext = '';
        if (conv.channelId) {
            const ch = channels.find(c => c.id === conv.channelId);
            if (ch) {
                const chRoadmaps = roadmaps.filter(r => r.channelId === ch.id);
                const totalVideos = chRoadmaps.reduce((s, r) => s + (r.days?.reduce((s2, d) => s2 + (d.videos?.length || 0), 0) || 0), 0);
                const published = chRoadmaps.reduce((s, r) => s + (r.days?.reduce((s2, d) => s2 + (d.videos?.filter(v => v.status === 'published').length || 0), 0) || 0), 0);
                channelContext = `\n\n🎯 KÊNH ĐANG THẢO LUẬN: "${ch.name}"
Danh mục: ${ch.category || 'N/A'} | Niche: ${ch.niche || 'N/A'} | Ngôn ngữ: ${ch.language || 'N/A'} | Đăng: ${ch.postsPerDay || '?'} video/ngày
${ch.description ? `Mô tả: ${ch.description}` : ''}
${ch.brief ? `Chiến lược: Đối tượng=${ch.brief.target_audience || '?'}, Tone=${ch.brief.tone || '?'}, Sản phẩm=${ch.brief.products || '?'}, Đối thủ=${ch.brief.competitors || '?'}` : ''}
${ch.brief?.content_pillars?.length ? `Nội dung chính: ${ch.brief.content_pillars.join(', ')}` : ''}
Roadmaps: ${chRoadmaps.length} | Video: ${published}/${totalVideos} đã đăng
Hãy tập trung vào kênh "${ch.name}" trong cuộc hội thoại này. Mọi gợi ý và phân tích đều dành riêng cho kênh này.`;
            }
        }

        const systemPrompt = `Bạn là trợ lý AI chuyên nghiệp về chiến lược nội dung video ngắn (TikTok, YouTube Shorts, Facebook Reels).

Ngày giờ hiện tại: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}

Thông tin user: ${req.user.username}
Kênh: ${channels.map(c => `"${c.name}" (${c.category})`).join(', ') || 'chưa có'}
Roadmaps: ${roadmaps.length}${channelContext}

Khả năng của bạn:
- Phân tích trend & niche market chi tiết
- Lên chiến lược content dài hạn (30-90 ngày)
- Viết script/kịch bản video hoàn chỉnh
- SEO video: tiêu đề, mô tả, hashtag, thumbnail ideas
- Gợi ý ý tưởng kênh mới với phân tích cạnh tranh
- Content calendar & posting schedule
- Hook/intro hấp dẫn cho video
- Phân tích đối thủ
- Tính toán ROI content
- Tips viral: retention, CTR, engagement
- Phân tích hình ảnh, video, tài liệu được gửi kèm

Bạn có khả năng tìm kiếm Google để lấy thông tin mới nhất. Khi user hỏi về trend, tin tức, hoặc thông tin thời sự, hãy sử dụng tìm kiếm để trả lời chính xác.

Trả lời chi tiết, có cấu trúc rõ ràng (dùng heading, bullet, numbered list). Dùng emoji. Ưu tiên tiếng Việt.`;

        // Build conversation history for Gemini
        const historyMessages = conv.messages.slice(-20).map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }]
        }));

        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const apiKey = process.env.GEMINI_API_KEY || global.__runtimeApiKey;
        if (!apiKey) return res.status(400).json({ error: 'Chưa cấu hình API Key' });

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-pro',
            systemInstruction: systemPrompt,
            tools: [{ googleSearch: {} }]
        });

        // Build message parts (text + optional file)
        const messageParts = [];
        if (message) messageParts.push({ text: message });
        let fileInfo = null;
        if (file) {
            messageParts.push({ inlineData: { mimeType: file.mimetype, data: file.buffer.toString('base64') } });
            fileInfo = { name: file.originalname, type: file.mimetype, size: file.size };
        }

        const chat = model.startChat({ history: historyMessages });
        const result = await chat.sendMessage(messageParts);
        const reply = result.response.text();

        // Save messages
        const userMsg = message || `📎 ${file.originalname}`;
        conv.messages.push({ role: 'user', content: userMsg, time: new Date().toISOString(), ...(fileInfo ? { file: fileInfo } : {}) });
        conv.messages.push({ role: 'ai', content: reply, time: new Date().toISOString() });
        if (conv.messages.length === 2) conv.title = (message || file?.originalname || 'Chat').substring(0, 50);

        // Keep max 200 messages per conversation
        if (conv.messages.length > 200) conv.messages = conv.messages.slice(-200);
        writeJsonFile(CHAT_HISTORY_FILE, all);

        res.json({ reply, convId: conv.id, convTitle: conv.title });
    } catch (e) {
        console.error('Chat error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Legacy endpoint for compatibility
app.get('/api/chat/history', auth.authMiddleware, (req, res) => {
    const all = getUserChats(req.user.id);
    // Return all messages from all conversations flattened
    const allMessages = [];
    (all[req.user.id]?.convs || []).forEach(c => allMessages.push(...c.messages));
    res.json(allMessages);
});

// Admin: view all users' chat logs
app.get('/api/admin/chat-logs', auth.authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    let chatHistory = readJsonFile(CHAT_HISTORY_FILE);
    if (Array.isArray(chatHistory) || !chatHistory) chatHistory = {};
    const users = readJsonFile(path.join(dataDir, 'users.json')) || [];
    console.log('[admin-chat-logs] Users in history:', Object.keys(chatHistory).length);

    const logs = Object.entries(chatHistory).map(([userId, data]) => {
        const user = users.find(u => u.id === userId);
        const convs = data?.convs || (Array.isArray(data) ? [{ messages: data }] : []);
        const allMessages = convs.flatMap(c => c.messages || []);
        return {
            userId,
            username: user?.username || 'Unknown',
            conversationCount: convs.length,
            messageCount: allMessages.length,
            lastMessage: allMessages.length ? allMessages[allMessages.length - 1].time : null,
            conversations: convs.map(c => ({ id: c.id, title: c.title, messageCount: (c.messages || []).length })),
            messages: allMessages
        };
    }).sort((a, b) => (b.lastMessage || '').localeCompare(a.lastMessage || ''));

    res.json(logs);
});

// POST /api/generate-image
app.post('/api/generate-image', async (req, res) => {
    try {
        const { prompt, clipId, engine, aspectRatio, projectDir } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Missing image prompt' });
        }

        const dir = projectDir || path.join(outputDir, 'images_' + Date.now());
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const filename = clipId || 'image_' + Date.now();
        const outputPath = path.join(dir, filename);
        const ar = aspectRatio || '9:16';

        console.log(`[generate-image] Engine: ${engine || 'gemini'}, AR: ${ar}, Clip: ${clipId}`);

        let result;
        if (engine === 'imagen') {
            result = await gemini.generateImageImagen(prompt, outputPath, ar);
        } else {
            result = await gemini.generateImage(prompt, outputPath, ar);
        }

        if (result.success) {
            // Auto-crop to correct aspect ratio using sharp
            const targetDims = {
                '9:16': { w: 768, h: 1365 },
                '16:9': { w: 1365, h: 768 },
                '1:1': { w: 1024, h: 1024 }
            };
            const target = targetDims[ar] || targetDims['9:16'];

            try {
                const imgBuffer = fs.readFileSync(result.path);
                const cropped = await sharp(imgBuffer)
                    .resize(target.w, target.h, { fit: 'cover', position: 'center' })
                    .png()
                    .toBuffer();
                fs.writeFileSync(result.path, cropped);
                console.log(`[generate-image] Cropped to ${target.w}x${target.h} (${ar})`);
            } catch (cropErr) {
                console.warn('[generate-image] Crop failed, using original:', cropErr.message);
            }

            const relativePath = path.relative(__dirname, result.path).replace(/\\/g, '/');
            res.json({ success: true, imagePath: '/' + relativePath, fullPath: result.path });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        console.error('[generate-image] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/upscale-image — Re-generate at higher quality
app.post('/api/upscale-image', async (req, res) => {
    try {
        const { imagePath, clipId, projectDir } = req.body;
        if (!imagePath) {
            return res.status(400).json({ error: 'Missing image path' });
        }

        // Read the original image
        const fullPath = path.join(__dirname, imagePath);
        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: 'Ảnh gốc không tìm thấy' });
        }

        const imageBuffer = fs.readFileSync(fullPath);
        const base64 = imageBuffer.toString('base64');

        console.log(`[upscale] Upscaling: ${clipId}`);

        const result = await gemini.upscaleImage(base64, fullPath);

        if (result.success) {
            const relativePath = path.relative(__dirname, result.path).replace(/\\/g, '/');
            res.json({ success: true, imagePath: '/' + relativePath, fullPath: result.path });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        console.error('[upscale] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/download-image — Download image with proper filename
app.get('/api/download-image', (req, res) => {
    try {
        const { path: imgPath, name } = req.query;
        if (!imgPath) return res.status(400).json({ error: 'Missing path' });

        // Handle both relative and absolute paths
        let fullPath = imgPath.startsWith('/') ? path.join(__dirname, imgPath) : imgPath;
        if (!fs.existsSync(fullPath)) {
            // Try without leading slash
            fullPath = path.join(__dirname, 'public', imgPath);
            if (!fs.existsSync(fullPath)) {
                return res.status(404).json({ error: 'File not found: ' + imgPath });
            }
        }

        const ext = path.extname(fullPath) || '.png';
        const filename = (name || 'image') + ext;

        res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.resolve(fullPath));
    } catch (error) {
        console.error('[download] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/generate-all
app.post('/api/generate-all', async (req, res) => {
    try {
        const { clips, engine, projectDir } = req.body;
        if (!clips || !clips.length) {
            return res.status(400).json({ error: 'No clips provided' });
        }

        const dir = projectDir || path.join(outputDir, 'project_' + Date.now());
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        console.log(`[generate-all] Generating ${clips.length} images with ${engine || 'gemini'}`);

        const results = [];
        for (const clip of clips) {
            const outputPath = path.join(dir, clip.clip_id || `clip_${results.length + 1}`);
            try {
                let result;
                if (engine === 'imagen') {
                    result = await gemini.generateImageImagen(clip.reference_image_prompt, outputPath);
                } else {
                    result = await gemini.generateImage(clip.reference_image_prompt, outputPath);
                }

                if (result.success) {
                    const relativePath = path.relative(__dirname, result.path).replace(/\\/g, '/');
                    results.push({ clip_id: clip.clip_id, success: true, imagePath: '/' + relativePath });
                } else {
                    results.push({ clip_id: clip.clip_id, success: false, error: result.error });
                }
            } catch (err) {
                results.push({ clip_id: clip.clip_id, success: false, error: err.message });
            }
        }

        res.json({ success: true, results, outputDir: dir });
    } catch (error) {
        console.error('[generate-all] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/review-video
app.post('/api/review-video', upload.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No video file uploaded' });
        }

        console.log(`[review-video] Reviewing: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)}MB)`);

        const review = await gemini.reviewVideo(req.file.buffer, req.file.mimetype);

        const reviewDir = path.join(outputDir, 'review_' + Date.now());
        fs.mkdirSync(reviewDir, { recursive: true });
        fs.writeFileSync(path.join(reviewDir, 'review.json'), JSON.stringify(review, null, 2));

        res.json({ success: true, review, outputDir: reviewDir });
    } catch (error) {
        console.error('[review-video] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============ PRESET & CHARACTER CRUD ============

// GET /api/presets — List user's presets
app.get('/api/presets', auth.optionalAuth, (req, res) => {
    const presets = readJsonFile(PRESETS_FILE);
    const userId = req.user?.id;
    // Users see only their own presets; admin sees all
    const filtered = (req.user?.role === 'admin') ? presets : presets.filter(p => p.userId === userId || !p.userId);
    res.json({ success: true, presets: filtered });
});

// POST /api/presets — Save a new preset
app.post('/api/presets', (req, res) => {
    try {
        const { name, data } = req.body;
        if (!name || !data) {
            return res.status(400).json({ error: 'Missing name or data' });
        }

        const presets = readJsonFile(PRESETS_FILE);
        const preset = {
            id: 'preset_' + Date.now(),
            name: name,
            userId: req.user?.id || null,
            username: req.user?.username || null,
            createdAt: new Date().toISOString(),
            data: data
        };
        presets.push(preset);
        writeJsonFile(PRESETS_FILE, presets);

        console.log(`[presets] Saved: ${name} (${preset.id})`);
        res.json({ success: true, preset });
    } catch (error) {
        console.error('[presets] Save error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/presets/:id — Delete a preset
app.delete('/api/presets/:id', (req, res) => {
    try {
        let presets = readJsonFile(PRESETS_FILE);
        const before = presets.length;
        presets = presets.filter(p => p.id !== req.params.id);
        if (presets.length === before) {
            return res.status(404).json({ error: 'Preset not found' });
        }
        writeJsonFile(PRESETS_FILE, presets);
        console.log(`[presets] Deleted: ${req.params.id}`);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.get('/api/characters', auth.authMiddleware, (req, res) => {
    const chars = readJsonFile(CHARACTERS_FILE) || [];
    const userId = req.user.id;
    const filtered = (req.user.role === 'admin') ? chars : chars.filter(c => c.userId === userId);
    res.json(filtered);
});

app.post('/api/characters', auth.authMiddleware, (req, res) => {
    try {
        const { name, characterId, gender, age, species, appearance, personality, backstory, imageUrl, voiceStyle } = req.body;
        if (!name) return res.status(400).json({ error: 'Character name required' });

        const chars = readJsonFile(CHARACTERS_FILE) || [];
        const char = {
            id: 'char_' + Date.now(),
            userId: req.user.id,
            username: req.user.username,
            name, characterId, gender, age, species,
            appearance, personality, backstory,
            imageUrl, voiceStyle,
            createdAt: new Date().toISOString()
        };
        chars.push(char);
        writeJsonFile(CHARACTERS_FILE, chars);
        console.log(`[characters] Saved: ${name} by ${req.user.username}`);
        res.json({ success: true, character: char });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/characters/:id', auth.authMiddleware, (req, res) => {
    try {
        let chars = readJsonFile(CHARACTERS_FILE) || [];
        const before = chars.length;
        chars = chars.filter(c => c.id !== req.params.id || (c.userId !== req.user.id && req.user.role !== 'admin'));
        if (chars.length === before) return res.status(404).json({ error: 'Not found' });
        writeJsonFile(CHARACTERS_FILE, chars);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ START SERVER ============
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║     🎬 Video Production Planner - Veo 3.1       ║
║     Server running at http://localhost:${PORT}      ║
╚══════════════════════════════════════════════════╝
  `);

    const hasKey = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_api_key_here';
    if (!hasKey) {
        console.log('⚠️  API Key chưa cấu hình — click nút trên giao diện để nhập\n');
    } else {
        console.log('✅ Gemini API Key loaded from .env\n');
    }

    // Load YouTube API key from settings if not in env
    if (!process.env.YOUTUBE_API_KEY) {
        try {
            const settings = readJsonFile(path.join(dataDir, 'settings.json')) || {};
            if (settings.youtubeApiKey) {
                process.env.YOUTUBE_API_KEY = settings.youtubeApiKey;
            }
        } catch (e) { }
    }

    if (process.env.YOUTUBE_API_KEY) {
        console.log('✅ YouTube Data API Key loaded — scan YouTube trên cloud OK\n');
    } else {
        console.log('⚠️  YouTube API Key chưa cấu hình — nhập từ GUI hoặc env\n');
    }

    // Check yt-dlp
    const ytdlpCmd = getYtdlpCmd();
    if (ytdlpCmd) {
        console.log(`✅ yt-dlp found (${ytdlpCmd}) — hỗ trợ tải video từ YouTube, TikTok, Facebook, Instagram...\n`);
    } else {
        console.log('⚠️  yt-dlp not found — cài đặt: pip install yt-dlp\n');
    }

    // Create default admin
    auth.ensureAdmin();
});
