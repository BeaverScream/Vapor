import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "node:http";
import { Server } from "socket.io";

dotenv.config();

const app = express();
const httpServer = createServer(app);

const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
const port = Number(process.env.PORT ?? 3001);

app.use(cors({ origin: frontendOrigin }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "vapor-backend" });
});

const io = new Server(httpServer, {
  cors: {
    origin: frontendOrigin,
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {
  socket.emit("system:connected", { socketId: socket.id, ts: Date.now() });

  socket.on("room:join", ({ roomId }) => {
    if (!roomId) return;
    socket.join(roomId);
    socket.to(roomId).emit("room:user-joined", { socketId: socket.id });
  });

  socket.on("disconnect", () => {
    // intentionally no persistence or logging
  });
});

httpServer.listen(port, () => {
  console.log(`Vapor backend listening on http://localhost:${port}`);
});
