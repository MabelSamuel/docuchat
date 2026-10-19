import axios, { AxiosInstance } from 'axios';

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
  console.log(`→ OpenAI ${config.method?.toUpperCase()} ${config.url}`);
  return config;
});

// Response interceptor: log timing and normalize errors
openaiClient.interceptors.response.use(
  (response) => {
    const startTime = (response.config as any).metadata?.startTime;
    const duration = startTime ? Date.now() - startTime : 0;
    console.log(
      `← OpenAI ${response.status} ${response.config.url} (${duration}ms)`
    );
    return response;
  },
  (error) => {
    const startTime = error.config?.metadata?.startTime;
    const duration = startTime ? Date.now() - startTime : 0;

    if (error.response) {
      // Server responded with error status
      console.error(
        `✕ OpenAI ${error.response.status} ${error.config?.url} (${duration}ms):`,
        error.response.data
      );
    } else if (error.request) {
      // No response received (timeout, network error)
      console.error(
        `✕ OpenAI no response ${error.config?.url} (${duration}ms):`,
        error.message
      );
    } else {
      console.error(`✕ OpenAI request setup error:`, error.message);
    }

    return Promise.reject(error);
  }
);

openaiClient.interceptors.response.use((response) => {
  const remaining = parseInt(
    response.headers['x-ratelimit-remaining-requests'] || '999'
  );

  if (remaining < 50) {
    console.warn(`OpenAI rate limit getting low: ${remaining} remaining`);
  }

  return response;
});

