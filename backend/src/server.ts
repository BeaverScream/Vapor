import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { instrument } from "@socket.io/admin-ui";
import { createMetricsRegistry } from "./admin/metricsRegistry";
import { createAdminRouter } from "./admin/createAdminRouter";
import { generateToken } from "./signaling/backendUtils";
import { createPhase0State, getPhase0StateSnapshot, resetPhase0State } from "./signaling/state";
import { registerSocketHandlers } from "./signaling/registerSocketHandlers";
import type { RoomIdentityFactories } from "./signaling/roomLifecycle";

type CreateVaporServerArgs = {
  frontendOrigin?: string;
  port?: number;
  adminMetricsToken?: string;
  adminUiUsername?: string;
  adminUiPassword?: string;
  adminUiOrigin?: string;
  now?: () => number;
  generateRoomId?: () => string;
  generateParticipantId?: () => string;
};

export function createVaporServer({
  frontendOrigin = "http://localhost:5173",
  port = 3001,
  adminMetricsToken,
  adminUiUsername,
  adminUiPassword,
  adminUiOrigin = "https://admin.socket.io",
  now = () => Date.now(),
  generateRoomId = () => generateToken(4),
  generateParticipantId = () => generateToken(6)
}: CreateVaporServerArgs = {}) {
  const app = express();
  const httpServer = createServer(app as any);
  const metrics = createMetricsRegistry();
  const state = createPhase0State();
  const factories: RoomIdentityFactories = {
    generateRoomId,
    generateParticipantId
  };

  app.use(cors({ origin: frontendOrigin }));
  app.use(express.json());

  app.get(
    "/health",
    (
      _req: unknown,
      res: {
        json: (body: { ok: boolean; service: string }) => void;
      }
    ) => {
    res.json({ ok: true, service: "vapor-backend" });
    }
  );

  app.use(
    "/admin",
    createAdminRouter({
      getSnapshot: () => metrics.snapshot(),
      adminMetricsToken
    })
  );

  const io = new Server(httpServer, {
    cors: {
      origin: [frontendOrigin, adminUiOrigin],
      methods: ["GET", "POST"]
    }
  });

  if (adminUiUsername && adminUiPassword) {
    instrument(io, {
      auth: {
        type: "basic",
        username: adminUiUsername,
        password: adminUiPassword
      },
      mode: "production"
    });
  }

  registerSocketHandlers({
    io,
    state,
    metrics,
    now,
    factories
  });

  return {
    app,
    io,
    state,
    testHooks: {
      getStateSnapshot: () => getPhase0StateSnapshot(state),
      resetState: () => resetPhase0State(state)
    },
    start: () =>
      new Promise<void>((resolve) => {
        httpServer.listen(port, () => resolve());
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        io.close((ioErr) => {
          if (ioErr) {
            reject(ioErr);
            return;
          }

          resolve();
        });
      })
  };
}