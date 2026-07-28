export class AuthorizationError extends Error {
  constructor(message = 'Administrative authorization is required.') {
    super(message);
    this.name = 'AuthorizationError';
    this.status = 403;
  }
}

export function requireAdmin(session) {
  if (!session?.authenticated || session.role !== 'admin') throw new AuthorizationError();
  return true;
}

export function applyAdminAction({ session, resource, action, changes = {}, actorId, now = new Date() }) {
  requireAdmin(session);
  const allowed = ['approve', 'edit', 'reject', 'mark-confirmed', 'mark-uncertain', 'block-source', 'rerun-verification'];
  if (!allowed.includes(action)) throw new Error('Unsupported administrative action.');
  const change = {
    action,
    actorId: String(actorId || session.userId || 'unknown'),
    at: now.toISOString(),
    changes
  };
  return {
    ...resource,
    ...(['edit', 'mark-confirmed', 'mark-uncertain'].includes(action) ? changes : {}),
    reviewStatus: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : resource.reviewStatus,
    changeHistory: [...(resource.changeHistory || []), change]
  };
}
