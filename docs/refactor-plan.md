# PROMPT — Refactor nợ kỹ thuật frontend FTKA (8 hạng mục)

*(Dán vào Claude Code với model Opus 4.8, chạy tại thư mục gốc repo FTKA — hoặc lưu file này vào repo, ví dụ `docs/refactor-plan.md`, rồi yêu cầu Claude làm theo.)*

---

## Nhiệm vụ

Refactor 8 hạng mục nợ kỹ thuật frontend của FTKA (web app học tiếng Hàn cho người Việt, server-rendered bằng Node + Nunjucks, vanilla JS, CSS thuần trong một file `style.css`). Đây là **refactor, không phải redesign**: sau khi hoàn tất, giao diện và hành vi người dùng phải giống hệt hiện tại, trừ các bug/thay đổi được nêu rõ trong từng phase.

## Nguyên tắc bắt buộc

1. **Xác minh trước khi tin.** Mô tả 8 hạng mục bên dưới do người viết prompt tổng hợp, có thể lệch so với code thực tế. Việc đầu tiên của mỗi phase là tự khảo sát repo và xác nhận (đường dẫn file, số lượng, tên biến, framework). Nếu thực tế khác mô tả → ghi vào NOTES, điều chỉnh kế hoạch; khác biệt lớn thì hỏi lại trước khi làm.
2. **Làm theo phase, mỗi phase 1 commit** (hoặc vài commit nhỏ), message dạng `refactor(css): gộp media queries`. Làm trên branch `refactor/frontend-debt`.
3. **Verification sau mỗi phase.** Chạy đúng mục Verification của phase đó; fail thì sửa xong mới sang phase kế.
4. **Ghi mọi quyết định** vào `docs/REFACTOR_NOTES.md`: đã đổi gì, vì sao, rủi ro còn lại.
5. **Không thêm** framework/bundler/CSS framework mới (React, Vite, Tailwind…). Giữ nguyên stack.
6. Phân vân giữa hai cách → chọn cách **ít xâm lấn hơn**.
7. Cần server dev chạy để test/chụp màn hình: tự xác định lệnh chạy từ `package.json`; nếu thiếu env/credentials/dữ liệu seed thì hỏi tôi.

**Điểm dừng bắt buộc (chờ tôi xác nhận rồi mới tiếp):**
- Sau Phase 0 (báo cáo xác minh hiện trạng).
- Sau bước inventory của Phase 4 (báo cáo kế hoạch gộp CSS).

---

## Phase 0 — Khảo sát + lưới an toàn (làm trước tiên)

1. Tạo branch `refactor/frontend-debt`.
2. Khảo sát repo: cấu trúc thư mục templates/static, framework server, nơi cấu hình Nunjucks env, module vocab đã tách (pattern chuẩn cho Phase 3).
3. Xác minh 8 hạng mục bên dưới → báo cáo bảng: hạng mục / đúng như mô tả? / khác gì / file liên quan.
4. Cài devDependencies: `@playwright/test` + `vitest` (nếu chưa có).
5. Viết `tests/visual.spec.ts` chụp snapshot (`expect(page).toHaveScreenshot()`) các trang chính — tự xác định routes: trang chủ, danh sách listening, chi tiết listening, trang quiz, trang grammar, vocab, admin (nếu cần đăng nhập thì hỏi tôi cấp tài khoản test hoặc bỏ trang đó) — ở 3 viewport: **1440×900, 899×900, 390×844**. Lần chạy đầu tạo baseline. Trang có nội dung động (thứ tự quiz ngẫu nhiên, ngày giờ…) gây flaky → dùng `mask` hoặc dữ liệu ổn định; trang nào không so máy được thì ghi chú để so tay.
6. Thêm scripts: `test:visual` vào `package.json`.

**Verification:** baseline snapshot tạo đủ các trang × 3 viewport; chạy lại lần 2 pass (không flaky). **Dừng, báo cáo, chờ xác nhận.**

---

## Phase 1 — Chốt lỗi Nunjucks array-truthiness (hạng mục 2)

Bối cảnh: trong Nunjucks, mảng rỗng `[]` là truthy nên `{% if items %}` không gate được empty-state. Đợt trước đã sửa hàng loạt nhưng chưa có gì ngăn lỗi mới.

1. Quét toàn bộ templates: liệt kê mọi `{% if <biến> %}` / `{% elif <biến> %}` / `{% if not <biến> %}` với biến đơn (không toán tử). Đối chiếu route/controller render template đó để phân loại biến: mảng / boolean / object / string.
2. Sửa những chỗ biến là mảng còn sót: dùng `{% if items | length %}` và `{% if not (items | length) %}`.
3. Viết `scripts/lint-templates.mjs`:
   - Quét templates, bắt pattern `{% if <identifier> %}` (kể cả `elif`, `not`).
   - So với registry `scripts/template-array-vars.json` (danh sách tên biến-mảng, tự sinh lần đầu từ bước 1) + heuristic hậu tố (`*s`, `*List`, `*Items`, `*Array` → cảnh báo).
   - Cho phép ngoại lệ cố ý qua comment `{# lint-ok #}` cùng dòng hoặc allowlist trong JSON.
   - In `file:dòng` cho mỗi vi phạm; exit code ≠ 0 khi có vi phạm.
4. Thêm `"lint:templates"` vào scripts; gộp vào `npm test`.

**Verification:** script chạy sạch trên repo; tạo tạm 1 vi phạm giả → script bắt được → gỡ.

---

## Phase 2 — Filter nhãn cấp độ/chủ đề (hạng mục 5)

Hiện trạng: chuỗi `{% if lesson.level == 'beginner' %}Sơ cấp…{% endif %}` lặp ở nhiều nơi (listening list + detail + admin).

1. Xác minh mapping thực tế từ code (ví dụ beginner→Sơ cấp, intermediate→Trung cấp, advanced→Cao cấp — có thể có giá trị khác, đừng đoán).
2. Đăng ký Nunjucks filter `levelLabel` tại nơi cấu hình env. Giá trị lạ → trả nguyên văn; rỗng/undefined → `'—'`. Nếu có pattern tương tự cho chủ đề → thêm `topicLabel`.
3. Thay toàn bộ chuỗi if/elif hiển thị nhãn bằng `{{ lesson.level | levelLabel }}` ở mọi nơi grep thấy.
4. Unit test (Vitest) cho filter: giá trị hợp lệ, giá trị lạ, undefined.

**Verification:** `grep -rn "== 'beginner'"` (và các giá trị level khác) trong templates → 0 kết quả ở markup hiển thị nhãn (so sánh phục vụ logic khác thì giữ, ghi chú); `test:visual` pass với các trang listening.

---

## Phase 3 — Tách JS inline ra module (hạng mục 3)

Hiện trạng: quiz engine (~350 dòng) và grammar (~240 dòng) nằm inline trong `.html`, trộn logic + markup, không test được. Chỉ vocab đã tách đúng.

1. Đọc kỹ module vocab: vị trí file, cách nhận data từ server, cách init, naming → **đây là pattern chuẩn phải theo**.
2. Tách **quiz engine** thành module JS tĩnh:
   - Data động từ server nhúng qua `<script type="application/json" id="quiz-data">{{ quizData | dump | safe }}</script>` (hoặc đúng cách vocab đang dùng; chú ý escape `</script` nếu dữ liệu có thể chứa HTML). Module đọc JSON và init trên `DOMContentLoaded`. **Không còn nội suy Nunjucks bên trong logic JS.**
   - Tách logic thuần (chấm điểm, trộn/chọn câu hỏi, chuyển câu, tính kết quả) thành hàm pure, export được → viết unit test Vitest cho phần này.
   - Phần DOM binding giữ mỏng.
3. Làm tương tự cho **grammar**.
4. Template chỉ còn markup + `<script src>` + JSON data island.

**Verification:** checklist tay — làm 1 quiz đầy đủ (chọn đáp án đúng/sai, xem kết quả), thao tác grammar chính: hành vi giống hệt trước; unit tests pass; console không có lỗi mới; `test:visual` pass.

---

## Phase 4 — Hợp nhất `style.css` (hạng mục 1) ⚠️ rủi ro cao nhất

Hiện trạng: ~5.342 dòng, ≥5 khối `@media (max-width:900px)` trùng lặp, sidebar transform khai báo 3 lần ở 3 media block.

1. **Inventory trước (rồi dừng chờ xác nhận):** viết script nhỏ (hoặc dùng stylelint) liệt kê mọi khối `@media` (breakpoint + dòng), selector khai báo ≥2 lần, mọi khai báo sidebar transform. Lưu báo cáo + kế hoạch gộp vào NOTES.
2. **Gộp media query:** mỗi breakpoint chỉ còn **một** khối, đặt cuối file, thứ tự từ rộng → hẹp. Khi gộp:
   - Giữ nguyên **thứ tự tương đối** của các rule trong các khối gốc (khối xuất hiện trước → rule đứng trước) để không đổi kết quả cascade giữa rule cùng specificity.
   - ⚠️ Cẩn thận trường hợp một rule *ngoài* media, nằm *sau* khối media cũ, đang thắng nhờ source order — dời media xuống cuối sẽ đảo kết quả. Với sidebar transform và mọi thuộc tính khai báo cả trong lẫn ngoài media: kiểm tra từng cái.
   - Khai báo trùng hệt nhau → giữ một bản (bản đang có hiệu lực theo cascade cũ).
3. **Sidebar transform:** còn đúng một nơi định nghĩa cho mỗi trạng thái (đóng/mở × mobile/desktop).
4. Tổ chức lại file theo mục có comment TOC: `/* ===== 1. Variables ===== */` → base → layout → components → pages → utilities → responsive. **Không tách nhiều file trong phase này** (để diff dễ kiểm soát); muốn tách thì đề xuất riêng sau khi phase ổn định.
5. Không đổi giá trị style nào — chỉ di chuyển / gộp / xóa trùng.

**Verification:** `test:visual` pass toàn bộ trang × 3 viewport; kiểm tra tay hành vi sidebar tại **899px vs 901px**; báo cáo số dòng trước/sau, số khối `@media` trước/sau.

---

## Phase 5 — Thay `reload()` bằng cập nhật cục bộ (hạng mục 4)

1. Liệt kê mọi call site `location.reload()` / `window.location.reload()` (grep cả templates lẫn JS) kèm ngữ cảnh: mutation gì, phần UI nào cần cập nhật.
2. Với từng chỗ: fetch mutation như cũ → thành công thì **cập nhật DOM cục bộ** (xóa/thêm row, cập nhật số đếm, đổi trạng thái nút, toast). Không cần optimistic UI — đơn giản, đúng, giữ được scroll + filter là đạt.
3. Bất khả kháng phải reload (render server phức tạp): lưu scroll + filter vào sessionStorage/URL query và khôi phục sau reload — coi là ngoại lệ, ghi rõ lý do.
4. Mutation fail → báo lỗi bằng cơ chế hiện có, không đổi DOM.

**Verification:** checklist tay từng thao tác đã đổi: không nháy trang, scroll giữ nguyên, filter giữ nguyên, dữ liệu hiển thị khớp DB (đối chiếu bằng F5 tay sau đó).

---

## Phase 6 — Một hệ nút duy nhất (hạng mục 6)

Hiện trạng: hai hệ class CTA/nút tồn tại song song, người mới dễ chọn nhầm.

1. Inventory: tên class hai hệ, nơi định nghĩa trong CSS, số usage mỗi hệ, khác biệt kiểu dáng.
2. Chọn hệ **canonical** (mặc định: hệ nhiều usage hơn và CSS gọn hơn — nêu lý do trong NOTES). Migrate mọi usage hệ kia sang variant tương đương gần nhất.
3. Nếu hai hệ khác diện mạo → một số nút sẽ đổi hình thức nhẹ. Đây là **thay đổi hình ảnh có chủ đích duy nhất được phép** trong toàn bộ refactor: liệt kê rõ các nút bị đổi trong báo cáo phase; visual diff chỉ được lệch tại đúng các nút đó, mọi diff khác là lỗi.
4. Grep hệ cũ = 0 → xóa CSS hệ cũ (không giữ alias).
5. Tạo `docs/UI_GUIDE.md`: hệ nút chuẩn (class, variants, ví dụ markup) để không ai tạo hệ thứ ba.

**Verification:** grep class hệ cũ = 0 trong templates; visual diff chỉ lệch tại các nút đã khai báo.

---

## Phase 7 — Làm rõ hai trục theme (hạng mục 7)

Định hướng: **không gộp** — đây là hai concern khác nhau: `data-style` = skin/palette (6 bộ màu, cookie) và `ui_theme` = sáng/tối (DB theo user). Chuẩn hóa thay vì gộp:

1. Tạo `public/js/theme.js` — nơi **duy nhất** đọc cả hai nguồn (cookie skin + giá trị `ui_theme` server nhúng ra) và áp lên `<html>`: `data-style="..."` + `data-ui-theme="light|dark"` (hoặc giữ đúng cơ chế attr/class hiện tại — xác minh trước). Định nghĩa rõ default và thứ tự áp; áp sớm trong `<head>` để tránh FOUC nếu hiện tại đã vậy.
2. Gỡ mọi chỗ khác đang đọc/ghi theme rải rác trong templates/JS → trỏ về theme.js.
3. CSS: xác minh cách tổ chức biến màu hiện tại. Hướng đến hai tầng — palette theo `[data-style="…"]`, điều chỉnh sáng/tối theo `[data-ui-theme="dark"]`. Chỉ tái cấu trúc CSS nếu hiện trạng đang trộn lẫn gây lỗi; nếu đang chạy đúng thì ưu tiên chỉ gom logic JS + viết tài liệu.
4. Thêm mục "Theme" vào `docs/UI_GUIDE.md`: hai trục là gì, thêm skin mới ở đâu, thêm logic dark/light ở đâu, điều cấm (không đọc cookie theme trực tiếp ngoài theme.js).

**Verification:** thử ≥4 tổ hợp (2 skin × light/dark): đổi skin không phá dark mode và ngược lại; reload giữ đúng theme; không xuất hiện FOUC mới.

---

## Phase 8 — Chốt nền tảng test (hạng mục 8)

1. Gom những gì đã tích lũy: unit tests (quiz engine, grammar, filters), `lint:templates`, visual snapshots.
2. Thêm 3–5 Playwright smoke test hành vi: trang chủ load không lỗi console; hoàn thành một quiz end-to-end; toggle theme; sidebar mobile mở/đóng ở viewport 390px.
3. Scripts: `npm test` = `lint:templates` + unit (nhanh, chạy thường xuyên); `test:visual` và `test:e2e` tách riêng.
4. Cập nhật `CLAUDE.md` (hoặc README): cách chạy test + **4 quy ước phải giữ**:
   - (a) gate mảng trong `{% if %}` phải dùng `| length`;
   - (b) không viết JS inline mới trong template — theo pattern module;
   - (c) chỉ dùng hệ nút chuẩn trong UI_GUIDE.md;
   - (d) theme chỉ thao tác qua theme.js.

---

## Báo cáo cuối cùng

Bảng 8 hạng mục: trạng thái (xong / một phần / bỏ qua + lý do), file thay đổi chính, rủi ro còn lại. Số liệu: dòng `style.css` trước/sau, số khối `@media` trước/sau, dòng JS inline còn lại trong templates, số test theo loại.

## KHÔNG làm

- Không redesign: không đổi màu / spacing / typography / layout (trừ hợp nhất nút ở Phase 6, có khai báo trước).
- Không thêm React/Vue/Vite/Tailwind hay bất kỳ framework/bundler nào.
- Không refactor backend ngoài phạm vi (đăng ký filter/global Nunjucks phía server là được phép).
- Không xóa code nghi là "chết" nếu chưa chứng minh — đánh dấu `// TODO(dead-code?)` và ghi NOTES.
- Không "tiện tay" sửa bất cứ thứ gì ngoài 8 hạng mục.
