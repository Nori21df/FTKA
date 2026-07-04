/**
 * httpUtil.js
 * fetch có trần thời gian (AbortController) dùng chung cho các provider adapter.
 * Trước đây KHÔNG có timeout nào → một provider treo là request của user treo vô hạn.
 * Hết giờ → ném lỗi status 408 để router coi như bước thất bại và nhảy bước kế.
 */
const fetchImpl = global.fetch || require("node-fetch");

async function fetchWithTimeout(url, init = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e && (e.name === "AbortError" || String(e.message || "").includes("abort"))) {
      const err = new Error(`Timeout sau ${Math.round(timeoutMs / 1000)}s`);
      err.status = 408;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchWithTimeout };
