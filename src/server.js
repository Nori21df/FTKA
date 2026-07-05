const http = require("http");
const { Server } = require("socket.io");
const { app, sessionMiddleware } = require("./app");
const env = require("./config/env");
const { ensureAuthSchema } = require("./services/authService");
const authService = require("./services/authService");
const { ensureBillingSchema } = require("./services/sepay.service");
const { ensureEnergySchema } = require("./services/energyService");
const { ensureDailySchema } = require("./services/dailyService");
const { ensureStreakRewardSchema } = require("./services/streakRewardService");
const { ensureSrsSchema } = require("./services/srsService");
const { ensureWritingSchema } = require("./services/writingService");
const { ensureReminderSchema, startReminderScheduler } = require("./services/reminderService");
const { ensureItTermsSchema, seedItTerms } = require("./services/itTermsService");
const { initEnergySocket } = require("./services/energySocket");

async function start() {
  await ensureAuthSchema();
  await ensureBillingSchema();
  await ensureEnergySchema();
  await ensureDailySchema();
  await ensureStreakRewardSchema();
  await ensureSrsSchema();
  await ensureWritingSchema();
  await ensureReminderSchema();
  await ensureItTermsSchema();
  await seedItTerms(); // an toàn: chưa có assets/it-terms.json.gz thì tự bỏ qua
  const server = http.createServer(app);
  const io = new Server(server);
  initEnergySocket(io, sessionMiddleware, authService);
  startReminderScheduler();
  server.listen(env.port, () => {
    console.log(`FTKA Express app listening at http://localhost:${env.port}`);
  });
}

// Lưới an toàn: log thay vì để tiến trình chết âm thầm khi có promise/exception không bắt được.
process.on("unhandledRejection", (reason) => {
  console.error("[process] Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[process] Uncaught exception:", error);
});

start().catch((error) => {
  console.error("Failed to start FTKA Express app:", error);
  process.exit(1);
});
