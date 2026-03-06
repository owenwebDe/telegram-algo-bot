const fs = require("fs/promises");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

class SessionManager {
  constructor(config) {
    this.config = config;
    this.sessions = new Map();
  }

  sanitizeUserId(userId) {
    return String(userId).replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  async startSession({ userId, login, password, server }) {
    const safeId = this.sanitizeUserId(userId);
    const existing = this.sessions.get(safeId);
    if (existing) {
      this.stopSession(safeId);
    }

    const sessionDir = path.join(this.config.sessionRoot, safeId);
    const mt5Dir = path.join(sessionDir, "mt5-instance");
    const runDir = path.join(sessionDir, "run");
    await fs.mkdir(runDir, { recursive: true });

    const templateExe = path.join(this.config.mt5TemplateDir, this.config.mt5TerminalExe);
    await fs.access(templateExe);

    await this.copyTemplateIfMissing(mt5Dir);

    const startupConfigPath = path.join(runDir, "startup.ini");
    await this.writeStartupConfig(startupConfigPath, { login, password, server });

    const executablePath = path.join(mt5Dir, this.config.mt5TerminalExe);
    const child = spawn(
      executablePath,
      ["/portable", `/config:${startupConfigPath}`],
      {
        cwd: mt5Dir,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }
    );
    child.unref();

    const startedAt = new Date().toISOString();
    this.sessions.set(safeId, {
      userId: safeId,
      pid: child.pid,
      login,
      server,
      startedAt,
      mt5Dir,
      status: "LAUNCHED",
    });

    const authResult = await this.waitForAuthorization(mt5Dir, login);
    const state = this.sessions.get(safeId);
    if (state) {
      state.status = authResult.status;
      state.message = authResult.message;
    }

    return {
      userId: safeId,
      pid: child.pid,
      startedAt,
      status: authResult.status,
      message: authResult.message,
    };
  }

  async copyTemplateIfMissing(targetDir) {
    try {
      await fs.access(targetDir);
      return;
    } catch {
      await fs.mkdir(path.dirname(targetDir), { recursive: true });
      await fs.cp(this.config.mt5TemplateDir, targetDir, { recursive: true });
    }
  }

  async writeStartupConfig(filePath, { login, password, server }) {
    const body = [
      "[Common]",
      `Login=${login}`,
