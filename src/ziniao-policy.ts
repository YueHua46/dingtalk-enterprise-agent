// Shared ziniao command policy sets used by both the dynamic tool (argument
// validation and risk classification) and the broker (lane selection).
// Keep these in one place so the tool layer and the gate can never disagree.

export const ZINIAO_NAMESPACES = new Set([
  'account', 'staff', 'department', 'role', 'device', 'store', 'page', 'automation', 'utility', 'zclaw', 'api'
]);

/** Explicit read-only capabilities: executed without business confirmation. */
export const ZINIAO_READ_CAPABILITIES = new Set([
  'account.list', 'account.auth-list', 'account.auth-users', 'account.tag-list',
  'staff.list', 'department.list', 'role.list', 'role.detail', 'role.staff-roles',
  'role.permissions', 'device.list', 'store.list', 'store.resolve',
  // In-process capability: returns the executor queue snapshot without
  // touching the CLI, the SSH channel, or the machine lock.
  'utility.queue-status'
]);

/**
 * Capabilities eligible for the reserved interleave read lane
 * (ZINIAO_INTERLEAVE_READS=true): read-only commands whose execution never
 * touches the local ZClaw Bridge browser environment.
 */
export const ZINIAO_INTERLEAVE_READ_CAPABILITIES = new Set(
  [...ZINIAO_READ_CAPABILITIES].filter((capability) => {
    const namespace = capability.split('.')[0]!;
    return namespace !== 'store' && capability !== 'utility.queue-status';
  })
);

/** Namespaces served by the local ZClaw Bridge (single browser environment). */
export const ZINIAO_BRIDGE_NAMESPACES = new Set(['store', 'page', 'automation', 'utility', 'zclaw']);
