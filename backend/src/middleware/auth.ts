/**
 * Auth Middleware
 *
 * Dummy/noop authentication middleware.
 * Replace with actual authentication logic when needed.
 */

import { Request, Response, NextFunction } from "express";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
  };
}

/**
 * Noop auth middleware - passes all requests through.
 * TODO: Replace with actual authentication (JWT, session, etc.)
 */
export function auth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  // Placeholder: attach a dummy user to the request
  req.user = {
    id: "anonymous",
  };
  next();
}
