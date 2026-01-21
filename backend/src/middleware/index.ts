/**
 * Middleware exports
 */

export { auth, optionalAuth, type AuthenticatedRequest } from "./auth.js";
export {
  errorHandler,
  asyncHandler,
  createApiError,
  type ApiError,
} from "./error-handler.js";
