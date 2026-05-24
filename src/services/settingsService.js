const fs = require("fs");
const path = require("path");
const env = require("../config/env");

const settingsPath = path.join(env.rootDir, "data", "settings.json");

const defaults = {
  api_key: "",
  show_key_last_used: false,
  dark_theme: false,
  font_size_idx: 1,
  listening_tts_voice: "",
  listening_tts_rate: "+0%",
  listening_audio_dir: ""
};

function ensureSettingsFile() {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, JSON.stringify(defaults, null, 2), "utf8");
  }
}

function getConfig() {
  ensureSettingsFile();
  let parsed = {};
  try {
    parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    parsed = {};
  }
  const config = { ...defaults, ...parsed };
  config.api_key = env.googleAiStudioApiKey ? "__env__" : "";
  return config;
}

function saveSettings(newSettings = {}) {
  const current = getConfig();
  const next = { ...current, ...newSettings, api_key: "" };
  delete next.language;
  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function getApiKey() {
  return env.googleAiStudioApiKey;
}

module.exports = {
  getConfig,
  saveSettings,
  getApiKey,
  settingsPath
};
