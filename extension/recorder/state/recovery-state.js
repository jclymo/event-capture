// Error recovery system

export const recoveryState = {
  lastSavedTimestamp: Date.now(),
  errorCount: 0,
  maxErrors: 3
};

export function incrementErrorCount() {
  recoveryState.errorCount++;
}

export function resetErrorCount() {
  recoveryState.errorCount = 0;
}

export function updateLastSavedTimestamp() {
  recoveryState.lastSavedTimestamp = Date.now();
}

export function shouldAttemptRecovery() {
  return recoveryState.errorCount >= recoveryState.maxErrors;
}

export function getRecoveryState() {
  return { ...recoveryState };
}

