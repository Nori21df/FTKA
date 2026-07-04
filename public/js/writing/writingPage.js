// Trang Luyện viết (/writing): nộp bài → AI chấm điểm + sửa lỗi + nhận xét.
const topicInput = document.getElementById('wrTopicInput');
const textArea = document.getElementById('wrText');
const submitBtn = document.getElementById('wrSubmitBtn');
const statusEl = document.getElementById('wrStatus');
const resultEl = document.getElementById('wrResult');

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

document.querySelectorAll('.wr-topic').forEach((chip) => {
    chip.addEventListener('click', () => {
        topicInput.value = chip.dataset.topic;
        document.querySelectorAll('.wr-topic').forEach((c) => c.classList.toggle('is-active', c === chip));
        textArea.focus();
    });
});

function setStatus(message, tone) {
    statusEl.textContent = message;
    statusEl.className = `grammar-add-status is-visible is-${tone}`;
}

function renderResult(r) {
    const corrections = (r.feedback?.corrections || []).map((c) => `
        <li><span class="wr-wrong" lang="ko">${escapeHtml(c.wrong)}</span>
            <span class="material-icons-outlined" aria-hidden="true">arrow_forward</span>
            <span class="wr-right" lang="ko">${escapeHtml(c.right)}</span>
            ${c.note ? `<small>${escapeHtml(c.note)}</small>` : ''}</li>`).join('');
    resultEl.hidden = false;
    resultEl.innerHTML = `
        <div class="wr-result-head">
            <h3>Kết quả chấm bài</h3>
            <span class="wr-score">${r.score}/100</span>
        </div>
        ${r.feedback?.feedback_vi ? `<p class="wr-feedback">${escapeHtml(r.feedback.feedback_vi)}</p>` : ''}
        ${r.corrected ? `<p class="wr-label">Bản sửa hoàn chỉnh</p><p class="wr-corrected" lang="ko">${escapeHtml(r.corrected)}</p>` : ''}
        ${corrections ? `<p class="wr-label">Lỗi chính</p><ul class="wr-corrections">${corrections}</ul>` : ''}`;
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function submit() {
    const text = textArea.value.trim();
    if (text.length < 10) return setStatus('Bài viết quá ngắn — hãy viết ít nhất một câu hoàn chỉnh.', 'error');
    submitBtn.disabled = true;
    setStatus('', 'success');
    statusEl.className = 'grammar-add-status is-visible is-success';
    const stopWait = window.ftkaWait
        ? window.ftkaWait(statusEl, ['Đang đọc bài của bạn…', 'Đang tìm những chỗ cần sửa…', 'Đang viết nhận xét…', 'Sắp xong rồi nhé…'])
        : () => {};
    try {
        const response = await fetch('/api/writing/grade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic: topicInput.value.trim(), text })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || 'Chưa chấm được bài, bạn thử lại nhé.');
        setStatus('Đã chấm xong — xem kết quả bên dưới.', 'success');
        renderResult(data.result);
    } catch (error) {
        setStatus(error.message || 'Chưa chấm được bài, bạn thử lại nhé.', 'error');
    } finally {
        stopWait();
        submitBtn.disabled = false;
    }
}

submitBtn.addEventListener('click', submit);
