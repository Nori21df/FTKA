// Trang Luyện nghe (/listening-practice) — chuyển từ inline script sang module (quy ước b)
// kèm nâng cấp UX:
//  - Bấm THẲNG vào từng câu để nghe câu đó (trước chỉ play tuần tự); câu đang phát có sóng nhạc.
//  - Câu hỏi thành QUIZ tương tác: giấu đáp án, bấm chọn → đúng/sai + lời giải mới hiện.
//  - Bản dịch/transcript có nút ẩn-hiện (mặc định giấu bản dịch để không spoil bài nghe).
//  - Nút "Tạo bài nghe" có trạng thái chờ (AI + TTS mất 15–30s — trước đây trang đơ không báo gì).

// ── Trình phát từng câu ─────────────────────────────────────────────
function initSentencePlayer(player) {
  const lines = Array.from(player.querySelectorAll("[data-sentence-line]"));
  const status = player.querySelector("[data-sentence-status]");
  const audio = new Audio();
  let currentIndex = 0;

  const setStatus = (msg) => {
    if (!status) return;
    status.textContent = msg || "";
    status.classList.toggle("is-visible", Boolean(msg));
  };
  const setActive = (index, playing) => {
    lines.forEach((line, i) => {
      line.classList.toggle("active", i === index);
      line.classList.toggle("is-playing", playing && i === index);
    });
  };
  const clearActive = () => lines.forEach((l) => l.classList.remove("active", "is-playing"));

  function playAt(index) {
    if (!lines.length) return setStatus("Bài này chưa có âm thanh từng câu.");
    if (index < 0 || index >= lines.length) {
      audio.pause();
      clearActive();
      currentIndex = 0;
      return setStatus("");
    }
    const line = lines[index];
    currentIndex = index;
    const audioPath = line.dataset.audioPath || "";
    if (!audioPath) {
      audio.pause();
      setActive(index, false);
      return setStatus("Chưa có âm thanh cho câu này.");
    }
    setStatus("");
    setActive(index, true);
    audio.src = audioPath;
    audio.currentTime = 0;
    audio.play().catch(() => setStatus("Không phát được âm thanh cho câu này."));
  }

  audio.addEventListener("ended", () => {
    if (currentIndex + 1 < lines.length) return playAt(currentIndex + 1);
    clearActive();
    currentIndex = 0;
  });
  audio.addEventListener("pause", () => { if (lines[currentIndex]) lines[currentIndex].classList.remove("is-playing"); });
  audio.addEventListener("play", () => { if (lines[currentIndex]) lines[currentIndex].classList.add("is-playing"); });
  audio.addEventListener("error", () => setStatus("Không tải được âm thanh cho câu này."));

  // Bấm vào câu → phát đúng câu đó
  lines.forEach((line, i) => {
    line.addEventListener("click", () => playAt(i));
  });

  // Bài cũ không có audio TỪNG CÂU (chỉ có audio toàn bài): thay vì lặp
  // "Chưa có âm thanh" ở mọi dòng, gom thành MỘT thông báo + giấu lỗi từng dòng.
  if (lines.length && lines.every((l) => !l.dataset.audioPath)) {
    player.classList.add("ls-no-sentence-audio");
    setStatus("Bài này chỉ có âm thanh toàn bài (nghe ở trình phát phía trên) — chưa có âm thanh tách từng câu.");
  }

  const on = (action, fn) => player.querySelector(`[data-sentence-action="${action}"]`)?.addEventListener("click", fn);
  on("play", () => {
    const line = lines[currentIndex];
    if (audio.src && audio.paused && line?.dataset.audioPath) {
      audio.play().catch(() => setStatus("Không phát tiếp được âm thanh."));
      setActive(currentIndex, true);
      return;
    }
    playAt(currentIndex);
  });
  on("pause", () => audio.pause());
  on("stop", () => {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    currentIndex = 0;
    clearActive();
    setStatus("");
  });
  on("next", () => { audio.pause(); playAt(currentIndex + 1); });
}

// ── Quiz câu hỏi: giấu đáp án, bấm chọn mới biết đúng/sai ───────────
function initQuiz() {
  document.querySelectorAll("[data-ls-question]").forEach((card) => {
    const choices = Array.from(card.querySelectorAll(".ls-choice"));
    const reveal = card.querySelector("[data-ls-reveal]");
    let answered = false;
    choices.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (answered) return;
        answered = true;
        const correct = btn.dataset.correct === "1";
        btn.classList.add(correct ? "is-correct" : "is-wrong");
        if (!correct) {
          const right = choices.find((c) => c.dataset.correct === "1");
          if (right) right.classList.add("is-correct");
        }
        choices.forEach((c) => { c.disabled = true; });
        if (reveal) reveal.hidden = false;
      });
    });
  });
}

// ── Ẩn/hiện transcript & bản dịch ───────────────────────────────────
function initToggles() {
  document.querySelectorAll("[data-ls-toggle]").forEach((btn) => {
    const target = document.getElementById(btn.dataset.lsToggle);
    if (!target) return;
    const labels = [btn.dataset.showLabel || "Hiện", btn.dataset.hideLabel || "Ẩn"];
    const render = () => { btn.textContent = target.hidden ? labels[0] : labels[1]; };
    btn.addEventListener("click", () => { target.hidden = !target.hidden; render(); });
    render();
  });
}

// ── Trạng thái chờ khi tạo bài (AI + TTS lâu) ───────────────────────
function initGenerateWait() {
  const form = document.querySelector("[data-ls-generate-form]");
  if (!form) return;
  form.addEventListener("submit", () => {
    const btn = form.querySelector("[data-generate-btn]");
    const waitEl = form.querySelector("[data-generate-wait]");
    if (btn) {
      btn.disabled = true;
      btn.classList.add("is-loading");
      btn.innerHTML = '<span class="ls-spinner" aria-hidden="true"></span> Đang tạo…';
    }
    if (waitEl && window.ftkaWait) {
      waitEl.hidden = false;
      window.ftkaWait(waitEl, [
        "AI đang soạn hội thoại theo chủ đề của bạn…",
        "Đang dịch và soạn câu hỏi luyện nghe…",
        "Đang tạo giọng đọc cho từng câu (hơi lâu chút)…",
        "Sắp xong rồi, chờ thêm một chút nhé…",
      ]);
    }
  });
}

// ── Xác nhận xoá (chuyển từ onsubmit inline vào module) ─────────────
function initDeleteConfirm() {
  document.querySelectorAll(".saved-lesson-delete-form").forEach((form) => {
    form.addEventListener("submit", (e) => {
      if (!confirm("Xoá bài nghe đã lưu này?")) e.preventDefault();
    });
  });
}

document.querySelectorAll("[data-sentence-player]").forEach(initSentencePlayer);
initQuiz();
initToggles();
initGenerateWait();
initDeleteConfirm();
