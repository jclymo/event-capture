// Task sorting utilities

export function sortTasksBySync(taskHistory = {}) {
  const tasks = Object.values(taskHistory || {});
  return tasks.slice().sort((a, b) => {
    const aSynced = a.pushedToMongo ? 1 : 0;
    const bSynced = b.pushedToMongo ? 1 : 0;
    if (aSynced !== bSynced) {
      return aSynced - bSynced;
    }
    const aTime = (a.endTime || a.startTime || 0);
    const bTime = (b.endTime || b.startTime || 0);
    return bTime - aTime;
  });
}

