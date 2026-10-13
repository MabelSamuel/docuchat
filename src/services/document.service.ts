import { DOC_EVENTS } from "../events/document.events";
import { NotFoundError } from "../lib/errors";
import { appEvents } from "../lib/events";
import { prisma } from "../lib/prisma";

interface ListDocumentsOptions {
  page: number;
  limit: number;
  status?: string;
  search?: string;
  sortBy?: "createdAt" | "title" | "chunkCount";
  sortOrder?: "asc" | "desc";
}

export async function listDocuments(
  userId: string,
  options: ListDocumentsOptions,
) {
  const {
    page,
    limit,
    status,
    search,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = options;

  // Build the where clause dynamically
  const where: any = {
    userId,
    deletedAt: null, // Soft delete filter (we'll add this today)
  };

  if (status) {
    where.status = status;
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  const [documents, total] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        title: true,
        filename: true,
        status: true,
        chunkCount: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.document.count({ where }),
  ]);

  return {
    data: documents,
    meta: { page, limit, total },
  };
}

export async function createDocument(
  userId: string,
  data: { title: string; content: string },
) {
  const doc = await prisma.document.create({
    data: { userId, title: data.title, content: data.content },
  });

  appEvents.emit(DOC_EVENTS.CREATED, {
    userId,
    documentId: doc.id,
    title: doc.title,
    fileSizeBytes: Buffer.byteLength(data.content),
  });
  return doc;
}

export async function deleteDocument(documentId: string, userId: string) {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!doc || doc.deletedAt) {
    throw new NotFoundError("Document not found");
  }

  // Ownership check
  if (doc.userId !== userId) {
    throw new NotFoundError("Document not found");
  }

  appEvents.emit(DOC_EVENTS.DELETED, {
    deletedBy: userId,
    documentId: doc.id,
    title: doc.title,
  });
  return prisma.document.update({
    where: { id: documentId },
    data: {
      deletedAt: new Date(),
      deletedBy: userId,
    },
  });

}
