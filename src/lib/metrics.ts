import client from 'prom-client';

// Collect default Node.js metrics (event loop lag, memory, CPU)
client.collectDefaultMetrics({ prefix: 'docuchat_' });

// Custom metrics for DocuChat

// Counter: total number of HTTP requests
export const httpRequestsTotal = new client.Counter({
  name: 'docuchat_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status_code'],
});

// Histogram: request duration distribution
export const httpRequestDuration = new client.Histogram({
  name: 'docuchat_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// Counter: document processing results
export const documentsProcessed = new client.Counter({
  name: 'docuchat_documents_processed_total',
  help: 'Documents processed by the queue worker',
  labelNames: ['status'], // 'success' or 'failed'
});

// Gauge: active queue jobs (goes up and down)
export const activeQueueJobs = new client.Gauge({
  name: 'docuchat_active_queue_jobs',
  help: 'Currently active queue jobs',
  labelNames: ['queue'],
});

// Counter: cache hits and misses
export const cacheOperations = new client.Counter({
  name: 'docuchat_cache_operations_total',
  help: 'Cache operations',
  labelNames: ['operation', 'result'], // get/set, hit/miss
});

// Export the registry for the /metrics endpoint
export const metricsRegistry = client.register;
