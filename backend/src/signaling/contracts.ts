export const CLIENT_EVENTS = {
  createRoom: "create_room",
  joinRoom: "join_room",
  leaveRoom: "leave_room"
} as const;

export const SERVER_EVENTS = {
  roomCreated: "room_created",
  roomJoined: "room_joined",
  peerJoined: "peer_joined",
  peerLeft: "peer_left",
  roomDestroyed: "room_destroyed",
  error: "error"
} as const;

export type CreateRoomPayload = {
  password?: string;
};

export type JoinRoomPayload = {
  roomId?: string;
  password?: string;
};

export type SocketErrorPayload = {
  code: string;
  message: string;
};

export type RoomCreatedPayload = {
  roomId: string;
  participantId: string;
  reconnectToken: null;
  expiresAt: null;
  participantCount: number;
};

export type RoomJoinedPayload = {
  roomId: string;
  participantId: string;
  peers: Array<{ participantId: string }>;
  reconnectToken: null;
  expiresAt: null;
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

export type RoomDestroyedPayload = {
  reason: "host_disconnected" | "host_left";
};