export type ErrorCategory =
  | "temporary"
  | "permanent"
  | "authentication"
  | "authorization"
  | "rate_limit"
  | "policy"
  | "sender_configuration"
  | "unknown";
export interface ProviderError {
  category: ErrorCategory;
  message: string;
  retryAfterMs?: number;
}
export interface Attachment {
  filename: string;
  content: string;
  contentType: string;
  disposition?: "attachment" | "inline";
  contentId?: string;
}
export interface ProviderMessage {
  from: string;
  fromName: string;
  to: string;
  cc: string[];
  bcc: string[];
  replyTo: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  attachments: Attachment[];
}
export interface SendContext {
  attemptId: string;
  idempotencyKey: string;
  testMode?: boolean;
}
export type SendResult =
  | { status: "accepted"; providerMessageId: string | null }
  | { status: "rejected" | "unknown"; error: ProviderError };
export interface Verification {
  status: string;
  usable: boolean;
  checks: {
    name: string;
    status: "passed" | "failed" | "unknown";
    detail: string;
  }[];
  maxSendRate?: number;
  quotaRemaining?: number;
}
export const safeMessages: Record<ErrorCategory, string> = {
  temporary: "Provider temporarily unavailable.",
  permanent: "The provider rejected this message.",
  authentication: "Credentials were not accepted.",
  authorization: "This key lacks the required permission.",
  rate_limit: "Provider rate limit reached.",
  policy: "Provider enforcement requires account review.",
  sender_configuration: "Verify your sending address and domain.",
  unknown:
    "The provider may have accepted this message. Automatic retry is stopped.",
};