const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleGenAI } = require('@google/genai') || {};
const fs = require('fs');
const https = require('https');

// Use Gemini 2.0 Flash with image generation
const genAI = new GoogleGenerativeAI('AIzaSyARRtBGQe8GAumpIP4ix3guM_Nch9J-vCQ');

async function gen() {
    // Try Gemini native image gen
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'Generate a photorealistic image of: A Vietnamese man wearing a black t-shirt and white apron holding a sad wilted piece of romaine lettuce between his fingers. Extreme close-up cinematic shot, 9:16 vertical, dramatic overhead lighting, kitchen background.' }] }],
        generationConfig: {
            responseMimeType: 'text/plain',
        }
    });
    // This model can't generate images directly, use the tool's existing service
    console.log('TEXT:', result.response.text().substring(0, 100));
    console.log('INFO: Using gemini-service instead');

    // Use the existing gemini-service from video-planner
    const svc = require('./gemini-service');
    const imgResult = await svc.generateImage(
        'A Vietnamese man wearing a black t-shirt and white apron holding a sad wilted piece of romaine lettuce between his fingers. Extreme close-up cinematic shot, 9:16 vertical portrait, dramatic overhead lighting, kitchen background, shallow depth of field.',
        '9:16'
    );
    if (imgResult && imgResult.imageData) {
        const buf = Buffer.from(imgResult.imageData, 'base64');
        fs.writeFileSync('/tmp/flow_test.png', buf);
        console.log('Image saved: ' + buf.length + ' bytes');
    } else {
        console.log('Result:', JSON.stringify(imgResult).substring(0, 200));
    }
}

gen().catch(e => console.error('ERR:', e.message));
