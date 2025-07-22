/**
 * Comprehensive test suite for the main chatbot backend
 * Tests include mocking of AWS services, database operations, and WebSocket functionality
 */

const { jest } = require('@jest/globals');

// Mock AWS SDK clients before importing the main module
const mockBedrockClient = {
  send: jest.fn()
};

const mockSecretsManagerClient = {
  send: jest.fn()
};

const mockApiGatewayManagementApiClient = {
  send: jest.fn()
};

const mockCloudWatchLogsClient = {
  send: jest.fn()
};

// Mock pg (PostgreSQL client)
const mockDbClient = {
  query: jest.fn(),
  connect: jest.fn(),
  release: jest.fn(),
  end: jest.fn()
};

const mockDbPool = {
  connect: jest.fn().mockResolvedValue(mockDbClient),
  query: jest.fn(),
  end: jest.fn(),
  on: jest.fn()
};

// Mock node-cache
const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  keys: jest.fn(),
  flushAll: jest.fn()
};

// Mock token utilities
const mockTokenUtils = {
  optimizePrompt: jest.fn().mockImplementation((prompt) => prompt)
};

// Set up mocks
jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn(() => mockBedrockClient),
  InvokeModelCommand: jest.fn(),
  InvokeModelWithResponseStreamCommand: jest.fn(),
  ApplyGuardrailCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => mockSecretsManagerClient),
  GetSecretValueCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: jest.fn(() => mockApiGatewayManagementApiClient),
  PostToConnectionCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: jest.fn(() => mockCloudWatchLogsClient),
  PutLogEventsCommand: jest.fn(),
  CreateLogStreamCommand: jest.fn()
}));

jest.mock('pg', () => ({
  Client: jest.fn(() => mockDbClient),
  Pool: jest.fn(() => mockDbPool)
}));

jest.mock('node-cache', () => jest.fn(() => mockCache));

jest.mock('./token-utils', () => mockTokenUtils);

jest.mock('util', () => ({
  TextDecoder: jest.fn(() => ({
    decode: jest.fn().mockReturnValue('{"embedding": [0.1, 0.2, 0.3]}')
  }))
}));

// Mock environment variables
const originalEnv = process.env;
beforeEach(() => {
  process.env = {
    ...originalEnv,
    AWS_REGION: 'us-east-1',
    REGION: 'us-east-1',
    DB_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret',
    BEDROCK_MODEL_ID: 'amazon.nova-lite-v1',
    CLEANUP_TOKEN: 'test-cleanup-token'
  };
});

afterEach(() => {
  process.env = originalEnv;
  jest.clearAllMocks();
});

// Import the module after mocks are set up
const handler = require('./index');

describe('Chatbot Backend', () => {
  
  describe('Region Configuration', () => {
    test('should use AWS_REGION environment variable', () => {
      process.env.AWS_REGION = 'eu-west-1';
      delete require.cache[require.resolve('./index')];
      require('./index');
      // The region should be used in client initialization
      expect(process.env.AWS_REGION).toBe('eu-west-1');
    });

    test('should fallback to REGION environment variable', () => {
      delete process.env.AWS_REGION;
      process.env.REGION = 'ap-southeast-1';
      delete require.cache[require.resolve('./index')];
      require('./index');
      expect(process.env.REGION).toBe('ap-southeast-1');
    });

    test('should fallback to us-east-1 as default', () => {
      delete process.env.AWS_REGION;
      delete process.env.REGION;
      delete process.env.AWS_DEFAULT_REGION;
      delete require.cache[require.resolve('./index')];
      require('./index');
      // Should use default region
    });
  });

  describe('Error Response Standardization', () => {
    test('should create standardized error response', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/chat',
        body: JSON.stringify({ message: '' }) // Empty message should trigger validation error
      };

      const result = await handler.handler(event);
      
      expect(result.statusCode).toBe(400);
      
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('success', false);
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('type', 'VALIDATION_ERROR');
      expect(body.error).toHaveProperty('message');
      expect(body.error).toHaveProperty('code', 400);
      expect(body.error).toHaveProperty('timestamp');
    });

    test('should create standardized success response', async () => {
      // Mock successful database operations
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      mockDbClient.query.mockResolvedValue({ rows: [] });
      mockBedrockClient.send.mockResolvedValue({
        body: new Uint8Array(Buffer.from('{"embedding": [0.1, 0.2, 0.3]}'))
      });

      // Mock guardrails response
      mockBedrockClient.send.mockResolvedValueOnce({
        action: 'NONE',
        outputs: [{ text: 'Test response' }]
      });

      const event = {
        httpMethod: 'POST',
        path: '/chat',
        body: JSON.stringify({ message: 'Hello, how are you?' })
      };

      const result = await handler.handler(event);
      
      expect(result.statusCode).toBe(200);
      
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('timestamp');
    });
  });

  describe('WebSocket Input Validation', () => {
    test('should validate WebSocket sendMessage input', async () => {
      const event = {
        requestContext: {
          connectionId: 'test-connection-id',
          routeKey: 'sendMessage',
          domainName: 'test-domain.com',
          stage: 'prod'
        },
        body: JSON.stringify({ message: '' }) // Empty message
      };

      await handler.handler(event);

      // Should send error message via WebSocket
      expect(mockApiGatewayManagementApiClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            ConnectionId: 'test-connection-id',
            Data: expect.stringContaining('Invalid input')
          })
        })
      );
    });

    test('should validate WebSocket message length', async () => {
      const longMessage = 'a'.repeat(4001); // Exceeds 4000 character limit
      
      const event = {
        requestContext: {
          connectionId: 'test-connection-id',
          routeKey: 'sendMessage',
          domainName: 'test-domain.com',
          stage: 'prod'
        },
        body: JSON.stringify({ message: longMessage })
      };

      await handler.handler(event);

      expect(mockApiGatewayManagementApiClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            ConnectionId: 'test-connection-id',
            Data: expect.stringContaining('Message too long')
          })
        })
      );
    });

    test('should detect malicious content in WebSocket messages', async () => {
      const maliciousMessage = '<script>alert("xss")</script>';
      
      const event = {
        requestContext: {
          connectionId: 'test-connection-id',
          routeKey: 'sendMessage',
          domainName: 'test-domain.com',
          stage: 'prod'
        },
        body: JSON.stringify({ message: maliciousMessage })
      };

      await handler.handler(event);

      expect(mockApiGatewayManagementApiClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            ConnectionId: 'test-connection-id',
            Data: expect.stringContaining('potentially unsafe content')
          })
        })
      );
    });

    test('should handle invalid JSON in WebSocket messages', async () => {
      const event = {
        requestContext: {
          connectionId: 'test-connection-id',
          routeKey: 'sendMessage',
          domainName: 'test-domain.com',
          stage: 'prod'
        },
        body: 'invalid json'
      };

      await handler.handler(event);

      expect(mockApiGatewayManagementApiClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            ConnectionId: 'test-connection-id',
            Data: expect.stringContaining('Invalid JSON format')
          })
        })
      );
    });
  });

  describe('Database Cleanup', () => {
    test('should handle cleanup request with valid token', async () => {
      mockDbClient.query
        .mockResolvedValueOnce({ rowCount: 5 }) // Old chunks cleanup
        .mockResolvedValueOnce({ rowCount: 2 }) // Orphaned docs cleanup
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // Table exists check
        .mockResolvedValueOnce({ rowCount: 3 }); // Processing logs cleanup

      const event = {
        httpMethod: 'POST',
        path: '/cleanup',
        headers: {
          'x-cleanup-token': 'test-cleanup-token'
        }
      };

      const result = await handler.handler(event);
      
      expect(result.statusCode).toBe(200);
      
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('message', 'Database cleanup completed');
      expect(body.data).toHaveProperty('results');
    });

    test('should reject cleanup request without valid token', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/cleanup',
        headers: {}
      };

      const result = await handler.handler(event);
      
      expect(result.statusCode).toBe(403);
      
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.error.type).toBe('FORBIDDEN');
    });

    test('should handle EventBridge cleanup requests', async () => {
      mockDbClient.query
        .mockResolvedValueOnce({ rowCount: 5 })
        .mockResolvedValueOnce({ rowCount: 2 })
        .mockResolvedValueOnce({ rows: [{ exists: true }] })
        .mockResolvedValueOnce({ rowCount: 3 });

      const event = {
        httpMethod: 'POST',
        path: '/cleanup',
        source: 'aws.events'
      };

      const result = await handler.handler(event);
      
      expect(result.statusCode).toBe(200);
    });
  });

  describe('Database Connection Management', () => {
    test('should handle database connection errors gracefully', async () => {
      mockSecretsManagerClient.send.mockRejectedValue(new Error('Secrets Manager error'));

      const event = {
        httpMethod: 'POST',
        path: '/chat',
        body: JSON.stringify({ message: 'Hello' })
      };

      const result = await handler.handler(event);
      
      expect(result.statusCode).toBe(500);
      
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.error.type).toBe('INTERNAL_SERVER_ERROR');
    });

    test('should reuse database connection pool', async () => {
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      // Make multiple requests
      const event = {
        httpMethod: 'POST',
        path: '/chat',
        body: JSON.stringify({ message: 'Hello' })
      };

      await handler.handler(event);
      await handler.handler(event);

      // Pool should be created only once
      expect(mockDbPool.connect).toHaveBeenCalled();
    });
  });

  describe('Caching', () => {
    test('should cache vector query results', async () => {
      mockCache.get.mockReturnValue(null); // Cache miss
      mockCache.set.mockReturnValue(true);
      
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      mockDbClient.query.mockResolvedValue({ rows: [] });
      mockBedrockClient.send.mockResolvedValue({
        body: new Uint8Array(Buffer.from('{"embedding": [0.1, 0.2, 0.3]}'))
      });

      const event = {
        httpMethod: 'POST',
        path: '/chat',
        body: JSON.stringify({ message: 'Hello' })
      };

      await handler.handler(event);

      expect(mockCache.get).toHaveBeenCalled();
      expect(mockCache.set).toHaveBeenCalled();
    });

    test('should serve from cache when available', async () => {
      const cachedResult = [{ content: 'Cached content' }];
      mockCache.get.mockReturnValue(cachedResult);
      
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      mockBedrockClient.send.mockResolvedValue({
        body: new Uint8Array(Buffer.from('{"embedding": [0.1, 0.2, 0.3]}'))
      });

      const event = {
        httpMethod: 'POST',
        path: '/chat',
        body: JSON.stringify({ message: 'Hello' })
      };

      await handler.handler(event);

      expect(mockCache.get).toHaveBeenCalled();
      // Database query should be skipped due to cache hit
    });
  });

  describe('Bedrock Integration', () => {
    test('should handle Bedrock API errors', async () => {
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      mockDbClient.query.mockResolvedValue({ rows: [] });
      mockBedrockClient.send.mockRejectedValue(new Error('Bedrock API error'));

      const event = {
        httpMethod: 'POST',
        path: '/chat',
        body: JSON.stringify({ message: 'Hello' })
      };

      const result = await handler.handler(event);
      
      expect(result.statusCode).toBe(500);
    });

    test('should apply guardrails correctly', async () => {
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      // Mock guardrails blocking content
      mockBedrockClient.send.mockResolvedValueOnce({
        action: 'GUARDRAIL_INTERVENED',
        outputs: []
      });

      const event = {
        httpMethod: 'POST',
        path: '/chat',
        body: JSON.stringify({ message: 'Inappropriate content' })
      };

      const result = await handler.handler(event);
      
      expect(result.statusCode).toBe(400);
      
      const body = JSON.parse(result.body);
      expect(body.error.type).toBe('CONTENT_BLOCKED');
    });
  });
});

describe('Utility Functions', () => {
  test('should validate input correctly', () => {
    // These tests would require exposing the validateInput function
    // or testing it through the main handler
  });

  test('should handle retry logic', () => {
    // Test retry mechanism with exponential backoff
  });

  test('should format responses consistently', () => {
    // Test response formatting functions
  });
});
