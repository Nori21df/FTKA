// Trang duyệt từ vựng chuyên ngành (tổng quát theo `domain`, đọc từ JSON island).
// Duyệt/tìm/lọc catalog (infinite scroll) + yêu thích / đánh dấu đã học + học flashcard có SRS.
// Thẻ thích nghi 2 dạng dữ liệu: có định nghĩa VN (CNTT) hoặc chỉ Hàn↔Anh (Y khoa).

const listEl = document.getElementById("itvList");
const statusEl = document.getElementById("itvStatus");
const searchEl = document.getElementById("itvSearch");

const meta = JSON.parse(document.getElementById("itv-meta").textContent);
const initial = JSON.parse(document.getElementById("itv-initial").textContent);
const DOMAIN = meta.domain || "cntt";

const state = { q: meta.query || "", filter: meta.filter || "all", offset: 0, total: meta.total || 0, loading: false, done: false };

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ── TTS (cache server /api/tts) ──────────────────────────────────
let audio = null;
function playTts(text, btn) {
  if (audio) { audio.pause(); audio = null; }
  audio = new Audio("/api/tts?text=" + encodeURIComponent(text));
  btn.classList.add("is-playing");
  const stop = () => btn.classList.remove("is-playing");
  audio.addEventListener("ended", stop);
  audio.addEventListener("error", stop);
  audio.play().catch(stop);
}

// ── Danh sách ───────────────────────────────────────────────────
function meaningHtml(t) {
  if (t.definition_vi) return `<p class="itv-vi">${esc(t.definition_vi)}</p>`;
  if (t.gloss_en) return ""; // Hàn↔Anh: đã có tag tiếng Anh, không cần dòng nghĩa
  return '<p class="itv-vi"><em>(chưa có nghĩa)</em></p>';
}

function cardHtml(t) {
  return `<article class="itv-card" data-key="${esc(t.key)}">
    <div class="itv-card-head">
      <div class="itv-term">
        <h3 class="itv-ko kr" lang="ko">${esc(t.korean)}<button type="button" class="itv-tts" data-tts="${esc(t.korean)}" title="Nghe" aria-label="Nghe">
          <span class="material-icons-outlined" aria-hidden="true">volume_up</span></button></h3>
        ${t.gloss_en ? `<span class="itv-gloss">${esc(t.gloss_en)}</span>` : ""}
      </div>
      <div class="itv-actions">
        <button type="button" class="itv-fav${t.favorite ? " is-on" : ""}" data-fav aria-pressed="${t.favorite ? "true" : "false"}" title="Yêu thích" aria-label="Yêu thích">♥</button>
        <button type="button" class="itv-learned${t.learned ? " is-on" : ""}" data-learned>${t.learned ? "✓ Đã học" : "Đánh dấu học"}</button>
      </div>
    </div>
    ${meaningHtml(t)}
  </article>`;
}

function render(terms, append) {
  const html = terms.map(cardHtml).join("");
  if (append) listEl.insertAdjacentHTML("beforeend", html);
  else listEl.innerHTML = html || '<p class="itv-empty">Không tìm thấy thuật ngữ nào.</p>';
}

async function load(reset) {
  if (state.loading) return;
  if (reset) { state.offset = 0; state.done = false; }
  else if (state.done) return;
  state.loading = true;
  statusEl.textContent = "Đang tải…";
  try {
    const url = `/api/it-terms?domain=${encodeURIComponent(DOMAIN)}&q=${encodeURIComponent(state.q)}&filter=${state.filter}&offset=${state.offset}&limit=40`;
    const d = await (await fetch(url)).json();
    state.total = d.total;
    render(d.terms, !reset);
    state.offset += d.terms.length;
    state.done = !d.has_more;
    statusEl.textContent = state.done ? `${state.total} thuật ngữ` : "";
  } catch (e) {
    statusEl.textContent = "Lỗi tải dữ liệu, thử lại nhé.";
  }
  state.loading = false;
}

render(initial, false);
state.offset = initial.length;
state.done = initial.length >= state.total;
statusEl.textContent = state.done ? `${state.total} thuật ngữ` : "";

const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) load(false); }, { rootMargin: "400px" });
io.observe(statusEl);

// ── Tìm kiếm + lọc ──────────────────────────────────────────────
let searchTimer = null;
searchEl.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.q = searchEl.value.trim(); load(true); }, 300);
});

document.querySelectorAll(".itv-filter").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".itv-filter").forEach((x) => x.classList.remove("is-active"));
  b.classList.add("is-active");
  state.filter = b.dataset.filter;
  load(true);
}));

// ── Tương tác thẻ (delegated) ───────────────────────────────────
function post(path, body) {
  return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain: DOMAIN, ...body }) });
}

listEl.addEventListener("click", async (e) => {
  const ttsBtn = e.target.closest("[data-tts]");
  if (ttsBtn) { playTts(ttsBtn.dataset.tts, ttsBtn); return; }
  const card = e.target.closest(".itv-card");
  if (!card) return;
  const key = card.dataset.key;

  const fav = e.target.closest("[data-fav]");
  if (fav) {
    try {
      const d = await (await post("/api/it-terms/favorite", { key })).json();
      fav.classList.toggle("is-on", d.favorite);
      fav.setAttribute("aria-pressed", d.favorite ? "true" : "false");
    } catch (_e) { /* im lặng */ }
    return;
  }

  const learned = e.target.closest("[data-learned]");
  if (learned) {
    const on = !learned.classList.contains("is-on");
    post("/api/it-terms/learned", { key, learned: on }).catch(() => {});
    learned.classList.toggle("is-on", on);
    learned.textContent = on ? "✓ Đã học" : "Đánh dấu học";
    return;
  }

  card.classList.toggle("is-open"); // bấm thân thẻ → mở/thu định nghĩa dài
});

// ── Học thẻ (flashcard + SRS) ───────────────────────────────────
const studyEl = document.getElementById("itvStudy");
const koEl = document.getElementById("itvStudyKo");
const glossEl = document.getElementById("itvStudyGloss");
const viEl = document.getElementById("itvStudyVi");
const revealWrap = document.getElementById("itvStudyReveal");
const revealBtn = document.getElementById("itvRevealBtn");
const gradeBtns = document.getElementById("itvGradeBtns");
const progressEl = document.getElementById("itvStudyProgress");
let deck = [];
let di = 0;

function showCard() {
  const t = deck[di];
  const answer = t.definition_vi || t.gloss_en || "(chưa có nghĩa)";
  progressEl.textContent = `Thẻ ${di + 1} / ${deck.length}`;
  koEl.textContent = t.korean;
  // gloss tiếng Anh chỉ hiện ở MẶT TRƯỚC khi nó KHÔNG phải đáp án (tức có định nghĩa VN riêng),
  // để không lộ đáp án với dữ liệu Hàn↔Anh.
  glossEl.textContent = (t.definition_vi && t.gloss_en) ? t.gloss_en : "";
  viEl.textContent = answer;
  revealWrap.hidden = true;
  revealBtn.hidden = false;
  gradeBtns.hidden = true;
}

document.getElementById("itvStudyBtn").addEventListener("click", async () => {
  try {
    const d = await (await fetch(`/api/it-terms/deck?domain=${encodeURIComponent(DOMAIN)}`)).json();
    deck = d.deck || [];
  } catch (_e) { deck = []; }
  if (!deck.length) { statusEl.textContent = "Chưa có thẻ để học — đánh dấu ♥ hoặc \"Đánh dấu học\" vài thuật ngữ trước."; return; }
  di = 0;
  studyEl.hidden = false;
  showCard();
});

document.getElementById("itvStudyClose").addEventListener("click", () => { studyEl.hidden = true; });

revealBtn.addEventListener("click", () => {
  revealWrap.hidden = false;
  revealBtn.hidden = true;
  gradeBtns.hidden = false;
});

gradeBtns.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-grade]");
  if (!btn) return;
  post("/api/it-terms/review", { key: deck[di].key, grade: btn.dataset.grade }).catch(() => {});
  di += 1;
  if (di >= deck.length) {
    studyEl.hidden = true;
    statusEl.textContent = "Đã học xong bộ thẻ! 🎉 Bấm \"Học thẻ\" để lấy bộ mới.";
    return;
  }
  showCard();
});
