import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { instrument } from "@socket.io/admin-ui";
import { createMetricsRegistry } from "./admin/metricsRegistry";
import { createMetrics } from "./admin/metrics";
import { createAdminMetricsRouter } from "./admin/routes";
import { createScheduler, type Scheduler } from "./admin/scheduler";
import { CsvAnalyticsStore, type AnalyticsStore } from "./admin/analytics";
import { generateToken } from "./signaling/backendUtils";
import { createSignalingState, getSignalingStateSnapshot, resetSignalingState } from "./signaling/state";
import { registerSocketHandlers } from "./signaling/registerSocketHandlers";
import { createRateLimitingContext } from "./signaling/handlers/rateLimiting";
import type { RoomIdentityFactories } from "./signaling/roomLifecycle";

type CreateVaporServerArgs = {
  frontendOrigin?: string;
  port?: number;
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
  adminUiUsername,
  adminUiPassword,
  adminUiOrigin = "https://admin.socket.io",
  now = () => Date.now(),
  generateRoomId = () => generateToken(4),
  generateParticipantId = () => generateToken(6)
}: CreateVaporServerArgs = {}) {
  const app = express();
  const httpServer = createServer(app as any);
  const legacyMetrics = createMetricsRegistry();
  const state = createSignalingState();
  const rateLimitCtx = createRateLimitingContext();
  const factories: RoomIdentityFactories = {
    generateRoomId,
    generateParticipantId
  };

  const newMetrics = createMetrics({
    getActiveRoomCount: () => state.rooms.size,
    getActiveParticipantCount: () => {
      let total = 0;
      for (const room of state.rooms.values()) total += room.participants.size;
      return total;
    },
    getActiveSocketCount: () => state.socketToParticipant.size,
    getTemporaryBlocklistSize: () => rateLimitCtx.temporaryBlocklistByIp.size,
    getRateLimitWindowActiveCount: () => rateLimitCtx.createAttemptsByIp.size,
  });

  const metricsAdapter = {
    recordConnection: (socketId: string, ts?: number) => legacyMetrics.recordConnection(socketId, ts),
    recordRoomJoin: (socketId: string, roomId: string) => legacyMetrics.recordRoomJoin(socketId, roomId),
    recordDisconnect: (socketId: string, ts?: number) => legacyMetrics.recordDisconnect(socketId, ts),
    recordRoomCreated: (roomId: string, ts?: number) => legacyMetrics.recordRoomCreated(roomId, ts),
    recordRoomDestroyed: (roomId: string, ts?: number) => legacyMetrics.recordRoomDestroyed(roomId, ts),
    incrementParticipantsJoined: () => newMetrics.incrementParticipantsJoined(),
    incrementRoomsCreated: () => newMetrics.incrementRoomsCreated(),
    incrementRoomDestroyed: newMetrics.incrementRoomDestroyed.bind(newMetrics),
    incrementErrorCount: newMetrics.incrementErrorCount.bind(newMetrics),
    updateRoomLifetimeRolling: newMetrics.updateRoomLifetimeRolling.bind(newMetrics),
    updatePeakMarks: () => newMetrics.updatePeakMarks(),
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

  const hasAdminToken = !!process.env.ADMIN_API_TOKEN;
  const hasAdminBasicAuth = !!(process.env.ADMIN_BASIC_USER && process.env.ADMIN_BASIC_PASS);

  let scheduler: Scheduler | null = null;
  let analyticsStore: AnalyticsStore | null = null;

  if (hasAdminToken || hasAdminBasicAuth) {
    analyticsStore = new CsvAnalyticsStore("./data/vapor-metrics.csv");
    app.use("/admin", createAdminMetricsRouter(newMetrics, analyticsStore));
    scheduler = createScheduler({ metrics: newMetrics, store: analyticsStore });
    scheduler.start();
  } else {
    console.warn("[vapor] No admin auth env vars configured — admin routes are disabled.");
  }

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
    metrics: metricsAdapter,
    now,
    factories,
    rateLimitCtx,
  });

  return {
    app,
    io,
    state,
    testHooks: {
      getStateSnapshot: () => getSignalingStateSnapshot(state),
      resetState: () => resetSignalingState(state)
    },
    start: () =>
      new Promise<void>((resolve) => {
        httpServer.listen(port, () => resolve());
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        scheduler?.stop();
        analyticsStore?.close().catch((err: unknown) => {
          console.error("[vapor] analytics store close error:", err);
        });
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