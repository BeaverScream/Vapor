import type { Server, Socket } from "socket.io";
import { CLIENT_EVENTS, SERVER_EVENTS, type CreateRoomPayload, type JoinRoomPayload, type PeerJoinedPayload, type PeerLeftPayload, type RoomCreatedPayload, type RoomDestroyedPayload, type RoomJoinedPayload, type SocketErrorPayload } from "./contracts";
import type { Phase0SignalingState } from "./state";
import { createRoomRecord, joinRoomRecord, removeParticipantBySocket, type RoomIdentityFactories } from "./roomLifecycle";

type MetricsAdapter = {
  recordConnection: (socketId: string, now?: number) => void;
  recordRoomJoin: (socketId: string, roomId: string) => void;
  recordDisconnect: (socketId: string, now?: number) => void;
};

type RegisterSocketHandlersArgs = {
  io: Server;
  state: Phase0SignalingState;
  metrics: MetricsAdapter;
  now: () => number;
  factories: RoomIdentityFactories;
};

type ExitSource = "disconnect" | "leave";

function emitRoomNotFound(socket: Socket): void {
  const errorPayload: SocketErrorPayload = {
    code: "ROOM_NOT_FOUND",
    message: "Room not found"
  };
  socket.emit(SERVER_EVENTS.error, errorPayload);
}

function emitParticipantExit(
  socket: Socket,
  removed: ReturnType<typeof removeParticipantBySocket>,
  source: ExitSource
): void {
  if (!removed) {
    return;
  }

  if (removed.roomStillActive) {
    const payload: PeerLeftPayload = {
      participantId: removed.participantId,
      reason: source,
      participantCount: removed.participantCount
    };
    socket.to(removed.roomId).emit(SERVER_EVENTS.peerLeft, payload);
    return;
  }

  if (removed.isHost) {
    const payload: RoomDestroyedPayload = {
      reason: source === "leave" ? "host_left" : "host_disconnected"
    };
    socket.to(removed.roomId).emit(SERVER_EVENTS.roomDestroyed, payload);
  }
}

export function registerSocketHandlers({
  io,
  state,
  metrics,
  now,
  factories
}: RegisterSocketHandlersArgs): void {
  io.on("connection", (socket) => {
    metrics.recordConnection(socket.id);

    socket.on(CLIENT_EVENTS.createRoom, (_payload: CreateRoomPayload | undefined) => {
      const createdAt = now();
      const { room, participantId } = createRoomRecord(state, socket.id, createdAt, factories);

      socket.join(room.roomId);
      metrics.recordRoomJoin(socket.id, room.roomId);

      const response: RoomCreatedPayload = {
        roomId: room.roomId,
        participantId,
        reconnectToken: null,
        expiresAt: null,
        participantCount: room.participants.size
      };

      socket.emit(SERVER_EVENTS.roomCreated, response);
    });

    socket.on(CLIENT_EVENTS.joinRoom, (payload: JoinRoomPayload | undefined) => {
      const roomId = payload?.roomId;
      if (!roomId) {
        emitRoomNotFound(socket);
        return;
      }

      const joined = joinRoomRecord(state, roomId, socket.id, now(), factories.generateParticipantId);
      if (!joined) {
        emitRoomNotFound(socket);
        return;
      }

      socket.join(roomId);
      metrics.recordRoomJoin(socket.id, roomId);

      const roomJoinedPayload: RoomJoinedPayload = {
        roomId,
        participantId: joined.participantId,
        peers: joined.peers,
        reconnectToken: null,
        expiresAt: null,
        participantCount: joined.room.participants.size
      };

      socket.emit(SERVER_EVENTS.roomJoined, roomJoinedPayload);

      const peerJoinedPayload: PeerJoinedPayload = {
        participantId: joined.participantId,
        participantCount: joined.room.participants.size
      };

      socket.to(roomId).emit(SERVER_EVENTS.peerJoined, peerJoinedPayload);
    });

    socket.on(CLIENT_EVENTS.leaveRoom, () => {
      const removed = removeParticipantBySocket(state, socket.id);
      emitParticipantExit(socket, removed, "leave");
      metrics.recordDisconnect(socket.id);
    });

    socket.on("disconnect", () => {
      const removed = removeParticipantBySocket(state, socket.id);
      emitParticipantExit(socket, removed, "disconnect");

      metrics.recordDisconnect(socket.id);
    });
  });
}