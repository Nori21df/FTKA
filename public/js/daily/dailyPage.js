// Tab "Học hôm nay" (/daily): đoạn văn tiếng Hàn + dịch + nghe từng câu + bấm-từ-để-tra
// + 3 câu đọc hiểu. Chưa có đoạn của HÔM NAY → tự tạo bằng AI; ngày cũ chỉ xem lại.
import { playKorean } from '../shared/ttsPlayer.js';

const dataNode = document.getElementById('daily-data');
const viewNode = document.getElementById('daily-view');
const card = document.getElementById('dailyCard');
const regenBtn = document.getElementById('dailyRegenBtn'); // chỉ tồn tại khi xem hôm nay

let passage = null;
let view = { is_today: true };
try { passage = JSON.parse(dataNode?.textContent || 'null'); } catch (_) { passage = null; }
try { view = JSON.parse(viewNode?.textContent || '{}') || {}; } catch (_) { view = { is_today: true }; }

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Render đoạn văn: mỗi câu một hàng [nút nghe][câu với từng từ bấm được] ──
function sentenceRowHtml(sentence, index) {
    const words = sentence.split(/\s+/).filter(Boolean).map((w) =>
        `<button type="button" class="daily-word" data-word="${escapeHtml(w.replace(/[.,!?…"'“”‘’()]/g, ''))}">${escapeHtml(w)}</button>`
    ).join(' ');
    return `
        <div class="daily-sentence">
            <button type="button" class="daily-play" data-tts="${escapeHtml(sentence)}" title="Nghe câu này" aria-label="Nghe câu ${index + 1}">
                <span class="material-icons-outlined">volume_up</span>
            </button>
            <p lang="ko">${words}</p>
        </div>`;
}

function quizHtml(items) {
    if (!Array.isArray(items) || !items.length) return '';
    const blocks = items.map((q, qi) => `
        <div class="daily-quiz-item" data-q="${qi}" data-correct="${q.correct_index}">
            <p class="daily-quiz-q">${qi + 1}. ${escapeHtml(q.question_vi)}</p>
            <div class="daily-quiz-options">
                ${q.options.map((opt, oi) =>
                    `<button type="button" class="daily-quiz-opt" data-opt="${oi}">${escapeHtml(opt)}</button>`
                ).join('')}
            </div>
        </div>`).join('');
    return `
        <section class="daily-quiz">
            <h4><span class="material-icons-outlined" aria-hidden="true">quiz</span> Câu hỏi đọc hiểu</h4>
            ${blocks}
            <p class="daily-quiz-score" id="dailyQuizScore" hidden></p>
        </section>`;
}

function renderPassage(p) {
    const sentences = String(p.korean || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const viLines = escapeHtml(p.vietnamese).replace(/\r?\n/g, '<br>');
    card.innerHTML = `
        ${p.title ? `<h3 class="daily-title" lang="ko">${escapeHtml(p.title)}</h3>` : ''}
        <div class="daily-korean">${sentences.map(sentenceRowHtml).join('')}</div>
        <details class="daily-vi" open>
            <summary>Bản dịch tiếng Việt</summary>
            <div class="daily-vi-text">${viLines}</div>
        </details>
        ${quizHtml(p.quiz_items)}
        <div class="daily-popover" id="dailyPopover" hidden></div>`;
    bindPassageEvents();
}

// ── Nghe từng câu (TTS server có cache; Google chặn thì fallback giọng trình duyệt) ──
function playSentence(text, btn) {
    document.querySelectorAll('.daily-play.is-playing').forEach((b) => b.classList.remove('is-playing'));
    playKorean(text, {
        onStart: () => btn.classList.add('is-playing'),
        onEnd: () => btn.classList.remove('is-playing')
    });
}

// ── Popover tra từ + lưu vào từ vựng ──
function popoverEl() { return document.getElementById('dailyPopover'); }

function showPopover(anchor, html) {
    const pop = popoverEl();
    pop.innerHTML = html;
    pop.hidden = false;
    const cardRect = card.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    pop.style.top = `${rect.bottom - cardRect.top + 8}px`;
    pop.style.left = `${Math.max(0, Math.min(rect.left - cardRect.left, card.clientWidth - 300))}px`;
}

function hidePopover() {
    const pop = popoverEl();
    if (pop) { pop.hidden = true; pop.innerHTML = ''; }
}

async function lookupAndShow(word, anchor) {
    showPopover(anchor, `<p class="daily-pop-word" lang="ko">${escapeHtml(word)}</p><p class="daily-pop-loading">Đang tra nghĩa…</p>`);
    try {
        const response = await fetch('/api/dict', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || 'Chưa tra được từ này.');
        const e = data.entry;
        showPopover(anchor, `
            <p class="daily-pop-word" lang="ko">${escapeHtml(e.korean)}${e.reading ? ` <small>[${escapeHtml(e.reading)}]</small>` : ''}</p>
            <p class="daily-pop-meaning">${escapeHtml(e.meaning_vi)}</p>
            ${e.example_kr ? `<p class="daily-pop-example"><span lang="ko">${escapeHtml(e.example_kr)}</span><br>${escapeHtml(e.example_vi || '')}</p>` : ''}
            <div class="daily-pop-actions">
                <button type="button" class="dv-cta daily-pop-save" data-word="${escapeHtml(e.korean)}">
                    <span class="material-icons-outlined" aria-hidden="true">bookmark_add</span> Lưu vào từ vựng
                </button>
                <button type="button" class="dv-cta ghost daily-pop-close">Đóng</button>
            </div>`);
    } catch (error) {
        showPopover(anchor, `
            <p class="daily-pop-word" lang="ko">${escapeHtml(word)}</p>
            <p class="daily-pop-meaning">${escapeHtml(error.message || 'Chưa tra được từ này.')}</p>
            <div class="daily-pop-actions"><button type="button" class="dv-cta ghost daily-pop-close">Đóng</button></div>`);
    }
}

async function saveWord(word, btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined">autorenew</span> Đang lưu…';
    try {
        const response = await fetch('/api/manual_add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || 'Lưu từ thất bại.');
        window.showToast(`Đã lưu “${word}” vào từ vựng.`, 'success');
        hidePopover();
    } catch (error) {
        window.showToast(error.message || 'Lưu từ thất bại.', 'error');
        btn.disabled = false;
        btn.innerHTML = '<span class="material-icons-outlined">bookmark_add</span> Lưu vào từ vựng';
    }
}

// ── Quiz đọc hiểu: chấm tại chỗ, không lưu ──
function handleQuizClick(optBtn) {
    const item = optBtn.closest('.daily-quiz-item');
    if (!item || item.dataset.done) return;
    item.dataset.done = '1';
    const correct = Number(item.dataset.correct);
    item.querySelectorAll('.daily-quiz-opt').forEach((b, i) => {
        b.disabled = true;
        if (i === correct) b.classList.add('is-correct');
        else if (b === optBtn) b.classList.add('is-wrong');
    });
    const items = [...card.querySelectorAll('.daily-quiz-item')];
    if (items.every((it) => it.dataset.done)) {
        const right = items.filter((it) => it.querySelector('.daily-quiz-opt.is-correct:disabled') &&
            !it.querySelector('.daily-quiz-opt.is-wrong')).length;
        const score = document.getElementById('dailyQuizScore');
        score.hidden = false;
        score.textContent = `Kết quả: ${right}/${items.length} câu đúng${right === items.length ? ' — tuyệt vời!' : '. Đọc lại đoạn văn rồi thử tạo đoạn khác nhé.'}`;
    }
}

function bindPassageEvents() {
    card.addEventListener('click', (event) => {
        const play = event.target.closest('.daily-play');
        if (play) return playSentence(play.dataset.tts, play);
        const word = event.target.closest('.daily-word');
        if (word && word.dataset.word) return lookupAndShow(word.dataset.word, word);
        const save = event.target.closest('.daily-pop-save');
        if (save) return saveWord(save.dataset.word, save);
        if (event.target.closest('.daily-pop-close')) return hidePopover();
        const opt = event.target.closest('.daily-quiz-opt');
        if (opt) return handleQuizClick(opt);
        if (!event.target.closest('.daily-popover')) hidePopover();
    });
}

function renderError(message) {
    card.innerHTML = `
        <div class="daily-empty">
            <p>${escapeHtml(message || 'Chưa tạo được đoạn văn, bạn thử lại nhé.')}</p>
            ${view.is_today ? `<button type="button" class="dv-cta" id="dailyRetryBtn">
                <span class="material-icons-outlined" aria-hidden="true">refresh</span> Thử lại
            </button>` : ''}
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
        ? window.ftkaWait(waitEl, ['Đang chuẩn bị đoạn văn cho bạn…', 'Đang chọn một chủ đề thú vị…', 'Đang viết và dịch nghĩa…', 'Đang soạn câu hỏi đọc hiểu…', 'Sắp xong rồi nhé…'])
        : () => {};
    if (regenBtn) regenBtn.disabled = true;
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
        if (regenBtn) regenBtn.disabled = false;
    }
}

if (passage) {
    renderPassage(passage);
} else if (view.is_today) {
    generate(); // chưa có đoạn của hôm nay → tạo ngay khi mở tab
} else {
    renderError('Ngày này chưa có đoạn văn (chỉ tạo được cho hôm nay).');
}
if (regenBtn) regenBtn.addEventListener('click', generate);
