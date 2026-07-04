export const CLIENT_EVENT_NAMES = {
  CREATE_ROOM: "create_room",
  JOIN_ROOM: "join_room",
  LEAVE_ROOM: "leave_room",
  SIGNAL_OFFER: "signal_offer",
  SIGNAL_ANSWER: "signal_answer",
  SIGNAL_ICE: "signal_ice",
  RESUME_SESSION: "resume_session",
  ROOM_PASSWORD_UPDATE: "room_password_update",
  KICK_PARTICIPANT: "kick_participant"
} as const;

export const SERVER_EVENT_NAMES = {
  ROOM_CREATED: "room_created",
  ROOM_JOINED: "room_joined",
  SESSION_RESUMED: "session_resumed",
  PEER_JOINED: "peer_joined",
  PEER_LEFT: "peer_left",
  SIGNAL_OFFER: "signal_offer",
  SIGNAL_ANSWER: "signal_answer",
  SIGNAL_ICE: "signal_ice",
  HOST_RECONNECT_GRACE: "host_reconnect_grace",
  ROOM_PASSWORD_UPDATED: "room_password_updated",
  ROOM_DESTROYED: "room_destroyed",
  PARTICIPANT_KICKED: "participant_kicked",
  ERROR: "error"
} as const;

export type ClientEventName =
  (typeof CLIENT_EVENT_NAMES)[keyof typeof CLIENT_EVENT_NAMES];

export type ServerEventName =
  (typeof SERVER_EVENT_NAMES)[keyof typeof SERVER_EVENT_NAMES];