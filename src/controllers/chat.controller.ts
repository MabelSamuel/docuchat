import { Request, Response } from "express";
import * as conversationService from "../services/conversation.service";
import * as chatService from "../services/chat.service";

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
    correlationId: (req as any).correlationId,
  });
  res.status(201).json({ success: true, data: message });
}

// Confidence-routed Q&A: low-confidence answers go to the review queue
export async function askQuestion(req: Request, res: Response) {
  const result = await chatService.askQuestion({
    conversationId: req.params.id as string,
    userId: req.user!.id,
    question: req.body.question,
    documentId: req.body.documentId,
    correlationId: (req as any).correlationId,
  });
  const status = 'status' in result ? 202 : 201;
  res.status(status).json({ success: true, data: result });
}
