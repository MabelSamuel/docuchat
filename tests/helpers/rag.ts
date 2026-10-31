import { prisma } from "../../src/lib/prisma";
import { computeConfidence } from "../../src/services/confidence.service";
import { assembleContext, generateRAGResponse } from "../../src/services/rag.service";
import { semanticSearch } from "../../src/services/search.service";

const correlationId = "rag-test";

async function documentOwner(documentId: string): Promise<string> {
  const document = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
    select: { userId: true }
  });
  return document.userId;
}

// Retrieval step of the RAG pipeline, scoped to one document as its owner
export async function retrieveChunks(
  query: string,
  documentId: string,
  options: { topK?: number } = {}
) {
  return semanticSearch({
    query,
    userId: await documentOwner(documentId),
    documentId,
    topK: options.topK ?? 5,
    correlationId
  });
}

// Retrieve → score confidence → generate, as chat.service does minus persistence
export async function queryDocument(question: string, documentId: string) {
  const userId = await documentOwner(documentId);
  const chunks = await retrieveChunks(question, documentId);
  const confidence = computeConfidence(chunks);

  const response = await generateRAGResponse({
    question,
    context: assembleContext(chunks),
    userId,
    conversationId: "rag-test-conversation",
    correlationId
  });

  return { ...response, confidence: confidence.score, chunks };
}
