const settingsService = require("../services/settingsService");
const { urlFor } = require("../utils/urls");
const energyService = require("../services/energyService");

const VI_TRANSLATIONS = {
  "app.title": "FTKA - Học tiếng Hàn",
  "brand.subtitle": "Học tiếng Hàn",
  "nav.dashboard": "Trang chính",
  "nav.generator": "Tạo nội dung AI",
  "nav.vocabulary": "Từ vựng",
  "nav.grammar": "Ngữ pháp",
  "nav.quiz": "Ôn tập / Kiểm tra",
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

async function viewContext(req, res, next) {
  const config = settingsService.getConfig();
  const userTheme = req.currentUser && ["dark", "light"].includes(String(req.currentUser.ui_theme || "").toLowerCase())
    ? String(req.currentUser.ui_theme).toLowerCase()
    : null;
  const theme = userTheme || (config.dark_theme ? "dark" : "light");

  res.locals.url_for = urlFor;
  res.locals.t = translate;
  res.locals.ui_html_lang = "vi";
  res.locals.ui_theme = theme;
  res.locals.ui_theme_class = theme === "light" ? "ftka-light-ui" : "ftka-dark-ui";
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
