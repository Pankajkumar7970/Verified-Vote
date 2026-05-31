import { ForbiddenError } from "./errors.js";

export const ALLOWED_TRANSITIONS: Record<
  string,
  Record<string, Record<string, string[]>>
> = {
  voting_request: {
    draft: {
      voter: ["pending", "withdrawn"],
      reviewer: [],
      super_admin: [],
    },
    pending: {
      voter: ["withdrawn"],
      reviewer: ["reviewer_approved", "rejected", "under_review"],
      super_admin: [],
    },
    under_review: {
      voter: ["withdrawn"],
      reviewer: ["reviewer_approved", "rejected"],
      super_admin: ["rejected"],
    },
    reviewer_approved: {
      voter: ["withdrawn"],
      reviewer: [],
      super_admin: ["superadmin_approved", "rejected"],
    },
    superadmin_approved: {
      voter: ["withdrawn"],
      reviewer: [],
      super_admin: ["final_approved", "rejected"],
    },
    appealed: {
      voter: ["withdrawn"],
      reviewer: [],
      super_admin: ["appeal_resolved", "appeal_under_review"],
    },
    appeal_under_review: {
      voter: ["withdrawn"],
      reviewer: [],
      super_admin: ["appeal_resolved"],
    },
    final_approved: { voter: [], reviewer: [], super_admin: [] },
    rejected: { voter: ["appealed"], reviewer: [], super_admin: [] },
    appeal_resolved: { voter: [], reviewer: [], super_admin: [] },
    withdrawn: { voter: [], reviewer: [], super_admin: [] },
  },
  election: {
    draft: {
      super_admin: ["active"],
    },
    active: {
      super_admin: ["voting"],
    },
    voting: {
      super_admin: ["results_published"],
    },
    results_published: {
      super_admin: [],
    },
  },
};

export function canTransition(
  entityType: string,
  currentStatus: string,
  newStatus: string,
  actorRole: string,
): boolean {
  const roleTransitions =
    ALLOWED_TRANSITIONS[entityType]?.[currentStatus]?.[actorRole];
  if (!roleTransitions) {
    return false; // Invalid entity type, current status, or role
  }
  return roleTransitions.includes(newStatus);
}

export function validateStatusTransition(
  entityType: string,
  oldStatus: string,
  newStatus: string,
  actorRole: string,
  entityId: string,
) {
  if (!canTransition(entityType, oldStatus, newStatus, actorRole)) {
    throw new ForbiddenError(
      `Role '${actorRole}' cannot transition ${entityType} '${entityId}' from '${oldStatus}' to '${newStatus}'`,
    );
  }
}
