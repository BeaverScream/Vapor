declare module "express" {
  export type Request = unknown;
  export type Response = {
    status: (code: number) => Response;
    json: (body: unknown) => void;
  };

  export type NextFunction = () => void;

  export type RouterType = {
    use: (...args: unknown[]) => unknown;
    get: (...args: unknown[]) => unknown;
  };

  export function Router(): RouterType;

  type ExpressApp = {
    use: (...args: unknown[]) => unknown;
    get: (...args: unknown[]) => unknown;
  } & RouterType;

  type ExpressStatic = {
    (): ExpressApp;
    json: () => unknown;
  };

  const express: ExpressStatic;
  export default express;
}