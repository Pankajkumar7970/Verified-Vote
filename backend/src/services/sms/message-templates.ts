import { config } from '../../utils/config.js';

type TemplateContext = {
  otp?: string;
  refCode?: string;
  receiptToken?: string;
  electionName?: string;
};

const templates: Record<string, (ctx: TemplateContext) => string> = {
  auth_otp: (ctx) =>
    `VerifiedVote OTP: ${ctx.otp}. Valid for 10 minutes. Do not share.`,
  voting_otp: (ctx) =>
    `VerifiedVote voting OTP: ${ctx.otp}. Valid for 10 minutes. Do not share.`,
  voting_link_issued: (ctx) =>
    `Your VerifiedVote voting link: ${config.appUrl}/vote?ref=${ctx.refCode}`,
  request_submitted: () =>
    `VerifiedVote: Your postal ballot request was received and is under review.`,
  request_approved: () =>
    `VerifiedVote: Your voting authorization was approved. You will receive a voting link before election day.`,
  request_rejected: () =>
    `VerifiedVote: Your request was not approved. You may appeal from your voter portal.`,
  vote_cast_success: (ctx) =>
    `VerifiedVote: Your vote was recorded. Receipt: ${ctx.receiptToken}. Verify at ${config.appUrl}/verify-receipt`,
  appeal_submitted: () =>
    `VerifiedVote: Your appeal was received and is under review.`,
  appeal_resolved: () =>
    `VerifiedVote: Your appeal has been resolved. Check your voter portal for details.`,
};

export function buildSmsMessage(type: string, ctx: TemplateContext = {}): string {
  const fn = templates[type];
  if (!fn) {
    return `VerifiedVote: You have an update regarding your account (${type}).`;
  }
  return fn(ctx);
}
