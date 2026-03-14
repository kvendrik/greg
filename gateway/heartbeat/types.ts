/** Active hours: only run heartbeat inside this window (local or configured timezone). */
export interface HeartbeatActiveHours {
  /** Start time e.g. "08:00". */
  start: string;
  /** End time e.g. "24:00" or "22:00". */
  end: string;
  /** IANA timezone e.g. "America/New_York". Omit for host timezone. */
  timezone?: string;
}

/** Options for the heartbeat scheduler. All optional; defaults in runner. */
export interface HeartbeatOptions {
  /** If false, heartbeat does not start. Default true. */
  enabled: boolean;
  /** Interval between heartbeat runs in milliseconds. Default 30 minutes. */
  intervalMs?: number;
  /** Only run inside this time window. */
  activeHours?: HeartbeatActiveHours;
  /** Custom prompt body (replaces default HEARTBEAT instruction). HEARTBEAT.md content still appended. */
  prompt?: string;
  /** Run log pruning. */
  runLog?: { maxBytes?: number; keepLines?: number };
}

export interface HeartbeatRunLogEntry {
  startedAt: string;
  finishedAt: string;
  success: boolean;
  error?: string;
}
