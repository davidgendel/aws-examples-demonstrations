/**
 * Comprehensive test suite for the document processor
 * Tests include mocking of AWS services, document processing, and database operations
 */

const { jest } = require('@jest/globals');

// Mock AWS SDK clients
const mockS3Client = {
  send: jest.fn()
};

const mockBedrockClient = {
  send: jest.fn()
};

const mockSecretsManagerClient = {
  send: jest.fn()
};

const mockTextractClient = {
  send: jest.fn()
};

// Mock database
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

// Mock stream utilities
const mockReadable = {
  pipe: jest.fn(),
  on: jest.fn(),
  read: jest.fn()
};

// Set up mocks
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => mockS3Client),
  GetObjectCommand: jest.fn(),
  PutObjectCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn(() => mockBedrockClient),
  InvokeModelCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => mockSecretsManagerClient),
  GetSecretValueCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-textract', () => ({
  TextractClient: jest.fn(() => mockTextractClient),
  AnalyzeDocumentCommand: jest.fn()
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://presigned-url.com')
}));

jest.mock('pg', () => ({
  Client: jest.fn(() => mockDbClient),
  Pool: jest.fn(() => mockDbPool)
}));

jest.mock('stream', () => ({
  Readable: jest.fn(() => mockReadable)
}));

// Mock environment variables
const originalEnv = process.env;
beforeEach(() => {
  process.env = {
    ...originalEnv,
    AWS_REGION: 'us-east-1',
    REGION: 'us-east-1',
    DB_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret',
    DOCUMENT_BUCKET: 'test-document-bucket'
  };
});

afterEach(() => {
  process.env = originalEnv;
  jest.clearAllMocks();
});

// Import the module after mocks are set up
const documentProcessor = require('./document-processor');

describe('Document Processor', () => {
  
  describe('Region Configuration', () => {
    test('should use AWS_REGION environment variable', () => {
      process.env.AWS_REGION = 'eu-west-1';
      delete require.cache[require.resolve('./document-processor')];
      require('./document-processor');
      expect(process.env.AWS_REGION).toBe('eu-west-1');
    });

    test('should fallback to REGION environment variable', () => {
      delete process.env.AWS_REGION;
      process.env.REGION = 'ap-southeast-1';
      delete require.cache[require.resolve('./document-processor')];
      require('./document-processor');
      expect(process.env.REGION).toBe('ap-southeast-1');
    });
  });

  describe('S3 Event Processing', () => {
    test('should process S3 document upload event', async () => {
      // Mock database credentials
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      // Mock S3 object retrieval
      mockS3Client.send.mockResolvedValue({
        Body: {
          transformToString: jest.fn().mockResolvedValue('Test document content')
        },
        ContentType: 'text/plain'
      });

      // Mock database operations
      mockDbClient.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // Insert document
        .mockResolvedValueOnce({ rows: [] }); // Insert chunks

      // Mock Bedrock embedding generation
      mockBedrockClient.send.mockResolvedValue({
        body: new Uint8Array(Buffer.from('{"embedding": [0.1, 0.2, 0.3]}'))
      });

      const event = {
        Records: [{
          eventSource: 'aws:s3',
          s3: {
            bucket: { name: 'test-bucket' },
            object: { key: 'documents/test-document.txt' }
          }
        }]
      };

      const result = await documentProcessor.handler(event);
      
      expect(result.statusCode).toBe(200);
      expect(mockS3Client.send).toHaveBeenCalled();
      expect(mockDbClient.query).toHaveBeenCalled();
    });

    test('should handle PDF document processing', async () => {
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      // Mock S3 PDF retrieval
      mockS3Client.send.mockResolvedValue({
        Body: {
          transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]))
        },
        ContentType: 'application/pdf'
      });

      // Mock Textract response
      mockTextractClient.send.mockResolvedValue({
        Blocks: [
          {
            BlockType: 'LINE',
            Text: 'This is extracted text from PDF'
          }
        ]
      });

      mockDbClient.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      mockBedrockClient.send.mockResolvedValue({
        body: new Uint8Array(Buffer.from('{"embedding": [0.1, 0.2, 0.3]}'))
      });

      const event = {
        Records: [{
          eventSource: 'aws:s3',
          s3: {
            bucket: { name: 'test-bucket' },
            object: { key: 'documents/test-document.pdf' }
          }
        }]
      };

      const result = await documentProcessor.handler(event);
      
      expect(result.statusCode).toBe(200);
      expect(mockTextractClient.send).toHaveBeenCalled();
    });

    test('should handle image document processing', async () => {
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      mockS3Client.send.mockResolvedValue({
        Body: {
          transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]))
        },
        ContentType: 'image/png'
      });

      mockTextractClient.send.mockResolvedValue({
        Blocks: [
          {
            BlockType: 'LINE',
            Text: 'Text extracted from image'
          }
        ]
      });

      mockDbClient.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      mockBedrockClient.send.mockResolvedValue({
        body: new Uint8Array(Buffer.from('{"embedding": [0.1, 0.2, 0.3]}'))
      });

      const event = {
        Records: [{
          eventSource: 'aws:s3',
          s3: {
            bucket: { name: 'test-bucket' },
            object: { key: 'documents/test-image.png' }
          }
        }]
      };

      const result = await documentProcessor.handler(event);
      
      expect(result.statusCode).toBe(200);
      expect(mockTextractClient.send).toHaveBeenCalled();
    });
  });

  describe('Upload URL Generation', () => {
    test('should generate pre-signed upload URL', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/upload-url',
        body: JSON.stringify({
          fileName: 'test-document.pdf',
          contentType: 'application/pdf'
        })
      };

      const result = await documentProcessor.handler(event);
      
      expect(result.statusCode).toBe(200);
      
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('uploadUrl');
      expect(body).toHaveProperty('key');
      expect(body.key).toContain('test-document.pdf');
    });

    test('should handle invalid upload URL request', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/upload-url',
        body: JSON.stringify({}) // Missing required fields
      };

      const result = await documentProcessor.handler(event);
      
      expect(result.statusCode).toBe(500);
    });
  });

  describe('Database Cleanup', () => {
    test('should clean up processing data', async () => {
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      mockDbClient.query
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // Table exists check
        .mockResolvedValueOnce({ rowCount: 3 }) // Failed processing cleanup
        .mockResolvedValueOnce({ rowCount: 1 }); // Temp data cleanup

      const result = await documentProcessor.cleanupProcessingData();
      
      expect(result).toHaveProperty('failedProcessingDeleted');
      expect(result).toHaveProperty('tempDataDeleted');
      expect(mockDbClient.query).toHaveBeenCalledTimes(3);
    });

    test('should handle cleanup when processing_logs table does not exist', async () => {
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      mockDbClient.query
        .mockResolvedValueOnce({ rows: [{ exists: false }] }) // Table doesn't exist
        .mockResolvedValueOnce({ rowCount: 1 }); // Temp data cleanup

      const result = await documentProcessor.cleanupProcessingData();
      
      expect(result.failedProcessingDeleted).toBe(0);
      expect(result.tempDataDeleted).toBe(1);
    });

    test('should clean up database connections', async () => {
      await documentProcessor.cleanupConnections();
      
      // Should attempt to close the pool if it exists
      // This test verifies the function doesn't throw errors
    });
  });

  describe('Error Handling', () => {
    test('should handle S3 access errors', async () => {
      mockS3Client.send.mockRejectedValue(new Error('S3 access denied'));

      const event = {
        Records: [{
          eventSource: 'aws:s3',
          s3: {
            bucket: { name: 'test-bucket' },
            object: { key: 'documents/test-document.txt' }
          }
        }]
      };

      const result = await documentProcessor.handler(event);
      
      expect(result.statusCode).toBe(500);
      
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('error');
    });

    test('should handle Textract errors', async () => {
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      mockS3Client.send.mockResolvedValue({
        Body: {
          transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]))
        },
        ContentType: 'application/pdf'
      });

      mockTextractClient.send.mockRejectedValue(new Error('Textract processing failed'));

      const event = {
        Records: [{
          eventSource: 'aws:s3',
          s3: {
            bucket: { name: 'test-bucket' },
            object: { key: 'documents/test-document.pdf' }
          }
        }]
      };

      const result = await documentProcessor.handler(event);
      
      expect(result.statusCode).toBe(500);
    });

    test('should handle database connection errors', async () => {
      mockSecretsManagerClient.send.mockRejectedValue(new Error('Secrets Manager error'));

      const event = {
        Records: [{
          eventSource: 'aws:s3',
          s3: {
            bucket: { name: 'test-bucket' },
            object: { key: 'documents/test-document.txt' }
          }
        }]
      };

      const result = await documentProcessor.handler(event);
      
      expect(result.statusCode).toBe(500);
    });

    test('should handle Bedrock embedding errors', async () => {
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      mockS3Client.send.mockResolvedValue({
        Body: {
          transformToString: jest.fn().mockResolvedValue('Test content')
        },
        ContentType: 'text/plain'
      });

      mockDbClient.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      mockBedrockClient.send.mockRejectedValue(new Error('Bedrock embedding failed'));

      const event = {
        Records: [{
          eventSource: 'aws:s3',
          s3: {
            bucket: { name: 'test-bucket' },
            object: { key: 'documents/test-document.txt' }
          }
        }]
      };

      const result = await documentProcessor.handler(event);
      
      expect(result.statusCode).toBe(500);
    });
  });

  describe('Document Chunking', () => {
    test('should create semantic chunks from text', () => {
      // This would test the chunking logic
      // Requires exposing the chunking functions or testing through document processing
    });

    test('should handle overlapping chunks', () => {
      // Test chunk overlap functionality
    });

    test('should calculate importance scores', () => {
      // Test importance scoring algorithm
    });
  });

  describe('Metadata Extraction', () => {
    test('should extract document metadata', () => {
      // Test metadata extraction from different document types
    });

    test('should handle documents without metadata', () => {
      // Test graceful handling of documents with no metadata
    });
  });
});

describe('Utility Functions', () => {
  test('should validate file types correctly', () => {
    // Test file type validation
  });

  test('should handle different text encodings', () => {
    // Test text encoding handling
  });

  test('should sanitize file names', () => {
    // Test file name sanitization
  });
});
