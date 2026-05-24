const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const env = require("../config/env");

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
  const query = encodeURIComponent(String(text || "").trim().slice(0, 200));
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=ko&client=tw-ob&q=${query}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`TTS failed with status ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function generateAudio(text) {
  if (!String(text || "").trim()) throw new Error("Không có văn bản tiếng Hàn để tạo âm thanh.");
  const output = uniqueAudioPath();
  const buffer = await synthesizeBuffer(text);
  fs.writeFileSync(output, buffer);
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
