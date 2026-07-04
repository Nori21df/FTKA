const db = require("../db");

// Luyện viết: user viết đoạn tiếng Hàn theo đề, AI chấm + sửa; lưu lịch sử bài nộp.
const WRITING_TOPICS = [
  "Giới thiệu bản thân",
  "Một ngày của tôi",
  "Gia đình tôi",
  "Món ăn tôi thích",
  "Kế hoạch cuối tuần",
  "Chuyến du lịch đáng nhớ",
  "Người bạn thân nhất",
  "Sở thích của tôi",
  "Thời tiết hôm nay",
  "Ước mơ của tôi"
];

async function ensureWritingSchema(clientDb = db) {
  await clientDb.run(`
    CREATE TABLE IF NOT EXISTS writing_submissions (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      original_text TEXT NOT NULL,
      corrected_text TEXT NOT NULL DEFAULT '',
      score INTEGER,
      feedback JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await clientDb.run("CREATE INDEX IF NOT EXISTS idx_writing_user_created ON writing_submissions(user_id, created_at DESC)");
}

function parseFeedback(raw) {
  if (raw && typeof raw === "object") return raw;
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

function serialize(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    topic: row.topic,
    original: row.original_text,
    corrected: row.corrected_text,
    score: row.score == null ? null : Number(row.score),
    feedback: parseFeedback(row.feedback),
    created_at: row.created_at
  };
}

async function saveSubmission(userId, { topic, original, corrected, score, feedback }) {
  const row = await db.one(
    `INSERT INTO writing_submissions (user_id, topic, original_text, corrected_text, score, feedback)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    [userId, topic, original, corrected || "", score == null ? null : score, JSON.stringify(feedback || {})]
  );
  return serialize(row);
}

async function listSubmissions(userId, limit = 5) {
  const rows = await db.query(
    "SELECT * FROM writing_submissions WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT ?",
    [userId, limit]
  );
  return rows.map(serialize);
}

module.exports = { WRITING_TOPICS, ensureWritingSchema, saveSubmission, listSubmissions, serialize };
