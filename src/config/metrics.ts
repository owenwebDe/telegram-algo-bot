import { Counter, Gauge, Registry } from 'prom-client';

export const registry = new Registry();
registry.setDefaultLabels({ app: 'mt5-backend' });

// ── Counters ─────────────────────────────────────────────────────────────────

export const mt5ConnectTotal = new Counter({
  name: 'mt5_connect_requests_total',
  help: 'Total number of MT5 connect requests received',
  registers: [registry],
});

export const mt5ConnectErrorsTotal = new Counter({
  name: 'mt5_connect_errors_total',
  help: 'Total number of MT5 connect requests that resulted in an error',
  labelNames: ['reason'],
  registers: [registry],
});

export const mt5LaunchSuccessTotal = new Counter({
  name: 'mt5_launch_success_total',
  help: 'Total number of MT5 terminal launches that succeeded',
  registers: [registry],
});

export const mt5LaunchFailureTotal = new Counter({
  name: 'mt5_launch_failure_total',
  help: 'Total number of MT5 terminal launches that failed',
  registers: [registry],
});

export const mt5JobQueuedTotal = new Counter({
  name: 'mt5_job_queued_total',
  help: 'Total number of MT5 launch jobs queued in BullMQ',
  registers: [registry],
});

// ── Gauges ───────────────────────────────────────────────────────────────────

export const mt5ActiveInstances = new Gauge({
  name: 'mt5_active_instances',
  help: 'Number of currently active MT5 terminal processes',
  registers: [registry],
});
