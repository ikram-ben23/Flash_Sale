const { randomUUID } = require("node:crypto");
const jwt = require("jsonwebtoken");
const { HttpError } = require("./errors");
const { jwtSecret } = require("./config");
function requestId(req, res, next) {
  req.id = randomUUID(); res.setHeader("X-Request-Id", req.id); next();
}
function authenticate(req, res, next) {
  try {
    const header = req.get("Authorization") || "";
    if (!header.startsWith("Bearer ")) throw new HttpError(401, "AUTH_REQUIRED", "Send Authorization: Bearer <token>.");
    const payload = jwt.verify(header.slice(7), jwtSecret);
    if (!payload.sub) throw new Error("Missing subject");
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (e) {
    if (e instanceof HttpError) return next(e);
    return next(new HttpError(401, "INVALID_TOKEN", "The access token is invalid or expired."));
  }
}
function notFound(req, res) {
  res.status(404).json({ success:false, error:{ code:"ROUTE_NOT_FOUND", message:`Route not found: ${req.method} ${req.path}`, requestId:req.id } });
}
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = Number(err.status) || 500;
  if (status >= 500) console.error(`[${req.id}]`, err);
  const error = { code:err.code || (status === 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_ERROR"),
    message:status === 500 ? "An unexpected error occurred." : err.message, requestId:req.id };
  if (err.details !== undefined) error.details = err.details;
  res.status(status).json({ success:false, error });
}
module.exports = { requestId, authenticate, notFound, errorHandler };
