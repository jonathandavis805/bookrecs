import { db, now } from "./db";

const RATE_LIMIT_WINDOW = 15 * 60; // 15 minutes in seconds
const MAX_ATTEMPTS = 5;

interface FailedAttempt {
  timestamp: number;
  ip: string;
  identifier: string;
}

const failedAttempts: FailedAttempt[] = [];

// Clean up old entries
function cleanup() {
  const cutoff = now() - RATE_LIMIT_WINDOW;
  for (let i = failedAttempts.length - 1; i >= 0; i--) {
    if (failedAttempts[i].timestamp < cutoff) {
      failedAttempts.splice(i, 1);
    }
  }
}

// Check if login should be blocked
export function isBlocked(ip: string, identifier: string): boolean {
  cleanup();
  const cutoff = now() - RATE_LIMIT_WINDOW;
  
  // Count attempts for this IP+identifier combination
  const attempts = failedAttempts.filter(
    a => a.ip === ip && a.identifier === identifier && a.timestamp >= cutoff
  );
  
  return attempts.length >= MAX_ATTEMPTS;
}

// Record a failed attempt
export function recordFailedAttempt(ip: string, identifier: string) {
  failedAttempts.push({
    timestamp: now(),
    ip,
    identifier
  });
}

// Clear attempts on successful login
export function clearAttempts(ip: string, identifier: string) {
  const cutoff = now() - RATE_LIMIT_WINDOW;
  for (let i = failedAttempts.length - 1; i >= 0; i--) {
    const attempt = failedAttempts[i];
    if (attempt.timestamp < cutoff) {
      failedAttempts.splice(i, 1);
    } else if (attempt.ip === ip && attempt.identifier === identifier) {
      failedAttempts.splice(i, 1);
    }
  }
}
