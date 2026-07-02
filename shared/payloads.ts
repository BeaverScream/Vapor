import type { RoomDestroyedReason } from "./reasons";
import { SIGNALING_ERROR_CODES, type SignalingErrorCode } from "./error-codes";

export type CreateRoomPayload = {
  password?: string;
  nickname: string;
  roomName?: string;
};

export type JoinRoomPayload = {
  roomId?: string;
  password?: string;
  nickname: string;
};

export type ResumeSessionPayload = {
  roomId?: string;
  reconnectToken?: string;
};

export type RoomPasswordUpdatePayload = {
  roomId?: string;
  newPassword?: string;
};

export type SignalOfferPayload = {
  roomId?: string;
  toParticipantId?: string;
  sdp?: string;
};

export type SignalAnswerPayload = {
  roomId?: string;
  toParticipantId?: string;
  sdp?: string;
};

export type SignalIcePayload = {
  roomId?: string;
  toParticipantId?: string;
  candidate?: string | Record<string, unknown>;
};

export type SocketErrorPayload = {
  code: SignalingErrorCode;
  message: string;
};

export const SIGNALING_ERROR_MESSAGES: Record<SignalingErrorCode, string> = {
  [SIGNALING_ERROR_CODES.ROOM_NOT_FOUND]: "Room not found",
  [SIGNALING_ERROR_CODES.ROOM_FULL]: "Room is full",
  [SIGNALING_ERROR_CODES.ROOM_EXPIRED]: "Room expired",
  [SIGNALING_ERROR_CODES.INVALID_PASSWORD]: "Invalid password",
  [SIGNALING_ERROR_CODES.HOST_RECONNECT_WINDOW_EXPIRED]: "Host reconnect window expired",
  [SIGNALING_ERROR_CODES.RECONNECT_TOKEN_STALE]: "Reconnect token stale",
  [SIGNALING_ERROR_CODES.PASSWORD_VERSION_MISMATCH]: "Password version mismatch",
  [SIGNALING_ERROR_CODES.RATE_LIMITED]: "Rate limited",
  [SIGNALING_ERROR_CODES.INVALID_SIGNAL_PAYLOAD]: "Invalid signaling payload",
  [SIGNALING_ERROR_CODES.NOT_AUTHORIZED]: "Not authorized"
};

export function createSocketErrorPayload(code: SignalingErrorCode): SocketErrorPayload {
  return {
    code,
    message: SIGNALING_ERROR_MESSAGES[code]
  };
}

export type RoomCreatedPayload = {
  roomId: string;
  participantId: string;
  hostId: string;
  reconnectToken: string | null;
  participantNickname?: string | null;
  expiresAt: number;
  soloDeadlineAt?: number | null;
  participantCount: number;
  hasPassword?: boolean;
  roomName?: string;
};

export type RoomJoinedPayload = {
  roomId: string;
  participantId: string;
  hostId: string;
  peers: Array<{ participantId: string; nickname?: string | null }>;
  reconnectToken: string | null;
  expiresAt: number;
  soloDeadlineAt?: number | null;
  participantNickname?: string | null;
  participantCount: number;
  hasPassword?: boolean;
  roomName?: string;
};

export type PeerJoinedPayload = {
  participantId: string;
  nickname?: string | null;
  participantCount: number;
};

export type PeerLeftPayload = {
  participantId: string;
  reason: "disconnect" | "leave" | "kick";
  participantCount: number;
  soloDeadlineAt?: number | null;
};

export type HostReconnectGracePayload = {
  deadlineAt: number;
};

export type RoomPasswordUpdatedPayload = {
  passwordVersion: number;
  changedAt: number;
};

export type RoomDestroyedPayload = {
  reason: RoomDestroyedReason;
};

export type SignalOfferRelayPayload = {
  roomId: string;
  fromParticipantId: string;
  sdp: string;
};

export type SignalAnswerRelayPayload = {
  roomId: string;
  fromParticipantId: string;
  sdp: string;
};

export type SignalIceRelayPayload = {
  roomId: string;
  fromParticipantId: string;
  candidate: string | Record<string, unknown>;
};

export type KickParticipantPayload = {
  roomId: string;
  targetParticipantId: string;
};

export type ParticipantKickedPayload = {
  participantId: string;
};