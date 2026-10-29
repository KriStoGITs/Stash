import { assert } from './validation.js';

export function requireRole(ctx, roleLabels) {
  assert(ctx.user && roleLabels.includes(ctx.user.role), 'Jums nav tiesību veikt šo darbību.', 403);
}
