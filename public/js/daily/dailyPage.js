// Tab "Học hôm nay" (/daily): hiển thị đoạn văn tiếng Hàn + bản dịch của ngày.
// Nếu chưa có đoạn của hôm nay → tự tạo bằng AI (fetch) với thông báo chờ thân thiện.
const dataNode = document.getElementById('daily-data');
const card = document.getElementById('dailyCard');
const regenBtn = document.getElementById('dailyRegenBtn');

let existing = null;
try { existing = JSON.parse(dataNode?.textContent || 'null'); } catch (_) { existing = null; }

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Giữ xuống dòng giữa các câu.
function toLines(value) {
    return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function renderPassage(p) {
    card.innerHTML = `
        ${p.title ? `<h3 class="daily-title" lang="ko">${escapeHtml(p.title)}</h3>` : ''}
        <div class="daily-korean" lang="ko">${toLines(p.korean)}</div>
        <details class="daily-vi" open>
            <summary>Bản dịch tiếng Việt</summary>
            <div class="daily-vi-text">${toLines(p.vietnamese)}</div>
        </details>`;
}

function renderError(message) {
    card.innerHTML = `
        <div class="daily-empty">
            <p>${escapeHtml(message || 'Chưa tạo được đoạn văn, bạn thử lại nhé.')}</p>
            <button type="button" class="dv-cta" id="dailyRetryBtn">
                <span class="material-icons-outlined" aria-hidden="true">refresh</span> Thử lại
            </button>
        </div>`;
    const retry = document.getElementById('dailyRetryBtn');
    if (retry) retry.addEventListener('click', generate);
}

async function generate() {
    card.innerHTML = `
        <div class="daily-loading">
            <div class="ftka-skel-line" style="width:40%"></div>
            <div class="ftka-skel-line"></div>
            <div class="ftka-skel-line"></div>
            <div class="ftka-skel-line" style="width:80%"></div>
            <p class="daily-wait" id="dailyWait">Đang chuẩn bị đoạn văn cho bạn…</p>
        </div>`;
    const waitEl = document.getElementById('dailyWait');
    const stopWait = window.ftkaWait
        ? window.ftkaWait(waitEl, ['Đang chuẩn bị đoạn văn cho bạn…', 'Đang chọn một chủ đề thú vị…', 'Đang viết và dịch nghĩa…', 'Sắp xong rồi nhé…'])
        : () => {};
    regenBtn.disabled = true;
    try {
        const response = await fetch('/api/daily/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success || !data.passage) {
            throw new Error(data.error || 'Chưa tạo được đoạn văn, bạn thử lại nhé.');
        }
        renderPassage(data.passage);
    } catch (error) {
        renderError(error.message);
    } finally {
        stopWait();
        regenBtn.disabled = false;
    }
}

if (existing) {
    renderPassage(existing);
} else {
    // Chưa có đoạn của hôm nay → tạo ngay khi mở tab.
    generate();
}
regenBtn.addEventListener('click', generate);
