import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { env } from './env';

// Ensure log directory exists
const logDir = path.resolve(process.cwd(), env.logDir);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

/** Redact sensitive fields from log metadata so passwords never appear in logs */
function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const sensitive = ['password', 'encryptedPassword', 'encrypted_password'];
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = sensitive.includes(k) ? '[REDACTED]' : v;
  }
  return result;
}

const formats = [
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format((info) => {
    if (info.meta && typeof info.meta === 'object') {
      info.meta = redact(info.meta as Record<string, unknown>);
    }
    return info;
  })(),
];

export const logger = winston.createLogger({
  level: env.logLevel,
  format: winston.format.combine(...formats, winston.format.json()),
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        ...formats,
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...rest }) => {
          const extra = Object.keys(rest).length
            ? ' ' + JSON.stringify(rest)
            : '';
          return `${timestamp} [${level}] ${message}${extra}`;
        }),
      ),
    }),
  ],
});
