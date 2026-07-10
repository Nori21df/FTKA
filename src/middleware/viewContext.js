const { urlFor } = require("../utils/urls");
const energyService = require("../services/energyService");

const VI_TRANSLATIONS = {
  "app.title": "FTKA - Học tiếng Hàn",
  "brand.subtitle": "Học tiếng Hàn",
  "nav.dashboard": "Trang chính",
  "nav.generator": "Tạo nội dung AI",
  "nav.vocabulary": "Từ vựng",
  "nav.grammar": "Ngữ pháp",
  "nav.quiz": "Ôn tập / Kiểm tra từ vựng",
  "nav.settings": "Cài đặt",
  "settings.enabled": "Bật",
  "settings.disabled": "Tắt",
  "settings.show": "Hiện",
  "settings.hide": "Ẩn",
  "settings.save": "Lưu",
  "settings.saving": "Đang lưu...",
  "settings.saved_message": "Đã lưu cài đặt.",
  "settings.save_failed": "Không lưu được cài đặt.",
  "settings.network_error": "Không kết nối được máy chủ.",
  "Today": "Hôm nay",
  "Yesterday": "Hôm qua",
  "Recently": "Gần đây",
  "Unspecified": "Chưa phân loại"
};

function translate(key) {
  return VI_TRANSLATIONS[String(key)] || String(key);
}

function argsObject(query) {
  return {
    get(key, fallback = "") {
      const value = query[key];
      return value == null ? fallback : value;
    },
    ...query
  };
}

function pageUrl(req, targetPage, basePath) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query || {})) {
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item != null && item !== "") query.append(key, String(item));
      }
    } else {
      query.set(key, String(value));
    }
  }
  query.set("page", String(targetPage));
  return `${basePath || req.path}?${query.toString()}`;
}

const VALID_STYLES = ["studio", "warm", "midnight", "glass", "clay", "neo", "forest", "minecraft", "ocean", "korea", "vietnam"];

// Đọc style giao diện từ cookie (do người dùng chọn ở trang "Giao diện"); null nếu chưa đặt/không hợp lệ.
function parseStyleCookie(req) {
  const match = /(?:^|;\s*)ftka_style=([^;]+)/.exec(req.headers.cookie || "");
  if (!match) return null;
  let value = "";
  try {
    // decodeURIComponent ném URIError với chuỗi "%" lỗi (vd Cookie: ftka_style=%) → phải bọc để không 500 mọi trang.
    value = decodeURIComponent(match[1]).trim().toLowerCase();
  } catch {
    return null;
  }
  return VALID_STYLES.includes(value) ? value : null;
}

async function viewContext(req, res, next) {
  // Theme = MỘT trục điều khiển giao diện (Phase 7b đã dọn dead-code trục kia):
  //   - data-style (skin, cookie ftka_style) = NGUỒN SỰ THẬT. Mặc định user mới: NEO.
  //   - sáng/tối SUY TRỰC TIẾP từ skin (midnight → dark). Phải khớp public/js/theme.js (client).
  // Cột users.ui_theme (legacy) không còn code nào đọc/ghi — giữ trong DB cho an toàn dữ liệu,
  // không drop (thao tác phá hủy). Xem docs/UI_GUIDE.md mục Theme.
  const style = parseStyleCookie(req) || "neo";
  const effectiveTheme = style === "midnight" ? "dark" : "light";

  res.locals.url_for = urlFor;
  res.locals.t = translate;
  res.locals.ui_html_lang = "vi";
  res.locals.ui_style = style;
  res.locals.ui_theme = effectiveTheme;
  res.locals.ui_theme_class = effectiveTheme === "light" ? "ftka-light-ui" : "ftka-dark-ui";
  res.locals.request = {
    endpoint: res.locals.endpoint || "",
    path: req.path,
    args: argsObject(req.query || {})
  };
  res.locals.g = res.locals;
  res.locals.max = Math.max;
  res.locals.min = Math.min;
  res.locals.admin_page_url = (targetPage, basePath) => pageUrl(req, targetPage, basePath);
  res.locals.energy_status = null;
  if (req.currentUser) {
    try { res.locals.energy_status = await energyService.getEnergyStatus(req.currentUser.id); } catch (error) { res.locals.energy_status = null; }
  }
  next();
}

function named(endpoint, ...handlers) {
  return [
    (req, res, next) => {
      res.locals.endpoint = endpoint;
      if (res.locals.request) res.locals.request.endpoint = endpoint;
      next();
    },
    ...handlers
  ];
}

module.exports = {
  viewContext,
  named,
  translate
};
