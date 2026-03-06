declare module "@socket.io/admin-ui" {
  import type { Server } from "socket.io";

  type BasicAuthConfig = {
    type: "basic";
    username: string;
    password: string;
  };

  type InstrumentOptions = {
    auth?: BasicAuthConfig;
    mode?: "development" | "production";
  };

  export function instrument(io: Server, opts?: InstrumentOptions): void;
}