require("dotenv").config();
const bool = (v) => ["1","true","yes","on"].includes(String(v || "").toLowerCase());
module.exports = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL,
  databaseSsl: bool(process.env.DATABASE_SSL),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  nodeEnv: process.env.NODE_ENV || "development",
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "2h",
  rateWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 900000),
  rateMax: Number(process.env.RATE_LIMIT_MAX || 100),
  authRateMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 10)
};
