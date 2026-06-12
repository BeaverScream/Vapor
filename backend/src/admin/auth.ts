import { timingSafeEqual } from "node:crypto";

type Req = { headers: { authorization?: string } };
type Res = { status: (code: number) => { end: () => void } };
type Next = () => void;

function safeEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    const maxLen = Math.max(bufA.length, bufB.length) || 1;
    const padA = Buffer.concat([bufA, Buffer.alloc(maxLen - bufA.length)]);
    const padB = Buffer.concat([bufB, Buffer.alloc(maxLen - bufB.length)]);
    return timingSafeEqual(padA, padB) && bufA.length === bufB.length;
  } catch {
    return false;
  }
}

export function requireAdminAuth(req: Req, res: Res, next: Next): void {
  const authHeader = req.headers.authorization ?? "";

  const apiToken = process.env.ADMIN_API_TOKEN;
  if (apiToken && authHeader.startsWith("Bearer ")) {
    if (safeEqual(authHeader.slice(7), apiToken)) {
      next();
      return;
    }
  }

  const basicUser = process.env.ADMIN_BASIC_USER;
  const basicPass = process.env.ADMIN_BASIC_PASS;
  if (basicUser && basicPass && authHeader.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    const colonIdx = decoded.indexOf(":");
    if (colonIdx !== -1) {
      const user = decoded.slice(0, colonIdx);
      const pass = decoded.slice(colonIdx + 1);
      if (safeEqual(user, basicUser) && safeEqual(pass, basicPass)) {
        next();
        return;
      }
    }
  }

  res.status(401).end();
}
