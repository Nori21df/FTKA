# REFACTOR_NOTES — Nợ kỹ thuật frontend FTKA

Branch: `refactor/frontend-debt`. Kế hoạch gốc: `prompt-refactor-frontend-ftka.md`.
Nguyên tắc: refactor thuần — UI/hành vi giữ nguyên; mọi khác biệt so với mô tả gốc ghi tại đây.

---

## Phase 0 — Khảo sát + lưới an toàn (HOÀN THÀNH)

### Xác minh 8 hạng mục (kết quả fan-out 9 agents đọc-chỉ)

| # | Hạng mục | Kết luận | Khác biệt so với mô tả |
|---|---|---|---|
| 1 | CSS phình + trùng lặp | **Đúng** | `style.css` đúng 5342 dòng. **21 khối @media**: 900px ×5 (dòng 554, 608, 3622, 4513, 5242), 640px ×5, `prefers-reduced-motion` ×5, 1180px ×2, còn lại ×1 (960, 560, 768, min-901). Sidebar drawer transform khai báo 3 lần nhưng **1 trong 3 nằm ở khối 768px** (4035) chứ không phải cả 3 đều 900px → khi gộp phải chọn breakpoint chuẩn (đề xuất 900px, khớp `min-width: 901px` dòng 3575). Có selector lặp 2 lần NGAY TRONG cùng khối: `.dashboard-content` (3782/3788), `.anki-actions` (5271/5277). |
| 2 | Nunjucks `[]` truthy | **Đúng một phần** | Đợt sửa ab6aeff (11 chỗ) chưa hết: **còn sót 6 gate mảng** — `account/billing.html:27,56` (orders/payments; trang đang tắt bởi flag), `admin/payment_debug.html:13,49`, `admin/dashboard.html:33` (recent_errors), `admin/audio.html:10` (records). 5/6 có else empty-state chết. Chưa có lint nào. |
| 3 | JS inline | **Đúng một phần** | quiz.html = **602 dòng** (không phải ~350); grammar.html = 205. Ngoài ra: settings.html 222, base.html 171, admin/ai_logs.html 161, generator.html 158… Vocab đúng là pattern chuẩn (JSON island `#vocab-data` + ES module `/static/js/vocab/`). |
| 4 | `reload()` sau mutation | **Đúng một phần** | 10 call site, đều trong views/ (0 trong public/js). 8/10 là mutation; 2/10 chỉ là nút "chơi lại quiz" (không phải mutation, chỉ cần reset state). Nhiều mutation khác (settings, generator, tiến độ flashcard) đã cập nhật cục bộ sẵn. Phân loại độ khó ghi ở Phase 5. |
| 5 | Nhãn level/topic lặp | **Đúng một phần** | Lặp 8 chuỗi if/elif nhưng **chỉ trong `listening_practice.html`** (form + list + detail) — admin KHÔNG có (hiển thị giá trị thô/`|title`, giữ nguyên). Ngoài level còn **topic (8 giá trị) + length (short/medium)**. Mọi chuỗi đều có else-fallback `replace('_',' ')|title` phải bảo toàn (topic có thể là tiếng Việt tự nhập từ datalist). |
| 6 | Hai hệ nút | **Đúng** (thực tế là **3 hệ**) | (1) `.dv-cta`/`.ghost`: 19 usage / 7 trang. (2) Hệ button-base cũ (~24 selector, dòng 1056–1200): nặng nhất `admin-button`=48, `auth-button`=7, `secondary-cta`=8, `primary-cta`=5 (có cả trong `Flashcard.js`). (3) Hệ quiz JS-render (dòng 3000–3052): min-height 52px, full-width, radius lớn — khác biệt CÓ CHỦ ĐÍCH cho UI làm bài. **~15 class dead** (0 usage): settings-button, grammar-quiz-action, ghost-button, ghost-link, prefs-button, settings-save-button, dashboard-primary/secondary-action, studio-*, dictionary-action, dictionary-filter-button, self-check-button, result-action, completion-action. |
| 7 | Hai trục theme | **Đúng một phần — trục `ui_theme` DB đã CHẾT** | `viewContext.js:83` suy dark/light thuần từ skin (`midnight→dark`); biến `theme` đọc `ui_theme` DB (dòng 80) không được dùng; endpoint `POST /api/preferences` ghi ui_theme **không có caller nào**. Logic midnight→dark duplicate ở client (`preferences.html:52-53`) và server. CSS: midnight nhận token từ CẢ `.ftka-dark-ui` (38) lẫn `body[data-style=midnight]` (143) — data-style thắng nhờ thứ tự file. Không FOUC (server render sẵn attr/class). → Phase 7 sẽ đơn giản hơn kế hoạch: chủ yếu là hợp nhất logic + quyết định số phận dead code, KHÔNG cần theme.js chống FOUC. |
| 8 | Không có test | **Đúng** | 0 devDependencies, 0 test, 0 CI. Chỉ `check` = node --check. |

### Lưới an toàn đã dựng
- devDeps: `@playwright/test` + `vitest` (vitest chưa dùng, dành cho Phase 1–3).
- `playwright.config.ts`: webServer `npm run dev` :3000 (reuse nếu đang chạy), locale vi-VN, timezone Asia/Ho_Chi_Minh, `animations: disabled`, `reducedMotion: reduce`, maxDiffPixelRatio 0.001.
- `tests/visual.spec.ts`: **11 trang × 3 viewport (1440×900 / 899×900 / 390×844) = 33 snapshot**, fullPage.
  - Public (không đăng nhập): `/`, `/login`, `/pricing`.
  - Authed: `/dashboard` (mask `.dv-chart` — nhãn thứ/ngày đổi theo ngày chạy), `/vocab`, `/generator`, `/grammar`, `/grammar-quiz`, `/quiz`, `/listening-practice`, `/preferences`.
- `tests/global-setup.ts`: đăng nhập user test → storageState; seed 2 từ vựng cố định qua chính `/api/import_vocab` (idempotent theo owner+korean): 1 chưa học + 1 đã học, `created_at` 01–02/01/2026 (ngoài cửa sổ chart 7 ngày).
- **`/quiz` ổn định có chủ đích**: server `ORDER BY RANDOM()` + client shuffle, nhưng với đúng **1 từ chưa học** thì mọi hoán vị đều bất biến → snapshot ổn định. Đổi seed = phải xem lại trang này.
- Verification: chạy lần 1 tạo baseline, **lần 2 pass 33/33, không flaky**.

### Quyết định & giới hạn
- **Tài khoản test**: `uxreviewer` / `ReviewPass2026!` — user thường, tạo từ trước qua luồng đăng ký + verify chính thức (link verify lấy từ log server `[DEV VERIFY EMAIL URL]` ở chế độ dev). Nếu DB dev bị xoá: đăng ký lại qua UI rồi mở link trong log.
- **Tài khoản admin test** (được chủ repo duyệt tạo sau báo cáo Phase 0): `uxadmin` / `AdminReview2026!` — đăng ký qua UI + verify như trên, rồi promote `role='admin'` bằng UPDATE trực tiếp DB dev. Nếu DB bị xoá: lặp lại 2 bước đó.
- **Baseline mở rộng sau duyệt**: thêm 4 trang admin × 3 viewport (tổng **15 trang × 3 = 45 snapshot**, chạy lại pass 45/45): `/admin` (mask `#rcConsole`, `#consoleStatus` — console SSE đổi liên tục; `.admin-kpi p` — "+x hôm nay" đổi khi sang ngày), `/admin/users` (mask cột 7 "Đăng nhập gần nhất" — đổi mỗi lần global-setup login), `/admin/vocab`, `/settings`.
- **Trang BỎ QUA visual test (so tay khi refactor đụng tới)**:
  - Các trang admin còn lại (grammar, listening, audio, logs, ai_logs, energy, transactions, user_detail…) — cùng chung khung `admin/base.html` + bảng `admin-table` đã được 4 trang trên phủ; so tay khi phase nào đụng riêng chúng.
  - Chi tiết listening (`?lesson_id=`) — cần bài nghe do AI tạo (tốn quota, không deterministic). So tay.
  - `/account/billing` — feature flag đang tắt (redirect về dashboard).
- Phụ thuộc ngoài: Google Fonts + Material Icons tải từ network — mất mạng khi chạy test sẽ lệch font hàng loạt (rủi ro chấp nhận, máy dev có mạng).
- `AUDIT_REPORT.md` đang bị xoá trong working tree từ trước khi bắt đầu — không thuộc refactor này, không commit thay đổi đó.

---

## Phase 1 — Chốt lỗi Nunjucks array-truthiness (HOÀN THÀNH)

### Đã đổi
- Sửa nốt **6 gate biến-mảng còn sót** sang `|length`: `account/billing.html:27,56` (orders/payments), `admin/payment_debug.html:13,49` (orders/webhook_events), `admin/dashboard.html:33` (recent_errors), `admin/audio.html:10` (records — gate chip đếm).
- Viết `scripts/lint-templates.mjs` + registry `scripts/template-array-vars.json`:
  - Bắt `{% if X %}` / `{% elif X %}` / `{% if not X %}` với X là identifier đơn (kể cả `a.b.c`).
  - Khớp registry (tên đầy đủ hoặc segment cuối) → **vi phạm, exit 1**; hậu tố kiểu mảng (`*s`, `*List`, `*Items`, `*Array`) ngoài registry → **cảnh báo, không fail** (tránh false-positive như `status`, `success`).
  - Ngoại lệ cố ý: comment `{# lint-ok #}` cùng dòng hoặc danh sách `allow` trong JSON (`exists`, `stats`, `status`…).
- Scripts: `lint:templates`; `npm test` = `lint:templates` (Phase 8 sẽ nối thêm unit test).

### Vì sao / quyết định
- Heuristic hậu tố chỉ cảnh báo chứ không fail: tên tiếng Anh kết thúc bằng `s` quá phổ biến (status/success/progress) — registry mới là nguồn chặn cứng; khi thêm biến-mảng mới vào template thì thêm vào registry.
- `record.exists` (boolean) bị heuristic nghi nhầm → thêm `exists` vào allow.

### Thay đổi hình ảnh CÓ CHỦ ĐÍCH (bug fix của phase)
- `/admin` (3 viewport): panel "Lỗi gần đây" với DB không có lỗi trước đây render **bảng rỗng chỉ có header**, nay hiện đúng message "Chưa có lỗi được lưu gần đây." → đã cập nhật 3 snapshot admin-dashboard. Không còn diff nào khác.
- billing/payment_debug/audio có cùng loại thay đổi khi dữ liệu rỗng nhưng không nằm trong bộ snapshot (billing bị flag tắt; payment_debug/audio so tay khi cần).

### Verification
- `npm test` (lint) sạch: 0 vi phạm, 0 cảnh báo.
- Gieo vi phạm giả (`views/_lint_probe.html` với `{% if orders %}`) → script bắt đúng, exit 1 → gỡ → sạch lại.
- Visual: 45/45 pass, chạy 2 lần liên tiếp không flaky (sau khi cập nhật 3 snapshot khai báo ở trên).

---

## Phase 2 — Filter nhãn level/topic/length (HOÀN THÀNH)

### Đã đổi
- `src/utils/labels.js` (module thuần, unit-test được): `levelLabel` (beginner/intermediate/advanced → Sơ/Trung/Cao cấp), `topicLabel` (8 chủ đề), `lengthLabel` (short/medium → Ngắn/Vừa). Fallback giữ đúng hành vi template cũ: level/topic lạ → `replace('_',' ')` + titleize (mô phỏng đúng `|title` Nunjucks — hoa chữ đầu, thường phần còn lại); length lạ → titleize không replace; topic tiếng Việt tự nhập (datalist) pass-through.
- Đăng ký 3 filter trong `src/app.js` (cạnh các filter sẵn có).
- `views/listening_practice.html`: thay đủ **8 chuỗi if/elif** (form ×2, list ×3, detail ×3) bằng `|levelLabel` / `|topicLabel` / `|lengthLabel`.
- Unit test: `tests/unit/labels.test.mjs` (10 test — giá trị chuẩn, hoa thường, giá trị lạ, rỗng/undefined). Scripts: `test:unit`; `npm test` = lint + unit.

### Khác biệt hành vi (chấp nhận, theo spec plan)
- Giá trị **rỗng/undefined** trước render chuỗi rỗng, nay render `—` (plan quy định). Dữ liệu thực tế luôn có giá trị (form validate) nên không trang nào đổi — visual xác nhận.

### Sự cố phát hiện khi verify
- `.env` local có `PORT=8080` đứng sau **BOM** nên grep `^PORT=` trước đó không thấy — server tự chạy lên :8080 khi Playwright khởi động thay vì :3000 (trước giờ preview launcher tự ép PORT=3000 nên không lộ). Fix: `playwright.config.ts` webServer set `env.PORT="3000"` (dotenv không override env sẵn có).

### Verification
- `grep "== 'beginner'"` (và mọi giá trị level/topic/length) trong views/ → **0 kết quả**.
- `npm test` pass (lint 0 vi phạm + 10 unit test).
- Visual 45/45 pass ×2 lần — 3 snapshot listening **không đổi pixel nào** (refactor thuần).

---

## Phase 3 — Tách JS inline ra module (HOÀN THÀNH)

### Đã đổi
- **Quiz** (`views/quiz.html` 767 → **72 dòng**, hết JS inline):
  - `public/js/quiz/quizEngine.js` — logic thuần export được: `normalizeText/escapeHtml/formatText/shuffle/buildCards/buildOptions/buildTurn/requeueSpacing` (port 1:1 từ bản inline; `buildOptions`/`buildTurn` được tham số hoá `cards`/`exampleViPool` thay vì closure).
  - `public/js/quiz/quizPage.js` — DOM binding + state + render (giữ nguyên chuỗi HTML render và `onclick=` → vẫn gắn `window.*` như cũ).
  - Data island: `{% set quiz_page_data = {...} %}` + `<script id="quiz-data" type="application/json">{{ quiz_page_data|tojson }}</script>` (tojson escape `<>&` nên an toàn `</script`); URL `/vocab` truyền qua island (`vocab_url`) thay vì nội suy `url_for` trong JS.
  - `pluralize` không nơi nào gọi → giữ trong engine kèm `// TODO(dead-code?)` theo nguyên tắc plan.
- **Grammar** (`views/grammar.html` 384 → **142 dòng**, hết JS inline):
  - `public/js/grammar/grammarFilters.js` — thuần: `cardMatches`, `shouldShowFilteredEmpty`.
  - `public/js/grammar/grammarPage.js` — toàn bộ handler fetch/status (port nguyên văn); `addGrammarPattern` + `regenerateAllGrammarQuizzes` gắn `window.*` vì markup dùng `onclick=`. Script gốc không có nội suy Nunjucks nên không cần data island.
- Unit tests mới: `tests/unit/quizEngine.test.mjs` (16) + `tests/unit/grammarFilters.test.mjs` (8) — tổng unit 34.

### Verification
- Hành vi (browser thật, user test): `/quiz` — thẻ self-check render, "Hiện đáp án" → banner kết quả, "Ôn lại" → chèn lại hàng đợi, "Xong hôm nay" → màn hoàn thành với link `/vocab` đúng từ island, progress 100%; `/grammar` — filter/search cập nhật "đang hiển thị", hộp lọc-rỗng ẩn đúng khi chưa có dữ liệu, window fns đủ. **0 lỗi console.**
- `npm test` pass (lint + 34 unit). Visual **45/45 ×2** — quiz + grammar không đổi pixel.
- Chưa kiểm tay được trên tài khoản CÓ dữ liệu grammar (thêm mẫu cần gọi AI): các handler mutation là port nguyên văn + filter đã unit-test; khuyến nghị chủ repo bấm thử "Tạo ngữ pháp"/"Quiz"/xoá 1 lần khi tiện.

### Ngoài phạm vi (đề xuất sau)
- `settings.html` (222 dòng inline), `admin/ai_logs.html` (161), `base.html` (171 — helper chung), `generator.html` (158): plan chỉ yêu cầu quiz + grammar; các file này để đợt riêng nếu muốn.

---

## Phase 4 — Hợp nhất style.css — BƯỚC 1: INVENTORY (DỪNG CHỜ XÁC NHẬN)

Công cụ: `scripts/css-inventory.mjs` (giữ lại để chạy kiểm tra trong lúc gộp). Kết quả trên `public/style.css` 5342 dòng:

### Hiện trạng
- **21 khối @media, 8 điều kiện**: `prefers-reduced-motion` ×5 (212, 584, 924, 1247, 5330); `900px` ×5 (554, 608, 3622, 4513, 5242); `640px` ×5 (637, 686, 4074, 4488, 5263); `1180px` ×2 (3551, 5236); `960px`/`560px`/`768px`/`min-901px` ×1 (658, 663, 3735, 3575). 688 rule top-level.
- **Sidebar drawer transform khai báo 6 dòng ở 3 khối**: 900@3627/3636, 768@4029/4038, 900@4518/4529 (giá trị transform giống hệt nhau).
- **Selector lặp trong cùng điều kiện**: 900px — `.app-container`, `.sidebar`, `.sidebar.is-open` (mỗi cái 2 lần); 768px — `html`/`body` ×3, `.dashboard-content` ×3, ~20 selector dictionary ×2; 640px — 5 cặp.
- **DANGER media↔top-level khi dời media xuống cuối** (2 mục, đã tra giá trị — cả 2 là khai báo CHẾT hiện nay):
  1. `.dictionary-group-table-wrap .dictionary-group-table { min-width: 0 }` (768@3994) — bị top-level 4484 (`min-width: 460px`) đè ở mọi viewport ≤768. → Khi gộp: **xoá dòng `min-width: 0`** (giữ `table-layout: fixed`).
  2. `.admin-table-wrap .admin-table { min-width: 760px }` (768@4064) — bị top-level 4484 (460px) đè. → **xoá dòng `min-width: 760px`** (giữ `width: max-content`).
- **Xung đột chéo điều kiện** (17 cặp): hầu hết theo hướng tự nhiên "điều kiện hẹp thắng" → thứ tự rộng→hẹp bảo toàn. **1 ngoại lệ phải xử lý tay**: `.sidebar { height }` — 900@4518 `100dvh` đang THẮNG 768@4029 `100vh` nhờ đứng sau trong file. Khi gộp: **giữ `100dvh`, bỏ `100vh`** (dòng chết). Toàn bộ rule sidebar-drawer của khối 768 sẽ hợp nhất per-property vào khối 900 theo "người thắng hiện tại" (winner = dòng sau).

### Kế hoạch gộp (xin xác nhận)
1. **Chỉ di chuyển khối @media** xuống cuối file thành mục `/* ===== Responsive ===== */`; **KHÔNG xáo trộn thứ tự rule top-level** (trong đó có các khối token `body[data-style=…]` phải đứng sau `.ftka-dark-ui` — xáo trộn top-level là rủi ro không cần thiết). Việc "tổ chức TOC" thực hiện bằng **comment đánh dấu mục trên cấu trúc hiện có** thay vì dời code — đây là cách đọc "ít xâm lấn" của bước 4.4 trong plan; nếu bạn muốn dời vật lý cả top-level thì báo lại.
2. Mỗi điều kiện còn **một** khối, thứ tự rộng→hẹp: `min-width:901` → `1180` → `960` → `900` → `768` → `640` → `560` → cuối cùng `prefers-reduced-motion` (bản chất override, hiện khối cuối 5330 cũng đã ở cuối file).
3. Trong mỗi khối gộp: giữ nguyên thứ tự tương đối các rule (khối gốc trước → rule trước); khai báo trùng hệt → giữ bản đang thắng; 3 khai báo chết nêu trên bị xoá (ghi rõ trong commit); `html/body`/`.dashboard-content` lặp trong cùng khối 768 → hợp nhất theo last-wins.
4. Sidebar drawer: về **một nơi duy nhất** trong khối 900px (đóng + mở), breakpoint chuẩn 900 khớp `min-width:901` của rail desktop.
5. **Gia cố lưới test trước khi gộp**: baseline hiện chỉ có 1440/899/390 — band 641–768 và 561–640 (nơi có 3 khai báo chết + khối 768 khổng lồ 49 rule) chưa được phủ. Đề xuất thêm 2 viewport **768×900** và **640×900** (thành 15 trang × 5 viewport = 75 snapshot, giữ luôn về sau).

**Verification Phase 4**: 75/75 snapshot pass ×2; kiểm tay drawer sidebar tại 899px vs 901px; báo cáo số dòng + số khối @media trước/sau; `node scripts/css-inventory.mjs` sau gộp phải ra: 8 khối / 8 điều kiện, 0 selector lặp cùng điều kiện, sidebar transform đúng 2 dòng (đóng/mở).

### KẾT QUẢ THỰC HIỆN (sau duyệt)
- Lưới test gia cố trước: +2 viewport 768×900/640×900 → **75 baseline**, pass ×2 trước khi đụng CSS.
- `scripts/css-merge-media.mjs` thực hiện dời + gộp cơ học (giữ nguyên thứ tự rule trong từng điều kiện); các chỉnh tay làm bằng edit riêng để soát diff:
  - Drawer sidebar hợp nhất về MỘT nơi trong khối 900px, giá trị = "người thắng" cascade cũ (`height:100dvh`, giữ `transition`/`box-shadow` từ bản 3622, `margin/border-radius/top` từ bản 4513); bản trong khối 768 xoá hẳn (mọi property hoặc trùng hoặc chết; `max-width: calc(100vw - 44px)` thừa vì `width` đã dùng `min()` với cùng giá trị — 0 khác biệt render).
  - Xoá 3 khai báo chết như kế hoạch (2 `min-width` bảng + `height:100vh`), để lại comment giải thích tại chỗ.
  - TOC: banner mục lục đầu file + banner mục Responsive; **không dời rule top-level nào**.
- **Số liệu**: khối @media **21 → 8** (mỗi điều kiện đúng 1 khối, thứ tự min-901 → 1180 → 960 → 900 → 768 → 640 → 560 → reduced-motion); dòng 5342 → 5376 (tăng do comment TOC/giải thích; số rule giảm: bỏ 1 bộ `.app-container/.sidebar/.sidebar.is-open` trùng + 3 khai báo chết); ngoặc cân 850/850.
- **Verification đạt**: visual **75/75 ×2** — không trang nào đổi pixel; inventory sau gộp: 8 khối/8 điều kiện, 900px hết selector trùng, sidebar transform đúng 2 dòng, DANGER media↔top-level = 0; đo bằng Chromium thật: rail sticky 82px tại 901/1440, drawer fixed 320px đóng (−336)/mở (0) tại 899 và 768.
- **Điều chỉnh so với câu chữ kế hoạch**: mục tiêu "0 selector lặp cùng điều kiện" đạt cho lặp **chéo khối** (nguồn gốc của bug cascade); các cặp lặp **trong cùng một khối gốc** (khối 768 cũ: `html/body` ×3, `.dashboard-content` ×3, ~20 selector dictionary ×2; khối 640 cũ: 5 cặp anki/dictionary) giữ nguyên — gộp last-wins các cặp này đòi phân tích thứ tự với các rule xen giữa, rủi ro cao mà không đổi hành vi; ghi lại làm follow-up tùy chọn.
- Renderer của preview panel trả số đo sai (width 2px) khi kiểm tay — đã kiểm chứng lại bằng Playwright/Chromium thật (chuẩn); lưu ý này để lần sau đừng tin số đo preview khi bất thường.

---

## Phase 5 — Thay reload() bằng cập nhật cục bộ (HOÀN THÀNH)

### 10 call site — quyết định từng cái
| Call site | Loại | Xử lý |
|---|---|---|
| `grammarPage.js` xoá ngữ pháp | mutation, DỄ | **→ cục bộ**: gỡ `#grammar-card-{id}`, chèn grid empty-state nếu hết thẻ, chạy lại `applyGrammarFilters()` (giữ bộ lọc + cuộn), toast. |
| `vocab.html` tạo thư mục | mutation, DỄ | **→ cục bộ**: `buildGroupRow`/`ensureGroupTableBody` (createElement, không XSS), thêm `<option>`, giữ `<details>` đang mở. |
| `vocab.html` xoá thư mục | mutation, VỪA | **→ cục bộ**: gỡ hàng + option (thêm `data-group-id` vào `<tr>`), thay bảng bằng empty-state khi hết. |
| `grammar_quiz.html` "Làm lại" | KHÔNG mutation | **→ reset state** `restartGrammarQuiz()` (deck đã ở client), không reload. |
| `vocab.html` reset tiến độ (`resetLearned`) | mutation | **giữ reload** — reset toàn bộ tiến độ + phải dựng lại deck flashcard (nhúng server-side `#vocab-data`); reload là đúng & rẻ nhất. |
| `vocab.html` thêm từ thủ công | mutation, KHÓ | **giữ reload** — thẻ + deck render server-side; dựng markup client dễ lệch template. |
| `vocab.html` import JSON | mutation, KHÓ | **giữ reload** — nhập hàng loạt, nhiều vùng server-render. |
| `grammarPage.js` thêm ngữ pháp (delay 700ms) | mutation, VỪA | **giữ reload** — card grammar render server-side (nhiều cấu trúc); giữ delay đọc thông báo. |
| `quiz.html`/`quizPage.js` "Làm lượt khác" | KHÔNG mutation | **giữ reload** — "lượt khác" = deck trộn MỚI từ server (`ORDER BY RANDOM()`); reload chính là hành vi đúng. |
| `admin/payment_debug.html` dừng/xoá đơn | mutation, DỄ | **giữ reload** — code thanh toán nhạy cảm, không tạo được đơn `pending` để verify local update; trang admin ít dùng. Ghi lại làm follow-up nếu cần. |

### Verification (browser thật, tài khoản test + seed tạm)
- **grammar xoá**: 2→1→0 thẻ, "N đang hiển thị" cập nhật, grid empty-state chèn khi hết, **không rời trang**; 0 lỗi console.
- **vocab tạo thư mục**: tên chứa `<b>"& 학교` → render **text-safe** (không inject), hàng + option thêm, `<details>` **vẫn mở**, count=0.
- **vocab xoá thư mục**: gỡ hàng + option, bảng → empty-state "Chưa có thư mục."
- **grammar-quiz "Làm lại"**: reset về Câu 1/2, Điểm 0, options render lại, nhãn nút về "Câu tiếp theo", **không reload**.
- Dọn sạch seed sau test. `npm test` pass (lint + 34 unit). Visual **75/75 ×2** — không đổi pixel (thêm `data-group-id` không ảnh hưởng render).

---

### Điều chỉnh kế hoạch các phase sau (từ kết quả xác minh)
- **Phase 1**: sửa thêm 6 gate còn sót (billing ×2, payment_debug ×2, admin dashboard ×1, admin audio ×1).
- **Phase 3**: quiz.html là 602 dòng (to gần gấp đôi ước tính); base.html giữ nguyên (helper chung — ngoài phạm vi); settings/ai_logs có thể đề xuất riêng sau.
- **Phase 4**: gộp 4 nhóm breakpoint trùng (900 ×5, 640 ×5, reduced-motion ×5, 1180 ×2); hợp nhất sidebar transform về khối 900px; xử lý 2 selector lặp trong cùng khối.
- **Phase 6**: canonical sẽ phải cân giữa `.dv-cta` (mới, ít usage) vs hệ cũ (~90 usage, admin-button 48); hệ quiz 52px giữ như variant riêng; dọn ~15 class dead trước.
- **Phase 7**: thu hẹp — trục ui_theme DB là dead code; quyết định xoá hay hồi sinh cần bạn chọn ở phase đó.
