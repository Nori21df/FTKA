# CLAUDE.md — Hướng dẫn cho dev / AI khi làm việc trên FTKA

FTKA = web app học tiếng Hàn cho người Việt. **Server-rendered** (Node + Express + Nunjucks),
**vanilla JS** (ES module tĩnh trong `public/js/`), **CSS thuần** một file `public/style.css`.
KHÔNG có React/Vue/Vite/Tailwind — đừng thêm framework/bundler.

**Tính năng chính:** dashboard (heatmap 15 tuần, thưởng mốc chuỗi), tạo/thêm từ vựng AI, flashcard
(+SRS ngắt quãng SM-2 lite: `src/utils/srs.js`), ngữ pháp + quiz, **Học hôm nay** (đoạn văn AI/ngày:
bấm-từ-tra-nghĩa, nghe từng câu, quiz đọc hiểu, lịch sử), **Bảng chữ cái Hangul** (+quiz ghép âm),
ôn tập/kiểm tra, **Luyện viết** (AI chấm), **Luyện phát âm** (Web Speech, client-only), **TOPIK**
theo cấp, luyện nghe AI, tra từ nhanh topbar (`/api/dict`, LRU cache), xuất Anki TSV, PWA
(manifest + `/sw.js` cache-first chỉ `/static/*`), email nhắc học (scheduler, 19–22h VN),
**Chuyên ngành** (`/chuyen-nganh` hub → `/chuyen-nganh/:slug`): catalog từ vựng DÙNG CHUNG theo
`domain` (bảng `it_terms` + tiến độ user `it_term_progress`, seed từ `assets/*.json.gz` lúc boot;
registry `src/config/specialties.js` — thêm ngành = 1 entry + 1 asset; service `itTermsService`).

## Chạy dev
```bash
npm run dev            # node src/server.js — mặc định PORT 3000 (lưu ý .env local có thể đặt PORT khác)
```
Cần Postgres (mặc định `postgresql://postgres:postgres@localhost:5432/ftka`). Ở dev, link xác minh
email được in ra log server (`[DEV VERIFY EMAIL URL] ...`) thay vì gửi mail.

## Test
```bash
npm test               # NHANH — chạy thường xuyên: lint template + unit (vitest)
npm run lint:templates # chặn lỗi Nunjucks array-truthiness (xem quy ước a)
npm run test:unit      # vitest tests/unit — logic thuần (labels, quiz engine, grammar filters)
npm run test:e2e       # Playwright smoke hành vi (home, quiz, theme, sidebar mobile)
npm run test:visual    # Playwright snapshot 15 trang × 5 viewport (baseline chống hồi quy UI)
npm run test:visual:update  # cập nhật baseline khi thay đổi UI CÓ CHỦ ĐÍCH
```
- Test cần tài khoản dev: `uxreviewer` (thường) và `uxadmin` (admin) — đã verify email. Tạo lại:
  đăng ký qua `/register` → mở link `[DEV VERIFY EMAIL URL]` trong log → (admin) `UPDATE users SET role='admin'`.
- `test:visual` mask vùng động (chart theo ngày, console SSE, last-login…). Trang admin ngoài
  4 trang đã phủ + chi tiết listening (cần bài AI) so tay.

## 4 QUY ƯỚC PHẢI GIỮ

**(a) Gate mảng trong `{% if %}` phải dùng `| length`.**
Nunjucks coi `[]` là truthy → `{% if items %}` KHÔNG gate được empty-state. Viết `{% if items|length %}`.
`npm run lint:templates` chặn vi phạm; biến-mảng mới → thêm vào `scripts/template-array-vars.json`.

**(b) KHÔNG viết JS inline mới trong template.**
Theo pattern module: data động nhúng qua `<script type="application/json" id="...-data">{{ x|tojson }}</script>`,
logic ở `public/js/<trang>/` (thuần → export + unit test; DOM binding mỏng). Mẫu: `public/js/quiz/`,
`public/js/grammar/`, `public/js/vocab/`.

**(c) Chỉ dùng hệ nút chuẩn — xem `docs/UI_GUIDE.md`.**
Nút MỚI dùng `.dv-cta` / `.dv-cta.ghost`. KHÔNG mở rộng hệ button-base legacy, KHÔNG tạo hệ nút thứ ba.

**(d) Theme chỉ thao tác qua `public/js/theme.js` (client) / `src/middleware/viewContext.js` (server).**
Cấm đọc/ghi cookie `ftka_style` hay set `data-style`/class dark-ui trực tiếp ở nơi khác. Thêm skin:
làm khớp cả `theme.js` và `viewContext.js` (xem `docs/UI_GUIDE.md` mục Theme).

## Tài liệu refactor
- `docs/refactor-plan.md` — kế hoạch gốc 8 hạng mục.
- `docs/REFACTOR_NOTES.md` — nhật ký từng phase (đã làm gì, vì sao, còn nợ gì).
- `docs/UI_GUIDE.md` — hệ nút + theme.
