import type { ParticipantRecord, Phase0RoomRecord, Phase0SignalingState } from "./state";

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
  state: Phase0SignalingState,
  socketId: string,
  now: number,
  factories: RoomIdentityFactories
): { room: Phase0RoomRecord; participantId: string } {
  let roomId = factories.generateRoomId();
  while (state.rooms.has(roomId)) {
    roomId = factories.generateRoomId();
  }

  const participantId = factories.generateParticipantId();
  const hostRecord: ParticipantRecord = {
    participantId,
    socketId,
    joinedAt: now
  };

  const room: Phase0RoomRecord = {
    roomId,
    hostId: participantId,
    participants: new Map<string, ParticipantRecord>([[participantId, hostRecord]]),
    createdAt: now
  };

  state.rooms.set(roomId, room);
  state.participantToRoom.set(participantId, roomId);
  state.socketToParticipant.set(socketId, participantId);

  return { room, participantId };
}

export function joinRoomRecord(
  state: Phase0SignalingState,
  roomId: string,
  socketId: string,
  now: number,
  generateParticipantId: () => string
): { room: Phase0RoomRecord; participantId: string; peers: Array<{ participantId: string }> } | null {
  const room = state.rooms.get(roomId);
  if (!room) {
    return null;
  }

  const participantId = generateParticipantId();
  const participantRecord: ParticipantRecord = {
    participantId,
    socketId,
    joinedAt: now
  };

  const peers = Array.from(room.participants.values()).map((peer) => ({
    participantId: peer.participantId
  }));

  room.participants.set(participantId, participantRecord);
  state.participantToRoom.set(participantId, roomId);
  state.socketToParticipant.set(socketId, participantId);

  return { room, participantId, peers };
}

export function removeParticipantBySocket(
  state: Phase0SignalingState,
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

  room.participants.delete(participantId);
  state.participantToRoom.delete(participantId);
  state.socketToParticipant.delete(socketId);

  if (isHost) {
    for (const peer of room.participants.values()) {
      state.participantToRoom.delete(peer.participantId);
      state.socketToParticipant.delete(peer.socketId);
    }
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