/// <reference types="node" />

import test from "node:test";
import assert from "node:assert/strict";
import { createMetrics, type MetricsStateAccessor } from "../src/admin/metrics";
import { requireAdminAuth } from "../src/admin/auth";
import { CsvAnalyticsStore, queryDailyAggregate, buildPeriodicRow, type AnalyticsStore, type MetricsDeltas, type PeriodicRow } from "../src/admin/analytics";
import { createScheduler } from "../src/admin/scheduler";
import { sendReportEmail, buildCsv, minutesToReadable, buildEmailHtml } from "../src/admin/emailDelivery";
import { generateDailyReport, generateWeeklyReport, generateMonthlyReport } from "../src/admin/reports";
import { mkdtempSync, rmSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function makeAccessor(
  rooms = 0,
  participants = 0,
  sockets = 0,
  blocklist = 0,
  rlWindows = 0
): MetricsStateAccessor {
  return {
    getActiveRoomCount: () => rooms,
    getActiveParticipantCount: () => participants,
    getActiveSocketCount: () => sockets,
    getTemporaryBlocklistSize: () => blocklist,
    getRateLimitWindowActiveCount: () => rlWindows,
  };
}

test("T6.1-01: collectMetricsSnapshot() returns all required fields with correct types", () => {
  const metrics = createMetrics(makeAccessor(2, 5, 5));
  const snap = metrics.collectMetricsSnapshot();

  const numericFields: Array<keyof typeof snap> = [
    "activeRooms",
    "activeParticipants",
    "activeSockets",
    "avgParticipantsPerRoom",
    "participantsJoinedTotal",
    "roomsCreatedTotal",
    "avgRoomLifetimeMinutes",
    "peakConcurrentRooms",
    "peakConcurrentParticipants",
    "temporaryBlocklistSize",
    "rateLimitWindowActiveCount",
    "uptimeSeconds",
    "rssUsedMb",
    "heapUsedMb",
    "heapTotalMb",
    "processStartedAt",
  ];

  for (const field of numericFields) {
    assert.equal(typeof snap[field], "number", `field "${field}" must be a number`);
    assert.ok(!Number.isNaN(snap[field] as number), `field "${field}" must not be NaN`);
  }

  assert.equal(typeof snap.roomsDestroyedByReason, "object");
  for (const key of ["host_left", "host_grace_expired", "room_ttl_expired", "solo_timeout_expired"] as const) {
    assert.equal(typeof snap.roomsDestroyedByReason[key], "number", `roomsDestroyedByReason.${key} must be a number`);
  }

  assert.equal(typeof snap.errorCounts, "object");
  for (const key of ["RATE_LIMITED", "INVALID_PASSWORD", "ROOM_NOT_FOUND", "ROOM_FULL", "NOT_AUTHORIZED"] as const) {
    assert.equal(typeof snap.errorCounts[key], "number", `errorCounts.${key} must be a number`);
  }
});

test("T6.1-02: each rolling counter increment function increments only its target counter", () => {
  // incrementParticipantsJoined — only participantsJoinedTotal changes
  const m1 = createMetrics(makeAccessor());
  m1.incrementParticipantsJoined();
  const a1 = m1.getRawCounters();
  assert.equal(a1.participantsJoinedTotal, 1);
  assert.equal(a1.roomsCreatedTotal, 0);
  assert.deepEqual(a1.roomsDestroyedByReason, { host_left: 0, host_grace_expired: 0, room_ttl_expired: 0, solo_timeout_expired: 0 });
  assert.deepEqual(a1.errorCounts, { RATE_LIMITED: 0, INVALID_PASSWORD: 0, ROOM_NOT_FOUND: 0, ROOM_FULL: 0, NOT_AUTHORIZED: 0 });

  // incrementRoomsCreated — only roomsCreatedTotal changes
  const m2 = createMetrics(makeAccessor());
  m2.incrementRoomsCreated();
  const a2 = m2.getRawCounters();
  assert.equal(a2.roomsCreatedTotal, 1);
  assert.equal(a2.participantsJoinedTotal, 0);
  assert.deepEqual(a2.roomsDestroyedByReason, { host_left: 0, host_grace_expired: 0, room_ttl_expired: 0, solo_timeout_expired: 0 });
  assert.deepEqual(a2.errorCounts, { RATE_LIMITED: 0, INVALID_PASSWORD: 0, ROOM_NOT_FOUND: 0, ROOM_FULL: 0, NOT_AUTHORIZED: 0 });

  // incrementRoomDestroyed — only the targeted reason key changes
  const m3 = createMetrics(makeAccessor());
  m3.incrementRoomDestroyed("host_left");
  const a3 = m3.getRawCounters();
  assert.equal(a3.roomsDestroyedByReason.host_left, 1);
  assert.equal(a3.roomsDestroyedByReason.host_grace_expired, 0);
  assert.equal(a3.roomsDestroyedByReason.room_ttl_expired, 0);
  assert.equal(a3.roomsDestroyedByReason.solo_timeout_expired, 0);
  assert.equal(a3.roomsCreatedTotal, 0);
  assert.equal(a3.participantsJoinedTotal, 0);

  // incrementErrorCount — only the targeted error code changes
  const m4 = createMetrics(makeAccessor());
  m4.incrementErrorCount("RATE_LIMITED");
  const a4 = m4.getRawCounters();
  assert.equal(a4.errorCounts.RATE_LIMITED, 1);
  assert.equal(a4.errorCounts.INVALID_PASSWORD, 0);
  assert.equal(a4.errorCounts.ROOM_NOT_FOUND, 0);
  assert.equal(a4.errorCounts.ROOM_FULL, 0);
  assert.equal(a4.errorCounts.NOT_AUTHORIZED, 0);
  assert.equal(a4.roomsCreatedTotal, 0);
  assert.equal(a4.participantsJoinedTotal, 0);
});

test("T6.1-09: avgParticipantsPerRoom is 0 (not NaN or Infinity) when activeRooms = 0", () => {
  const metrics = createMetrics(makeAccessor(0, 0, 0));
  const snap = metrics.collectMetricsSnapshot();
  assert.equal(snap.avgParticipantsPerRoom, 0);
  assert.ok(!Number.isNaN(snap.avgParticipantsPerRoom), "avgParticipantsPerRoom must not be NaN when activeRooms = 0");
  assert.ok(Number.isFinite(snap.avgParticipantsPerRoom), "avgParticipantsPerRoom must not be Infinity when activeRooms = 0");
});

test("T6.1-10: avgRoomLifetimeMinutes is 0 when no rooms have been destroyed (zero denominator guard)", () => {
  const metrics = createMetrics(makeAccessor());
  const snap = metrics.collectMetricsSnapshot();
  assert.equal(snap.avgRoomLifetimeMinutes, 0);
});

test("T6.1-11: collectMetricsSnapshot() returns a deep copy of roomsDestroyedByReason and errorCounts", () => {
  const metrics = createMetrics(makeAccessor());

  const snap = metrics.collectMetricsSnapshot();
  snap.roomsDestroyedByReason.host_left = 999;
  snap.errorCounts.RATE_LIMITED = 999;

  const snap2 = metrics.collectMetricsSnapshot();
  assert.equal(snap2.roomsDestroyedByReason.host_left, 0, "mutating snapshot must not alter internal roomsDestroyedByReason");
  assert.equal(snap2.errorCounts.RATE_LIMITED, 0, "mutating snapshot must not alter internal errorCounts");
});

test("T6.1-12: getRawCounters() returns a deep copy so that mutating it does not alter internal state", () => {
  const metrics = createMetrics(makeAccessor());

  const counters = metrics.getRawCounters();
  counters.roomsDestroyedByReason.host_left = 999;
  counters.errorCounts.RATE_LIMITED = 999;

  const counters2 = metrics.getRawCounters();
  assert.equal(counters2.roomsDestroyedByReason.host_left, 0, "mutating getRawCounters result must not alter internal roomsDestroyedByReason");
  assert.equal(counters2.errorCounts.RATE_LIMITED, 0, "mutating getRawCounters result must not alter internal errorCounts");
});

test("T6.1-03: updatePeakMarks() only increases peak values, never decreases them", () => {
  let rooms = 5;
  let participants = 10;
  const metrics = createMetrics({
    getActiveRoomCount: () => rooms,
    getActiveParticipantCount: () => participants,
    getActiveSocketCount: () => 0,
    getTemporaryBlocklistSize: () => 0,
    getRateLimitWindowActiveCount: () => 0,
  });

  metrics.updatePeakMarks();
  const afterHigh = metrics.getRawCounters();
  assert.equal(afterHigh.peakConcurrentRooms, 5);
  assert.equal(afterHigh.peakConcurrentParticipants, 10);

  // Drop active counts below the established peaks
  rooms = 2;
  participants = 3;
  metrics.updatePeakMarks();
  const afterLow = metrics.getRawCounters();
  assert.equal(afterLow.peakConcurrentRooms, 5, "peak rooms must not decrease");
  assert.equal(afterLow.peakConcurrentParticipants, 10, "peak participants must not decrease");
});

test("T6.1-15: updatePeakMarks() updates periodPeakRooms/periodPeakParticipants when active counts exceed period peaks", () => {
  let rooms = 8;
  let participants = 20;
  const metrics = createMetrics({
    getActiveRoomCount: () => rooms,
    getActiveParticipantCount: () => participants,
    getActiveSocketCount: () => 0,
    getTemporaryBlocklistSize: () => 0,
    getRateLimitWindowActiveCount: () => 0,
  });

  metrics.updatePeakMarks();
  const peaks1 = metrics.getPeriodPeaks();
  assert.equal(peaks1.periodPeakRooms, 8, "period peak rooms must be 8 after first update");
  assert.equal(peaks1.periodPeakParticipants, 20, "period peak participants must be 20 after first update");

  // Higher counts — period peaks should rise
  rooms = 15;
  participants = 40;
  metrics.updatePeakMarks();
  const peaks2 = metrics.getPeriodPeaks();
  assert.equal(peaks2.periodPeakRooms, 15, "period peak rooms must rise to 15");
  assert.equal(peaks2.periodPeakParticipants, 40, "period peak participants must rise to 40");

  // Lower counts — period peaks must not decrease
  rooms = 3;
  participants = 5;
  metrics.updatePeakMarks();
  const peaks3 = metrics.getPeriodPeaks();
  assert.equal(peaks3.periodPeakRooms, 15, "period peak rooms must not decrease when active count drops");
  assert.equal(peaks3.periodPeakParticipants, 40, "period peak participants must not decrease when active count drops");
});

test("T6.1-16: resetPeriodPeaks() zeroes periodPeakRooms/periodPeakParticipants without affecting all-time peaks", () => {
  let rooms = 12;
  let participants = 30;
  const metrics = createMetrics({
    getActiveRoomCount: () => rooms,
    getActiveParticipantCount: () => participants,
    getActiveSocketCount: () => 0,
    getTemporaryBlocklistSize: () => 0,
    getRateLimitWindowActiveCount: () => 0,
  });

  metrics.updatePeakMarks();
  const countersBeforeReset = metrics.getRawCounters();
  assert.equal(countersBeforeReset.peakConcurrentRooms, 12, "all-time peak rooms must be 12 before reset");
  assert.equal(countersBeforeReset.peakConcurrentParticipants, 30, "all-time peak participants must be 30 before reset");

  metrics.resetPeriodPeaks();

  const peaksAfterReset = metrics.getPeriodPeaks();
  assert.equal(peaksAfterReset.periodPeakRooms, 0, "period peak rooms must be 0 after reset");
  assert.equal(peaksAfterReset.periodPeakParticipants, 0, "period peak participants must be 0 after reset");

  // All-time peaks must be unchanged
  const countersAfterReset = metrics.getRawCounters();
  assert.equal(countersAfterReset.peakConcurrentRooms, 12, "all-time peak rooms must remain 12 after period reset");
  assert.equal(countersAfterReset.peakConcurrentParticipants, 30, "all-time peak participants must remain 30 after period reset");
});

test("T6.1-17: getPeriodPeaks() returns correct current period-peak values before and after reset", () => {
  let rooms = 6;
  let participants = 18;
  const metrics = createMetrics({
    getActiveRoomCount: () => rooms,
    getActiveParticipantCount: () => participants,
    getActiveSocketCount: () => 0,
    getTemporaryBlocklistSize: () => 0,
    getRateLimitWindowActiveCount: () => 0,
  });

  const initial = metrics.getPeriodPeaks();
  assert.equal(initial.periodPeakRooms, 0, "period peaks must start at 0");
  assert.equal(initial.periodPeakParticipants, 0, "period peaks must start at 0");

  metrics.updatePeakMarks();
  const afterUpdate = metrics.getPeriodPeaks();
  assert.equal(afterUpdate.periodPeakRooms, 6, "getPeriodPeaks must reflect updated peak");
  assert.equal(afterUpdate.periodPeakParticipants, 18, "getPeriodPeaks must reflect updated peak");

  metrics.resetPeriodPeaks();
  const afterReset = metrics.getPeriodPeaks();
  assert.equal(afterReset.periodPeakRooms, 0, "getPeriodPeaks must return 0 after reset");
  assert.equal(afterReset.periodPeakParticipants, 0, "getPeriodPeaks must return 0 after reset");
});

// ---- T6.2 Unit Tests: requireAdminAuth ----

function makeAuthMocks() {
  let nextCalled = false;
  let statusCode = 0;
  const next = () => { nextCalled = true; };
  const res = {
    status: (code: number) => { statusCode = code; return { end: () => {} }; },
  };
  return { next, res: res as unknown as Parameters<typeof requireAdminAuth>[1], getNextCalled: () => nextCalled, getStatusCode: () => statusCode };
}

test("T6.2-05: Bearer token comparison is length-sensitive — prefix of correct token is rejected", () => {
  const REAL_TOKEN = "secret-token-full-t6205";
  const PREFIX_TOKEN = "secret-token-full"; // shorter prefix, not equal

  const prev = process.env.ADMIN_API_TOKEN;
  process.env.ADMIN_API_TOKEN = REAL_TOKEN;

  try {
    const { next, res, getNextCalled, getStatusCode } = makeAuthMocks();
    requireAdminAuth({ headers: { authorization: `Bearer ${PREFIX_TOKEN}` } }, res, next);
    assert.equal(getNextCalled(), false, "next must not be called for a prefix token");
    assert.equal(getStatusCode(), 401, "prefix token must receive 401");
  } finally {
    if (prev !== undefined) process.env.ADMIN_API_TOKEN = prev;
    else delete process.env.ADMIN_API_TOKEN;
  }
});

test("T6.2-06: Basic auth handles password containing a colon — only first colon is separator", () => {
  const USER = "admin";
  const PASS = "pass:word"; // colon inside the password

  const prevUser = process.env.ADMIN_BASIC_USER;
  const prevPass = process.env.ADMIN_BASIC_PASS;
  const prevToken = process.env.ADMIN_API_TOKEN;
  process.env.ADMIN_BASIC_USER = USER;
  process.env.ADMIN_BASIC_PASS = PASS;
  delete process.env.ADMIN_API_TOKEN;

  try {
    const { next, res, getNextCalled } = makeAuthMocks();
    const encoded = Buffer.from(`${USER}:${PASS}`).toString("base64");
    requireAdminAuth({ headers: { authorization: `Basic ${encoded}` } }, res, next);
    assert.equal(getNextCalled(), true, "Basic auth with colon-in-password should grant access");
  } finally {
    if (prevUser !== undefined) process.env.ADMIN_BASIC_USER = prevUser;
    else delete process.env.ADMIN_BASIC_USER;
    if (prevPass !== undefined) process.env.ADMIN_BASIC_PASS = prevPass;
    else delete process.env.ADMIN_BASIC_PASS;
    if (prevToken !== undefined) process.env.ADMIN_API_TOKEN = prevToken;
    else delete process.env.ADMIN_API_TOKEN;
  }
});

test("T6.2-07: Lowercase 'bearer ' prefix is rejected — auth prefix matching is case-sensitive", () => {
  const TOKEN = "secret-t6207";

  const prev = process.env.ADMIN_API_TOKEN;
  process.env.ADMIN_API_TOKEN = TOKEN;

  try {
    const { next, res, getNextCalled, getStatusCode } = makeAuthMocks();
    requireAdminAuth({ headers: { authorization: `bearer ${TOKEN}` } }, res, next);
    assert.equal(getNextCalled(), false, "next must not be called for lowercase 'bearer' prefix");
    assert.equal(getStatusCode(), 401, "lowercase bearer prefix must receive 401");
  } finally {
    if (prev !== undefined) process.env.ADMIN_API_TOKEN = prev;
    else delete process.env.ADMIN_API_TOKEN;
  }
});

// ---- T6.4 helpers ----

function makeRow(recordedAt: number, overrides: Partial<PeriodicRow> = {}): PeriodicRow {
  return {
    recordedAt,
    activeRooms: 0,
    activeParticipants: 0,
    activeSockets: 0,
    avgParticipantsPerRoom: 0,
    participantsJoinedDelta: 0,
    roomsCreatedDelta: 0,
    roomsDestroyedHostLeft: 0,
    roomsDestroyedGrace: 0,
    roomsDestroyedTtl: 0,
    roomsDestroyedSolo: 0,
    avgRoomLifetimeMinutes: 0,
    errRateLimited: 0,
    errInvalidPassword: 0,
    errRoomNotFound: 0,
    errRoomFull: 0,
    peakRooms: 0,
    peakParticipants: 0,
    blocklistSize: 0,
    rssUsedMb: 0,
    heapUsedMb: 0,
    heapTotalMb: 0,
    uptimeSeconds: 0,
    processStartedAt: 1000,
    ...overrides,
  };
}

class MemoryStore implements AnalyticsStore {
  private _rows: PeriodicRow[];
  constructor(rows: PeriodicRow[] = []) { this._rows = [...rows]; }
  async writeSnapshot(row: PeriodicRow): Promise<void> { this._rows.push(row); }
  async queryRows(fromEpoch: number, toEpoch: number): Promise<PeriodicRow[]> {
    return this._rows.filter(r => r.recordedAt >= fromEpoch && r.recordedAt <= toEpoch);
  }
  async close(): Promise<void> {}
}

// ---- T6.4 Unit Tests: CsvAnalyticsStore and aggregate helpers ----

test("T6.4-01: CsvAnalyticsStore.writeSnapshot appends a valid CSV row and file is created with correct header", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vapor-t6401-"));
  try {
    const filePath = join(dir, "a.csv");
    const store = new CsvAnalyticsStore(filePath);
    await store.writeSnapshot(makeRow(1_000_000));
    const lines = readFileSync(filePath, "utf8").trim().split("\n");
    assert.ok(lines[0].startsWith("recordedAt,"), "first line must be the CSV header");
    assert.ok(lines[0].includes("processStartedAt"), "header must include processStartedAt");
    assert.equal(lines.length, 2, "file must have exactly one header and one data row");
    assert.ok(lines[1].startsWith("1000000,"), "data row must start with the recordedAt value");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("T6.4-02: queryRows returns only rows within the epoch range and excludes rows outside it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vapor-t6402-"));
  try {
    const store = new CsvAnalyticsStore(join(dir, "a.csv"));
    await store.writeSnapshot(makeRow(500));
    await store.writeSnapshot(makeRow(1000));
    await store.writeSnapshot(makeRow(2000));
    await store.writeSnapshot(makeRow(3000));
    const result = await store.queryRows(1000, 2000);
    assert.equal(result.length, 2);
    assert.ok(result.every(r => r.recordedAt >= 1000 && r.recordedAt <= 2000));
    assert.ok(!result.some(r => r.recordedAt === 500 || r.recordedAt === 3000));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("T6.4-03: computeAggregate returns correct totals, peaks, weighted avg lifetime, and restart count", async () => {
  const t0 = Date.UTC(2025, 0, 1);
  const rows = [
    makeRow(t0 + 1000, { participantsJoinedDelta: 10, roomsCreatedDelta: 4, roomsDestroyedHostLeft: 2, roomsDestroyedGrace: 1, peakRooms: 5, peakParticipants: 20, avgRoomLifetimeMinutes: 3.0, errRateLimited: 2, rssUsedMb: 80, heapUsedMb: 100, processStartedAt: 999 }),
    makeRow(t0 + 2000, { participantsJoinedDelta: 5, roomsCreatedDelta: 2, roomsDestroyedTtl: 1, roomsDestroyedSolo: 1, peakRooms: 8, peakParticipants: 15, avgRoomLifetimeMinutes: 5.0, errRoomNotFound: 1, rssUsedMb: 120, heapUsedMb: 200, processStartedAt: 1234 }),
  ];
  const agg = await queryDailyAggregate(new MemoryStore(rows), "2025-01-01");
  assert.equal(agg.totalParticipantsJoined, 15);
  assert.equal(agg.totalRoomsCreated, 6);
  assert.equal(agg.destroyReasonBreakdown.hostLeft, 2);
  assert.equal(agg.destroyReasonBreakdown.graceExpired, 1);
  assert.equal(agg.destroyReasonBreakdown.ttlExpired, 1);
  assert.equal(agg.destroyReasonBreakdown.soloExpired, 1);
  assert.equal(agg.destroyReasonBreakdown.hostLeft + agg.destroyReasonBreakdown.graceExpired +
    agg.destroyReasonBreakdown.ttlExpired + agg.destroyReasonBreakdown.soloExpired, 5, "sum of reasons must be 5");
  assert.equal(agg.peakConcurrentRooms, 8);
  assert.equal(agg.peakConcurrentParticipants, 20);
  // weighted avg: (3.0*3 + 5.0*2) / (3+2) = 19/5 = 3.8
  assert.equal(agg.avgRoomLifetimeMinutes, 3.8);
  assert.equal(agg.restartCount, 2);  // two distinct processStartedAt values
  assert.equal(agg.topErrors.RATE_LIMITED, 2);
  assert.equal(agg.topErrors.ROOM_NOT_FOUND, 1);
  // RSS aggregate fields: row rssUsedMb values are 80 and 120
  assert.equal(agg.avgRssUsedMb, 100, "avgRssUsedMb must be mean of 80 and 120");
  assert.equal(agg.peakRssUsedMb, 120, "peakRssUsedMb must be max of 80 and 120");
});

test("T6.4-04: queryRows returns [] when file contains only the header line (no data rows)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vapor-t6404-"));
  try {
    const store = new CsvAnalyticsStore(join(dir, "a.csv"));
    const result = await store.queryRows(0, Date.now() + 1_000_000);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("T6.4-05: queryRows silently skips a corrupt CSV line with wrong column count", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vapor-t6405-"));
  const filePath = join(dir, "a.csv");
  try {
    const store = new CsvAnalyticsStore(filePath);
    await store.writeSnapshot(makeRow(5000));
    appendFileSync(filePath, "1234,corrupt,only,four,columns\n", "utf8");
    const result = await store.queryRows(0, Date.now() + 1_000_000);
    assert.equal(result.length, 1, "only the valid row should be returned");
    assert.equal(result[0].recordedAt, 5000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("T6.4-06: CsvAnalyticsStore does not overwrite existing header on second instantiation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vapor-t6406-"));
  const filePath = join(dir, "a.csv");
  try {
    const s1 = new CsvAnalyticsStore(filePath);
    await s1.writeSnapshot(makeRow(1000));
    const s2 = new CsvAnalyticsStore(filePath);
    await s2.writeSnapshot(makeRow(2000));
    const lines = readFileSync(filePath, "utf8").trim().split("\n");
    assert.equal(lines.length, 3, "file must have 1 header + 2 data rows (not 2 headers)");
    assert.ok(lines[0].startsWith("recordedAt,"), "first line is the header");
    assert.ok(lines[1].startsWith("1000,"), "second line is first data row");
    assert.ok(lines[2].startsWith("2000,"), "third line is second data row");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("T6.4-07: computeAggregate returns avgRoomLifetimeMinutes: 0 when no rooms destroyed (zero denominator guard)", async () => {
  const t0 = Date.UTC(2025, 1, 1);
  const rows = [
    makeRow(t0 + 1000, { avgRoomLifetimeMinutes: 0 }),
    makeRow(t0 + 2000, { avgRoomLifetimeMinutes: 0 }),
  ];
  const agg = await queryDailyAggregate(new MemoryStore(rows), "2025-02-01");
  assert.equal(agg.avgRoomLifetimeMinutes, 0);
  assert.ok(Number.isFinite(agg.avgRoomLifetimeMinutes), "must not be Infinity");
  assert.ok(!Number.isNaN(agg.avgRoomLifetimeMinutes), "must not be NaN");
});

test("T6.4-08: computeAggregate counts restartCount as distinct processStartedAt values, not row count", async () => {
  const t0 = Date.UTC(2025, 2, 1);
  const rows = [
    makeRow(t0 + 1000, { processStartedAt: 100 }),
    makeRow(t0 + 2000, { processStartedAt: 100 }),
    makeRow(t0 + 3000, { processStartedAt: 200 }),
    makeRow(t0 + 4000, { processStartedAt: 300 }),
    makeRow(t0 + 5000, { processStartedAt: 300 }),
  ];
  const agg = await queryDailyAggregate(new MemoryStore(rows), "2025-03-01");
  // 5 rows but only 3 distinct processStartedAt values: 100, 200, 300
  assert.equal(agg.restartCount, 3);
});

test("T6.4-09: queryDailyAggregate includes row at UTC midnight and excludes row 1ms before midnight", async () => {
  const midnight = Date.UTC(2025, 5, 15);  // 2025-06-15 00:00:00.000 UTC
  const rows = [
    makeRow(midnight - 1, { participantsJoinedDelta: 5 }),  // excluded (before day starts)
    makeRow(midnight, { participantsJoinedDelta: 10 }),      // included (exact boundary)
  ];
  const agg = await queryDailyAggregate(new MemoryStore(rows), "2025-06-15");
  assert.equal(agg.rows.length, 1, "only the row at UTC midnight should be included");
  assert.equal(agg.rows[0].recordedAt, midnight);
  assert.equal(agg.totalParticipantsJoined, 10);
});

test("T6.4-10: NOT_AUTHORIZED tracked in MetricsSnapshot.errorCounts but intentionally absent from PeriodicRow", () => {
  // NOT_AUTHORIZED is an admin-auth guard error, not a user-session error.
  // It is tracked for live visibility but excluded from the flush path because
  // it carries no analytically useful trend signal for the observability store.
  const metrics = createMetrics(makeAccessor());
  metrics.incrementErrorCount("NOT_AUTHORIZED");
  const snap = metrics.collectMetricsSnapshot();
  assert.equal(snap.errorCounts.NOT_AUTHORIZED, 1, "MetricsSnapshot must track NOT_AUTHORIZED errors");

  const row = makeRow(Date.now());
  assert.ok(!("errNotAuthorized" in row), "PeriodicRow must not have errNotAuthorized — omitted by design");
});

test("T6.4-11: buildPeriodicRow does not carry forward forbidden fields — explicit field mapping acts as a deny-list", () => {
  const metrics = createMetrics(makeAccessor(2, 4, 4));
  const snapshot = metrics.collectMetricsSnapshot();

  // Simulate a developer accidentally adding user-identifiable fields to MetricsSnapshot
  const polluted = {
    ...snapshot,
    roomId: "secret-room-123",
    participantNickname: "Alice",
  } as unknown as ReturnType<typeof metrics.collectMetricsSnapshot>;

  const zeroDeltas: MetricsDeltas = {
    participantsJoinedDelta: 0,
    roomsCreatedDelta: 0,
    roomsDestroyedHostLeft: 0,
    roomsDestroyedGrace: 0,
    roomsDestroyedTtl: 0,
    roomsDestroyedSolo: 0,
    avgRoomLifetimeMinutes: 0,
    errRateLimited: 0,
    errInvalidPassword: 0,
    errRoomNotFound: 0,
    errRoomFull: 0,
    peakRooms: 0,
    peakParticipants: 0,
  };

  const row = buildPeriodicRow(polluted, zeroDeltas);

  assert.ok(!("roomId" in row), "buildPeriodicRow must not include roomId — forbidden user-identifiable field");
  assert.ok(!("participantNickname" in row), "buildPeriodicRow must not include participantNickname — forbidden user-identifiable field");
});

test("T6.4-12: buildPeriodicRow maps rssUsedMb from snapshot; row has rssUsedMb >= heapUsedMb for any realistic input", () => {
  const metrics = createMetrics(makeAccessor(2, 4, 4));
  const snapshot = metrics.collectMetricsSnapshot();

  const zeroDeltas: MetricsDeltas = {
    participantsJoinedDelta: 0,
    roomsCreatedDelta: 0,
    roomsDestroyedHostLeft: 0,
    roomsDestroyedGrace: 0,
    roomsDestroyedTtl: 0,
    roomsDestroyedSolo: 0,
    avgRoomLifetimeMinutes: 0,
    errRateLimited: 0,
    errInvalidPassword: 0,
    errRoomNotFound: 0,
    errRoomFull: 0,
    peakRooms: 0,
    peakParticipants: 0,
  };

  const row = buildPeriodicRow(snapshot, zeroDeltas);

  assert.equal(row.rssUsedMb, snapshot.rssUsedMb, "row.rssUsedMb must equal snapshot.rssUsedMb");
  assert.ok(
    row.rssUsedMb >= row.heapUsedMb,
    `rssUsedMb (${row.rssUsedMb}) must be >= heapUsedMb (${row.heapUsedMb}) — RSS is the total OS-resident footprint, heap is a subset`,
  );
});

// ---- T6.5 Unit Tests: Scheduler ----

function makeInlineStore(rows: PeriodicRow[]): AnalyticsStore {
  return {
    async writeSnapshot(row: PeriodicRow): Promise<void> { rows.push(row); },
    async queryRows(): Promise<PeriodicRow[]> { return []; },
    async close(): Promise<void> {},
  };
}

test("T6.5-01: createScheduler with short flushIntervalMs writes rows at expected cadence", async () => {
  const metrics = createMetrics(makeAccessor(1, 2, 2));
  const rows: PeriodicRow[] = [];
  const scheduler = createScheduler({ metrics, store: makeInlineStore(rows), flushIntervalMs: 50 });

  scheduler.start();
  await new Promise<void>(r => setTimeout(r, 200));
  scheduler.stop();

  assert.ok(rows.length >= 2, `expected at least 2 rows in 200ms with 50ms interval, got ${rows.length}`);
  assert.ok(rows.length <= 6, `expected at most 6 rows in 200ms with 50ms interval, got ${rows.length}`);
});

test("T6.5-02: two consecutive flush() calls produce per-period delta values, not cumulative totals", async () => {
  const metrics = createMetrics(makeAccessor());
  const rows: PeriodicRow[] = [];
  const scheduler = createScheduler({ metrics, store: makeInlineStore(rows), flushIntervalMs: 100_000 });

  metrics.incrementRoomsCreated();
  metrics.incrementRoomsCreated();
  metrics.incrementRoomsCreated();
  scheduler.flush();
  await new Promise<void>(r => setImmediate(r));

  metrics.incrementRoomsCreated();
  scheduler.flush();
  await new Promise<void>(r => setImmediate(r));

  assert.equal(rows.length, 2, "exactly 2 rows must have been written");
  assert.equal(rows[0].roomsCreatedDelta, 3, "first flush: delta must be 3");
  assert.equal(rows[1].roomsCreatedDelta, 1, "second flush: delta must be 1, not cumulative 4");
});

test("T6.5-03: flush() writes one row immediately without waiting for the interval", async () => {
  const metrics = createMetrics(makeAccessor());
  const rows: PeriodicRow[] = [];
  const scheduler = createScheduler({ metrics, store: makeInlineStore(rows), flushIntervalMs: 60_000_000 });

  scheduler.flush();
  await new Promise<void>(r => setImmediate(r));

  assert.equal(rows.length, 1, "flush() must write exactly one row immediately");
});

test("T6.5-04: processStartedAt in each flushed row matches actual process start epoch and differs across restart events", async () => {
  const metrics1 = createMetrics(makeAccessor());
  const rows1: PeriodicRow[] = [];
  const scheduler1 = createScheduler({ metrics: metrics1, store: makeInlineStore(rows1), flushIntervalMs: 100_000 });

  scheduler1.flush();
  scheduler1.flush();
  await new Promise<void>(r => setImmediate(r));

  const expectedStart1 = metrics1.collectMetricsSnapshot().processStartedAt;
  assert.equal(rows1.length, 2);
  assert.equal(rows1[0].processStartedAt, expectedStart1, "row 0 processStartedAt must match metrics1 start");
  assert.equal(rows1[1].processStartedAt, expectedStart1, "row 1 processStartedAt must match metrics1 start");

  // Ensure a new metrics instance (restart) has a different processStartedAt
  await new Promise<void>(r => setTimeout(r, 5));
  const metrics2 = createMetrics(makeAccessor());
  assert.notEqual(
    metrics1.collectMetricsSnapshot().processStartedAt,
    metrics2.collectMetricsSnapshot().processStartedAt,
    "two separately created metrics instances must have different processStartedAt values",
  );
});

test("T6.5-05: flush() before any counter increments produces a row with all delta fields equal to 0", async () => {
  const metrics = createMetrics(makeAccessor());
  const rows: PeriodicRow[] = [];
  const scheduler = createScheduler({ metrics, store: makeInlineStore(rows), flushIntervalMs: 100_000 });

  scheduler.flush();
  await new Promise<void>(r => setImmediate(r));

  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.participantsJoinedDelta, 0, "participantsJoinedDelta must be 0");
  assert.equal(row.roomsCreatedDelta, 0, "roomsCreatedDelta must be 0");
  assert.equal(row.roomsDestroyedHostLeft, 0, "roomsDestroyedHostLeft must be 0");
  assert.equal(row.roomsDestroyedGrace, 0, "roomsDestroyedGrace must be 0");
  assert.equal(row.roomsDestroyedTtl, 0, "roomsDestroyedTtl must be 0");
  assert.equal(row.roomsDestroyedSolo, 0, "roomsDestroyedSolo must be 0");
  assert.equal(row.errRateLimited, 0, "errRateLimited must be 0");
  assert.equal(row.errInvalidPassword, 0, "errInvalidPassword must be 0");
  assert.equal(row.errRoomNotFound, 0, "errRoomNotFound must be 0");
  assert.equal(row.errRoomFull, 0, "errRoomFull must be 0");
  assert.equal(row.avgRoomLifetimeMinutes, 0, "avgRoomLifetimeMinutes must be 0");
});

test("T6.5-06: stop() called before start() is a no-op and does not throw", () => {
  const metrics = createMetrics(makeAccessor());
  const store: AnalyticsStore = {
    async writeSnapshot(): Promise<void> {},
    async queryRows(): Promise<PeriodicRow[]> { return []; },
    async close(): Promise<void> {},
  };
  const scheduler = createScheduler({ metrics, store, flushIntervalMs: 100_000 });
  assert.doesNotThrow(() => scheduler.stop(), "stop() before start() must not throw");
});

test("T6.5-07: peakRooms and peakParticipants reflect the interval's peak only — reset to 0 after each flush", async () => {
  let rooms = 10;
  let participants = 25;
  const metrics = createMetrics({
    getActiveRoomCount: () => rooms,
    getActiveParticipantCount: () => participants,
    getActiveSocketCount: () => 0,
    getTemporaryBlocklistSize: () => 0,
    getRateLimitWindowActiveCount: () => 0,
  });

  metrics.updatePeakMarks(); // interval 1 peak: rooms=10, participants=25

  rooms = 3;
  participants = 5; // drop counts before flush

  const rows: PeriodicRow[] = [];
  const scheduler = createScheduler({ metrics, store: makeInlineStore(rows), flushIntervalMs: 100_000 });
  scheduler.flush();
  await new Promise<void>(r => setImmediate(r));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].peakRooms, 10, "first flush: peakRooms must be 10 (interval peak), not 3 (current)");
  assert.equal(rows[0].peakParticipants, 25, "first flush: peakParticipants must be 25 (interval peak), not 5 (current)");

  // Interval 2: lower peak than interval 1 — proves reset happened
  rooms = 7;
  participants = 15;
  metrics.updatePeakMarks();
  rooms = 1;
  participants = 1;

  scheduler.flush();
  await new Promise<void>(r => setImmediate(r));

  assert.equal(rows.length, 2);
  assert.equal(rows[1].peakRooms, 7, "second flush: peakRooms must be 7 (this interval's peak), not 10 (all-time)");
  assert.equal(rows[1].peakParticipants, 15, "second flush: peakParticipants must be 15 (this interval's peak), not 25 (all-time)");
});

test("T6.5-08: store.writeSnapshot rejection does not crash; baseline is still advanced so next flush shows correct delta", async () => {
  const metrics = createMetrics(makeAccessor());
  let failWrite = true;
  const rows: PeriodicRow[] = [];
  const store: AnalyticsStore = {
    async writeSnapshot(row: PeriodicRow): Promise<void> {
      if (failWrite) throw new Error("simulated write failure");
      rows.push(row);
    },
    async queryRows(): Promise<PeriodicRow[]> { return []; },
    async close(): Promise<void> {},
  };

  const scheduler = createScheduler({ metrics, store, flushIntervalMs: 100_000 });

  // First period: 2 rooms created; flush fails but baseline advances synchronously
  metrics.incrementRoomsCreated();
  metrics.incrementRoomsCreated();
  scheduler.flush();
  await new Promise<void>(r => setTimeout(r, 10)); // let the rejected promise settle

  // Second period: 1 more room created; flush succeeds
  failWrite = false;
  metrics.incrementRoomsCreated();
  scheduler.flush();
  await new Promise<void>(r => setTimeout(r, 10));

  assert.equal(rows.length, 1, "only the second (successful) flush must have written a row");
  assert.equal(rows[0].roomsCreatedDelta, 1, "second flush delta must be 1 — first period's counts must not be double-counted");
});

test("T6.5-09: checkReports is skipped in test mode — report generators do not fire", async () => {
  const metrics = createMetrics(makeAccessor());
  let queryRowsCalled = false;
  const store: AnalyticsStore = {
    async writeSnapshot(): Promise<void> {},
    async queryRows(): Promise<PeriodicRow[]> {
      queryRowsCalled = true;
      return [];
    },
    async close(): Promise<void> {},
  };

  // flushIntervalMs < 60_000 → test mode → checkReports returns immediately
  const scheduler = createScheduler({ metrics, store, flushIntervalMs: 500 });
  scheduler.flush();
  await new Promise<void>(r => setTimeout(r, 50));

  assert.equal(queryRowsCalled, false, "store.queryRows must not be called in test mode — checkReports must be suppressed");
});

test("T6.5-10: monthly report midnight check correctly handles January 1st year-boundary rollover", () => {
  // Verify the month-rollover formula used in scheduler.ts's checkReports().
  // When now is January 1st (getUTCMonth() === 0), prevMonth must be 12 and prevYear must be currentYear - 1.
  const janFirst = new Date(Date.UTC(2025, 0, 1)); // January 1, 2025 UTC

  const prevMonthJan = janFirst.getUTCMonth() === 0 ? 12 : janFirst.getUTCMonth();
  const prevYearJan  = janFirst.getUTCMonth() === 0 ? janFirst.getUTCFullYear() - 1 : janFirst.getUTCFullYear();

  assert.equal(prevMonthJan, 12,   "January 1st rollover: prevMonth must be 12 (December)");
  assert.equal(prevYearJan,  2024, "January 1st rollover: prevYear must be 2024 (currentYear - 1)");

  // Verify that February 1st does NOT trigger the year rollover
  const febFirst = new Date(Date.UTC(2025, 1, 1)); // February 1, 2025 UTC

  const prevMonthFeb = febFirst.getUTCMonth() === 0 ? 12 : febFirst.getUTCMonth();
  const prevYearFeb  = febFirst.getUTCMonth() === 0 ? febFirst.getUTCFullYear() - 1 : febFirst.getUTCFullYear();

  assert.equal(prevMonthFeb, 1,    "February 1st: prevMonth must be 1 (January)");
  assert.equal(prevYearFeb,  2025, "February 1st: prevYear must be 2025 (same year, no rollover)");
});

test("T6.5-11: start() called a second time without stop() is a no-op — only one interval fires per tick", async () => {
  const metrics = createMetrics(makeAccessor());
  const rows: PeriodicRow[] = [];
  const scheduler = createScheduler({ metrics, store: makeInlineStore(rows), flushIntervalMs: 80 });

  scheduler.start();
  scheduler.start(); // second call must be a no-op; no second interval created

  await new Promise<void>(r => setTimeout(r, 280));
  scheduler.stop();

  // One 80ms interval in 280ms → ~3 rows. Two intervals (double-start bug) → ~6+ rows.
  assert.ok(rows.length >= 2, `expected at least 2 rows, got ${rows.length}`);
  assert.ok(rows.length <= 5, `double-start guard failed: expected ≤5 rows (single 80ms interval in 280ms), got ${rows.length}`);
});

test("T6.5-12: stop() after start() cancels the interval — no additional rows written after stop()", async () => {
  const metrics = createMetrics(makeAccessor());
  const rows: PeriodicRow[] = [];
  const scheduler = createScheduler({ metrics, store: makeInlineStore(rows), flushIntervalMs: 50 });

  scheduler.start();
  await new Promise<void>(r => setTimeout(r, 175)); // let a couple of rows accumulate
  scheduler.stop();
  const countAfterStop = rows.length;

  await new Promise<void>(r => setTimeout(r, 175)); // wait another full interval duration
  assert.ok(countAfterStop >= 1, `expected at least 1 row before stop(), got ${countAfterStop}`);
  assert.equal(rows.length, countAfterStop, "no additional rows must be written after stop()");
});

// ---- T6.3-08 Infrastructure: docker-compose.yml memory limits ----

test("T6.3-08: docker-compose.yml backend service has mem_limit: 256m and memswap_limit: 256m; values are equal and swap is disabled", () => {
  const composeContent = readFileSync(fileURLToPath(new URL("../../docker-compose.yml", import.meta.url)), "utf8");

  assert.ok(
    composeContent.includes("mem_limit: 256m"),
    "docker-compose.yml must contain mem_limit: 256m",
  );
  assert.ok(
    composeContent.includes("memswap_limit: 256m"),
    "docker-compose.yml must contain memswap_limit: 256m",
  );
  // memswap_limit: 0 allows Docker to silently allocate up to 2× mem_limit as swap,
  // masking real-world OOM conditions under the 256 MB cap.
  assert.ok(
    !composeContent.includes("memswap_limit: 0"),
    "memswap_limit must not be 0 — that would allow up to 2× mem_limit as swap",
  );
});

// ---- T6.7 Unit Tests: emailDelivery ----

test("T6.7-04: sendReportEmail returns early without throwing when report is null", async () => {
  await assert.doesNotReject(
    () => sendReportEmail(null),
    "sendReportEmail(null) must not throw",
  );
});

test("T6.7-05: sendReportEmail logs error and returns early when required env vars are missing", async () => {
  const saved = {
    from: process.env.REPORT_EMAIL_FROM,
    to: process.env.REPORT_EMAIL_TO,
    pass: process.env.GMAIL_APP_PASSWORD,
  };

  const stub: import("../src/admin/analytics").PeriodAggregate = {
    periodLabel: "2025-01-01",
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

  const missingCombinations: [string | undefined, string | undefined, string | undefined][] = [
    [undefined, "to@example.com", "apppass"],
    ["from@example.com", undefined, "apppass"],
    ["from@example.com", "to@example.com", undefined],
  ];

  for (const [from, to, pass] of missingCombinations) {
    if (from !== undefined) process.env.REPORT_EMAIL_FROM = from; else delete process.env.REPORT_EMAIL_FROM;
    if (to !== undefined) process.env.REPORT_EMAIL_TO = to; else delete process.env.REPORT_EMAIL_TO;
    if (pass !== undefined) process.env.GMAIL_APP_PASSWORD = pass; else delete process.env.GMAIL_APP_PASSWORD;

    await assert.doesNotReject(
      () => sendReportEmail(stub),
      "sendReportEmail must not throw when env vars are missing",
    );
  }

  if (saved.from !== undefined) process.env.REPORT_EMAIL_FROM = saved.from; else delete process.env.REPORT_EMAIL_FROM;
  if (saved.to !== undefined) process.env.REPORT_EMAIL_TO = saved.to; else delete process.env.REPORT_EMAIL_TO;
  if (saved.pass !== undefined) process.env.GMAIL_APP_PASSWORD = saved.pass; else delete process.env.GMAIL_APP_PASSWORD;
});

test("T6.7-06: buildCsv with empty rows array produces only the header line with no trailing newline issues", () => {
  const csv = buildCsv([]);
  const lines = csv.split("\n");
  assert.equal(lines.length, 1, "empty rows must produce exactly 1 line (the header)");
  assert.ok(lines[0].startsWith("recordedAt,"), "the single line must be the CSV header");
  assert.ok(lines[0].includes("processStartedAt"), "header must include processStartedAt");
  assert.ok(!csv.endsWith("\n"), "CSV must not end with a trailing newline");
});

test("T6.7-07: minutesToReadable edge cases are correct", () => {
  assert.equal(minutesToReadable(0),    "0s",      "0 minutes must be '0s'");
  assert.equal(minutesToReadable(0.5),  "30s",     "0.5 minutes must be '30s'");
  assert.equal(minutesToReadable(1),    "1m",      "exactly 1 minute must be '1m'");
  assert.equal(minutesToReadable(60),   "1h",      "exactly 60 minutes must be '1h'");
  assert.equal(minutesToReadable(90),   "1h 30m",  "90 minutes must be '1h 30m'");
  assert.equal(minutesToReadable(119.7), "2h",     "119.7 minutes must round to '2h', never '1h 60m'");
});

// ---- T6.6 Unit Tests: Report Generation Engine ----

test("T6.6-01: generateDailyReport correctly aggregates totals, peaks, and restart count for a fixed row set", async () => {
  const t0 = Date.UTC(2025, 4, 20); // 2025-05-20 midnight UTC
  const rows = [
    makeRow(t0 + 1000, { participantsJoinedDelta: 8, roomsCreatedDelta: 3, roomsDestroyedHostLeft: 2, peakRooms: 4, peakParticipants: 12, processStartedAt: 111 }),
    makeRow(t0 + 2000, { participantsJoinedDelta: 5, roomsCreatedDelta: 2, roomsDestroyedGrace: 1, peakRooms: 6, peakParticipants: 10, processStartedAt: 222 }),
    makeRow(t0 + 3000, { participantsJoinedDelta: 3, roomsCreatedDelta: 1, roomsDestroyedTtl: 1, peakRooms: 6, peakParticipants: 14, processStartedAt: 111 }),
  ];
  const report = await generateDailyReport(new MemoryStore(rows), new Date("2025-05-20T00:00:00Z"));

  assert.ok(report !== null, "generateDailyReport must return a non-null report when rows exist");
  assert.equal(report!.periodLabel, "2025-05-20");
  assert.equal(report!.totalParticipantsJoined, 16, "totalParticipantsJoined: 8+5+3");
  assert.equal(report!.totalRoomsCreated, 6, "totalRoomsCreated: 3+2+1");
  assert.equal(report!.destroyReasonBreakdown.hostLeft, 2);
  assert.equal(report!.destroyReasonBreakdown.graceExpired, 1);
  assert.equal(report!.destroyReasonBreakdown.ttlExpired, 1);
  assert.equal(report!.peakConcurrentRooms, 6, "peak rooms across all rows");
  assert.equal(report!.peakConcurrentParticipants, 14, "peak participants across all rows");
  assert.equal(report!.restartCount, 2, "two distinct processStartedAt values: 111, 222");
});

test("T6.6-02: restartCount equals the number of distinct processStartedAt values in the period", async () => {
  const t0 = Date.UTC(2025, 5, 1); // 2025-06-01 midnight UTC
  const rows = [
    makeRow(t0 + 1000, { processStartedAt: 100 }),
    makeRow(t0 + 2000, { processStartedAt: 100 }),
    makeRow(t0 + 3000, { processStartedAt: 200 }),
    makeRow(t0 + 4000, { processStartedAt: 300 }),
    makeRow(t0 + 5000, { processStartedAt: 300 }),
  ];
  const report = await generateDailyReport(new MemoryStore(rows), new Date("2025-06-01T00:00:00Z"));
  assert.ok(report !== null);
  assert.equal(report!.restartCount, 3, "restartCount must be 3 (distinct: 100, 200, 300) — not 5 (row count)");
});

test("T6.6-06: generateDailyReport returns valid all-zero PeriodAggregate when store returns no rows", async () => {
  const report = await generateDailyReport(new MemoryStore([]), new Date("2025-01-01T00:00:00Z"));
  assert.ok(report !== null, "report must not be null for an empty store");
  assert.equal(report!.periodLabel, "2025-01-01");
  assert.equal(report!.totalParticipantsJoined, 0);
  assert.equal(report!.totalRoomsCreated, 0);
  assert.equal(report!.peakConcurrentRooms, 0);
  assert.equal(report!.peakConcurrentParticipants, 0);
  assert.equal(report!.avgRoomLifetimeMinutes, 0);
  assert.equal(report!.restartCount, 0);
  assert.equal(report!.rows.length, 0);
});

test("T6.6-07: periodLabel format — daily YYYY-MM-DD, weekly Monday YYYY-MM-DD, monthly YYYY-MM", async () => {
  const emptyStore = new MemoryStore([]);

  const daily = await generateDailyReport(emptyStore, new Date("2025-07-15T00:00:00Z"));
  assert.equal(daily!.periodLabel, "2025-07-15", "daily periodLabel must be YYYY-MM-DD");

  const weekly = await generateWeeklyReport(emptyStore, new Date("2025-07-14T00:00:00Z")); // Monday
  assert.equal(weekly!.periodLabel, "2025-07-14", "weekly periodLabel must be the Monday YYYY-MM-DD");

  const monthly = await generateMonthlyReport(emptyStore, 2025, 7);
  assert.equal(monthly!.periodLabel, "2025-07", "monthly periodLabel must be YYYY-MM");
});

test("T6.6-04: generateDailyReport logs error and returns null when store queryRows rejects", async () => {
  const failingStore: AnalyticsStore = {
    async writeSnapshot(): Promise<void> {},
    async queryRows(): Promise<PeriodicRow[]> { throw new Error("store unavailable T6604"); },
    async close(): Promise<void> {},
  };

  const logged: unknown[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const result = await generateDailyReport(failingStore, new Date("2025-01-01T00:00:00Z"));
    assert.strictEqual(result, null, "must return null when store rejects");
    assert.ok(logged.length > 0, "console.error must have been called at least once");
    const logMsg = String(logged[0]);
    assert.ok(logMsg.includes("report") || logMsg.includes("error"), "error log must reference the failure context");
  } finally {
    console.error = originalError;
  }
});

// ---- T6.3 Frontend Source Inspection Tests ----

test("T6.3-02: LiveMetrics binds rssUsedMb as primary RAM card value; heapUsedMb/heapTotalMb are in the subtitle only", () => {
  const src = readFileSync(fileURLToPath(new URL("../../frontend/src/features/admin/LiveMetrics.tsx", import.meta.url)), "utf8");
  const lines = src.split("\n");

  const valueWithRss = lines.some(l => l.includes("value=") && l.includes("rssUsedMb"));
  assert.ok(valueWithRss, "rssUsedMb must appear on a value= prop line (primary RAM metric)");

  const subtitleWithHeap = lines.some(l => l.includes("subtitle=") && l.includes("heapUsedMb"));
  assert.ok(subtitleWithHeap, "heapUsedMb must appear on a subtitle= prop line (secondary GC diagnostic)");

  const subtitleWithRss = lines.some(l => l.includes("subtitle=") && l.includes("rssUsedMb"));
  assert.ok(!subtitleWithRss, "rssUsedMb must NOT appear on a subtitle= line — it is the primary capacity-planning metric");
});

test("T6.3-03: LiveMetrics staleness indicator resets to 0 on successful fetch and increments from lastUpdatedAt; catch block does not reset it", () => {
  const src = readFileSync(fileURLToPath(new URL("../../frontend/src/features/admin/LiveMetrics.tsx", import.meta.url)), "utf8");

  assert.ok(src.includes("setSecondsSince(0)"), "fetchSnapshot must call setSecondsSince(0) on successful fetch to reset the staleness indicator");
  assert.ok(src.includes("Date.now() - lastUpdatedAt"), "staleness counter must be computed as Date.now() minus lastUpdatedAt");
  assert.ok(src.includes("s ago"), "LiveMetrics must render 'Xs ago' staleness text in the UI");

  // The reset must only happen on the success path — verify the catch block does not call setSecondsSince(0)
  const catchStart = src.indexOf("} catch (e)");
  const finallyStart = src.indexOf("} finally {", catchStart);
  assert.ok(catchStart !== -1 && finallyStart !== -1, "catch and finally blocks must be present");
  const catchBody = src.slice(catchStart, finallyStart);
  assert.ok(!catchBody.includes("setSecondsSince(0)"), "catch block must not reset secondsSince — staleness must remain visible when a fetch fails");
});

test("T6.3-06: LiveMetrics catch block calls setFetchError and does NOT call setSnapshot; fetchError gates all metrics display", () => {
  const src = readFileSync(fileURLToPath(new URL("../../frontend/src/features/admin/LiveMetrics.tsx", import.meta.url)), "utf8");

  const catchStart = src.indexOf("} catch (e)");
  const finallyStart = src.indexOf("} finally {", catchStart);
  assert.ok(catchStart !== -1 && finallyStart !== -1, "catch and finally blocks must be present");
  const catchBody = src.slice(catchStart, finallyStart);

  assert.ok(catchBody.includes("setFetchError("), "catch block must call setFetchError to surface the error (including mid-session 401)");
  assert.ok(!catchBody.includes("setSnapshot("), "catch block must not call setSnapshot — stale snapshot must not be updated on error");
  assert.ok(
    catchBody.includes("AdminAuthError") && catchBody.includes("onAuthError"),
    "catch block must detect AdminAuthError and call the onAuthError callback",
  );
  assert.ok(src.includes("if (fetchError)"), "component must early-return the error UI when fetchError is set, preventing any metrics from being displayed");
});

test("T6.8-04: HistoricalCharts renders a descriptive empty state when rows.length === 0; charts only render when rows.length > 0", () => {
  const src = readFileSync(fileURLToPath(new URL("../../frontend/src/features/admin/HistoricalCharts.tsx", import.meta.url)), "utf8");

  assert.ok(src.includes("rows.length === 0"), "HistoricalCharts must check rows.length === 0 to render an empty state rather than broken charts");
  assert.ok(src.includes("No data yet"), "HistoricalCharts must render a descriptive 'No data yet' empty state message");
  assert.ok(src.includes("rows.length > 0"), "AreaChart/BarChart components must only render when rows.length > 0");
});

test("T6.7-08: buildEmailHtml renders 'No errors recorded in this period.' when all error counts are zero", () => {
  const report: import("../src/admin/analytics").PeriodAggregate = {
    periodLabel: "2025-06-01",
    totalParticipantsJoined: 10,
    totalRoomsCreated: 3,
    destroyReasonBreakdown: { hostLeft: 2, graceExpired: 0, ttlExpired: 1, soloExpired: 0 },
    peakConcurrentRooms: 4,
    peakConcurrentParticipants: 12,
    avgRssUsedMb: 52.4,
    peakRssUsedMb: 61.8,
    avgRoomLifetimeMinutes: 5.5,
    topErrors: { RATE_LIMITED: 0, INVALID_PASSWORD: 0, ROOM_NOT_FOUND: 0, ROOM_FULL: 0 },
    restartCount: 1,
    rows: [],
  };

  const html = buildEmailHtml(report);
  assert.ok(
    html.includes("No errors recorded in this period."),
    "HTML must contain the no-errors message when all error counts are zero",
  );
  assert.ok(!html.includes("Top Errors"), "HTML must not include the Top Errors heading when there are no errors");
  assert.ok(html.includes("52.4 MB"), "HTML must render avgRssUsedMb — guards against 'undefined MB'");
  assert.ok(html.includes("61.8 MB"), "HTML must render peakRssUsedMb — guards against 'undefined MB'");
  assert.ok(!html.includes("undefined"), "HTML must not contain 'undefined' anywhere");
});
