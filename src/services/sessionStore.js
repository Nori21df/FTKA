const createPgSession = require("connect-pg-simple");
const session = require("express-session");
const db = require("../db");
const env = require("../config/env");

const PgSessionStore = createPgSession(session);

function createSessionStore() {
  const store = new PgSessionStore({
    pool: db.pool,
    tableName: "user_sessions",
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 15
  });

  store.on("error", (error) => {
    console.error("[session] PostgreSQL session store error:", error);
  });

  console.log("[session] Using PostgreSQL-backed session store", {
    table: "user_sessions",
    maxAgeDays: env.sessionMaxAgeDays
  });

  return store;
}

module.exports = { createSessionStore };
