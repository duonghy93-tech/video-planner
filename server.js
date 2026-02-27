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

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));
app.use(express.static('public'));
app.use('/output', express.static('output'));

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
        const ytdlpBin = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
        const ytdlpPath = path.join(__dirname, ytdlpBin);

        // Fallback to system-installed yt-dlp
        const ytdlpCmd = fs.existsSync(ytdlpPath) ? ytdlpPath : 'yt-dlp';

        if (!fs.existsSync(ytdlpPath)) {
            // Check if yt-dlp is available globally
            try {
                require('child_process').execSync('yt-dlp --version', { stdio: 'ignore' });
            } catch (e) {
                fs.rmSync(tempDir, { recursive: true, force: true });
                return reject(new Error('yt-dlp không tìm thấy. Cài đặt yt-dlp hoặc đặt binary trong thư mục project.'));
            }
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
app.post('/api/analyze-text', async (req, res) => {
    try {
        const { description, duration, langFormat, presetId } = req.body;
        if (!description || !duration) {
            return res.status(400).json({ error: 'Missing description or duration' });
        }

        // Load preset if specified
        let preset = null;
        if (presetId) {
            const presets = readJsonFile(PRESETS_FILE);
            preset = presets.find(p => p.id === presetId);
            if (preset) {
                console.log(`[analyze-text] Using preset: ${preset.name}`);
                preset = preset.data; // extract the DNA data
            }
        }

        console.log(`[analyze-text] "${description.substring(0, 50)}..." duration: ${duration}s, lang: ${langFormat || 'VN'}${preset ? ', with preset' : ''}`);

        const plan = await gemini.generatePlan(description, parseInt(duration), langFormat || 'VN', preset);

        const projectName = plan.project_name || 'text_project';
        const planDir = path.join(outputDir, projectName + '_' + Date.now());
        fs.mkdirSync(planDir, { recursive: true });
        fs.writeFileSync(path.join(planDir, 'plan.json'), JSON.stringify(plan, null, 2));

        res.json({ success: true, plan, outputDir: planDir });
    } catch (error) {
        console.error('[analyze-text] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
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

// GET /api/presets — List all presets
app.get('/api/presets', (req, res) => {
    const presets = readJsonFile(PRESETS_FILE);
    res.json({ success: true, presets });
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

// GET /api/characters — List all characters
app.get('/api/characters', (req, res) => {
    const characters = readJsonFile(CHARACTERS_FILE);
    res.json({ success: true, characters });
});

// POST /api/characters — Save characters
app.post('/api/characters', (req, res) => {
    try {
        const { characters: newChars, source } = req.body;
        if (!newChars || !newChars.length) {
            return res.status(400).json({ error: 'No characters provided' });
        }

        const allChars = readJsonFile(CHARACTERS_FILE);
        const saved = [];
        for (const ch of newChars) {
            const entry = {
                id: 'char_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                source: source || 'unknown',
                savedAt: new Date().toISOString(),
                ...ch
            };
            allChars.push(entry);
            saved.push(entry);
        }
        writeJsonFile(CHARACTERS_FILE, allChars);

        console.log(`[characters] Saved ${saved.length} characters from: ${source}`);
        res.json({ success: true, saved });
    } catch (error) {
        console.error('[characters] Save error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/characters/:id — Delete a character
app.delete('/api/characters/:id', (req, res) => {
    try {
        let characters = readJsonFile(CHARACTERS_FILE);
        const before = characters.length;
        characters = characters.filter(c => c.id !== req.params.id);
        if (characters.length === before) {
            return res.status(404).json({ error: 'Character not found' });
        }
        writeJsonFile(CHARACTERS_FILE, characters);
        console.log(`[characters] Deleted: ${req.params.id}`);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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

    // Check yt-dlp
    const ytdlpPath = path.join(__dirname, 'yt-dlp.exe');
    if (fs.existsSync(ytdlpPath)) {
        console.log('✅ yt-dlp.exe found — hỗ trợ tải video từ YouTube, TikTok, Facebook, Instagram...\n');
    } else {
        console.log('⚠️  yt-dlp.exe not found — chỉ hỗ trợ link video trực tiếp\n');
    }
});
