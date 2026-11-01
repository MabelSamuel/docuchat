import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'DocuChat API',
      version: '1.0.0',
      description: 'AI-Powered Document Q&A System',
    },
    servers: [
      { url: '/api/v1', description: 'Version 1' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'NOT_FOUND' },
                message: { type: 'string', example: 'Resource not found' },
              },
            },
          },
        },
        Message: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: {
              type: 'object',
              properties: { message: { type: 'string' } },
            },
          },
        },
        AuthUser: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string', format: 'email' },
            tier: { type: 'string', example: 'free' },
          },
        },
        TokenPair: {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
          },
        },
        PublicUser: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string', nullable: true },
            email: { type: 'string', format: 'email' },
            tier: { type: 'string' },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            limit: { type: 'integer' },
            total: { type: 'integer' },
          },
        },
      },
      parameters: {
        IdParam: {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
        PageParam: {
          name: 'page',
          in: 'query',
          schema: { type: 'integer', minimum: 1, default: 1 },
        },
        LimitParam: {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
      responses: {
        ValidationError: {
          description: 'Validation error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Unauthorized: {
          description: 'Missing or invalid access token',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Forbidden: {
          description: 'Insufficient permissions',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        NotFound: {
          description: 'Resource not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        RateLimited: {
          description: 'Rate limit exceeded',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
    tags: [
      { name: 'Authentication', description: 'Registration, login and token management' },
      { name: 'Documents', description: 'Upload and manage documents' },
      { name: 'Chat', description: 'Conversations and document Q&A' },
      { name: 'Agent', description: 'Multi-step research agent' },
      { name: 'Reviews', description: 'Human-in-the-loop review queue (reviews:manage)' },
      { name: 'Users', description: 'User accounts' },
      { name: 'Admin', description: 'Roles and analytics (roles:manage)' },
    ],
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
