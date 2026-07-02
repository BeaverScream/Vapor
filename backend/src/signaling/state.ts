export type ParticipantRecord = {
  participantId: string;
  socketId: string;
  joinedAt: number;
  lastSeenAt: number;
  nickname?: string;
};

export type RoomRecord = {
  roomId: string;
  hostId: string;
  participants: Map<string, ParticipantRecord>;
  nicknameToParticipant: Map<string, string>;
  createdAt: number;
  roomName?: string;
};

export type SignalingState = {
  rooms: Map<string, RoomRecord>;
  participantToRoom: Map<string, string>;
  socketToParticipant: Map<string, string>;
  roomNameToId: Map<string, string>;
};

export function createSignalingState(): SignalingState {
  return {
    rooms: new Map<string, RoomRecord>(),
    participantToRoom: new Map<string, string>(),
    socketToParticipant: new Map<string, string>(),
    roomNameToId: new Map<string, string>(),
  };
}

export function resetSignalingState(state: SignalingState): void {
  state.rooms.clear();
  state.participantToRoom.clear();
  state.socketToParticipant.clear();
  state.roomNameToId.clear();
}

export function getSignalingStateSnapshot(state: SignalingState) {
  return {
    rooms: Array.from(state.rooms.values()).map((room) => ({
      roomId: room.roomId,
      hostId: room.hostId,
      createdAt: room.createdAt,
      participantCount: room.participants.size,
      participantIds: Array.from(room.participants.keys())
    })),
    roomCount: state.rooms.size,
    participantToRoomCount: state.participantToRoom.size,
    socketToParticipantCount: state.socketToParticipant.size
  };
}