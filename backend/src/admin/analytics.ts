import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { MetricsSnapshot } from "./metrics";

// === Core types ===

export type MetricsDeltas = {
  participantsJoinedDelta: number;
  roomsCreatedDelta: number;
  roomsDestroyedHostLeft: number;
  roomsDestroyedGrace: number;
  roomsDestroyedTtl: number;
  roomsDestroyedSolo: number;
  /** Weighted average room lifetime for this flush period only (not all-time). */
  avgRoomLifetimeMinutes: number;
  errRateLimited: number;
  errInvalidPassword: number;
  errRoomNotFound: number;
  errRoomFull: number;
  peakRooms: number;
  peakParticipants: number;
};

export type PeriodicRow = {
  recordedAt: number;             // epoch ms
  activeRooms: number;
  activeParticipants: number;
  activeSockets: number;
  avgParticipantsPerRoom: number;
  participantsJoinedDelta: number;
  roomsCreatedDelta: number;
  roomsDestroyedHostLeft: number;
  roomsDestroyedGrace: number;
  roomsDestroyedTtl: number;
  roomsDestroyedSolo: number;
  avgRoomLifetimeMinutes: number;
  errRateLimited: number;
  errInvalidPassword: number;
  errRoomNotFound: number;
  errRoomFull: number;
  peakRooms: number;
  peakParticipants: number;
  blocklistSize: number;
  rssUsedMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  uptimeSeconds: number;
  processStartedAt: number;
};

/** Aggregated metrics for any report period (daily / weekly / monthly). */
export type PeriodAggregate = {
  periodLabel: string;
  totalParticipantsJoined: number;
  totalRoomsCreated: number;
  /** Total destroyed is the sum of destroyReasonBreakdown values — not stored separately. */
  destroyReasonBreakdown: {
    hostLeft: number;
    graceExpired: number;
    ttlExpired: number;
    soloExpired: number;
  };
  /** max(peakRooms) across all PeriodicRows in the period. */
  peakConcurrentRooms: number;
  /** max(peakParticipants) across all PeriodicRows in the period. */
  peakConcurrentParticipants: number;
  /** Mean of rssUsedMb across all PeriodicRows in the period. */
  avgRssUsedMb: number;
  /** max(rssUsedMb) across all PeriodicRows in the period. */
  peakRssUsedMb: number;
  avgRoomLifetimeMinutes: number;
  topErrors: {
    RATE_LIMITED: number;
    INVALID_PASSWORD: number;
    ROOM_NOT_FOUND: number;
    ROOM_FULL: number;
  };
  /** Distinct processStartedAt values — counts server restarts in the period. */
  restartCount: number;
  rows: PeriodicRow[];
};

// === Store interface ===
// Both CSV and Supabase implement this; swap without touching callers.

export interface AnalyticsStore {
  /** Append one periodic row. Call fire-and-forget from the scheduler. */
  writeSnapshot(row: PeriodicRow): Promise<void>;
  /** Return all rows where recordedAt ∈ [fromEpoch, toEpoch] inclusive. */
  queryRows(fromEpoch: number, toEpoch: number): Promise<PeriodicRow[]>;
  /** Release held resources (file handles, DB connections). */
  close(): Promise<void>;
}

// === CSV implementation ===

export const CSV_COLUMNS: ReadonlyArray<keyof PeriodicRow> = [
  "recordedAt", "activeRooms", "activeParticipants", "activeSockets",
  "avgParticipantsPerRoom", "participantsJoinedDelta", "roomsCreatedDelta",
  "roomsDestroyedHostLeft", "roomsDestroyedGrace", "roomsDestroyedTtl",
  "roomsDestroyedSolo", "avgRoomLifetimeMinutes", "errRateLimited",
  "errInvalidPassword", "errRoomNotFound", "errRoomFull", "peakRooms",
  "peakParticipants", "blocklistSize", "rssUsedMb", "heapUsedMb", "heapTotalMb",
  "uptimeSeconds", "processStartedAt",
];

export class CsvAnalyticsStore implements AnalyticsStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) {
      appendFileSync(filePath, CSV_COLUMNS.join(",") + "\n", "utf8");
    }
  }

  async writeSnapshot(row: PeriodicRow): Promise<void> {
    const line = CSV_COLUMNS.map((col) => String(row[col])).join(",") + "\n";
    await appendFile(this.filePath, line, "utf8");
  }

  async queryRows(fromEpoch: number, toEpoch: number): Promise<PeriodicRow[]> {
    if (!existsSync(this.filePath)) return [];
    const lines = readFileSync(this.filePath, "utf8").trim().split("\n");
    if (lines.length < 2) return [];

    return lines.slice(1).flatMap((line) => {
      const vals = line.split(",");
      if (vals.length !== CSV_COLUMNS.length) return [];
      const row = Object.fromEntries(
        CSV_COLUMNS.map((col, i) => [col, Number(vals[i])])
      ) as PeriodicRow;
      return row.recordedAt >= fromEpoch && row.recordedAt <= toEpoch ? [row] : [];
    });
  }

  async close(): Promise<void> { /* per-call appendFile — no held handle to release */ }
}

// === Row builder (used by scheduler) ===

export function buildPeriodicRow(
  snapshot: MetricsSnapshot,
  deltas: MetricsDeltas,
  now = Date.now(),
): PeriodicRow {
  return {
    recordedAt: now,
    activeRooms: snapshot.activeRooms,
    activeParticipants: snapshot.activeParticipants,
    activeSockets: snapshot.activeSockets,
    avgParticipantsPerRoom: snapshot.avgParticipantsPerRoom,
    participantsJoinedDelta: deltas.participantsJoinedDelta,
    roomsCreatedDelta: deltas.roomsCreatedDelta,
    roomsDestroyedHostLeft: deltas.roomsDestroyedHostLeft,
    roomsDestroyedGrace: deltas.roomsDestroyedGrace,
    roomsDestroyedTtl: deltas.roomsDestroyedTtl,
    roomsDestroyedSolo: deltas.roomsDestroyedSolo,
    avgRoomLifetimeMinutes: deltas.avgRoomLifetimeMinutes,
    errRateLimited: deltas.errRateLimited,
    errInvalidPassword: deltas.errInvalidPassword,
    errRoomNotFound: deltas.errRoomNotFound,
    errRoomFull: deltas.errRoomFull,
    peakRooms: deltas.peakRooms,
    peakParticipants: deltas.peakParticipants,
    blocklistSize: snapshot.temporaryBlocklistSize,
    rssUsedMb: snapshot.rssUsedMb,
    heapUsedMb: snapshot.heapUsedMb,
    heapTotalMb: snapshot.heapTotalMb,
    uptimeSeconds: snapshot.uptimeSeconds,
    processStartedAt: snapshot.processStartedAt,
  };
}

// === Aggregate helpers (store-agnostic) ===

function computeAggregate(periodLabel: string, rows: PeriodicRow[]): PeriodAggregate {
  if (rows.length === 0) {
    return {
      periodLabel,
      totalParticipantsJoined: 0,
      totalRoomsCreated: 0,
      destroyReasonBreakdown: { hostLeft: 0, graceExpired: 0, ttlExpired: 0, soloExpired: 0 },
      peakConcurrentRooms: 0,
      peakConcurrentParticipants: 0,
      avgRssUsedMb: 0,
      peakRssUsedMb: 0,
      avgRoomLifetimeMinutes: 0,
      topErrors: { RATE_LIMITED: 0, INVALID_PASSWORD: 0, ROOM_NOT_FOUND: 0, ROOM_FULL: 0 },
      restartCount: 0,
      rows: [],
    };
  }

  let totalParticipantsJoined = 0;
  let totalRoomsCreated = 0;
  let hostLeft = 0, graceExpired = 0, ttlExpired = 0, soloExpired = 0;
  let peakRooms = 0, peakParticipants = 0;
  let rssSum = 0, peakRss = 0;
  let lifetimeWeightedSum = 0, lifetimeWeightedCount = 0;
  let errRateLimited = 0, errInvalidPassword = 0, errRoomNotFound = 0, errRoomFull = 0;
  const startedAts = new Set<number>();

  for (const r of rows) {
    totalParticipantsJoined += r.participantsJoinedDelta;
    totalRoomsCreated += r.roomsCreatedDelta;
    hostLeft += r.roomsDestroyedHostLeft;
    graceExpired += r.roomsDestroyedGrace;
    ttlExpired += r.roomsDestroyedTtl;
    soloExpired += r.roomsDestroyedSolo;
    if (r.peakRooms > peakRooms) peakRooms = r.peakRooms;
    if (r.peakParticipants > peakParticipants) peakParticipants = r.peakParticipants;
    rssSum += r.rssUsedMb;
    if (r.rssUsedMb > peakRss) peakRss = r.rssUsedMb;
    const destroyed = r.roomsDestroyedHostLeft + r.roomsDestroyedGrace +
      r.roomsDestroyedTtl + r.roomsDestroyedSolo;
    if (r.avgRoomLifetimeMinutes > 0 && destroyed > 0) {
      lifetimeWeightedSum += r.avgRoomLifetimeMinutes * destroyed;
      lifetimeWeightedCount += destroyed;
    }
    errRateLimited += r.errRateLimited;
    errInvalidPassword += r.errInvalidPassword;
    errRoomNotFound += r.errRoomNotFound;
    errRoomFull += r.errRoomFull;
    startedAts.add(r.processStartedAt);
  }

  return {
    periodLabel,
    totalParticipantsJoined,
    totalRoomsCreated,
    destroyReasonBreakdown: { hostLeft, graceExpired, ttlExpired, soloExpired },
    peakConcurrentRooms: peakRooms,
    peakConcurrentParticipants: peakParticipants,
    avgRssUsedMb: Math.round((rssSum / rows.length) * 100) / 100,
    peakRssUsedMb: peakRss,
    avgRoomLifetimeMinutes: lifetimeWeightedCount > 0
      ? Math.round((lifetimeWeightedSum / lifetimeWeightedCount) * 10) / 10
      : 0,
    topErrors: { RATE_LIMITED: errRateLimited, INVALID_PASSWORD: errInvalidPassword,
      ROOM_NOT_FOUND: errRoomNotFound, ROOM_FULL: errRoomFull },
    restartCount: startedAts.size,
    rows,
  };
}

export async function queryDailyAggregate(
  store: AnalyticsStore,
  dateLabel: string,   // "YYYY-MM-DD"
): Promise<PeriodAggregate> {
  const [y, m, d] = dateLabel.split("-").map(Number);
  const from = Date.UTC(y, m - 1, d);
  const to = from + 86_400_000 - 1;
  return computeAggregate(dateLabel, await store.queryRows(from, to));
}

export async function queryWeeklyAggregate(
  store: AnalyticsStore,
  weekStart: string,   // "YYYY-MM-DD" of Monday
): Promise<PeriodAggregate> {
  const [y, m, d] = weekStart.split("-").map(Number);
  const from = Date.UTC(y, m - 1, d);
  const to = from + 7 * 86_400_000 - 1;
  return computeAggregate(weekStart, await store.queryRows(from, to));
}

export async function queryMonthlyAggregate(
  store: AnalyticsStore,
  year: number,
  month: number,       // 1-indexed
): Promise<PeriodAggregate> {
  const from = Date.UTC(year, month - 1, 1);
  const to = Date.UTC(year, month, 1) - 1;
  const label = `${year}-${String(month).padStart(2, "0")}`;
  return computeAggregate(label, await store.queryRows(from, to));
}
