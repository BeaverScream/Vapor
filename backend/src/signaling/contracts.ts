import {
  CLIENT_EVENT_NAMES,
  GUEST_DISCONNECT_GRACE_MS,
  HOST_DISCONNECT_GRACE_MS,
  JOIN_INVALID_ATTEMPT_COOLDOWN_MAX,
  JOIN_INVALID_ATTEMPT_COOLDOWN_MS,
  JOIN_INVALID_ATTEMPT_NO_COOLDOWN_MAX,
  ROOM_MAX_DURATION_MS,
  SOLO_HOST_ROOM_TIMEOUT_MS,
  SERVER_EVENT_NAMES,
  SIGNALING_ERROR_CODES,
  type CreateRoomPayload,
  type HostReconnectGracePayload,
  type JoinRoomPayload,
  type PeerJoinedPayload,
  type PeerLeftPayload,
  type ResumeSessionPayload,
  type RoomCreatedPayload,
  type RoomDestroyedPayload,
  type RoomJoinedPayload,
  type RoomPasswordUpdatePayload,
  type RoomPasswordUpdatedPayload,
  type SocketErrorPayload
} from "@shared";

export const CLIENT_EVENTS = {
  createRoom: CLIENT_EVENT_NAMES.CREATE_ROOM,
  joinRoom: CLIENT_EVENT_NAMES.JOIN_ROOM,
  leaveRoom: CLIENT_EVENT_NAMES.LEAVE_ROOM,
  resumeSession: CLIENT_EVENT_NAMES.RESUME_SESSION,
  roomPasswordUpdate: CLIENT_EVENT_NAMES.ROOM_PASSWORD_UPDATE
} as const;

export const SERVER_EVENTS = {
  roomCreated: SERVER_EVENT_NAMES.ROOM_CREATED,
  roomJoined: SERVER_EVENT_NAMES.ROOM_JOINED,
  peerJoined: SERVER_EVENT_NAMES.PEER_JOINED,
  peerLeft: SERVER_EVENT_NAMES.PEER_LEFT,
  hostReconnectGrace: SERVER_EVENT_NAMES.HOST_RECONNECT_GRACE,
  roomPasswordUpdated: SERVER_EVENT_NAMES.ROOM_PASSWORD_UPDATED,
  roomDestroyed: SERVER_EVENT_NAMES.ROOM_DESTROYED,
  error: SERVER_EVENT_NAMES.ERROR
} as const;

export const ERROR_CODES = {
  roomNotFound: SIGNALING_ERROR_CODES.ROOM_NOT_FOUND,
  invalidPassword: SIGNALING_ERROR_CODES.INVALID_PASSWORD,
  rateLimited: SIGNALING_ERROR_CODES.RATE_LIMITED
} as const;

export {
  CLIENT_EVENT_NAMES,
  GUEST_DISCONNECT_GRACE_MS,
  HOST_DISCONNECT_GRACE_MS,
  JOIN_INVALID_ATTEMPT_COOLDOWN_MAX,
  JOIN_INVALID_ATTEMPT_COOLDOWN_MS,
  JOIN_INVALID_ATTEMPT_NO_COOLDOWN_MAX,
  ROOM_MAX_DURATION_MS,
  SOLO_HOST_ROOM_TIMEOUT_MS,
  SERVER_EVENT_NAMES,
  SIGNALING_ERROR_CODES
};

export type {
  CreateRoomPayload,
  HostReconnectGracePayload,
  JoinRoomPayload,
  PeerJoinedPayload,
  PeerLeftPayload,
  ResumeSessionPayload,
  RoomCreatedPayload,
  RoomDestroyedPayload,
  RoomJoinedPayload,
  RoomPasswordUpdatePayload,
  RoomPasswordUpdatedPayload,
  SocketErrorPayload
};