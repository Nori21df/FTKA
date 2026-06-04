const http = require("http");
const { Server } = require("socket.io");
const { app, sessionMiddleware } = require("./app");
const env = require("./config/env");
const { ensureAuthSchema } = require("./services/authService");
const authService = require("./services/authService");
const { ensureBillingSchema } = require("./services/sepay.service");
const { ensureEnergySchema } = require("./services/energyService");
const { initEnergySocket } = require("./services/energySocket");

async function start() {
  await ensureAuthSchema();
  await ensureBillingSchema();
  await ensureEnergySchema();
  const server = http.createServer(app);
  const io = new Server(server);
  initEnergySocket(io, sessionMiddleware, authService);
  server.listen(env.port, () => {
    console.log(`FTKA Express app listening at http://localhost:${env.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start FTKA Express app:", error);
  process.exit(1);
});
