import type { Server, Socket } from "socket.io";
import * as signaling from "../contracts";
import type {
  SignalAnswerPayload,
  SignalAnswerRelayPayload,
  SignalIcePayload,
  SignalIceRelayPayload,
  SignalOfferPayload,
  SignalOfferRelayPayload,
} from "../contracts";
import type { SignalingState } from "../state";

const MAX_SIGNAL_IDENTIFIER_LENGTH = 128;
const MAX_SIGNAL_SDP_BYTES = 64 * 1024;
const MAX_SIGNAL_ICE_BYTES = 16 * 1024;

export function normalizeSignalIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SIGNAL_IDENTIFIER_LENGTH) return null;
  return trimmed;
}

export function normalizeSignalSdp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const serializedLength = Buffer.byteLength(value, "utf8");
  if (serializedLength === 0 || serializedLength > MAX_SIGNAL_SDP_BYTES) return null;
  return value;
}

export function normalizeSignalCandidate(
  value: unknown,
): string | Record<string, unknown> | null {
  if (typeof value === "string") {
    const serializedLength = Buffer.byteLength(value, "utf8");
    if (serializedLength === 0 || serializedLength > MAX_SIGNAL_ICE_BYTES) return null;
    return value;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  let serializedCandidate: string;
  try {
    serializedCandidate = JSON.stringify(value);
  } catch {
    return null;
  }

  const serializedLength = Buffer.byteLength(serializedCandidate, "utf8");
  if (serializedLength <= 2 || serializedLength > MAX_SIGNAL_ICE_BYTES) return null;

  return value as Record<string, unknown>;
}

type SignalPayloadBase = { roomId?: unknown; toParticipantId?: unknown };

type SignalRoute = {
  roomId: string;
  fromParticipantId: string;
  toSocketId: string;
};

export function resolveSignalRoute(
  socket: Socket,
  payload: SignalPayloadBase | undefined,
  state: SignalingState,
  emitNotFound: () => void,
  now: () => number,
): SignalRoute | null {
  const roomId = payload?.roomId;
  const toParticipantId = payload?.toParticipantId;

  if (!roomId || !toParticipantId) {
    emitNotFound();
    return null;
  }

  const fromParticipantId = state.socketToParticipant.get(socket.id);
  if (!fromParticipantId) {
    emitNotFound();
    return null;
  }

  const room = state.rooms.get(roomId as string);
  if (!room || !room.participants.has(fromParticipantId)) {
    emitNotFound();
    return null;
  }

  const toParticipant = room.participants.get(toParticipantId as string);
  if (!toParticipant || toParticipant.socketId.startsWith("disconnected:")) {
    emitNotFound();
    return null;
  }

  room.participants.get(fromParticipantId)!.lastSeenAt = now();
  return {
    roomId: roomId as string,
    fromParticipantId,
    toSocketId: toParticipant.socketId,
  };
}

export function handleSignalOffer(
  socket: Socket,
  payload: SignalOfferPayload | undefined,
  state: SignalingState,
  io: Server,
  emitNotFound: () => void,
  emitInvalidPayload: () => void,
  now: () => number,
): void {
  const route = resolveSignalRoute(socket, payload, state, emitNotFound, now);
  if (!route) return;

  const sdp = normalizeSignalSdp(payload?.sdp);
  if (!sdp) {
    emitInvalidPayload();
    return;
  }

  const relayPayload: SignalOfferRelayPayload = {
    roomId: route.roomId,
    fromParticipantId: route.fromParticipantId,
    sdp,
  };

  io.to(route.toSocketId).emit(signaling.SERVER_EVENTS.signalOffer, relayPayload);
}

export function handleSignalAnswer(
  socket: Socket,
  payload: SignalAnswerPayload | undefined,
  state: SignalingState,
  io: Server,
  emitNotFound: () => void,
  emitInvalidPayload: () => void,
  now: () => number,
): void {
  const route = resolveSignalRoute(socket, payload, state, emitNotFound, now);
  if (!route) return;

  const sdp = normalizeSignalSdp(payload?.sdp);
  if (!sdp) {
    emitInvalidPayload();
    return;
  }

  const relayPayload: SignalAnswerRelayPayload = {
    roomId: route.roomId,
    fromParticipantId: route.fromParticipantId,
    sdp,
  };

  io.to(route.toSocketId).emit(signaling.SERVER_EVENTS.signalAnswer, relayPayload);
}

export function handleSignalIce(
  socket: Socket,
  payload: SignalIcePayload | undefined,
  state: SignalingState,
  io: Server,
  emitNotFound: () => void,
  emitInvalidPayload: () => void,
  now: () => number,
): void {
  const route = resolveSignalRoute(socket, payload, state, emitNotFound, now);
  if (!route) return;

  const candidate = normalizeSignalCandidate(payload?.candidate);
  if (!candidate) {
    emitInvalidPayload();
    return;
  }

  const relayPayload: SignalIceRelayPayload = {
    roomId: route.roomId,
    fromParticipantId: route.fromParticipantId,
    candidate,
  };

  io.to(route.toSocketId).emit(signaling.SERVER_EVENTS.signalIce, relayPayload);
}
