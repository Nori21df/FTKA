// Trang Luyện thi TOPIK (/topik): bộ 10 câu theo cấp độ, chấm đạt/trượt (>= 60%).
const dataNode = document.getElementById('topik-data');
let deck = [];
try { deck = JSON.parse(dataNode?.textContent || '[]') || []; } catch (_) { deck = []; }

const progressEl = document.getElementById('tkProgress');
const scoreEl = document.getElementById('tkScore');
const questionEl = document.getElementById('tkQuestion');
const translationEl = document.getElementById('tkTranslation');
const optionsEl = document.getElementById('tkOptions');
const feedbackEl = document.getElementById('tkFeedback');
const nextBtn = document.getElementById('tkNext');

let index = 0;
let correct = 0;
let answered = false;

function render() {
    const item = deck[index];
    answered = false;
    progressEl.textContent = `Câu ${index + 1} / ${deck.length}`;
    scoreEl.textContent = `Đúng ${correct}`;
    questionEl.textContent = item.question_kr;
    translationEl.textContent = item.question_vi || '';
    feedbackEl.classList.remove('is-visible');
    feedbackEl.textContent = '';
    optionsEl.innerHTML = '';
    item.options.forEach((option, oi) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'grammar-quiz-option';
        button.textContent = option;
        button.addEventListener('click', () => answer(oi));
        optionsEl.appendChild(button);
    });
}

function answer(chosen) {
    if (answered) return;
    answered = true;
    const item = deck[index];
    const correctIndex = Number(item.correct_index);
    [...optionsEl.children].forEach((button, oi) => {
        if (oi === correctIndex) button.classList.add('is-correct');
        else if (oi === chosen) button.classList.add('is-wrong');
    });
    if (chosen === correctIndex) correct += 1;
    scoreEl.textContent = `Đúng ${correct}`;
    feedbackEl.textContent = item.explanation_vi || `Đáp án đúng: ${item.correct_answer || item.options[correctIndex]}`;
    feedbackEl.classList.add('is-visible');
}

function finish() {
    const percent = Math.round((correct / deck.length) * 100);
    const passed = percent >= 60;
    questionEl.textContent = passed ? 'Đạt!' : 'Chưa đạt';
    translationEl.textContent = `Kết quả: ${correct}/${deck.length} câu đúng (${percent}%). ${passed ? 'Bạn đã vượt mốc 60%.' : 'Cần từ 60% — ôn lại ngữ pháp rồi thử lại nhé.'}`;
    optionsEl.innerHTML = '';
    feedbackEl.classList.remove('is-visible');
    nextBtn.textContent = 'Làm lại';
    nextBtn.onclick = restart;
}

function restart() {
    index = 0;
    correct = 0;
    nextBtn.textContent = 'Câu tiếp theo';
    nextBtn.onclick = next;
    render();
}

function next() {
    if (!answered) return; // phải trả lời trước
    if (index >= deck.length - 1) return finish();
    index += 1;
    render();
}

if (deck.length) {
    nextBtn.onclick = next;
    render();
}
