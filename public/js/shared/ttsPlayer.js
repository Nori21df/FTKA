// ttsPlayer — phát âm tiếng Hàn 2 tầng, dùng chung mọi trang:
//   1) /api/tts (giọng Google, có cache server) — chất lượng tốt nhất.
//   2) Google chặn/hỏng → fallback Web Speech API của trình duyệt (giọng ko-KR offline)
//      → user VẪN CÓ TIẾNG thay vì im lặng khó hiểu.
// Cũng gắn window.playTTS để tương thích chỗ gọi cũ (generator.html, quizPage.js).

let currentAudio = null;

function stopAll() {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (_e) { /* không hỗ trợ */ }
}

// Đọc bằng giọng trình duyệt. Trả false nếu trình duyệt không hỗ trợ.
function speakFallback(text, onEnd) {
  try {
    const synth = window.speechSynthesis;
    if (!synth || !window.SpeechSynthesisUtterance) return false;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    const ko = synth.getVoices().find((v) => String(v.lang || "").toLowerCase().startsWith("ko"));
    if (ko) u.voice = ko;
    u.rate = 0.95;
    u.onend = onEnd;
    u.onerror = onEnd;
    synth.speak(u);
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Phát 1 đoạn tiếng Hàn. onStart/onEnd tùy chọn (để trang bật/tắt trạng thái nút).
 * onEnd LUÔN được gọi đúng 1 lần (kể cả lỗi cả 2 tầng).
 */
export function playKorean(text, { onStart, onEnd } = {}) {
  stopAll();
  const clean = String(text || "").trim();
  const finish = (() => { let done = false; return () => { if (!done) { done = true; if (onEnd) onEnd(); } }; })();
  if (!clean) { finish(); return; }
  if (onStart) onStart();

  let fellBack = false; // error event + play() reject có thể cùng bắn → chỉ fallback 1 lần
  const fallback = () => {
    if (fellBack) return;
    fellBack = true;
    if (!speakFallback(clean, finish)) finish();
  };

  const audio = new Audio(`/api/tts?text=${encodeURIComponent(clean)}`);
  currentAudio = audio;
  audio.addEventListener("ended", finish);
  audio.addEventListener("error", () => { if (currentAudio === audio) fallback(); });
  audio.play().catch(() => { if (currentAudio === audio) fallback(); });
}

// Tương thích ngược: các chỗ cũ gọi window.playTTS(text) (không cần callback).
window.playTTS = (text) => playKorean(text);
