// DOM binding của trang Ôn tập từ vựng (/quiz) — tách từ inline script views/quiz.html
// (refactor Phase 3). Data động nhúng qua JSON island #quiz-data; logic thuần ở quizEngine.js.
// Các hàm gắn window.* giữ nguyên vì HTML sinh bằng chuỗi dùng onclick="...".
import {
    escapeHtml,
    formatText,
    shuffle,
    buildCards,
    buildTurn,
    requeueSpacing
} from './quizEngine.js';

const dataNode = document.getElementById('quiz-data');
if (dataNode) {
    let pageData = {};
    try { pageData = JSON.parse(dataNode.textContent || '{}'); } catch (_) { pageData = {}; }

    const rawDeck = Array.isArray(pageData.words) ? pageData.words : [];
    const rawExampleViPool = Array.isArray(pageData.example_vi_pool) ? pageData.example_vi_pool : [];
    const totalUnlearned = pageData.total_unlearned;
    const vocabUrl = pageData.vocab_url || '/vocab';

    const cards = buildCards(rawDeck);

    const exampleViPool = rawExampleViPool
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean);

    const cardsByKey = new Map(cards.map((card) => [card.key, card]));

    const state = {
        queue: shuffle(cards.map((card) => card.key)),
        currentCardKey: null,
        currentTurn: null,
        phase: 'question',
        selectedOptionIndex: null,
        hintOpen: false,
        lastAnswerCorrect: null,
        busyAction: false,
        stats: {
            answered: 0,
            correct: 0,
            incorrect: 0,
            learned: 0,
            done: 0,
            streak: 0,
            bestStreak: 0
        }
    };

    function getActiveCount() {
        return cards.filter((card) => card.status === 'active').length;
    }

    function getResolvedCount() {
        return cards.length - getActiveCount();
    }

    function getCurrentCard() {
        return state.currentCardKey ? cardsByKey.get(state.currentCardKey) : null;
    }

    function queueCurrentCard(spacing) {
        if (!state.currentCardKey) {
            return;
        }
        const insertAt = Math.max(0, Math.min(state.queue.length, spacing));
        state.queue.splice(insertAt, 0, state.currentCardKey);
    }

    function updateDashboard() {
        const resolvedCount = getResolvedCount();
        const progressPercent = cards.length ? Math.round((resolvedCount / cards.length) * 100) : 100;
        const directionBadge = document.getElementById('current-direction-badge');
        const modeCopy = document.getElementById('mode-copy');
        document.getElementById('session-progress-bar').style.width = `${progressPercent}%`;
        document.getElementById('queue-summary').textContent = state.currentTurn ? '' : 'Hoàn thành';

        if (!state.currentTurn) {
            directionBadge.textContent = 'Hoàn tất';
            modeCopy.textContent = `Bạn đã ôn ${cards.length} thẻ trong ${totalUnlearned} từ chưa học.`;
            return;
        }

        directionBadge.textContent = state.currentTurn.directionLabel;
        if (state.phase === 'question') {
            modeCopy.textContent = state.currentTurn.kind === 'mcq'
                ? 'Trả lời trước, rồi quyết định thẻ này có tiếp tục ôn không.'
                : 'Hãy nhớ đáp án trước khi hiện.';
            return;
        }

        if (state.lastAnswerCorrect === true) {
            modeCopy.textContent = 'Đúng rồi. Bạn có thể đánh dấu đã học hoặc tiếp tục ôn.';
            return;
        }

        if (state.lastAnswerCorrect === false) {
            modeCopy.textContent = 'Sai cũng là tín hiệu tốt để ôn lại.';
            return;
        }

        modeCopy.textContent = 'Tự kiểm tra phù hợp với bộ thẻ nhỏ.';
    }

    function renderHint(card, turn) {
        if (!state.hintOpen) {
            return '';
        }

        const sections = [];
        if (card.exampleKr || card.exampleVi) {
            sections.push(`
                <div>
                    <h4>Ví dụ</h4>
                    <p>${formatText(card.exampleKr || 'Chưa có ví dụ tiếng Hàn.')}</p>
                    ${card.exampleVi ? `<p>${formatText(card.exampleVi)}</p>` : ''}
                </div>
            `);
        }

        if (card.explanation) {
            sections.push(`
                <div>
                    <h4>Giải thích</h4>
                    <p>${formatText(card.explanation)}</p>
                </div>
            `);
        }

        if (sections.length === 0) {
            const fallbackCopy = turn && turn.audioAvailable === false
                ? 'Chưa có gợi ý thêm cho thẻ này. Hãy dùng câu ví dụ.'
                : 'Chưa có gợi ý thêm cho thẻ này. Hãy dùng âm thanh nếu cần.';
            sections.push(`
                <div>
                    <h4>Gợi ý</h4>
                    <p>${fallbackCopy}</p>
                </div>
            `);
        }

        return `<div class="hint-panel">${sections.join('')}</div>`;
    }

    function renderStudyStage(card, turn, phase) {
        const hasHint = Boolean(card.exampleKr || card.exampleVi || card.explanation);

        // MCQ Choices or Self-Check button
        let interactionMarkup = '';
        if (turn.kind === 'mcq') {
            interactionMarkup = `
                <div class="option-grid">
                    ${turn.options.map((option, index) => {
                        const isDisabled = phase !== 'question';
                        const isSelected = state.selectedOptionIndex === index;
                        let extraClass = '';
                        if (phase !== 'question') {
                            if (option.correct) {
                                extraClass = 'correct';
                            } else if (isSelected) {
                                extraClass = 'wrong';
                            }
                        }
                        return `
                            <button type="button" class="option-button ${extraClass}" onclick="answerQuestion(${index})" ${isDisabled ? 'disabled' : ''}>
                                <strong>${index + 1}: </strong>
                                <span>${formatText(option.label)}</span>
                            </button>
                        `;
                    }).join('')}
                </div>
            `;
        } else {
            // Self-Check
            if (phase === 'question') {
                interactionMarkup = `
                    <div class="reveal-panel">
                        <button type="button" class="primary-button" onclick="revealSelfCheck()">Hiện đáp án</button>
                        <p class="sidebar-copy">${escapeHtml(turn.revealNote || 'Hãy thử nói hoặc viết đáp án trước khi hiện thẻ.')}</p>
                    </div>
                `;
            }
        }

        // Feedback banner & Vocab details (Only in 'result' phase)
        let feedbackMarkup = '';
        if (phase === 'result') {
            const isCorrect = state.lastAnswerCorrect === true;
            const isWrong = state.lastAnswerCorrect === false;
            const bannerClass = isCorrect ? 'result-banner-correct' : isWrong ? 'result-banner-wrong' : 'result-banner-neutral';
            const bannerIcon = isCorrect ? 'check_circle' : isWrong ? 'priority_high' : 'visibility';
            const bannerTitle = isCorrect ? 'Đáp án đúng' : isWrong ? 'Chưa đúng' : 'Đã hiện đáp án';
            const bannerCopy = isCorrect
                ? 'Nếu đã nhớ chắc, hãy đánh dấu đã học. Nếu chưa, tiếp tục ôn.'
                : isWrong
                    ? 'Xem lại thẻ rồi quyết định ôn lại hay tạm xong hôm nay.'
                    : 'Quyết định có tiếp tục ôn thẻ này không.';

            feedbackMarkup = `
                <div class="result-scroll-area">
                    <section class="result-banner ${bannerClass}">
                        <span class="material-icons-outlined">${bannerIcon}</span>
                        <div>
                            <h3>${bannerTitle}</h3>
                            <p>${bannerCopy}</p>
                        </div>
                    </section>

                    <section class="answer-sheet">
                        <div class="answer-grid">
                            <article class="answer-block">
                                <h4>Nghĩa</h4>
                                <p>${formatText(card.meaning)}</p>
                            </article>
                            <article class="answer-block">
                                <h4>Giải thích</h4>
                                <p>${formatText(card.explanation || 'Chưa có giải thích cho thẻ này.')}</p>
                            </article>
                        </div>

                        <section class="example-block">
                            <h4>Câu ví dụ</h4>
                            <p class="example-kr">${formatText(card.exampleKr || 'Chưa có ví dụ tiếng Hàn.')}</p>
                            <p class="example-vi">${formatText(card.exampleVi || 'Chưa có bản dịch ví dụ.')}</p>
                        </section>
                    </section>
                </div>

                <div class="result-actions">
                    <button type="button" class="primary-button" onclick="markCurrentCardLearned()" ${state.busyAction || isWrong ? 'disabled' : ''}>
                        <span class="material-icons-outlined">task_alt</span>
                        Đã học (F)
                    </button>
                    <button type="button" class="secondary-button" onclick="studyAgain()" ${state.busyAction ? 'disabled' : ''}>
                        <span class="material-icons-outlined">refresh</span>
                        Ôn lại (A)
                    </button>
                    <button type="button" class="neutral-button" onclick="finishForToday()" ${state.busyAction ? 'disabled' : ''}>
                        <span class="material-icons-outlined">south</span>
                        Xong hôm nay (D)
                    </button>
                </div>
            `;
        }

        return `
            <div class="study-stage">
                <section class="prompt-panel">
                    <div class="prompt-meta">
                        <span class="prompt-chip prompt-chip-primary">${escapeHtml(turn.badge)}</span>
                        <span class="prompt-chip prompt-chip-muted">${escapeHtml(turn.directionLabel)}</span>
                    </div>
                    <p class="prompt-question">${escapeHtml(turn.question)}</p>
                    <div class="prompt-main">
                        ${phase === 'result' ? escapeHtml(card.korean) : formatText(turn.promptMain)}
                    </div>
                    <p class="prompt-support">${escapeHtml(turn.promptSupport)}</p>

                    <div class="prompt-actions">
                        ${(turn.audioAvailable || phase === 'result')
                            ? `
                                <button type="button" class="inline-audio-button" onclick="playCurrentAudio()">
                                    <span class="material-icons-outlined">volume_up</span>
                                    Nghe
                                </button>
                            `
                            : `
                                <div class="audio-lock-note">
                                    <span class="material-icons-outlined">lock</span>
                                    ${escapeHtml(turn.audioMessage || 'Âm thanh mở sau khi hiện đáp án.')}
                                </div>
                            `
                        }
                        <button type="button" class="hint-button" onclick="toggleHint()" ${hasHint ? '' : 'disabled'}>
                            <span class="material-icons-outlined">tips_and_updates</span>
                            ${state.hintOpen ? 'Ẩn gợi ý (H)' : 'Hiện gợi ý (H)'}
                        </button>
                    </div>

                    ${renderHint(card, turn)}
                </section>

                ${interactionMarkup}
                ${feedbackMarkup}
            </div>
        `;
    }

    function renderCompletion() {
        const accuracy = state.stats.answered ? `${Math.round((state.stats.correct / state.stats.answered) * 100)}%` : '--';
        document.getElementById('study-body').innerHTML = `
            <section class="completion-card">
                <div>
                    <p class="review-kicker">Hoàn thành</p>
                    <h3 class="page-title" style="font-size: 34px;">Đã xong lượt ôn</h3>
                    <p class="page-subtitle" style="margin-top: 10px;">Bạn đã ôn ${cards.length} thẻ. Bắt đầu lượt mới nếu muốn trộn lại.</p>
                </div>

                <div class="completion-grid">
                    <article class="completion-stat">
                        <span class="session-metric-label">Đã học</span>
                        <strong>${state.stats.learned}</strong>
                    </article>
                    <article class="completion-stat">
                        <span class="session-metric-label">Xong hôm nay</span>
                        <strong>${state.stats.done}</strong>
                    </article>
                    <article class="completion-stat">
                        <span class="session-metric-label">Độ chính xác</span>
                        <strong>${accuracy}</strong>
                    </article>
                    <article class="completion-stat">
                        <span class="session-metric-label">Chuỗi tốt nhất</span>
                        <strong>${state.stats.bestStreak}</strong>
                    </article>
                </div>

                <div class="completion-actions">
                    <button type="button" class="primary-button" onclick="window.location.reload()">Làm lượt khác</button>
                    <a href="${escapeHtml(vocabUrl)}" class="dv-cta ghost">Mở từ vựng</a>
                </div>
            </section>
        `;
    }

    function renderStudyBody() {
        const card = getCurrentCard();
        const studyBody = document.getElementById('study-body');

        if (!card || !state.currentTurn) {
            renderCompletion();
            updateDashboard();
            return;
        }

        studyBody.innerHTML = renderStudyStage(card, state.currentTurn, state.phase);
    }

    function nextTurn() {
        while (state.queue.length > 0) {
            const nextKey = state.queue.shift();
            const nextCard = cardsByKey.get(nextKey);
            if (!nextCard || nextCard.status !== 'active') {
                continue;
            }

            state.currentCardKey = nextKey;
            nextCard.attempts += 1;
            state.currentTurn = buildTurn(nextCard, cards, exampleViPool);
            state.phase = 'question';
            state.selectedOptionIndex = null;
            state.hintOpen = false;
            state.lastAnswerCorrect = null;
            updateDashboard();
            renderStudyBody();
            return;
        }

        state.currentCardKey = null;
        state.currentTurn = null;
        state.phase = 'question';
        state.selectedOptionIndex = null;
        state.hintOpen = false;
        state.lastAnswerCorrect = null;
        renderStudyBody();
    }

    function playCurrentAudio() {
        const card = getCurrentCard();
        if (!card || (state.phase === 'question' && state.currentTurn && state.currentTurn.audioAvailable === false)) {
            return;
        }
        playTTS(card.ttsText || card.korean);
    }

    function toggleHint() {
        if (state.phase !== 'question') {
            return;
        }
        state.hintOpen = !state.hintOpen;
        renderStudyBody();
    }

    function answerQuestion(index) {
        if (state.phase !== 'question' || state.currentTurn.kind !== 'mcq') {
            return;
        }

        const option = state.currentTurn.options[index];
        const card = getCurrentCard();
        if (!option || !card) {
            return;
        }

        state.selectedOptionIndex = index;
        state.phase = 'result';
        state.lastAnswerCorrect = Boolean(option.correct);
        state.stats.answered += 1;

        if (option.correct) {
            card.correct += 1;
            state.stats.correct += 1;
            state.stats.streak += 1;
            state.stats.bestStreak = Math.max(state.stats.bestStreak, state.stats.streak);
        } else {
            card.incorrect += 1;
            state.stats.incorrect += 1;
            state.stats.streak = 0;
        }

        updateDashboard();
        renderStudyBody();
    }

    function revealSelfCheck() {
        if (state.phase !== 'question') {
            return;
        }
        state.phase = 'result';
        state.lastAnswerCorrect = null;
        updateDashboard();
        renderStudyBody();
    }

    // Báo SRS không chặn UI (fire-and-forget) — lịch ôn ngắt quãng tiến/lùi theo kết quả.
    function reportSrs(cardId, grade) {
        if (!cardId) return;
        fetch('/api/srs_review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: cardId, grade })
        }).catch(() => {});
    }

    function studyAgain() {
        if (!state.currentCardKey || state.busyAction) {
            return;
        }

        const card = getCurrentCard();
        if (card) reportSrs(card.id, 'again');
        queueCurrentCard(requeueSpacing(state.lastAnswerCorrect, state.queue.length));
        nextTurn();
    }

    function finishForToday() {
        const card = getCurrentCard();
        if (!card || state.busyAction) {
            return;
        }

        reportSrs(card.id, 'good'); // đã ôn xong hôm nay → giãn lịch
        card.status = 'done';
        state.stats.done += 1;
        nextTurn();
    }

    async function markCurrentCardLearned() {
        const card = getCurrentCard();
        if (!card || state.busyAction || state.lastAnswerCorrect === false) {
            return;
        }

        state.busyAction = true;
        renderStudyBody();

        try {
            const response = await fetch('/api/mark_learned', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: card.id, learned: true })
            });

            if (!response.ok) {
                throw new Error('Đánh dấu đã học thất bại.');
            }

            card.status = 'mastered';
            state.stats.learned += 1;
            state.busyAction = false;
            nextTurn();
        } catch (error) {
            state.busyAction = false;
            window.showToast(error.message || 'Chưa cập nhật được từ này.', 'error');
            renderStudyBody();
        }
    }

    function handleKeyboard(event) {
        const tagName = document.activeElement && document.activeElement.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
            return;
        }

        if (!state.currentTurn) {
            return;
        }

        const key = event.key.toLowerCase();

        if (state.phase === 'question') {
            if (state.currentTurn.kind === 'mcq' && /^[1-4]$/.test(key)) {
                const index = Number(key) - 1;
                if (state.currentTurn.options[index]) {
                    event.preventDefault();
                    answerQuestion(index);
                }
                return;
            }

            if (key === 'h') {
                event.preventDefault();
                toggleHint();
                return;
            }

            if ((key === 'enter' || key === ' ') && state.currentTurn.kind === 'self_check') {
                event.preventDefault();
                revealSelfCheck();
            }
            return;
        }

        if (state.busyAction) {
            return;
        }

        if (key === 'a') {
            event.preventDefault();
            studyAgain();
            return;
        }

        if (key === 'd') {
            event.preventDefault();
            finishForToday();
            return;
        }

        if (key === 'f' || key === 'enter') {
            if (state.lastAnswerCorrect !== false) {
                event.preventDefault();
                markCurrentCardLearned();
            } else if (key === 'enter') {
                event.preventDefault();
                studyAgain();
            }
        }
    }

    window.answerQuestion = answerQuestion;
    window.finishForToday = finishForToday;
    window.markCurrentCardLearned = markCurrentCardLearned;
    window.playCurrentAudio = playCurrentAudio;
    window.revealSelfCheck = revealSelfCheck;
    window.studyAgain = studyAgain;
    window.toggleHint = toggleHint;

    window.addEventListener('keydown', handleKeyboard);
    nextTurn();
}
