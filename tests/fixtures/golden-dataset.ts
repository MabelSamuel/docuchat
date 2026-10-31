export interface GoldenEntry {
  id: string;
  question: string;
  expectedAnswer: string;
  relevantChunkIds: string[];    // Chunks that SHOULD be retrieved
  irrelevantChunkIds: string[];  // Chunks that should NOT appear
  documentId: string;
  category: "factual" | "summary" | "comparison" | "not-in-document";
}
 
export const goldenDataset: GoldenEntry[] = [
  {
    id: "golden-001",
    question: "What is the maximum file upload size?",
    expectedAnswer: "The maximum file upload size is 10MB for free tier users and 50MB for pro tier users.",
    relevantChunkIds: ["chunk-upload-limits-1", "chunk-tier-config-3"],
    irrelevantChunkIds: ["chunk-auth-setup-1", "chunk-rate-limits-2"],
    documentId: "doc-product-spec",
    category: "factual"
  },
  {
    id: "golden-002",
    question: "Who founded the company?",
    expectedAnswer: "",  // Empty = not in document
    relevantChunkIds: [],
    irrelevantChunkIds: [],
    documentId: "doc-product-spec",
    category: "not-in-document"
  },
  {
    id: "golden-003",
    question: "Compare the free and pro tier features.",
    expectedAnswer: "Free tier includes 5 documents and 50 queries per day. Pro tier includes unlimited documents, 500 queries per day, priority processing, and API access.",
    relevantChunkIds: ["chunk-tier-config-3", "chunk-tier-config-4", "chunk-pricing-1"],
    irrelevantChunkIds: ["chunk-auth-setup-1"],
    documentId: "doc-product-spec",
    category: "comparison"
  }
];
