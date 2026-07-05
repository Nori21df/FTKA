const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const db = require("../db");
const srs = require("../utils/srs");

/**
 * itTermsService — Từ vựng chuyên ngành (catalog DÙNG CHUNG theo `domain`).
 *
 * Bảng `it_terms(domain, key, korean, gloss_en, definition_kr, definition_vi)` chứa MỌI ngành
 * (cntt, y, …), phân biệt bằng cột `domain`; `key` toàn cục duy nhất (đã prefix theo ngành).
 * Tiến độ RIÊNG theo user ở `it_term_progress(user_id, domain, term_key, learned, favorite, srs_*)`.
 * Mọi hàm nhận `domain` (mặc định "cntt" để tương thích ngược). Tái dùng srs.js.
 *
 * Seed mỗi ngành từ asset nén `assets/<file>.gz` (khai báo trong src/config/specialties.js).
 */

const ASSET_DIR = path.join(__dirname, "..", "..", "assets");

async function ensureItTermsSchema(clientDb = db) {
  await clientDb.run(`
    CREATE TABLE IF NOT EXISTS it_terms (
      key TEXT PRIMARY KEY,
      korean TEXT NOT NULL,
      gloss_en TEXT,
      definition_kr TEXT,
      definition_vi TEXT
    )`);
  // Tổng quát hoá: thêm cột domain (bản ghi cũ = 'cntt').
  await clientDb.run("ALTER TABLE it_terms ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT 'cntt'");
  await clientDb.run("CREATE INDEX IF NOT EXISTS idx_it_terms_domain_korean ON it_terms(domain, korean)");
  await clientDb.run(`
    CREATE TABLE IF NOT EXISTS it_term_progress (
      user_id INTEGER NOT NULL,
      term_key TEXT NOT NULL,
      learned BOOLEAN NOT NULL DEFAULT FALSE,
      favorite BOOLEAN NOT NULL DEFAULT FALSE,
      srs_due TIMESTAMPTZ,
      srs_interval REAL NOT NULL DEFAULT 0,
      srs_ease REAL NOT NULL DEFAULT 2.5,
      srs_reps INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, term_key)
    )`);
  await clientDb.run("ALTER TABLE it_term_progress ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT 'cntt'");
  await clientDb.run("CREATE INDEX IF NOT EXISTS idx_it_progress_due ON it_term_progress(user_id, domain, srs_due)");
}

function loadSeedData(assetFile) {
  const p = path.join(ASSET_DIR, assetFile);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString("utf8"));
}

// Seed 1 ngành từ asset. Guard theo số dòng của ngày đó; upsert điền definition_vi dần.
async function seedDomain(domain, assetFile, expectedCount = 0, { force = false } = {}) {
  const current = Number(await db.scalar("SELECT COUNT(*) FROM it_terms WHERE domain=?", [domain]).catch(() => 0));
  if (!force && expectedCount && current >= expectedCount) return { domain, seeded: 0, skipped: true, current };
  const data = loadSeedData(assetFile);
  if (!data || !data.length) {
    console.log(`[it-terms] Chưa có assets/${assetFile} — bỏ qua seed ngành ${domain}.`);
    return { domain, seeded: 0, skipped: true, current };
  }
  const CHUNK = 500;
  let seeded = 0;
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "(?,?,?,?,?,?)").join(",");
    const params = [];
    for (const t of chunk) {
      params.push(domain, t.key, t.korean, t.gloss_en || "", t.definition_kr || "", t.definition_vi || "");
    }
    await db.run(
      `INSERT INTO it_terms (domain, key, korean, gloss_en, definition_kr, definition_vi)
       VALUES ${placeholders}
       ON CONFLICT (key) DO UPDATE SET
         domain = EXCLUDED.domain,
         korean = EXCLUDED.korean,
         gloss_en = EXCLUDED.gloss_en,
         definition_kr = EXCLUDED.definition_kr,
         definition_vi = CASE WHEN EXCLUDED.definition_vi <> '' THEN EXCLUDED.definition_vi ELSE it_terms.definition_vi END`,
      params
    );
    seeded += chunk.length;
  }
  console.log(`[it-terms] Seed xong ${seeded} thuật ngữ ngành ${domain}.`);
  return { domain, seeded, skipped: false, current };
}

// Seed mọi ngành available trong registry (gọi lúc boot).
async function seedItTerms(opts = {}) {
  const { SPECIALTIES } = require("../config/specialties");
  const results = [];
  for (const s of SPECIALTIES) {
    if (s.available && s.dataFile) results.push(await seedDomain(s.domain, s.dataFile, s.count || 0, opts));
  }
  return results;
}

// ── Truy vấn trang duyệt ────────────────────────────────────────────────
// filter: 'all' | 'learned' | 'favorite' | 'untranslated'. Tìm trên korean + gloss_en + definition_vi.
function buildWhere({ domain, q, filter }) {
  const cond = ["t.domain = ?"];
  const params = [domain];
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    cond.push("(t.korean ILIKE ? OR t.gloss_en ILIKE ? OR t.definition_vi ILIKE ?)");
    params.push(like, like, like);
  }
  if (filter === "learned") cond.push("p.learned = TRUE");
  else if (filter === "favorite") cond.push("p.favorite = TRUE");
  else if (filter === "untranslated") cond.push("(t.definition_vi IS NULL OR t.definition_vi = '')");
  return { where: `WHERE ${cond.join(" AND ")}`, params };
}

async function searchTerms({ userId, domain = "cntt", q = "", filter = "all", offset = 0, limit = 40 }) {
  const { where, params } = buildWhere({ domain, q, filter });
  return db.query(
    `SELECT t.key, t.korean, t.gloss_en, t.definition_kr, t.definition_vi,
            COALESCE(p.learned, FALSE) AS learned, COALESCE(p.favorite, FALSE) AS favorite
     FROM it_terms t
     LEFT JOIN it_term_progress p ON p.term_key = t.key AND p.user_id = ?
     ${where}
     ORDER BY t.korean
     LIMIT ? OFFSET ?`,
    [userId, ...params, Math.min(Number(limit) || 40, 100), Math.max(Number(offset) || 0, 0)]
  );
}

async function countTerms({ userId, domain = "cntt", q = "", filter = "all" }) {
  const { where, params } = buildWhere({ domain, q, filter });
  const needsJoin = filter === "learned" || filter === "favorite";
  const sql = needsJoin
    ? `SELECT COUNT(*) FROM it_terms t LEFT JOIN it_term_progress p ON p.term_key=t.key AND p.user_id=? ${where}`
    : `SELECT COUNT(*) FROM it_terms t ${where}`;
  const args = needsJoin ? [userId, ...params] : params;
  return Number(await db.scalar(sql, args).catch(() => 0));
}

// ── Tiến độ theo user ───────────────────────────────────────────────────
async function ensureProgressRow(userId, domain, termKey) {
  await db.run(
    `INSERT INTO it_term_progress (user_id, domain, term_key) VALUES (?, ?, ?)
     ON CONFLICT (user_id, term_key) DO NOTHING`,
    [userId, domain, termKey]
  );
}

async function setLearned(userId, domain, termKey, learned) {
  await ensureProgressRow(userId, domain, termKey);
  await db.run("UPDATE it_term_progress SET learned=? WHERE user_id=? AND term_key=?", [!!learned, userId, termKey]);
}

async function toggleFavorite(userId, domain, termKey) {
  await ensureProgressRow(userId, domain, termKey);
  const row = await db.one("SELECT favorite FROM it_term_progress WHERE user_id=? AND term_key=?", [userId, termKey]);
  const next = !(row && row.favorite);
  await db.run("UPDATE it_term_progress SET favorite=? WHERE user_id=? AND term_key=?", [next, userId, termKey]);
  return next;
}

async function reviewTerm(userId, domain, termKey, grade) {
  await ensureProgressRow(userId, domain, termKey);
  const row = await db.one("SELECT srs_interval, srs_ease, srs_reps FROM it_term_progress WHERE user_id=? AND term_key=?", [userId, termKey]);
  const next = srs.review({ reps: row.srs_reps, interval_days: row.srs_interval, ease: row.srs_ease }, grade === "again" ? "again" : "good");
  await db.run(
    `UPDATE it_term_progress SET srs_due=?, srs_interval=?, srs_ease=?, srs_reps=?, learned=TRUE
     WHERE user_id=? AND term_key=?`,
    [next.due.toISOString(), next.interval_days, next.ease, next.reps, userId, termKey]
  );
  return next;
}

// Bộ thẻ để học trong 1 ngành: đến hạn ôn trước → yêu thích → còn lại (mới/chưa học).
async function getStudyDeck(userId, domain = "cntt", limit = 12) {
  return db.query(
    `SELECT t.key, t.korean, t.gloss_en, t.definition_kr, t.definition_vi, p.srs_due
     FROM it_terms t
     LEFT JOIN it_term_progress p ON p.term_key = t.key AND p.user_id = ?
     WHERE t.domain = ? AND (COALESCE(p.learned, FALSE) = FALSE OR (p.srs_due IS NOT NULL AND p.srs_due <= NOW()))
     ORDER BY CASE WHEN p.srs_due IS NOT NULL AND p.srs_due <= NOW() THEN 0 ELSE 1 END,
              CASE WHEN COALESCE(p.favorite, FALSE) THEN 0 ELSE 1 END,
              t.korean
     LIMIT ?`,
    [userId, domain, Math.min(Number(limit) || 12, 50)]
  );
}

async function userStats(userId, domain = "cntt") {
  const learned = Number(await db.scalar("SELECT COUNT(*) FROM it_term_progress WHERE user_id=? AND domain=? AND learned=TRUE", [userId, domain]).catch(() => 0));
  const favorite = Number(await db.scalar("SELECT COUNT(*) FROM it_term_progress WHERE user_id=? AND domain=? AND favorite=TRUE", [userId, domain]).catch(() => 0));
  const total = Number(await db.scalar("SELECT COUNT(*) FROM it_terms WHERE domain=?", [domain]).catch(() => 0));
  const translated = Number(await db.scalar("SELECT COUNT(*) FROM it_terms WHERE domain=? AND definition_vi <> ''", [domain]).catch(() => 0));
  return { learned, favorite, total, translated };
}

module.exports = {
  ensureItTermsSchema,
  seedItTerms,
  seedDomain,
  searchTerms,
  countTerms,
  setLearned,
  toggleFavorite,
  reviewTerm,
  getStudyDeck,
  userStats,
};
