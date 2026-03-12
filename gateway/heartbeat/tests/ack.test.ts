import { describe, expect, it } from 'bun:test';
import { processHeartbeatReply } from '../ack';

describe('heartbeat', () => {
  describe('processHeartbeatReply()', () => {
    it('returns shouldDeliver false when reply is exactly HEARTBEAT_OK (ack-only, do not persist)', () => {
      const out = processHeartbeatReply('HEARTBEAT_OK');
      expect(out.shouldDeliver).toBe(false);
      expect(out.strippedText).toBe('');
    });

    it('returns shouldDeliver false when reply is HEARTBEAT_OK with whitespace only', () => {
      const out = processHeartbeatReply('  HEARTBEAT_OK  ');
      expect(out.shouldDeliver).toBe(false);
      expect(out.strippedText).toBe('');
    });

    it('strips HEARTBEAT_OK from start and end; shouldDeliver false when remainder within ackMaxChars', () => {
      const short = 'One short note.';
      const out = processHeartbeatReply(`HEARTBEAT_OK\n\n${short}`, 300);
      expect(out.strippedText).toBe(short);
      expect(out.shouldDeliver).toBe(false);
    });

    it('returns shouldDeliver true when remainder exceeds ackMaxChars (alert text for user)', () => {
      const long = 'x'.repeat(301);
      const out = processHeartbeatReply(`HEARTBEAT_OK\n\n${long}`, 300);
      expect(out.strippedText).toBe(long);
      expect(out.shouldDeliver).toBe(true);
    });

    it('strips HEARTBEAT_OK at end only', () => {
      const out = processHeartbeatReply('Something to deliver.\n\nHEARTBEAT_OK', 300);
      expect(out.strippedText).toBe('Something to deliver.');
      expect(out.shouldDeliver).toBe(false);
    });

    it('uses default ackMaxChars 300 when not provided', () => {
      const exactly300 = 'a'.repeat(300);
      const out = processHeartbeatReply(`HEARTBEAT_OK\n${exactly300}`);
      expect(out.strippedText).toBe(exactly300);
      expect(out.shouldDeliver).toBe(false);
      const out301 = processHeartbeatReply(`HEARTBEAT_OK\n${'a'.repeat(301)}`);
      expect(out301.shouldDeliver).toBe(true);
    });

    it('treats HEARTBEAT_OK case-insensitively for stripping', () => {
      const out = processHeartbeatReply('heartbeat_ok');
      expect(out.strippedText).toBe('');
      expect(out.shouldDeliver).toBe(false);
    });
  });
});
