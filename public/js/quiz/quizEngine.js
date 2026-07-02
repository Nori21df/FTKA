// Logic thuần của trang Ôn tập từ vựng (/quiz) — tách từ inline script views/quiz.html
// (refactor Phase 3, docs/refactor-plan.md). KHÔNG đụng DOM ở đây để unit-test được;
// phần render/binding nằm ở quizPage.js. Hành vi giữ nguyên 1:1 với bản inline.

export function normalizeText(value, fallback = '') {
    if (typeof value !== 'string') {
        return fallback;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : fallback;
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function formatText(value) {
    return escapeHtml(value).replace(/\n/g, '<br>');
}

export function shuffle(items) {
    const clone = [...items];
    for (let index = clone.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
    }
    return clone;
}

// TODO(dead-code?): có từ bản inline nhưng không nơi nào gọi — giữ lại theo nguyên tắc
// "không xóa khi chưa chứng minh" của kế hoạch refactor.
export function pluralize(count, singular, plural = `${singular}s`) {
    return count === 1 ? singular : plural;
}

export function buildCards(rawDeck) {
    return rawDeck.map((item, index) => ({
        key: `${item.id || 'word'}-${index}`,
        id: item.id,
        korean: normalizeText(item.korean, 'Untitled word'),
        meaning: normalizeText(item.meaning_vi, 'No meaning saved yet'),
        explanation: normalizeText(item.explanation_vi, ''),
        exampleKr: normalizeText(item.example_kr, ''),
        exampleVi: normalizeText(item.example_vi, ''),
        ttsText: normalizeText(item.tts_text || item.korean, normalizeText(item.korean, '')),
        attempts: 0,
        correct: 0,
        incorrect: 0,
        status: 'active'
    }));
}

export function buildOptions(card, fieldName, cards, exampleViPool) {
    const correctValue = card[fieldName];
    const usedValues = new Set([correctValue]);
    const distractors = [];

    for (const candidate of shuffle(cards)) {
        if (candidate.key === card.key || candidate.status !== 'active') {
            continue;
        }

        const value = candidate[fieldName];
        if (!value || usedValues.has(value)) {
            continue;
        }

        distractors.push(value);
        usedValues.add(value);

        if (distractors.length === 3) {
            break;
        }
    }

    if (distractors.length < 3 && fieldName === 'meaning') {
        for (const value of shuffle(exampleViPool)) {
            if (!value || usedValues.has(value)) {
                continue;
            }

            distractors.push(value);
            usedValues.add(value);

            if (distractors.length === 3) {
                break;
            }
        }
    }

    if (distractors.length === 0) {
        return [];
    }

    return shuffle([
        { label: correctValue, correct: true },
        ...distractors.map((value) => ({ label: value, correct: false }))
    ]);
}

export function buildTurn(card, cards, exampleViPool) {
    const promptMode = cards.length > 1 && card.attempts % 2 === 1 ? 'korean_to_meaning' : 'meaning_to_korean';

    if (promptMode === 'korean_to_meaning') {
        const options = buildOptions(card, 'meaning', cards, exampleViPool);
        if (options.length > 1) {
            return {
                kind: 'mcq',
                directionLabel: 'Tiếng Hàn sang nghĩa',
                badge: 'Nhận biết',
                question: 'Nghĩa tiếng Việt phù hợp nhất là gì?',
                promptMain: card.korean,
                promptSupport: '',
                options,
                audioAvailable: true,
                audioMessage: ''
            };
        }

        return {
            kind: 'self_check',
            directionLabel: 'Tiếng Hàn sang nghĩa',
            badge: 'Tự kiểm tra',
            question: 'Tự nói nghĩa tiếng Việt trước, rồi hiện đáp án.',
            promptMain: card.korean,
            promptSupport: 'Thẻ này dùng chế độ tự kiểm tra.',
            revealNote: 'Hãy thử nói hoặc viết nghĩa tiếng Việt trước khi hiện thẻ.',
            options: [],
            audioAvailable: true,
            audioMessage: ''
        };
    }

    if (promptMode === 'meaning_to_korean') {
        const options = buildOptions(card, 'korean', cards, exampleViPool);
        if (options.length > 1) {
            return {
                kind: 'mcq',
                directionLabel: 'Nghĩa sang tiếng Hàn',
                badge: 'Gợi nhớ',
                question: 'Từ tiếng Hàn nào phù hợp với nghĩa này?',
                promptMain: card.meaning,
                promptSupport: 'Dùng gợi ý hoặc câu ví dụ nếu cần.',
                options,
                audioAvailable: false,
                audioMessage: 'Âm thanh sẽ mở sau khi bạn trả lời.'
            };
        }

        return {
            kind: 'self_check',
            directionLabel: 'Nghĩa sang tiếng Hàn',
            badge: 'Tự kiểm tra',
            question: 'Hãy nhớ lại từ tiếng Hàn trước, rồi hiện đáp án.',
            promptMain: card.meaning,
            promptSupport: 'Thẻ này dùng chế độ tự kiểm tra.',
            revealNote: 'Hãy thử nói hoặc viết từ tiếng Hàn trước khi hiện thẻ.',
            options: [],
            audioAvailable: false,
            audioMessage: 'Âm thanh sẽ mở sau khi hiện đáp án.'
        };
    }
}

// Khoảng cách chèn lại thẻ vào hàng đợi khi "Ôn lại": sai → ôn sớm (2), đúng/tự xem → giãn ra (≤4).
export function requeueSpacing(lastAnswerCorrect, queueLength) {
    return lastAnswerCorrect === false ? 2 : Math.min(queueLength, 4);
}
