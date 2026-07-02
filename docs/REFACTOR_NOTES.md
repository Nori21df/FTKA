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

### Điều chỉnh kế hoạch các phase sau (từ kết quả xác minh)
- **Phase 1**: sửa thêm 6 gate còn sót (billing ×2, payment_debug ×2, admin dashboard ×1, admin audio ×1).
- **Phase 3**: quiz.html là 602 dòng (to gần gấp đôi ước tính); base.html giữ nguyên (helper chung — ngoài phạm vi); settings/ai_logs có thể đề xuất riêng sau.
- **Phase 4**: gộp 4 nhóm breakpoint trùng (900 ×5, 640 ×5, reduced-motion ×5, 1180 ×2); hợp nhất sidebar transform về khối 900px; xử lý 2 selector lặp trong cùng khối.
- **Phase 6**: canonical sẽ phải cân giữa `.dv-cta` (mới, ít usage) vs hệ cũ (~90 usage, admin-button 48); hệ quiz 52px giữ như variant riêng; dọn ~15 class dead trước.
- **Phase 7**: thu hẹp — trục ui_theme DB là dead code; quyết định xoá hay hồi sinh cần bạn chọn ở phase đó.
