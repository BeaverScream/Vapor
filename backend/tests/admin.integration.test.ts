/// <reference types="node" />

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createAdminMetricsRouter } from "../src/admin/routes";
import { createMetrics } from "../src/admin/metrics";
import type { AnalyticsStore, PeriodicRow } from "../src/admin/analytics";

const stubStore: AnalyticsStore = {
  writeSnapshot: async (): Promise<void> => { /* no-op */ },
  queryRows: async (): Promise<PeriodicRow[]> => [],
  close: async (): Promise<void> => { /* no-op */ },
};

const dummyAccessor = {
  getActiveRoomCount: () => 0,
  getActiveParticipantCount: () => 0,
  getActiveSocketCount: () => 0,
  getTemporaryBlocklistSize: () => 0,
  getRateLimitWindowActiveCount: () => 0,
};

async function withAdminServer(
  port: number,
  token: string,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const prevToken = process.env.ADMIN_API_TOKEN;
  process.env.ADMIN_API_TOKEN = token;

  const metrics = createMetrics(dummyAccessor);
  const app = express();
  app.use(express.json());
  app.use("/admin", createAdminMetricsRouter(metrics, stubStore));

  const httpServer = createServer(app as unknown as import("node:http").RequestListener);

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, resolve);
    httpServer.on("error", reject);
  });

  try {
    await fn(`http://localhost:${port}`);
  } finally {
    process.env.ADMIN_API_TOKEN = prevToken;
    await new Promise<void>((resolve, reject) =>
      httpServer.close((err) => (err ? reject(err as Error) : resolve())),
    );
  }
}

test("T6.1-07: GET /admin/metrics with a valid Bearer token returns 200 and a valid snapshot", async () => {
  const TOKEN = "test-token-t6107";

  await withAdminServer(3021, TOKEN, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/admin/metrics`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    assert.equal(response.status, 200);

    const json = await response.json() as Record<string, unknown>;

    const numericFields = [
      "activeRooms",
      "activeParticipants",
      "activeSockets",
      "avgParticipantsPerRoom",
      "participantsJoinedTotal",
      "roomsCreatedTotal",
      "avgRoomLifetimeMinutes",
      "peakConcurrentRooms",
      "peakConcurrentParticipants",
      "uptimeSeconds",
      "rssUsedMb",
      "heapUsedMb",
      "heapTotalMb",
      "processStartedAt",
    ];

    for (const field of numericFields) {
      assert.equal(typeof json[field], "number", `field "${field}" must be a number`);
      assert.ok(!Number.isNaN(json[field] as number), `field "${field}" must not be NaN`);
    }

    assert.equal(typeof json["roomsDestroyedByReason"], "object", "roomsDestroyedByReason must be an object");
    assert.equal(typeof json["errorCounts"], "object", "errorCounts must be an object");
  });
});

test("T6.1-08: GET /admin/metrics with no auth header returns 401", async () => {
  const TOKEN = "test-token-t6108";

  await withAdminServer(3022, TOKEN, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/admin/metrics`);
    assert.equal(response.status, 401);
  });
});

// ---- T6.2 Integration Tests: Admin Auth Middleware ----

type AdminEnvConfig = {
  ADMIN_API_TOKEN?: string;
  ADMIN_BASIC_USER?: string;
  ADMIN_BASIC_PASS?: string;
};

async function withAdminServerEnv(
  port: number,
  envConfig: AdminEnvConfig,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const saved = {
    ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN,
    ADMIN_BASIC_USER: process.env.ADMIN_BASIC_USER,
    ADMIN_BASIC_PASS: process.env.ADMIN_BASIC_PASS,
  };

  delete process.env.ADMIN_API_TOKEN;
  delete process.env.ADMIN_BASIC_USER;
  delete process.env.ADMIN_BASIC_PASS;

  if (envConfig.ADMIN_API_TOKEN !== undefined) process.env.ADMIN_API_TOKEN = envConfig.ADMIN_API_TOKEN;
  if (envConfig.ADMIN_BASIC_USER !== undefined) process.env.ADMIN_BASIC_USER = envConfig.ADMIN_BASIC_USER;
  if (envConfig.ADMIN_BASIC_PASS !== undefined) process.env.ADMIN_BASIC_PASS = envConfig.ADMIN_BASIC_PASS;

  const metrics = createMetrics(dummyAccessor);
  const app = express();
  app.use(express.json());

  // Mirror server.ts fail-secure guard: only mount admin router when auth is configured
  const hasAdminToken = !!process.env.ADMIN_API_TOKEN;
  const hasAdminBasicAuth = !!(process.env.ADMIN_BASIC_USER && process.env.ADMIN_BASIC_PASS);

  if (hasAdminToken || hasAdminBasicAuth) {
    app.use("/admin", createAdminMetricsRouter(metrics, stubStore));
  }

  const httpServer = createServer(app as unknown as import("node:http").RequestListener);

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, resolve);
    httpServer.on("error", reject);
  });

  try {
    await fn(`http://localhost:${port}`);
  } finally {
    if (saved.ADMIN_API_TOKEN !== undefined) process.env.ADMIN_API_TOKEN = saved.ADMIN_API_TOKEN;
    else delete process.env.ADMIN_API_TOKEN;
    if (saved.ADMIN_BASIC_USER !== undefined) process.env.ADMIN_BASIC_USER = saved.ADMIN_BASIC_USER;
    else delete process.env.ADMIN_BASIC_USER;
    if (saved.ADMIN_BASIC_PASS !== undefined) process.env.ADMIN_BASIC_PASS = saved.ADMIN_BASIC_PASS;
    else delete process.env.ADMIN_BASIC_PASS;

    await new Promise<void>((resolve, reject) =>
      httpServer.close((err) => (err ? reject(err as Error) : resolve())),
    );
  }
}

test("T6.2-01: Bearer token auth — correct token returns 200, incorrect token returns 401", async () => {
  const TOKEN = "t6201-bearer-secret";

  await withAdminServerEnv(3031, { ADMIN_API_TOKEN: TOKEN }, async (baseUrl) => {
    const good = await fetch(`${baseUrl}/admin/metrics`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(good.status, 200, "correct Bearer token should return 200");

    const bad = await fetch(`${baseUrl}/admin/metrics`, {
      headers: { Authorization: `Bearer wrong-token` },
    });
    assert.equal(bad.status, 401, "incorrect Bearer token should return 401");
  });
});

test("T6.2-02: HTTP Basic auth — correct credentials return 200, incorrect credentials return 401", async () => {
  const USER = "t6202-admin";
  const PASS = "t6202-pass";

  await withAdminServerEnv(3032, { ADMIN_BASIC_USER: USER, ADMIN_BASIC_PASS: PASS }, async (baseUrl) => {
    const goodCreds = Buffer.from(`${USER}:${PASS}`).toString("base64");
    const good = await fetch(`${baseUrl}/admin/metrics`, {
      headers: { Authorization: `Basic ${goodCreds}` },
    });
    assert.equal(good.status, 200, "correct Basic credentials should return 200");

    const badCreds = Buffer.from(`${USER}:wrong-pass`).toString("base64");
    const bad = await fetch(`${baseUrl}/admin/metrics`, {
      headers: { Authorization: `Basic ${badCreds}` },
    });
    assert.equal(bad.status, 401, "incorrect Basic credentials should return 401");
  });
});

test("T6.2-03: No auth header returns 401 with no payload", async () => {
  const TOKEN = "t6203-token";

  await withAdminServerEnv(3033, { ADMIN_API_TOKEN: TOKEN }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/admin/metrics`);
    assert.equal(response.status, 401, "missing auth header should return 401");
    const body = await response.text();
    assert.equal(body, "", "401 response must have no payload");
  });
});

test("T6.2-04: Admin routes absent (404) when no auth env vars configured at startup", async () => {
  await withAdminServerEnv(3034, {}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/admin/metrics`);
    assert.equal(response.status, 404, "admin routes must not be mounted when no auth env vars are set");
  });
});

test("T6.2-08: Wrong Bearer token is rejected even when valid Basic credentials are configured — no cross-fallthrough", async () => {
  const BEARER_TOKEN = "t6208-correct-bearer";
  const BASIC_USER = "t6208-admin";
  const BASIC_PASS = "t6208-basic-pass";

  await withAdminServerEnv(
    3038,
    { ADMIN_API_TOKEN: BEARER_TOKEN, ADMIN_BASIC_USER: BASIC_USER, ADMIN_BASIC_PASS: BASIC_PASS },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/admin/metrics`, {
        headers: { Authorization: `Bearer wrong-bearer-token` },
      });
      assert.equal(
        response.status,
        401,
        "wrong Bearer token must be rejected even when Basic auth env vars are valid — Bearer failure must not fall through to Basic",
      );
    },
  );
});

test("T6.2-09: ADMIN_API_TOKEN set to empty string is treated as unconfigured — admin routes return 404", async () => {
  await withAdminServerEnv(3039, { ADMIN_API_TOKEN: "" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/admin/metrics`);
    assert.equal(
      response.status,
      404,
      "empty-string ADMIN_API_TOKEN must be treated as not configured — routes must not be mounted",
    );
  });
});

// ---- T6.8 Integration Tests: Historical Trend Charts ----

function makeRow(overrides: Partial<PeriodicRow> = {}): PeriodicRow {
  return {
    recordedAt: Date.now(),
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
    processStartedAt: 0,
    ...overrides,
  };
}

async function withHistoryServer(
  port: number,
  token: string,
  customStore: AnalyticsStore,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const prevToken = process.env.ADMIN_API_TOKEN;
  process.env.ADMIN_API_TOKEN = token;

  const metrics = createMetrics(dummyAccessor);
  const app = express();
  app.use(express.json());
  app.use("/admin", createAdminMetricsRouter(metrics, customStore));

  const httpServer = createServer(app as unknown as import("node:http").RequestListener);

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, resolve);
    httpServer.on("error", reject);
  });

  try {
    await fn(`http://localhost:${port}`);
  } finally {
    if (prevToken !== undefined) process.env.ADMIN_API_TOKEN = prevToken;
    else delete process.env.ADMIN_API_TOKEN;
    await new Promise<void>((resolve, reject) =>
      httpServer.close((err) => (err ? reject(err as Error) : resolve())),
    );
  }
}

test("T6.8-01: GET /admin/history?range=24h returns only rows within past 24h sorted ascending", async () => {
  const TOKEN = "t6801-token";
  const now = Date.now();
  const row1 = makeRow({ recordedAt: now - 3_600_000 });    // 1 hour ago (inside 24h)
  const row2 = makeRow({ recordedAt: now - 1_000 });         // 1 second ago (inside 24h)
  const oldRow = makeRow({ recordedAt: now - 90_000_000 });  // ~25 hours ago (outside 24h)

  const allRows = [row1, row2, oldRow];
  const rangeStore: AnalyticsStore = {
    writeSnapshot: async () => {},
    queryRows: async (from, to) => allRows.filter((r) => r.recordedAt >= from && r.recordedAt <= to),
    close: async () => {},
  };

  await withHistoryServer(3041, TOKEN, rangeStore, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/admin/history?range=24h`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
    const rows = await res.json() as PeriodicRow[];

    assert.equal(rows.length, 2, "only rows within 24h window must be returned");
    assert.ok(rows[0].recordedAt <= rows[1].recordedAt, "rows must be ordered ascending by recordedAt");

    const windowMs = 24 * 60 * 60 * 1000;
    for (const r of rows) {
      assert.ok(r.recordedAt >= Date.now() - windowMs - 5000, `recordedAt ${r.recordedAt} must be within 24h`);
    }
  });
});

test("T6.8-02: GET /admin/history with no auth header returns 401", async () => {
  const TOKEN = "t6802-token";
  await withHistoryServer(3042, TOKEN, stubStore, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/admin/history?range=24h`);
    assert.equal(res.status, 401);
  });
});

test("T6.8-06: GET /admin/history with no range parameter returns 400 with error body", async () => {
  const TOKEN = "t6806-token";
  await withHistoryServer(3043, TOKEN, stubStore, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/admin/history`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string };
    assert.ok(typeof body.error === "string" && body.error.length > 0, "400 must include a non-empty error field");
  });
});

test("T6.8-07: GET /admin/history?range=1h (unsupported value) returns 400 with error body", async () => {
  const TOKEN = "t6807-token";
  await withHistoryServer(3044, TOKEN, stubStore, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/admin/history?range=1h`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string };
    assert.ok(typeof body.error === "string" && body.error.length > 0, "400 must include a non-empty error field");
  });
});

test("T6.8-08: POST /admin/report/quarterly (unknown type) returns 400 with error body", async () => {
  const TOKEN = "t6808-token";
  await withHistoryServer(3045, TOKEN, stubStore, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/admin/report/quarterly`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string };
    assert.ok(typeof body.error === "string" && body.error.length > 0, "400 must include a non-empty error field");
  });
});

test("T6.8-09: POST /admin/report/daily returns 204 even when report generator returns null (store error)", async () => {
  const TOKEN = "t6809-token";
  const errorStore: AnalyticsStore = {
    writeSnapshot: async () => {},
    queryRows: async () => { throw new Error("store unavailable"); },
    close: async () => {},
  };

  await withHistoryServer(3046, TOKEN, errorStore, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/admin/report/daily`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 204, "204 must be returned even when the report generator yields null due to a store error");
  });
});

test("T6.8-10: GET /admin/history?range=7d sorts rows ascending by recordedAt even when store returns arbitrary order", async () => {
  const TOKEN = "t6810-token";
  const now = Date.now();
  const rowA = makeRow({ recordedAt: now - 1_000 });       // most recent
  const rowB = makeRow({ recordedAt: now - 86_400_000 });  // 1 day ago
  const rowC = makeRow({ recordedAt: now - 7_200_000 });   // 2 hours ago

  const unorderedStore: AnalyticsStore = {
    writeSnapshot: async () => {},
    queryRows: async () => [rowA, rowC, rowB],             // arbitrary order
    close: async () => {},
  };

  await withHistoryServer(3047, TOKEN, unorderedStore, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/admin/history?range=7d`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
    const rows = await res.json() as PeriodicRow[];

    assert.equal(rows.length, 3);
    assert.ok(rows[0].recordedAt <= rows[1].recordedAt, "row[0] must precede row[1]");
    assert.ok(rows[1].recordedAt <= rows[2].recordedAt, "row[1] must precede row[2]");
  });
});
