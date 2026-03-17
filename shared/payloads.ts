import type { RoomDestroyedReason } from "./reasons";
import type { SignalingErrorCode } from "./error-codes";

export type CreateRoomPayload = {
  password?: string;
};

export type JoinRoomPayload = {
  roomId?: string;
  password?: string;
};

export type ResumeSessionPayload = {
  roomId?: string;
  reconnectToken?: string;
};

export type RoomPasswordUpdatePayload = {
  roomId?: string;
  newPassword?: string;
};

export type SocketErrorPayload = {
  code: SignalingErrorCode | string;
  message: string;
};

export type RoomCreatedPayload = {
  roomId: string;
  participantId: string;
  hostId: string;
  reconnectToken: string | null;
  expiresAt: number;
  participantCount: number;
};

export type RoomJoinedPayload = {
  roomId: string;
  participantId: string;
  hostId: string;
  peers: Array<{ participantId: string }>;
  reconnectToken: string | null;
  expiresAt: number;
  participantCount: number;
};

export type PeerJoinedPayload = {
  participantId: string;
  participantCount: number;
};

export type PeerLeftPayload = {
  participantId: string;
  reason: "disconnect" | "leave";
  participantCount: number;
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