// DOM binding của trang Ngữ pháp (/grammar) — tách từ inline script views/grammar.html
// (refactor Phase 3). Logic lọc thuần ở grammarFilters.js. addGrammarPattern và
// regenerateAllGrammarQuizzes gắn window.* vì markup dùng onclick="...".
import { cardMatches, shouldShowFilteredEmpty } from './grammarFilters.js';

let currentGrammarLevel = 'all';
// Con trỏ cho "Tạo lại tất cả quiz" — giữ giữa các lần bấm để tiếp tục sau khi hồi năng lượng.
// Reset về 0 khi đã chạy hết toàn bộ danh sách.
let regenAllOffset = 0;

function applyGrammarFilters() {
    const query = document.getElementById('grammarSearch').value.trim().toLowerCase();
    const cards = document.querySelectorAll('.grammar-card');

    cards.forEach((card) => {
        const visible = cardMatches(card.dataset.level, card.dataset.search || '', currentGrammarLevel, query);
        card.classList.toggle('is-hidden', !visible);
    });

    const visibleCount = Array.from(cards).filter((card) => !card.classList.contains('is-hidden')).length;
    const visibleCountEl = document.getElementById('grammarVisibleCount');
    if (visibleCountEl) visibleCountEl.textContent = `${visibleCount} đang hiển thị`;
    const emptyFilteredEl = document.getElementById('grammarEmptyFiltered');
    if (emptyFilteredEl) emptyFilteredEl.style.display = shouldShowFilteredEmpty(cards.length, visibleCount) ? 'block' : 'none';
}

document.querySelectorAll('.grammar-filter-button').forEach((button) => {
    button.addEventListener('click', () => {
        currentGrammarLevel = button.dataset.level;
        document.querySelectorAll('.grammar-filter-button').forEach((item) => item.classList.remove('is-active'));
        button.classList.add('is-active');
        applyGrammarFilters();
    });
});

document.getElementById('grammarSearch').addEventListener('input', applyGrammarFilters);
document.getElementById('grammarPattern').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        addGrammarPattern();
    }
});

function setGrammarAddStatus(message, tone) {
    const status = document.getElementById('grammarAddStatus');
    status.textContent = message;
    status.className = `grammar-add-status is-visible is-${tone}`;
}

async function addGrammarPattern() {
    const input = document.getElementById('grammarPattern');
    const button = document.getElementById('addGrammarBtn');
    const pattern = input.value.trim();

    if (!pattern) {
        setGrammarAddStatus('Vui lòng nhập mẫu ngữ pháp tiếng Hàn trước.', 'error');
        input.focus();
        return;
    }

    button.disabled = true;
    button.innerHTML = '<span class="material-icons-outlined">autorenew</span>Đang soạn…';
    const addStatusEl = document.getElementById('grammarAddStatus');
    addStatusEl.className = 'grammar-add-status is-visible is-success';
    const stopAddWait = window.ftkaWait(addStatusEl, ['Đang chuẩn bị bài ngữ pháp cho bạn…', 'Đang tìm ví dụ minh hoạ dễ hiểu…', 'Đang soạn câu hỏi ôn tập…', 'Sắp xong rồi nhé…']);

    try {
        const response = await fetch('/api/add_grammar', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ grammar: pattern })
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.error || 'Thêm ngữ pháp thất bại.');
        }

        setGrammarAddStatus(`Đã lưu ${data.item?.grammar || pattern}. Đang tải lại...`, 'success');
        window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
        setGrammarAddStatus(error.message || 'Thêm ngữ pháp thất bại.', 'error');
    } finally {
        stopAddWait();
        button.disabled = false;
        button.innerHTML = '<span class="material-icons-outlined">auto_awesome</span> Tạo ngữ pháp';
    }
}

document.querySelectorAll('.grammar-delete-button').forEach((button) => {
    button.addEventListener('click', () => deleteGrammar(button.dataset.grammarId));
});

document.querySelectorAll('.grammar-regenerate-button').forEach((button) => {
    button.addEventListener('click', () => regenerateGrammarQuizItems(button));
});

function setGrammarCardStatus(id, message, tone) {
    const status = document.getElementById(`grammar-status-${id}`);
    if (!status) {
        return;
    }
    status.textContent = message;
    status.className = `grammar-card-status is-visible is-${tone}`;
}

async function regenerateGrammarQuizItems(button) {
    const id = button.dataset.grammarId;
    if (!id) {
        alert('Thiếu ID ngữ pháp. Vui lòng tải lại trang.');
        return;
    }

    button.disabled = true;
    button.innerHTML = '<span class="material-icons-outlined">autorenew</span>Đang soạn…';
        setGrammarCardStatus(id, 'Đang soạn lại câu hỏi, chờ chút nhé…', 'success');

    try {
        const response = await fetch('/api/regenerate_grammar_quiz_items', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ id: id })
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Tạo lại quiz thất bại.');
        }

        const quizCount = data.quiz_count || data.item?.quiz_items?.length || 0;
        setGrammarCardStatus(id, `Đã soạn lại ${quizCount} câu hỏi.`, 'success');
    } catch (error) {
        setGrammarCardStatus(id, 'Chưa soạn lại được, bạn thử lại nhé.', 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = '<span class="material-icons-outlined">refresh</span>Quiz';
    }
}

function setRegenAllStatus(message, tone) {
    const status = document.getElementById('regenAllStatus');
    if (!status) return;
    status.textContent = message;
    status.className = `grammar-add-status is-visible is-${tone}`;
}

async function regenerateAllGrammarQuizzes() {
    const button = document.getElementById('regenAllQuizBtn');
    if (!confirm('Soạn lại câu hỏi cho TẤT CẢ bài ngữ pháp?\nMỗi bài tốn 3 năng lượng và có thể mất một lát.')) {
        return;
    }

    const originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="material-icons-outlined">autorenew</span>Đang soạn lại…';

    let totalUpdated = 0;
    let totalFailed = 0;
    let grandTotal = 0;
    let stoppedForEnergy = false;
    const MAX_ITERATIONS = 100; // chặn vòng lặp vô hạn

    try {
        for (let iter = 0; iter < MAX_ITERATIONS; iter += 1) {
            const response = await fetch('/api/regenerate_all_grammar_quiz_items', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ offset: regenAllOffset })
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Chưa soạn lại được, bạn thử lại nhé.');
            }

            grandTotal = data.total;
            if (grandTotal === 0) {
                setRegenAllStatus('Chưa có bài ngữ pháp nào để soạn lại.', 'success');
                regenAllOffset = 0;
                return;
            }

            totalUpdated += data.updated || 0;
            totalFailed += data.failed || 0;

            // Cập nhật trạng thái cho các thẻ đang hiển thị trên trang (thẻ ở trang khác sẽ được bỏ qua an toàn).
            (data.updated_ids || []).forEach((id) => setGrammarCardStatus(id, 'Đã soạn lại câu hỏi.', 'success'));
            (data.failed_items || []).forEach((item) => setGrammarCardStatus(item.id, 'Chưa soạn lại được.', 'error'));

            setRegenAllStatus(`Đang soạn lại… ${totalUpdated + totalFailed}/${grandTotal} bài (${totalUpdated} xong${totalFailed ? `, ${totalFailed} chưa được` : ''}).`, 'success');

            regenAllOffset = data.next_offset;

            if (data.out_of_energy) { stoppedForEnergy = true; break; }
            if (data.remaining <= 0 || data.next_offset <= data.offset) break;
        }

        // Đã quét hết danh sách → reset con trỏ cho lần chạy sau.
        if (!stoppedForEnergy) regenAllOffset = 0;

        const parts = [];
        if (stoppedForEnergy) {
            parts.push(`Đã soạn lại ${totalUpdated}/${grandTotal} bài rồi tạm dừng vì hết năng lượng — chờ hồi lại rồi bấm tiếp nhé.`);
        } else {
            parts.push(`Xong rồi: đã soạn lại ${totalUpdated}/${grandTotal} bài.`);
        }
        if (totalFailed) parts.push(`${totalFailed} bài chưa soạn được.`);
        setRegenAllStatus(parts.join(' '), (totalFailed || stoppedForEnergy) ? 'error' : 'success');
    } catch (error) {
        setRegenAllStatus(error.message || 'Chưa soạn lại được, bạn thử lại nhé.', 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = originalHtml;
    }
}

async function deleteGrammar(id) {
    if (!id) {
        alert('Thiếu ID ngữ pháp. Vui lòng tải lại trang.');
        return;
    }
    if (!confirm('Bạn có chắc chắn muốn xóa ngữ pháp này không?')) {
        return;
    }

    try {
        const response = await fetch('/api/delete_grammar', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ id: id })
        });

        if (response.ok) {
            window.location.reload();
        } else {
            throw new Error('Xoá ngữ pháp thất bại.');
        }
    } catch (error) {
        alert(error.message || 'Xoá ngữ pháp thất bại.');
    }
}

// Markup dùng onclick="addGrammarPattern()" / onclick="regenerateAllGrammarQuizzes()".
window.addGrammarPattern = addGrammarPattern;
window.regenerateAllGrammarQuizzes = regenerateAllGrammarQuizzes;

applyGrammarFilters();
