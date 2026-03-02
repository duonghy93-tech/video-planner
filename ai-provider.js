/**
 * AI Provider Service — Smart fallback between multiple AI providers
 * Priority: Vertex Key (Claude Opus) > Gemini
 * Image: Flux Pro (fal.ai) > Gemini Image
 */
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DATA_DIR = path.join(__dirname, 'data');
const USER_KEYS_FILE = path.join(DATA_DIR, 'user_api_keys.json');

// ═══════════════════════════════════════════════════════════
// USER API KEYS STORAGE
// ═══════════════════════════════════════════════════════════
function readAllKeys() {
    try {
        if (fs.existsSync(USER_KEYS_FILE)) {
            return JSON.parse(fs.readFileSync(USER_KEYS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[ai-provider] Error reading keys:', e.message);
    }
    return {};
}

function writeAllKeys(data) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USER_KEYS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getUserKeys(userId) {
    const all = readAllKeys();
    return all[userId] || {};
}

function setUserKeys(userId, keys) {
    const all = readAllKeys();
    all[userId] = { ...(all[userId] || {}), ...keys, updatedAt: new Date().toISOString() };
    writeAllKeys(all);
    return all[userId];
}

function deleteUserKey(userId, keyName) {
    const all = readAllKeys();
    if (all[userId]) {
        delete all[userId][keyName];
        all[userId].updatedAt = new Date().toISOString();
        writeAllKeys(all);
    }
}

function getAllUsersKeys() {
    const all = readAllKeys();
    // Mask keys for admin view
    const masked = {};
    for (const [userId, keys] of Object.entries(all)) {
        masked[userId] = {};
        for (const [k, v] of Object.entries(keys)) {
            if (k === 'updatedAt') {
                masked[userId][k] = v;
            } else if (typeof v === 'string' && v.length > 8) {
                masked[userId][k] = v.substring(0, 4) + '***' + v.substring(v.length - 4);
            } else {
                masked[userId][k] = v ? '***' : '';
            }
        }
    }
    return masked;
}

// ═══════════════════════════════════════════════════════════
// PROVIDER STATUS — Check which providers are available
// ═══════════════════════════════════════════════════════════
function getProviderStatus(userId) {
    const keys = getUserKeys(userId);
    const envGemini = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_api_key_here';

    return {
        gemini: {
            available: !!(keys.GEMINI_API_KEY || envGemini),
            source: keys.GEMINI_API_KEY ? 'user' : (envGemini ? 'server' : 'none'),
        },
        vertexKey: {
            available: !!(keys.VERTEX_KEY_API_KEY),
            source: keys.VERTEX_KEY_API_KEY ? 'user' : 'none',
        },
        fal: {
            available: !!(keys.FAL_KEY),
            source: keys.FAL_KEY ? 'user' : 'none',
        },
        warnings: [],
    };
}

function getWarnings(userId) {
    const status = getProviderStatus(userId);
    const warnings = [];

    if (!status.vertexKey.available) {
        warnings.push({
            type: 'warning',
            key: 'VERTEX_KEY_API_KEY',
            message: '⚠️ Chưa có Vertex Key — prompt & phân tích sẽ dùng Gemini (chất lượng thấp hơn)',
            link: 'https://www.vertex-key.com/register',
        });
    }
    if (!status.fal.available) {
        warnings.push({
            type: 'warning',
            key: 'FAL_KEY',
            message: '⚠️ Chưa có Fal.ai — ảnh sẽ tạo bằng Gemini (chất lượng thấp hơn)',
            link: 'https://fal.ai/dashboard/keys',
        });
    }
    if (!status.gemini.available) {
        warnings.push({
            type: 'error',
            key: 'GEMINI_API_KEY',
            message: '❌ Bắt buộc có Gemini API Key để phân tích video',
            link: 'https://aistudio.google.com/apikey',
        });
    }

    return warnings;
}

// ═══════════════════════════════════════════════════════════
// AI TEXT — Claude Opus (Vertex Key) > Gemini
// ═══════════════════════════════════════════════════════════
function getVertexClient(userId) {
    const keys = getUserKeys(userId);
    const apiKey = keys.VERTEX_KEY_API_KEY;
    if (!apiKey) return null;

    return new OpenAI({
        apiKey,
        baseURL: 'https://vertex-key.com/api/v1',
    });
}

/**
 * Generate text/prompt using best available AI
 * @param {string} userId
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {object} options - { temperature, maxTokens, jsonMode }
 * @returns {Promise<{text: string, provider: string}>}
 */
async function generateText(userId, systemPrompt, userMessage, options = {}) {
    // Use Gemini 3.1 Pro directly (faster, free, #3 on Arena)
    // Vertex Key (Opus) disabled — 502 errors and slow
    console.log('[ai-provider] Using Gemini 3.1 Pro directly (Opus disabled)');
    return { text: null, provider: 'gemini-fallback' };
}

/**
 * Generate text with conversation history (for chatbot)
 */
async function generateTextWithHistory(userId, systemPrompt, messages, options = {}) {
    const { temperature = 0.7, maxTokens = 8192 } = options;

    const vertexClient = getVertexClient(userId);
    if (vertexClient) {
        try {
            const response = await vertexClient.chat.completions.create({
                model: 'ultra/claude-opus-4-6',
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...messages,
                ],
                temperature,
                max_tokens: maxTokens,
            });

            return {
                text: response.choices?.[0]?.message?.content || '',
                provider: 'claude-opus',
            };
        } catch (err) {
            console.error('[ai-provider] Vertex Key chat error:', err.message);
        }
    }

    return { text: null, provider: 'gemini-fallback' };
}

// ═══════════════════════════════════════════════════════════
// IMAGE GENERATION — Flux Pro (fal.ai) > Gemini Image
// ═══════════════════════════════════════════════════════════

/**
 * Generate image using best available provider
 * @param {string} userId
 * @param {string} prompt
 * @param {string} outputPath
 * @param {string} aspectRatio - e.g. '16:9', '9:16', '1:1'
 * @returns {Promise<{success: boolean, path: string, provider: string}>}
 */
async function generateImage(userId, prompt, outputPath, aspectRatio = '16:9') {
    const keys = getUserKeys(userId);

    // Tier 1: Try Flux Pro first (best quality, cheapest)
    if (keys.FAL_KEY) {
        try {
            const result = await generateFluxImage(keys.FAL_KEY, prompt, outputPath, aspectRatio);
            if (result.success) return { ...result, provider: 'flux-pro' };
        } catch (err) {
            console.error('[ai-provider] Flux Pro error, falling back:', err.message);
        }
    }

    // Tier 2: Gemini Image via Vertex Key (good quality, more expensive)
    if (keys.VERTEX_KEY_API_KEY) {
        try {
            const result = await generateGeminiImageViaVertex(keys.VERTEX_KEY_API_KEY, prompt, outputPath);
            if (result.success) return { ...result, provider: 'gemini-image-vertex' };
        } catch (err) {
            console.error('[ai-provider] Gemini Image (Vertex) error, falling back:', err.message);
        }
    }

    // Tier 3: Fallback to Gemini free (lowest quality)
    return { success: false, provider: 'gemini-fallback' };
}

/**
 * Gemini Image generation via Vertex Key
 */
async function generateGeminiImageViaVertex(apiKey, prompt, outputPath) {
    const client = new OpenAI({ apiKey, baseURL: 'https://vertex-key.com/api/v1' });

    const response = await client.images.generate({
        model: 'gen/gemini-3.1-flash-image-1k',
        prompt: prompt,
        n: 1,
        size: '1024x1024',
    });

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) throw new Error('No image URL in Vertex Gemini response');

    await downloadFile(imageUrl, outputPath);
    return { success: true, path: outputPath };
}

/**
 * Flux Pro image generation via fal.ai
 */
async function generateFluxImage(falKey, prompt, outputPath, aspectRatio = '16:9') {
    // Map aspect ratios
    const arMap = {
        '16:9': 'landscape_16_9',
        '9:16': 'portrait_16_9',
        '1:1': 'square',
        '4:3': 'landscape_4_3',
        '3:4': 'portrait_4_3',
    };
    const imageSize = arMap[aspectRatio] || 'landscape_16_9';

    const requestBody = JSON.stringify({
        prompt,
        image_size: imageSize,
        num_inference_steps: 28,
        guidance_scale: 3.5,
        num_images: 1,
        safety_tolerance: '5',
    });

    console.log(`[flux-pro] Generating image, size: ${imageSize}...`);

    // Use fal.run synchronous endpoint
    const result = await httpRequest('https://fal.run/fal-ai/flux-pro/v1.1', {
        method: 'POST',
        headers: {
            'Authorization': `Key ${falKey}`,
            'Content-Type': 'application/json',
        },
        body: requestBody,
    });

    const data = JSON.parse(result);

    if (data.images?.[0]?.url) {
        const imgUrl = data.images[0].url;
        console.log(`[flux-pro] Image generated, downloading...`);
        await downloadFile(imgUrl, outputPath);
        return { success: true, path: outputPath };
    }

    throw new Error('No image in Flux Pro response: ' + JSON.stringify(data).substring(0, 200));
}

// ═══════════════════════════════════════════════════════════
// HTTP HELPERS
// ═══════════════════════════════════════════════════════════
function httpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const lib = parsedUrl.protocol === 'https:' ? https : http;

        const reqOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname + parsedUrl.search,
            method: options.method || 'GET',
            headers: options.headers || {},
        };

        const req = lib.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 500)}`));
                } else {
                    resolve(data);
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(120000, () => { req.destroy(); reject(new Error('Request timeout')); });

        if (options.body) req.write(options.body);
        req.end();
    });
}

function downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const file = fs.createWriteStream(outputPath);
        const lib = url.startsWith('https') ? https : http;

        lib.get(url, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                downloadFile(response.headers.location, outputPath).then(resolve).catch(reject);
                return;
            }
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(outputPath); });
        }).on('error', (err) => {
            fs.unlink(outputPath, () => { });
            reject(err);
        });
    });
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════════════════
// MODULE EXPORTS
// ═══════════════════════════════════════════════════════════
module.exports = {
    // Key management
    getUserKeys,
    setUserKeys,
    deleteUserKey,
    getAllUsersKeys,
    getProviderStatus,
    getWarnings,

    // AI providers
    generateText,
    generateTextWithHistory,
    generateImage,

    // Direct access for special cases
    getVertexClient,
};
