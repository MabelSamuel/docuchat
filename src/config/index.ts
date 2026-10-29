export const config = {
  // ... existing config
  hitl: {
    confidenceThreshold: parseFloat(
      process.env.HITL_CONFIDENCE_THRESHOLD || '0.6'
    ),
    escalationEnabled: process.env.HITL_ENABLED !== 'false',
    maxReviewQueueSize: parseInt(
      process.env.HITL_MAX_QUEUE_SIZE || '100'
    ),
    slaMinutes: parseInt(
      process.env.HITL_SLA_MINUTES || '60'
    ),
  },
};