# UI_GUIDE — Hệ nút & Theme của FTKA

Tài liệu để KHÔNG phát sinh "hệ thứ ba". Đọc trước khi thêm nút/đổi theme.

## 1. Hệ nút

FTKA có **1 hệ CTA duy nhất** (`.dv-cta`) + một nhóm nút thành phần chuyên biệt (không phải CTA).
Toàn bộ hệ "button-base" legacy đã được migrate & xoá (Phase 6b). **Không tạo class nút mới.**

### 1.1. `.dv-cta` — HỆ CTA DUY NHẤT
| Biến thể | Class | Dùng cho |
|---|---|---|
| Primary | `dv-cta` | hành động chính (nền `--primary`, chữ trắng; Neo: chữ tối) |
| Secondary | `dv-cta ghost` | hành động phụ (nền `--surface`, viền) |
| Danger | `dv-cta danger` | xoá/nguy hiểm (nền `--danger-soft`, chữ đỏ) |
| Full-width | `dv-cta block` | nút chiếm hết chiều ngang (form auth…) |

Kết hợp được: `dv-cta ghost block`, `dv-cta danger` … Có sẵn hover + `:disabled`.
```html
<a class="dv-cta" href="…"><span class="material-icons-outlined">bolt</span> Hành động chính</a>
<button class="dv-cta ghost">Phụ</button>
<button class="dv-cta danger">Xoá</button>
<button class="dv-cta block" type="submit">Gửi</button>
```
Định nghĩa: `public/style.css` (tìm `.dv-cta {`). **Mọi nút phải dùng nhóm này.**
- Trong ô bảng admin: `.admin-table .admin-actions .dv-cta` tự thu nhỏ (32px) — chỉ cần dùng `.dv-cta`.

### 1.2. Nút thành phần chuyên biệt (KHÔNG phải CTA — giữ riêng)
Không thuộc hệ CTA vì khác chức năng/kích thước:
- Quiz làm bài (render JS `public/js/quiz/quizPage.js`): `.option-button`, `.primary-button`,
  `.secondary-button`, `.neutral-button`, `.inline-audio-button`, `.hint-button` (min-height 52px, full-width, canh trái).
- Pill lọc: `.grammar-filter-button` (+`.is-active`).
- Trình phát câu: `.sentence-control-button` (/listening-practice).

### Quy tắc
1. Nút mới → **`.dv-cta`** (+ `ghost`/`danger`/`block`). KHÔNG tạo class nút CTA mới.
2. Nút render bằng JS: chỉ dùng class đã có ở nhóm 1.2, đổi tên phải sửa cả chuỗi JS.
3. Không hồi sinh hệ button-base cũ (đã xoá hoàn toàn).

## 2. Theme — hai trục

FTKA có 2 trục theme, nhưng **hiện chỉ 1 trục điều khiển giao diện**:

| Trục | Là gì | Nguồn | Vai trò hiện tại |
|---|---|---|---|
| **skin** (`data-style`) | 6 palette: studio / warm / midnight / glass / clay / neo | cookie `ftka_style` (mặc định `neo`) | **NGUỒN SỰ THẬT** |
| **sáng/tối** (`ftka-dark-ui`/`ftka-light-ui`) | nền sáng hay tối | **suy trực tiếp từ skin**: `midnight → dark`, còn lại `light` | phụ thuộc skin |
| ~~`ui_theme` (DB)~~ | dark/light lưu theo user | cột `users.ui_theme` + `POST /api/preferences` | **INERT** — không được đọc để render, không có UI gọi (dead code, chờ Phase 7b quyết) |

### Nơi xử lý theme (chỉ 2 chỗ, phải khớp nhau)
- **Server** `src/middleware/viewContext.js`: đọc cookie → `res.locals.ui_style` + `ui_theme_class`, render sẵn lên `<body>` (nên **không FOUC**).
- **Client** `public/js/theme.js` (`window.ftkaTheme`): **nơi DUY NHẤT** phía client đọc/ghi cookie + áp skin. Bộ chọn ở `auth/preferences.html` gọi `ftkaTheme.applyStyle(style)` (áp ngay, không reload).

### Cấm & cách mở rộng
- **Cấm** đọc/ghi cookie `ftka_style` hay set `data-style`/class dark-ui trực tiếp ở nơi khác — luôn qua `theme.js` (client) / `viewContext.js` (server).
- **Thêm skin mới**: (1) thêm block token `body[data-style="X"]` trong `style.css` (đặt SAU `.ftka-dark-ui` để thắng cascade); (2) thêm tên vào `VALID_STYLES` ở **cả** `theme.js` và `viewContext.js`; (3) thêm card vào `preferences.html`; (4) nếu skin nền tối → thêm vào `DARK_STYLES` (theme.js) và điều kiện `midnight` (viewContext.js) — **giữ 2 nơi khớp nhau**.
- **Logic sáng/tối** chỉ nằm ở 2 chỗ trên; đừng rải ra template/JS khác.
