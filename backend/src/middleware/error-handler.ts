/**
 * Error Handler Middleware
 *
 * Catches unhandled errors and returns a 500 response.
 * Must be registered last in the middleware chain.
 */

import { Request, Response, NextFunction } from "express";

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

/**
 * Global error handler middleware.
 * Catches any errors thrown in route handlers and returns appropriate response.
 *
 * Note: Must have 4 parameters for Express to recognize it as an error handler.
 */
export function errorHandler(
  err: ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log the error for debugging
  console.error("[Error Handler]", {
    message: err.message,
    code: err.code,
    statusCode: err.statusCode,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });

  // Determine status code
  const statusCode = err.statusCode || 500;

  // Send error response
  res.status(statusCode).json({
    error: statusCode === 500 ? "Internal server error" : err.message,
    ...(process.env.NODE_ENV === "development" && {
      details: err.message,
      code: err.code,
    }),
  });
}

/**
 * Async route wrapper to catch errors in async handlers.
 * Wraps an async function and forwards any errors to the error handler.
 *
 * Usage:
 *   router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler<T>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Create an API error with a specific status code.
 */
export function createApiError(
  message: string,
  statusCode: number,
  code?: string
): ApiError {
  const error: ApiError = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
