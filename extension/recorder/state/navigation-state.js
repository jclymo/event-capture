// Navigation state tracking

export const navigationState = {
  lastUrl: null,
  lastTitle: null,
  pendingNavigation: false
};

export function updateNavigationState(url, title, pending = false) {
  navigationState.lastUrl = url;
  navigationState.lastTitle = title;
  navigationState.pendingNavigation = pending;
}

export function getNavigationState() {
  return { ...navigationState };
}

