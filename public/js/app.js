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

function getAuthToken() {
    return localStorage.getItem('auth_token') || '';
}

function getCurrentUser() {
    try { return JSON.parse(localStorage.getItem('auth_user') || 'null'); } catch { return null; }
}

function getApiHeaders() {
    return {
        'Content-Type': 'application/json',
        'x-api-key': getStoredApiKey(),
        'Authorization': 'Bearer ' + getAuthToken()
    };
}

function logout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    window.location.href = '/login.html';
}

// ============ CROSS-BROWSER IMAGE DOWNLOAD ============
function downloadImage(imgSrc, fileName) {
    window.location.href = '/api/download-image?path=' + encodeURIComponent(imgSrc) + '&name=' + encodeURIComponent(fileName || 'image');
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
    // Auth check
    const token = getAuthToken();
    if (!token) {
        window.location.href = '/login.html';
        return;
    }

    // Verify token
    fetch('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + token } })
        .then(r => { if (!r.ok) throw new Error(); return r.json(); })
        .then(data => {
            // Show user info
            const userEl = document.getElementById('userDisplay');
            if (userEl) userEl.textContent = `👤 ${data.user.username}`;
            // Show admin tab if admin
            if (data.user.role === 'admin') {
                const adminTab = document.getElementById('tabAdmin');
                if (adminTab) adminTab.style.display = '';
            }
        })
        .catch(() => {
            localStorage.removeItem('auth_token');
            window.location.href = '/login.html';
        });

    checkApiStatus();
    setupTabs();
    setupSlider();
    setupUploadZones();
    loadPresets();
    loadCharacters();
    loadMyChannels();
    loadHistory();
    loadTemplates();
    loadChannelsForGenerator();

    // Auto-fill API key input from localStorage
    const savedKey = getStoredApiKey();
    if (savedKey) {
        const input = document.getElementById('apiKeyInput');
        if (input) input.value = savedKey;
    }

    // Load YouTube API key status
    fetch('/api/settings/youtube-key', { headers: { 'Authorization': 'Bearer ' + getAuthToken() } })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
            if (d && d.hasKey) {
                const ytInput = document.getElementById('youtubeApiKeyInput');
                if (ytInput) ytInput.placeholder = 'Đã lưu: ' + d.key;
            }
        }).catch(() => { });
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
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn) btn.classList.add('active');
    const panel = document.getElementById(`panel${capitalize(tabName)}`);
    if (panel) panel.classList.add('active');
    // Auto-load data when tab is switched
    if (tabName === 'admin') { loadAdminDashboard(); renderAnalyticsCharts(); loadAdminChatLogs(); }
    if (tabName === 'text') { loadHistory(); loadTemplates(); loadChannelsForGenerator(); }
    if (tabName === 'profile') { loadProfile(); }
    if (tabName === 'channels') { renderUserCharts(); }
}

function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
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

        // Append template style if selected
        let fullDescription = description;
        if (window._selectedTemplate) {
            fullDescription += `\n\n[Video Style: ${window._selectedTemplate.name} — ${window._selectedTemplate.desc}]`;
        }

        // Gather channel/roadmap context
        const channelId = document.getElementById('channelForGenerate')?.value || '';
        const channelName = channelId ? document.getElementById('channelForGenerate')?.selectedOptions[0]?.text : '';
        const taskIdx = document.getElementById('roadmapTaskSelect')?.value;
        const roadmapTask = (taskIdx !== '' && window._generatorTasks) ? window._generatorTasks[parseInt(taskIdx)] : null;

        const res = await fetch('/api/analyze-text', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
                description: fullDescription,
                duration: parseInt(duration),
                langFormat,
                presetId: presetId || undefined,
                channelId: channelId || undefined,
                channelName: channelName || undefined,
                roadmapTask: roadmapTask ? { title: roadmapTask.title, rmName: roadmapTask.rmName, day: roadmapTask.day } : undefined,
                templateStyle: window._selectedTemplate?.name || undefined
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        currentPlan = data.plan;
        currentPlan._outputDir = data.outputDir;
        renderPlan(currentPlan, 'textResults');
        showToast('✅ Đã tạo kế hoạch thành công!');
        loadHistory(); // Refresh history
    } catch (err) {
        showToast('❌ Lỗi: ' + err.message);
    } finally {
        hideLoading();
    }
}

// ============ GENERATION HISTORY ============
async function loadHistory() {
    const container = document.getElementById('historyList');
    if (!container) return;
    try {
        const res = await fetch('/api/history', { headers: { 'Authorization': 'Bearer ' + getAuthToken() } });
        const items = await res.json();
        window._textHistoryItems = items; // Store globally
        if (!items.length) {
            container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.8rem;font-style:italic;text-align:center;padding:12px">Chưa có lịch sử tạo video</p>';
            return;
        }
        container.innerHTML = items.map((h, idx) => {
            const date = new Date(h.createdAt);
            const timeStr = date.toLocaleDateString('vi-VN') + ' ' + date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            return `<div style="padding:10px 12px;background:rgba(0,0,0,0.15);border-radius:8px;border:1px solid rgba(139,92,246,0.1);cursor:pointer;transition:all 0.2s;margin-bottom:6px" onmouseover="this.style.borderColor='rgba(139,92,246,0.3)'" onmouseout="this.style.borderColor='rgba(139,92,246,0.1)'" onclick="useHistoryItem(${idx})">
                <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
                    <div style="flex:1;min-width:0">
                        <div style="font-size:0.82rem;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${h.projectName || (h.description || '').substring(0, 40)}</div>
                        <div style="font-size:0.7rem;color:var(--text-secondary);margin-top:2px">${h.clipCount || 0} clips • ${h.duration || 0}s • ${timeStr}${h.presetName ? ' • ' + h.presetName : ''}${h.channelName ? ' • 📺 ' + h.channelName : ''}</div>
                    </div>
                    <button onclick="event.stopPropagation();deleteHistoryItem('${h.id}')" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:0.7rem;padding:2px 4px;opacity:0.5" onmouseover="this.style.opacity='1';this.style.color='#ef4444'" onmouseout="this.style.opacity='0.5';this.style.color='var(--text-secondary)'" title="Xóa">✕</button>
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        console.error('History load error:', e);
    }
}

function useHistoryItem(idx) {
    const h = window._textHistoryItems?.[idx];
    if (!h) return;
    if (h.plan) {
        // Load full plan and render it
        currentPlan = h.plan;
        renderPlan(currentPlan, 'textResults');
        document.getElementById('textDescription').value = h.description || '';
        const durInput = document.getElementById('durationInput');
        if (durInput && h.duration) durInput.value = h.duration;
        showToast(`✅ Đã tải lại kế hoạch: ${h.projectName || 'Video'}`);
    } else {
        // No plan, just fill description
        document.getElementById('textDescription').value = h.description || '';
        const durInput = document.getElementById('durationInput');
        if (durInput && h.duration) durInput.value = h.duration;
        showToast('📋 Đã tải mô tả — cần bấm "Tạo Kế Hoạch" lại');
    }
}

async function deleteHistoryItem(id) {
    try {
        await fetch('/api/history/' + id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + getAuthToken() } });
        loadHistory();
        showToast('🗑️ Đã xóa');
    } catch (e) { showToast('❌ Lỗi xóa'); }
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
                `<div class="color-swatch" style="background:${c}" title="${c}" onclick="copyText('${c}');showToast('Đã copy ${c}')"></div>`
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
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <h3>🎭 Nhân Vật (${plan.characters.length})</h3>
                    <button class="btn-ghost btn-sm" onclick="saveCharactersFromPlan()" style="color:#8b5cf6">💾 Lưu Nhân Vật</button>
                </div>
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

    // Single Reference Image (opening frame for Veo3 extend)
    const hasRefImage = clip.ref_image || clip.ref_image_start || clip.reference_image_prompt;

    let imagesHtml = '';
    if (hasRefImage) {
        imagesHtml = `
            <div class="clip-single-image" id="img-${clipId}">
                <div class="clip-image-placeholder" style="aspect-ratio:9/16;max-height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;border-radius:12px;border:2px dashed var(--border-light);background:rgba(139,92,246,0.05)">
                    <div style="font-size:1.5rem">🎬</div>
                    <span style="font-size:0.75rem;color:var(--text-secondary)">Opening Frame (9:16)</span>
                    <button class="btn-generate-img" onclick="handleGenerateRefImage('${clipId}', ${index}, 'start')" style="padding:8px 20px;font-size:0.85rem">
                        ✨ Tạo ảnh khởi đầu
                    </button>
                </div>
            </div>`;
    } else {
        imagesHtml = `
            <div class="clip-image-container" id="img-${clipId}">
                <div class="clip-image-placeholder" style="aspect-ratio:9/16;max-height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;border-radius:12px;border:2px dashed var(--border-light)">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <span style="font-size:0.75rem">Chưa tạo ảnh</span>
                    <button class="btn-generate-img" onclick="handleGenerateSingleImage('${clipId}', ${index})">
                        ✨ Tạo ảnh reference
                    </button>
                </div>
            </div>`;
    }

    // Image prompt display
    let promptsHtml = '';
    const refPrompt = clip.ref_image || clip.ref_image_start || clip.reference_image_prompt;
    if (refPrompt) {
        promptsHtml = `
            <div class="clip-section">
                <div class="clip-section-title">🖼️ Image Prompt (Opening Frame)</div>
                <div class="clip-section-value">${refPrompt}</div>
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
                                    <pre style="white-space:pre-wrap;color:var(--text-secondary);font-size:0.8rem;margin:0;cursor:pointer" onclick="copyText(this.textContent);showToast('Đã copy prompt!')">${sol.corrected_prompt}</pre>
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
        const prompt = clip.ref_image || clip.reference_image_prompt || clip.ref_image_start || '';
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
    // Single ref_image (new) or old ref_image_start/key/end
    const prompt = clip.ref_image || clip[`ref_image_${refType}`];
    if (!prompt) {
        showToast('⚠️ Không có prompt cho ảnh');
        return;
    }

    // Try single image container first, then old per-type containers
    const container = document.getElementById(`img-${clipId}`) || document.getElementById(`img-${clipId}-${refType}`);
    if (!container) return;
    const engine = document.getElementById('engineSelect')?.value ||
        document.getElementById('engineSelectVideo')?.value || 'imagen';
    const aspectRatio = document.getElementById('aspectRatio')?.value ||
        document.getElementById('aspectRatioVideo')?.value || '9:16';

    container.innerHTML = `
        <div style="aspect-ratio:9/16;max-height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;border-radius:12px;border:2px dashed var(--border-light)">
            <div class="mini-spinner"></div>
            <span style="font-size:0.75rem;color:var(--text-muted)">Đang tạo ảnh ${aspectRatio}...</span>
        </div>`;

    try {
        const res = await fetch('/api/generate-image', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
                prompt: prompt,
                clipId: `${clipId} _opening`,
                engine: engine,
                aspectRatio: aspectRatio,
                projectDir: currentPlan._outputDir
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const imgSrc = data.imagePath;
        container.innerHTML = `
        <img src="${imgSrc}" alt="${clipId}" loading="lazy" style="max-height:280px;border-radius:12px;object-fit:cover">
            <div style="display:flex;gap:6px;margin-top:4px;justify-content:center">
                <button class="btn-img-action-sm" onclick="downloadImage('${imgSrc}', '${clipId}_opening')" title="Tải">📥 Tải</button>
                <button class="btn-img-action-sm" onclick="handleUpscaleImage('${clipId}', ${index}, '${imgSrc}')" title="Upscale">🔍 Upscale</button>
                <button class="btn-img-action-sm" onclick="handleGenerateRefImage('${clipId}', ${index}, 'start')" title="Tạo lại">🔄 Lại</button>
            </div>`;
        showToast(`✅ Ảnh opening frame cho ${clipId} `);
    } catch (err) {
        container.innerHTML = `
        <div style="aspect-ratio:9/16;max-height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;border-radius:12px;border:2px dashed var(--accent-red)">
                <span style="color:var(--accent-red);font-size:0.75rem">❌ ${err.message}</span>
                <button class="btn-generate-img" onclick="handleGenerateRefImage('${clipId}', ${index}, 'start')" style="font-size:0.8rem">
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
    showToast(`✅ Đã tạo 3 ảnh ref cho ${clipId} !`);
}

// ============ UPSCALE IMAGE ============
async function handleUpscaleImage(clipId, index, currentSrc) {
    const container = document.getElementById(`img - ${clipId} `);
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
        < button class="btn-img-action" title = "Tải ảnh Upscaled" onclick = "downloadImage('${data.imagePath}', '${clipId}_upscaled')" >
                    📥 Tải HD
                </button >
        <span style="font-size:0.75rem;color:var(--accent-green)">✅ Upscaled!</span>`;
        }
        showToast(`✅ Đã upscale ảnh ${clipId} !`);
    } catch (err) {
        if (actionsDiv) {
            actionsDiv.innerHTML = `
        < button class="btn-img-action" onclick = "downloadImage('${currentSrc}', '${clipId}')" >📥 Tải</button >
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

    showLoading('Đang tạo tất cả ảnh reference...', `${currentPlan.clips.length} ảnh · Engine: ${engine} `);

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
// Clipboard fallback for HTTP (navigator.clipboard requires HTTPS)
function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text);
    } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }
}

function copyClipJson(index) {
    if (!currentPlan || !currentPlan.clips[index]) return;
    const clip = { ...currentPlan.clips[index] };
    copyText(JSON.stringify(clip, null, 2));
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

    copyText(prompt.trim());
    showToast('📝 Đã copy prompt video!');
}

function copyAllJson() {
    const data = currentPlan || currentReview;
    if (!data) return;
    const clean = { ...data };
    delete clean._outputDir;
    copyText(JSON.stringify(clean, null, 2));
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
    copyText(JSON.stringify(currentReview, null, 2));
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
    const geminiKey = document.getElementById('apiKeyInput').value.trim();
    const youtubeKey = document.getElementById('youtubeApiKeyInput')?.value?.trim();

    if (geminiKey && geminiKey.length >= 10) {
        setStoredApiKey(geminiKey);
    }

    // Save YouTube API key to server
    if (youtubeKey) {
        try {
            await fetch('/api/settings/youtube-key', {
                method: 'POST',
                headers: getApiHeaders(),
                body: JSON.stringify({ key: youtubeKey })
            });
        } catch (e) { console.error('Failed to save YouTube key'); }
    }

    showToast('\u2705 API Keys \u0111\u00e3 \u0111\u01b0\u1ee3c l\u01b0u!');
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
                            ${sd.color_palette.map(c => `<div class="color-swatch" style="background:${c}" title="${c}" onclick="copyText('${c}');showToast('Đã copy ${c}')"></div>`).join('')}
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
    copyText(JSON.stringify(currentDNA, null, 2));
    showToast('📋 Đã copy DNA JSON!');
}

// ============ PRESET MANAGEMENT ============
async function loadPresets() {
    try {
        const res = await fetch('/api/presets');
        const data = await res.json();
        savedPresets = data.presets || [];
        updatePresetDropdown();
        loadChannelPresetDropdown();
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
        let saved = 0;
        for (const ch of currentDNA.characters) {
            const res = await fetch('/api/characters', {
                method: 'POST',
                headers: getApiHeaders(),
                body: JSON.stringify({
                    name: ch.name || 'Unknown',
                    characterId: ch.character_id || ch.name?.toLowerCase().replace(/\s+/g, '_'),
                    gender: ch.gender, age: ch.age, species: ch.species,
                    appearance: ch.appearance, personality: ch.personality,
                    backstory: ch.backstory, imageUrl: ch.imageUrl,
                    voiceStyle: ch.voice_style
                })
            });
            if (res.ok) saved++;
        }
        showToast(`✅ Đã lưu ${saved} nhân vật vào thư viện!`);
        await loadCharacters();
    } catch (err) {
        showToast('❌ Lỗi: ' + err.message);
    }
}

async function saveCharactersFromPlan() {
    if (!currentPlan || !currentPlan.characters || !currentPlan.characters.length) {
        showToast('⚠️ Không có nhân vật trong kế hoạch');
        return;
    }
    try {
        let saved = 0;
        for (const ch of currentPlan.characters) {
            const res = await fetch('/api/characters', {
                method: 'POST',
                headers: getApiHeaders(),
                body: JSON.stringify({
                    name: ch.name || 'Unknown',
                    characterId: ch.character_id || ch.name?.toLowerCase().replace(/\s+/g, '_'),
                    gender: ch.gender, age: ch.age, species: ch.species,
                    appearance: ch.appearance, personality: ch.personality,
                    backstory: ch.backstory, imageUrl: ch.generatedImageUrl || ch.imageUrl,
                    voiceStyle: ch.voice_style
                })
            });
            if (res.ok) saved++;
        }
        showToast(`✅ Đã lưu ${saved} nhân vật vào thư viện!`);
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

// ============ CHANNEL MANAGEMENT ============
let myChannels = [];

async function loadMyChannels() {
    try {
        const res = await fetch('/api/channels', {
            headers: { 'Authorization': 'Bearer ' + getAuthToken() }
        });
        if (!res.ok) return;
        myChannels = await res.json();
        renderChannelList();
    } catch (e) {
        console.error('Failed to load channels:', e);
    }
}

function renderChannelList() {
    const container = document.getElementById('channelList');
    if (!container) return;

    if (!myChannels.length) {
        container.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:40px">Chưa có kênh nào. Tạo kênh mới để bắt đầu!</p>';
        return;
    }

    container.innerHTML = myChannels.map(ch => {
        const platforms = [];
        if (ch.socialLinks?.youtube) platforms.push('🎬 YouTube');
        if (ch.socialLinks?.tiktok) platforms.push('🎵 TikTok');
        if (ch.socialLinks?.facebook) platforms.push('📘 Facebook');
        const presetName = savedPresets.find(p => p.id === ch.presetId)?.name || '';

        return `
        <div class="dna-card" style="margin-bottom:16px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
                <div>
                    <h3 style="margin:0;cursor:pointer" onclick="viewChannelDetail('${ch.id}', false)">📺 ${ch.name}</h3>
                    <div style="color:var(--text-secondary);font-size:0.85rem;margin-top:4px">
                        ${ch.niche ? `<span style="margin-right:12px">🏷️ ${ch.niche}</span>` : ''}
                        <span style="margin-right:12px">${ch.language === 'VN' ? '🇻🇳' : '🇺🇸'} ${ch.language}</span>
                        <span style="margin-right:12px">📅 ${ch.postsPerDay} video/ngày</span>
                        ${presetName ? `<span>🎨 ${presetName}</span>` : ''}
                    </div>
                    ${ch.description ? `<p style="color:var(--text-secondary);font-size:0.8rem;margin-top:6px">${ch.description}</p>` : ''}
                    ${platforms.length ? `<div style="margin-top:8px;font-size:0.8rem;color:var(--accent-purple)">${platforms.join(' · ')}</div>` : ''}
                </div>
                <div style="display:flex;gap:8px">
                    <button class="btn-primary btn-sm" onclick="generateRoadmap('${ch.id}')" title="Tạo Roadmap">🗓️ Roadmap</button>
                    <button class="btn-ghost btn-sm" onclick="editChannel('${ch.id}')" title="Sửa kênh">✏️</button>
                    <button class="btn-ghost btn-danger btn-sm" onclick="deleteChannel('${ch.id}')" title="Xóa kênh">🗑️</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

async function createChannel() {
    const name = document.getElementById('chName')?.value.trim();
    if (!name) { showToast('⚠️ Nhập tên kênh'); return; }

    const channel = {
        name,
        niche: document.getElementById('chNiche')?.value.trim() || '',
        description: document.getElementById('chDescription')?.value.trim() || '',
        socialLinks: {
            youtube: document.getElementById('chYoutube')?.value.trim() || '',
            tiktok: document.getElementById('chTiktok')?.value.trim() || '',
            facebook: document.getElementById('chFacebook')?.value.trim() || ''
        },
        language: document.getElementById('chLanguage')?.value || 'US',
        postsPerDay: parseInt(document.getElementById('chPostsPerDay')?.value) || 2,
        presetId: document.getElementById('chPreset')?.value || null
    };

    try {
        const res = await fetch('/api/channels', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify(channel)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast('✅ Đã tạo kênh: ' + name);
        // Clear form
        ['chName', 'chNiche', 'chDescription', 'chYoutube', 'chTiktok', 'chFacebook'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        await loadMyChannels();
    } catch (err) {
        showToast('❌ ' + err.message);
    }
}

async function deleteChannel(id) {
    if (!confirm('Xóa kênh này? Roadmaps cũng sẽ bị mất.')) return;
    try {
        await fetch('/api/channels/' + id, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + getAuthToken() }
        });
        showToast('🗑️ Đã xóa kênh');
        await loadMyChannels();
    } catch (err) {
        showToast('❌ ' + err.message);
    }
}

function loadChannelPresetDropdown() {
    const sel = document.getElementById('chPreset');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Không chọn —</option>';
    savedPresets.forEach(p => {
        sel.innerHTML += `<option value="${p.id}">${p.name}</option>`;
    });
}

// Placeholder for Phase 3
let currentRoadmap = null;
let currentRoadmapChannelId = null;

async function generateRoadmap(channelId) {
    if (!getStoredApiKey()) {
        showToast('\u26a0\ufe0f Nh\u1eadp API Key tr\u01b0\u1edbc');
        return;
    }

    const channel = myChannels.find(c => c.id === channelId);
    if (!channel) { showToast('\u274c Kh\u00f4ng t\u00ecm th\u1ea5y k\u00eanh'); return; }

    // Check if roadmaps exist
    try {
        const res = await fetch('/api/roadmaps/' + channelId, {
            headers: { 'Authorization': 'Bearer ' + getAuthToken() }
        });
        const roadmaps = await res.json();
        if (roadmaps.length > 0) {
            currentRoadmap = roadmaps[0]; // Latest
            currentRoadmapChannelId = channelId;
            renderRoadmap();
            return;
        }
    } catch (e) { }

    // No roadmaps — check if channel has a brief
    if (!channel.brief) {
        // Open strategy chat first
        openStrategyChat(channelId);
        return;
    }

    // Ask for number of days
    const daysInput = prompt('Số ngày Roadmap (7, 10, 14 hoặc nhập số khác):', '7');
    if (!daysInput) return;
    const days = parseInt(daysInput);
    if (isNaN(days) || days < 1 || days > 30) {
        showToast('⚠️ Nhập số từ 1-30');
        return;
    }

    await generateNewRoadmap(channelId, null, days);
}

// ============ STRATEGY CHAT ============
let strategyChatMessages = [];
let strategyChatChannelId = null;

function openStrategyChat(channelId) {
    strategyChatChannelId = channelId;
    strategyChatMessages = [];
    const channel = myChannels.find(c => c.id === channelId);

    document.getElementById('strategyChatBody').innerHTML = '';
    document.getElementById('strategyChatInput').style.display = 'flex';
    document.getElementById('strategyChatDone').style.display = 'none';
    document.getElementById('strategyChatModal').classList.add('active');

    // Send first message to get AI's first question
    sendStrategyMessage(true);
}

async function sendStrategyMessage(isInit = false) {
    const input = document.getElementById('strategyUserInput');
    const userText = isInit ? '' : input?.value?.trim();
    if (!isInit && !userText) return;

    if (!isInit) {
        strategyChatMessages.push({ role: 'user', content: userText });
        renderChatMessages();
        input.value = '';
    }

    // Show typing indicator
    const body = document.getElementById('strategyChatBody');
    const typing = document.createElement('div');
    typing.id = 'typingIndicator';
    typing.style.cssText = 'padding:10px 14px;background:rgba(139,92,246,0.1);border-radius:12px;border:1px solid rgba(139,92,246,0.2);color:var(--text-secondary);font-size:0.85rem;align-self:flex-start;max-width:80%';
    typing.textContent = '\u2728 AI \u0111ang suy ngh\u0129...';
    body.appendChild(typing);
    body.scrollTop = body.scrollHeight;

    try {
        const res = await fetch('/api/channels/' + strategyChatChannelId + '/strategy', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ messages: strategyChatMessages })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        document.getElementById('typingIndicator')?.remove();

        if (data.done && data.brief) {
            // AI finished — show brief summary
            strategyChatMessages.push({ role: 'ai', content: '\u2705 T\u00f4i \u0111\u00e3 hi\u1ec3u r\u00f5 chi\u1ebfn l\u01b0\u1ee3c k\u00eanh c\u1ee7a b\u1ea1n! Brief \u0111\u00e3 \u0111\u01b0\u1ee3c l\u01b0u.' });
            renderChatMessages();
            document.getElementById('strategyChatInput').style.display = 'none';
            document.getElementById('strategyChatDone').style.display = 'block';

            // Reload channels to get updated brief
            await loadMyChannels();
        } else {
            strategyChatMessages.push({ role: 'ai', content: data.message });
            renderChatMessages();
        }
    } catch (err) {
        document.getElementById('typingIndicator')?.remove();
        showToast('\u274c ' + err.message);
    }
}

function renderChatMessages() {
    const body = document.getElementById('strategyChatBody');
    body.innerHTML = strategyChatMessages.map(m => {
        if (m.role === 'user') {
            return `<div style="padding:10px 14px;background:rgba(6,182,212,0.15);border-radius:12px;border:1px solid rgba(6,182,212,0.3);color:var(--text-primary);font-size:0.9rem;align-self:flex-end;max-width:80%">${m.content}</div>`;
        } else {
            return `<div style="padding:10px 14px;background:rgba(139,92,246,0.1);border-radius:12px;border:1px solid rgba(139,92,246,0.2);color:var(--text-primary);font-size:0.9rem;align-self:flex-start;max-width:80%">\ud83e\udde0 ${m.content}</div>`;
        }
    }).join('');
    body.scrollTop = body.scrollHeight;
}

function closeStrategyChat() {
    document.getElementById('strategyChatModal').classList.remove('active');
    strategyChatMessages = [];
}

async function generateRoadmapAfterBrief() {
    closeStrategyChat();
    if (strategyChatChannelId) {
        const daysInput = prompt('Số ngày Roadmap (7, 10, 14 hoặc nhập số khác):', '7');
        if (!daysInput) return;
        const days = parseInt(daysInput);
        if (isNaN(days) || days < 1 || days > 30) {
            showToast('⚠️ Nhập số từ 1-30');
            return;
        }
        await generateNewRoadmap(strategyChatChannelId, null, days);
    }
}

async function generateNewRoadmap(channelId, startDate, days = 7) {
    showLoading(`🗓️ AI đang tạo Roadmap ${days} ngày...`, 'Phân tích niche, trend, và tạo ý tưởng chủ đề');

    try {
        const res = await fetch('/api/roadmaps/generate', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ channelId, startDate, days })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        currentRoadmap = data.roadmap;
        currentRoadmapChannelId = channelId;
        hideLoading();
        showToast('\u2705 Roadmap \u0111\u00e3 t\u1ea1o xong!');
        renderRoadmap();
    } catch (err) {
        hideLoading();
        showToast('\u274c ' + err.message);
    }
}

async function regenerateRoadmap(channelId) {
    const daysInput = prompt('Số ngày Roadmap (7, 10, 14 hoặc nhập số khác):', '7');
    if (!daysInput) return;
    const days = parseInt(daysInput);
    if (isNaN(days) || days < 1 || days > 30) {
        showToast('⚠️ Nhập số từ 1-30');
        return;
    }
    await generateNewRoadmap(channelId, null, days);
}

function renderRoadmap() {
    if (!currentRoadmap) return;

    const container = document.getElementById('channelList');
    if (!container) return;

    const rm = currentRoadmap;
    const channel = myChannels.find(c => c.id === currentRoadmapChannelId);

    let html = `
    <div style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
        <div>
            <button class="btn-ghost" onclick="loadMyChannels()" style="margin-right:8px">\u2b05 Quay l\u1ea1i</button>
            <strong>\ud83d\uddd3\ufe0f ${rm.roadmap_name || 'Roadmap'}</strong>
            <span style="color:var(--text-secondary);font-size:0.85rem;margin-left:8px">${rm.channel || ''} \u2022 ${rm.week_start || ''}</span>
        </div>
        <div style="display:flex;gap:8px">
            <button class="btn-primary btn-sm" onclick="regenerateRoadmap('${currentRoadmapChannelId}')">\ud83d\udd04 T\u1ea1o l\u1ea1i</button>
            <button class="btn-dna-save btn-sm" onclick="generateNextWeek()">\u27a1\ufe0f Tu\u1ea7n ti\u1ebfp theo</button>
        </div>
    </div>`;

    if (rm.weekly_strategy) {
        html += `<div class="dna-card" style="margin-bottom:16px;border-left:3px solid var(--accent-purple)">
            <strong>\ud83c\udfaf Chi\u1ebfn l\u01b0\u1ee3c tu\u1ea7n:</strong>
            <p style="color:var(--text-secondary);font-size:0.85rem;margin-top:4px">${rm.weekly_strategy}</p>
        </div>`;
    }

    if (rm.days && rm.days.length > 0) {
        rm.days.forEach(day => {
            const dayNames = { 'Monday': 'Th\u1ee9 2', 'Tuesday': 'Th\u1ee9 3', 'Wednesday': 'Th\u1ee9 4', 'Thursday': 'Th\u1ee9 5', 'Friday': 'Th\u1ee9 6', 'Saturday': 'Th\u1ee9 7', 'Sunday': 'CN' };
            const vnDay = dayNames[day.day_name] || day.day_name;

            html += `<div class="dna-card" style="margin-bottom:12px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                    <h3 style="margin:0">\ud83d\udcc5 ${vnDay} — ${day.date || 'Ng\u00e0y ' + day.day}</h3>
                    ${day.theme ? `<span style="background:rgba(139,92,246,0.15);color:var(--accent-purple);padding:2px 8px;border-radius:6px;font-size:0.75rem">${day.theme}</span>` : ''}
                </div>`;

            if (day.videos && day.videos.length > 0) {
                day.videos.forEach(video => {
                    const status = video.status || 'pending';
                    const statusBadge = status === 'published'
                        ? '<span style="color:#10b981">\u2705 \u0110\u00e3 \u0111\u0103ng</span>'
                        : status === 'done'
                            ? '<span style="color:#f59e0b">\u2705 \u0110\u00e3 quay</span>'
                            : '<span style="color:#94a3b8">\u23f3 Ch\u01b0a l\u00e0m</span>';

                    html += `
                    <div style="background:rgba(15,12,41,0.4);border:1px solid var(--border-light);border-radius:10px;padding:12px;margin-bottom:8px">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start">
                            <div style="flex:1">
                                <div style="display:flex;align-items:center;gap:6px">
                                    <span style="font-weight:600;font-size:0.95rem">\ud83c\udfac ${video.title}</span>
                                    <button class="btn-ghost" onclick="copyText('${video.title.replace(/'/g, "\\'")}'.trim());showToast('\ud83d\udccb \u0110\u00e3 copy ch\u1ee7 \u0111\u1ec1!')" style="font-size:0.65rem;padding:1px 4px" title="Copy ch\u1ee7 \u0111\u1ec1">\ud83d\udccb</button>
                                </div>
                                ${video.idea ? `<div style="color:var(--text-secondary);font-size:0.8rem;margin-top:4px">\ud83d\udca1 ${video.idea}</div>` : ''}
                                <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;font-size:0.75rem">
                                    ${video.content_type ? `<span style="background:rgba(236,72,153,0.15);color:#ec4899;padding:1px 6px;border-radius:4px">${video.content_type}</span>` : ''}
                                    ${video.best_post_time ? `<span style="color:var(--text-secondary)">\ud83d\udd52 ${video.best_post_time}</span>` : ''}
                                </div>
                                ${video.hashtags?.length ? `<div style="margin-top:4px;font-size:0.75rem;color:var(--accent-purple)">${video.hashtags.join(' ')}</div>` : ''}
                                ${video.metrics ? `<div style="margin-top:6px;display:flex;gap:12px;font-size:0.8rem;color:#10b981"><span>\ud83d\udc41 ${(video.metrics.views || 0).toLocaleString()}</span><span>\u2764\ufe0f ${(video.metrics.likes || 0).toLocaleString()}</span><span>\ud83d\udcac ${(video.metrics.comments || 0).toLocaleString()}</span></div>` : ''}
                            </div>
                            <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;min-width:180px">
                                ${statusBadge}
                                <select onchange="updateVideoStatus('${rm.id}', ${day.day}, ${video.slot}, this.value)" style="font-size:0.7rem;padding:2px 6px;background:var(--bg-input);border:1px solid var(--border-light);border-radius:4px;color:var(--text-primary)">
                                    <option value="pending" ${status === 'pending' ? 'selected' : ''}>Ch\u01b0a l\u00e0m</option>
                                    <option value="done" ${status === 'done' ? 'selected' : ''}>\u0110\u00e3 l\u00e0m</option>
                                    <option value="published" ${status === 'published' ? 'selected' : ''}>\u0110\u00e3 \u0111\u0103ng</option>
                                </select>
                                <div style="display:grid;gap:2px;margin-top:4px;width:100%">
                                    ${['youtube', 'tiktok', 'facebook', 'instagram'].map(p => {
                        const icons = { youtube: '\ud83c\udfac', tiktok: '\ud83c\udfb5', facebook: '\ud83d\udcd8', instagram: '\ud83d\udcf8' };
                        const urls = video.publishedUrls || {};
                        const oldUrl = !video.publishedUrls && video.publishedUrl && p === 'youtube' ? video.publishedUrl : '';
                        return `<div style="display:flex;gap:2px;align-items:center">
                                            <span style="font-size:0.6rem;width:14px">${icons[p]}</span>
                                            <input type="text" id="scan_${day.day}_${video.slot}_${p}" placeholder="${p}" value="${urls[p] || oldUrl}" style="font-size:0.6rem;padding:1px 3px;flex:1;background:var(--bg-input);border:1px solid var(--border-light);border-radius:3px;color:var(--text-primary)">
                                            <button class="btn-ghost" onclick="scanPlatformVideo('${rm.id}',${day.day},${video.slot},'${p}')" style="font-size:0.55rem;padding:0 2px">\ud83d\udd0d</button>
                                        </div>`;
                    }).join('')}
                                </div>
                                ${video.metrics ? `<div style="margin-top:4px;font-size:0.65rem;color:#10b981">` +
                            Object.entries(video.metrics).filter(([k]) => ['youtube', 'tiktok', 'facebook', 'instagram'].includes(k)).map(([p, m]) =>
                                `<div>${p}: ${(m.views || 0).toLocaleString()}👁 ${(m.likes || 0).toLocaleString()}❤️</div>`
                            ).join('') +
                            (video.metrics.views !== undefined ? `<div>Total: ${(video.metrics.views || 0).toLocaleString()}👁</div>` : '') +
                            `</div>` : ''}
                            </div>
                        </div>
                    </div>`;
                });
            }

            html += `</div>`;
        });
    }

    container.innerHTML = html;
}

async function updateVideoStatus(roadmapId, day, slot, status) {
    try {
        await fetch('/api/roadmaps/' + roadmapId + '/video-status', {
            method: 'PUT',
            headers: getApiHeaders(),
            body: JSON.stringify({ day, slot, status })
        });
    } catch (e) {
        showToast('\u274c ' + e.message);
    }
}

async function generateNextWeek() {
    if (!currentRoadmap) return;
    showLoading('\ud83d\udd04 AI \u0111ang t\u1ea1o Roadmap tu\u1ea7n ti\u1ebfp theo...', 'D\u1ef1a tr\u00ean hi\u1ec7u su\u1ea5t tu\u1ea7n tr\u01b0\u1edbc');

    try {
        const res = await fetch('/api/roadmaps/' + currentRoadmap.id + '/next', {
            method: 'POST',
            headers: getApiHeaders()
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        currentRoadmap = data.roadmap;
        hideLoading();
        showToast('\u2705 Roadmap tu\u1ea7n m\u1edbi \u0111\u00e3 t\u1ea1o!');
        renderRoadmap();
    } catch (err) {
        hideLoading();
        showToast('\u274c ' + err.message);
    }
}

function createPlanFromRoadmap(title, description) {
    // Switch to text tab and fill the description
    const tabBtn = document.querySelector('[data-tab="text"]');
    if (tabBtn) tabBtn.click();

    setTimeout(() => {
        const descInput = document.getElementById('videoDescription');
        if (descInput) descInput.value = title + '\n\n' + description;
        showToast('\ud83c\udfac M\u00f4 t\u1ea3 video \u0111\u00e3 \u0111i\u1ec1n s\u1eb5n, nh\u1ea5n "T\u1ea1o Plan" \u0111\u1ec3 ti\u1ebfp t\u1ee5c!');
    }, 300);
}

// ============ ADMIN DASHBOARD ============
// ============ ADMIN CHAT LOGS ============
let _adminChatLogs = [];

async function loadAdminChatLogs() {
    try {
        const res = await fetch('/api/admin/chat-logs', { headers: { 'Authorization': 'Bearer ' + getAuthToken() } });
        if (!res.ok) return;
        _adminChatLogs = await res.json();

        const sel = document.getElementById('chatLogUserSelect');
        if (!sel) return;
        sel.innerHTML = '<option value="">-- Chọn user (' + _adminChatLogs.length + ') --</option>' +
            _adminChatLogs.map((log, i) =>
                `<option value="${i}">👤 ${log.username} (${log.messageCount} tin nhắn)</option>`
            ).join('');
    } catch (e) { /* ignore */ }
}

function loadChatLogForUser() {
    const idx = document.getElementById('chatLogUserSelect')?.value;
    const container = document.getElementById('chatLogMessages');
    const countEl = document.getElementById('chatLogCount');
    if (!container || idx === '') {
        if (container) container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.8rem;text-align:center">Chọn user để xem</p>';
        return;
    }

    const log = _adminChatLogs[parseInt(idx)];
    if (!log || !log.messages.length) {
        container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.8rem;text-align:center">Chưa có tin nhắn</p>';
        return;
    }
    if (countEl) countEl.textContent = `${log.messageCount} tin nhắn`;

    container.innerHTML = log.messages.map(m => {
        const time = new Date(m.time).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
        if (m.role === 'user') {
            return `<div style="align-self:flex-end;max-width:80%;background:linear-gradient(135deg,#8b5cf6,#3b82f6);padding:8px 12px;border-radius:12px;border-top-right-radius:4px;color:white;font-size:0.8rem">
                <div>${m.content.replace(/\n/g, '<br>')}</div>
                <div style="font-size:0.6rem;opacity:0.6;text-align:right;margin-top:2px">${time}</div>
            </div>`;
        } else {
            return `<div style="max-width:80%;background:rgba(139,92,246,0.12);padding:8px 12px;border-radius:12px;border-top-left-radius:4px;font-size:0.8rem">
                <div>${m.content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</div>
                <div style="font-size:0.6rem;color:var(--text-secondary);margin-top:2px">${time}</div>
            </div>`;
        }
    }).join('');
    container.scrollTop = container.scrollHeight;
}

async function loadAdminDashboard() {
    try {
        const res = await fetch('/api/admin/overview', {
            headers: { 'Authorization': 'Bearer ' + getAuthToken() }
        });
        if (!res.ok) return;
        const data = await res.json();

        // Stats cards
        const statsEl = document.getElementById('adminStats');
        if (statsEl) {
            statsEl.innerHTML = `
                <div class="dna-card" style="text-align:center">
                    <div style="font-size:2rem;font-weight:800;color:var(--accent-purple)">${data.users}</div>
                    <div style="color:var(--text-secondary);font-size:0.85rem">\ud83d\udc65 Nh\u00e2n vi\u00ean</div>
                </div>
                <div class="dna-card" style="text-align:center">
                    <div style="font-size:2rem;font-weight:800;color:#10b981">${data.channels}</div>
                    <div style="color:var(--text-secondary);font-size:0.85rem">\ud83d\udcfa K\u00eanh</div>
                </div>
                <div class="dna-card" style="text-align:center">
                    <div style="font-size:2rem;font-weight:800;color:#f59e0b">${data.roadmaps}</div>
                    <div style="color:var(--text-secondary);font-size:0.85rem">\ud83d\uddd3\ufe0f Roadmaps</div>
                </div>`;
        }

        // Users list
        const userListEl = document.getElementById('adminUserList');
        if (userListEl && data.userList) {
            userListEl.innerHTML = data.userList.map(u => `
                <div class="dna-card" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
                    <div>
                        <strong>${u.role === 'admin' ? '\ud83d\udc51' : '\ud83d\udc64'} ${u.name || u.username}</strong>
                        <span style="color:var(--text-secondary);font-size:0.8rem;margin-left:8px">@${u.username} \u2022 ${u.role}</span>
                        <span style="color:var(--text-secondary);font-size:0.8rem;margin-left:8px">\ud83d\udcfa ${u.channelCount} k\u00eanh \u2022 \ud83d\uddd3\ufe0f ${u.roadmapCount} roadmaps</span>
                    </div>
                    ${u.role !== 'admin' ? `<button class="btn-ghost btn-danger btn-sm" onclick="deleteUserAdmin('${u.id}')" title="X\u00f3a">\ud83d\uddd1\ufe0f</button>` : ''}
                </div>`).join('');
        }

        // Load all channels
        const chRes = await fetch('/api/admin/channels', {
            headers: { 'Authorization': 'Bearer ' + getAuthToken() }
        });
        if (chRes.ok) {
            const channels = await chRes.json();
            const chListEl = document.getElementById('adminChannelList');
            if (chListEl) {
                if (!channels.length) {
                    chListEl.innerHTML = '<p style="color:var(--text-secondary)">Ch\u01b0a c\u00f3 k\u00eanh n\u00e0o</p>';
                } else {
                    chListEl.innerHTML = channels.map(c => `
                        <div class="dna-card" style="margin-bottom:8px;cursor:pointer" onclick="viewChannelDetail('${c.id}', true)">
                            <div style="display:flex;justify-content:space-between">
                                <div>
                                    <strong>\ud83d\udcfa ${c.name}</strong>
                                    <span style="color:var(--text-secondary);font-size:0.8rem;margin-left:8px">by @${c.ownerName}</span>
                                </div>
                                <span style="color:var(--text-secondary);font-size:0.8rem">${c.niche || ''} \u2022 ${c.language} \u2022 ${c.postsPerDay} video/ng\u00e0y</span>
                            </div>
                        </div>`).join('');
                }
            }
        }

        // Load all roadmaps
        const rmRes = await fetch('/api/admin/roadmaps', {
            headers: { 'Authorization': 'Bearer ' + getAuthToken() }
        });
        if (rmRes.ok) {
            const roadmaps = await rmRes.json();
            const rmListEl = document.getElementById('adminRoadmapList');
            if (rmListEl) {
                if (!roadmaps.length) {
                    rmListEl.innerHTML = '<p style="color:var(--text-secondary)">Ch\u01b0a c\u00f3 roadmap n\u00e0o</p>';
                } else {
                    window._adminRoadmaps = roadmaps;
                    rmListEl.innerHTML = roadmaps.map((r, idx) => {
                        const totalVideos = r.days?.reduce((sum, d) => sum + (d.videos?.length || 0), 0) || 0;
                        const published = r.days?.reduce((sum, d) => sum + (d.videos?.filter(v => v.status === 'published').length || 0), 0) || 0;
                        const pct = totalVideos > 0 ? Math.round(published / totalVideos * 100) : 0;
                        return `
                        <div class="dna-card" style="margin-bottom:8px;cursor:pointer" onclick="adminViewRoadmap(${idx})">
                            <div style="display:flex;justify-content:space-between;align-items:center">
                                <div>
                                    <strong>\ud83d\uddd3\ufe0f ${r.roadmap_name || 'Roadmap'}</strong>
                                    <span style="color:var(--text-secondary);font-size:0.8rem;margin-left:8px">\ud83d\udcfa ${r.channelName} \u2022 by @${r.ownerName}</span>
                                </div>
                                <div style="display:flex;align-items:center;gap:8px">
                                    <div style="width:60px;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden">
                                        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#8b5cf6,#3b82f6);border-radius:2px"></div>
                                    </div>
                                    <span style="color:var(--text-secondary);font-size:0.75rem;white-space:nowrap">${published}/${totalVideos}</span>
                                </div>
                            </div>
                        </div>`;
                    }).join('');
                }
            }
        }

    } catch (e) {
        console.error('Admin load error:', e);
    }
}

function adminViewRoadmap(idx) {
    try {
        const rm = window._adminRoadmaps?.[idx];
        if (!rm) throw new Error('Roadmap not found');
        currentRoadmapChannelId = rm.channelId;
        currentRoadmap = rm;
        switchTab('channels');
        setTimeout(() => renderRoadmap(), 200);
    } catch (e) {
        console.error('Error viewing roadmap:', e);
        showToast('❌ Không thể mở roadmap');
    }
}

async function createUser() {
    const username = document.getElementById('newUsername')?.value.trim();
    const password = document.getElementById('newPassword')?.value;
    const name = document.getElementById('newName')?.value.trim();
    if (!username || !password) { showToast('\u26a0\ufe0f Nh\u1eadp username v\u00e0 password'); return; }

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ username, password, name, role: 'editor' })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast('\u2705 \u0110\u00e3 t\u1ea1o t\u00e0i kho\u1ea3n: ' + username);
        document.getElementById('newUsername').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('newName').value = '';
        loadAdminDashboard();
    } catch (err) {
        showToast('\u274c ' + err.message);
    }
}

async function deleteUserAdmin(userId) {
    if (!confirm('X\u00f3a t\u00e0i kho\u1ea3n n\u00e0y?')) return;
    try {
        await fetch('/api/auth/users/' + userId, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + getAuthToken() }
        });
        showToast('\ud83d\uddd1\ufe0f \u0110\u00e3 x\u00f3a');
        loadAdminDashboard();
    } catch (err) {
        showToast('\u274c ' + err.message);
    }
}

// ============ SCAN PUBLISHED VIDEO ============
async function scanPublishedVideo(roadmapId, day, slot) {
    const input = document.getElementById(`scan_${day}_${slot}`);
    const url = input?.value?.trim();
    if (!url) { showToast('\u26a0\ufe0f Paste URL video \u0111\u00e3 \u0111\u0103ng'); return; }

    showToast('\ud83d\udd0d \u0110ang qu\u00e9t video...');
    try {
        const res = await fetch('/api/scan-published', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ url, roadmapId, day, slot })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast(`\u2705 ${data.metrics.title}: ${(data.metrics.views || 0).toLocaleString()} views, ${(data.metrics.likes || 0).toLocaleString()} likes`);

        // Reload roadmap to show updated metrics
        if (currentRoadmapChannelId) {
            const rmRes = await fetch('/api/roadmaps/' + currentRoadmapChannelId, {
                headers: { 'Authorization': 'Bearer ' + getAuthToken() }
            });
            const roadmaps = await rmRes.json();
            if (roadmaps.length > 0) {
                currentRoadmap = roadmaps[0];
                renderRoadmap();
            }
        }
    } catch (err) {
        showToast('\u274c ' + err.message);
    }
}

async function scanPlatformVideo(roadmapId, day, slot, platform) {
    const input = document.getElementById(`scan_${day}_${slot}_${platform}`);
    const url = input?.value?.trim();
    if (!url) { showToast('\u26a0\ufe0f Paste URL ' + platform); return; }

    showToast('\ud83d\udd0d \u0110ang qu\u00e9t ' + platform + '...');
    try {
        const res = await fetch('/api/scan-published', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ url, roadmapId, day, slot, platform })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast(`\u2705 ${platform}: ${(data.metrics.views || 0).toLocaleString()} views`);

        // Reload roadmap
        if (currentRoadmapChannelId) {
            const rmRes = await fetch('/api/roadmaps/' + currentRoadmapChannelId, {
                headers: { 'Authorization': 'Bearer ' + getAuthToken() }
            });
            const roadmaps = await rmRes.json();
            if (roadmaps.length > 0) {
                currentRoadmap = roadmaps[0];
                renderRoadmap();
            }
        }
    } catch (err) {
        showToast('\u274c ' + err.message);
    }
}

// ============ CHANNEL EDIT & DETAIL ============
let editingChannelId = null;

function editChannel(id) {
    const ch = myChannels.find(c => c.id === id);
    if (!ch) return;
    editingChannelId = id;
    document.getElementById('chName').value = ch.name || '';
    document.getElementById('chNiche').value = ch.niche || '';
    document.getElementById('chDescription').value = ch.description || '';
    document.getElementById('chYoutube').value = ch.socialLinks?.youtube || '';
    document.getElementById('chTiktok').value = ch.socialLinks?.tiktok || '';
    document.getElementById('chFacebook').value = ch.socialLinks?.facebook || '';
    document.getElementById('chLanguage').value = ch.language || 'US';
    document.getElementById('chPostsPerDay').value = ch.postsPerDay || 2;
    if (document.getElementById('chPreset')) document.getElementById('chPreset').value = ch.presetId || '';

    const btn = document.getElementById('btnCreateChannel');
    if (btn) { btn.innerHTML = '\u2705 C\u1eadp Nh\u1eadt K\u00eanh'; btn.setAttribute('onclick', 'updateChannel()'); }
    document.getElementById('chName').scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('\u270f\ufe0f \u0110ang s\u1eeda k\u00eanh: ' + ch.name);
}

async function updateChannel() {
    if (!editingChannelId) return;
    const channel = {
        name: document.getElementById('chName')?.value.trim(),
        niche: document.getElementById('chNiche')?.value.trim() || '',
        description: document.getElementById('chDescription')?.value.trim() || '',
        socialLinks: {
            youtube: document.getElementById('chYoutube')?.value.trim() || '',
            tiktok: document.getElementById('chTiktok')?.value.trim() || '',
            facebook: document.getElementById('chFacebook')?.value.trim() || ''
        },
        language: document.getElementById('chLanguage')?.value || 'US',
        postsPerDay: parseInt(document.getElementById('chPostsPerDay')?.value) || 2,
        presetId: document.getElementById('chPreset')?.value || null
    };
    if (!channel.name) { showToast('\u26a0\ufe0f Nh\u1eadp t\u00ean k\u00eanh'); return; }
    try {
        const res = await fetch('/api/channels/' + editingChannelId, { method: 'PUT', headers: getApiHeaders(), body: JSON.stringify(channel) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showToast('\u2705 \u0110\u00e3 c\u1eadp nh\u1eadt k\u00eanh');
        cancelEdit();
        await loadMyChannels();
    } catch (err) { showToast('\u274c ' + err.message); }
}

function cancelEdit() {
    editingChannelId = null;
    ['chName', 'chNiche', 'chDescription', 'chYoutube', 'chTiktok', 'chFacebook'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    const btn = document.getElementById('btnCreateChannel');
    if (btn) { btn.innerHTML = '\ud83d\udcfa T\u1ea1o K\u00eanh'; btn.setAttribute('onclick', 'createChannel()'); }
}

async function viewChannelDetail(id, isAdmin) {
    try {
        const url = isAdmin ? '/api/admin/channels/' + id : '/api/channels/' + id;
        const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + getAuthToken() } });
        if (!res.ok) throw new Error('Không tải được');
        const data = await res.json();
        const ch = data.channel;
        const rms = data.roadmaps || [];

        // --- Brief section ---
        let briefHtml = '';
        if (ch.brief) {
            const formatVal = (v) => {
                if (typeof v === 'object' && v !== null) {
                    if (v.dos || v.donts || v.do || v.dont) {
                        let parts = [];
                        if (v.dos || v.do) parts.push('✅ ' + (v.dos || v.do));
                        if (v.donts || v.dont) parts.push('❌ ' + (v.donts || v.dont));
                        return parts.join('<br>');
                    }
                    return Object.entries(v).map(([k, val]) => `<strong>${k}:</strong> ${val}`).join(', ');
                }
                return v;
            };
            briefHtml = `<div style="margin-top:16px;padding:16px;background:rgba(16,185,129,0.05);border:1px solid rgba(16,185,129,0.15);border-radius:12px">
                <h4 style="margin:0 0 12px;font-size:0.95rem">📋 Chiến Lược Kênh</h4>
                <div style="display:grid;gap:8px;font-size:0.85rem;color:var(--text-secondary)">
                    ${ch.brief.target_audience ? `<div>🎯 <strong>Đối tượng:</strong> ${formatVal(ch.brief.target_audience)}</div>` : ''}
                    ${ch.brief.tone ? `<div>🎤 <strong>Tone:</strong> ${formatVal(ch.brief.tone)}</div>` : ''}
                    ${ch.brief.products ? `<div>💰 <strong>Sản phẩm:</strong> ${formatVal(ch.brief.products)}</div>` : ''}
                    ${ch.brief.competitors ? `<div>🏆 <strong>Đối thủ:</strong> ${formatVal(ch.brief.competitors)}</div>` : ''}
                    ${ch.brief.content_pillars?.length ? `<div>📌 <strong>Nội dung chính:</strong> ${Array.isArray(ch.brief.content_pillars) ? ch.brief.content_pillars.join(', ') : formatVal(ch.brief.content_pillars)}</div>` : ''}
                    ${ch.brief.cta_strategy ? `<div>📣 <strong>CTA:</strong> ${formatVal(ch.brief.cta_strategy)}</div>` : ''}
                    ${ch.brief.dos_and_donts ? `<div>⚠️ <strong>Lưu ý:</strong><br>${formatVal(ch.brief.dos_and_donts)}</div>` : ''}
                </div>
            </div>`;
        }

        // --- Social links ---
        let socialHtml = '';
        if (ch.socialLinks) {
            const links = [];
            if (ch.socialLinks.youtube) links.push(`<a href="${ch.socialLinks.youtube}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:8px;color:#f87171;font-size:0.8rem;text-decoration:none">▶️ YouTube</a>`);
            if (ch.socialLinks.tiktok) links.push(`<a href="${ch.socialLinks.tiktok}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.3);border-radius:8px;color:#06b6d4;font-size:0.8rem;text-decoration:none">🎵 TikTok</a>`);
            if (ch.socialLinks.facebook) links.push(`<a href="${ch.socialLinks.facebook}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;background:rgba(96,165,250,0.1);border:1px solid rgba(96,165,250,0.3);border-radius:8px;color:#60a5fa;font-size:0.8rem;text-decoration:none">📘 Facebook</a>`);
            if (links.length) socialHtml = `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">${links.join('')}</div>`;
        }

        // --- Per-platform metrics ---
        let platformStats = { youtube: { views: 0, likes: 0, comments: 0, count: 0 }, tiktok: { views: 0, likes: 0, comments: 0, count: 0 }, facebook: { views: 0, likes: 0, comments: 0, count: 0 } };
        let totalPublished = 0, totalVideos = 0;
        rms.forEach(r => {
            r.days?.forEach(d => {
                d.videos?.forEach(v => {
                    totalVideos++;
                    if (v.status === 'published') totalPublished++;
                    if (v.metrics) {
                        ['youtube', 'tiktok', 'facebook'].forEach(p => {
                            if (v.metrics[p]) {
                                platformStats[p].views += v.metrics[p].views || 0;
                                platformStats[p].likes += v.metrics[p].likes || 0;
                                platformStats[p].comments += v.metrics[p].comments || 0;
                                platformStats[p].count++;
                            }
                        });
                        // Legacy single metrics
                        if (typeof v.metrics.views === 'number' && !v.metrics.youtube && !v.metrics.tiktok && !v.metrics.facebook) {
                            platformStats.youtube.views += v.metrics.views;
                            platformStats.youtube.likes += v.metrics.likes || 0;
                            platformStats.youtube.comments += v.metrics.comments || 0;
                            platformStats.youtube.count++;
                        }
                    }
                });
            });
        });

        const hasMetrics = platformStats.youtube.count + platformStats.tiktok.count + platformStats.facebook.count > 0;
        if (hasMetrics || totalPublished > 0) {
            const totalViews = platformStats.youtube.views + platformStats.tiktok.views + platformStats.facebook.views;
            const totalLikes = platformStats.youtube.likes + platformStats.tiktok.likes + platformStats.facebook.likes;
            const totalComments = platformStats.youtube.comments + platformStats.tiktok.comments + platformStats.facebook.comments;

            const platformCard = (icon, name, color, stats) => {
                if (stats.count === 0) return '';
                return `<div style="padding:12px;background:rgba(0,0,0,0.2);border-radius:10px;border-left:3px solid ${color}">
                    <div style="font-size:0.8rem;font-weight:600;color:${color};margin-bottom:8px">${icon} ${name} <span style="font-weight:400;font-size:0.7rem;color:var(--text-secondary)">(${stats.count} video)</span></div>
                    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center">
                        <div><div style="font-weight:700;color:var(--text-primary)">${stats.views.toLocaleString()}</div><div style="font-size:0.65rem;color:var(--text-secondary)">Lượt xem</div></div>
                        <div><div style="font-weight:700;color:var(--text-primary)">${stats.likes.toLocaleString()}</div><div style="font-size:0.65rem;color:var(--text-secondary)">Thích</div></div>
                        <div><div style="font-weight:700;color:var(--text-primary)">${stats.comments.toLocaleString()}</div><div style="font-size:0.65rem;color:var(--text-secondary)">Bình luận</div></div>
                    </div>
                </div>`;
            };

            metricsHtml = `
            <div style="margin-top:16px;padding:16px;background:linear-gradient(135deg, rgba(139,92,246,0.08), rgba(59,130,246,0.08));border-radius:12px;border:1px solid rgba(139,92,246,0.15)">
                <h4 style="margin:0 0 12px;font-size:0.95rem">📊 Tổng Quan Metrics</h4>
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;text-align:center;margin-bottom:16px">
                    <div style="padding:10px;background:rgba(0,0,0,0.2);border-radius:8px">
                        <div style="font-size:1.2rem;font-weight:700;color:#8b5cf6">${totalPublished}<span style="font-size:0.7rem;color:var(--text-secondary)">/${totalVideos}</span></div>
                        <div style="font-size:0.65rem;color:var(--text-secondary)">Đã đăng</div>
                    </div>
                    <div style="padding:10px;background:rgba(0,0,0,0.2);border-radius:8px">
                        <div style="font-size:1.2rem;font-weight:700;color:#3b82f6">${totalViews.toLocaleString()}</div>
                        <div style="font-size:0.65rem;color:var(--text-secondary)">👁 Tổng xem</div>
                    </div>
                    <div style="padding:10px;background:rgba(0,0,0,0.2);border-radius:8px">
                        <div style="font-size:1.2rem;font-weight:700;color:#ef4444">${totalLikes.toLocaleString()}</div>
                        <div style="font-size:0.65rem;color:var(--text-secondary)">❤️ Tổng thích</div>
                    </div>
                    <div style="padding:10px;background:rgba(0,0,0,0.2);border-radius:8px">
                        <div style="font-size:1.2rem;font-weight:700;color:#10b981">${totalComments.toLocaleString()}</div>
                        <div style="font-size:0.65rem;color:var(--text-secondary)">💬 Bình luận</div>
                    </div>
                </div>
                <div style="display:grid;gap:8px">
                    ${platformCard('▶️', 'YouTube', '#f87171', platformStats.youtube)}
                    ${platformCard('🎵', 'TikTok', '#06b6d4', platformStats.tiktok)}
                    ${platformCard('📘', 'Facebook', '#60a5fa', platformStats.facebook)}
                </div>
            </div>`;
        }

        // --- Roadmaps section ---
        let roadmapsHtml = '<p style="color:var(--text-secondary);font-style:italic;font-size:0.85rem">Chưa có roadmap. Tạo roadmap tại tab "Kênh".</p>';
        if (rms.length) {
            roadmapsHtml = rms.map(r => {
                const total = r.days?.reduce((s, d) => s + (d.videos?.length || 0), 0) || 0;
                const done = r.days?.reduce((s, d) => s + (d.videos?.filter(v => v.status === 'published').length || 0), 0) || 0;
                const pct = total > 0 ? Math.round(done / total * 100) : 0;
                return `<div style="padding:12px;background:rgba(0,0,0,0.15);border-radius:10px;border:1px solid rgba(139,92,246,0.15);cursor:pointer;transition:all 0.2s" onmouseover="this.style.borderColor='rgba(139,92,246,0.4)'" onmouseout="this.style.borderColor='rgba(139,92,246,0.15)'" onclick="document.getElementById('channelDetailModal').classList.remove('active');currentRoadmapChannelId='${ch.id}';currentRoadmap=${JSON.stringify(r).replace(/'/g, "\\\\'")};renderRoadmap();">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                        <strong style="font-size:0.9rem">🗓️ ${r.roadmap_name || 'Roadmap'}</strong>
                        <span style="color:var(--text-secondary);font-size:0.75rem">${r.week_start || ''}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px">
                        <div style="flex:1;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden">
                            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#8b5cf6,#3b82f6);border-radius:3px;transition:width 0.3s"></div>
                        </div>
                        <span style="font-size:0.75rem;color:var(--text-secondary);white-space:nowrap">${done}/${total} <span style="color:${pct === 100 ? '#10b981' : '#8b5cf6'}">(${pct}%)</span></span>
                    </div>
                </div>`;
            }).join('');
        }

        document.getElementById('channelDetailTitle').textContent = '📺 ' + ch.name;
        document.getElementById('channelDetailBody').innerHTML = `
            <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:0.85rem;color:var(--text-secondary);margin-bottom:4px">
                ${ch.niche ? `<span style="padding:3px 10px;background:rgba(139,92,246,0.15);border-radius:6px;font-size:0.8rem">🏷️ ${ch.niche}</span>` : ''}
                <span style="padding:3px 10px;background:rgba(59,130,246,0.15);border-radius:6px;font-size:0.8rem">${ch.language === 'VN' ? '🇻🇳 Tiếng Việt' : '🇺🇸 English (US)'}</span>
                <span style="padding:3px 10px;background:rgba(16,185,129,0.15);border-radius:6px;font-size:0.8rem">📅 ${ch.postsPerDay} video/ngày</span>
                ${data.ownerName ? `<span style="padding:3px 10px;background:rgba(248,113,113,0.15);border-radius:6px;font-size:0.8rem">👤 @${data.ownerName}</span>` : ''}
            </div>
            ${ch.description ? `<p style="margin-top:10px;color:var(--text-secondary);font-size:0.88rem;line-height:1.5">${ch.description}</p>` : ''}
            ${socialHtml}
            ${briefHtml}
            ${metricsHtml}
            <div style="margin-top:20px">
                <h4 style="margin:0 0 12px;display:flex;align-items:center;gap:8px;font-size:0.95rem">
                    🗓️ Roadmaps <span style="background:var(--accent-purple);color:white;font-size:0.7rem;padding:2px 8px;border-radius:10px">${rms.length}</span>
                </h4>
                <div style="display:grid;gap:8px">${roadmapsHtml}</div>
            </div>
        `;
        document.getElementById('channelDetailModal').classList.add('active');
    } catch (err) { showToast('❌ ' + err.message); }
}

// ============ AUTO-SCAN & WEEKLY SUMMARY ============
async function triggerAutoScan() {
    showToast('\ud83d\udd04 \u0110ang qu\u00e9t t\u1ea5t c\u1ea3 video...');
    try {
        const res = await fetch('/api/admin/auto-scan', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + getAuthToken() }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showToast(`\u2705 Qu\u00e9t xong: ${data.scanned} th\u00e0nh c\u00f4ng, ${data.failed} l\u1ed7i`);
        loadAdminDashboard();
    } catch (err) { showToast('\u274c ' + err.message); }
}

async function loadWeeklySummary(roadmapId) {
    try {
        const res = await fetch('/api/roadmaps/' + roadmapId + '/summary', {
            headers: { 'Authorization': 'Bearer ' + getAuthToken() }
        });
        if (!res.ok) return '';
        const s = await res.json();
        if (!s.publishedCount) return '';
        return `<div class="dna-card" style="margin-bottom:16px;background:rgba(16,185,129,0.05)">
            <h4 style="margin:0 0 8px">\ud83d\udcca T\u1ed5ng K\u1ebft Tu\u1ea7n</h4>
            <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:0.9rem">
                <span>\ud83d\udc41 ${(s.totalViews || 0).toLocaleString()} views</span>
                <span>\u2764\ufe0f ${(s.totalLikes || 0).toLocaleString()} likes</span>
                <span>\ud83d\udcac ${(s.totalComments || 0).toLocaleString()} comments</span>
                <span>\ud83d\udcca Avg: ${(s.avgViews || 0).toLocaleString()} views/video</span>
            </div>
            ${s.bestVideo ? `<div style="margin-top:6px;font-size:0.85rem;color:#10b981">\ud83c\udfc6 Best: "${s.bestVideo.title}" (${(s.bestVideo.views || 0).toLocaleString()} views)</div>` : ''}
        </div>`;
    } catch (e) { return ''; }
}

// ============ TEMPLATE LIBRARY ============
async function loadTemplates() {
    const grid = document.getElementById('templateGrid');
    if (!grid) return;
    try {
        const res = await fetch('/api/templates');
        const templates = await res.json();
        if (!templates.length) {
            grid.innerHTML = '<p style="color:var(--text-secondary);font-size:0.8rem">Chưa có template</p>';
            return;
        }
        grid.innerHTML = templates.map(t => `
            <div class="tpl-card" onclick="selectTemplate(this)" data-desc="${t.description.replace(/"/g, '&quot;')}" data-duration="${t.defaultDuration}" data-lang="${t.defaultLang || 'VN'}"
                style="padding:10px;background:rgba(0,0,0,0.2);border-radius:10px;border:1px solid var(--border);cursor:pointer;transition:all 0.2s;text-align:center"
                onmouseover="this.style.borderColor='rgba(139,92,246,0.5)';this.style.transform='translateY(-2px)'"
                onmouseout="if(!this.classList.contains('tpl-active')){this.style.borderColor='var(--border)';this.style.transform='none'}">
                <div style="font-size:1.5rem;margin-bottom:4px">${t.thumbnail}</div>
                <div style="font-size:0.75rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.name.replace(/^[^\s]+\s/, '')}</div>
                <div style="font-size:0.65rem;color:var(--text-secondary);margin-top:2px">${t.defaultDuration}s • ${(t.tags || []).slice(0, 2).join(', ')}</div>
            </div>`).join('');
    } catch (e) { console.error('Template load error:', e); }
}

function selectTemplate(el) {
    // Deselect all
    document.querySelectorAll('.tpl-card').forEach(c => {
        c.classList.remove('tpl-active');
        c.style.borderColor = 'var(--border)';
        c.style.transform = 'none';
    });
    // Select this one
    el.classList.add('tpl-active');
    el.style.borderColor = '#8b5cf6';
    el.style.transform = 'translateY(-2px)';

    // Store template style info — do NOT overwrite description
    const styleName = el.querySelector('div:nth-child(2)')?.textContent || '';
    const styleDesc = el.dataset.desc;
    window._selectedTemplate = { name: styleName, desc: styleDesc };

    // Show style badge
    let badge = document.getElementById('templateBadge');
    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'templateBadge';
        badge.style.cssText = 'margin-top:6px;padding:6px 12px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:8px;font-size:0.8rem;color:#a78bfa;display:flex;align-items:center;gap:6px';
        document.getElementById('templateGrid')?.parentElement?.appendChild(badge);
    }
    badge.innerHTML = `🎨 Style: <strong>${styleName}</strong> <span style="color:var(--text-secondary);font-size:0.7rem">(sẽ áp dụng khi tạo)</span> <button onclick="clearTemplate()" style="margin-left:auto;background:none;border:none;color:#f87171;cursor:pointer;font-size:0.9rem">✕</button>`;

    showToast('🎨 Đã chọn style — nội dung giữ nguyên!');
}

function clearTemplate() {
    document.querySelectorAll('.tpl-card').forEach(c => {
        c.classList.remove('tpl-active');
        c.style.borderColor = 'var(--border)';
        c.style.transform = 'none';
    });
    window._selectedTemplate = null;
    const badge = document.getElementById('templateBadge');
    if (badge) badge.remove();
    showToast('Đã bỏ chọn style');
}

// ============ ANALYTICS CHARTS ============
let chartDaily = null, chartPlatform = null;
let _analyticsLoading = false;

async function renderAnalyticsCharts() {
    if (typeof Chart === 'undefined' || _analyticsLoading) return;
    _analyticsLoading = true;
    try {
        const res = await fetch('/api/admin/analytics', {
            headers: { 'Authorization': 'Bearer ' + getAuthToken() }
        });
        if (!res.ok) return;
        const data = await res.json();

        // Daily Views Line Chart
        const dailyCtx = document.getElementById('chartDaily')?.getContext('2d');
        if (dailyCtx) {
            if (chartDaily) chartDaily.destroy();
            chartDaily = new Chart(dailyCtx, {
                type: 'line',
                data: {
                    labels: data.dailyStats.map(d => d.date.substring(5)),
                    datasets: [{
                        label: 'Views',
                        data: data.dailyStats.map(d => d.views),
                        borderColor: '#8b5cf6',
                        backgroundColor: 'rgba(139,92,246,0.1)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3
                    }, {
                        label: 'Likes',
                        data: data.dailyStats.map(d => d.likes),
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239,68,68,0.1)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: '#9ca3af', font: { size: 11 } } } },
                    scales: {
                        x: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
                        y: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
                    }
                }
            });
        }

        // Platform Doughnut Chart
        const platCtx = document.getElementById('chartPlatform')?.getContext('2d');
        if (platCtx) {
            if (chartPlatform) chartPlatform.destroy();
            const ps = data.platformStats;
            chartPlatform = new Chart(platCtx, {
                type: 'doughnut',
                data: {
                    labels: ['YouTube', 'TikTok', 'Facebook'],
                    datasets: [{
                        data: [ps.youtube.views, ps.tiktok.views, ps.facebook.views],
                        backgroundColor: ['#ef4444', '#00f2ea', '#1877f2'],
                        borderColor: ['#dc2626', '#00d4cc', '#1564c0'],
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: '#9ca3af', font: { size: 11 }, padding: 12 } },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => {
                                    const platform = ctx.label.toLowerCase();
                                    const s = ps[platform] || {};
                                    return `${ctx.label}: ${(s.views || 0).toLocaleString()} views, ${(s.likes || 0).toLocaleString()} likes`;
                                }
                            }
                        }
                    }
                }
            });
        }
    } catch (e) { console.error('Analytics error:', e); } finally { _analyticsLoading = false; }
}

// ============ EXPORT / IMPORT ROADMAPS ============
function exportRoadmap(roadmapId, format) {
    const url = `/api/roadmaps/${roadmapId}/export?format=${format}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    // Need auth header for the request
    fetch(url, { headers: { 'Authorization': 'Bearer ' + getAuthToken() } })
        .then(r => r.blob())
        .then(blob => {
            const blobUrl = URL.createObjectURL(blob);
            a.href = blobUrl;
            a.download = `roadmap.${format}`;
            a.click();
            URL.revokeObjectURL(blobUrl);
            showToast(`📥 Đã tải roadmap (${format.toUpperCase()})`);
        })
        .catch(e => showToast('❌ Lỗi export: ' + e.message));
}

function importRoadmap() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const res = await fetch('/api/roadmaps/import', {
                method: 'POST',
                headers: getApiHeaders(),
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error);
            showToast('✅ Import roadmap thành công!');
            loadMyChannels();
        } catch (err) {
            showToast('❌ Lỗi import: ' + err.message);
        }
    };
    input.click();
}

// ============ CHANNEL → ROADMAP → AUTO-FILL ============
let _generatorRoadmaps = [];

async function loadChannelsForGenerator() {
    const sel = document.getElementById('channelForGenerate');
    if (!sel) return;
    try {
        const res = await fetch('/api/channels', { headers: { 'Authorization': 'Bearer ' + getAuthToken() } });
        if (!res.ok) return;
        const channels = await res.json();
        // Keep existing selected value
        const prev = sel.value;
        sel.innerHTML = '<option value="">-- Không chọn kênh --</option>' +
            channels.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        if (prev) sel.value = prev;
    } catch (e) { console.error('Channel load error:', e); }
}

async function onChannelForGenerateChange() {
    const channelId = document.getElementById('channelForGenerate')?.value;
    const taskSel = document.getElementById('roadmapTaskSelect');
    if (!taskSel) return;

    if (!channelId) {
        taskSel.disabled = true;
        taskSel.innerHTML = '<option value="">-- Chọn kênh trước --</option>';
        _generatorRoadmaps = [];
        return;
    }

    try {
        const res = await fetch(`/api/channels/${channelId}/roadmaps`, {
            headers: { 'Authorization': 'Bearer ' + getAuthToken() }
        });
        if (!res.ok) throw new Error('Failed');
        const roadmaps = await res.json();
        _generatorRoadmaps = roadmaps;

        // Find today's date
        const today = new Date().toISOString().substring(0, 10);

        // Collect all pending videos across all roadmaps, prioritizing today
        let tasks = [];
        roadmaps.forEach(rm => {
            rm.days?.forEach(d => {
                d.videos?.forEach((v, vi) => {
                    if (v.status !== 'published') {
                        tasks.push({
                            rmName: rm.roadmap_name,
                            rmId: rm.id,
                            day: d.day,
                            date: d.date || '',
                            slot: vi,
                            title: v.title || `Video ${d.day}`,
                            idea: v.idea || '',
                            isToday: d.date === today,
                            theme: d.theme || ''
                        });
                    }
                });
            });
        });

        // Sort: today first, then by day number, then by slot
        tasks.sort((a, b) => (b.isToday - a.isToday) || (a.day - b.day) || (a.slot - b.slot));

        if (!tasks.length) {
            taskSel.disabled = true;
            taskSel.innerHTML = '<option value="">✅ Tất cả video đã hoàn thành!</option>';
            return;
        }

        // Count today's tasks
        const todayTasks = tasks.filter(t => t.isToday);
        const todayCount = todayTasks.length;

        taskSel.disabled = false;
        const placeholder = todayCount > 0
            ? `-- 🔴 Hôm nay có ${todayCount} video cần tạo --`
            : '-- Chọn video cần tạo --';

        taskSel.innerHTML = `<option value="">${placeholder}</option>` +
            tasks.map((t, i) => {
                let badge;
                if (t.isToday) {
                    const todayIdx = todayTasks.indexOf(t) + 1;
                    badge = `🔴 HÔM NAY #${todayIdx}/${todayCount}`;
                } else {
                    badge = `📅 Ngày ${t.day}`;
                }
                return `<option value="${i}" data-idx="${i}">${badge} — ${t.title}</option>`;
            }).join('');

        // Store tasks for later use
        window._generatorTasks = tasks;

        // Don't auto-select — let user choose which task to work on
    } catch (e) {
        console.error('Roadmap load error:', e);
        taskSel.disabled = true;
        taskSel.innerHTML = '<option value="">Lỗi tải roadmap</option>';
    }
}

function onRoadmapTaskSelect() {
    const idx = document.getElementById('roadmapTaskSelect')?.value;
    if (idx === '' || idx === null) return;
    const task = window._generatorTasks?.[parseInt(idx)];
    if (!task) return;

    // Build description from roadmap task
    let desc = `🎬 ${task.title}`;
    if (task.idea) desc += `\n📋\n💡 ${task.idea}`;

    document.getElementById('textDescription').value = desc;
    showToast(`📋 Đã tải "${task.title}" từ roadmap`);
}

// Add export buttons to roadmap header
function getExportButtons(roadmapId) {
    return `
        <button class="btn-ghost btn-sm" onclick="exportRoadmap('${roadmapId}','csv')" title="Export CSV">📥 CSV</button>
        <button class="btn-ghost btn-sm" onclick="exportRoadmap('${roadmapId}','json')" title="Export JSON">📥 JSON</button>
        <button class="btn-ghost btn-sm" onclick="importRoadmap()" title="Import Roadmap">📤 Import</button>
    `;
}

// ============ PROFILE TAB ============
async function loadProfile() {
    try {
        // Load user info
        const res = await fetch('/api/profile', { headers: { 'Authorization': 'Bearer ' + getAuthToken() } });
        if (!res.ok) return;
        const user = await res.json();

        const avatar = document.getElementById('profileAvatar');
        if (avatar) avatar.textContent = (user.name || user.username || '?').charAt(0).toUpperCase();
        const nameEl = document.getElementById('profileName');
        if (nameEl) nameEl.textContent = user.name || user.username;
        const roleEl = document.getElementById('profileRole');
        if (roleEl) roleEl.textContent = `@${user.username} • ${user.role}`;
        const fullNameInput = document.getElementById('profileFullName');
        if (fullNameInput) fullNameInput.value = user.name || '';

        // Load API key
        const apiKeyInput = document.getElementById('profileApiKey');
        if (apiKeyInput) apiKeyInput.value = getStoredApiKey() || '';

        // Load channels
        const chRes = await fetch('/api/channels', { headers: { 'Authorization': 'Bearer ' + getAuthToken() } });
        if (chRes.ok) {
            const channels = await chRes.json();
            const chList = document.getElementById('profileChannelList');
            if (chList) {
                if (!channels.length) {
                    chList.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem">Chưa có kênh nào. Tạo kênh ở tab "Kênh Của Tôi".</p>';
                } else {
                    chList.innerHTML = channels.map(c => `
                        <div class="dna-card" style="padding:12px;cursor:pointer;transition:all 0.2s" onclick="switchTab('channels');setTimeout(()=>viewChannelDetail('${c.id}'),300)" 
                            onmouseover="this.style.borderColor='rgba(139,92,246,0.5)'" onmouseout="this.style.borderColor='var(--border)'">
                            <div style="display:flex;justify-content:space-between;align-items:center">
                                <div>
                                    <strong>📺 ${c.name}</strong>
                                    <span style="color:var(--text-secondary);font-size:0.8rem;margin-left:8px">${c.category || ''} • ${c.country || ''}</span>
                                </div>
                                <span style="color:var(--text-secondary);font-size:0.75rem">${c.frequency || '1 video/ngày'}</span>
                            </div>
                        </div>`).join('');
                }
            }
        }

        // Load history into profile
        const hRes = await fetch('/api/history', { headers: { 'Authorization': 'Bearer ' + getAuthToken() } });
        if (hRes.ok) {
            const historyItems = await hRes.json();
            const hList = document.getElementById('profileHistoryList');
            if (hList) {
                if (!historyItems.length) {
                    hList.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem">Chưa có lịch sử tạo video</p>';
                } else {
                    // Store for plan viewing
                    window._historyItems = historyItems;
                    hList.innerHTML = historyItems.map((h, idx) => `
                        <div class="dna-card" style="padding:10px;margin-bottom:6px;cursor:pointer;transition:all 0.2s" onclick="viewHistoryPlan(${idx})" 
                            onmouseover="this.style.borderColor='rgba(139,92,246,0.5)'" onmouseout="this.style.borderColor='var(--border)'">
                            <div style="display:flex;justify-content:space-between;align-items:center">
                                <div style="flex:1;min-width:0">
                                    <div style="font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${h.projectName || h.description || 'Video'}</div>
                                    <div style="font-size:0.7rem;color:var(--text-secondary);margin-top:2px">
                                        ${h.channelName ? '📺 ' + h.channelName + ' • ' : ''}${h.roadmapTask ? '📋 ' + h.roadmapTask.title + ' • ' : ''}${h.clipCount || 0} clips • ${h.duration || 0}s
                                    </div>
                                    <div style="font-size:0.65rem;color:var(--text-secondary);margin-top:1px">
                                        ${h.presetName ? '📂 ' + h.presetName + ' • ' : ''}${h.templateStyle ? '🎨 ' + h.templateStyle + ' • ' : ''}${h.langFormat || 'VN'}${h.username ? ' • 👤 ' + h.username : ''}
                                    </div>
                                </div>
                                <div style="display:flex;align-items:center;gap:8px">
                                    <span style="font-size:0.65rem;color:var(--text-secondary)">${new Date(h.createdAt).toLocaleDateString('vi-VN')}</span>
                                    <button class="btn-ghost btn-sm" onclick="event.stopPropagation();deleteHistoryItem('${h.id}')" title="Xóa">🗑️</button>
                                </div>
                            </div>
                        </div>`).join('');
                }
            }
        }
    } catch (e) { console.error('Profile load error:', e); }
}

async function updateProfile() {
    const name = document.getElementById('profileFullName')?.value;
    try {
        const res = await fetch('/api/profile', {
            method: 'PUT', headers: getApiHeaders(),
            body: JSON.stringify({ name })
        });
        if (!res.ok) throw new Error((await res.json()).error);
        showToast('✅ Đã cập nhật thông tin!');
        loadProfile();
    } catch (e) { showToast('❌ Lỗi: ' + e.message); }
}

async function changePassword() {
    const pw = document.getElementById('profileNewPassword')?.value;
    if (!pw || pw.length < 4) return showToast('⚠️ Mật khẩu tối thiểu 4 ký tự');
    try {
        const res = await fetch('/api/profile/password', {
            method: 'PUT', headers: getApiHeaders(),
            body: JSON.stringify({ newPassword: pw })
        });
        if (!res.ok) throw new Error((await res.json()).error);
        document.getElementById('profileNewPassword').value = '';
        showToast('✅ Đã đổi mật khẩu!');
    } catch (e) { showToast('❌ Lỗi: ' + e.message); }
}

function saveProfileApiKey() {
    const key = document.getElementById('profileApiKey')?.value;
    if (key) {
        localStorage.setItem('gemini_api_key', key);
        configureApiKey(key);
        showToast('✅ Đã lưu API Key!');
    }
}

function viewHistoryPlan(idx) {
    const h = window._historyItems?.[idx];
    if (!h) return;
    if (h.plan) {
        // Switch to text tab and render the saved plan
        switchTab('text');
        currentPlan = h.plan;
        renderPlan(currentPlan, 'textResults');
        document.getElementById('textDescription').value = h.description || '';
        showToast(`📜 Đã tải lại kế hoạch: ${h.projectName || 'Video'}`);
    } else {
        // No plan saved, just fill description
        switchTab('text');
        document.getElementById('textDescription').value = h.description || '';
        showToast(`📋 Đã tải mô tả — cần tạo lại kế hoạch`);
    }
}

// ============ USER ANALYTICS CHARTS ============
let userChartDaily = null, userChartPlatform = null;

async function renderUserCharts() {
    if (typeof Chart === 'undefined') return;
    try {
        const res = await fetch('/api/user/analytics', { headers: { 'Authorization': 'Bearer ' + getAuthToken() } });
        if (!res.ok) return;
        const data = await res.json();

        // Stats cards
        const statsEl = document.getElementById('userStats');
        if (statsEl) {
            statsEl.innerHTML = `
                <div class="dna-card" style="text-align:center;padding:12px">
                    <div style="font-size:1.5rem;font-weight:800;color:var(--accent-purple)">${data.channelCount}</div>
                    <div style="font-size:0.75rem;color:var(--text-secondary)">Kênh</div>
                </div>
                <div class="dna-card" style="text-align:center;padding:12px">
                    <div style="font-size:1.5rem;font-weight:800;color:#10b981">${data.totalPublished}</div>
                    <div style="font-size:0.75rem;color:var(--text-secondary)">Đã đăng</div>
                </div>
                <div class="dna-card" style="text-align:center;padding:12px">
                    <div style="font-size:1.5rem;font-weight:800;color:#f59e0b">${data.totalPending}</div>
                    <div style="font-size:0.75rem;color:var(--text-secondary)">Chờ đăng</div>
                </div>`;
        }

        // Daily chart
        const dailyCtx = document.getElementById('userChartDaily');
        if (dailyCtx && data.dailyStats?.length) {
            if (userChartDaily) userChartDaily.destroy();
            userChartDaily = new Chart(dailyCtx, {
                type: 'line',
                data: {
                    labels: data.dailyStats.map(d => d.date.substring(5)),
                    datasets: [
                        { label: 'Views', data: data.dailyStats.map(d => d.views), borderColor: '#8b5cf6', tension: 0.3, fill: true, backgroundColor: 'rgba(139,92,246,0.1)' },
                        { label: 'Likes', data: data.dailyStats.map(d => d.likes), borderColor: '#10b981', tension: 0.3, fill: false }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#94a3b8', font: { size: 10 } } } }, scales: { x: { ticks: { color: '#64748b', font: { size: 9 } } }, y: { ticks: { color: '#64748b', font: { size: 9 } } } } }
            });
        }

        // Platform chart
        const platCtx = document.getElementById('userChartPlatform');
        if (platCtx) {
            const ps = data.platformStats;
            if (userChartPlatform) userChartPlatform.destroy();
            userChartPlatform = new Chart(platCtx, {
                type: 'doughnut',
                data: {
                    labels: ['YouTube', 'TikTok', 'Facebook'],
                    datasets: [{ data: [ps.youtube.views, ps.tiktok.views, ps.facebook.views], backgroundColor: ['#ef4444', '#000000', '#3b82f6'] }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 } } } } }
            });
        }
    } catch (e) { console.error('User charts error:', e); }
}

async function scanMyChannels() {
    showToast('🔄 Đang quét metrics kênh của bạn...');
    try {
        const res = await fetch('/api/user/scan-channels', {
            method: 'POST',
            headers: getApiHeaders()
        });
        const data = await res.json();
        if (data.success) {
            showToast(`✅ Quét xong! ${data.scanned} video, ${data.errors} lỗi`);
            renderUserCharts(); // Refresh charts
        } else {
            showToast('❌ ' + (data.error || 'Lỗi quét'));
        }
    } catch (e) { showToast('❌ Lỗi: ' + e.message); }
}

// ============ FLOATING AI CHATBOT (Multi-conversation) ============
let _currentConvId = null;
let _chatConvs = [];

function initChatbot() {
    const btn = document.createElement('div');
    btn.id = 'chatbotToggle';
    btn.innerHTML = '🤖';
    btn.style.cssText = 'position:fixed;bottom:24px;right:24px;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#8b5cf6,#3b82f6);display:flex;align-items:center;justify-content:center;font-size:1.5rem;cursor:pointer;box-shadow:0 4px 20px rgba(139,92,246,0.4);z-index:9999;transition:all 0.3s';
    btn.onmouseover = () => btn.style.transform = 'scale(1.1)';
    btn.onmouseout = () => btn.style.transform = 'scale(1)';
    btn.onclick = toggleChatbot;
    document.body.appendChild(btn);

    const panel = document.createElement('div');
    panel.id = 'chatbotPanel';
    panel.style.cssText = 'position:fixed;bottom:86px;right:24px;width:420px;height:540px;background:var(--card-bg);border:1px solid var(--border);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:9998;display:none;flex-direction:column;overflow:hidden';
    panel.innerHTML = `
        <div style="padding:12px 16px;background:linear-gradient(135deg,#8b5cf6,#3b82f6);display:flex;justify-content:space-between;align-items:center">
            <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:1.1rem">🤖</span>
                <div>
                    <div style="font-weight:700;color:white;font-size:0.85rem">AI Content Advisor</div>
                    <div style="font-size:0.65rem;color:rgba(255,255,255,0.7)" id="chatConvTitle">New Chat</div>
                </div>
            </div>
            <div style="display:flex;gap:6px">
                <button onclick="toggleChatSidebar()" style="background:rgba(255,255,255,0.2);border:none;color:white;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:0.75rem" title="Conversations">💬</button>
                <button onclick="newChatConversation()" style="background:rgba(255,255,255,0.2);border:none;color:white;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:0.75rem" title="New Chat">➕</button>
                <button onclick="toggleChatbot()" style="background:none;border:none;color:white;font-size:1rem;cursor:pointer">✕</button>
            </div>
        </div>
        <div style="flex:1;display:flex;overflow:hidden;position:relative">
            <!-- Sidebar -->
            <div id="chatSidebar" style="display:none;width:180px;border-right:1px solid var(--border);overflow-y:auto;background:rgba(0,0,0,0.15);flex-shrink:0">
                <div style="padding:8px">
                    <button onclick="newChatConversation()" style="width:100%;padding:8px;background:linear-gradient(135deg,#8b5cf6,#3b82f6);color:white;border:none;border-radius:8px;cursor:pointer;font-size:0.78rem;font-weight:600">➕ New Chat</button>
                </div>
                <div id="chatConvList" style="padding:0 6px 6px"></div>
            </div>
            <!-- Messages -->
            <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
                <div id="chatMessages" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px">
                    <div style="text-align:center;padding:40px 16px;color:var(--text-secondary)">
                        <div style="font-size:2rem;margin-bottom:8px">🤖</div>
                        <div style="font-size:0.85rem;font-weight:600">AI Content Advisor</div>
                        <div style="font-size:0.75rem;margin-top:4px">Hỏi bất kỳ điều gì về content video!</div>
                        <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:12px">
                            <button onclick="quickChat('Gợi ý 10 ý tưởng video viral cho kênh của tôi')" style="padding:6px 10px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:8px;color:#a78bfa;cursor:pointer;font-size:0.72rem">💡 Ý tưởng viral</button>
                            <button onclick="quickChat('Phân tích trend TikTok tuần này')" style="padding:6px 10px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:8px;color:#a78bfa;cursor:pointer;font-size:0.72rem">📊 Trend TikTok</button>
                            <button onclick="quickChat('Viết script video 60s cho kênh food')" style="padding:6px 10px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:8px;color:#a78bfa;cursor:pointer;font-size:0.72rem">📝 Viết script</button>
                            <button onclick="quickChat('SEO tips cho YouTube Shorts')" style="padding:6px 10px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:8px;color:#a78bfa;cursor:pointer;font-size:0.72rem">🔍 SEO tips</button>
                        </div>
                    </div>
                </div>
                <div style="padding:10px 12px;border-top:1px solid var(--border);display:flex;gap:8px">
                    <input type="text" id="chatInput" placeholder="Hỏi gì đó..." style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg-dark);color:var(--text-primary);font-size:0.85rem;font-family:var(--font-sans)" onkeypress="if(event.key==='Enter')sendChat()">
                    <button onclick="sendChat()" style="padding:8px 14px;background:linear-gradient(135deg,#8b5cf6,#3b82f6);color:white;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem">Gửi</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(panel);
    loadChatConversations();
}

function toggleChatbot() {
    const panel = document.getElementById('chatbotPanel');
    if (!panel) return;
    const visible = panel.style.display === 'flex';
    panel.style.display = visible ? 'none' : 'flex';
    if (!visible) document.getElementById('chatInput')?.focus();
}

function toggleChatSidebar() {
    const sb = document.getElementById('chatSidebar');
    if (!sb) return;
    sb.style.display = sb.style.display === 'none' ? 'block' : 'none';
}

async function loadChatConversations() {
    try {
        const res = await fetch('/api/chat/conversations', { headers: { 'Authorization': 'Bearer ' + getAuthToken() } });
        if (!res.ok) return;
        _chatConvs = await res.json();
        renderConvList();
    } catch (e) { /* ignore */ }
}

function renderConvList() {
    const list = document.getElementById('chatConvList');
    if (!list) return;
    if (!_chatConvs.length) {
        list.innerHTML = '<p style="color:var(--text-secondary);font-size:0.72rem;padding:8px;text-align:center">Chưa có cuộc hội thoại</p>';
        return;
    }
    list.innerHTML = _chatConvs.map(c => `
        <div onclick="loadConversation('${c.id}')" style="padding:8px 10px;margin-bottom:4px;border-radius:8px;cursor:pointer;font-size:0.75rem;background:${c.id === _currentConvId ? 'rgba(139,92,246,0.2)' : 'transparent'};border:1px solid ${c.id === _currentConvId ? 'rgba(139,92,246,0.4)' : 'transparent'};transition:all 0.2s" onmouseover="this.style.background='rgba(139,92,246,0.1)'" onmouseout="this.style.background='${c.id === _currentConvId ? 'rgba(139,92,246,0.2)' : 'transparent'}'">
            <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-primary)">${c.title || 'New Chat'}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
                <span style="font-size:0.65rem;color:var(--text-secondary)">${c.messageCount} tin</span>
                <button onclick="event.stopPropagation();deleteConversation('${c.id}')" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:0.65rem;opacity:0.5;padding:0" onmouseover="this.style.opacity='1';this.style.color='#ef4444'" onmouseout="this.style.opacity='0.5';this.style.color='var(--text-secondary)'" title="Xóa">🗑</button>
            </div>
        </div>
    `).join('');
}

async function loadConversation(convId) {
    _currentConvId = convId;
    renderConvList();
    try {
        const res = await fetch(`/api/chat/conversations/${convId}`, { headers: { 'Authorization': 'Bearer ' + getAuthToken() } });
        if (!res.ok) return;
        const conv = await res.json();
        document.getElementById('chatConvTitle').textContent = conv.title || 'Chat';
        const container = document.getElementById('chatMessages');
        if (!container) return;
        container.innerHTML = '';
        conv.messages.forEach(m => appendChatMessage(m.role === 'user' ? 'user' : 'ai', m.content));
        if (!conv.messages.length) showChatWelcome();
    } catch (e) { console.error('Load conv error:', e); }
}

async function newChatConversation() {
    try {
        const res = await fetch('/api/chat/conversations', {
            method: 'POST', headers: getApiHeaders(),
            body: JSON.stringify({ title: 'New Chat' })
        });
        const conv = await res.json();
        _currentConvId = conv.id;
        _chatConvs.unshift({ id: conv.id, title: conv.title, messageCount: 0 });
        renderConvList();
        document.getElementById('chatConvTitle').textContent = 'New Chat';
        showChatWelcome();
        document.getElementById('chatInput')?.focus();
    } catch (e) { showToast('❌ Lỗi tạo chat'); }
}

async function deleteConversation(convId) {
    try {
        await fetch(`/api/chat/conversations/${convId}`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + getAuthToken() } });
        _chatConvs = _chatConvs.filter(c => c.id !== convId);
        if (_currentConvId === convId) { _currentConvId = null; showChatWelcome(); }
        renderConvList();
    } catch (e) { /* ignore */ }
}

function showChatWelcome() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.innerHTML = `
        <div style="text-align:center;padding:40px 16px;color:var(--text-secondary)">
            <div style="font-size:2rem;margin-bottom:8px">🤖</div>
            <div style="font-size:0.85rem;font-weight:600">AI Content Advisor</div>
            <div style="font-size:0.75rem;margin-top:4px">Hỏi bất kỳ điều gì về content video!</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:12px">
                <button onclick="quickChat('Gợi ý 10 ý tưởng video viral')" style="padding:6px 10px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:8px;color:#a78bfa;cursor:pointer;font-size:0.72rem">💡 Ý tưởng viral</button>
                <button onclick="quickChat('Phân tích trend TikTok')" style="padding:6px 10px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:8px;color:#a78bfa;cursor:pointer;font-size:0.72rem">📊 Trend</button>
                <button onclick="quickChat('Viết script video 60s')" style="padding:6px 10px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:8px;color:#a78bfa;cursor:pointer;font-size:0.72rem">📝 Script</button>
                <button onclick="quickChat('SEO tips cho Shorts')" style="padding:6px 10px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:8px;color:#a78bfa;cursor:pointer;font-size:0.72rem">🔍 SEO</button>
            </div>
        </div>`;
}

function quickChat(msg) {
    document.getElementById('chatInput').value = msg;
    sendChat();
}

async function sendChat() {
    const input = document.getElementById('chatInput');
    const msg = input?.value?.trim();
    if (!msg) return;
    input.value = '';

    // Clear welcome screen on first message
    const container = document.getElementById('chatMessages');
    if (container && !_currentConvId) container.innerHTML = '';

    appendChatMessage('user', msg);

    const typing = document.createElement('div');
    typing.id = 'chatTyping';
    typing.style.cssText = 'background:rgba(139,92,246,0.15);padding:10px 12px;border-radius:12px;border-top-left-radius:4px;font-size:0.82rem;max-width:85%;color:var(--text-secondary)';
    typing.textContent = '⏳ Đang suy nghĩ...';
    container?.appendChild(typing);
    scrollChatToBottom();

    try {
        const res = await fetch('/api/chat', {
            method: 'POST', headers: getApiHeaders(),
            body: JSON.stringify({ message: msg, convId: _currentConvId || undefined })
        });
        const data = await res.json();
        typing.remove();
        if (data.reply) {
            appendChatMessage('ai', data.reply);
            // Update conversation tracking
            if (data.convId && !_currentConvId) {
                _currentConvId = data.convId;
                _chatConvs.unshift({ id: data.convId, title: data.convTitle, messageCount: 2 });
                renderConvList();
            }
            if (data.convTitle) document.getElementById('chatConvTitle').textContent = data.convTitle;
        } else {
            appendChatMessage('ai', '❌ ' + (data.error || 'Lỗi'));
        }
    } catch (e) {
        typing.remove();
        appendChatMessage('ai', '❌ Lỗi kết nối');
    }
}

function appendChatMessage(role, content) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const div = document.createElement('div');
    if (role === 'user') {
        div.style.cssText = 'background:linear-gradient(135deg,#8b5cf6,#3b82f6);padding:10px 12px;border-radius:12px;border-top-right-radius:4px;font-size:0.82rem;max-width:85%;align-self:flex-end;color:white;word-break:break-word';
        div.innerHTML = content.replace(/\n/g, '<br>');
    } else {
        div.style.cssText = 'background:rgba(139,92,246,0.12);padding:10px 12px;border-radius:12px;border-top-left-radius:4px;font-size:0.82rem;max-width:88%;color:var(--text-primary);word-break:break-word;line-height:1.5';
        // Better markdown rendering
        let html = content
            .replace(/```([\s\S]*?)```/g, '<pre style="background:rgba(0,0,0,0.3);padding:8px;border-radius:6px;overflow-x:auto;font-size:0.75rem;margin:4px 0">$1</pre>')
            .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.3);padding:1px 4px;border-radius:3px;font-size:0.78rem">$1</code>')
            .replace(/### (.*)/g, '<div style="font-weight:700;font-size:0.88rem;margin:6px 0 2px">$1</div>')
            .replace(/## (.*)/g, '<div style="font-weight:700;font-size:0.92rem;margin:8px 0 3px">$1</div>')
            .replace(/# (.*)/g, '<div style="font-weight:800;font-size:0.95rem;margin:8px 0 4px">$1</div>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/^\d+\.\s/gm, (m) => `<span style="color:#8b5cf6;font-weight:600">${m}</span>`)
            .replace(/^[-•]\s/gm, '<span style="color:#8b5cf6">• </span>')
            .replace(/\n/g, '<br>');
        div.innerHTML = html;
    }
    container.appendChild(div);
    scrollChatToBottom();
}

function scrollChatToBottom() {
    const c = document.getElementById('chatMessages');
    if (c) setTimeout(() => c.scrollTop = c.scrollHeight, 50);
}

document.addEventListener('DOMContentLoaded', () => { setTimeout(initChatbot, 500); });
