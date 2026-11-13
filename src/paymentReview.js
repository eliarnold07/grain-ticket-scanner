export const PAYMENT_REVIEW_FILTER = 'needs_review';
export const PAYMENT_REVIEW_STATUSES = ['Not paid', 'Partially paid'];

export function needsPaymentReview(status) {
  return PAYMENT_REVIEW_STATUSES.includes(status);
}
