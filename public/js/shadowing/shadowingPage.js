// Trang Shadowing: nối engine thuần với TTS, nhận dạng giọng nói và DOM.
import { similarityScore } from '../speak/similarity.js';
import { ShadowingEngine } from './shadowingEngine.js';

const dataNode = document.getElementById('shadow-data');
let sentences = [];
try {
    const parsed = JSON.parse(dataNode?.textContent || '[]');
    sentences = Array.isArray(parsed) ? parsed : [];
} catch (_) {
    sentences = [];
}

const stage = document.getElementById('shStage');
const unsupported = document.getElementById('shUnsupported');
const progressEl = document.getElementById('shProgress');
const sentenceEl = document.getElementById('shSentence');
const viEl = document.getElementById('shVi');
const viToggle = document.getElementById('shViToggle');
const playBtn = document.getElementById('shPlayBtn');
const micBtn = document.getElementById('shMicBtn');
const speedSelect = document.getElementById('shSpeed');
const roundsSelect = document.getElementById('shRounds');
const autoCheckbox = document.getElementById('shAutoChk');
const prevBtn = document.getElementById('shPrevBtn');
const nextBtn = document.getElementById('shNextBtn');
const resultEl = document.getElementById('shResult');
const doneEl = document.getElementById('shDone');

const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
const engine = new ShadowingEngine(sentences, roundsSelect.value);
// Giữ nguyên markup nút mic (có <span> icon) — dùng textContent sẽ phá icon thành chữ "mic" trần.
const micIdleHtml = micBtn.innerHTML;
const micListeningHtml = '<span class="material-icons-outlined" aria-hidden="true">mic</span> Đang nghe bạn nói…';

let activeAudio = null;
let activeRecognition = null;
let activeUtterance = null;
let playbackToken = 0;
let micTimer = null;
let autoTimer = null;

function selectedSpeed() {
    const speed = Number.parseFloat(speedSelect.value);
    return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

function setMicState(listening) {
    micBtn.disabled = listening || !SpeechRecognition || engine.completed;
    micBtn.innerHTML = listening ? micListeningHtml : micIdleHtml; // chuỗi tĩnh, an toàn
    micBtn.classList.toggle('is-listening', listening);
}

function clearTimers() {
    window.clearTimeout(micTimer);
    window.clearTimeout(autoTimer);
    micTimer = null;
    autoTimer = null;
}

// Mỗi lượt mới đều dừng hoàn toàn âm thanh và nhận dạng cũ.
function stopCurrentActivity() {
    playbackToken += 1;
    clearTimers();

    if (activeAudio) {
        activeAudio.pause();
        activeAudio = null;
    }

    if (activeUtterance && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        activeUtterance = null;
    }

    if (activeRecognition) {
        const recognition = activeRecognition;
        activeRecognition = null;
        try {
            recognition.abort();
        } catch (_) {
            // Recognition có thể đã tự kết thúc.
        }
    }

    setMicState(false);
}

function resetResult() {
    resultEl.hidden = true;
    resultEl.classList.remove('sh-good', 'sh-mid', 'sh-low');
    resultEl.replaceChildren();
}

function showMessage(message) {
    resultEl.hidden = false;
    resultEl.classList.remove('sh-good', 'sh-mid', 'sh-low');
    const note = document.createElement('p');
    note.textContent = message;
    resultEl.replaceChildren(note);
}

function showGrade(score, spoken) {
    const tone = score >= 80 ? 'sh-good' : score >= 50 ? 'sh-mid' : 'sh-low';
    const message = score >= 80
        ? 'Bạn nhại rất giống câu mẫu!'
        : score >= 50
            ? 'Khá ổn, hãy thử lại để rõ hơn nhé.'
            : 'Chưa khớp, hãy nghe mẫu rồi nói chậm lại nhé.';

    const scoreEl = document.createElement('div');
    scoreEl.className = `sh-score ${tone}`;
    scoreEl.textContent = `${score}%`;

    const heardEl = document.createElement('p');
    heardEl.className = 'sh-heard';
    heardEl.append('Máy nghe được: ');
    const transcriptEl = document.createElement('span');
    transcriptEl.lang = 'ko';
    transcriptEl.textContent = spoken || '(không nghe rõ)';
    heardEl.appendChild(transcriptEl);

    const noteEl = document.createElement('p');
    noteEl.className = 'sh-note';
    noteEl.textContent = message;

    resultEl.hidden = false;
    resultEl.classList.remove('sh-good', 'sh-mid', 'sh-low');
    resultEl.classList.add(tone);
    resultEl.replaceChildren(scoreEl, heardEl, noteEl);
}

function render(options = {}) {
    const { clearResult = true } = options;
    const sentence = engine.currentSentence;
    if (!sentence) {
        stage.hidden = false;
        progressEl.textContent = 'Chưa có câu để luyện.';
        sentenceEl.textContent = '';
        viEl.textContent = '';
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        playBtn.disabled = true;
        micBtn.disabled = true;
        doneEl.hidden = false;
        doneEl.textContent = 'Chưa có câu nào để luyện Shadowing.';
        if (clearResult) {
            resetResult();
        }
        return;
    }

    stage.hidden = false;
    progressEl.textContent = `Câu ${engine.index + 1}/${engine.sentences.length} · Vòng ${engine.round}/${engine.totalRounds}`;
    sentenceEl.lang = 'ko';
    sentenceEl.textContent = sentence.kr || '';
    viEl.textContent = sentence.vi || '';
    prevBtn.disabled = engine.index === 0;
    nextBtn.disabled = engine.index === engine.sentences.length - 1;
    playBtn.disabled = engine.completed;
    setMicState(false);

    doneEl.hidden = !engine.completed;
    if (engine.completed) {
        doneEl.textContent = `Hoàn thành! Điểm trung bình: ${Math.round(engine.averageScore())}%.`;
    }

    if (clearResult) {
        resetResult();
    }
}

function scheduleMicrophone() {
    if (!autoCheckbox.checked || !SpeechRecognition || engine.completed) {
        return;
    }

    micTimer = window.setTimeout(() => {
        micTimer = null;
        startRecognition();
    }, 300);
}

function finishPlayback(token) {
    if (token !== playbackToken) {
        return;
    }
    activeAudio = null;
    activeUtterance = null;
    scheduleMicrophone();
}

// Dùng giọng trình duyệt khi endpoint TTS không phát được.
function speakWithBrowser(text, token) {
    if (token !== playbackToken) {
        return;
    }

    const synthesis = window.speechSynthesis;
    const Utterance = window.SpeechSynthesisUtterance;
    if (!synthesis || !Utterance) {
        showMessage('Trình duyệt không thể phát câu mẫu lúc này.');
        return;
    }

    const utterance = new Utterance(text);
    activeUtterance = utterance;
    utterance.lang = 'ko-KR';
    utterance.rate = selectedSpeed();
    utterance.onend = () => finishPlayback(token);
    utterance.onerror = () => {
        if (token === playbackToken) {
            activeUtterance = null;
            showMessage('Không phát được câu mẫu, bạn thử lại nhé.');
        }
    };
    synthesis.speak(utterance);
}

function playCurrentSentence() {
    if (!engine.currentSentence || engine.completed) {
        return;
    }

    stopCurrentActivity();
    const token = playbackToken;
    const text = engine.currentSentence.kr || '';
    let fallbackStarted = false;

    const fallback = () => {
        if (fallbackStarted || token !== playbackToken) {
            return;
        }
        fallbackStarted = true;
        if (activeAudio) {
            activeAudio.pause();
            activeAudio = null;
        }
        speakWithBrowser(text, token);
    };

    try {
        const audio = new Audio(`/api/tts?text=${encodeURIComponent(text)}`);
        activeAudio = audio;
        audio.playbackRate = selectedSpeed();
        audio.addEventListener('ended', () => finishPlayback(token), { once: true });
        audio.addEventListener('error', fallback, { once: true });
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(fallback);
        }
    } catch (_) {
        fallback();
    }
}

function scheduleNextAttempt() {
    autoTimer = window.setTimeout(() => {
        autoTimer = null;
        render();
        if (autoCheckbox.checked && !engine.completed) {
            playCurrentSentence();
        }
    }, 1000);
}

function grade(expected, spoken) {
    const score = similarityScore(expected, spoken);
    showGrade(score, spoken);
    engine.recordAttempt(score);

    if (autoCheckbox.checked) {
        scheduleNextAttempt();
    } else {
        render({ clearResult: false });
    }
}

// Nhận đúng một kết quả cuối rồi giao điểm cho engine.
function startRecognition() {
    if (!SpeechRecognition || !engine.currentSentence || engine.completed) {
        return;
    }

    stopCurrentActivity();
    const expected = engine.currentSentence.kr || '';
    const recognition = new SpeechRecognition();
    let handledResult = false;
    activeRecognition = recognition;
    recognition.lang = 'ko-KR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        if (activeRecognition === recognition) {
            setMicState(true);
        }
    };
    recognition.onresult = (event) => {
        if (activeRecognition !== recognition || handledResult) {
            return;
        }
        handledResult = true;
        const spoken = event.results[0]?.[0]?.transcript || '';
        grade(expected, spoken);
    };
    recognition.onerror = (event) => {
        if (activeRecognition !== recognition) {
            return;
        }
        const message = event.error === 'not-allowed'
            ? 'Bạn cần cho phép dùng micro để luyện nói.'
            : event.error === 'no-speech'
                ? 'Chưa nghe thấy giọng nói, bạn thử lại nhé.'
                : 'Chưa nhận dạng được, bạn thử lại nhé.';
        showMessage(message);
    };
    recognition.onend = () => {
        if (activeRecognition === recognition) {
            activeRecognition = null;
            setMicState(false);
        }
    };

    try {
        recognition.start();
        setMicState(true);
    } catch (_) {
        activeRecognition = null;
        setMicState(false);
        showMessage('Không thể bật micro, bạn thử lại nhé.');
    }
}

function moveSentence(direction) {
    stopCurrentActivity();
    if (direction === 'prev') {
        engine.prev();
    } else {
        engine.next();
    }
    render();
}

viEl.hidden = true;
viToggle.textContent = 'Hiện bản dịch';
viToggle.addEventListener('click', () => {
    viEl.hidden = !viEl.hidden;
    viToggle.textContent = viEl.hidden ? 'Hiện bản dịch' : 'Ẩn bản dịch';
});
playBtn.addEventListener('click', playCurrentSentence);
micBtn.addEventListener('click', startRecognition);
prevBtn.addEventListener('click', () => moveSentence('prev'));
nextBtn.addEventListener('click', () => moveSentence('next'));
roundsSelect.addEventListener('change', () => {
    stopCurrentActivity();
    engine.setRounds(roundsSelect.value);
    render();
});
window.addEventListener('beforeunload', stopCurrentActivity, { once: true });

if (!SpeechRecognition) {
    unsupported.hidden = false;
    micBtn.hidden = true;
    if (!unsupported.textContent.trim()) {
        unsupported.textContent = 'Trình duyệt chưa hỗ trợ nhận dạng giọng nói. Bạn vẫn có thể nghe câu mẫu.';
    }
} else {
    unsupported.hidden = true;
}

render();
