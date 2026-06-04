const energy = require("./energyService");

let io = null;

function initEnergySocket(socketIo, sessionMiddleware, authService) {
  io = socketIo;
  io.engine.use(sessionMiddleware);

  io.on("connection", async (socket) => {
    const userId = socket.request.session?.user_id;
    if (!userId) return socket.disconnect(true);

    socket.join(`user:${userId}`);

    try {
      const user = await authService.getUserById(userId);
      if (user && String(user.role || "").toLowerCase() === "admin") socket.join("admin");
      await emitEnergyUpdate(userId);
    } catch (error) {
      console.error("Socket energy init failed:", error);
    }
  });
}

async function emitEnergyUpdate(userId) {
  if (!io || !userId) return null;
  const payload = await energy.getEnergyStatus(userId);
  io.to(`user:${userId}`).emit("energy:update", payload);
  return payload;
}

module.exports = { initEnergySocket, emitEnergyUpdate };