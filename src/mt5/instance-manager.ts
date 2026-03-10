import path from 'path';
import fse from 'fs-extra';
import { spawn, exec } from 'child_process';
import { env } from '../config/env';
import { logger } from '../config/logger';
import util from 'util';

const execPromise = util.promisify(exec);

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
  balance?: number;
  currency?: string;
  pid?: number;
}

/**
 * Manages the lifecycle of per-user MT5 terminal instances.
 */
export class InstanceManager {
  // ── Instance directory ────────────────────────────────────────────────────

  /** Returns the absolute path for a user's MT5 instance directory. */
  getInstanceDir(userId: string, login: string): string {
    return path.join(env.mt5InstancesDir, `${safeUserId(userId)}_${login}`);
  }

  /**
   * Creates the instance directory and copies the base MT5 installation into it.
   * If the directory already exists the copy is skipped (idempotent).
   */
  async createInstance(userId: string, login: string): Promise<string> {
    const instanceDir = this.getInstanceDir(userId, login);

    if (await fse.pathExists(instanceDir)) {
      logger.info('Instance directory already exists, reusing', { userId, login, instanceDir });
      return instanceDir;
    }

    // Verify base dir
    if (!(await fse.pathExists(env.mt5BaseDir))) {
      throw new Error(`MT5 base directory not found: ${env.mt5BaseDir} `);
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
   * Writes a `startup.ini` into the instance's `run / ` subdirectory.
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
      `Login=${login.trim()}`,
      `Password=${password.trim()}`,
      `Server=${server.trim()}`,
      'ProxyEnable=0',
      'SavePassword=1',
      'AutoConfiguration=1',
      '',
      '[Charts]',
      'MaxBars=500',
    ].join('\r\n');

    // MT5 often requires UTF-16LE with BOM for .ini files
    const bom = Buffer.from([0xFF, 0xFE]);
    const utf16Buffer = Buffer.from(content, 'utf16le');
    await fse.writeFile(ini, Buffer.concat([bom, utf16Buffer]));
    return ini;
  }

  // ── Launch ────────────────────────────────────────────────────────────────

  /**
   * Spawns a detached MT5 terminal process in portable mode.
   * NOTE: This is now a no-op because Python must act as the parent
   * process of the MT5 terminal to bypass Windows IPC restrictions.
   * We return -1, and Python will spawn the terminal and return the actual PID during waitForAuth.
   */
  async launchTerminal(
    instanceDir: string,
    _iniPath: string,
  ): Promise<number> {
    logger.info('Deferring terminal launch to Python verification script', { instanceDir });
    return -1;
  }

  // ── Auth detection ────────────────────────────────────────────────────────

  /**
   * Executes the verify_mt5.py Python script which connects to the
   * running MT5 terminal via IPC and confirms the account login.
   *
   * Returns auth status and the live account balance.
   */
  async waitForAuth(
    instanceDir: string,
    login: string,
    password?: string,
    server?: string,
    timeoutMs: number = env.mt5LoginTimeoutMs,
  ): Promise<AuthResult> {
    const exePath = path.join(instanceDir, env.mt5TerminalExe);
    const scriptPath = path.join(__dirname, '..', 'utils', 'verify_mt5.py');

    // Sanitise arguments for shell execution
    const safeLogin = login.replace(/["$]/g, '');
    const safePass = (password || '').replace(/"/g, '""'); // basic escaping for windows cmd
    const safeServer = (server || '').replace(/["$]/g, '');

    logger.info('Verifying MT5 connection via Python IPC', {
      login: safeLogin,
      server: safeServer,
      exePath,
      passLen: safePass.length,
      timeoutMs,
    });

    try {
      // Use python to run the script.
      // NEW ARGUMENT ORDER: path, login, timeout, password, server
      const cmd = `python "${scriptPath}" "${exePath}" "${safeLogin}" "${timeoutMs}" "${safePass}" "${safeServer}"`;

      logger.debug('Executing verification command', {
        cmd: cmd.replace(safePass, '********'),
        login: safeLogin
      });

      const { stdout, stderr } = await execPromise(cmd, { timeout: timeoutMs + 20000 });

      if (stderr && stderr.trim()) {
        logger.warn('MT5 Python script stderr:', { stderr, login: safeLogin });
      }

      const lines = stdout.trim().split('\n');
      const lastLine = lines[lines.length - 1] || '{}';
      let result: any;
      try {
        result = JSON.parse(lastLine);
      } catch (parseErr) {
        logger.error('Failed to parse Python output', { lastLine, stdout, login: safeLogin });
        return { status: 'failed', message: 'Verification script returned invalid data' };
      }

      if (result.status === 'connected') {
        return {
          status: 'connected',
          message: result.message, // Keep message as per AuthResult interface
          balance: result.balance,
          currency: result.currency,
          pid: result.pid
        };
      } else {
        return { status: 'failed', message: result.message || 'Verification failed' };
      }
    } catch (err: any) {
      if (err.killed) {
        return { status: 'failed', message: 'MT5 auth timeout: Python verification timed out' };
      }
      logger.error('Python verification script error', {
        error: err.message,
        stdout: err.stdout,
        stderr: err.stderr,
        login: safeLogin
      });
      return { status: 'failed', message: `Verification error: ${err.message}` };
    }
  }

  // ── Kill ─────────────────────────────────────────────────────────────────

  /**
   * Terminates the MT5 process for a given PID.
   * Uses `taskkill / F` on Windows for a reliable kill.
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

  /**
   * Run the fetch_mt5_data.py script to get real-time account data.
   */
  async getAccountData(userId: string, login: string): Promise<any> {
    const instanceDir = this.getInstanceDir(userId, login);
    const exePath = path.join(instanceDir, env.mt5TerminalExe);
    const scriptPath = path.join(__dirname, '..', 'utils', 'fetch_mt5_data.py');
    const cmd = `python "${scriptPath}" --path "${exePath}" --login "${login}"`;

    try {
      const { stdout } = await execPromise(cmd, { timeout: 15000 });
      const lines = stdout.trim().split('\n');
      const lastLine = lines[lines.length - 1] || '{}';
      return JSON.parse(lastLine);
    } catch (err: any) {
      logger.error('Failed to fetch MT5 data', { error: err.message, login, userId });
      return { status: 'failed', message: err.message };
    }
  }
}

// Singleton
export const instanceManager = new InstanceManager();
