import { Request, Response } from "express";
import * as conversationService from "../services/conversation.service";

export async function listConversations(req: Request, res: Response) {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const result = await conversationService.listConversations(req.user!.id, { page, limit });
  res.json({ success: true, ...result });
}

export async function sendMessage(req: Request, res: Response) {
  const message = await conversationService.sendMessage({
    conversationId: req.params.id as string,
    userId: req.user!.id,
    content: req.body.content,
    documentId: req.body.documentId,
  });
  res.status(201).json({ success: true, data: message });
}
