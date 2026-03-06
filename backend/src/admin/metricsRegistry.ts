type Totals = {
  totalConnections: number;
  totalRoomJoins: number;
  cumulativeConnectionMs: number;
};

type MetricsSnapshot = {
  generatedAt: number;
  serverStartedAt: number;
  uptimeMs: number;
  ram: {
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    externalBytes: number;
  };
  users: {
    active: number;
    totalConnections: number;
    totalConnectionHours: number;
  };
  rooms: {
    active: number;
    totalJoins: number;
  };
};

export function createMetricsRegistry() {
  const connectedSockets = new Set<string>();
  const activeRooms = new Map<string, number>();
  const socketConnectedAt = new Map<string, number>();
  const socketRoomMembership = new Map<string, Set<string>>();

  const totals: Totals = {
    totalConnections: 0,
    totalRoomJoins: 0,
    cumulativeConnectionMs: 0
  };

  const startedAt = Date.now();

  const incrementRoom = (roomId: string): void => {
    const current = activeRooms.get(roomId) ?? 0;
    activeRooms.set(roomId, current + 1);
  };

  const decrementRoom = (roomId: string): void => {
    const current = activeRooms.get(roomId) ?? 0;
    if (current <= 1) {
      activeRooms.delete(roomId);
      return;
    }

    activeRooms.set(roomId, current - 1);
  };

  return {
    recordConnection(socketId: string, now = Date.now()): void {
      if (connectedSockets.has(socketId)) return;

      connectedSockets.add(socketId);
      socketConnectedAt.set(socketId, now);
      socketRoomMembership.set(socketId, new Set<string>());
      totals.totalConnections += 1;
    },

    recordRoomJoin(socketId: string, roomId: string): void {
      if (!roomId) return;

      const membership = socketRoomMembership.get(socketId);
      if (!membership || membership.has(roomId)) return;

      membership.add(roomId);
      incrementRoom(roomId);
      totals.totalRoomJoins += 1;
    },

    recordDisconnect(socketId: string, now = Date.now()): void {
      const connectedAt = socketConnectedAt.get(socketId);
      if (typeof connectedAt === "number") {
        totals.cumulativeConnectionMs += Math.max(0, now - connectedAt);
      }

      const membership = socketRoomMembership.get(socketId);
      if (membership) {
        for (const roomId of membership) {
          decrementRoom(roomId);
        }
      }

      connectedSockets.delete(socketId);
      socketConnectedAt.delete(socketId);
      socketRoomMembership.delete(socketId);
    },

    snapshot(now = Date.now()): MetricsSnapshot {
      let activeConnectionMs = 0;
      for (const connectedAt of socketConnectedAt.values()) {
        activeConnectionMs += Math.max(0, now - connectedAt);
      }

      const totalConnectionMs = totals.cumulativeConnectionMs + activeConnectionMs;
      const memoryUsage = process.memoryUsage();

      return {
        generatedAt: now,
        serverStartedAt: startedAt,
        uptimeMs: Math.max(0, now - startedAt),
        ram: {
          rssBytes: memoryUsage.rss,
          heapTotalBytes: memoryUsage.heapTotal,
          heapUsedBytes: memoryUsage.heapUsed,
          externalBytes: memoryUsage.external
        },
        users: {
          active: connectedSockets.size,
          totalConnections: totals.totalConnections,
          totalConnectionHours: Number((totalConnectionMs / 3_600_000).toFixed(4))
        },
        rooms: {
          active: activeRooms.size,
          totalJoins: totals.totalRoomJoins
        }
      };
    }
  };
}