const crypto = require("crypto");
const db = require("../db");
const { currentTimestamp, parseTimestamp, formatRelativeDateLabel } = require("../utils/time");

const QUIZ_SESSION_LIMIT = 12;

function normalizeCreatedAt(value) {
  return value && String(value).trim() ? value : currentTimestamp();
}

async function makeUniqueRecordId(tableName, preferredId) {
  if (preferredId && String(preferredId).trim()) {
    const candidate = String(preferredId).trim();
    if (!(await db.one(`SELECT id FROM ${tableName} WHERE id=?`, [candidate]))) return candidate;
  }
  for (let i = 0; i < 8; i += 1) {
    const id = crypto.randomUUID().replace(/-/g, "");
    if (!(await db.one(`SELECT id FROM ${tableName} WHERE id=?`, [id]))) return id;
  }
  throw new Error("Could not create a unique record id.");
}

function humanizeSourceLabel(source) {
  if (!source || !String(source).trim()) return "Chưa phân loại";
  return String(source)
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\b(ai|tts|api|topik)\b/gi, (m) => m.toUpperCase())
    .replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

function serializeRecentVocab(rows) {
  return rows.map((row) => ({
    korean: row.korean,
    meaning_vi: row.meaning_vi,
    source_label: humanizeSourceLabel(row.source),
    created_label: formatRelativeDateLabel(row.created_at)
  }));
}

function serializeFocusWords(rows) {
  return rows.map((row) => ({
    id: row.id,
    korean: row.korean,
    meaning_vi: row.meaning_vi,
    created_label: formatRelativeDateLabel(row.created_at)
  }));
}

function serializeRecentGrammar(rows) {
  return rows.map((row) => ({
    grammar: row.grammar,
    meaning_vi: row.meaning_vi,
    level: row.level || "General",
    created_label: formatRelativeDateLabel(row.created_at)
  }));
}

async function recordLearningActivity(vocabId, ownerUserId) {
  await db.run(
    "INSERT INTO learning_activity (vocab_id, activity_type, created_at, owner_user_id) VALUES (?, 'learned', ?, ?)",
    [vocabId, currentTimestamp(), ownerUserId]
  );
}

const WEEKDAY_LABELS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function localDateKey(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function getLearningActivityTimeline(ownerUserId, days = 7) {
  const rows = await db.query(
    "SELECT created_at FROM learning_activity WHERE owner_user_id=? AND activity_type='learned'",
    [ownerUserId]
  );
  const now = new Date();
  const buckets = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    buckets.push({
      date: localDateKey(d),
      short_date: `${d.getDate()}/${d.getMonth() + 1}`,
      label: WEEKDAY_LABELS[d.getDay()],
      is_today: i === 0,
      count: 0
    });
  }
  const byDate = Object.fromEntries(buckets.map((b) => [b.date, b]));
  for (const row of rows) {
    const parsed = parseTimestamp(row.created_at);
    if (!parsed) continue;
    const key = localDateKey(parsed);
    if (byDate[key]) byDate[key].count += 1;
  }
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  for (const bucket of buckets) {
    bucket.active = bucket.count > 0;
    bucket.height = Math.round((bucket.count / maxCount) * 100);
  }
  return buckets;
}

async function getLearningStreakStats(ownerUserId) {
  const timeline = await getLearningActivityTimeline(ownerUserId, 30);
  let current = 0;
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    if (timeline[i].count > 0) current += 1;
    else break;
  }
  let best = 0;
  let run = 0;
  for (const day of timeline) {
    run = day.count > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const todayCount = timeline[timeline.length - 1]?.count || 0;
  return {
    status: todayCount > 0 ? "active" : current > 0 ? "at_risk" : "none",
    today_count: todayCount,
    days: current,
    current_streak: current,
    best_streak: best,
    latest_run: current,
    caption: todayCount > 0 ? `Hôm nay đã học ${todayCount} mục.` : "Học một mục hôm nay để bắt đầu chuỗi ngày."
  };
}

async function getRecentLearningActivity(ownerUserId, limit = 5) {
  const rows = await db.query(
    `SELECT learning_activity.*, vocab.korean, vocab.meaning_vi
     FROM learning_activity
     LEFT JOIN vocab ON vocab.id = learning_activity.vocab_id
     WHERE learning_activity.owner_user_id=?
     ORDER BY learning_activity.created_at DESC, learning_activity.id DESC
     LIMIT ?`,
    [ownerUserId, limit]
  );
  return rows.map((row) => ({
    ...row,
    created_label: formatRelativeDateLabel(row.created_at)
  }));
}

async function getSourceBreakdown(ownerUserId, totalVocab, limit = 4) {
  if (!totalVocab) return [];
  const rows = await db.query(
    `SELECT COALESCE(NULLIF(TRIM(source), ''), 'Unspecified') AS source, COUNT(*) AS count
     FROM vocab WHERE owner_user_id=?
     GROUP BY source ORDER BY count DESC LIMIT ?`,
    [ownerUserId, limit]
  );
  return rows.map((row) => ({
    source: row.source,
    label: humanizeSourceLabel(row.source),
    count: Number(row.count || 0),
    percent: Math.round((Number(row.count || 0) / totalVocab) * 100)
  }));
}

async function countRecentVocabEntries(ownerUserId, days = 7) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return Number(await db.scalar("SELECT COUNT(*) FROM vocab WHERE owner_user_id=? AND created_at >= ?", [ownerUserId, since]));
}

function buildGrammarQuizDeck(rows) {
  const deck = [];
  for (const row of rows) {
    let quizItems = [];
    try {
      quizItems = Array.isArray(row.quiz_items) ? row.quiz_items : JSON.parse(row.quiz_items || "[]");
    } catch {
      quizItems = [];
    }
    for (const item of quizItems) {
      if (!item || !Array.isArray(item.options)) continue;
      deck.push({
        grammar_id: row.id,
        grammar: row.grammar,
        meaning_vi: row.meaning_vi,
        ...item
      });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function serializeGrammarApiItem(item) {
  let quizItems = item.quiz_items || [];
  if (typeof quizItems === "string") {
    try {
      quizItems = JSON.parse(quizItems);
    } catch {
      quizItems = [];
    }
  }
  return { ...item, quiz_items: Array.isArray(quizItems) ? quizItems : [] };
}

module.exports = {
  QUIZ_SESSION_LIMIT,
  normalizeCreatedAt,
  makeUniqueRecordId,
  serializeRecentVocab,
  serializeFocusWords,
  serializeRecentGrammar,
  recordLearningActivity,
  getLearningActivityTimeline,
  getLearningStreakStats,
  getRecentLearningActivity,
  getSourceBreakdown,
  countRecentVocabEntries,
  buildGrammarQuizDeck,
  serializeGrammarApiItem
};
