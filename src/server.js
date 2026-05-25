const { app } = require("./app");
const env = require("./config/env");
const { ensureAuthSchema } = require("./services/authService");
const { ensureBillingSchema } = require("./services/sepay.service");
const { ensureEnergySchema } = require("./services/energyService");

async function start() {
  await ensureAuthSchema();
  await ensureBillingSchema();
  await ensureEnergySchema();
  app.listen(env.port, () => {
    console.log(`FTKA Express app listening at http://localhost:${env.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start FTKA Express app:", error);
  process.exit(1);
});
