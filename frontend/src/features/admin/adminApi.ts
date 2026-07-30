import { SIGNALING_URL } from '../room/constants'

type DestroyReason = 'host_left' | 'host_grace_expired' | 'room_ttl_expired' | 'solo_timeout_expired'
export const METRICS_ERROR_CODES = [
  'RATE_LIMITED',
  'INVALID_PASSWORD',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'NOT_AUTHORIZED',
  'RECONNECT_TOKEN_STALE',
  'HOST_RECONNECT_WINDOW_EXPIRED',
] as const

type MetricsErrorCode = (typeof METRICS_ERROR_CODES)[number]

// Mirrors backend/src/admin/metrics.ts MetricsSnapshot — keep in sync.
export interface MetricsSnapshot {
  activeRooms: number
  activeParticipants: number
  activeSockets: number
  avgParticipantsPerRoom: number
  participantsJoinedTotal: number
  roomsCreatedTotal: number
  roomsDestroyedByReason: Record<DestroyReason, number>
  errorCounts: Record<MetricsErrorCode, number>
  avgRoomLifetimeMinutes: number
  peakConcurrentRooms: number
  peakConcurrentParticipants: number
  temporaryBlocklistSize: number
  rateLimitWindowActiveCount: number
  uptimeSeconds: number
  rssUsedMb: number
  heapUsedMb: number
  heapTotalMb: number
  processStartedAt: number
}

// Mirrors backend/src/admin/analytics.ts PeriodicRow — keep in sync.
export interface HourlyRow {
  recordedAt: number
  activeRooms: number
  activeParticipants: number
  activeSockets: number
  avgParticipantsPerRoom: number
  participantsJoinedDelta: number
  roomsCreatedDelta: number
  roomsDestroyedHostLeft: number
  roomsDestroyedGrace: number
  roomsDestroyedTtl: number
  roomsDestroyedSolo: number
  avgRoomLifetimeMinutes: number
  errRateLimited: number
  errInvalidPassword: number
  errRoomNotFound: number
  errRoomFull: number
  peakRooms: number
  peakParticipants: number
  blocklistSize: number
  rssUsedMb: number
  heapUsedMb: number
  heapTotalMb: number
  uptimeSeconds: number
  processStartedAt: number
}

export type HistoryRange = '24h' | '7d' | '30d'
export type ReportType = 'daily' | 'weekly' | 'monthly'

export class AdminAuthError extends Error {
  constructor() {
    super('Unauthorized: invalid or missing admin token')
    this.name = 'AdminAuthError'
  }
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` }
}

export async function fetchMetrics(token: string): Promise<MetricsSnapshot> {
  const res = await fetch(`${SIGNALING_URL}/admin/metrics`, {
    headers: authHeaders(token),
  })
  if (res.status === 401) throw new AdminAuthError()
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<MetricsSnapshot>
}

export async function fetchHistory(token: string, range: HistoryRange): Promise<HourlyRow[]> {
  const res = await fetch(`${SIGNALING_URL}/admin/history?range=${range}`, {
    headers: authHeaders(token),
  })
  if (res.status === 401) throw new AdminAuthError()
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<HourlyRow[]>
}

export async function triggerReport(token: string, type: ReportType): Promise<void> {
  const res = await fetch(`${SIGNALING_URL}/admin/report/${type}`, {
    method: 'POST',
    headers: authHeaders(token),
  })
  if (res.status === 401) throw new AdminAuthError()
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}
