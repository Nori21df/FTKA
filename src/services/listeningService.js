const crypto = require("crypto");
const ai = require("./aiService");
const tts = require("./ttsService");
const { currentTimestamp, compactCreatedAt } = require("../utils/time");

const LISTENING_LEVELS = ["beginner", "intermediate", "advanced"];
const LISTENING_TOPICS = ["daily_life", "school", "work", "travel", "shopping", "food", "weather", "culture"];
const LISTENING_LENGTHS = ["short", "medium"];
const QUESTION_COUNT_BY_LENGTH = { short: 2, medium: 3 };
const AUDIO_PREFIX = "/api/listening-practice/audio";

function clean(value) {
  return String(value || "").trim();
}

function normalizeTopic(value) {
  const raw = clean(value);
  const key = raw.toLowerCase();
  const labels = {
    daily_life: "Đời sống hàng ngày",
    school: "Trường học",
    work: "Công việc",
    travel: "Du lịch",
    shopping: "Mua sắm",
    food: "Ẩm thực",
    weather: "Thời tiết",
    culture: "Văn hóa"
  };
  return labels[key] || raw;
}

function audioUrlForFile(file) {
  const filename = clean(file).split("/").pop();
  return filename ? `${AUDIO_PREFIX}/${filename}` : "";
}

function loadsList(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function splitSentences(koreanText) {
  const matches = clean(koreanText).match(/[^.!?。…]+(?:[.!?。…]+|$)/g) || [];
  return matches.map((text, index) => ({ index: index + 1, text: clean(text), audio_path: "", audio_error: "" })).filter((s) => s.text);
}

function serializeRow(row) {
  if (!row) return null;
  const sentences = loadsList(row.sentences);
  return {
    ...row,
    vocabulary: loadsList(row.vocabulary),
    questions: loadsList(row.questions),
    sentences: (sentences.length ? sentences : splitSentences(row.korean_text)).map((s, index) => ({
      index: s.index || index + 1,
      text: clean(s.text),
      audio_path: audioUrlForFile(s.audio_path),
      audio_error: clean(s.audio_error)
    })),
    sync_mode: row.sync_mode || "sentence",
    audio_warning: row.audio_error || "",
    audio_path: audioUrlForFile(row.audio_path)
  };
}

function serializeSummary(row) {
  return {
    id: row.id,
    title: row.title,
    level: row.level,
    topic: row.topic,
    length: row.length,
    created_at: row.created_at,
    created_label: compactCreatedAt(row.created_at)
  };
}

function validatePayload(payload) {
  const level = clean(payload.level).toLowerCase();
  const topic = normalizeTopic(payload.topic);
  const length = clean(payload.length).toLowerCase();
  if (!LISTENING_LEVELS.includes(level)) throw new Error("Cấp độ không hợp lệ.");
  if (!topic) throw new Error("Vui lòng nhập chủ đề.");
  if (!LISTENING_LENGTHS.includes(length)) throw new Error("Độ dài không hợp lệ.");
  return { level, topic, length };
}

function buildPrompt(level, topic, length, questionCount) {
  return `Tạo một bài luyện nghe tiếng Hàn.
Cấp độ: ${level}
Chủ đề: ${topic}
Độ dài: ${length}
Số câu hỏi luyện nghe: ${questionCount}
Chỉ trả về JSON object với keys: title, korean_text, vietnamese_translation, vocabulary, questions.
Vocabulary items cần korean, meaning_vi, example_kr, example_vi.
Questions cần question, choices, answer, explanation_vi.`;
}

async function listLessonSummaries(db, ownerUserId, limit = 50) {
  const rows = await db.query(
    `SELECT id, title, level, topic, length, created_at
     FROM listening_practice
     WHERE owner_user_id=?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [ownerUserId, limit]
  );
  return rows.map(serializeSummary);
}

async function getLessonById(db, lessonId, ownerUserId) {
  if (!clean(lessonId)) return null;
  const row = await db.one("SELECT * FROM listening_practice WHERE id=? AND owner_user_id=?", [clean(lessonId), ownerUserId]);
  return serializeRow(row);
}

async function deleteLesson(db, lessonId, ownerUserId) {
  const existing = await db.one("SELECT id FROM listening_practice WHERE id=? AND owner_user_id=?", [clean(lessonId), ownerUserId]);
  if (!existing) return false;
  await db.run("DELETE FROM listening_practice WHERE id=? AND owner_user_id=?", [clean(lessonId), ownerUserId]);
  return true;
}

async function createLesson(db, payload, ownerUserId) {
  const { level, topic, length } = validatePayload(payload);
  const questionCount = QUESTION_COUNT_BY_LENGTH[length];
  const raw = await ai.generateJsonObject(
    "Bạn là giáo viên tiếng Hàn tạo bài luyện nghe ngắn cho người Việt. Chỉ trả về JSON object hợp lệ.",
    buildPrompt(level, topic, length, questionCount),
    { temperature: 0.3, maxTokens: 8192, type: "listening" }
  );
  const lesson = {
    id: crypto.randomUUID().replace(/-/g, ""),
    title: clean(raw.title),
    level,
    topic,
    length,
    korean_text: clean(raw.korean_text),
    vietnamese_translation: clean(raw.vietnamese_translation),
    vocabulary: Array.isArray(raw.vocabulary) ? raw.vocabulary : [],
    questions: Array.isArray(raw.questions) ? raw.questions : [],
    audio_path: "",
    created_at: currentTimestamp(),
    source: "ai",
    audio_error: "",
    sync_mode: "sentence",
    sentences: splitSentences(raw.korean_text)
  };
  if (!lesson.title || !lesson.korean_text || !lesson.vietnamese_translation) {
    throw new Error("AI trả về bài nghe thiếu dữ liệu bắt buộc.");
  }

  await db.run(
    `INSERT INTO listening_practice (
      id, title, level, topic, length, korean_text, vietnamese_translation,
      vocabulary, questions, audio_path, created_at, source, audio_error, sync_mode, sentences, owner_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      lesson.id,
      lesson.title,
      lesson.level,
      lesson.topic,
      lesson.length,
      lesson.korean_text,
      lesson.vietnamese_translation,
      JSON.stringify(lesson.vocabulary),
      JSON.stringify(lesson.questions),
      "",
      lesson.created_at,
      lesson.source,
      "",
      lesson.sync_mode,
      JSON.stringify(lesson.sentences),
      ownerUserId
    ]
  );

  let audioWarning = "";
  try {
    const audioPath = await tts.generateAudio(lesson.korean_text);
    const audioFile = tts.filenameForPath(audioPath);
    await db.run("UPDATE listening_practice SET audio_path=?, audio_error=? WHERE id=?", [audioFile, "", lesson.id]);
    lesson.audio_path = audioUrlForFile(audioFile);
  } catch {
    audioWarning = "Không tạo được âm thanh. Vui lòng kiểm tra kết nối mạng.";
    await db.run("UPDATE listening_practice SET audio_error=? WHERE id=?", [audioWarning, lesson.id]);
  }

  lesson.audio_warning = audioWarning;
  return lesson;
}

module.exports = {
  LISTENING_LEVELS,
  LISTENING_TOPICS,
  LISTENING_LENGTHS,
  serializeRow,
  listLessonSummaries,
  getLessonById,
  deleteLesson,
  createLesson,
  audioUrlForFile
};
