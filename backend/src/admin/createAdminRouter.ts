import { timingSafeEqual } from "node:crypto";
import { Router } from "express";

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

  router.use((req, res, next) => {
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

  router.get("/metrics", (_req, res) => {
    res.json(getSnapshot());
  });

  return router;
}