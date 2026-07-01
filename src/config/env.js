const path = require("path");
const dotenv = require("dotenv");

const rootDir = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(rootDir, ".env") });

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sameSite(value) {
  const normalized = String(value || "lax").trim().toLowerCase();
  return ["lax", "strict", "none"].includes(normalized) ? normalized : "lax";
}

module.exports = {
  rootDir,
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  sessionSecret: process.env.SESSION_SECRET || "",
  sessionMaxAgeDays: positiveNumber(process.env.SESSION_MAX_AGE_DAYS, 14),
  sessionSameSite: sameSite(process.env.SESSION_SAME_SITE),
  databaseUrl: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/ftka",
  baseUrl: process.env.BASE_URL || "http://localhost:3000",
  appUrl: process.env.APP_URL || process.env.BASE_URL || "http://localhost:3000",
  googleAiStudioApiKey: (process.env.GOOGLE_AI_STUDIO_API_KEY || process.env.GEMINI_API_KEY || "").trim(),
  googleAiStudioModel: process.env.GOOGLE_AI_STUDIO_MODEL || "gemma-4-31b-it",
  groqApiKey: (process.env.GROQ_API_KEY || "").trim(),
  nvidiaApiKey: (process.env.NVIDIA_API_KEY || "").trim(),
  cloudflareApiKey: (process.env.CLOUDFLARE_API_KEY || "").trim(),
  cloudflareAccountId: (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim(),
  openrouterApiKey: (process.env.OPENROUTER_API_KEY || "").trim(),
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/auth/google/callback",
  smtpHost: (process.env.SMTP_HOST || "").trim(),
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpSecure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
  smtpUser: (process.env.SMTP_USER || "").trim(),
  smtpPass: process.env.SMTP_PASS || "",
  mailFrom: process.env.MAIL_FROM || "no-reply@localhost",
  listeningAudioDir: process.env.LISTENING_AUDIO_DIR || "./public/audio",
  listeningTtsVoice: process.env.LISTENING_TTS_VOICE || "ko-KR-SunHiNeural",
  listeningTtsRate: process.env.LISTENING_TTS_RATE || "+0%",
  sepayEnv: process.env.SEPAY_ENV || "sandbox",
  sepayMerchantId: (process.env.SEPAY_MERCHANT_ID || "").trim(),
  sepaySecretKey: (process.env.SEPAY_SECRET_KEY || "").trim(),
  sepayIpnSecret: (process.env.SEPAY_IPN_SECRET || "").trim()
};
