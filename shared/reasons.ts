export const ROOM_DESTROYED_REASONS = {
  HOST_LEFT: "host_left",
  HOST_GRACE_EXPIRED: "host_grace_expired",
  ROOM_TTL_EXPIRED: "room_ttl_expired",
  SOLO_TIMEOUT_EXPIRED: "solo_timeout_expired"
} as const;

export type RoomDestroyedReason =
  (typeof ROOM_DESTROYED_REASONS)[keyof typeof ROOM_DESTROYED_REASONS];