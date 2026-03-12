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
  /** Max chars after HEARTBEAT_OK to treat as ack (drop delivery). Default 300. */
  ackMaxChars?: number;
  /**
   * Max ms jitter applied to the first scheduled run after a cold start.
   * Default is 10% of intervalMs, clamped to intervalMs. Set to 0 to disable.
   */
  jitterMs?: number;
  /** If true, deliver reasoning separately (future use). */
  includeReasoning?: boolean;
  /** Where to deliver response: "last" (main session) or "none". Default "last". */
  target?: 'last' | 'none';
  /** Run log pruning. */
  runLog?: { maxBytes?: number; keepLines?: number };
}

export type ExecutePromptFn = (
  prompt: string,
  opts?: {
    target?: 'last' | 'none';
    ackMaxChars?: number;
    onReply?: (text: string) => void;
  }
) => Promise<void>;

export interface HeartbeatRunLogEntry {
  startedAt: string;
  finishedAt: string;
  success: boolean;
  error?: string;
}
