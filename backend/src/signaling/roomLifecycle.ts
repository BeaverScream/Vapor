import type { ParticipantRecord, RoomRecord, SignalingState } from "./state";

export type RoomIdentityFactories = {
  generateRoomId: () => string;
  generateParticipantId: () => string;
};

export type RoomRemovalResult = {
  roomId: string;
  participantId: string;
  isHost: boolean;
  participantCount: number;
  roomStillActive: boolean;
};

export function createRoomRecord(
  state: SignalingState,
  socketId: string,
  now: number,
  factories: RoomIdentityFactories
): { room: RoomRecord; participantId: string } {
  let roomId = factories.generateRoomId();
  while (state.rooms.has(roomId)) {
    roomId = factories.generateRoomId();
  }

  const participantId = factories.generateParticipantId();
  const hostRecord: ParticipantRecord = {
    participantId,
    socketId,
    joinedAt: now,
    lastSeenAt: now
  };

  const room: RoomRecord = {
    roomId,
    hostId: participantId,
    participants: new Map<string, ParticipantRecord>([[participantId, hostRecord]]),
    nicknameToParticipant: new Map<string, string>([]),
    createdAt: now
  };

  state.rooms.set(roomId, room);
  state.participantToRoom.set(participantId, roomId);
  state.socketToParticipant.set(socketId, participantId);

  return { room, participantId };
}

export function joinRoomRecord(
  state: SignalingState,
  roomId: string,
  socketId: string,
  now: number,
  generateParticipantId: () => string
): { room: RoomRecord; participantId: string; peers: Array<{ participantId: string; nickname?: string | null }> } | null {
  const room = state.rooms.get(roomId);
  if (!room) {
    return null;
  }

  const participantId = generateParticipantId();
  const participantRecord: ParticipantRecord = {
    participantId,
    socketId,
    joinedAt: now,
    lastSeenAt: now
  };

  const peers = Array.from(room.participants.values())
    .filter((peer) => !peer.socketId.startsWith("disconnected:"))
    .map((peer) => ({
      participantId: peer.participantId,
      nickname: peer.nickname ?? null,
    }));

  room.participants.set(participantId, participantRecord);
  // nickname mapping is handled by caller
  state.participantToRoom.set(participantId, roomId);
  state.socketToParticipant.set(socketId, participantId);

  return { room, participantId, peers };
}

export function removeParticipantBySocket(
  state: SignalingState,
  socketId: string
): RoomRemovalResult | null {
  const participantId = state.socketToParticipant.get(socketId);
  if (!participantId) {
    return null;
  }

  const roomId = state.participantToRoom.get(participantId);
  if (!roomId) {
    state.socketToParticipant.delete(socketId);
    return null;
  }

  const room = state.rooms.get(roomId);
  if (!room) {
    state.participantToRoom.delete(participantId);
    state.socketToParticipant.delete(socketId);
    return null;
  }

  const isHost = room.hostId === participantId;
  const participantRecord = room.participants.get(participantId);
  if (participantRecord) {
    if (participantRecord.nickname && room.nicknameToParticipant) {
      const key = participantRecord.nickname.toLowerCase();
      const mapped = room.nicknameToParticipant.get(key);
      if (mapped === participantId) {
        room.nicknameToParticipant.delete(key);
      }
    }
  }

  room.participants.delete(participantId);
  state.participantToRoom.delete(participantId);
  state.socketToParticipant.delete(socketId);

  if (isHost) {
    for (const peer of room.participants.values()) {
      state.participantToRoom.delete(peer.participantId);
      state.socketToParticipant.delete(peer.socketId);
    }
    if (room.roomName) state.roomNameToId.delete(room.roomName);
    state.rooms.delete(roomId);
    return {
      roomId,
      participantId,
      isHost,
      participantCount: 0,
      roomStillActive: false
    };
  }

  const participantCount = room.participants.size;
  if (participantCount === 0) {
    if (room.roomName) state.roomNameToId.delete(room.roomName);
    state.rooms.delete(roomId);
    return {
      roomId,
      participantId,
      isHost,
      participantCount: 0,
      roomStillActive: false
    };
  }

  return {
    roomId,
    participantId,
    isHost,
    participantCount,
    roomStillActive: true
  };
}