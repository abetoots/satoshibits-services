/**
 * Job data structure for email notifications
 * See: packages/queue/README.md#typescript-support
 */
export interface EmailJobData {
  email: string;
  userId: string;

  // ✅ SMALL PAYLOADS: Store large data externally, pass URL reference
  // See: packages/queue/README.md#mistake-6-putting-large-payloads-in-queue
  attachmentUrl?: string;  // URL to fetch attachment from S3/storage, NOT the attachment data itself

  // For demo purposes - simulates different error types
  errorType?: 'transient' | 'permanent';
}

/**
 * Email sending result
 */
export interface EmailResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}
