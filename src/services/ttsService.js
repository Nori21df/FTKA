const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const env = require("../config/env");
const { fetchWithTimeout } = require("../ai/providers/httpUtil");

// B3: cache mp3 theo text (LRU ~200 buffer, dùng chung mọi user). Cùng một câu/jamo
// từng phát → trả buffer ngay, KHÔNG gọi lại Google Translate. 40 jamo + câu daily lặp
// lại nhiều → hit rate cao. ~vài MB RAM (mp3 tiếng Hàn ngắn ~5-30KB).
const TTS_CACHE = new Map();
const TTS_CACHE_MAX = 200;

function cacheGet(key) {
  if (!TTS_CACHE.has(key)) return null;
  const buf = TTS_CACHE.get(key);
  TTS_CACHE.delete(key); // đưa lên "mới dùng nhất"
  TTS_CACHE.set(key, buf);
  return buf;
}

function cacheSet(key, buf) {
  TTS_CACHE.set(key, buf);
  if (TTS_CACHE.size > TTS_CACHE_MAX) {
    TTS_CACHE.delete(TTS_CACHE.keys().next().value); // bỏ cái cũ nhất
  }
}

function audioDir() {
  const configured = env.listeningAudioDir;
  const resolved = path.isAbsolute(configured) ? configured : path.join(env.rootDir, configured);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function uniqueAudioPath() {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
  return path.join(audioDir(), `listening_${timestamp}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}.mp3`);
}

async function synthesizeBuffer(text) {
  const clean = String(text || "").trim().slice(0, 200);
  const cached = cacheGet(clean);
  if (cached) return cached;
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=ko&client=tw-ob&q=${encodeURIComponent(clean)}`;
  const response = await fetchWithTimeout(url, {}, 12000);
  if (!response.ok) throw new Error(`TTS failed with status ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  cacheSet(clean, buffer);
  return buffer;
}

async function generateAudio(text) {
  if (!String(text || "").trim()) throw new Error("Không có văn bản tiếng Hàn để tạo âm thanh.");
  const output = uniqueAudioPath();
  const buffer = await synthesizeBuffer(text);
  // Ghi bất đồng bộ để không chặn event loop (writeFileSync đóng băng mọi request khác trong lúc ghi).
  await fs.promises.writeFile(output, buffer);
  return output;
}

function filenameForPath(filePath) {
  const dir = path.resolve(audioDir());
  const resolved = path.resolve(filePath);
  if (path.dirname(resolved) !== dir) {
    throw new Error("Tệp âm thanh nằm ngoài thư mục âm thanh đã cấu hình.");
  }
  return path.basename(resolved);
}

function safeAudioPath(filename) {
  const safe = path.basename(String(filename || ""));
  if (safe !== filename || !/^listening_[A-Za-z0-9_.-]+\.mp3$/.test(safe)) return null;
  const resolved = path.resolve(audioDir(), safe);
  if (path.dirname(resolved) !== path.resolve(audioDir())) return null;
  return resolved;
}

module.exports = {
  audioDir,
  synthesizeBuffer,
  generateAudio,
  filenameForPath,
  safeAudioPath
};
