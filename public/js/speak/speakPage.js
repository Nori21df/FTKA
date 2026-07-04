// Trang Luyện phát âm (/speak): Web Speech API (ko-KR) — client-only, không tốn AI.
import { similarityScore } from './similarity.js';

const dataNode = document.getElementById('speak-data');
let sentences = [];
try { sentences = JSON.parse(dataNode?.textContent || '[]') || []; } catch (_) { sentences = []; }

const stage = document.getElementById('spStage');
const unsupported = document.getElementById('spUnsupported');
const progressEl = document.getElementById('spProgress');
const sentenceEl = document.getElementById('spSentence');
const viEl = document.getElementById('spVi');
const listenBtn = document.getElementById('spListenBtn');
const speakBtn = document.getElementById('spSpeakBtn');
const nextBtn = document.getElementById('spNextBtn');
const resultEl = document.getElementById('spResult');

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SpeechRecognition) {
    unsupported.hidden = false;
    stage.hidden = true;
}

let index = 0;
let recognizing = false;

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function show() {
    const s = sentences[index];
    if (!s) return;
    progressEl.textContent = `Câu ${index + 1} / ${sentences.length}`;
    sentenceEl.textContent = s.kr;
    viEl.textContent = s.vi || '';
    resultEl.hidden = true;
    resultEl.innerHTML = '';
}

function next() {
    index = (index + 1) % sentences.length;
    show();
}

let audio = null;
function listen() {
    if (audio) audio.pause();
    audio = new Audio(`/api/tts?text=${encodeURIComponent(sentences[index].kr)}`);
    audio.play().catch(() => {});
}

function grade(spoken) {
    const score = similarityScore(sentences[index].kr, spoken);
    const tone = score >= 80 ? 'good' : score >= 50 ? 'mid' : 'low';
    const message = score >= 80 ? 'Phát âm rất tốt!' : score >= 50 ? 'Khá ổn — thử lại để rõ hơn nhé.' : 'Chưa khớp — nghe mẫu rồi đọc chậm lại nhé.';
    resultEl.hidden = false;
    resultEl.innerHTML = `
        <div class="sp-score sp-${tone}">${score}%</div>
        <p class="sp-heard">Máy nghe được: <span lang="ko">${escapeHtml(spoken || '(không nghe rõ)')}</span></p>
        <p class="sp-note">${message}</p>`;
}

function speak() {
    if (recognizing || !SpeechRecognition) return;
    const rec = new SpeechRecognition();
    rec.lang = 'ko-KR';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    recognizing = true;
    speakBtn.disabled = true;
    speakBtn.innerHTML = '<span class="material-icons-outlined">graphic_eq</span> Đang nghe…';
    rec.onresult = (event) => grade(event.results[0]?.[0]?.transcript || '');
    rec.onerror = (event) => {
        resultEl.hidden = false;
        resultEl.innerHTML = `<p class="sp-note">${event.error === 'not-allowed'
            ? 'Bạn cần cho phép dùng micro để luyện nói.'
            : 'Chưa nghe được, bạn thử lại nhé.'}</p>`;
    };
    rec.onend = () => {
        recognizing = false;
        speakBtn.disabled = false;
        speakBtn.innerHTML = '<span class="material-icons-outlined">mic</span> Nói';
    };
    rec.start();
}

if (SpeechRecognition && sentences.length) {
    show();
    listenBtn.addEventListener('click', listen);
    speakBtn.addEventListener('click', speak);
    nextBtn.addEventListener('click', next);
}
