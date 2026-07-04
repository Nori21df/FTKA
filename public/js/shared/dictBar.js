// Ô tra từ nhanh trên topbar (mọi trang app): Enter → /api/dict → panel kết quả
// + nút lưu vào từ vựng. Dùng chung endpoint với popover ở tab Học hôm nay.
const input = document.getElementById('dictbarInput');
const panel = document.getElementById('dictbarPanel');

if (input && panel) {
    const escapeHtml = (v) => String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const hide = () => { panel.hidden = true; panel.innerHTML = ''; };

    async function lookup() {
        const word = input.value.trim();
        if (!word) return;
        panel.hidden = false;
        panel.innerHTML = '<p class="dictbar-loading">Đang tra nghĩa…</p>';
        try {
            const response = await fetch('/api/dict', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ word })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success) throw new Error(data.error || 'Chưa tra được từ này.');
            const e = data.entry;
            panel.innerHTML = `
                <p class="dictbar-word" lang="ko">${escapeHtml(e.korean)}${e.reading ? ` <small>[${escapeHtml(e.reading)}]</small>` : ''}</p>
                <p class="dictbar-meaning">${escapeHtml(e.meaning_vi)}</p>
                ${e.example_kr ? `<p class="dictbar-example"><span lang="ko">${escapeHtml(e.example_kr)}</span><br>${escapeHtml(e.example_vi || '')}</p>` : ''}
                <div class="dictbar-actions">
                    <button type="button" class="dv-cta dictbar-save" data-word="${escapeHtml(e.korean)}">
                        <span class="material-icons-outlined" aria-hidden="true">bookmark_add</span> Lưu
                    </button>
                    <button type="button" class="dv-cta ghost dictbar-close">Đóng</button>
                </div>`;
        } catch (error) {
            panel.innerHTML = `<p class="dictbar-meaning">${escapeHtml(error.message || 'Chưa tra được từ này.')}</p>
                <div class="dictbar-actions"><button type="button" class="dv-cta ghost dictbar-close">Đóng</button></div>`;
        }
    }

    async function save(word, btn) {
        btn.disabled = true;
        try {
            const response = await fetch('/api/manual_add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ word })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success) throw new Error(data.error || 'Lưu từ thất bại.');
            window.showToast(`Đã lưu “${word}” vào từ vựng.`, 'success');
            hide();
            input.value = '';
        } catch (error) {
            window.showToast(error.message || 'Lưu từ thất bại.', 'error');
            btn.disabled = false;
        }
    }

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); lookup(); }
        if (event.key === 'Escape') hide();
    });
    panel.addEventListener('click', (event) => {
        const saveBtn = event.target.closest('.dictbar-save');
        if (saveBtn) return save(saveBtn.dataset.word, saveBtn);
        if (event.target.closest('.dictbar-close')) hide();
    });
    document.addEventListener('click', (event) => {
        if (!event.target.closest('.dictbar')) hide();
    });
}
