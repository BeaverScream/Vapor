export type DestroyReason =
  | "host_left"
  | "host_grace_expired"
  | "room_ttl_expired"
  | "solo_timeout_expired";

export type MetricsErrorCode =
  | "RATE_LIMITED"
  | "INVALID_PASSWORD"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "NOT_AUTHORIZED"
  | "RECONNECT_TOKEN_STALE"
  | "HOST_RECONNECT_WINDOW_EXPIRED";

export type MetricsSnapshot = {
  activeRooms: number;
  activeParticipants: number;
  activeSockets: number;
  avgParticipantsPerRoom: number;
  roomsCreatedTotal: number;
  roomsDestroyedByReason: Record<DestroyReason, number>;
  errorCounts: Record<MetricsErrorCode, number>;
  participantsJoinedTotal: number;
  avgRoomLifetimeMinutes: number;
  peakConcurrentRooms: number;
  peakConcurrentParticipants: number;
  temporaryBlocklistSize: number;
  rateLimitWindowActiveCount: number;
  uptimeSeconds: number;
  rssUsedMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  processStartedAt: number;
};

// Injected by the caller so admin/ never imports from signaling/
export type MetricsStateAccessor = {
  getActiveRoomCount: () => number;
  getActiveParticipantCount: () => number;
  getActiveSocketCount: () => number;
  getTemporaryBlocklistSize: () => number;
  getRateLimitWindowActiveCount: () => number;
};

export function createMetrics(getState: MetricsStateAccessor) {
  const processStartedAt = Date.now();

  let participantsJoinedTotal = 0;
  let roomsCreatedTotal = 0;
  const roomsDestroyedByReason: Record<DestroyReason, number> = {
    host_left: 0,
    host_grace_expired: 0,
    room_ttl_expired: 0,
    solo_timeout_expired: 0,
  };
  const errorCounts: Record<MetricsErrorCode, number> = {
    RATE_LIMITED: 0,
    INVALID_PASSWORD: 0,
    ROOM_NOT_FOUND: 0,
    ROOM_FULL: 0,
    NOT_AUTHORIZED: 0,
    RECONNECT_TOKEN_STALE: 0,
    HOST_RECONNECT_WINDOW_EXPIRED: 0,
  };
  let roomLifetimeTotalMs = 0;
  let roomLifetimeCount = 0;
  let peakConcurrentRooms = 0;
  let peakConcurrentParticipants = 0;
  // Per-interval peaks reset by the scheduler after each flush.
  // All-time peaks above are kept for the live dashboard snapshot only.
  let periodPeakRooms = 0;
  let periodPeakParticipants = 0;

  return {
    collectMetricsSnapshot(): MetricsSnapshot {
      const activeRooms = getState.getActiveRoomCount();
      const activeParticipants = getState.getActiveParticipantCount();
      const activeSockets = getState.getActiveSocketCount();
      const mem = process.memoryUsage();

      return {
        activeRooms,
        activeParticipants,
        activeSockets,
        avgParticipantsPerRoom:
          activeRooms > 0
            ? Number((activeParticipants / activeRooms).toFixed(2))
            : 0,
        participantsJoinedTotal,
        roomsCreatedTotal,
        roomsDestroyedByReason: { ...roomsDestroyedByReason },
        errorCounts: { ...errorCounts },
        avgRoomLifetimeMinutes:
          roomLifetimeCount > 0
            ? Math.round((roomLifetimeTotalMs / roomLifetimeCount / 60_000) * 10) / 10
            : 0,
        peakConcurrentRooms,
        peakConcurrentParticipants,
        temporaryBlocklistSize: getState.getTemporaryBlocklistSize(),
        rateLimitWindowActiveCount: getState.getRateLimitWindowActiveCount(),
        uptimeSeconds: Math.floor((Date.now() - processStartedAt) / 1000),
        rssUsedMb: Number((mem.rss / 1_048_576).toFixed(2)),
        heapUsedMb: Number((mem.heapUsed / 1_048_576).toFixed(2)),
        heapTotalMb: Number((mem.heapTotal / 1_048_576).toFixed(2)),
        processStartedAt,
      };
    },

    incrementParticipantsJoined(): void {
      participantsJoinedTotal += 1;
    },

    incrementRoomsCreated(): void {
      roomsCreatedTotal += 1;
    },

    incrementRoomDestroyed(reason: DestroyReason): void {
      roomsDestroyedByReason[reason] += 1;
    },

    incrementErrorCount(code: MetricsErrorCode): void {
      errorCounts[code] += 1;
    },

    updateRoomLifetimeRolling(lifetimeMs: number): void {
      roomLifetimeTotalMs += lifetimeMs;
      roomLifetimeCount += 1;
    },

    updatePeakMarks(): void {
      const rooms = getState.getActiveRoomCount();
      const participants = getState.getActiveParticipantCount();
      if (rooms > peakConcurrentRooms) peakConcurrentRooms = rooms;
      if (participants > peakConcurrentParticipants) peakConcurrentParticipants = participants;
      if (rooms > periodPeakRooms) periodPeakRooms = rooms;
      if (participants > periodPeakParticipants) periodPeakParticipants = participants;
    },

    getPeriodPeaks(): { periodPeakRooms: number; periodPeakParticipants: number } {
      return { periodPeakRooms, periodPeakParticipants };
    },

    resetPeriodPeaks(): void {
      periodPeakRooms = 0;
      periodPeakParticipants = 0;
    },

    getRawCounters() {
      return {
        participantsJoinedTotal,
        roomsCreatedTotal,
        roomsDestroyedByReason: { ...roomsDestroyedByReason },
        errorCounts: { ...errorCounts },
        peakConcurrentRooms,
        peakConcurrentParticipants,
        roomLifetimeTotalMs,
        roomLifetimeCount,
      };
    },
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
