/* ============================================
 * 光影相册 · Photo Album Manager
 * Pure Frontend · IndexedDB Storage
 * ============================================ */

(() => {
    'use strict';

    // ============ State ============
    const state = {
        photos: [],
        tags: [],
        filter: 'all',         // 'all' | 'recent' | 'favorites' | tagId
        tagFilter: null,       // currently selected tag from sidebar
        searchQuery: '',
        view: 'grid',          // 'grid' | 'masonry'
        selectedTagColor: '#6366f1',
        editingPhoto: null,
        uploadQueue: [],
        currentLightboxIndex: -1,
    };

    // ============ IndexedDB ============
    const DB_NAME = 'photoAlbumDB';
    const DB_VERSION = 1;
    let db = null;

    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('photos')) {
                    const photoStore = db.createObjectStore('photos', { keyPath: 'id' });
                    photoStore.createIndex('createdAt', 'createdAt', { unique: false });
                    photoStore.createIndex('date', 'date', { unique: false });
                }
                if (!db.objectStoreNames.contains('tags')) {
                    db.createObjectStore('tags', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('meta')) {
                    db.createObjectStore('meta', { keyPath: 'key' });
                }
            };
            request.onsuccess = (e) => { db = e.target.result; resolve(db); };
            request.onerror = (e) => reject(e.target.error);
        });
    }

    function dbAction(storeName, mode, operation) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            const request = operation(store);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function getAllPhotos() { return dbAction('photos', 'readonly', s => s.getAll()); }
    async function getAllTags() { return dbAction('tags', 'readonly', s => s.getAll()); }
    async function putPhoto(photo) { return dbAction('photos', 'readwrite', s => s.put(photo)); }
    async function putTag(tag) { return dbAction('tags', 'readwrite', s => s.put(tag)); }
    async function deletePhoto(id) { return dbAction('photos', 'readwrite', s => s.delete(id)); }
    async function deleteTagDB(id) { return dbAction('tags', 'readwrite', s => s.delete(id)); }

    // ============ Utils ============
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
        } catch {
            return dateStr;
        }
    }

    function escapeHTML(str) {
        return String(str || '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function debounce(fn, delay) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
    }

    // ============ File Handling ============
    function readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    function compressImage(dataUrl, maxWidth = 1920, quality = 0.85) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
        });
    }

    async function processFile(file) {
        const dataUrl = await readFileAsDataURL(file);
        // Compress images larger than 2MB
        const compressed = file.size > 2 * 1024 * 1024 ? await compressImage(dataUrl) : dataUrl;
        return {
            id: uid(),
            name: file.name,
            dataUrl: compressed,
            size: compressed.length,
            date: new Date().toISOString().slice(0, 10),
            description: '',
            tags: [],
            favorite: false,
            createdAt: Date.now(),
        };
    }

    // ============ Toast ============
    function showToast(message, type = 'info', duration = 3000) {
        const container = $('#toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icons = {
            success: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
            error: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
            info: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
        };
        toast.innerHTML = `${icons[type] || icons.info}<span>${escapeHTML(message)}</span>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 200);
        }, duration);
    }

    // ============ Storage Info ============
    function updateStorageInfo() {
        const total = state.photos.reduce((sum, p) => sum + (p.size || 0), 0);
        $('#storageUsed').textContent = formatBytes(total);
        // Assume 100MB localStorage-ish practical limit for this demo indicator
        const percent = Math.min(100, (total / (100 * 1024 * 1024)) * 100);
        $('#storageBar').style.width = percent + '%';
    }

    // ============ Tags ============
    function getTagById(id) {
        return state.tags.find(t => t.id === id);
    }

    function getTagByName(name) {
        const n = name.trim().toLowerCase();
        return state.tags.find(t => t.name.toLowerCase() === n);
    }

    async function createTag(name, color) {
        name = name.trim();
        if (!name) return null;
        if (getTagByName(name)) {
            showToast('标签已存在', 'error');
            return null;
        }
        const tag = {
            id: uid(),
            name,
            color: color || state.selectedTagColor,
            createdAt: Date.now(),
        };
        await putTag(tag);
        state.tags.push(tag);
        renderTagList();
        showToast(`标签"${name}"创建成功`, 'success');
        return tag;
    }

    async function deleteTag(id) {
        const tag = getTagById(id);
        if (!tag) return;
        if (!confirm(`确定要删除标签"${tag.name}"吗？照片上的该标签也会被移除。`)) return;
        await deleteTagDB(id);
        state.tags = state.tags.filter(t => t.id !== id);
        // Remove tag from all photos
        state.photos.forEach(p => {
            p.tags = (p.tags || []).filter(tid => tid !== id);
        });
        for (const photo of state.photos) {
            await putPhoto(photo);
        }
        if (state.tagFilter === id) {
            state.tagFilter = null;
            state.filter = 'all';
        }
        renderTagList();
        renderPhotos();
        updateCounts();
        showToast('标签已删除', 'success');
    }

    function renderTagList() {
        const container = $('#tagList');
        if (state.tags.length === 0) {
            container.innerHTML = '<div class="no-tags-hint">点击 + 创建第一个标签</div>';
            return;
        }
        const tagCounts = {};
        state.photos.forEach(p => {
            (p.tags || []).forEach(tid => {
                tagCounts[tid] = (tagCounts[tid] || 0) + 1;
            });
        });
        container.innerHTML = state.tags
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(tag => `
                <button class="tag-item ${state.tagFilter === tag.id ? 'active' : ''}" data-tag-id="${tag.id}">
                    <span class="tag-dot" style="background:${tag.color}"></span>
                    <span>${escapeHTML(tag.name)}</span>
                    <span class="tag-count">${tagCounts[tag.id] || 0}</span>
                    <span class="tag-delete" data-tag-delete="${tag.id}" title="删除标签">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </span>
                </button>
            `).join('');
    }

    // ============ Photos ============
    function getFilteredPhotos() {
        let photos = [...state.photos];

        // Filter by sidebar selection
        if (state.tagFilter) {
            photos = photos.filter(p => (p.tags || []).includes(state.tagFilter));
        } else if (state.filter === 'favorites') {
            photos = photos.filter(p => p.favorite);
        } else if (state.filter === 'recent') {
            photos.sort((a, b) => b.createdAt - a.createdAt);
            photos = photos.slice(0, 50);
        }

        // Search
        const q = state.searchQuery.trim().toLowerCase();
        if (q) {
            photos = photos.filter(p => {
                if ((p.description || '').toLowerCase().includes(q)) return true;
                if ((p.name || '').toLowerCase().includes(q)) return true;
                if ((p.date || '').toLowerCase().includes(q)) return true;
                // Search by tag names
                for (const tagId of (p.tags || [])) {
                    const tag = getTagById(tagId);
                    if (tag && tag.name.toLowerCase().includes(q)) return true;
                }
                return false;
            });
        }

        // Default sort: newest first
        if (state.filter !== 'recent') {
            photos.sort((a, b) => b.createdAt - a.createdAt);
        }
        return photos;
    }

    function renderPhotos() {
        const grid = $('#photoGrid');
        const filtered = getFilteredPhotos();

        $('#emptyState').classList.toggle('show', state.photos.length === 0);
        $('#noResults').classList.toggle('show', state.photos.length > 0 && filtered.length === 0);
        grid.style.display = (filtered.length === 0) ? 'none' : '';

        grid.className = 'photo-grid' + (state.view === 'masonry' ? ' masonry' : '');

        grid.innerHTML = filtered.map((photo, idx) => {
            const tags = (photo.tags || []).map(tid => getTagById(tid)).filter(Boolean);
            return `
                <div class="photo-card" data-photo-id="${photo.id}" data-index="${idx}">
                    <img src="${photo.dataUrl}" alt="${escapeHTML(photo.name)}" loading="lazy">
                    <div class="photo-overlay">
                        ${tags.length ? `<div class="photo-tags">${tags.slice(0, 3).map(t =>
                            `<span class="photo-tag-pill" style="background:${t.color}40;color:#fff;border:1px solid ${t.color}60">${escapeHTML(t.name)}</span>`
                        ).join('')}${tags.length > 3 ? `<span class="photo-tag-pill">+${tags.length - 3}</span>` : ''}</div>` : ''}
                        ${photo.description ? `<div class="photo-description">${escapeHTML(photo.description)}</div>` : ''}
                        <div class="photo-date">${formatDate(photo.date)}</div>
                    </div>
                    <div class="photo-actions">
                        <button class="photo-action-btn ${photo.favorite ? 'active' : ''}" data-action="favorite" title="收藏">
                            <svg viewBox="0 0 24 24" fill="${photo.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                            </svg>
                        </button>
                        <button class="photo-action-btn" data-action="edit" title="编辑">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function updateCounts() {
        $('#countAll').textContent = state.photos.length;
        $('#countFav').textContent = state.photos.filter(p => p.favorite).length;
    }

    function renderActiveFilters() {
        const container = $('#activeFilters');
        const chips = [];
        if (state.searchQuery) {
            chips.push({ type: 'search', label: `搜索: "${state.searchQuery}"` });
        }
        if (state.tagFilter) {
            const tag = getTagById(state.tagFilter);
            if (tag) chips.push({ type: 'tag', label: `标签: ${tag.name}`, color: tag.color });
        } else if (state.filter === 'favorites') {
            chips.push({ type: 'filter', label: '收藏' });
        } else if (state.filter === 'recent') {
            chips.push({ type: 'filter', label: '最近添加' });
        }
        container.innerHTML = chips.map((chip, i) => `
            <span class="filter-chip">
                ${chip.color ? `<span style="width:8px;height:8px;border-radius:50%;background:${chip.color}"></span>` : ''}
                ${escapeHTML(chip.label)}
                <span class="remove" data-remove-filter="${i}">✕</span>
            </span>
        `).join('');
    }

    // ============ Modals ============
    function openModal(id) {
        $(`#${id}`).classList.add('show');
    }
    function closeModal(id) {
        $(`#${id}`).classList.remove('show');
    }

    // ============ Upload ============
    async function addFilesToQueue(files) {
        const fileArray = Array.from(files).filter(f => f.type.startsWith('image/'));
        if (fileArray.length === 0) {
            showToast('请选择图片文件', 'error');
            return;
        }
        for (const file of fileArray) {
            try {
                const photo = await processFile(file);
                state.uploadQueue.push(photo);
            } catch (err) {
                console.error(err);
                showToast(`处理 ${file.name} 失败`, 'error');
            }
        }
        renderUploadPreview();
    }

    function renderUploadPreview() {
        const list = $('#uploadPreviewList');
        list.innerHTML = state.uploadQueue.map((p, idx) => `
            <div class="upload-preview-item">
                <img src="${p.dataUrl}" alt="">
                <button class="upload-preview-remove" data-remove-upload="${idx}">×</button>
                <div class="upload-preview-name">${escapeHTML(p.name)}</div>
            </div>
        `).join('');
        $('#uploadCount').textContent = state.uploadQueue.length;
        $('#confirmUploadBtn').disabled = state.uploadQueue.length === 0;
    }

    async function confirmUpload() {
        if (state.uploadQueue.length === 0) return;
        for (const photo of state.uploadQueue) {
            await putPhoto(photo);
            state.photos.push(photo);
        }
        const count = state.uploadQueue.length;
        state.uploadQueue = [];
        closeModal('uploadModal');
        renderUploadPreview();
        renderPhotos();
        updateCounts();
        updateStorageInfo();
        showToast(`成功上传 ${count} 张照片`, 'success');
    }

    // ============ Edit ============
    function openEditModal(photoId) {
        const photo = state.photos.find(p => p.id === photoId);
        if (!photo) return;
        state.editingPhoto = photo;
        $('#editPreviewImg').src = photo.dataUrl;
        $('#editDate').value = photo.date || '';
        $('#editDescription').value = photo.description || '';
        $('#editFilename').textContent = photo.name;
        renderEditTags();
        renderTagSuggestions('');
        $('#editTagInput').value = '';
        openModal('editModal');
    }

    function renderEditTags() {
        const container = $('#editTags');
        const photo = state.editingPhoto;
        if (!photo) return;
        container.innerHTML = (photo.tags || []).map(tid => {
            const tag = getTagById(tid);
            if (!tag) return '';
            return `
                <span class="tag-chip">
                    <span class="tag-chip-dot" style="background:${tag.color}"></span>
                    ${escapeHTML(tag.name)}
                    <button class="tag-chip-remove" data-remove-edit-tag="${tag.id}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </span>
            `;
        }).join('');
    }

    function renderTagSuggestions(query) {
        const container = $('#tagSuggestions');
        const photo = state.editingPhoto;
        if (!photo) return;
        const available = state.tags.filter(t =>
            !(photo.tags || []).includes(t.id) &&
            (!query || t.name.toLowerCase().includes(query.toLowerCase()))
        ).slice(0, 8);
        container.innerHTML = available.length ? available.map(t => `
            <span class="tag-suggestion" data-add-suggest-tag="${t.id}">
                <span class="tag-suggestion-dot" style="background:${t.color}"></span>
                ${escapeHTML(t.name)}
            </span>
        `).join('') : '';
    }

    function addTagToEditing(tagId) {
        const photo = state.editingPhoto;
        if (!photo) return;
        photo.tags = photo.tags || [];
        if (!photo.tags.includes(tagId)) {
            photo.tags.push(tagId);
            renderEditTags();
            renderTagSuggestions($('#editTagInput').value);
        }
    }

    function removeTagFromEditing(tagId) {
        const photo = state.editingPhoto;
        if (!photo) return;
        photo.tags = (photo.tags || []).filter(id => id !== tagId);
        renderEditTags();
        renderTagSuggestions($('#editTagInput').value);
    }

    async function savePhotoEdit() {
        const photo = state.editingPhoto;
        if (!photo) return;
        photo.date = $('#editDate').value;
        photo.description = $('#editDescription').value.trim();
        await putPhoto(photo);
        closeModal('editModal');
        renderPhotos();
        renderTagList();
        updateCounts();
        showToast('保存成功', 'success');
    }

    async function deleteEditingPhoto() {
        const photo = state.editingPhoto;
        if (!photo) return;
        if (!confirm(`确定要删除照片"${photo.name}"吗？此操作无法撤销。`)) return;
        await deletePhoto(photo.id);
        state.photos = state.photos.filter(p => p.id !== photo.id);
        closeModal('editModal');
        renderPhotos();
        renderTagList();
        updateCounts();
        updateStorageInfo();
        showToast('照片已删除', 'success');
    }

    async function toggleFavorite(photoId) {
        const photo = state.photos.find(p => p.id === photoId);
        if (!photo) return;
        photo.favorite = !photo.favorite;
        await putPhoto(photo);
        renderPhotos();
        updateCounts();
        showToast(photo.favorite ? '已添加到收藏' : '已取消收藏', 'success', 1500);
    }

    // ============ Lightbox ============
    function openLightbox(idx) {
        const filtered = getFilteredPhotos();
        if (filtered.length === 0) return;
        state.currentLightboxIndex = idx;
        updateLightbox();
        $('#lightbox').classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        $('#lightbox').classList.remove('show');
        document.body.style.overflow = '';
    }

    function updateLightbox() {
        const filtered = getFilteredPhotos();
        const idx = state.currentLightboxIndex;
        if (idx < 0 || idx >= filtered.length) return;
        const photo = filtered[idx];
        $('#lightboxImg').src = photo.dataUrl;

        const tags = (photo.tags || []).map(tid => getTagById(tid)).filter(Boolean);
        $('#lightboxTags').innerHTML = tags.length
            ? tags.map(t => `
                <span class="lightbox-tag">
                    <span style="width:6px;height:6px;border-radius:50%;background:${t.color}"></span>
                    ${escapeHTML(t.name)}
                </span>
            `).join('')
            : '<span style="color:rgba(255,255,255,0.4);font-size:12px">无标签</span>';

        $('#lightboxDescription').textContent = photo.description || '（暂无描述）';
        $('#lightboxMeta').innerHTML = `
            <div>📅 ${formatDate(photo.date)}</div>
            <div>📁 ${escapeHTML(photo.name)}</div>
            <div>💾 ${formatBytes(photo.size)}</div>
        `;

        $('#lightboxPrev').disabled = idx === 0;
        $('#lightboxNext').disabled = idx === filtered.length - 1;
    }

    function lightboxNav(delta) {
        const filtered = getFilteredPhotos();
        const newIdx = state.currentLightboxIndex + delta;
        if (newIdx < 0 || newIdx >= filtered.length) return;
        state.currentLightboxIndex = newIdx;
        updateLightbox();
    }

    // ============ Export / Import ============
    async function exportData() {
        if (state.photos.length === 0) {
            showToast('暂无数据可导出', 'info');
            return;
        }
        const exportData = {
            version: 1,
            exportedAt: new Date().toISOString(),
            tags: state.tags,
            photos: state.photos.map(p => ({
                ...p,
                // dataUrl is huge; still include for portability
            })),
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `photo-album-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('数据已导出', 'success');
    }

    // ============ Event Bindings ============
    function bindEvents() {
        // Upload
        $('#uploadBtn').addEventListener('click', () => openModal('uploadModal'));
        $('#emptyUploadBtn').addEventListener('click', () => openModal('uploadModal'));

        const dropzone = $('#dropzone');
        const fileInput = $('#fileInput');
        dropzone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => addFilesToQueue(e.target.files));
        ['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        }));
        ['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
        }));
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            addFilesToQueue(e.dataTransfer.files);
        });

        $('#confirmUploadBtn').addEventListener('click', confirmUpload);

        // Modal close
        document.addEventListener('click', (e) => {
            const closeBtn = e.target.closest('[data-close]');
            if (closeBtn) {
                closeModal(closeBtn.dataset.close);
            }
            const overlay = e.target.classList && e.target.classList.contains('modal-overlay');
            if (overlay) {
                const modal = overlay.closest('.modal');
                if (modal) modal.classList.remove('show');
            }
        });

        // Upload preview remove
        $('#uploadPreviewList').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-remove-upload]');
            if (!btn) return;
            const idx = parseInt(btn.dataset.removeUpload);
            state.uploadQueue.splice(idx, 1);
            renderUploadPreview();
        });

        // Sidebar nav
        $$('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                $$('.nav-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.filter = btn.dataset.filter;
                state.tagFilter = null;
                renderPhotos();
                renderActiveFilters();
                updateLightboxIfOpen();
            });
        });

        // Tag list
        $('#tagList').addEventListener('click', (e) => {
            const delBtn = e.target.closest('[data-tag-delete]');
            if (delBtn) {
                e.stopPropagation();
                deleteTag(delBtn.dataset.tagDelete);
                return;
            }
            const tagItem = e.target.closest('[data-tag-id]');
            if (tagItem) {
                $$('.nav-item').forEach(b => b.classList.remove('active'));
                $$('.tag-item').forEach(b => b.classList.remove('active'));
                tagItem.classList.add('active');
                state.tagFilter = tagItem.dataset.tagId;
                state.filter = 'tag';
                renderPhotos();
                renderActiveFilters();
                updateLightboxIfOpen();
            }
        });

        // Add tag
        $('#addTagBtn').addEventListener('click', () => {
            $('#newTagName').value = '';
            $$('.color-option').forEach(o => o.classList.remove('selected'));
            state.selectedTagColor = '#6366f1';
            $('.color-option').classList.add('selected');
            openModal('tagModal');
            setTimeout(() => $('#newTagName').focus(), 100);
        });

        $('#colorPicker').addEventListener('click', (e) => {
            const opt = e.target.closest('.color-option');
            if (!opt) return;
            $$('.color-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            state.selectedTagColor = opt.dataset.color;
        });

        $('#confirmTagBtn').addEventListener('click', async () => {
            const name = $('#newTagName').value.trim();
            if (!name) {
                showToast('请输入标签名', 'error');
                return;
            }
            const tag = await createTag(name, state.selectedTagColor);
            if (tag) {
                closeModal('tagModal');
            }
        });

        $('#newTagName').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') $('#confirmTagBtn').click();
        });

        // Search
        const searchInput = $('#searchInput');
        const searchClear = $('#searchClear');
        const searchWrapper = searchInput.closest('.search-wrapper');
        const onSearch = debounce((val) => {
            state.searchQuery = val;
            searchWrapper.classList.toggle('has-value', !!val);
            renderPhotos();
            renderActiveFilters();
            updateLightboxIfOpen();
        }, 200);
        searchInput.addEventListener('input', (e) => onSearch(e.target.value));
        searchClear.addEventListener('click', () => {
            searchInput.value = '';
            state.searchQuery = '';
            searchWrapper.classList.remove('has-value');
            renderPhotos();
            renderActiveFilters();
            updateLightboxIfOpen();
        });

        // Active filter chips
        $('#activeFilters').addEventListener('click', (e) => {
            const remove = e.target.closest('[data-remove-filter]');
            if (!remove) return;
            const idx = parseInt(remove.dataset.removeFilter);
            // Recompute current chips to clear them
            state.searchQuery = '';
            searchInput.value = '';
            searchWrapper.classList.remove('has-value');
            state.tagFilter = null;
            state.filter = 'all';
            $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
            $$('.tag-item').forEach(b => b.classList.remove('active'));
            renderPhotos();
            renderActiveFilters();
            updateLightboxIfOpen();
        });

        // View toggle
        $$('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                $$('.view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.view = btn.dataset.view;
                renderPhotos();
            });
        });

        // Export
        $('#exportBtn').addEventListener('click', exportData);

        // Photo grid actions
        $('#photoGrid').addEventListener('click', (e) => {
            const actionBtn = e.target.closest('.photo-action-btn');
            const card = e.target.closest('.photo-card');
            if (!card) return;

            if (actionBtn) {
                e.stopPropagation();
                if (actionBtn.dataset.action === 'favorite') {
                    toggleFavorite(card.dataset.photoId);
                } else if (actionBtn.dataset.action === 'edit') {
                    openEditModal(card.dataset.photoId);
                }
                return;
            }
            // Open lightbox
            const idx = parseInt(card.dataset.index);
            openLightbox(idx);
        });

        // Lightbox
        $('#lightboxClose').addEventListener('click', closeLightbox);
        $('#lightboxPrev').addEventListener('click', () => lightboxNav(-1));
        $('#lightboxNext').addEventListener('click', () => lightboxNav(1));
        $('#lightbox').addEventListener('click', (e) => {
            if (e.target.id === 'lightbox') closeLightbox();
        });
        document.addEventListener('keydown', (e) => {
            if (!$('#lightbox').classList.contains('show')) return;
            if (e.key === 'Escape') closeLightbox();
            else if (e.key === 'ArrowLeft') lightboxNav(-1);
            else if (e.key === 'ArrowRight') lightboxNav(1);
        });

        // Edit modal
        $('#savePhotoBtn').addEventListener('click', savePhotoEdit);
        $('#deletePhotoBtn').addEventListener('click', deleteEditingPhoto);

        const editTagInput = $('#editTagInput');
        editTagInput.addEventListener('input', (e) => {
            renderTagSuggestions(e.target.value);
        });
        editTagInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const value = e.target.value.trim();
                if (!value) return;
                let tag = getTagByName(value);
                if (!tag) {
                    // Auto-create tag with accent color
                    const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6'];
                    const color = colors[Math.floor(Math.random() * colors.length)];
                    tag = await createTag(value, color);
                }
                if (tag) {
                    addTagToEditing(tag.id);
                    e.target.value = '';
                    renderTagSuggestions('');
                }
            } else if (e.key === 'Backspace' && !e.target.value) {
                const photo = state.editingPhoto;
                if (photo && photo.tags && photo.tags.length > 0) {
                    removeTagFromEditing(photo.tags[photo.tags.length - 1]);
                }
            }
        });

        $('#editTags').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-remove-edit-tag]');
            if (btn) removeTagFromEditing(btn.dataset.removeEditTag);
        });

        $('#tagSuggestions').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-add-suggest-tag]');
            if (btn) {
                addTagToEditing(btn.dataset.addSuggestTag);
                $('#editTagInput').focus();
            }
        });
    }

    function updateLightboxIfOpen() {
        if ($('#lightbox').classList.contains('show')) {
            state.currentLightboxIndex = Math.min(state.currentLightboxIndex, getFilteredPhotos().length - 1);
            if (state.currentLightboxIndex < 0) state.currentLightboxIndex = 0;
            updateLightbox();
        }
    }

    // ============ Sample Data ============
    async function seedSampleData() {
        // Generate placeholder images as sample data
        const samplePhotos = [
            { name: '海边日落.jpg', date: '2024-08-15', description: '和家人一起在海边看日落，金色的阳光洒在海面上，美得让人窒息。', tags: ['旅行', '风景'] },
            { name: '咖啡时光.jpg', date: '2024-09-03', description: '周末午后的咖啡馆，一本书，一杯拿铁，慵懒而惬意。', tags: ['生活', '美食'] },
            { name: '城市夜景.jpg', date: '2024-10-12', description: '华灯初上的城市夜景，霓虹闪烁间映照着每个归家的人。', tags: ['旅行', '城市'] },
            { name: '家庭聚会.jpg', date: '2024-11-25', description: '感恩节的大家庭聚会，每个人脸上都洋溢着幸福的笑容。', tags: ['家人', '聚会'] },
            { name: '雪山远眺.jpg', date: '2024-12-08', description: '登顶那一刻，所有疲惫都被壮丽的美景治愈了。', tags: ['旅行', '风景'] },
            { name: '可爱萌宠.jpg', date: '2025-01-14', description: '我家的小猫今天又卖萌了，治愈一整天。', tags: ['宠物', '生活'] },
            { name: '生日派对.jpg', date: '2025-02-22', description: '好朋友30岁生日派对，蛋糕超好吃！', tags: ['聚会', '朋友'] },
            { name: '春日樱花.jpg', date: '2025-03-30', description: '樱花季的公园，到处都是粉色的浪漫。', tags: ['风景', '春日'] },
            { name: '书房一角.jpg', date: '2025-04-18', description: '新布置的书房角落，终于有个安静读书的地方了。', tags: ['生活', '家居'] },
            { name: '老友重逢.jpg', date: '2025-05-09', description: '毕业十年再相聚，时间好像一下回到从前。', tags: ['朋友', '聚会'] },
        ];

        const tagDefs = [
            { name: '旅行', color: '#6366f1' },
            { name: '风景', color: '#10b981' },
            { name: '家人', color: '#ec4899' },
            { name: '朋友', color: '#f59e0b' },
            { name: '聚会', color: '#8b5cf6' },
            { name: '生活', color: '#06b6d4' },
            { name: '美食', color: '#ef4444' },
            { name: '城市', color: '#84cc16' },
            { name: '宠物', color: '#f97316' },
            { name: '春日', color: '#22c55e' },
            { name: '家居', color: '#0ea5e9' },
        ];

        // Create tags
        const tagMap = {};
        for (const t of tagDefs) {
            const tag = { id: uid(), name: t.name, color: t.color, createdAt: Date.now() + Math.random() };
            tagMap[t.name] = tag;
            await putTag(tag);
            state.tags.push(tag);
        }

        // Create gradient placeholder images
        const gradients = [
            ['#667eea', '#764ba2'],
            ['#f093fb', '#f5576c'],
            ['#4facfe', '#00f2fe'],
            ['#43e97b', '#38f9d7'],
            ['#fa709a', '#fee140'],
            ['#30cfd0', '#330867'],
            ['#a8edea', '#fed6e3'],
            ['#ff9a9e', '#fad0c4'],
            ['#fbc2eb', '#a6c1ee'],
            ['#ffecd2', '#fcb69f'],
        ];

        for (let i = 0; i < samplePhotos.length; i++) {
            const sample = samplePhotos[i];
            const [c1, c2] = gradients[i % gradients.length];
            const dataUrl = await generateGradientImage(c1, c2, sample.name);
            const photo = {
                id: uid(),
                name: sample.name,
                dataUrl,
                size: dataUrl.length,
                date: sample.date,
                description: sample.description,
                tags: sample.tags.map(n => tagMap[n]?.id).filter(Boolean),
                favorite: i < 2,
                createdAt: Date.now() - (samplePhotos.length - i) * 86400000,
            };
            await putPhoto(photo);
            state.photos.push(photo);
        }
        showToast(`已加载 ${samplePhotos.length} 张示例照片`, 'success');
    }

    function generateGradientImage(c1, c2, text) {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            canvas.width = 800;
            canvas.height = 600;
            const ctx = canvas.getContext('2d');

            // Gradient background
            const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
            gradient.addColorStop(0, c1);
            gradient.addColorStop(1, c2);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Decorative circles
            ctx.globalAlpha = 0.2;
            for (let i = 0; i < 5; i++) {
                ctx.beginPath();
                ctx.arc(
                    Math.random() * canvas.width,
                    Math.random() * canvas.height,
                    50 + Math.random() * 100,
                    0, Math.PI * 2
                );
                ctx.fillStyle = '#ffffff';
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            // Camera icon
            ctx.save();
            ctx.translate(canvas.width / 2, canvas.height / 2 - 30);
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            // Camera body
            ctx.fillRect(-60, -40, 120, 80);
            ctx.fillRect(-30, -50, 60, 20);
            // Lens
            ctx.beginPath();
            ctx.arc(0, 0, 30, 0, Math.PI * 2);
            ctx.fillStyle = c1;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(0, 0, 22, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(0, 0, 18, 0, Math.PI * 2);
            ctx.fillStyle = c2;
            ctx.fill();
            ctx.restore();

            // Text
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            ctx.font = '600 28px "PingFang SC", "Microsoft YaHei", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(text.replace(/\.[^.]+$/, ''), canvas.width / 2, canvas.height / 2 + 80);

            resolve(canvas.toDataURL('image/jpeg', 0.85));
        });
    }

    // ============ Init ============
    async function init() {
        try {
            await openDB();
            state.photos = (await getAllPhotos()) || [];
            state.tags = (await getAllTags()) || [];

            // First run: seed sample data
            if (state.photos.length === 0 && state.tags.length === 0) {
                await seedSampleData();
            }

            bindEvents();
            renderTagList();
            renderPhotos();
            updateCounts();
            updateStorageInfo();
            renderActiveFilters();
        } catch (err) {
            console.error('Init error:', err);
            showToast('初始化失败：' + err.message, 'error', 5000);
        }
    }

    // Start
    document.addEventListener('DOMContentLoaded', init);
})();
