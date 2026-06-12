import nodemailer from "nodemailer";
import { CSV_COLUMNS } from "./analytics.js";
import type { PeriodAggregate, PeriodicRow } from "./analytics.js";

export function minutesToReadable(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes < 60) return `${minutes}m`;
  // Round to whole minutes before splitting so 119.7 → "2h", never "1h 60m".
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}


export function buildCsv(rows: PeriodicRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines = rows.map((row) =>
    CSV_COLUMNS.map((col) => String(row[col] ?? "")).join(","),
  );
  return [header, ...lines].join("\n");
}

export function buildEmailHtml(report: PeriodAggregate): string {
  const { destroyReasonBreakdown: dr, topErrors } = report;

  const errorRows = (Object.entries(topErrors) as [string, number][])
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);

  const errorsSection = errorRows.length > 0
    ? `<h3 style="margin-top:24px;">Top Errors</h3>
       <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:monospace;">
         <thead><tr><th>Error Code</th><th>Count</th></tr></thead>
         <tbody>${errorRows.map(([code, count]) => `<tr><td>${code}</td><td>${count}</td></tr>`).join("")}</tbody>
       </table>`
    : `<p style="margin-top:16px;">No errors recorded in this period.</p>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:16px;">
  <h2 style="border-bottom:2px solid #4f46e5;padding-bottom:8px;">[Vapor] Report — ${report.periodLabel}</h2>

  <h3>Metrics Summary</h3>
  <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:monospace;">
    <tbody>
      <tr><td>Participants Joined</td><td>${report.totalParticipantsJoined}</td></tr>
      <tr><td>Rooms Created</td><td>${report.totalRoomsCreated}</td></tr>
      <tr><td>Peak Concurrent Rooms</td><td>${report.peakConcurrentRooms}</td></tr>
      <tr><td>Peak Concurrent Participants</td><td>${report.peakConcurrentParticipants}</td></tr>
      <tr><td>Avg RSS Used</td><td>${report.avgRssUsedMb} MB</td></tr>
      <tr><td>Peak RSS Used</td><td>${report.peakRssUsedMb} MB</td></tr>
      <tr><td>Avg Room Lifetime</td><td>${minutesToReadable(report.avgRoomLifetimeMinutes)}</td></tr>
      <tr><td>Restart Count</td><td>${report.restartCount}</td></tr>
    </tbody>
  </table>

  <h3 style="margin-top:24px;">Room Destruction Breakdown</h3>
  <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:monospace;">
    <thead><tr><th>Reason</th><th>Count</th></tr></thead>
    <tbody>
      <tr><td>Host Left</td><td>${dr.hostLeft}</td></tr>
      <tr><td>Host Grace Expired</td><td>${dr.graceExpired}</td></tr>
      <tr><td>Room TTL Expired</td><td>${dr.ttlExpired}</td></tr>
      <tr><td>Solo Timeout Expired</td><td>${dr.soloExpired}</td></tr>
    </tbody>
  </table>

  ${errorsSection}

  <p style="margin-top:24px;font-size:12px;color:#666;">
    Raw periodic data is attached as a CSV file.<br>
    This report was generated automatically by the Vapor metrics scheduler.
  </p>
</body></html>`;
}

export async function sendReportEmail(report: PeriodAggregate | null): Promise<void> {
  if (!report) return;

  const from = process.env.REPORT_EMAIL_FROM;
  const to = process.env.REPORT_EMAIL_TO;
  const appPassword = process.env.GMAIL_APP_PASSWORD;

  if (!from || !to || !appPassword) {
    console.error("[emailDelivery] Missing env vars: REPORT_EMAIL_FROM, REPORT_EMAIL_TO, GMAIL_APP_PWD");
    return;
  }

  const subject = `[Vapor] Report — ${report.periodLabel}`;
  const csvFilename = `vapor-${report.periodLabel.replace(/[^a-zA-Z0-9-]/g, "_")}.csv`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: from, pass: appPassword },
  });

  await transporter.sendMail({
    from,
    to,
    subject,
    html: buildEmailHtml(report),
    attachments: [
      { filename: csvFilename, content: buildCsv(report.rows), contentType: "text/csv" },
    ],
  });
}
