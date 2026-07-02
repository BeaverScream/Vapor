import * as shared from "@shared";
import type { SignalingErrorCode, SocketErrorPayload } from "@shared";

export const CLIENT_EVENTS = {
  createRoom: shared.CLIENT_EVENT_NAMES.CREATE_ROOM,
  joinRoom: shared.CLIENT_EVENT_NAMES.JOIN_ROOM,
  leaveRoom: shared.CLIENT_EVENT_NAMES.LEAVE_ROOM,
  signalOffer: shared.CLIENT_EVENT_NAMES.SIGNAL_OFFER,
  signalAnswer: shared.CLIENT_EVENT_NAMES.SIGNAL_ANSWER,
  signalIce: shared.CLIENT_EVENT_NAMES.SIGNAL_ICE,
  resumeSession: shared.CLIENT_EVENT_NAMES.RESUME_SESSION,
  roomPasswordUpdate: shared.CLIENT_EVENT_NAMES.ROOM_PASSWORD_UPDATE,
  kickParticipant: shared.CLIENT_EVENT_NAMES.KICK_PARTICIPANT
} as const;

export const SERVER_EVENTS = {
  roomCreated: shared.SERVER_EVENT_NAMES.ROOM_CREATED,
  roomJoined: shared.SERVER_EVENT_NAMES.ROOM_JOINED,
  peerJoined: shared.SERVER_EVENT_NAMES.PEER_JOINED,
  peerLeft: shared.SERVER_EVENT_NAMES.PEER_LEFT,
  signalOffer: shared.SERVER_EVENT_NAMES.SIGNAL_OFFER,
  signalAnswer: shared.SERVER_EVENT_NAMES.SIGNAL_ANSWER,
  signalIce: shared.SERVER_EVENT_NAMES.SIGNAL_ICE,
  hostReconnectGrace: shared.SERVER_EVENT_NAMES.HOST_RECONNECT_GRACE,
  roomPasswordUpdated: shared.SERVER_EVENT_NAMES.ROOM_PASSWORD_UPDATED,
  roomDestroyed: shared.SERVER_EVENT_NAMES.ROOM_DESTROYED,
  participantKicked: shared.SERVER_EVENT_NAMES.PARTICIPANT_KICKED,
  error: shared.SERVER_EVENT_NAMES.ERROR
} as const;

export const ERROR_CODES = {
  roomNotFound: shared.SIGNALING_ERROR_CODES.ROOM_NOT_FOUND,
  roomFull: shared.SIGNALING_ERROR_CODES.ROOM_FULL,
  roomExpired: shared.SIGNALING_ERROR_CODES.ROOM_EXPIRED,
  invalidPassword: shared.SIGNALING_ERROR_CODES.INVALID_PASSWORD,
  hostReconnectWindowExpired: shared.SIGNALING_ERROR_CODES.HOST_RECONNECT_WINDOW_EXPIRED,
  reconnectTokenStale: shared.SIGNALING_ERROR_CODES.RECONNECT_TOKEN_STALE,
  passwordVersionMismatch: shared.SIGNALING_ERROR_CODES.PASSWORD_VERSION_MISMATCH,
  rateLimited: shared.SIGNALING_ERROR_CODES.RATE_LIMITED,
  invalidSignalPayload: shared.SIGNALING_ERROR_CODES.INVALID_SIGNAL_PAYLOAD,
  notAuthorized: shared.SIGNALING_ERROR_CODES.NOT_AUTHORIZED
} as const;

export function makeSocketErrorPayload(code: SignalingErrorCode): SocketErrorPayload {
  return shared.createSocketErrorPayload(code);
}

export {
  CLIENT_EVENT_NAMES,
  SERVER_EVENT_NAMES,
  GUEST_DISCONNECT_GRACE_MS,
  HOST_DISCONNECT_GRACE_MS,
  MAX_PARTICIPANTS_PER_ROOM,
  ROOM_MAX_DURATION_MS,
  IDLE_ROOM_TIMEOUT_MS,
  SWEEPER_INTERVAL_HOURS,
  JOIN_RATE_LIMIT_WINDOW_MS,
  JOIN_RATE_LIMIT_MAX,
  CREATE_RATE_LIMIT_WINDOW_MS,
  SIGNALING_ERROR_CODES
} from "@shared";

export type {
  CreateRoomPayload,
  HostReconnectGracePayload,
  JoinRoomPayload,
  PeerJoinedPayload,
  PeerLeftPayload,
  ResumeSessionPayload,
  SignalingErrorCode,
  SignalAnswerPayload,
  SignalAnswerRelayPayload,
  SignalIcePayload,
  SignalIceRelayPayload,
  SignalOfferPayload,
  SignalOfferRelayPayload,
  RoomCreatedPayload,
  RoomDestroyedPayload,
  RoomJoinedPayload,
  RoomPasswordUpdatePayload,
  RoomPasswordUpdatedPayload,
  KickParticipantPayload,
  ParticipantKickedPayload,
  SocketErrorPayload
} from "@shared";