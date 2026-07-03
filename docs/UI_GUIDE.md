# UI_GUIDE — Hệ nút & Theme của FTKA

Tài liệu để KHÔNG phát sinh "hệ thứ ba". Đọc trước khi thêm nút/đổi theme.

## 1. Hệ nút

FTKA có **3 nhóm nút**, mỗi nhóm một mục đích rõ ràng. Không tạo class nút mới ngoài các nhóm này.

### 1.1. `.dv-cta` — CTA CHUẨN (dùng cho nút MỚI)
Nút hành động chính/phụ trên các trang ứng dụng.
- `.dv-cta` — **primary** (nền `--primary`, chữ trắng; Neo: chữ tối).
- `.dv-cta.ghost` — **secondary** (nền `--surface`, viền `--line-strong`).

```html
<a class="dv-cta" href="…"><span class="material-icons-outlined">bolt</span> Hành động chính</a>
<button type="button" class="dv-cta ghost">Hành động phụ</button>
```
Định nghĩa: `public/style.css` (tìm `.dv-cta {`). **Mọi nút mới nên dùng nhóm này.**

### 1.2. Hệ "button-base" — LEGACY dùng chung (đừng mở rộng)
Một base rule chung + biến thể primary/secondary, gắn cho các alias theo trang cũ.
Các class **còn sống**: `.admin-button` (+`.primary`/`.secondary`/`.danger`), `.auth-button` (+`.secondary`),
`.primary-cta`, `.secondary-cta`, `.ghost-button`, `.public-primary-button`, `.public-secondary-button`,
`.dictionary-add-button`, `.dictionary-secondary-action`, `.grammar-action`, `.grammar-secondary-action`,
`.listening-generate-button`, `.settings-link`, `.settings-ghost-button`, `.topbar-auth-link`.
- Bao phủ admin (nặng nhất — `admin-button` ~48 chỗ/18 file), auth, settings, payment, public.
- **KHÔNG thêm alias mới** vào nhóm này. Trang mới → dùng `.dv-cta`.
- Phase 6 đã xoá **15 class 0-usage** khỏi nhóm này (studio-*, dashboard-*-action, dictionary-action,
  dictionary-filter-button, settings-save-button, settings-button, ghost-link, grammar-quiz-action,
  prefs-button, studio-result-audio, self-check-button, result-action, completion-action).

### 1.3. Nút thành phần chuyên biệt (KHÔNG phải CTA — giữ riêng)
Không hợp nhất vào 2 nhóm trên vì khác chức năng/kích thước:
- Quiz làm bài (render bằng JS trong `public/js/quiz/quizPage.js`): `.option-button`, `.primary-button`,
  `.secondary-button`, `.neutral-button`, `.inline-audio-button`, `.hint-button` (min-height 52px, full-width, canh trái).
- Pill lọc: `.grammar-filter-button` (+`.is-active`), `.grammar-filter-button` dùng ở /grammar.
- Trình phát câu: `.sentence-control-button` (/listening-practice).

### Quy tắc
1. Nút mới → **`.dv-cta` / `.dv-cta.ghost`**.
2. Không tạo class nút mới ngoài 3 nhóm trên; không thêm alias vào button-base.
3. Nút render bằng JS: chỉ dùng class đã có ở nhóm 1.3, đổi tên phải sửa cả chuỗi JS.

> **Còn nợ (Phase 6 chưa làm — cần duyệt riêng)**: hợp nhất hẳn về MỘT hệ (grep button-base = 0)
> đòi restyle toàn bộ nút admin/auth/settings/payment → **thay đổi hình ảnh diện rộng**, phải review
> per-trang. Hiện giữ button-base làm lớp legacy + `.dv-cta` cho nút mới; xoá dead class là bước an toàn đã làm.

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
