// theme.js — NƠI DUY NHẤT phía client đọc/ghi & áp theme cho FTKA.
// Hai trục theme (xem docs/UI_GUIDE.md):
//   - data-style : skin/palette (6 bộ), lưu ở cookie ftka_style.
//   - sáng/tối   : SUY TRỰC TIẾP từ skin (midnight → dark) — phải khớp
//                  src/middleware/viewContext.js (server) để không lệch giữa 2 nơi.
// Server đã render sẵn data-style + class ftka-*-ui trên <body> nên không FOUC;
// module này dùng cho bộ chọn giao diện (áp NGAY khi bấm, không cần reload).
// Cấm đọc/ghi cookie ftka_style trực tiếp ở nơi khác — luôn qua đây.
(function (global) {
  const VALID_STYLES = ["studio", "warm", "midnight", "glass", "clay", "neo", "forest", "minecraft", "ocean", "korea", "vietnam"];
  const DEFAULT_STYLE = "neo";
  const DARK_STYLES = new Set(["midnight"]);
  const COOKIE = "ftka_style";

  function isDarkStyle(style) {
    return DARK_STYLES.has(style);
  }

  function readStyle() {
    const m = /(?:^|;\s*)ftka_style=([^;]+)/.exec(document.cookie || "");
    if (!m) return null;
    let v = "";
    try { v = decodeURIComponent(m[1]).trim().toLowerCase(); } catch (_) { return null; }
    return VALID_STYLES.includes(v) ? v : null;
  }

  function writeCookie(style) {
    document.cookie = COOKIE + "=" + style + ";path=/;max-age=31536000;samesite=lax";
  }

  // Áp skin lên <body> (data-style + class sáng/tối). persist=true thì lưu cookie.
  function applyStyle(style, opts) {
    if (!VALID_STYLES.includes(style)) style = DEFAULT_STYLE;
    const dark = isDarkStyle(style);
    document.body.setAttribute("data-style", style);
    document.body.classList.toggle("ftka-dark-ui", dark);
    document.body.classList.toggle("ftka-light-ui", !dark);
    if (!opts || opts.persist !== false) writeCookie(style);
    return style;
  }

  global.ftkaTheme = { VALID_STYLES, DEFAULT_STYLE, isDarkStyle, readStyle, applyStyle };
})(window);
