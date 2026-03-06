import dotenv from "dotenv";
import { createVaporServer } from "./server";

dotenv.config();

const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
const port = Number(process.env.PORT ?? 3001);
const adminMetricsToken = process.env.ADMIN_METRICS_TOKEN;
const adminUiUsername = process.env.ADMIN_UI_USERNAME;
const adminUiPassword = process.env.ADMIN_UI_PASSWORD;
const adminUiOrigin = process.env.ADMIN_UI_ORIGIN ?? "https://admin.socket.io";

const server = createVaporServer({
  frontendOrigin,
  port,
  adminMetricsToken,
  adminUiUsername,
  adminUiPassword,
  adminUiOrigin
});

server.start().then(() => {
  console.log(`Vapor backend listening on http://localhost:${port}`);
});