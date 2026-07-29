export const PAGE_ROUTES = Object.freeze({
  home: 'home',
  find: 'find-help',
  nationwide: 'nationwide',
  eligibility: 'eligibility',
  actionPlan: 'action-plan',
  registration: 'registration',
  saved: 'saved',
  privacy: 'privacy'
});

export function hashForPage(page) {
  return `#/${PAGE_ROUTES[page] || PAGE_ROUTES.home}`;
}

export function pageFromHash(hash = '') {
  const route = String(hash)
    .replace(/^#\/?/, '')
    .split(/[/?#]/)[0]
    .trim()
    .toLowerCase();
  if (!route) return 'home';
  return Object.entries(PAGE_ROUTES)
    .find(([, value]) => value === route)?.[0] || 'home';
}

export function isCurrentPage(currentPage, targetPage) {
  return currentPage === targetPage;
}
