// Trang Bảng chữ cái (/hangul): bảng jamo (bấm để nghe) + quiz ghép âm 10 câu.
import { CONSONANTS, DOUBLE_CONSONANTS, VOWELS, COMPOUND_VOWELS, buildQuiz } from './hangulData.js';
import { playKorean } from '../shared/ttsPlayer.js';

const boardEl = document.getElementById('hangulBoard');
const quizEl = document.getElementById('hangulQuiz');
const startBtn = document.getElementById('hangulQuizStart');

function escapeHtml(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function play(text) {
    playKorean(text); // Google TTS (cache server); bị chặn thì fallback giọng trình duyệt
}

function sectionHtml(title, items) {
    return `
        <h4 class="hg-section">${title}</h4>
        <div class="hg-grid">
            ${items.map((i) => `
                <button type="button" class="hg-cell" data-example="${escapeHtml(i.example)}" title="Nghe ${escapeHtml(i.example)}">
                    <span class="hg-jamo" lang="ko">${escapeHtml(i.jamo)}</span>
                    <span class="hg-roman">${escapeHtml(i.roman)}</span>
                    <span class="hg-name" lang="ko">${escapeHtml(i.name)}</span>
                </button>`).join('')}
        </div>`;
}

boardEl.innerHTML =
    sectionHtml('Phụ âm cơ bản (14)', CONSONANTS) +
    sectionHtml('Phụ âm đôi (5)', DOUBLE_CONSONANTS) +
    sectionHtml('Nguyên âm cơ bản (10)', VOWELS) +
    sectionHtml('Nguyên âm ghép (11)', COMPOUND_VOWELS);

boardEl.addEventListener('click', (event) => {
    const cell = event.target.closest('.hg-cell');
    if (cell) play(cell.dataset.example);
});

// ── Quiz ghép âm ──
let quiz = [];
let qIndex = 0;
let qCorrect = 0;

function renderQuestion() {
    const q = quiz[qIndex];
    quizEl.innerHTML = `
        <p class="sp-progress">Câu ${qIndex + 1} / ${quiz.length} · Đúng ${qCorrect}</p>
        <p class="hg-quiz-jamo" lang="ko">${escapeHtml(q.jamo)}</p>
        <p class="sp-vi">Chữ này đọc là gì (romaja)?</p>
        <div class="daily-quiz-options hg-quiz-options">
            ${q.options.map((opt) => `<button type="button" class="daily-quiz-opt" data-opt="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`).join('')}
        </div>`;
}

function renderDone() {
    quizEl.innerHTML = `
        <p class="hg-quiz-jamo">${qCorrect >= Math.ceil(quiz.length * 0.7) ? 'Tuyệt vời!' : 'Cố lên!'}</p>
        <p class="sp-vi">Kết quả: ${qCorrect}/${quiz.length} câu đúng.</p>
        <div class="sp-actions"><button type="button" class="dv-cta" id="hangulQuizAgain">Làm lượt khác</button></div>`;
    document.getElementById('hangulQuizAgain').addEventListener('click', start);
}

quizEl.addEventListener('click', (event) => {
    const btn = event.target.closest('.daily-quiz-opt');
    if (!btn || btn.disabled) return;
    const q = quiz[qIndex];
    [...quizEl.querySelectorAll('.daily-quiz-opt')].forEach((b) => {
        b.disabled = true;
        if (b.dataset.opt === q.correct) b.classList.add('is-correct');
        else if (b === btn) b.classList.add('is-wrong');
    });
    if (btn.dataset.opt === q.correct) qCorrect += 1;
    play(q.example);
    setTimeout(() => {
        qIndex += 1;
        if (qIndex >= quiz.length) renderDone(); else renderQuestion();
    }, 900);
});

function start() {
    quiz = buildQuiz(10);
    qIndex = 0;
    qCorrect = 0;
    startBtn.hidden = true;
    renderQuestion();
}

startBtn.addEventListener('click', start);
