const { Pool } = require("pg");
const env = require("../config/env");

const pool = new Pool({
  connectionString: env.databaseUrl
});

function convertSql(sql) {
  let converted = String(sql)
    .replace(/\bINSERT\s+OR\s+IGNORE\b/gi, "INSERT")
    .replace(/\browid\b/gi, "id")
    .replace(/\blearned\s*=\s*0\b/gi, "learned = FALSE")
    .replace(/\blearned\s*=\s*1\b/gi, "learned = TRUE")
    .replace(/\blearned\s*=\s*\?/gi, "learned = ?")
    .replace(/\bTRUE\b/gi, "TRUE")
    .replace(/\bFALSE\b/gi, "FALSE");

  let index = 0;
  let inSingleQuote = false;
  let paramIndex = 1;
  let out = "";
  while (index < converted.length) {
    const ch = converted[index];
    if (ch === "'") {
      out += ch;
      if (inSingleQuote && converted[index + 1] === "'") {
        out += converted[index + 1];
        index += 2;
        continue;
      }
      inSingleQuote = !inSingleQuote;
    } else if (ch === "?" && !inSingleQuote) {
      out += `$${paramIndex++}`;
    } else {
      out += ch;
    }
    index += 1;
  }

  if (/^\s*INSERT\b/i.test(out) && /\bINSERT\s+OR\s+IGNORE\b/i.test(sql) && !/\bON\s+CONFLICT\b/i.test(out)) {
    out = out.trim().replace(/;$/, "") + " ON CONFLICT DO NOTHING";
  }
  return out;
}

function normalizeParams(params = []) {
  return Array.from(params).map((value) => {
    if (typeof value === "boolean") return value;
    return value;
  });
}

async function query(sql, params = []) {
  const result = await pool.query(convertSql(sql), normalizeParams(params));
  return result.rows;
}

async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function scalar(sql, params = []) {
  const row = await one(sql, params);
  if (!row) return 0;
  const firstKey = Object.keys(row)[0];
  return row[firstKey];
}

async function run(sql, params = []) {
  const result = await pool.query(convertSql(sql), normalizeParams(params));
  return result;
}

async function withClient(fn) {
  const client = await pool.connect();
  const db = {
    query: async (sql, params = []) => (await client.query(convertSql(sql), normalizeParams(params))).rows,
    one: async (sql, params = []) => {
      const rows = (await client.query(convertSql(sql), normalizeParams(params))).rows;
      return rows[0] || null;
    },
    scalar: async (sql, params = []) => {
      const rows = (await client.query(convertSql(sql), normalizeParams(params))).rows;
      if (!rows[0]) return 0;
      return rows[0][Object.keys(rows[0])[0]];
    },
    run: async (sql, params = []) => client.query(convertSql(sql), normalizeParams(params)),
    begin: () => client.query("BEGIN"),
    commit: () => client.query("COMMIT"),
    rollback: () => client.query("ROLLBACK")
  };
  try {
    return await fn(db);
  } finally {
    client.release();
  }
}

async function tableExists(tableName) {
  const row = await one(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=?",
    [tableName]
  );
  return Boolean(row);
}

async function columnExists(tableName, columnName) {
  const row = await one(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=? AND column_name=?",
    [tableName, columnName]
  );
  return Boolean(row);
}

module.exports = {
  pool,
  query,
  one,
  scalar,
  run,
  withClient,
  tableExists,
  columnExists,
  convertSql
};
