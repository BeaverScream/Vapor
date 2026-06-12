import {
  queryDailyAggregate,
  queryWeeklyAggregate,
  queryMonthlyAggregate,
  type AnalyticsStore,
  type PeriodAggregate,
} from "./analytics.js";

export type { PeriodAggregate };

export async function generateDailyReport(
  store: AnalyticsStore,
  date: Date,
): Promise<PeriodAggregate | null> {
  try {
    const label = date.toISOString().slice(0, 10);
    return await queryDailyAggregate(store, label);
  } catch (err) {
    console.error("[reports] daily report error:", err);
    return null;
  }
}

export async function generateWeeklyReport(
  store: AnalyticsStore,
  weekStart: Date,
): Promise<PeriodAggregate | null> {
  try {
    const label = weekStart.toISOString().slice(0, 10);
    return await queryWeeklyAggregate(store, label);
  } catch (err) {
    console.error("[reports] weekly report error:", err);
    return null;
  }
}

export async function generateMonthlyReport(
  store: AnalyticsStore,
  year: number,
  month: number,
): Promise<PeriodAggregate | null> {
  try {
    return await queryMonthlyAggregate(store, year, month);
  } catch (err) {
    console.error("[reports] monthly report error:", err);
    return null;
  }
}
