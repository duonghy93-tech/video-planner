require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const fs = require('fs');
const path = require('path');
const os = require('os');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

// ============ MODELS ============
const flashModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
const proModel = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

// Safe JSON parser — handles markdown fences and extra text
function safeJsonParse(text) {
    // Remove markdown code fences
    let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    // Try direct parse
    try { return JSON.parse(cleaned); } catch (e) { }

    // Try extracting JSON object
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) {
        try { return JSON.parse(objMatch[0]); } catch (e) { }
    }

    // Try extracting JSON array
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrMatch) {
        try { return JSON.parse(arrMatch[0]); } catch (e) { }
    }

    throw new Error('AI response is not valid JSON');
}

// ============ VIDEO FILE UPLOAD ============
async function uploadVideoForAnalysis(videoBuffer, mimeType) {
    // Save buffer to temp file
    const tempPath = path.join(os.tmpdir(), `video_${Date.now()}.mp4`);
    fs.writeFileSync(tempPath, videoBuffer);

    try {
        console.log(`[File API] Uploading video (${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB)...`);
        const uploadResult = await fileManager.uploadFile(tempPath, {
            mimeType: mimeType,
            displayName: `video_analysis_${Date.now()}`
        });

        // Wait for processing
        let file = await fileManager.getFile(uploadResult.file.name);
        let waitCount = 0;
        while (file.state === 'PROCESSING') {
            console.log(`[File API] Processing... (${++waitCount * 5}s)`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            file = await fileManager.getFile(uploadResult.file.name);
        }

        if (file.state === 'FAILED') {
            throw new Error('Video processing failed on Gemini servers');
        }

        console.log(`[File API] Video ready: ${file.uri}`);
        return { fileData: { mimeType: file.mimeType, fileUri: file.uri } };
    } finally {
        // Cleanup temp file
        try { fs.unlinkSync(tempPath); } catch (e) { }
    }
}

// ============ HELPER ============
function buildClipJsonSchema(clipCount) {
    return `Return a valid JSON object with this exact structure:
{
  "project_name": "short_name_for_project",
  "total_duration_sec": <number>,
  "total_clips": ${clipCount},
  "style_guide": {
    "overall_style": "...",
    "color_palette": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"],
    "mood": "...",
    "reference_description": "..."
  },
  "characters": [
    {
      "char_id": "char_01",
      "name": "Character name or role",
      "gender": "male|female",
      "age_range": "25-30",
      "ethnicity": "e.g., Vietnamese, Caucasian",
      "appearance": "VERY detailed: hair color+style+length, eye color, face shape, skin tone, body build, height, distinguishing features",
      "clothing": "Detailed outfit: colors, materials, accessories. Keep SAME across all clips.",
      "voice": "Voice description"
    }
  ],
  "storyline_summary": "...",
  "clips": [
    {
      "clip_id": "project_clip_01",
      "clip_number": 1,
      "duration_sec": 8,
      "format": "9:16",
      "character_ids": ["char_01"],
      "ref_image_start": "OPENING FRAME (0-2s): Detailed image prompt for the first moment of the clip. MUST include FULL character appearance+clothing. Describe composition, camera angle, lighting, background.",
      "ref_image_key": "KEY MOMENT (3-5s): Detailed image prompt for the main action/peak moment. MUST include FULL character appearance+clothing. Describe the key action, expression, composition.",
      "ref_image_end": "CLOSING FRAME (6-8s): Detailed image prompt for the last moment. MUST include FULL character appearance+clothing. Should transition smoothly to the next clip.",
      "voice_id": "en-US-male-cinematic-deep",
      "constraints": {
        "style": "...",
        "lighting": "...",
        "no_text": "no captions, no readable text, no logos",
        "artifact_guard": "no morphing, no flicker, objects retain shape...",
        "physics": "realistic physics..."
      },
      "audio": {
        "music": "...",
        "sfx": ["sfx1", "sfx2"]
      },
      "timeline": [
        {
          "t": "0.0-2.0",
          "camera": "camera movement",
          "action": "action description + repeat character appearance details",
          "sfx": "sfx",
          "dialogue": "dialogue or empty"
        }
      ]
    }
  ]
}

3 REFERENCE IMAGE RULES:
- Each clip MUST have 3 image prompts: ref_image_start, ref_image_key, ref_image_end
- ref_image_start = Opening frame (0-2s): establishes the scene, character position, composition
- ref_image_key = Key moment (3-5s): the main action or peak moment of the clip
- ref_image_end = Closing frame (6-8s): should visually connect/transition to the NEXT clip
- ALL 3 prompts MUST include FULL character appearance+clothing (never use shorthand like "same character")
- The 3 images should tell a visual story: Start → Action → End

CHARACTER CONSISTENCY RULES:
- Define ALL characters in "characters" array with EXTREMELY detailed appearance
- In EVERY ref_image prompt: repeat FULL character appearance + clothing
- Characters wear SAME outfit across all clips unless story requires change
- If no human characters, set characters to empty array []`;
}

// ============ LANGUAGE RULES BUILDER ============
function buildLanguageRules(langFormat) {
    if (langFormat === 'US') {
        return `
LANGUAGE RULES (CRITICAL - US/English format):
- ALL content MUST be written in ENGLISH
- reference_image_prompt: English
- characters (appearance, clothing, name, voice): English
- constraints: English
- timeline (camera, action, sfx, dialogue): English
- audio (music, sfx): English
- storyline_summary: English
- style_guide: English`;
    }
    return `
LANGUAGE RULES (CRITICAL - Vietnamese format):
- reference_image_prompt: MUST be in ENGLISH (for best AI image generation quality)
- characters.appearance: MUST be in ENGLISH
- characters.clothing: MUST be in ENGLISH
- constraints: MUST be in ENGLISH
- timeline.camera: MUST be in ENGLISH (used as Veo 3.1 video prompt)
- timeline.action: MUST be in ENGLISH (used as Veo 3.1 video prompt)
- timeline.sfx: MUST be in ENGLISH
- storyline_summary: Vietnamese
- timeline.dialogue: Vietnamese
- audio.music: Vietnamese
- audio.sfx: Vietnamese
- style_guide: Vietnamese
- characters.name, characters.voice: Vietnamese`;
}

// ============ ANALYZE VIDEO DNA (DEEP ANALYSIS) ============
async function analyzeVideoDNA(videoBuffer, mimeType, langFormat) {
    const dnaPrompt = `You are a world-class viral video analyst and content strategist. Perform an extremely deep "DNA analysis" of this video.

Your goal: Extract EVERYTHING that makes this video valuable, engaging, and potentially profitable. Think like a top-tier content creator who wants to reverse-engineer this video's success.

Return a valid JSON object with this exact structure:
{
  "video_dna": {
    "title": "Short descriptive title for this video",
    "category": "e.g., Food, Travel, Tech, Education, Entertainment",
    "platform_fit": ["TikTok", "YouTube Shorts", "Instagram Reels"],
    "estimated_duration_sec": <number>,
    "overall_score": <1-100>,
    "virality_score": <1-100>,
    "production_score": <1-100>
  },
  "money_points": [
    {
      "timestamp": "e.g., 0.0-3.0s",
      "type": "hook|emotional_peak|cta|retention_trick|pattern_interrupt|satisfying_moment|cliffhanger",
      "description": "What exactly happens and WHY it works",
      "impact_score": <1-10>,
      "reusable_technique": "How to replicate this technique in other videos"
    }
  ],
  "hook_strategy": {
    "hook_type": "question|shock|curiosity|visual_wow|sound|text_overlay",
    "hook_timestamp": "0.0-X.Xs",
    "hook_description": "Detailed description of the hook",
    "hook_effectiveness": <1-10>,
    "why_it_works": "Psychology behind why this hook captures attention"
  },
  "pacing_rhythm": {
    "tempo": "fast|medium|slow|variable",
    "beat_pattern": "Description of the editing rhythm (e.g., quick cuts every 1.5s, building to climax)",
    "transition_style": "cut|dissolve|swipe|zoom|match_cut|whip_pan",
    "energy_curve": "Description of energy flow (e.g., starts high, dips, builds to climax)"
  },
  "emotional_arc": {
    "opening_emotion": "curiosity|excitement|shock|calm",
    "peak_emotion": "satisfaction|awe|humor|desire|inspiration",
    "closing_emotion": "satisfaction|wanting_more|inspired|entertained",
    "emotional_journey": "Narrative of the emotional progression"
  },
  "style_dna": {
    "overall_style": "Detailed style description",
    "color_grading": "Specific color grading description (warm/cool tones, contrast level, saturation)",
    "color_palette": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"],
    "lighting_setup": "Natural/studio/mixed, direction, quality, color temperature",
    "lens_style": "Wide/telephoto/macro, depth of field, focal length feel",
    "composition_rules": "Rule of thirds, centered, dynamic angles, etc.",
    "edit_rhythm_bpm": "Estimated editing tempo in beats per minute",
    "text_overlay_style": "Font style, animation, placement if any",
    "sound_design": "Music genre, SFX usage, voice style",
    "mood": "Overall mood/atmosphere"
  },
  "characters": [
    {
      "char_id": "char_01",
      "name": "Character name or role",
      "gender": "male|female",
      "age_range": "25-30",
      "ethnicity": "e.g., Vietnamese, Caucasian",
      "appearance": "EXTREMELY detailed: hair color+style+length, eye color, face shape, skin tone, body build, height, distinguishing features",
      "clothing": "Detailed outfit: colors, materials, accessories",
      "personality": "Character personality traits and energy",
      "voice": "Voice description: tone, accent, pace",
      "role_in_video": "narrator|protagonist|demonstrator|reviewer"
    }
  ],
  "content_formula": {
    "structure": "Step-by-step content structure (e.g., hook → problem → solution → result → CTA)",
    "storytelling_technique": "before-after|tutorial|day-in-life|transformation|review|challenge",
    "audience_target": "Who this content is made for",
    "unique_selling_point": "What makes this video stand out from similar content"
  },
  "replication_guide": {
    "difficulty": "easy|medium|hard",
    "required_equipment": ["camera type", "lighting", "props"],
    "key_success_factors": ["factor 1", "factor 2", "factor 3"],
    "common_mistakes_to_avoid": ["mistake 1", "mistake 2"]
  },
  "suggested_preset_name": "Short preset name for saving (e.g., 'Cinematic Food Close-up', 'Fast-paced Tech Review')"
}

IMPORTANT:
- Be EXTREMELY specific and actionable — every insight should be directly usable
- The money_points array should contain ALL moments that drive engagement/revenue
- The style_dna should be detailed enough to recreate the exact look and feel
- Score honestly — don't inflate scores
- Return ONLY the JSON, no markdown formatting, no code blocks
${langFormat === 'US' ? '- ALL text content MUST be in English' : '- Text content in Vietnamese, keep technical terms in English'}`;

    const videoPart = await uploadVideoForAnalysis(videoBuffer, mimeType);

    const result = await proModel.generateContent([dnaPrompt, videoPart]);
    const text = result.response.text();
    return parseJsonResponse(text);
}

// ============ ANALYZE VIDEO ============
async function analyzeVideo(videoBuffer, mimeType, langFormat) {
    const clipAnalysisPrompt = `You are an expert AI video production planner specialized in Google Veo 3.1.

Analyze this video carefully and create a detailed production plan to recreate a similar video using Veo 3.1. 
Each Veo 3.1 clip is exactly 8 seconds long.

For each clip:
1. Describe exactly what happens visually in detail
2. Create a cinematic video prompt optimized for Veo 3.1
3. Create an image generation prompt for a reference image
4. Specify camera movements, SFX, dialogue
5. Add constraints to prevent common AI video artifacts (morphing, flickering, unnatural physics)
6. Split the 8-second timeline into 3-4 segments with precise timestamps

Analyze the video's style, mood, lighting, color grading, and pacing.

${buildClipJsonSchema('(based on video length, ceil(video_length / 8))')}

IMPORTANT: 
- Return ONLY the JSON, no markdown formatting, no code blocks.
${buildLanguageRules(langFormat || 'VN')}`;

    const videoPart = await uploadVideoForAnalysis(videoBuffer, mimeType);

    const result = await proModel.generateContent([clipAnalysisPrompt, videoPart]);
    const text = result.response.text();
    return parseJsonResponse(text);
}

// ============ GENERATE PLAN FROM TEXT ============
async function generatePlan(description, durationSeconds, langFormat, preset) {
    const clipCount = Math.ceil(durationSeconds / 8);

    let presetInstructions = '';
    if (preset) {
        presetInstructions = `\n\n=== PRESET APPLIED (MUST FOLLOW) ===\n`;

        // Custom preset: raw text rules from user
        if (preset.type === 'custom' && preset.custom_rules) {
            presetInstructions += `CUSTOM PRODUCTION RULES (follow ALL of these strictly):\n`;
            presetInstructions += preset.custom_rules + '\n';
        }

        // DNA-based preset
        if (preset.style_dna) {
            presetInstructions += `STYLE DNA (apply these EXACT visual parameters):\n`;
            presetInstructions += `- Overall style: ${preset.style_dna.overall_style || ''}\n`;
            presetInstructions += `- Color grading: ${preset.style_dna.color_grading || ''}\n`;
            presetInstructions += `- Color palette: ${JSON.stringify(preset.style_dna.color_palette || [])}\n`;
            presetInstructions += `- Lighting: ${preset.style_dna.lighting_setup || ''}\n`;
            presetInstructions += `- Lens: ${preset.style_dna.lens_style || ''}\n`;
            presetInstructions += `- Composition: ${preset.style_dna.composition_rules || ''}\n`;
            presetInstructions += `- Sound design: ${preset.style_dna.sound_design || ''}\n`;
            presetInstructions += `- Mood: ${preset.style_dna.mood || ''}\n`;
        }
        if (preset.pacing_rhythm) {
            presetInstructions += `\nPACING (match this rhythm):\n`;
            presetInstructions += `- Tempo: ${preset.pacing_rhythm.tempo || ''}\n`;
            presetInstructions += `- Beat pattern: ${preset.pacing_rhythm.beat_pattern || ''}\n`;
            presetInstructions += `- Transition: ${preset.pacing_rhythm.transition_style || ''}\n`;
        }
        if (preset.hook_strategy) {
            presetInstructions += `\nHOOK STRATEGY (use this approach):\n`;
            presetInstructions += `- Type: ${preset.hook_strategy.hook_type || ''}\n`;
            presetInstructions += `- Description: ${preset.hook_strategy.hook_description || ''}\n`;
        }
        if (preset.content_formula) {
            presetInstructions += `\nCONTENT FORMULA:\n`;
            presetInstructions += `- Structure: ${preset.content_formula.structure || ''}\n`;
            presetInstructions += `- Technique: ${preset.content_formula.storytelling_technique || ''}\n`;
        }
        if (preset.characters && preset.characters.length > 0) {
            presetInstructions += `\nCHARACTERS (use these EXACT characters with their appearance):\n`;
            preset.characters.forEach(ch => {
                presetInstructions += `- ${ch.name}: ${ch.appearance || ''}, wearing ${ch.clothing || ''}, ${ch.gender || ''}, ${ch.age_range || ''}, ${ch.ethnicity || ''}\n`;
            });
        }
        presetInstructions += `\n=== END PRESET (all clips MUST follow these parameters) ===`;
    }

    const prompt = `You are an expert AI video production planner specialized in Google Veo 3.1.

Create a detailed production plan for the following video concept:
"${description}"

Total duration: ${durationSeconds} seconds
Number of clips: ${clipCount} (each clip is exactly 8 seconds for Veo 3.1)
${presetInstructions}

Requirements:
1. Create a compelling storyline that flows naturally across all ${clipCount} clips
2. Each clip must have a detailed JSON structure with timeline, camera movements, SFX, dialogue
3. Image reference prompts should be highly detailed for generating reference images
4. Add "constraints" to prevent common AI video artifacts:
   - No morphing of objects/people
   - Realistic physics (liquids, smoke, fabric)
   - No flickering or visual glitches
   - Objects retain their shape throughout
5. The video prompts should be optimized for Veo 3.1's strengths:
   - Cinematic camera movements
   - Native audio generation
   - Photoreal rendering
6. Split each 8-second clip timeline into 3-4 segments with timestamps
7. Make the dialogue/voice-over engaging and hook-driven (if applicable)
${preset ? '8. CRITICAL: Follow the PRESET parameters above for style, pacing, and characters' : ''}

${buildClipJsonSchema(clipCount)}

IMPORTANT: 
- Return ONLY the JSON, no markdown formatting, no code blocks.
${buildLanguageRules(langFormat || 'VN')}`;

    const result = await proModel.generateContent(prompt);
    const text = result.response.text();
    return parseJsonResponse(text);
}

// ============ GENERATE IMAGE (Gemini Flash) ============
async function generateImage(imagePrompt, outputPath, aspectRatio) {
    const ar = aspectRatio || '9:16';
    // Explicit dimension mapping for reliable generation
    const dimMap = {
        '9:16': { w: 768, h: 1365, desc: 'TALL VERTICAL portrait (width=768, height=1365). The image must be TALLER than it is WIDE.' },
        '16:9': { w: 1365, h: 768, desc: 'WIDE HORIZONTAL landscape (width=1365, height=768). The image must be WIDER than it is TALL.' },
        '1:1': { w: 1024, h: 1024, desc: 'PERFECT SQUARE (width=1024, height=1024). Width and height must be exactly equal.' }
    };
    const dim = dimMap[ar] || dimMap['9:16'];

    try {
        const imageModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image' });

        const result = await imageModel.generateContent({
            contents: [{
                role: 'user',
                parts: [{
                    text: `CRITICAL REQUIREMENT: Generate an image that is ${dim.desc}
Aspect ratio: ${ar}. Resolution: ${dim.w}x${dim.h} pixels.

Image content: ${imagePrompt}

Style: cinematic, photoreal, professional lighting and color grading, shallow depth of field.
REMEMBER: The output image MUST be ${ar} format (${dim.desc}).`
                }]
            }],
            generationConfig: {
                responseModalities: ['TEXT', 'IMAGE']
            }
        });

        return extractImageFromResponse(result.response, outputPath, 'Gemini Flash');
    } catch (error) {
        console.error('Image generation error:', error.message);
        return { success: false, error: error.message };
    }
}

// ============ GENERATE IMAGE WITH IMAGEN 4 (REST API) ============
async function generateImageImagen(imagePrompt, outputPath, aspectRatio) {
    const ar = aspectRatio || '9:16';
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('API Key chưa cấu hình');

        const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`;

        const body = {
            instances: [{
                prompt: `${imagePrompt}. Cinematic ${ar} format, photoreal, professional lighting and color grading.`
            }],
            parameters: {
                sampleCount: 1,
                aspectRatio: ar
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const errMsg = errData.error?.message || `HTTP ${response.status}`;
            throw new Error(`Imagen 4 API: ${errMsg}`);
        }

        const data = await response.json();

        if (data.predictions && data.predictions.length > 0) {
            const imageData = data.predictions[0].bytesBase64Encoded;
            const mimeType = data.predictions[0].mimeType || 'image/png';
            const ext = mimeType.includes('png') ? '.png' : '.jpg';

            const finalPath = outputPath.endsWith(ext) ? outputPath : outputPath + ext;
            const dir = path.dirname(finalPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(finalPath, Buffer.from(imageData, 'base64'));
            return { success: true, path: finalPath, mimeType };
        }

        throw new Error('Imagen 4 không trả về ảnh');
    } catch (error) {
        console.error('Imagen 4 error:', error.message);
        console.log('Falling back to Gemini Flash...');
        return generateImage(imagePrompt, outputPath, ar);
    }
}

// ============ UPSCALE IMAGE ============
async function upscaleImage(base64Data, originalPath) {
    try {
        const imageModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image' });

        const result = await imageModel.generateContent({
            contents: [{
                role: 'user',
                parts: [
                    {
                        inlineData: {
                            mimeType: 'image/png',
                            data: base64Data
                        }
                    },
                    {
                        text: 'Upscale this image to higher resolution. Keep the same composition, colors, and content. Enhance details, sharpness, and quality. Output the highest resolution possible.'
                    }
                ]
            }],
            generationConfig: {
                responseModalities: ['IMAGE']
            }
        });

        // Save upscaled version next to original
        const ext = path.extname(originalPath) || '.png';
        const baseName = originalPath.replace(ext, '');
        const upscaledPath = baseName + '_upscaled' + ext;

        return extractImageFromResponse(result.response, upscaledPath, 'Upscale');
    } catch (error) {
        console.error('Upscale error:', error.message);
        return { success: false, error: error.message };
    }
}

// Helper: extract image from Gemini response
function extractImageFromResponse(response, outputPath, source) {
    const candidates = response.candidates;

    if (candidates && candidates[0] && candidates[0].content && candidates[0].content.parts) {
        for (const part of candidates[0].content.parts) {
            if (part.inlineData) {
                const imageData = part.inlineData.data;
                const mimeType = part.inlineData.mimeType || 'image/png';
                const ext = mimeType.includes('png') ? '.png' : '.jpg';

                const finalPath = outputPath.endsWith(ext) ? outputPath : outputPath + ext;
                const dir = path.dirname(finalPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                fs.writeFileSync(finalPath, Buffer.from(imageData, 'base64'));
                return { success: true, path: finalPath, mimeType };
            }
        }
    }

    return { success: false, error: `${source}: Không tạo được ảnh` };
}

// ============ REVIEW VIDEO ============
async function reviewVideo(videoBuffer, mimeType) {
    const reviewPrompt = `You are an expert AI video quality analyst. Analyze this AI-generated video (likely from Google Veo 3.1) and provide a comprehensive quality review.

Evaluate and score each category from 1-10:

Return a valid JSON object with this exact structure:
{
  "overall_score": <1-100>,
  "summary": "One paragraph overall assessment",
  "strengths": [
    {
      "category": "Category name (e.g., Audio, Lighting, Camera Movement)",
      "score": <1-10>,
      "detail": "Specific praise with timestamps if applicable"
    }
  ],
  "issues": [
    {
      "category": "Issue category (e.g., Morphing, Physics, Flickering)",
      "severity": "high|medium|low",
      "timestamp": "e.g., 2.0s-3.5s",
      "detail": "Specific description of the problem",
      "affected_elements": "What objects/areas are affected"
    }
  ],
  "solutions": [
    {
      "issue_ref": "Which issue this solves",
      "approach": "regenerate|edit|trim",
      "detail": "Specific actionable fix instructions",
      "capcut_tip": "If applicable, specific CapCut/Premiere editing instruction",
      "recommended_trim": "e.g., Use only 0.0-4.0s, cut at 4.0s to avoid morphing",
      "corrected_prompt": "A complete, corrected video prompt that fixes this specific issue. Include all the original prompt elements but with modifications to prevent the identified problem. This should be a ready-to-use prompt for Veo 3.1."
    }
  ],
  "verdict": {
    "usable": true|false,
    "needs_regeneration": true|false,
    "best_segment": "e.g., 0.0-4.5s is the strongest part",
    "recommendation": "Final recommendation on what to do with this clip"
  }
}

Be extremely detailed and specific. Reference exact timestamps. Consider common AI video issues:

VISUAL ISSUES:
- Object/face morphing
- Unnatural physics (liquids, cloth, hair)
- Flickering or strobing
- Text/logo distortion
- Unrealistic hand/finger generation
- Abrupt scene transitions
- Inconsistent lighting

AUDIO ISSUES (CRITICAL - pay very close attention to audio):
- Looping/repeating audio: same sound effect or music segment repeating unnaturally
- Audio-visual mismatch: sounds that don't match the visual actions
- Unnatural audio transitions: abrupt cuts or unnatural sound boundaries
- Missing audio: silent sections where there should be sound
- Distorted or robotic sounds: unnatural voice or sound artifacts
- Background noise inconsistencies: sudden changes in ambient sound
- Audio clipping or distortion at any point

IMPORTANT: 
- Return ONLY the JSON, no markdown formatting, no code blocks.
- ALL text content (summary, details, recommendations, tips, etc.) MUST be written in Vietnamese (tiếng Việt).
- Only keep technical terms in English where necessary.
- For EACH solution, you MUST provide a corrected_prompt field with a complete, ready-to-use Veo 3.1 prompt that fixes the identified issue.`;

    const videoPart = await uploadVideoForAnalysis(videoBuffer, mimeType);

    const result = await proModel.generateContent([reviewPrompt, videoPart]);
    const text = result.response.text();
    return parseJsonResponse(text);
}

// ============ PARSE JSON RESPONSE ============
function parseJsonResponse(text) {
    // Try direct parse first
    try {
        return JSON.parse(text);
    } catch (e) {
        // Try to extract JSON from markdown code blocks
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[1].trim());
            } catch (e2) {
                // Fall through
            }
        }

        // Try to find JSON object in the text
        const objectMatch = text.match(/\{[\s\S]*\}/);
        if (objectMatch) {
            try {
                return JSON.parse(objectMatch[0]);
            } catch (e3) {
                // Fall through
            }
        }

        throw new Error('Failed to parse AI response as JSON. Raw response: ' + text.substring(0, 500));
    }
}

// ============ STRATEGY CHAT ============
async function strategyChat(channel, messages) {
    const systemPrompt = `You are a senior social media strategist helping plan a content channel.

Channel info:
- Name: ${channel.name}
- Niche: ${channel.niche || 'Not specified'}
- Description: ${channel.description || 'Not specified'}
- Language: ${channel.language === 'VN' ? 'Vietnamese' : 'English (US)'}
- Posts per day: ${channel.postsPerDay || 2}

Your job: Interview the user to understand their channel strategy. Ask ONE question at a time. Be conversational, friendly, and specific.

Topics to cover (in order, skip if already answered):
1. Target audience (age, gender, demographics, pain points)
2. Tone & voice (funny, professional, coach, chill, aggressive...)
3. Products/services they sell (Amazon affiliate, dropship, brand, none)
4. Competitor channels they want to be like
5. CTA strategy (comment, follow, link in bio, DM...)
6. Content dos and don'ts (what to avoid, what to emphasize)

RULES:
- ALWAYS ask in Vietnamese (tiếng Việt) — employees are Vietnamese speakers
- Channel language "${channel.language}" only affects the ROADMAP CONTENT, NOT this conversation
- ONE question per response
- Keep it short (2-3 sentences max)
- After getting enough info (5+ exchanges), respond with ONLY a JSON block like:
{"done": true, "brief": {"target_audience": "...", "tone": "...", "products": "...", "competitors": "...", "content_pillars": ["...", "..."], "cta_strategy": "...", "dos_and_donts": "..."}}
- If not done yet, respond with plain text (your next question)`;

    const chatHistory = messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
    }));

    const chat = flashModel.startChat({
        history: [
            { role: 'user', parts: [{ text: systemPrompt }] },
            {
                role: 'model', parts: [{
                    text: `Chào bạn! Tôi sẽ giúp bạn xây dựng chiến lược cho kênh "${channel.name}". Hãy bắt đầu nhé!`
                }]
            },
            ...chatHistory
        ]
    });

    const result = await chat.sendMessage(messages.length === 0
        ? 'Bắt đầu phỏng vấn đi'
        : messages[messages.length - 1].content
    );
    const text = result.response.text();

    // Check if AI returned a JSON brief
    try {
        const jsonMatch = text.match(/\{[\s\S]*"done"\s*:\s*true[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
    } catch (e) { }

    return { done: false, message: text };
}

// ============ ROADMAP GENERATION ============
async function generateRoadmap(channel, preset, startDate, days = 7) {
    const perDay = channel.postsPerDay || 2;
    const totalVideos = days * perDay;

    let presetRules = '';
    if (preset) {
        if (preset.type === 'custom' && preset.custom_rules) {
            presetRules = `\n\nPRESET RULES (MUST FOLLOW):\n${preset.custom_rules}`;
        }
        if (preset.style_dna) {
            presetRules += `\nSTYLE: ${preset.style_dna.overall_style || ''}`;
        }
    }

    const prompt = `You are an expert social media content strategist.

Create a ${days}-day content roadmap with TOPIC IDEAS for this channel:
- Channel: ${channel.name}
- Niche: ${channel.niche || 'General'}
- Description: ${channel.description || 'N/A'}
- Target language: ${channel.language === 'VN' ? 'Vietnamese' : 'English (US)'}
- Posts per day: ${perDay}
- Total topics needed: ${totalVideos}
- Start date: ${startDate || new Date().toISOString().split('T')[0]}
- Platforms: ${Object.entries(channel.socialLinks || {}).filter(([k, v]) => v).map(([k]) => k).join(', ') || 'TikTok, YouTube'}
${presetRules}
${channel.brief ? `
CHANNEL BRIEF (MUST follow closely):
- Target Audience: ${channel.brief.target_audience || 'N/A'}
- Tone & Voice: ${channel.brief.tone || 'N/A'}
- Products/Services: ${channel.brief.products || 'N/A'}
- Competitors: ${channel.brief.competitors || 'N/A'}
- Content Pillars: ${(channel.brief.content_pillars || []).join(', ') || 'N/A'}
- CTA Strategy: ${channel.brief.cta_strategy || 'N/A'}
- Dos and Don'ts: ${channel.brief.dos_and_donts || 'N/A'}
` : ''}
IMPORTANT: This is a TOPIC PLANNER only. The employee will use these topics to create AI-generated videos separately.
Each topic should be a clear, specific idea that can be turned into a video.

REQUIREMENTS:
1. Each topic must be UNIQUE and specific (not generic)
2. Mix content types: educational, entertaining, trending, viral
3. Think about what makes people STOP SCROLLING
4. Topics should be trendy and relevant to the niche

Return ONLY valid JSON:
{
  "roadmap_name": "Plan title",
  "channel": "${channel.name}",
  "week_start": "${startDate || new Date().toISOString().split('T')[0]}",
  "total_videos": ${totalVideos},
  "days": [
    {
      "day": 1,
      "date": "YYYY-MM-DD",
      "day_name": "Monday/Tuesday/etc",
      "theme": "Day theme",
      "videos": [
        {
          "slot": 1,
          "title": "Chủ đề video (clear, specific topic)",
          "idea": "Ý tưởng ngắn 1-2 câu mô tả nội dung",
          "content_type": "educational/entertaining/trending/viral/tutorial/story",
          "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
          "best_post_time": "HH:MM"
        }
      ]
    }
  ],
  "weekly_strategy": "Overall strategy explanation"
}`;

    const result = await proModel.generateContent(prompt);
    const text = result.response.text();
    return safeJsonParse(text);
}

async function generateNextRoadmap(channel, preset, prevRoadmap, performance) {
    let perfSummary = '';
    if (performance && performance.length > 0) {
        perfSummary = '\n\nPREVIOUS WEEK PERFORMANCE:\n';
        performance.forEach(v => {
            perfSummary += `- "${v.title}": ${v.views || '?'} views, ${v.likes || '?'} likes, ${v.status || 'unknown'}\n`;
        });
    }

    let prevTopics = '';
    if (prevRoadmap && prevRoadmap.days) {
        prevTopics = '\n\nPREVIOUS WEEK TOPICS (do NOT repeat):\n';
        prevRoadmap.days.forEach(d => {
            d.videos?.forEach(v => {
                prevTopics += `- ${v.title}\n`;
            });
        });
    }

    const days = 7;
    const perDay = channel.postsPerDay || 2;
    const totalVideos = days * perDay;

    // Calculate new start date (7 days after previous)
    const prevStart = prevRoadmap?.week_start || new Date().toISOString().split('T')[0];
    const nextStart = new Date(new Date(prevStart).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let presetRules = '';
    if (preset && preset.type === 'custom' && preset.custom_rules) {
        presetRules = `\n\nPRESET RULES (MUST FOLLOW):\n${preset.custom_rules}`;
    }

    const prompt = `You are an expert social media content strategist. Create the NEXT 7-day roadmap based on previous performance.

Channel: ${channel.name} | Niche: ${channel.niche || 'General'} | Language: ${channel.language === 'VN' ? 'Vietnamese' : 'English (US)'}
Posts per day: ${perDay} | Start date: ${nextStart}
${presetRules}${perfSummary}${prevTopics}

STRATEGY:
- Topics that performed well → create SIMILAR but FRESH variations
- Topics that performed poorly → REPLACE with different approach
- Add 2-3 completely NEW trending ideas
- Keep the same brand voice and style

Return ONLY valid JSON with the same structure as before:
{
  "roadmap_name": "...",
  "channel": "${channel.name}",
  "week_start": "${nextStart}",
  "total_videos": ${totalVideos},
  "performance_insights": "What worked, what didn't, strategy adjustments",
  "days": [{ "day": 1, "date": "...", "day_name": "...", "theme": "...", "videos": [{ "slot": 1, "title": "...", "description": "...", "hook": "...", "content_type": "...", "viral_angle": "...", "keywords": [], "hashtags": [], "best_post_time": "HH:MM", "estimated_duration": "8s" }] }],
  "weekly_strategy": "..."
}`;

    const result = await proModel.generateContent(prompt);
    const text = result.response.text();
    return safeJsonParse(text);
}

module.exports = {
    analyzeVideo,
    analyzeVideoDNA,
    generatePlan,
    generateImage,
    generateImageImagen,
    upscaleImage,
    reviewVideo,
    generateRoadmap,
    generateNextRoadmap,
    strategyChat
};
