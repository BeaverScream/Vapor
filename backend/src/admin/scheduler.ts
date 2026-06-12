import type { Metrics } from "./metrics.js";
import {
  buildPeriodicRow,
  type AnalyticsStore,
  type MetricsDeltas,
} from "./analytics.js";
import {
  generateDailyReport,
  generateWeeklyReport,
  generateMonthlyReport,
} from "./reports.js";
import { sendReportEmail } from "./emailDelivery.js";

export const METRICS_FLUSH_INTERVAL_MS = 30 * 60 * 1000;

type RawCounters = ReturnType<Metrics["getRawCounters"]>;

const ZERO_BASELINE: RawCounters = {
  participantsJoinedTotal: 0,
  roomsCreatedTotal: 0,
  roomsDestroyedByReason: {
    host_left: 0,
    host_grace_expired: 0,
    room_ttl_expired: 0,
    solo_timeout_expired: 0,
  },
  errorCounts: {
    RATE_LIMITED: 0,
    INVALID_PASSWORD: 0,
    ROOM_NOT_FOUND: 0,
    ROOM_FULL: 0,
    NOT_AUTHORIZED: 0,
  },
  peakConcurrentRooms: 0,
  peakConcurrentParticipants: 0,
  roomLifetimeTotalMs: 0,
  roomLifetimeCount: 0,
};

function computeDeltas(
  current: RawCounters,
  baseline: RawCounters,
  periodPeaks: { periodPeakRooms: number; periodPeakParticipants: number },
): MetricsDeltas {
  const periodLifetimeCount = current.roomLifetimeCount - baseline.roomLifetimeCount;
  const periodLifetimeTotalMs = current.roomLifetimeTotalMs - baseline.roomLifetimeTotalMs;
  const avgRoomLifetimeMinutes = periodLifetimeCount > 0
    ? Math.round((periodLifetimeTotalMs / periodLifetimeCount / 60_000) * 10) / 10
    : 0;

  return {
    participantsJoinedDelta: current.participantsJoinedTotal - baseline.participantsJoinedTotal,
    roomsCreatedDelta: current.roomsCreatedTotal - baseline.roomsCreatedTotal,
    roomsDestroyedHostLeft:
      current.roomsDestroyedByReason.host_left - baseline.roomsDestroyedByReason.host_left,
    roomsDestroyedGrace:
      current.roomsDestroyedByReason.host_grace_expired - baseline.roomsDestroyedByReason.host_grace_expired,
    roomsDestroyedTtl:
      current.roomsDestroyedByReason.room_ttl_expired - baseline.roomsDestroyedByReason.room_ttl_expired,
    roomsDestroyedSolo:
      current.roomsDestroyedByReason.solo_timeout_expired - baseline.roomsDestroyedByReason.solo_timeout_expired,
    avgRoomLifetimeMinutes,
    errRateLimited: current.errorCounts.RATE_LIMITED - baseline.errorCounts.RATE_LIMITED,
    errInvalidPassword: current.errorCounts.INVALID_PASSWORD - baseline.errorCounts.INVALID_PASSWORD,
    errRoomNotFound: current.errorCounts.ROOM_NOT_FOUND - baseline.errorCounts.ROOM_NOT_FOUND,
    errRoomFull: current.errorCounts.ROOM_FULL - baseline.errorCounts.ROOM_FULL,
    peakRooms: periodPeaks.periodPeakRooms,
    peakParticipants: periodPeaks.periodPeakParticipants,
  };
}

export function createScheduler({
  metrics,
  store,
  flushIntervalMs = METRICS_FLUSH_INTERVAL_MS,
}: {
  metrics: Metrics;
  store: AnalyticsStore;
  flushIntervalMs?: number;
}) {
  const testMode = flushIntervalMs < 60_000;
  let baseline: RawCounters = {
    ...ZERO_BASELINE,
    roomsDestroyedByReason: { ...ZERO_BASELINE.roomsDestroyedByReason },
    errorCounts: { ...ZERO_BASELINE.errorCounts },
  };
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let warmupId: ReturnType<typeof setTimeout> | null = null;
  let lastReportDate: string | null = null;

  function checkReports(): void {
    if (testMode) return;
    const now = new Date();
    const todayLabel = now.toISOString().slice(0, 10);
    if (lastReportDate === null) {
      lastReportDate = todayLabel;
      return;
    }
    if (todayLabel === lastReportDate) return;

    // Midnight crossed — daily report for the previous day
    const prevDate = new Date(lastReportDate + "T00:00:00Z");
    generateDailyReport(store, prevDate)
      .then(sendReportEmail)
      .catch((err: unknown) => console.error("[scheduler] daily report error:", err));

    // The day that was crossed (lastReportDate + 1) determines which periodic reports fire.
    // Using `now` instead would silently skip weekly/monthly reports when a flush fires late.
    const crossedDay = new Date(prevDate);
    crossedDay.setUTCDate(crossedDay.getUTCDate() + 1);

    // Monday midnight — weekly report for the previous Mon–Sun week
    if (crossedDay.getUTCDay() === 1) {
      const lastMonday = new Date(crossedDay);
      lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);
      lastMonday.setUTCHours(0, 0, 0, 0);
      generateWeeklyReport(store, lastMonday)
        .then(sendReportEmail)
        .catch((err: unknown) => console.error("[scheduler] weekly report error:", err));
    }

    // 1st of month — monthly report for the previous calendar month
    if (crossedDay.getUTCDate() === 1) {
      const prevMonth = crossedDay.getUTCMonth() === 0 ? 12 : crossedDay.getUTCMonth();
      const prevYear = crossedDay.getUTCMonth() === 0 ? crossedDay.getUTCFullYear() - 1 : crossedDay.getUTCFullYear();
      generateMonthlyReport(store, prevYear, prevMonth)
        .then(sendReportEmail)
        .catch((err: unknown) => console.error("[scheduler] monthly report error:", err));
    }

    lastReportDate = todayLabel;
  }

  function flush(): void {
    const snapshot = metrics.collectMetricsSnapshot();
    const raw = metrics.getRawCounters();
    const periodPeaks = metrics.getPeriodPeaks();
    const deltas = computeDeltas(raw, baseline, periodPeaks);
    baseline = raw;
    metrics.resetPeriodPeaks();
    store
      .writeSnapshot(buildPeriodicRow(snapshot, deltas))
      .catch((err: unknown) => console.error("[scheduler] flush error:", err));
    checkReports();
  }

  return {
    flush,

    start(): void {
      if (intervalId) return;
      if (!testMode) {
        warmupId = setTimeout(flush, 60_000);
        warmupId.unref?.();
      }
      intervalId = setInterval(flush, flushIntervalMs);
      // Like the signaling sweep, the flush timers must never keep the process alive.
      intervalId.unref?.();
    },

    stop(): void {
      if (warmupId) { clearTimeout(warmupId); warmupId = null; }
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
