const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const sepay = require("../services/sepay.service");

const router = express.Router();

router.post("/api/webhooks/sepay", asyncHandler(async (req, res) => {
  const result = await sepay.processSepayWebhook(req);
  res.status(200).json({ received: true, ...result });
}));

module.exports = router;
