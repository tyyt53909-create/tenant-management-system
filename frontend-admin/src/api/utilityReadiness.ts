import request from '@/utils/request';

export type CollectionMode = 'PREPAY_WITH_SHORTFALL' | 'POSTPAID' | 'DIRECT_TO_PROVIDER';
export interface RuleReview {
  meterId: string;
  contractId?: string;
  responsibility: 'TENANT' | 'OWNER';
  openingReadingId: string;
  closingReadingId: string;
  collectionMode?: CollectionMode;
  rateCents?: string;
  evidence: string;
}
export type RuleConfirmation = RuleReview & { requestId: string; reviewToken: string };
export interface ReadinessIssue { code: string; message: string }
export interface UtilityRulePreview {
  ready: boolean;
  reviewToken: string;
  blockingIssues: ReadinessIssue[];
  billingIssues: ReadinessIssue[];
  financialPreview: {
    usage: string | null;
    rateCents: string | null;
    totalAmount: number | null;
    prepayApplied: number | null;
    receivableAmount: number | null;
    providerAmount: number | null;
  };
}
export interface UtilityReadiness {
  contract: { id: string; contractNumber: string; tenant: { name: string } };
  meters: Array<{
    id: string;
    meterNumber: string;
    meterType: string;
    issues: ReadinessIssue[];
    policy: { version: number; collectionMode: CollectionMode; rateCents: string; evidence: string } | null;
    readings: Array<{ id: string; readingTime: string; currentReading: string }>;
    responsibilityIntervals: Array<{
      id: string; startAt: string; endAt: string; responsibility: 'TENANT' | 'OWNER';
      contractId: string | null; evidence: string;
    }>;
  }>;
}

export const getUtilityReadiness = (id: string): Promise<UtilityReadiness> => request.get(`/utility-readiness/contracts/${id}`);
export const previewUtilityRule = (data: RuleReview): Promise<UtilityRulePreview> => request.post('/utility-readiness/preview', data);
export const confirmUtilityRule = (data: RuleConfirmation) => request.post('/utility-readiness/confirm', data);
