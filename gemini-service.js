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

module.exports = {
    analyzeVideo,
    analyzeVideoDNA,
    generatePlan,
    generateImage,
    generateImageImagen,
    upscaleImage,
    reviewVideo
};
