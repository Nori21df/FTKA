const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { named } = require("../middleware/viewContext");
const { loginRequired } = require("../middleware/auth");
const sepay = require("../services/sepay.service");

const router = express.Router();

router.get("/pricing", ...named("pricing", asyncHandler(async (req, res) => {
  res.render("pricing.html", {
    plans: await sepay.listActivePlans()
  });
})));

router.post("/api/payments/sepay/create-order", loginRequired, asyncHandler(async (req, res) => {
  try {
    const result = await sepay.createSepayOrder(req.currentUser, req.body.plan_id);
    return res.json({
      success: true,
      provider: sepay.PROVIDER,
      order_code: result.order.order_code,
      checkout_url: result.checkout_url,
      checkout_fields: result.checkout_fields
    });
  } catch (error) {
    const status = error.statusCode || (/not configured/i.test(error.message) ? 503 : 400);
    console.error("[payments:sepay:create-order]", {
      status,
      user_id: req.currentUser?.id || null,
      plan_id: req.body?.plan_id || null,
      error: error.message,
      stack: error.stack
    });
    return res.status(status).json({ success: false, error: error.message });
  }
}));

router.get("/payment/success", ...named("payment_success", loginRequired, asyncHandler(async (req, res) => {
  const order = await sepay.getOrderForUser(req.query.order_code, req.currentUser.id);
  res.render("payment/success.html", { order });
})));

router.get("/payment/error", ...named("payment_error", loginRequired, asyncHandler(async (req, res) => {
  const order = await sepay.getOrderForUser(req.query.order_code, req.currentUser.id);
  res.render("payment/status.html", {
    order,
    title: "Payment was not completed",
    message: "SePay reported an error before the transfer was completed. Your Premium status has not changed."
  });
})));

router.get("/payment/cancel", ...named("payment_cancel", loginRequired, asyncHandler(async (req, res) => {
  const order = await sepay.getOrderForUser(req.query.order_code, req.currentUser.id);
  res.render("payment/status.html", {
    order,
    title: "Payment cancelled",
    message: "The checkout was cancelled. You can start a new VietQR payment whenever you are ready."
  });
})));

// TEMP: Premium tạm tắt — đổi thành true để bật lại trang thanh toán
const BILLING_PAGE_ENABLED = false;

router.get("/account/billing", ...named("account_billing", loginRequired, asyncHandler(async (req, res) => {
  if (!BILLING_PAGE_ENABLED) return res.redirect("/dashboard");
  res.render("account/billing.html", await sepay.getBillingForUser(req.currentUser.id));
})));

module.exports = router;
