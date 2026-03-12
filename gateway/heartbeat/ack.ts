const HEARTBEAT_OK = 'HEARTBEAT_OK';
const DEFAULT_ACK_MAX_CHARS = 300;

/**
 * Result of processing a heartbeat reply for delivery.
 * Use when the gateway/session has the assistant reply text.
 */
export interface ProcessedHeartbeatReply {
  /** If false, treat as ack and do not deliver to user (e.g. do not persist). */
  shouldDeliver: boolean;
  /** Reply with HEARTBEAT_OK stripped from start/end. */
  strippedText: string;
}

/**
 * Process heartbeat reply per OpenClaw contract: HEARTBEAT_OK at start or end
 * is an ack; if remainder is within ackMaxChars, shouldDeliver is false.
 */
export function processHeartbeatReply(
  replyText: string,
  ackMaxChars: number = DEFAULT_ACK_MAX_CHARS
): ProcessedHeartbeatReply {
  const trimmed = replyText.trim();
  let stripped = trimmed;

  if (stripped.toUpperCase().startsWith(HEARTBEAT_OK)) {
    stripped = stripped.slice(HEARTBEAT_OK.length).trimStart();
  }
  if (stripped.toUpperCase().endsWith(HEARTBEAT_OK)) {
    stripped = stripped.slice(0, -HEARTBEAT_OK.length).trimEnd();
  }

  const shouldDeliver = stripped.length > ackMaxChars;
  return { shouldDeliver, strippedText: stripped };
}
