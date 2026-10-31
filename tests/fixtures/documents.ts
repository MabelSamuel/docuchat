// Source documents for the golden dataset. Chunk IDs here are the ones
// golden-dataset.ts lists as relevant / irrelevant.
export interface DocumentFixture {
  title: string;
  chunks: { id: string; content: string }[];
}

export const documentFixtures = {
  "doc-product-spec": {
    title: "DocuChat Product Specification",
    chunks: [
      {
        id: "chunk-upload-limits-1",
        content: "Upload limits: the maximum file upload size is 10MB for free users. Files over the size limit are rejected."
      },
      {
        id: "chunk-tier-config-3",
        content: "Free tier configuration: maximum upload size 10MB, 5 documents and 50 queries per day."
      },
      {
        id: "chunk-tier-config-4",
        content: "Pro tier features: maximum upload size 50MB, unlimited documents, 500 queries per day, priority processing and API access."
      },
      {
        id: "chunk-pricing-1",
        content: "Pricing: the free tier costs $0. The pro tier costs $29 per month. Compare tiers on the pricing page."
      },
      {
        id: "chunk-auth-setup-1",
        content: "Authentication setup: sign in with email and password. Access tokens expire after 15 minutes."
      },
      {
        id: "chunk-rate-limits-2",
        content: "Rate limits: API requests are throttled per minute. Exceeding the rate returns HTTP 429."
      }
    ]
  },
  "doc-refund-policy": {
    title: "Customer Refund Policy",
    chunks: [
      {
        id: "chunk-refund-1",
        content: "Return policy: return a product within 30 days for a refund."
      },
      {
        id: "chunk-shipping-1",
        content: "Shipping: orders ship within two business days from our warehouse."
      }
    ]
  }
} satisfies Record<string, DocumentFixture>;

export type DocumentFixtureId = keyof typeof documentFixtures;
