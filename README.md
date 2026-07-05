# FTKA — Học tiếng Hàn cho người Việt

Web app học tiếng Hàn dành cho người Việt: từ vựng, ngữ pháp, luyện đọc/nghe/viết/nói,
ôn tập ngắt quãng (SRS) và **từ vựng chuyên ngành**. Server-rendered, không framework front-end.

## Công nghệ

- **Backend:** Node.js + Express, template **Nunjucks** (server-rendered MPA).
- **Frontend:** **vanilla JS** (ES module tĩnh trong `public/js/`), **CSS thuần** một file `public/style.css`.
  Không React/Vue/Vite/Tailwind, không bundler.
- **DB:** PostgreSQL.
- **AI:** router đa-provider (Google Gemini / Groq / Cloudflare / NVIDIA / OpenRouter) có
  fallback + timeout + đua provider cho tác vụ nhẹ (xem `src/services/aiService.js`, `src/ai/`).
- **Realtime/PWA:** Socket.IO (năng lượng), manifest + service worker cache-first cho `/static/*`.

## Tính năng chính

- **Dashboard** — heatmap 15 tuần, chuỗi ngày học, thưởng mốc chuỗi.
- **Từ vựng** — tạo/thêm bằng AI theo chủ đề, flashcard, **SRS ngắt quãng** (SM-2 lite), thư mục, xuất **Anki** TSV.
- **Ngữ pháp** — mẫu ngữ pháp + quiz tự sinh.
- **Học hôm nay** — đoạn văn AI mỗi ngày: bấm-từ-tra-nghĩa, nghe từng câu, quiz đọc hiểu (prewarm khi login).
- **Bảng chữ cái Hangul** — bảng jamo + quiz ghép âm.
- **Luyện viết** (AI chấm), **Luyện phát âm** (Web Speech, client-only), **TOPIK** theo cấp, **luyện nghe** AI.
- **Từ vựng chuyên ngành** (`/chuyen-nganh`) — hub chọn lĩnh vực; hiện có **CNTT (bộ TTA, ~19.620 thuật ngữ
  Hàn–Việt)**: duyệt/tìm/lọc, đánh dấu yêu thích/đã học, học flashcard có SRS. Cấu trúc sẵn sàng thêm ngành mới.
- **Tra từ nhanh** ở topbar (`/api/dict`, LRU cache + đua provider), **nhắc học qua email** (19–22h giờ VN).

## Chạy dev

```bash
npm install
npm run dev        # node src/server.js — PORT theo .env (mặc định 3000; .env hiện đặt 8080)
```

Cần **PostgreSQL** (mặc định `postgresql://postgres:postgres@localhost:5432/ftka`). Cấu hình qua `.env`
(khoá AI, SMTP, `SESSION_SECRET`, `DATABASE_URL`…). Ở dev, link xác minh email được in ra log server
(`[DEV VERIFY EMAIL URL] ...`) thay vì gửi mail.

Lần đầu khởi động, server tự tạo schema (idempotent) và **seed bộ từ vựng CNTT** từ
`assets/it-terms.json.gz` vào bảng `it_terms` (~19.620 dòng, một lần).

## Kiểm thử

```bash
npm test                    # NHANH: lint template + unit (vitest)
npm run lint:templates      # chặn lỗi Nunjucks array-truthiness (quy ước a)
npm run test:unit           # logic thuần: SRS, quiz engine, similarity, providerStats…
npm run test:e2e            # Playwright smoke hành vi
npm run test:visual         # snapshot chống hồi quy UI (nhiều trang × 5 viewport)
npm run test:visual:update  # cập nhật baseline khi đổi UI CÓ CHỦ ĐÍCH
```

Test cần tài khoản dev đã verify email: `uxreviewer` (thường) và `uxadmin` (admin).

## Cấu trúc

```
src/
  server.js            # boot: ensure schema + seed + scheduler + listen
  app.js               # express + nunjucks (globals: url_for, asset_v cache-bust)
  routes/              # web.js (trang), api.js, admin.js
  services/            # aiService, itTermsService, dailyService, srsService, …
  ai/                  # router đa-provider + adapter từng provider
  config/              # env, specialties (danh mục chuyên ngành)
  utils/               # urls (registry route), srs, labels …
views/                 # template Nunjucks (extends base.html)
public/
  js/<trang>/          # ES module theo trang (logic thuần → export + unit test)
  style.css            # CSS thuần một file
assets/it-terms.json.gz# seed từ vựng CNTT (data/ bị gitignore)
docs/                  # UI_GUIDE, REFACTOR_NOTES, refactor-plan
```

## 4 quy ước bắt buộc (chi tiết trong `CLAUDE.md`)

1. **Gate mảng trong `{% if %}` phải dùng `| length`** — Nunjucks coi `[]` là truthy (`npm run lint:templates` chặn vi phạm).
2. **Không viết JS inline mới trong template** — data động nhúng qua `<script type="application/json">` + logic ở `public/js/<trang>/`.
3. **Chỉ dùng hệ nút chuẩn `.dv-cta`** (`ghost`/`danger`/`block`) — xem `docs/UI_GUIDE.md`.
4. **Theme chỉ thao tác qua `public/js/theme.js` (client) / `src/middleware/viewContext.js` (server).**

## Triển khai

Server production dùng **pm2** tại `/DATA/FTKA` (truy cập qua Tailscale). Đưa code lên:

```bash
ssh nori@100.100.25.25 'cd /DATA/FTKA && git pull --ff-only origin main && node --check src/server.js && pm2 restart FTKA'
```

Boot đầu sau deploy tự seed `it_terms` từ asset đã commit — không cần bước dữ liệu thủ công.
