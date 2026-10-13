import { Request, Response } from "express";
import { NotFoundError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import * as documentService from "../services/document.service";
import { getUserPermissions } from "../services/rbac.service";

export async function getDocument(req: Request, res: Response) {
  const doc = await prisma.document.findUnique({
    where: { id: req.params.id as string },
  });

  if (!doc || doc.deletedAt) {
    throw new NotFoundError('Document not found');
  }

  // Resource ownership check
  if (doc.userId !== req.user!.id) {
    // Admins can see everything
    const permissions = await getUserPermissions(req.user!.id);
    if (!permissions.has('users:manage')) {
      throw new NotFoundError('Document not found');
    }
  }

  res.json({ success: true, data: doc });
}

export async function listDocuments(req: Request, res: Response) {
  const result = await documentService.listDocuments(req.user!.id, req.query as any);
  res.json({ success: true, ...result });
}

export async function createDocument(req: Request, res: Response) {
  const doc = await documentService.createDocument(req.user!.id, req.body);
  res.status(201).json({ success: true, data: doc });
}

export async function deleteDocument(req: Request, res: Response) {
  await documentService.deleteDocument(req.params.id as string, req.user!.id);
  res.status(204).send();
}
