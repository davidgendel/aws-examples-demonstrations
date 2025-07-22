/**
 * Jest setup file for global test configuration
 * Sets up common mocks and test utilities
 */

const { jest } = require('@jest/globals');

// Global test timeout
jest.setTimeout(30000);

// Mock console methods globally to reduce noise in tests
global.console = {
  ...console,
  // Uncomment to suppress console output during tests
  // log: jest.fn(),
  // error: jest.fn(),
  // warn: jest.fn(),
  // info: jest.fn(),
  // debug: jest.fn()
};

// Global mock for AWS region
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.REGION = process.env.REGION || 'us-east-1';

// Mock AWS SDK clients globally
const mockAWSClients = {
  BedrockRuntimeClient: jest.fn(),
  SecretsManagerClient: jest.fn(),
  S3Client: jest.fn(),
  TextractClient: jest.fn(),
  ApiGatewayManagementApiClient: jest.fn(),
  CloudWatchLogsClient: jest.fn()
};

// Global AWS SDK mocks
jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: mockAWSClients.BedrockRuntimeClient,
  InvokeModelCommand: jest.fn(),
  InvokeModelWithResponseStreamCommand: jest.fn(),
  ApplyGuardrailCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: mockAWSClients.SecretsManagerClient,
  GetSecretValueCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: mockAWSClients.S3Client,
  GetObjectCommand: jest.fn(),
  PutObjectCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-textract', () => ({
  TextractClient: mockAWSClients.TextractClient,
  AnalyzeDocumentCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: mockAWSClients.ApiGatewayManagementApiClient,
  PostToConnectionCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: mockAWSClients.CloudWatchLogsClient,
  PutLogEventsCommand: jest.fn(),
  CreateLogStreamCommand: jest.fn()
}));

// Global database mocks
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

jest.mock('pg', () => ({
  Client: jest.fn(() => mockDbClient),
  Pool: jest.fn(() => mockDbPool)
}));

// Global cache mock
const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  keys: jest.fn(),
  flushAll: jest.fn()
};

jest.mock('node-cache', () => jest.fn(() => mockCache));

// Global utility mocks
jest.mock('util', () => ({
  TextDecoder: jest.fn(() => ({
    decode: jest.fn().mockReturnValue('{"embedding": [0.1, 0.2, 0.3]}')
  }))
}));

// Test utilities
global.testUtils = {
  // Helper to create mock AWS responses
  createMockAWSResponse: (data) => ({
    promise: () => Promise.resolve(data),
    send: () => Promise.resolve(data)
  }),
  
  // Helper to create mock database responses
  createMockDbResponse: (rows = [], rowCount = 0) => ({
    rows,
    rowCount
  }),
  
  // Helper to create mock S3 events
  createMockS3Event: (bucket, key) => ({
    Records: [{
      eventSource: 'aws:s3',
      s3: {
        bucket: { name: bucket },
        object: { key: key }
      }
    }]
  }),
  
  // Helper to create mock WebSocket events
  createMockWebSocketEvent: (connectionId, routeKey, body = {}) => ({
    requestContext: {
      connectionId,
      routeKey,
      domainName: 'test-domain.com',
      stage: 'test'
    },
    body: JSON.stringify(body)
  }),
  
  // Helper to create mock API Gateway events
  createMockAPIGatewayEvent: (httpMethod, path, body = {}) => ({
    httpMethod,
    path,
    body: JSON.stringify(body),
    headers: {},
    requestContext: {}
  }),
  
  // Helper to wait for async operations
  waitFor: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Helper to assert error responses
  assertErrorResponse: (response, statusCode, errorType) => {
    expect(response.statusCode).toBe(statusCode);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.type).toBe(errorType);
    expect(body.error).toHaveProperty('timestamp');
  },
  
  // Helper to assert success responses
  assertSuccessResponse: (response, statusCode = 200) => {
    expect(response.statusCode).toBe(statusCode);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('timestamp');
  }
};

// Global test data
global.testData = {
  validMessage: 'Hello, how can you help me?',
  longMessage: 'a'.repeat(4001),
  maliciousMessage: '<script>alert("xss")</script>',
  
  mockDbCredentials: {
    host: 'localhost',
    port: 5432,
    dbname: 'testdb',
    username: 'testuser',
    password: 'testpass'
  },
  
  mockEmbedding: [0.1, 0.2, 0.3, 0.4, 0.5],
  
  mockDocumentChunks: [
    {
      id: 1,
      content: 'This is a test document chunk',
      embedding: [0.1, 0.2, 0.3],
      document_title: 'Test Document'
    }
  ]
};

// Cleanup after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Global error handler for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Global error handler for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});
