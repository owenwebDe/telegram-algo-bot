import path from 'path';
import fs from 'fs';
import fse from 'fs-extra';
import { spawn, ChildProcess } from 'child_process';
import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * Sanitise a user ID to safe directory name characters.
 */
function safeUserId(userId: string): string {
  return `user_${String(userId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export interface LaunchResult {
  pid: number;
  instanceDir: string;
}

export interface AuthResult {
  status: 'connected' | 'failed';
  message: string;
}

/**
 * Manages the lifecycle of per-user MT5 terminal instances.
 */
export class InstanceManager {
  // ── Instance directory ────────────────────────────────────────────────────

  /** Returns the absolute path for a user's MT5 instance directory. */
  getInstanceDir(userId: string): string {
    return path.join(env.mt5InstancesDir, safeUserId(userId));
  }

  /**
   * Creates the instance directory and copies the base MT5 installation into it.
   * If the directory already exists the copy is skipped (idempotent).
   */
  async createInstance(userId: string): Promise<string> {
    const instanceDir = this.getInstanceDir(userId);

    if (await fse.pathExists(instanceDir)) {
      logger.info('Instance directory already exists, reusing', { userId, instanceDir });
      return instanceDir;
    }

    // Verify base dir
    if (!(await fse.pathExists(env.mt5BaseDir))) {
      throw new Error(`MT5 base directory not found: ${env.mt5BaseDir}`);
    }

    logger.info('Copying MT5 base to instance directory', {
      userId,
      from: env.mt5BaseDir,
      to: instanceDir,
    });

    // Exclude heavy history, logs, or unneeded bases from being copied
    const filterFunc = (src: string) => {
      const name = path.basename(src).toLowerCase();
      if (['history', 'logs', 'tester', 'bases'].includes(name)) return false;
      return true;
    };

    await fse.copy(env.mt5BaseDir, instanceDir, { overwrite: false, errorOnExist: false, filter: filterFunc });
    logger.info('Instance directory created', { userId, instanceDir });

    return instanceDir;
  }

  // ── Startup config ────────────────────────────────────────────────────────

  /**
   * Writes a `startup.ini` into the instance's `run/` subdirectory.
   * MT5 portable mode reads this file to auto-login.
   * The password value appears only in this ephemeral file and is never logged.
   */
  async writeStartupConfig(
    instanceDir: string,
    login: string,
    password: string,   // raw plaintext — used only here, never logged
    server: string,
  ): Promise<string> {
    const runDir = path.join(instanceDir, 'run');
    await fse.ensureDir(runDir);

    const ini = path.join(runDir, 'startup.ini');
    const content = [
      '[Common]',
      `Login=${login}`,
      `Password=${password}`,
      `Server=${server}`,
      'AutoConfiguration=1',
      '',
      '[Charts]',
      'MaxBars=500',
    ].join('\r\n');

    await fse.writeFile(ini, content, { encoding: 'utf8' });
    return ini;
  }

  // ── Launch ────────────────────────────────────────────────────────────────

  /**
   * Spawns a detached MT5 terminal process in portable mode.
   * Returns the PID immediately — call `waitForAuth` to confirm login.
   */
  async launchTerminal(
    instanceDir: string,
    iniPath: string,
  ): Promise<number> {
    const exe = path.join(instanceDir, env.mt5TerminalExe);

    if (!(await fse.pathExists(exe))) {
      throw new Error(`MT5 executable not found: ${exe}`);
    }

    const child: ChildProcess = spawn(
      exe,
      ['/portable', `/config:${iniPath}`],
      {
        cwd: instanceDir,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    child.unref();

    const pid = child.pid;
    if (!pid) {
      throw new Error('Failed to obtain PID from spawned MT5 process');
    }

    logger.info('MT5 terminal launched', { pid, instanceDir });
    return pid;
  }

  // ── Auth detection ────────────────────────────────────────────────────────

  /**
   * Polls the MT5 terminal log file for auth confirmation.
   *
   * MT5 writes a log inside `<instanceDir>/logs/<YYYYMMDD>.log`.
   * We scan for the strings MT5 uses to confirm or deny a login:
   *   - "authorized"              → login succeeded
   *   - "invalid account"         → wrong credentials
   *   - "Connection failed"       → cannot reach broker server
   *
   * Returns after `timeoutMs` if neither condition is met, treating it as failure.
   */
  async waitForAuth(
    instanceDir: string,
    login: string,
    timeoutMs: number = env.mt5LoginTimeoutMs,
  ): Promise<AuthResult> {
    const logsDir = path.join(instanceDir, 'logs');
    const deadline = Date.now() + timeoutMs;
    const pollMs = 2_000;

    // MT5 names the log file after today's date: YYYYMMDD.log
    const today = new Date();
    const dateStr =
      today.getFullYear().toString() +
      String(today.getMonth() + 1).padStart(2, '0') +
      String(today.getDate()).padStart(2, '0');
    const logFile = path.join(logsDir, `${dateStr}.log`);

    logger.info('Waiting for MT5 auth confirmation', { login, logFile, timeoutMs });

    while (Date.now() < deadline) {
      await sleep(pollMs);

      if (!fs.existsSync(logFile)) continue;

      const content = fs.readFileSync(logFile, 'utf8');

      if (/authorized/i.test(content)) {
        return { status: 'connected', message: 'MT5 account authorized successfully' };
      }
      if (/invalid account/i.test(content)) {
        return { status: 'failed', message: 'Invalid MT5 account credentials' };
      }
      if (/connection failed/i.test(content)) {
        return { status: 'failed', message: 'MT5 connection to broker server failed' };
      }
    }

    return { status: 'failed', message: 'MT5 auth timeout: no response within allowed window' };
  }

  // ── Kill ─────────────────────────────────────────────────────────────────

  /**
   * Terminates the MT5 process for a given PID.
   * Uses `taskkill /F` on Windows for a reliable kill.
   */
  async killProcess(pid: number): Promise<void> {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGTERM');
      }
      logger.info('MT5 process kill signal sent', { pid });
    } catch (err) {
      logger.warn('Failed to kill MT5 process (may already be dead)', { pid, error: (err as Error).message });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Singleton
export const instanceManager = new InstanceManager();
