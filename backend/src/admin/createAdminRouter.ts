import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { NextFunction, Response } from "express";

// Structural request type matching the express-fallback declaration (Request = unknown).
type Req = { header: (name: string) => string | undefined };

type CreateAdminRouterArgs = {
  getSnapshot: () => unknown;
  adminMetricsToken?: string;
};

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export function createAdminRouter({ getSnapshot, adminMetricsToken }: CreateAdminRouterArgs) {
  const router = Router();

  router.use((req: Req, res: Response, next: NextFunction) => {
    if (!adminMetricsToken) {
      return res.status(503).json({
        error: "ADMIN_METRICS_DISABLED"
      });
    }

    const presentedToken = req.header("x-admin-token");
    if (!presentedToken || !safeEqual(presentedToken, adminMetricsToken)) {
      return res.status(401).json({
        error: "UNAUTHORIZED"
      });
    }

    return next();
  });

  router.get("/metrics", (_req: unknown, res: Response) => {
    res.json(getSnapshot());
  });

  return router;
}