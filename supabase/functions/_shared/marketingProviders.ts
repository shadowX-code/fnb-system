// Server-only adapter boundary. No provider is connected by declaring this interface.
export type MarketingChannel = 'facebook' | 'instagram';
export type PublishingCapability = {
  environment: 'unavailable' | 'test' | 'production';
  authorized: boolean;
  expiresAt: string | null;
  allowedFormats: Array<'text' | 'image' | 'carousel' | 'reel'>;
};
export type PublishIntent = {
  jobId: string; revision: number; channel: MarketingChannel;
  accountId: string; caption: string; format: string; mediaUrls: string[];
};
export type PublishingResult =
  | { outcome: 'published'; providerPostId: string; providerRequestId: string }
  | { outcome: 'uncertain'; errorCode: string }
  | { outcome: 'retryable_failure' | 'permanent_failure'; errorCode: string };
export interface MarketingSocialProvider {
  capability(channel: MarketingChannel): Promise<PublishingCapability>;
  // Official APIs do not universally support an idempotency header. The durable
  // job/container identity and reconciliation must protect uncertain responses.
  publish(intent: PublishIntent): Promise<PublishingResult>;
  reconcile(intent: PublishIntent): Promise<PublishingResult | { outcome: 'not_found'; definitive: boolean }>;
  insights(postId: string): Promise<{ observedAt: string; metrics: Record<string, number | null> }>;
}
export interface MarketingOAuthProvider {
  authorizationUrl(input: { state: string; redirectUri: string; scopes: string[] }): URL;
  exchangeServerSide(code: string, redirectUri: string): Promise<{ credentialReference: string; expiresAt: string; accounts: Array<{ id: string; channel: MarketingChannel }> }>;
}
export interface MarketingMediaProvider {
  capabilities(): Promise<{ image: boolean; video: boolean }>;
  generate(input: { organizationId: string; brandId: string; approvedBrief: string; requestId: string }): Promise<{ providerJobId: string }>;
}
export interface MarketingAIProvider {
  generate(input: { capability: 'planner' | 'creative' | 'reply' | 'ads'; organizationId: string; brandId: string; knowledgeRevision: number; sources: Array<{ reference: string; observedAt: string }>; prompt: string }): Promise<{ text: string; sourceReferences: string[]; model: string; usage: { inputTokens: number; outputTokens: number; cost: number | null; currency: string | null } }>;
}
export const MARKETING_CAPABILITIES = Object.freeze({ oauth: false, publishing: false, socialInsights: false, ai: false, mediaGeneration: false });
export async function executeMarketingPublish(provider: MarketingSocialProvider | null, intent: PublishIntent, now = new Date()): Promise<PublishingResult> {
  if (!provider) return { outcome: 'permanent_failure', errorCode: 'provider_not_configured' };
  const capability = await provider.capability(intent.channel);
  if (capability.environment !== 'production' || !capability.authorized || !capability.expiresAt || Date.parse(capability.expiresAt) <= now.getTime() || !Number.isFinite(Date.parse(capability.expiresAt))) return { outcome: 'permanent_failure', errorCode: 'provider_not_authorized' };
  if (!capability.allowedFormats.includes(intent.format as PublishingCapability['allowedFormats'][number])) return { outcome: 'permanent_failure', errorCode: 'unsupported_format' };
  try {
    const result = await provider.publish(intent);
    if (result.outcome === 'published' && (!result.providerPostId || !result.providerRequestId)) return { outcome: 'uncertain', errorCode: 'missing_provider_evidence' };
    return result;
  } catch {
    // A timeout can occur after the platform accepts the post. Never blindly send again.
    return { outcome: 'uncertain', errorCode: 'provider_response_uncertain' };
  }
}
