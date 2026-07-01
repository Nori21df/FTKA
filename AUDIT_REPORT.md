# FTKA — Báo cáo audit & nâng cấp tự động

_Phiên làm việc tự động (không đụng server production). Toàn bộ thay đổi nằm trên nhánh `ai-router`, mỗi phần một commit. Xác minh bằng `node --check` + rà cân bằng cú pháp; **chưa chạy runtime** (bạn ngủ, không test được) nên mình chỉ chọn các thay đổi an toàn, khép kín._

## Tổng quan
Đã chạy 4 luồng audit song song (auth/phân quyền, injection/XSS/SSRF, bug/độ bền, tính năng thiếu). **Kết luận: codebase vốn đã khá chắc** — SQL tham số hóa, chặn path traversal, token hash + dùng-một-lần, session regenerate chống fixation, mọi truy vấn dữ liệu người dùng đều scope theo `owner_user_id`, `/admin` có `adminRequired` toàn bộ, đã có rate-limit cho login/AI. Không có lỗ hổng **Critical** thực thi được. Các bản vá dưới đây xử lý các điểm còn lại + vá vài lỗi độ bền có thật.

---

## Đã sửa (đã commit)

### 1. Độ bền / reliability — commit `a369e6d`
| Vấn đề | Sửa |
|---|---|
| `aiLogService` thiếu `setMaxListeners` → nhiều tab admin mở SSE gây `MaxListenersExceededWarning` | Đặt `setMaxListeners(50)` |
| `ttsService.generateAudio` dùng `fs.writeFileSync` → **chặn event loop** cho mọi request khi ghi file mp3 | Chuyển `await fs.promises.writeFile` |
| DB pool mặc định, không có `pool.on('error')` → lỗi client nhàn rỗi **crash tiến trình**; `withClient` không `ROLLBACK` khi lỗi → churn kết nối | Cấu hình pool (max 20, timeout) + handler `error` + `ROLLBACK` khi lỗi |
| `parseStyleCookie` gọi `decodeURIComponent` không bọc → cookie `ftka_style=%` làm **500 mọi trang** | Bọc try/catch, trả `null` |
| `generateGrammarData` giả định AI trả object → provider fallback trả mảng/chuỗi gây lưu bản ghi rỗng / TypeError | Chặn nếu không phải object |
| Không có handler `unhandledRejection`/`uncaughtException` | Thêm log ở `server.js` |

### 2. Bảo mật — commit `f9a5446`
| Vấn đề | Sửa |
|---|---|
| Middleware redirect HTTPS (mình thêm trước đó) dùng `req.headers.host` → **host-header/open-redirect** | Redirect theo origin chuẩn từ `env.appUrl` |
| Fallback session secret là hằng số công khai `"dev-only-change-me"` → giả mạo chữ ký cookie nếu thiếu `SESSION_SECRET` | Sinh secret ngẫu nhiên mỗi lần khởi động + cảnh báo |
| `GET /api/tts` **không auth, không rate-limit** → proxy TTS mở, đốt quota Google | Thêm `aiLimiter` + cap 200 ký tự |
| Route audio bài nghe không yêu cầu đăng nhập | Thêm `loginRequired` |
| `generator.html` dựng `onclick="playTTS('${...}')"` → **DOM-XSS** (entity decode thoát chuỗi JS) | Đổi sang `data-tts` + listener |
| SePay lưu **nguyên header `x-secret-key` (= IPN secret) plaintext** vào `webhook_events` | Redact `x-secret-key`/`authorization`/`cookie` trước khi lưu |
| `admin/base.html` flash message dùng `dump\|safe` (không escape `<>&`) | Đổi sang filter `tojson` (có escape) |

### 3. Tính năng bổ sung
- **`a369e6d`+`7c4a66d`** — KPI năng lượng ở admin dashboard: `total_energy_balance` / `total_energy_spent` giờ tính thật từ `user_energy`/`energy_transactions` (trước hardcode 0 "chưa khả dụng"), có `.catch(()=>0)`.
- **`7c4a66d`** — endpoint `GET /healthz` (không auth, trước session/log) trả `{ok, uptime}`.
- **`688c76f`** — trang **`/admin/transactions`** thật (trước là stub "chưa khả dụng"): danh sách giao dịch năng lượng có phân trang, chỉ đọc, cô lập trong admin.
- **`72667f1`** — trang **404 có thương hiệu** (theo theme) + `Cache-Control: no-store` cho các trang xác thực.

---

## CỐ Ý KHÔNG SỬA (cần bạn quyết định / cần test) — quan trọng

Các mục sau **có thật** nhưng mình không tự sửa vì rủi ro làm hỏng app mà bạn không test được. Khi thức dậy hãy cân nhắc:

1. **CSRF** — không có CSRF token. Hiện được `SameSite=Lax` (mặc định) che chắn cho POST. **Rủi ro thật nếu `SESSION_SAME_SITE=none`.** Thêm CSRF token đúng cách cần test kỹ toàn bộ form/AJAX → không làm khi bạn ngủ. _Việc cần làm: đảm bảo không set `SESSION_SAME_SITE=none`; cân nhắc thêm `csrf-csrf`._
2. **helmet CSP đang tắt** (`contentSecurityPolicy:false`). Bật CSP nghiêm dễ vỡ inline script/toast/fonts → phải test. Để nguyên.
3. **`cookie.secure` & bắt buộc HTTPS gắn với `NODE_ENV==='production'`.** Nếu server không đặt `NODE_ENV=production` thì cookie không `secure`. Đổi code có thể **làm hỏng đăng nhập** (express-session không gửi cookie qua kết nối "không an toàn" khi `proxy=false`) → **không đụng**. _Việc cần làm: xác nhận server có `NODE_ENV=production` và `SESSION_SECRET` trong `.env`._
4. **Không có hàng đợi giới hạn AI đồng thời** — quota/circuit-breaker là "mềm", có thể vượt khi nhiều request song song. Thêm `p-limit` cần cài dep + test → để bạn duyệt.
5. **Audio bài nghe chưa scope theo chủ sở hữu** (giờ đã cần đăng nhập, nhưng user A về lý thuyết vẫn xem được file của user B nếu đoán được tên — tên là UUID ngẫu nhiên nên rủi ro thấp). Scope theo owner cần sửa cẩn thận, để sau.
6. **Tính năng chưa có backing data** (Writing/chấm bài, Streak per-user, AI-usage tổng hợp) — không có bảng dữ liệu, phạm vi lớn → **không làm**.

---

## KHUYẾN NGHỊ ƯU TIÊN CAO (ngoài code)

- **Vấn đề Safe Browsing của `qzz.io`** (Search Console báo "Harmful downloads", Sample URLs N/A): gần như chắc chắn là **danh tiếng bị kế thừa từ domain dùng chung `qzz.io`**, không phải lỗi nội dung của bạn (thư mục `public/` đã kiểm tra — sạch). Với 100 user, **nên đổi sang domain riêng** (~1–3 USD/năm) để thoát cờ này; hạ tầng Cloudflare Tunnel đã sẵn, đổi rất nhanh.
- **Xác nhận `.env` server** có `NODE_ENV=production` và `SESSION_SECRET` mạnh (xem mục 3 ở trên).

---

## Triển khai (khi bạn sẵn sàng — mình KHÔNG tự deploy theo yêu cầu)
Các commit đã ở nhánh `ai-router` (đã/ sẽ push lên origin). Khi muốn đưa lên server:
```bash
ssh nori@100.100.25.25 'cd /DATA/FTKA && git pull --ff-only origin ai-router && node --check src/server.js && pm2 restart FTKA'
```
Không có thay đổi dependency nên **không cần `npm install`**. Không có migration bắt buộc (bảng energy đã tồn tại).
