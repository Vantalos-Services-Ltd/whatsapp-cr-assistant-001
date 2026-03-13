/**
 * Type definitions for CSCS verification workflow
 */

export type CscsVerificationPayload = {
  candidate: {
    candidateId: string;
    name?: string;
    phone: string;
    desiredRole?: string;
    location?: string;
    availabilityNotes?: string;
  };
  job: {
    jobId: string;
    title: string;
    status?: string;
    clientName?: string;
    siteName?: string;
    addressLine1?: string;
    city?: string;
    postcode?: string;
    startDate?: string;
    durationWeeks?: number;
    payRate?: number;
    chargeRate?: number;
    currency?: string;
    marginPerHour?: number;
    weeklyMargin?: number;
    projectMargin?: number;
  };
  cscs: {
    imageUrl: string;
    source: "WHATSAPP" | "OPERATOR_UPLOAD";
    uploadedAt: string;
    extracted?: {
      holderName?: string;
      cardType?: string;
      expiryDate?: string;
      cardNumber?: string;
    };
    checks: {
      nameMatch?: { ok: boolean; value?: string };
      expiryValid?: { ok: boolean; value?: string };
      overall: "VALID" | "INVALID" | "UNKNOWN";
      issues: string[];
    };
  };
  nextSteps?: {
    approveText: string;
    rejectText: string;
  };
};

