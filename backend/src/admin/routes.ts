import { Router } from "express";
import { requireAdminAuth } from "./auth";
import type { Metrics } from "./metrics";
import type { AnalyticsStore } from "./analytics";
import { generateDailyReport, generateWeeklyReport, generateMonthlyReport } from "./reports.js";
import { sendReportEmail } from "./emailDelivery.js";

type Req = { query: Record<string, string>; params: Record<string, string> };
type Res = {
  json: (body: unknown) => void;
  status: (code: number) => Res;
  end: () => void;
};

const RANGE_MS: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function createAdminMetricsRouter(metrics: Metrics, store: AnalyticsStore) {
  const router = Router();
  router.use(requireAdminAuth);

  router.get("/metrics", (_req: unknown, res: { json: (body: unknown) => void }) => {
    res.json(metrics.collectMetricsSnapshot());
  });

  router.get("/history", async (req: Req, res: Res) => {
    const range = req.query["range"];
    const rangeMs = RANGE_MS[range];
    if (!rangeMs) {
      res.status(400).json({ error: "Invalid range. Use 24h, 7d, or 30d." });
      return;
    }
    const to = Date.now();
    const from = to - rangeMs;
    try {
      const rows = await store.queryRows(from, to);
      rows.sort((a, b) => a.recordedAt - b.recordedAt);
      res.json(rows);
    } catch (err) {
      console.error("[admin] history query error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/report/:type", async (req: Req, res: Res) => {
    const type = req.params["type"];
    const now = new Date();
    try {
      let report = null;
      if (type === "daily") {
        const yesterday = new Date(now);
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        yesterday.setUTCHours(0, 0, 0, 0);
        report = await generateDailyReport(store, yesterday);
      } else if (type === "weekly") {
        // Monday of the previous full Mon–Sun week, matching the scheduler's anchor
        // (queryWeeklyAggregate expects weekStart to be a Monday).
        const lastMonday = new Date(now);
        lastMonday.setUTCHours(0, 0, 0, 0);
        const daysSinceMonday = (lastMonday.getUTCDay() + 6) % 7;
        lastMonday.setUTCDate(lastMonday.getUTCDate() - daysSinceMonday - 7);
        report = await generateWeeklyReport(store, lastMonday);
      } else if (type === "monthly") {
        const prevMonth = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
        const prevYear = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
        report = await generateMonthlyReport(store, prevYear, prevMonth);
      } else {
        res.status(400).json({ error: "Invalid report type. Use daily, weekly, or monthly." });
        return;
      }
      if (report) {
        await sendReportEmail(report);
      }
      res.status(204).end();
    } catch (err) {
      console.error(`[admin] report trigger error (${type}):`, err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
