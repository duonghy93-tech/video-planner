// ============ STATE ============
let currentPlan = null;
let currentReview = null;
let currentDNA = null;
let uploadedVideoFile = null;
let reviewVideoFile = null;
let savedPresets = [];
let savedCharacters = [];

// ============ API KEY (localStorage per-user) ============
function getStoredApiKey() {
    return localStorage.getItem('gemini_api_key') || '';
}

function setStoredApiKey(key) {
    localStorage.setItem('gemini_api_key', key);
}

function getApiHeaders() {
    return {
        'Content-Type': 'application/json',
        'x-api-key': getStoredApiKey()
    };
}

// ============ CROSS-BROWSER IMAGE DOWNLOAD ============
function downloadImage(imgSrc, fileName) {
    window.location.href = '/api/download-image?path=' + encodeURIComponent(imgSrc) + '&name=' + encodeURIComponent(fileName || 'image');
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
    checkApiStatus();
    setupTabs();
    setupSlider();
    setupUploadZones();
    loadPresets();
    loadCharacters();

    // Auto-fill API key input from localStorage
    const savedKey = getStoredApiKey();
    if (savedKey) {
        const input = document.getElementById('apiKeyInput');
        if (input) input.value = savedKey;
    }
});

// ============ API STATUS ============
async function checkApiStatus() {
    const statusEl = document.getElementById('apiStatus');
    const dot = statusEl.querySelector('.status-dot');
    const text = statusEl.querySelector('.status-text');
    const hasKey = !!getStoredApiKey();
    if (hasKey) {
        dot.className = 'status-dot active';
        text.textContent = 'API sẵn sàng';
    } else {
        dot.className = 'status-dot error';
        text.textContent = 'Chưa nhập API Key';
    }
}

// ============ TABS ============
function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`panel${capitalize(tab)}`).classList.add('active');
        });
    });
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ============ SLIDER + NUMBER INPUT ============
function setupSlider() {
    const slider = document.getElementById('durationSlider');
    const input = document.getElementById('durationInput');
    const clipCountEl = document.getElementById('clipCount');

    function updateDisplay(val) {
        const clips = Math.ceil(val / 8);
        clipCountEl.textContent = `= ${clips} clip${clips > 1 ? 's' : ''} \u00d7 8s`;
    }

    // Slider -> input
    slider.addEventListener('input', () => {
        input.value = slider.value;
        updateDisplay(parseInt(slider.value));
    });

    // Input -> slider
    input.addEventListener('input', () => {
        let val = parseInt(input.value) || 8;
        if (val < 8) val = 8;
        val = Math.ceil(val / 8) * 8;
        if (val > parseInt(slider.max)) {
            slider.max = val;
        }
        slider.value = Math.min(val, parseInt(slider.max));
        updateDisplay(val);
    });

    updateDisplay(24);
}

// ============ UPLOAD ZONES ============
function setupUploadZones() {
    // Video analysis upload
    setupDropZone('uploadZone', 'videoFileInput', (file) => {
        uploadedVideoFile = file;
        showVideoPreview(file, 'previewPlayer', 'previewName', 'videoPreview', 'uploadZone');
        document.getElementById('btnAnalyzeVideo').disabled = false;
        document.getElementById('btnDNAAnalyze').disabled = false;
    });

    // Review upload
    setupDropZone('reviewUploadZone', 'reviewFileInput', (file) => {
        reviewVideoFile = file;
        showVideoPreview(file, 'reviewPlayer', 'reviewPreviewName', 'reviewPreview', 'reviewUploadZone');
        document.getElementById('btnReviewVideo').disabled = false;
    });
}

function setupDropZone(zoneId, inputId, onFile) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);

    zone.addEventListener('click', () => input.click());

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('video/')) {
            onFile(file);
        }
    });

    input.addEventListener('change', () => {
        if (input.files[0]) onFile(input.files[0]);
    });
}

function showVideoPreview(file, playerId, nameId, previewId, zoneId) {
    const player = document.getElementById(playerId);
    const nameEl = document.getElementById(nameId);
    const preview = document.getElementById(previewId);
    const zone = document.getElementById(zoneId);

    const url = URL.createObjectURL(file);
    player.src = url;
    nameEl.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
    preview.style.display = 'block';
    zone.style.display = 'none';
}

function clearVideoUpload() {
    uploadedVideoFile = null;
    document.getElementById('videoPreview').style.display = 'none';
    document.getElementById('uploadZone').style.display = 'block';
    document.getElementById('btnAnalyzeVideo').disabled = true;
    document.getElementById('btnDNAAnalyze').disabled = true;
    document.getElementById('videoFileInput').value = '';
}

function clearReviewUpload() {
    reviewVideoFile = null;
    document.getElementById('reviewPreview').style.display = 'none';
    document.getElementById('reviewUploadZone').style.display = 'block';
    document.getElementById('btnReviewVideo').disabled = true;
    document.getElementById('reviewFileInput').value = '';
}

// ============ LOADING ============
function showLoading(text, subtext) {
    document.getElementById('loadingText').textContent = text || 'AI đang xử lý...';
    document.getElementById('loadingSubtext').textContent = subtext || '';
    document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
}

// ============ TOAST ============
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ============ HANDLER: TEXT → PLAN ============
async function handleTextGenerate() {
    const description = document.getElementById('textDescription').value.trim();
    let duration = parseInt(document.getElementById('durationInput').value) || 24;
    // Round to nearest 8
    duration = Math.ceil(duration / 8) * 8;

    if (!description) {
        showToast('⚠️ Vui lòng nhập mô tả video');
        return;
    }

    showLoading('AI đang tạo kế hoạch video...', `Tạo ${Math.ceil(duration / 8)} clips × 8s — Có thể mất 30-60 giây`);

    try {
        const langFormat = document.getElementById('langFormat')?.value || 'VN';
        const presetId = document.getElementById('presetSelect')?.value || '';

        const res = await fetch('/api/analyze-text', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ description, duration: parseInt(duration), langFormat, presetId: presetId || undefined })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        currentPlan = data.plan;
        currentPlan._outputDir = data.outputDir;
        renderPlan(currentPlan, 'textResults');
        showToast('✅ Đã tạo kế hoạch thành công!');
    } catch (err) {
        showToast('❌ Lỗi: ' + err.message);
    } finally {
        hideLoading();
    }
}

// ============ HANDLER: VIDEO → PLAN ============
async function handleVideoAnalyze() {
    if (!uploadedVideoFile) return;

    showLoading('AI đang phân tích video...', `${uploadedVideoFile.name} — Có thể mất 1-2 phút`);

    try {
        const formData = new FormData();
        formData.append('video', uploadedVideoFile);
        const langFormat = document.getElementById('langFormatVideo')?.value || 'VN';
        formData.append('langFormat', langFormat);

        const res = await fetch('/api/analyze-video', {
            method: 'POST',
            headers: { 'x-api-key': getStoredApiKey() },
            body: formData
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        currentPlan = data.plan;
        currentPlan._outputDir = data.outputDir;
        renderPlan(currentPlan, 'videoResults');
        showToast('✅ Phân tích video thành công!');
    } catch (err) {
        showToast('❌ Lỗi: ' + err.message);
    } finally {
        hideLoading();
    }
}

// ============ HANDLER: URL → PLAN ============
async function handleUrlAnalyze() {
    const url = document.getElementById('videoUrlInput').value.trim();
    if (!url) {
        showToast('⚠️ Vui lòng nhập link video');
        return;
    }

    showLoading('Đang tải và phân tích video từ URL...', 'Có thể mất 1-3 phút tùy kích thước video');

    try {
        const langFormat = document.getElementById('langFormatVideo')?.value || 'VN';

        const res = await fetch('/api/analyze-url', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ url, langFormat })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        currentPlan = data.plan;
        currentPlan._outputDir = data.outputDir;
        renderPlan(currentPlan, 'videoResults');
        showToast('✅ Phân tích video từ URL thành công!');
    } catch (err) {
        showToast('❌ Lỗi: ' + err.message);
    } finally {
        hideLoading();
    }
}

// ============ HANDLER: VIDEO REVIEW ============
async function handleVideoReview() {
    if (!reviewVideoFile) return;

    showLoading('AI đang đánh giá video...', `${reviewVideoFile.name} — Phân tích chi tiết`);

    try {
        const formData = new FormData();
        formData.append('video', reviewVideoFile);

        const res = await fetch('/api/review-video', {
            method: 'POST',
            headers: { 'x-api-key': getStoredApiKey() },
            body: formData
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        currentReview = data.review;
        renderReview(currentReview, 'reviewResultsSection');
        showToast('✅ Đánh giá hoàn tất!');
    } catch (err) {
        showToast('❌ Lỗi: ' + err.message);
    } finally {
        hideLoading();
    }
}

// ============ RENDER PLAN ============
function renderPlan(plan, targetId) {
    const section = document.getElementById(targetId);
    if (!section) return;

    let html = '';

    // Header with actions
    html += `
        <div class="results-header">
            <h2>🎬 Kế Hoạch Video — ${plan.total_clips || plan.clips?.length || 0} Clips</h2>
            <div class="results-actions">
                <button class="btn-secondary" onclick="copyAllJson()">📋 Copy JSON</button>
                <button class="btn-secondary" onclick="downloadJson()">📥 Tải JSON</button>
                <button class="btn-primary btn-sm" onclick="handleGenerateAllImages()">🖼️ Tạo Tất Cả Ảnh</button>
            </div>
        </div>`;

    // Style guide
    if (plan.style_guide) {
        let sgItems = '';
        const items = [
            ['Phong cách', plan.style_guide.overall_style],
            ['Mood', plan.style_guide.mood],
            ['Mô tả', plan.style_guide.reference_description]
        ];

        items.forEach(([label, value]) => {
            if (value) {
                sgItems += `
                    <div class="style-guide-item">
                        <span class="style-guide-label">${label}</span>
                        <span class="style-guide-value">${value}</span>
                    </div>`;
            }
        });

        if (plan.style_guide.color_palette) {
            sgItems += `
                <div class="style-guide-item">
                    <span class="style-guide-label">Bảng Màu</span>
                    <div class="color-palette">
                        ${plan.style_guide.color_palette.map(c =>
                `<div class="color-swatch" style="background:${c}" title="${c}" onclick="navigator.clipboard.writeText('${c}');showToast('Đã copy ${c}')"></div>`
            ).join('')}
                    </div>
                </div>`;
        }

        if (plan.storyline_summary) {
            sgItems += `
                <div class="style-guide-item" style="grid-column: 1/-1">
                    <span class="style-guide-label">Kịch Bản</span>
                    <span class="style-guide-value">${plan.storyline_summary}</span>
                </div>`;
        }

        html += `
            <div class="style-guide" style="display:block">
                <h3>🎨 Style Guide</h3>
                <div class="style-guide-content">${sgItems}</div>
            </div>`;
    }

    // Characters
    if (plan.characters && plan.characters.length > 0) {
        let charCards = '';
        plan.characters.forEach((ch, ci) => {
            const charImgPrompt = `Portrait photo of ${ch.name}: ${ch.appearance || ''}. Wearing: ${ch.clothing || ''}. ${ch.ethnicity || ''}, ${ch.gender || ''}, age ${ch.age_range || ''}. Cinematic studio portrait, shallow depth of field, professional lighting.`;
            charCards += `
                <div class="character-card">
                    <div class="character-img-container" id="char-img-${ch.char_id}">
                        <div class="char-img-placeholder">
                            <span class="character-avatar-lg">${ch.gender === 'female' ? '👩' : '👨'}</span>
                            <button class="btn-generate-img" onclick="handleGenerateCharacterImage('${ch.char_id}', ${ci}, \`${charImgPrompt.replace(/`/g, "'").replace(/\\/g, '\\\\')}\`)">
                                ✨ Tạo ảnh nhân vật
                            </button>
                        </div>
                    </div>
                    <div class="character-header">
                        <div>
                            <div class="character-name">${ch.name}</div>
                            <div class="character-meta">${ch.char_id} · ${ch.gender || ''} · ${ch.age_range || ''} · ${ch.ethnicity || ''}</div>
                        </div>
                    </div>
                    <div class="character-details">
                        ${ch.appearance ? `<div><span class="char-label">👤 Ngoại hình:</span> ${ch.appearance}</div>` : ''}
                        ${ch.clothing ? `<div><span class="char-label">👕 Trang phục:</span> ${ch.clothing}</div>` : ''}
                        ${ch.voice ? `<div><span class="char-label">🎤 Giọng:</span> ${ch.voice}</div>` : ''}
                    </div>
                </div>`;
        });

        html += `
            <div class="characters-section" style="display:block">
                <h3>🎭 Nhân Vật (${plan.characters.length})</h3>
                <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:12px">Mô tả chi tiết để đảm bảo nhất quán qua các clip</p>
                <div class="characters-grid">${charCards}</div>
            </div>`;
    }

    // Clips
    if (plan.clips) {
        html += '<div class="clips-grid">';
        plan.clips.forEach((clip, i) => {
            html += renderClipCard(clip, i);
        });
        html += '</div>';
    }

    section.innerHTML = html;
    section.style.display = 'block';
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderClipCard(clip, index) {
    const clipNum = clip.clip_number || index + 1;
    const clipId = clip.clip_id || `clip_${clipNum}`;

    // Timeline
    let timelineHtml = '';
    if (clip.timeline && clip.timeline.length) {
        timelineHtml = `
            <div class="clip-section">
                <div class="clip-section-title">⏱️ Timeline</div>
                <div class="timeline-items">
                    ${clip.timeline.map(t => `
                        <div class="timeline-item">
                            <div class="timeline-time">${t.t}</div>
                            <div class="timeline-camera">📷 ${t.camera}</div>
                            <div class="timeline-action">${t.action}</div>
                            ${t.sfx ? `<div class="tag" style="margin-top:4px">🔊 ${t.sfx}</div>` : ''}
                            ${t.dialogue ? `<div class="timeline-dialogue">"${t.dialogue}"</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>`;
    }

    // Audio
    let audioHtml = '';
    if (clip.audio) {
        audioHtml = `
            <div class="clip-section">
                <div class="clip-section-title">🎵 Audio</div>
                <div class="tag-row">
                    ${clip.audio.music ? `<span class="tag">🎶 ${clip.audio.music}</span>` : ''}
                    ${(clip.audio.sfx || []).map(s => `<span class="tag">🔊 ${s}</span>`).join('')}
                </div>
            </div>`;
    }

    // Constraints
    let constraintsHtml = '';
    if (clip.constraints) {
        const c = clip.constraints;
        constraintsHtml = `
            <div class="clip-section">
                <div class="clip-section-title">🛡️ Constraints</div>
                <div class="tag-row">
                    ${c.style ? `<span class="tag">${c.style}</span>` : ''}
                    ${c.artifact_guard ? `<span class="tag">🛡 ${c.artifact_guard}</span>` : ''}
                    ${c.physics ? `<span class="tag">⚡ ${c.physics}</span>` : ''}
                </div>
            </div>`;
    }

    // 3 Reference Images
    const refTypes = [
        { key: 'ref_image_start', label: '🎬 Start (0-2s)', type: 'start' },
        { key: 'ref_image_key', label: '⚡ Key (3-5s)', type: 'key' },
        { key: 'ref_image_end', label: '🏁 End (6-8s)', type: 'end' }
    ];

    // Backward compat: if old format with single reference_image_prompt, show that
    const hasNewFormat = clip.ref_image_start || clip.ref_image_key || clip.ref_image_end;

    let imagesHtml = '';
    if (hasNewFormat) {
        imagesHtml = `
            <div class="clip-images-row">
                ${refTypes.map(ref => `
                    <div class="clip-ref-image" id="img-${clipId}-${ref.type}">
                        <div class="ref-image-label">${ref.label}</div>
                        <div class="clip-image-placeholder-sm">
                            <button class="btn-generate-img-sm" onclick="handleGenerateRefImage('${clipId}', ${index}, '${ref.type}')">
                                ✨ Tạo
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div style="text-align:center;margin:8px 0">
                <button class="btn-generate-img" onclick="handleGenerateAllRefImages('${clipId}', ${index})">
                    ✨ Tạo cả 3 ảnh reference
                </button>
            </div>`;
    } else {
        // Old format fallback
        imagesHtml = `
            <div class="clip-image-container" id="img-${clipId}">
                <div class="clip-image-placeholder">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <span>Chưa tạo ảnh</span>
                    <button class="btn-generate-img" onclick="handleGenerateSingleImage('${clipId}', ${index})">
                        ✨ Tạo ảnh reference
                    </button>
                </div>
            </div>`;
    }

    // Image prompts display
    let promptsHtml = '';
    if (hasNewFormat) {
        promptsHtml = refTypes.map(ref => {
            const prompt = clip[ref.key];
            return prompt ? `
                <div class="clip-section">
                    <div class="clip-section-title">🖼️ ${ref.label}</div>
                    <div class="clip-section-value">${prompt}</div>
                </div>` : '';
        }).join('');
    } else if (clip.reference_image_prompt) {
        promptsHtml = `
            <div class="clip-section">
                <div class="clip-section-title">🖼️ Image Prompt</div>
                <div class="clip-section-value">${clip.reference_image_prompt}</div>
            </div>`;
    }

    return `
        <div class="clip-card" id="card-${clipId}">
            <div class="clip-card-header">
                <div class="clip-number">
                    <div class="clip-badge">${clipNum}</div>
                    <div>
                        <div style="font-weight:600;font-size:0.9rem">${clipId}</div>
                        <div class="clip-meta">${clip.duration_sec || 8}s · ${clip.format || '9:16'}</div>
                    </div>
                </div>
            </div>

            ${imagesHtml}

            <div class="clip-body">
                ${timelineHtml}
                ${audioHtml}
                ${constraintsHtml}
                ${promptsHtml}
            </div>

            <div class="clip-actions">
                <button onclick="copyClipJson(${index})">📋 Copy JSON</button>
                <button onclick="copyClipPrompt(${index})">📝 Copy Prompt</button>
            </div>
        </div>`;
}

// ============ RENDER REVIEW ============
function renderReview(review, targetId) {
    const section = document.getElementById(targetId);
    if (!section) return;

    // Score color
    const score = review.overall_score || 0;
    const scoreColor = score >= 80 ? 'var(--accent-green)' :
        score >= 60 ? 'var(--accent-orange)' :
            'var(--accent-red)';

    let html = '';

    // Header
    html += `
        <div class="results-header">
            <h2>⭐ Kết Quả Đánh Giá Video</h2>
            <div class="results-actions">
                <button class="btn-secondary" onclick="copyReviewJson()">📋 Copy JSON</button>
                <button class="btn-secondary" onclick="downloadReviewJson()">📥 Tải JSON</button>
            </div>
        </div>`;

    // Score hero
    html += `
        <div class="review-results" style="display:grid">
        <div class="review-score-hero">
            <div class="score-circle" style="color:${scoreColor};background:rgba(0,0,0,0.3)">
                ${score}
            </div>
            <div class="score-label">Điểm Tổng / 100</div>
            ${review.summary ? `<p class="review-summary">${review.summary}</p>` : ''}
        </div>`;

    // Strengths
    if (review.strengths && review.strengths.length) {
        html += `
            <div class="review-card">
                <h3>🟢 Điểm Xuất Sắc</h3>
                ${review.strengths.map(s => `
                    <div class="review-item">
                        <div class="review-item-icon">✅</div>
                        <div class="review-item-content">
                            <div class="review-item-title">${s.category} ${s.score ? `(${s.score}/10)` : ''}</div>
                            <div class="review-item-detail">${s.detail}</div>
                        </div>
                    </div>
                `).join('')}
            </div>`;
    }

    // Issues
    if (review.issues && review.issues.length) {
        html += `
            <div class="review-card">
                <h3>🔴 Điểm Lỗi</h3>
                ${review.issues.map(issue => `
                    <div class="review-item">
                        <div class="review-item-icon">⚠️</div>
                        <div class="review-item-content">
                            <div class="review-item-title">${issue.category}</div>
                            <div class="review-item-detail">${issue.detail}</div>
                            <div class="review-item-meta">
                                <span class="severity-badge severity-${issue.severity}">${issue.severity}</span>
                                ${issue.timestamp ? `<span class="timestamp-badge">⏱ ${issue.timestamp}</span>` : ''}
                                ${issue.affected_elements ? `<span class="tag">${issue.affected_elements}</span>` : ''}
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>`;
    }

    // Solutions with corrected prompts
    if (review.solutions && review.solutions.length) {
        html += `
            <div class="review-card">
                <h3>🛠️ Giải Pháp Thực Chiến</h3>
                ${review.solutions.map(sol => `
                    <div class="review-item">
                        <div class="review-item-icon">💡</div>
                        <div class="review-item-content">
                            <div class="review-item-title">${sol.issue_ref || 'Gợi ý'}</div>
                            <div class="review-item-detail">${sol.detail}</div>
                            ${sol.capcut_tip ? `<div class="review-item-detail" style="color:var(--accent-cyan);margin-top:6px">✂️ CapCut: ${sol.capcut_tip}</div>` : ''}
                            ${sol.recommended_trim ? `<div class="tag" style="margin-top:6px">✂️ ${sol.recommended_trim}</div>` : ''}
                            ${sol.corrected_prompt ? `
                                <div style="margin-top:10px;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.3);border-radius:8px;padding:12px">
                                    <div style="font-size:0.75rem;color:var(--accent-purple);font-weight:600;margin-bottom:6px">📝 PROMPT ĐÃ SỬA (copy để dùng):</div>
                                    <pre style="white-space:pre-wrap;color:var(--text-secondary);font-size:0.8rem;margin:0;cursor:pointer" onclick="navigator.clipboard.writeText(this.textContent);showToast('Đã copy prompt!')">${sol.corrected_prompt}</pre>
                                </div>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>`;
    }

    // Verdict
    if (review.verdict) {
        const v = review.verdict;
        html += `
            <div class="verdict-card">
                <h3>📋 Kết Luận</h3>
                <div class="verdict-item">
                    ${v.usable ? '✅' : '❌'} <strong>Có thể sử dụng:</strong> ${v.usable ? 'Có' : 'Không'}
                </div>
                <div class="verdict-item">
                    ${v.needs_regeneration ? '🔄' : '✅'} <strong>Cần tạo lại:</strong> ${v.needs_regeneration ? 'Có' : 'Không'}
                </div>
                ${v.best_segment ? `<div class="verdict-item">🎯 <strong>Đoạn tốt nhất:</strong> ${v.best_segment}</div>` : ''}
                ${v.recommendation ? `<div class="verdict-item">💬 <strong>Khuyến nghị:</strong> ${v.recommendation}</div>` : ''}
            </div>`;
    }

    html += '</div>'; // close review-results

    section.innerHTML = html;
    section.style.display = 'block';
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============ CHARACTER IMAGE GENERATION ============
window.characterImages = {};

async function handleGenerateCharacterImage(charId, charIndex, prompt) {
    const container = document.getElementById(`char-img-${charId}`);
    const engine = document.getElementById('engineSelect')?.value ||
        document.getElementById('engineSelectVideo')?.value || 'gemini';

    container.innerHTML = `
        <div class="char-img-loading">
            <div class="mini-spinner"></div>
            <span style="font-size:0.8rem;color:var(--text-muted)">Đang tạo ảnh nhân vật...</span>
        </div>`;

    try {
        const res = await fetch('/api/generate-image', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
                prompt: prompt,
                clipId: `character_${charId}`,
                engine: engine,
                aspectRatio: '1:1',
                projectDir: currentPlan?._outputDir
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        // Store for reference when generating clip images
        window.characterImages[charId] = data.imagePath;

        container.innerHTML = `
            <img src="${data.imagePath}" alt="${charId}" class="char-img" loading="lazy">
            <div class="img-overlay-actions" style="opacity:1;position:relative;background:none;padding:4px 0 0 0;">
                <button class="btn-img-action" style="background:var(--border)" onclick="downloadImage('${data.imagePath}', 'character_${charId}')">📥 Tải</button>
                <button class="btn-img-action" style="background:var(--border)" onclick="handleGenerateCharacterImage('${charId}', ${charIndex}, \`${prompt.replace(/`/g, "'")}\`)">🔄 Tạo lại</button>
            </div>`;
        showToast(`✅ Đã tạo ảnh nhân vật ${charId}`);
    } catch (err) {
        container.innerHTML = `
            <div class="char-img-placeholder">
                <span style="color:var(--accent-red);font-size:0.8rem">❌ ${err.message}</span>
                <button class="btn-generate-img" onclick="handleGenerateCharacterImage('${charId}', ${charIndex}, \`${prompt.replace(/`/g, "'")}\`)">
                    🔄 Thử lại
                </button>
            </div>`;
        showToast('❌ Lỗi: ' + err.message);
    }
}

// ============ IMAGE GENERATION ============
// Generate a single ref image (for old format or fallback)
async function handleGenerateSingleImage(clipId, index) {
    if (!currentPlan || !currentPlan.clips[index]) return;

    const clip = currentPlan.clips[index];
    const container = document.getElementById(`img-${clipId}`);
    const engine = document.getElementById('engineSelect')?.value ||
        document.getElementById('engineSelectVideo')?.value || 'imagen';
    const aspectRatio = document.getElementById('aspectRatio')?.value ||
        document.getElementById('aspectRatioVideo')?.value || '9:16';

    container.innerHTML = `
        <div class="clip-image-loading">
            <div class="mini-spinner"></div>
            <span style="font-size:0.8rem;color:var(--text-muted)">Đang tạo ảnh (${aspectRatio})...</span>
        </div>`;

    try {
        const prompt = clip.reference_image_prompt || clip.ref_image_start || '';
        const res = await fetch('/api/generate-image', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
                prompt: prompt,
                clipId: clipId,
                engine: engine,
                aspectRatio: aspectRatio,
                projectDir: currentPlan._outputDir
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const imgSrc = data.imagePath;
        container.innerHTML = `
            <img src="${imgSrc}" alt="${clipId}" loading="lazy" onload="this.parentElement.querySelector('.img-size-info').textContent = this.naturalWidth + ' × ' + this.naturalHeight + 'px'">
            <div class="img-overlay-actions">
                <span class="img-size-info" style="font-size:0.7rem;color:var(--text-muted);background:rgba(0,0,0,0.6);padding:2px 8px;border-radius:4px">Loading...</span>
                <div class="img-action-buttons">
                    <button class="btn-img-action" title="Tải ảnh Full HD" onclick="downloadImage('${imgSrc}', '${clipId}')">
                        📥 Tải
                    </button>
                    <button class="btn-img-action" onclick="handleUpscaleImage('${clipId}', ${index}, '${imgSrc}')" title="Upscale chất lượng cao">
                        🔍 Upscale
                    </button>
                </div>
            </div>`;
        showToast(`✅ Đã tạo ảnh cho ${clipId}`);
    } catch (err) {
        container.innerHTML = `
            <div class="clip-image-placeholder">
                <span style="color:var(--accent-red)">❌ ${err.message}</span>
                <button class="btn-generate-img" onclick="handleGenerateSingleImage('${clipId}', ${index})">
                    🔄 Thử lại
                </button>
            </div>`;
        showToast('❌ Lỗi tạo ảnh: ' + err.message);
    }
}

// Generate a specific ref image (start/key/end)
async function handleGenerateRefImage(clipId, index, refType) {
    if (!currentPlan || !currentPlan.clips[index]) return;

    const clip = currentPlan.clips[index];
    const refKey = `ref_image_${refType}`;
    const prompt = clip[refKey];
    if (!prompt) {
        showToast('⚠️ Không có prompt cho ảnh ' + refType);
        return;
    }

    const container = document.getElementById(`img-${clipId}-${refType}`);
    const labelEl = container.querySelector('.ref-image-label');
    const label = labelEl ? labelEl.outerHTML : '';
    const engine = document.getElementById('engineSelect')?.value ||
        document.getElementById('engineSelectVideo')?.value || 'imagen';
    const aspectRatio = document.getElementById('aspectRatio')?.value ||
        document.getElementById('aspectRatioVideo')?.value || '9:16';

    container.innerHTML = `
        ${label}
        <div class="clip-image-loading-sm">
            <div class="mini-spinner"></div>
            <span style="font-size:0.75rem;color:var(--text-muted)">Tạo ảnh...</span>
        </div>`;

    try {
        const res = await fetch('/api/generate-image', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
                prompt: prompt,
                clipId: `${clipId}_${refType}`,
                engine: engine,
                aspectRatio: aspectRatio,
                projectDir: currentPlan._outputDir
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const imgSrc = data.imagePath;
        container.innerHTML = `
            ${label}
            <img src="${imgSrc}" alt="${clipId} ${refType}" loading="lazy" class="ref-img">
            <div class="ref-img-actions">
                <button class="btn-img-action-sm" onclick="downloadImage('${imgSrc}', '${clipId}_${refType}')" title="Tải">📥</button>
                <button class="btn-img-action-sm" onclick="handleGenerateRefImage('${clipId}', ${index}, '${refType}')" title="Tạo lại">🔄</button>
            </div>`;
        showToast(`✅ Ảnh ${refType} cho ${clipId}`);
    } catch (err) {
        container.innerHTML = `
            ${label}
            <div class="clip-image-placeholder-sm">
                <span style="color:var(--accent-red);font-size:0.75rem">❌ Lỗi</span>
                <button class="btn-generate-img-sm" onclick="handleGenerateRefImage('${clipId}', ${index}, '${refType}')">
                    🔄 Thử lại
                </button>
            </div>`;
        showToast('❌ Lỗi: ' + err.message);
    }
}

// Generate all 3 ref images for a clip
async function handleGenerateAllRefImages(clipId, index) {
    const types = ['start', 'key', 'end'];
    showToast(`⏳ Đang tạo 3 ảnh ref cho ${clipId}...`);
    for (const t of types) {
        await handleGenerateRefImage(clipId, index, t);
    }
    showToast(`✅ Đã tạo 3 ảnh ref cho ${clipId}!`);
}

// ============ UPSCALE IMAGE ============
async function handleUpscaleImage(clipId, index, currentSrc) {
    const container = document.getElementById(`img-${clipId}`);
    const actionsDiv = container.querySelector('.img-action-buttons');
    if (actionsDiv) {
        actionsDiv.innerHTML = '<span style="font-size:0.75rem;color:var(--accent-cyan)">⏳ Đang upscale...</span>';
    }

    try {
        const res = await fetch('/api/upscale-image', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
                imagePath: currentSrc,
                clipId: clipId,
                projectDir: currentPlan?._outputDir
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const img = container.querySelector('img');
        if (img) {
            img.src = data.imagePath + '?t=' + Date.now();
            img.onload = () => {
                const sizeInfo = container.querySelector('.img-size-info');
                if (sizeInfo) sizeInfo.textContent = img.naturalWidth + ' × ' + img.naturalHeight + 'px (Upscaled)';
            };
        }
        if (actionsDiv) {
            actionsDiv.innerHTML = `
                <button class="btn-img-action" title="Tải ảnh Upscaled" onclick="downloadImage('${data.imagePath}', '${clipId}_upscaled')">
                    📥 Tải HD
                </button>
                <span style="font-size:0.75rem;color:var(--accent-green)">✅ Upscaled!</span>`;
        }
        showToast(`✅ Đã upscale ảnh ${clipId}!`);
    } catch (err) {
        if (actionsDiv) {
            actionsDiv.innerHTML = `
                <button class="btn-img-action" onclick="downloadImage('${currentSrc}', '${clipId}')">📥 Tải</button>
                <button class="btn-img-action" onclick="handleUpscaleImage('${clipId}', ${index}, '${currentSrc}')">🔍 Thử lại</button>
                <span style="font-size:0.7rem;color:var(--accent-red)">❌ ${err.message}</span>`;
        }
        showToast('❌ Upscale lỗi: ' + err.message);
    }
}

async function handleGenerateAllImages() {
    if (!currentPlan || !currentPlan.clips) return;

    const engine = document.getElementById('engineSelect')?.value ||
        document.getElementById('engineSelectVideo')?.value || 'gemini';

    showLoading('Đang tạo tất cả ảnh reference...', `${currentPlan.clips.length} ảnh · Engine: ${engine}`);

    try {
        const res = await fetch('/api/generate-all', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
                clips: currentPlan.clips,
                engine: engine,
                projectDir: currentPlan._outputDir
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        // Update images in cards
        data.results.forEach(result => {
            const container = document.getElementById(`img-${result.clip_id}`);
            if (container && result.success) {
                container.innerHTML = `<img src="${result.imagePath}" alt="${result.clip_id}" loading="lazy">`;
            } else if (container) {
                container.innerHTML = `
                    <div class="clip-image-placeholder">
                        <span style="color:var(--accent-red)">❌ ${result.error}</span>
                    </div>`;
            }
        });

        const successCount = data.results.filter(r => r.success).length;
        showToast(`✅ Đã tạo ${successCount}/${data.results.length} ảnh`);
    } catch (err) {
        showToast('❌ Lỗi: ' + err.message);
    } finally {
        hideLoading();
    }
}

// ============ COPY / DOWNLOAD ============
function copyClipJson(index) {
    if (!currentPlan || !currentPlan.clips[index]) return;
    const clip = { ...currentPlan.clips[index] };
    navigator.clipboard.writeText(JSON.stringify(clip, null, 2));
    showToast('📋 Đã copy JSON clip!');
}

function copyClipPrompt(index) {
    if (!currentPlan || !currentPlan.clips[index]) return;
    const clip = currentPlan.clips[index];
    // Build a Veo 3.1 friendly text prompt from the timeline
    let prompt = '';
    if (clip.constraints?.style) prompt += clip.constraints.style + '. ';
    if (clip.constraints?.lighting) prompt += clip.constraints.lighting + '. ';
    if (clip.timeline) {
        clip.timeline.forEach(t => {
            prompt += `[${t.t}] ${t.camera}. ${t.action} `;
            if (t.dialogue) prompt += `Dialogue: "${t.dialogue}" `;
        });
    }
    if (clip.constraints?.artifact_guard) prompt += clip.constraints.artifact_guard + '. ';
    if (clip.constraints?.physics) prompt += clip.constraints.physics + '.';

    navigator.clipboard.writeText(prompt.trim());
    showToast('📝 Đã copy prompt video!');
}

function copyAllJson() {
    const data = currentPlan || currentReview;
    if (!data) return;
    const clean = { ...data };
    delete clean._outputDir;
    navigator.clipboard.writeText(JSON.stringify(clean, null, 2));
    showToast('📋 Đã copy toàn bộ JSON!');
}

function downloadJson() {
    const data = currentPlan || currentReview;
    if (!data) return;
    const clean = { ...data };
    delete clean._outputDir;
    const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (currentPlan ? 'video_plan' : 'video_review') + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('📥 Đã tải JSON!');
}

function copyReviewJson() {
    if (!currentReview) return;
    navigator.clipboard.writeText(JSON.stringify(currentReview, null, 2));
    showToast('📋 Đã copy JSON đánh giá!');
}

function downloadReviewJson() {
    if (!currentReview) return;
    const blob = new Blob([JSON.stringify(currentReview, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'video_review.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('📥 Đã tải JSON đánh giá!');
}

// ============ API KEY MODAL ============
function toggleApiKeyModal() {
    const modal = document.getElementById('apiKeyModal');
    modal.classList.toggle('active');
}

async function saveApiKey() {
    const input = document.getElementById('apiKeyInput');
    const key = input.value.trim();
    if (!key || key.length < 10) {
        showToast('⚠️ API key không hợp lệ');
        return;
    }

    // Save to localStorage (per-user, per-browser)
    setStoredApiKey(key);
    showToast('✅ API Key đã được lưu trong trình duyệt của bạn!');
    toggleApiKeyModal();
    checkApiStatus();
}

// ============ DNA ANALYSIS HANDLERS ============
async function handleDNAAnalyze() {
    if (!uploadedVideoFile) return;

    showLoading('🧬 AI đang phân tích DNA video...', `${uploadedVideoFile.name} — Phân tích sâu hook, style, nhân vật, điểm ăn tiền`);

    try {
        const formData = new FormData();
        formData.append('video', uploadedVideoFile);
        const langFormat = document.getElementById('langFormatVideo')?.value || 'VN';
        formData.append('langFormat', langFormat);

        const res = await fetch('/api/analyze-dna', {
            method: 'POST',
            headers: { 'x-api-key': getStoredApiKey() },
            body: formData
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        currentDNA = data.dna;
        renderDNAResults(currentDNA, 'dnaResults');
        showToast('✅ Phân tích DNA video thành công!');
    } catch (err) {
        showToast('❌ Lỗi: ' + err.message);
    } finally {
        hideLoading();
    }
}

async function handleDNAUrlAnalyze() {
    const url = document.getElementById('videoUrlInput').value.trim();
    if (!url) {
        showToast('⚠️ Vui lòng nhập link video');
        return;
    }

    showLoading('🧬 Đang tải và phân tích DNA video...', 'Có thể mất 1-3 phút');

    try {
        const langFormat = document.getElementById('langFormatVideo')?.value || 'VN';

        const res = await fetch('/api/analyze-dna-url', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ url, langFormat })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        currentDNA = data.dna;
        renderDNAResults(currentDNA, 'dnaResults');
        showToast('✅ Phân tích DNA từ URL thành công!');
    } catch (err) {
        showToast('❌ Lỗi: ' + err.message);
    } finally {
        hideLoading();
    }
}

// ============ RENDER DNA RESULTS ============
function renderDNAResults(dna, targetId) {
    const section = document.getElementById(targetId);
    if (!section) return;

    const vd = dna.video_dna || {};
    const scoreColor = (s) => s >= 80 ? 'var(--accent-green)' : s >= 60 ? 'var(--accent-orange)' : 'var(--accent-red)';

    let html = '';

    // Header with save actions
    html += `
        <div class="results-header">
            <h2>🧬 DNA Video — ${vd.title || 'Untitled'}</h2>
            <div class="results-actions">
                <button class="btn-dna-save" onclick="savePresetFromDNA()">💾 Lưu Preset</button>
                ${dna.characters && dna.characters.length ? `<button class="btn-dna-save" onclick="saveCharactersFromDNA()">🎭 Lưu Nhân Vật</button>` : ''}
                <button class="btn-secondary" onclick="copyDNAJson()">📋 Copy JSON</button>
            </div>
        </div>`;

    // Score cards row
    html += `
        <div class="dna-scores-row">
            <div class="dna-score-card">
                <div class="dna-score-circle" style="color:${scoreColor(vd.overall_score || 0)}">${vd.overall_score || 0}</div>
                <div class="dna-score-label">Tổng điểm</div>
            </div>
            <div class="dna-score-card">
                <div class="dna-score-circle" style="color:${scoreColor(vd.virality_score || 0)}">${vd.virality_score || 0}</div>
                <div class="dna-score-label">Viral</div>
            </div>
            <div class="dna-score-card">
                <div class="dna-score-circle" style="color:${scoreColor(vd.production_score || 0)}">${vd.production_score || 0}</div>
                <div class="dna-score-label">Production</div>
            </div>
            <div class="dna-info-card">
                <div class="dna-info-item">📁 ${vd.category || 'N/A'}</div>
                <div class="dna-info-item">📱 ${(vd.platform_fit || []).join(', ')}</div>
                <div class="dna-info-item">⏱ ${vd.estimated_duration_sec || '?'}s</div>
            </div>
        </div>`;

    // Money Points
    if (dna.money_points && dna.money_points.length) {
        html += `
            <div class="dna-card">
                <h3>💰 Điểm Đáng Ăn Tiền (${dna.money_points.length})</h3>
                <div class="money-points-list">
                    ${dna.money_points.map(mp => `
                        <div class="money-point">
                            <div class="money-point-header">
                                <span class="money-point-time">${mp.timestamp}</span>
                                <span class="money-point-type">${mp.type}</span>
                                <span class="money-point-score">${'⭐'.repeat(Math.min(mp.impact_score || 0, 5))}</span>
                            </div>
                            <div class="money-point-desc">${mp.description}</div>
                            <div class="money-point-tip">💡 ${mp.reusable_technique}</div>
                        </div>
                    `).join('')}
                </div>
            </div>`;
    }

    // Hook Strategy
    if (dna.hook_strategy) {
        const hs = dna.hook_strategy;
        html += `
            <div class="dna-card">
                <h3>🎣 Hook Strategy</h3>
                <div class="dna-grid">
                    <div><span class="dna-label">Loại:</span> ${hs.hook_type}</div>
                    <div><span class="dna-label">Thời điểm:</span> ${hs.hook_timestamp}</div>
                    <div><span class="dna-label">Hiệu quả:</span> ${hs.hook_effectiveness}/10</div>
                    <div style="grid-column:1/-1"><span class="dna-label">Mô tả:</span> ${hs.hook_description}</div>
                    <div style="grid-column:1/-1"><span class="dna-label">Tại sao hiệu quả:</span> ${hs.why_it_works}</div>
                </div>
            </div>`;
    }

    // Emotional Arc + Pacing
    html += `<div class="dna-two-col">`;
    if (dna.emotional_arc) {
        const ea = dna.emotional_arc;
        html += `
            <div class="dna-card">
                <h3>🎭 Emotional Arc</h3>
                <div class="emotional-arc-flow">
                    <span class="emotion-tag">${ea.opening_emotion}</span>
                    <span class="emotion-arrow">→</span>
                    <span class="emotion-tag peak">${ea.peak_emotion}</span>
                    <span class="emotion-arrow">→</span>
                    <span class="emotion-tag">${ea.closing_emotion}</span>
                </div>
                <p class="dna-desc">${ea.emotional_journey || ''}</p>
            </div>`;
    }
    if (dna.pacing_rhythm) {
        const pr = dna.pacing_rhythm;
        html += `
            <div class="dna-card">
                <h3>🥁 Pacing & Rhythm</h3>
                <div class="dna-grid">
                    <div><span class="dna-label">Tempo:</span> ${pr.tempo}</div>
                    <div><span class="dna-label">Transition:</span> ${pr.transition_style}</div>
                    <div style="grid-column:1/-1"><span class="dna-label">Beat:</span> ${pr.beat_pattern}</div>
                    <div style="grid-column:1/-1"><span class="dna-label">Energy:</span> ${pr.energy_curve}</div>
                </div>
            </div>`;
    }
    html += `</div>`;

    // Style DNA
    if (dna.style_dna) {
        const sd = dna.style_dna;
        html += `
            <div class="dna-card">
                <h3>🎨 Style DNA</h3>
                <div class="dna-grid">
                    <div><span class="dna-label">Style:</span> ${sd.overall_style}</div>
                    <div><span class="dna-label">Color Grading:</span> ${sd.color_grading}</div>
                    <div><span class="dna-label">Lighting:</span> ${sd.lighting_setup}</div>
                    <div><span class="dna-label">Lens:</span> ${sd.lens_style}</div>
                    <div><span class="dna-label">Composition:</span> ${sd.composition_rules}</div>
                    <div><span class="dna-label">Sound:</span> ${sd.sound_design}</div>
                    <div><span class="dna-label">Mood:</span> ${sd.mood}</div>
                    <div><span class="dna-label">Edit BPM:</span> ${sd.edit_rhythm_bpm || 'N/A'}</div>
                </div>
                ${sd.color_palette ? `
                    <div style="margin-top:12px">
                        <span class="dna-label">Bảng Màu:</span>
                        <div class="color-palette" style="margin-top:6px">
                            ${sd.color_palette.map(c => `<div class="color-swatch" style="background:${c}" title="${c}" onclick="navigator.clipboard.writeText('${c}');showToast('Đã copy ${c}')"></div>`).join('')}
                        </div>
                    </div>` : ''}
            </div>`;
    }

    // Characters
    if (dna.characters && dna.characters.length) {
        html += `
            <div class="dna-card">
                <h3>🎭 Nhân Vật (${dna.characters.length})</h3>
                <div class="dna-characters-grid">
                    ${dna.characters.map(ch => `
                        <div class="dna-char-card">
                            <div class="dna-char-avatar">${ch.gender === 'female' ? '👩' : '👨'}</div>
                            <div class="dna-char-name">${ch.name}</div>
                            <div class="dna-char-meta">${ch.gender || ''} · ${ch.age_range || ''} · ${ch.ethnicity || ''}</div>
                            ${ch.appearance ? `<div class="dna-char-detail"><b>Ngoại hình:</b> ${ch.appearance}</div>` : ''}
                            ${ch.clothing ? `<div class="dna-char-detail"><b>Trang phục:</b> ${ch.clothing}</div>` : ''}
                            ${ch.personality ? `<div class="dna-char-detail"><b>Tính cách:</b> ${ch.personality}</div>` : ''}
                            ${ch.role_in_video ? `<div class="dna-char-detail"><b>Vai trò:</b> ${ch.role_in_video}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>`;
    }

    // Content Formula + Replication Guide
    html += `<div class="dna-two-col">`;
    if (dna.content_formula) {
        const cf = dna.content_formula;
        html += `
            <div class="dna-card">
                <h3>📐 Content Formula</h3>
                <div class="dna-grid">
                    <div style="grid-column:1/-1"><span class="dna-label">Cấu trúc:</span> ${cf.structure}</div>
                    <div><span class="dna-label">Kỹ thuật:</span> ${cf.storytelling_technique}</div>
                    <div><span class="dna-label">Đối tượng:</span> ${cf.audience_target}</div>
                    <div style="grid-column:1/-1"><span class="dna-label">USP:</span> ${cf.unique_selling_point}</div>
                </div>
            </div>`;
    }
    if (dna.replication_guide) {
        const rg = dna.replication_guide;
        html += `
            <div class="dna-card">
                <h3>📋 Replication Guide</h3>
                <div class="dna-grid">
                    <div><span class="dna-label">Độ khó:</span> ${rg.difficulty}</div>
                    <div><span class="dna-label">Thiết bị:</span> ${(rg.required_equipment || []).join(', ')}</div>
                    <div style="grid-column:1/-1"><span class="dna-label">Yếu tố thành công:</span> ${(rg.key_success_factors || []).join(' · ')}</div>
                    <div style="grid-column:1/-1"><span class="dna-label">Tránh:</span> ${(rg.common_mistakes_to_avoid || []).join(' · ')}</div>
                </div>
            </div>`;
    }
    html += `</div>`;

    section.innerHTML = html;
    section.style.display = 'block';
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function copyDNAJson() {
    if (!currentDNA) return;
    navigator.clipboard.writeText(JSON.stringify(currentDNA, null, 2));
    showToast('📋 Đã copy DNA JSON!');
}

// ============ PRESET MANAGEMENT ============
async function loadPresets() {
    try {
        const res = await fetch('/api/presets');
        const data = await res.json();
        savedPresets = data.presets || [];
        updatePresetDropdown();
    } catch (e) {
        console.error('Failed to load presets:', e);
    }
}

function updatePresetDropdown() {
    const select = document.getElementById('presetSelect');
    if (!select) return;
    // Keep first option
    select.innerHTML = '<option value="">-- Không dùng preset --</option>';
    savedPresets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (${new Date(p.createdAt).toLocaleDateString('vi')})`;
        select.appendChild(opt);
    });

    // Preview badge on change
    select.onchange = () => {
        const badge = document.getElementById('presetBadge');
        const preset = savedPresets.find(p => p.id === select.value);
        if (preset && badge) {
            const d = preset.data;
            badge.style.display = 'block';
            badge.innerHTML = `
                <div class="preset-badge-inner">
                    <strong>${preset.name}</strong>
                    ${d.style_dna ? `<span>🎨 ${d.style_dna.overall_style?.substring(0, 50) || ''}...</span>` : ''}
                    ${d.pacing_rhythm ? `<span>🥁 ${d.pacing_rhythm.tempo || ''}</span>` : ''}
                    ${d.characters?.length ? `<span>🎭 ${d.characters.length} nhân vật</span>` : ''}
                    ${d.video_dna?.overall_score ? `<span>⭐ ${d.video_dna.overall_score}/100</span>` : ''}
                </div>`;
        } else if (badge) {
            badge.style.display = 'none';
        }
    };
}

async function savePresetFromDNA() {
    if (!currentDNA) {
        showToast('⚠️ Chưa có dữ liệu DNA');
        return;
    }

    const name = currentDNA.suggested_preset_name || currentDNA.video_dna?.title || 'Preset ' + new Date().toLocaleDateString('vi');
    const finalName = prompt('Đặt tên preset:', name);
    if (!finalName) return;

    try {
        const res = await fetch('/api/presets', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ name: finalName, data: currentDNA })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast('✅ Đã lưu preset: ' + finalName);
        await loadPresets();
    } catch (err) {
        showToast('❌ Lỗi lưu preset: ' + err.message);
    }
}

// Save custom preset from manual text input
async function saveCustomPreset() {
    const nameInput = document.getElementById('customPresetName');
    const rulesInput = document.getElementById('customPresetRules');
    const name = nameInput.value.trim();
    const rules = rulesInput.value.trim();

    if (!name) { showToast('⚠️ Nhập tên preset'); return; }
    if (!rules || rules.length < 20) { showToast('⚠️ Rules quá ngắn (tối thiểu 20 ký tự)'); return; }

    try {
        const presetData = {
            type: 'custom',
            custom_rules: rules,
            source: 'manual'
        };

        const res = await fetch('/api/presets', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ name, data: presetData })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast('✅ Đã lưu custom preset: ' + name);
        nameInput.value = '';
        rulesInput.value = '';
        await loadPresets();

        // Refresh preset list in modal
        openPresetManager();
    } catch (err) {
        showToast('❌ Lỗi: ' + err.message);
    }
}

async function deletePreset(id) {
    if (!confirm('Xóa preset này?')) return;
    try {
        await fetch('/api/presets/' + id, { method: 'DELETE' });
        showToast('🗑️ Đã xóa preset');
        await loadPresets();
        openPresetManager(); // refresh
    } catch (err) {
        showToast('❌ Lỗi: ' + err.message);
    }
}

function openPresetManager() {
    const modal = document.getElementById('presetManagerModal');
    const body = document.getElementById('presetManagerBody');

    if (!savedPresets.length) {
        body.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:40px 0">Chưa có preset nào.</p>';
    } else {
        body.innerHTML = `
            <div class="preset-list">
                ${savedPresets.map(p => {
            const d = p.data;
            const isCustom = d.type === 'custom';
            return `
                        <div class="preset-list-item">
                            <div class="preset-list-info">
                                <div class="preset-list-name">${isCustom ? '✍️' : '🧬'} ${p.name}</div>
                                <div class="preset-list-meta">
                                    ${new Date(p.createdAt).toLocaleString('vi')}
                                    ${isCustom ? ' · 📝 Custom Rules' : ''}
                                    ${!isCustom && d.video_dna?.overall_score ? ` · ⭐ ${d.video_dna.overall_score}/100` : ''}
                                    ${!isCustom && d.characters?.length ? ` · 🎭 ${d.characters.length} nhân vật` : ''}
                                </div>
                                ${isCustom ? `<div class="preset-list-style">📋 ${d.custom_rules.substring(0, 100)}...</div>` : ''}
                                ${!isCustom && d.style_dna?.overall_style ? `<div class="preset-list-style">🎨 ${d.style_dna.overall_style.substring(0, 80)}...</div>` : ''}
                            </div>
                            <button class="btn-ghost btn-danger" onclick="deletePreset('${p.id}')">🗑️</button>
                        </div>`;
        }).join('')}
            </div>`;
    }

    modal.classList.add('active');
}

function closePresetManager() {
    document.getElementById('presetManagerModal').classList.remove('active');
}

// ============ CHARACTER LIBRARY ============
async function loadCharacters() {
    try {
        const res = await fetch('/api/characters');
        const data = await res.json();
        savedCharacters = data.characters || [];
    } catch (e) {
        console.error('Failed to load characters:', e);
    }
}

async function saveCharactersFromDNA() {
    if (!currentDNA || !currentDNA.characters || !currentDNA.characters.length) {
        showToast('⚠️ Không có nhân vật trong DNA');
        return;
    }

    try {
        const source = currentDNA.video_dna?.title || 'DNA Analysis';
        const res = await fetch('/api/characters', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ characters: currentDNA.characters, source })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast(`✅ Đã lưu ${data.saved.length} nhân vật!`);
        await loadCharacters();
    } catch (err) {
        showToast('❌ Lỗi: ' + err.message);
    }
}

async function deleteCharacter(id) {
    if (!confirm('Xóa nhân vật này?')) return;
    try {
        await fetch('/api/characters/' + id, { method: 'DELETE' });
        showToast('✅ Đã xóa nhân vật');
        await loadCharacters();
        openCharacterLibrary(); // refresh
    } catch (err) {
        showToast('❌ Lỗi: ' + err.message);
    }
}

function openCharacterLibrary() {
    const modal = document.getElementById('characterLibraryModal');
    const body = document.getElementById('characterLibraryBody');

    if (!savedCharacters.length) {
        body.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:40px 0">Chưa có nhân vật nào.<br>Phân tích DNA video để lưu nhân vật.</p>';
    } else {
        body.innerHTML = `
            <div class="character-lib-grid">
                ${savedCharacters.map(ch => `
                    <div class="char-lib-card">
                        <div class="char-lib-header">
                            <span class="char-lib-avatar">${ch.gender === 'female' ? '👩' : '👨'}</span>
                            <div>
                                <div class="char-lib-name">${ch.name}</div>
                                <div class="char-lib-meta">${ch.gender || ''} · ${ch.age_range || ''} · ${ch.ethnicity || ''}</div>
                            </div>
                            <button class="btn-ghost btn-danger btn-sm" onclick="deleteCharacter('${ch.id}')">🗑️</button>
                        </div>
                        ${ch.appearance ? `<div class="char-lib-detail">👤 ${ch.appearance}</div>` : ''}
                        ${ch.clothing ? `<div class="char-lib-detail">👕 ${ch.clothing}</div>` : ''}
                        ${ch.personality ? `<div class="char-lib-detail">💫 ${ch.personality}</div>` : ''}
                        <div class="char-lib-source">Nguồn: ${ch.source || 'unknown'}</div>
                    </div>
                `).join('')}
            </div>`;
    }

    modal.classList.add('active');
}

function closeCharacterLibrary() {
    document.getElementById('characterLibraryModal').classList.remove('active');
}
