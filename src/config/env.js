const path = require("path");
const dotenv = require("dotenv");

const rootDir = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(rootDir, ".env") });

module.exports = {
  rootDir,
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  sessionSecret: process.env.SESSION_SECRET || "",
  databaseUrl: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/ftka",
  baseUrl: process.env.BASE_URL || "http://localhost:3000",
  appUrl: process.env.APP_URL || process.env.BASE_URL || "http://localhost:3000",
  googleAiStudioApiKey: (process.env.GOOGLE_AI_STUDIO_API_KEY || process.env.GEMINI_API_KEY || "").trim(),
  googleAiStudioModel: process.env.GOOGLE_AI_STUDIO_MODEL || "gemma-4-31b-it",
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
