const crypto = require("crypto");
const { SePayPgClient } = require("sepay-pg-node");
const db = require("../db");
const env = require("../config/env");
const { isPremiumUser } = require("../middleware/requirePremium");

const PROVIDER = "sepay";
const CURRENCY = "VND";
const PAYMENT_METHOD = "BANK_TRANSFER";
const PENDING = "pending";
const PAID = "paid";
const FAILED = "failed";
const CANCELLED = "cancelled";
const DELETED = "deleted";
const EXPIRED = "expired";
const WEBHOOK_PROCESSED = "processed";
const WEBHOOK_DUPLICATE = "duplicate";
const WEBHOOK_FAILED = "failed";
const WEBHOOK_IGNORED = "ignored";

const PREMIUM_PLANS = [
  { id: "premium_30", name: "Premium 30 days", duration_days: 30, price_vnd: 49000, sort_order: 1 },
  { id: "premium_90", name: "Premium 90 days", duration_days: 90, price_vnd: 129000, sort_order: 2 },
  { id: "premium_365", name: "Premium 365 days", duration_days: 365, price_vnd: 399000, sort_order: 3 }
];

function nowIso() {
  return new Date().toISOString();
}

function baseAppUrl() {
  return String(env.appUrl || env.baseUrl || "http://localhost:3000").replace(/\/+$/, "");
}

function normalizeSepayEnv() {
  return String(env.sepayEnv || "sandbox").toLowerCase() === "production" ? "production" : "sandbox";
}

function json(value) {
  return JSON.stringify(value == null ? null : value);
}

function moneyVnd(value) {
  return `${Number(value || 0).toLocaleString("vi-VN")} VND`;
}

function safeCompare(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireSepayConfig() {
  if (!env.sepayMerchantId || !env.sepaySecretKey) {
    throw new Error("SePay is not configured. Set SEPAY_MERCHANT_ID and SEPAY_SECRET_KEY.");
  }
}

function sepayClient() {
  requireSepayConfig();
  return new SePayPgClient({
    env: normalizeSepayEnv(),
    merchant_id: env.sepayMerchantId,
    secret_key: env.sepaySecretKey
  });
}

function parseAmount(value) {
  const amount = Number(String(value == null ? "" : value).replace(/,/g, ""));
  return Number.isFinite(amount) ? Math.round(amount) : null;
}

function parseDate(value, fallback = new Date()) {
  if (!value) return fallback;
  const parsed = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next;
}

function orderCodeSeed(userId) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const nonce = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `FTKA${stamp}U${userId}${nonce}`;
}

async function ensureUniqueOrderCode(userId, clientDb = db) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = orderCodeSeed(userId);
    const existing = await clientDb.one("SELECT id FROM orders WHERE order_code=?", [code]);
    if (!existing) return code;
  }
  throw new Error("Could not create a unique payment order code.");
}

async function ensureBillingSchema(clientDb = db) {
  await clientDb.run(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free',
      ADD COLUMN IF NOT EXISTS premium_until TIMESTAMPTZ
  `);

  await clientDb.run(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      duration_days INTEGER NOT NULL CHECK (duration_days > 0),
      price_vnd INTEGER NOT NULL CHECK (price_vnd > 0),
      currency TEXT NOT NULL DEFAULT 'VND',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await clientDb.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      order_code TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL REFERENCES plans(id),
      provider TEXT NOT NULL DEFAULT 'sepay',
      amount INTEGER NOT NULL CHECK (amount > 0),
      currency TEXT NOT NULL DEFAULT 'VND',
      status TEXT NOT NULL DEFAULT 'pending',
      checkout_url TEXT,
      checkout_fields JSONB,
      paid_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      cancel_reason TEXT,
      deleted_at TIMESTAMPTZ,
      deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await clientDb.run("ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ");
  await clientDb.run("ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL");
  await clientDb.run("ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT");
  await clientDb.run("ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ");
  await clientDb.run("ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL");

  await clientDb.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'sepay',
      provider_transaction_id TEXT,
      amount INTEGER NOT NULL CHECK (amount > 0),
      currency TEXT NOT NULL DEFAULT 'VND',
      status TEXT NOT NULL,
      raw_payload JSONB,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(provider, provider_transaction_id)
    )
  `);

  await clientDb.run(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'sepay',
      event_key TEXT NOT NULL UNIQUE,
      order_code TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      raw_payload JSONB NOT NULL,
      headers JSONB,
      failure_reason TEXT,
      attempts INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    )
  `);

  await clientDb.run("CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC)");
  await clientDb.run("CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)");
  await clientDb.run("CREATE INDEX IF NOT EXISTS idx_payments_user_created ON payments(user_id, created_at DESC)");
  await clientDb.run("CREATE INDEX IF NOT EXISTS idx_webhook_events_created ON webhook_events(created_at DESC)");

  for (const plan of PREMIUM_PLANS) {
    await clientDb.run(
      `INSERT INTO plans (id, name, duration_days, price_vnd, currency, active, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, TRUE, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name,
         duration_days=EXCLUDED.duration_days,
         price_vnd=EXCLUDED.price_vnd,
         currency=EXCLUDED.currency,
         active=TRUE,
         sort_order=EXCLUDED.sort_order,
         updated_at=EXCLUDED.updated_at`,
      [plan.id, plan.name, plan.duration_days, plan.price_vnd, CURRENCY, plan.sort_order, nowIso()]
    );
  }
}

async function listActivePlans(clientDb = db) {
  const plans = await clientDb.query("SELECT * FROM plans WHERE active=TRUE ORDER BY sort_order, price_vnd");
  return plans.map((plan) => ({ ...plan, price_label: moneyVnd(plan.price_vnd) }));
}

async function getActivePlan(planId, clientDb = db) {
  const plan = await clientDb.one("SELECT * FROM plans WHERE id=? AND active=TRUE", [String(planId || "").trim()]);
  return plan ? { ...plan, price_label: moneyVnd(plan.price_vnd) } : null;
}

async function createSepayOrder(user, planId) {
  if (!user) throw new Error("Login required.");
  const plan = await getActivePlan(planId);
  if (!plan) {
    const error = new Error("Plan not found.");
    error.statusCode = 404;
    throw error;
  }

  const client = sepayClient();
  const checkoutUrl = client.checkout.initCheckoutUrl();
  const appUrl = baseAppUrl();

  return db.withClient(async (clientDb) => {
    await clientDb.begin();
    try {
      const orderCode = await ensureUniqueOrderCode(user.id, clientDb);
      const successUrl = `${appUrl}/payment/success?order_code=${encodeURIComponent(orderCode)}`;
      const errorUrl = `${appUrl}/payment/error?order_code=${encodeURIComponent(orderCode)}`;
      const cancelUrl = `${appUrl}/payment/cancel?order_code=${encodeURIComponent(orderCode)}`;
      const checkoutFields = client.checkout.initOneTimePaymentFields({
        operation: "PURCHASE",
        payment_method: PAYMENT_METHOD,
        order_invoice_number: orderCode,
        order_amount: Number(plan.price_vnd),
        currency: CURRENCY,
        order_description: `${plan.name} - ${orderCode}`,
        customer_id: String(user.id),
        success_url: successUrl,
        error_url: errorUrl,
        cancel_url: cancelUrl,
        custom_data: JSON.stringify({ user_id: user.id, plan_id: plan.id })
      });

      const rows = await clientDb.query(
        `INSERT INTO orders (order_code, user_id, plan_id, provider, amount, currency, status, checkout_url, checkout_fields, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [orderCode, user.id, plan.id, PROVIDER, Number(plan.price_vnd), CURRENCY, PENDING, checkoutUrl, json(checkoutFields), nowIso(), nowIso()]
      );
      await clientDb.commit();
      return {
        order: rows[0],
        plan,
        checkout_url: checkoutUrl,
        checkout_fields: checkoutFields
      };
    } catch (error) {
      await clientDb.rollback();
      throw error;
    }
  });
}

function webhookHeaders(req) {
  const safeHeaders = {};
  for (const [key, value] of Object.entries(req.headers || {})) {
    safeHeaders[key] = Array.isArray(value) ? value.join(", ") : String(value || "");
  }
  return safeHeaders;
}

function rawPayload(req) {
  if (req.rawBody) return req.rawBody.toString("utf8");
  return JSON.stringify(req.body || {});
}

function webhookOrderCode(payload) {
  return String(
    payload?.order?.order_invoice_number ||
    payload?.order_invoice_number ||
    payload?.order_code ||
    ""
  ).trim();
}

function webhookTransactionId(payload) {
  return String(
    payload?.transaction?.transaction_id ||
    payload?.transaction?.id ||
    payload?.transaction_id ||
    ""
  ).trim();
}

function webhookEventKey(payload, raw) {
  const orderCode = webhookOrderCode(payload);
  const transactionId = webhookTransactionId(payload);
  if (orderCode || transactionId) {
    return [
      payload?.notification_type || "UNKNOWN",
      payload?.order?.id || "",
      orderCode,
      transactionId
    ].join(":");
  }
  return `raw:${crypto.createHash("sha256").update(raw || "").digest("hex")}`;
}

function sepaySuccess(payload) {
  const notificationType = String(payload?.notification_type || "").toUpperCase();
  const orderStatus = String(payload?.order?.order_status || "").toUpperCase();
  const transactionStatus = String(payload?.transaction?.transaction_status || "").toUpperCase();
  return notificationType === "ORDER_PAID" &&
    ["CAPTURED", "COMPLETED", "PAID"].includes(orderStatus) &&
    ["APPROVED", "CAPTURED", "COMPLETED", "SUCCESS"].includes(transactionStatus);
}

async function insertWebhookEvent(req) {
  const raw = rawPayload(req);
  const payload = req.body || {};
  const eventKey = webhookEventKey(payload, raw);
  const orderCode = webhookOrderCode(payload);
  const headers = webhookHeaders(req);
  const rows = await db.query(
    `INSERT INTO webhook_events (provider, event_key, order_code, status, raw_payload, headers, created_at, last_seen_at)
     VALUES (?, ?, ?, 'received', ?, ?, ?, ?)
     ON CONFLICT (event_key) DO NOTHING
     RETURNING *`,
    [PROVIDER, eventKey, orderCode || null, json(payload), json(headers), nowIso(), nowIso()]
  );

  if (rows[0]) return { event: rows[0], duplicate: false, payload, raw };

  await db.run(
    "UPDATE webhook_events SET attempts=attempts + 1, last_seen_at=?, raw_payload=?, headers=? WHERE event_key=?",
    [nowIso(), json(payload), json(headers), eventKey]
  );
  const existing = await db.one("SELECT * FROM webhook_events WHERE event_key=?", [eventKey]);
  return { event: existing, duplicate: true, payload, raw };
}

async function markWebhook(eventId, status, reason = "", orderCode = "") {
  await db.run(
    "UPDATE webhook_events SET status=?, failure_reason=?, order_code=COALESCE(?, order_code), processed_at=? WHERE id=?",
    [status, reason || null, orderCode || null, nowIso(), eventId]
  );
}

function verifyIpnSecret(req) {
  if (!env.sepayIpnSecret) {
    return "SEPAY_IPN_SECRET is not configured.";
  }
  const received = req.get("X-Secret-Key") || req.get("x-secret-key");
  if (!received || !safeCompare(received, env.sepayIpnSecret)) {
    return "Invalid SePay IPN secret.";
  }
  return "";
}

async function activatePremiumFromWebhook(event, payload) {
  const orderCode = webhookOrderCode(payload);
  const transactionId = webhookTransactionId(payload) || event.event_key;
  const paidAt = parseDate(payload?.transaction?.transaction_date);
  const paidAmount = parseAmount(payload?.order?.order_amount ?? payload?.transaction?.transaction_amount);
  const currency = String(payload?.order?.order_currency || payload?.transaction?.transaction_currency || CURRENCY).toUpperCase();

  return db.withClient(async (clientDb) => {
    await clientDb.begin();
    try {
      const order = await clientDb.one(
        `SELECT orders.*, plans.duration_days, plans.name AS plan_name
         FROM orders JOIN plans ON plans.id = orders.plan_id
         WHERE orders.order_code=?
         FOR UPDATE`,
        [orderCode]
      );

      if (!order) {
        await clientDb.run(
          "UPDATE webhook_events SET status=?, failure_reason=?, order_code=?, processed_at=? WHERE id=?",
          [WEBHOOK_FAILED, "Order not found.", orderCode || null, nowIso(), event.id]
        );
        await clientDb.commit();
        return { ok: false, reason: "Order not found." };
      }

      if (order.status !== PENDING || order.deleted_at) {
        await clientDb.run(
          "UPDATE webhook_events SET status=?, failure_reason=?, order_code=?, processed_at=? WHERE id=?",
          [WEBHOOK_IGNORED, `Order is ${order.deleted_at ? "deleted" : order.status}; premium activation skipped.`, orderCode, nowIso(), event.id]
        );
        await clientDb.commit();
        return { ok: true, ignored: true, reason: `Order is ${order.deleted_at ? "deleted" : order.status}; premium activation skipped.` };
      }

      if (currency !== CURRENCY) {
        await clientDb.run(
          "UPDATE webhook_events SET status=?, failure_reason=?, order_code=?, processed_at=? WHERE id=?",
          [WEBHOOK_FAILED, `Currency mismatch: ${currency}.`, orderCode, nowIso(), event.id]
        );
        await clientDb.commit();
        return { ok: false, reason: "Currency mismatch." };
      }

      if (paidAmount !== Number(order.amount)) {
        await clientDb.run(
          "UPDATE webhook_events SET status=?, failure_reason=?, order_code=?, processed_at=? WHERE id=?",
          [WEBHOOK_FAILED, `Amount mismatch: received ${paidAmount}, expected ${order.amount}.`, orderCode, nowIso(), event.id]
        );
        await clientDb.commit();
        return { ok: false, reason: "Amount mismatch." };
      }

      const paidAtIso = paidAt.toISOString();
      await clientDb.run(
        "UPDATE orders SET status=?, paid_at=?, updated_at=? WHERE id=?",
        [PAID, paidAtIso, nowIso(), order.id]
      );

      await clientDb.run(
        `INSERT INTO payments (order_id, user_id, provider, provider_transaction_id, amount, currency, status, raw_payload, paid_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (provider, provider_transaction_id) DO NOTHING`,
        [order.id, order.user_id, PROVIDER, transactionId, order.amount, order.currency, PAID, json(payload), paidAtIso, nowIso()]
      );

      const user = await clientDb.one("SELECT id, plan, premium_until FROM users WHERE id=? FOR UPDATE", [order.user_id]);
      const base = isPremiumUser(user) ? new Date(user.premium_until) : new Date();
      const premiumUntil = addDays(base, order.duration_days).toISOString();
      await clientDb.run(
        "UPDATE users SET plan='premium', premium_until=?, updated_at=? WHERE id=?",
        [premiumUntil, nowIso(), order.user_id]
      );

      await clientDb.run(
        "UPDATE webhook_events SET status=?, failure_reason=NULL, order_code=?, processed_at=? WHERE id=?",
        [WEBHOOK_PROCESSED, orderCode, nowIso(), event.id]
      );

      await clientDb.commit();
      return { ok: true, order_id: order.id, premium_until: premiumUntil };
    } catch (error) {
      await clientDb.rollback();
      throw error;
    }
  });
}

async function processSepayWebhook(req) {
  const inserted = await insertWebhookEvent(req);
  if (inserted.duplicate) {
    return { ok: true, duplicate: true, status: inserted.event?.status || WEBHOOK_DUPLICATE };
  }

  const { event, payload } = inserted;
  const orderCode = webhookOrderCode(payload);
  const secretError = verifyIpnSecret(req);
  if (secretError) {
    await markWebhook(event.id, WEBHOOK_FAILED, secretError, orderCode);
    return { ok: false, reason: secretError };
  }

  if (!sepaySuccess(payload)) {
    await markWebhook(event.id, WEBHOOK_FAILED, "Webhook is not a successful ORDER_PAID notification.", orderCode);
    return { ok: false, reason: "Not a successful payment notification." };
  }

  return activatePremiumFromWebhook(event, payload);
}

async function getOrderForUser(orderCode, userId) {
  if (!orderCode || !userId) return null;
  return db.one(
    `SELECT orders.*, plans.name AS plan_name, plans.duration_days
     FROM orders JOIN plans ON plans.id = orders.plan_id
     WHERE orders.order_code=? AND orders.user_id=?`,
    [String(orderCode).trim(), userId]
  );
}

async function getBillingForUser(userId) {
  const user = await db.one("SELECT id, username, email, plan, premium_until FROM users WHERE id=?", [userId]);
  const orders = await db.query(
    `SELECT orders.*, plans.name AS plan_name, plans.duration_days
     FROM orders JOIN plans ON plans.id = orders.plan_id
     WHERE orders.user_id=?
     ORDER BY orders.created_at DESC, orders.id DESC
     LIMIT 50`,
    [userId]
  );
  const payments = await db.query(
    `SELECT payments.*, orders.order_code, plans.name AS plan_name
     FROM payments
     JOIN orders ON orders.id = payments.order_id
     JOIN plans ON plans.id = orders.plan_id
     WHERE payments.user_id=?
     ORDER BY payments.created_at DESC, payments.id DESC
     LIMIT 50`,
    [userId]
  );
  return {
    user,
    is_premium: isPremiumUser(user),
    orders,
    payments
  };
}

async function getAdminPaymentDebug() {
  const [orders, webhookEvents] = await Promise.all([
    db.query(
      `SELECT orders.*, users.username, users.email, plans.name AS plan_name
       FROM orders
       JOIN users ON users.id = orders.user_id
       JOIN plans ON plans.id = orders.plan_id
       WHERE orders.deleted_at IS NULL
       ORDER BY orders.created_at DESC, orders.id DESC
       LIMIT 50`
    ),
    db.query(
      `SELECT *
       FROM webhook_events
       ORDER BY created_at DESC, id DESC
       LIMIT 50`
    )
  ]);
  return { orders, webhook_events: webhookEvents };
}

async function cancelAdminOrder(orderId, adminUserId, reason = "") {
  return db.withClient(async (clientDb) => {
    await clientDb.begin();
    try {
      const order = await clientDb.one("SELECT * FROM orders WHERE id=? AND deleted_at IS NULL FOR UPDATE", [orderId]);
      if (!order) {
        const error = new Error("Order not found.");
        error.statusCode = 404;
        throw error;
      }
      if (order.status !== PENDING) {
        const error = new Error("Only pending orders can be stopped.");
        error.statusCode = 409;
        throw error;
      }
      const updated = await clientDb.one(
        `UPDATE orders
         SET status=?, cancelled_at=?, cancelled_by=?, cancel_reason=?, updated_at=?
         WHERE id=?
         RETURNING *`,
        [CANCELLED, nowIso(), adminUserId || null, String(reason || "").trim() || null, nowIso(), order.id]
      );
      await clientDb.commit();
      return updated;
    } catch (error) {
      await clientDb.rollback();
      throw error;
    }
  });
}

async function deleteAdminOrder(orderId, adminUserId) {
  const deletable = new Set([PENDING, CANCELLED, FAILED, EXPIRED]);
  return db.withClient(async (clientDb) => {
    await clientDb.begin();
    try {
      const order = await clientDb.one("SELECT * FROM orders WHERE id=? AND deleted_at IS NULL FOR UPDATE", [orderId]);
      if (!order) {
        const error = new Error("Order not found.");
        error.statusCode = 404;
        throw error;
      }
      if (order.status === PAID || !deletable.has(order.status)) {
        const error = new Error("Paid orders cannot be deleted.");
        error.statusCode = 409;
        throw error;
      }
      const nextStatus = order.status === PENDING ? DELETED : order.status;
      const updated = await clientDb.one(
        `UPDATE orders
         SET status=?, deleted_at=?, deleted_by=?, updated_at=?
         WHERE id=?
         RETURNING *`,
        [nextStatus, nowIso(), adminUserId || null, nowIso(), order.id]
      );
      await clientDb.commit();
      return updated;
    } catch (error) {
      await clientDb.rollback();
      throw error;
    }
  });
}

module.exports = {
  PROVIDER,
  CURRENCY,
  PAYMENT_METHOD,
  PENDING,
  PAID,
  FAILED,
  CANCELLED,
  DELETED,
  EXPIRED,
  ensureBillingSchema,
  listActivePlans,
  getActivePlan,
  createSepayOrder,
  processSepayWebhook,
  getOrderForUser,
  getBillingForUser,
  getAdminPaymentDebug,
  cancelAdminOrder,
  deleteAdminOrder,
  moneyVnd
};
