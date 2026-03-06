export type ParticipantRecord = {
  participantId: string;
  socketId: string;
  joinedAt: number;
};

export type Phase0RoomRecord = {
  roomId: string;
  hostId: string;
  participants: Map<string, ParticipantRecord>;
  createdAt: number;
};

export type Phase0SignalingState = {
  rooms: Map<string, Phase0RoomRecord>;
  participantToRoom: Map<string, string>;
  socketToParticipant: Map<string, string>;
};

export function createPhase0State(): Phase0SignalingState {
  return {
    rooms: new Map<string, Phase0RoomRecord>(),
    participantToRoom: new Map<string, string>(),
    socketToParticipant: new Map<string, string>()
  };
}

export function resetPhase0State(state: Phase0SignalingState): void {
  state.rooms.clear();
  state.participantToRoom.clear();
  state.socketToParticipant.clear();
}

export function getPhase0StateSnapshot(state: Phase0SignalingState) {
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