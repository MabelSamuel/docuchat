import axios, { AxiosInstance } from 'axios';
import { logger } from '../logger';

export const openaiClient: AxiosInstance = axios.create({
  baseURL: 'https://api.openai.com/v1',
  timeout: 30000, // 30 seconds for AI responses
  headers: {
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
    'User-Agent': 'DocuChat/1.0',
  },
});

openaiClient.interceptors.request.use((config) => {
  const startTime = Date.now();
  (config as any).metadata = { startTime };
  logger.debug('OpenAI request', {
    method: config.method?.toUpperCase(),
    url: config.url,
  });
  return config;
});

// Response interceptor: log timing and normalize errors
openaiClient.interceptors.response.use(
  (response) => {
    const startTime = (response.config as any).metadata?.startTime;
    const duration = startTime ? Date.now() - startTime : 0;
    logger.debug('OpenAI response', {
      status: response.status,
      url: response.config.url,
      durationMs: duration,
    });
    return response;
  },
  (error) => {
    const startTime = error.config?.metadata?.startTime;
    const duration = startTime ? Date.now() - startTime : 0;

    if (error.response) {
      // Server responded with error status
      logger.error('OpenAI error response', {
        status: error.response.status,
        url: error.config?.url,
        durationMs: duration,
        responseData: error.response.data,
      });
    } else if (error.request) {
      // No response received (timeout, network error)
      logger.error('OpenAI no response', {
        url: error.config?.url,
        durationMs: duration,
        error: error.message,
      });
    } else {
      logger.error('OpenAI request setup error', { error: error.message });
    }

    return Promise.reject(error);
  }
);

openaiClient.interceptors.response.use((response) => {
  const remaining = parseInt(
    response.headers['x-ratelimit-remaining-requests'] || '999'
  );

  if (remaining < 50) {
    logger.warn('OpenAI rate limit getting low', { remaining });
  }

  return response;
});
