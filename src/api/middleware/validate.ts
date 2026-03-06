import { body, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';

/**
 * Validation rules for POST /api/mt5/connect
 *
 * login  — numeric string, 6–10 digits (typical MT5 account number range)
 * password — non-empty string, max 128 chars
 * server — non-empty alphanumeric/dash/dot string, max 128 chars
 */
export const validateMt5Connect = [
  body('login')
    .isString()
    .withMessage('login must be a string')
    .matches(/^\d{6,10}$/)
    .withMessage('login must be a numeric broker account number (6–10 digits)'),

  body('password')
    .isString()
    .withMessage('password must be a string')
    .notEmpty()
    .withMessage('password must not be empty')
    .isLength({ max: 128 })
    .withMessage('password must not exceed 128 characters'),

  body('server')
    .isString()
    .withMessage('server must be a string')
    .notEmpty()
    .withMessage('server must not be empty')
    .isLength({ max: 128 })
    .withMessage('server must not exceed 128 characters')
    .matches(/^[\w.\-]+$/)
    .withMessage('server contains invalid characters'),

  // Run the result check after the rules above
  (req: Request, res: Response, next: NextFunction): void => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(422).json({
        error: 'ValidationError',
        messages: errors.array().map((e) => ({ field: e.type, message: e.msg })),
      });
      return;
    }
    next();
  },
];
