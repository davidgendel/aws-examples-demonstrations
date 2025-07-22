/**
 * Test suite for the database cleanup script
 * Tests include mocking of database operations and AWS services
 */

const { jest } = require('@jest/globals');

// Mock AWS SDK
const mockSecretsManagerClient = {
  send: jest.fn()
};

// Mock PostgreSQL client
const mockDbClient = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn()
};

// Set up mocks
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => mockSecretsManagerClient),
  GetSecretValueCommand: jest.fn()
}));

jest.mock('pg', () => ({
  Client: jest.fn(() => mockDbClient)
}));

// Mock console methods
const originalConsole = console;
beforeEach(() => {
  console.log = jest.fn();
  console.error = jest.fn();
  console.warn = jest.fn();
});

afterEach(() => {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  jest.clearAllMocks();
});

// Mock environment variables
const originalEnv = process.env;
beforeEach(() => {
  process.env = {
    ...originalEnv,
    AWS_REGION: 'us-east-1',
    DB_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret'
  };
});

afterEach(() => {
  process.env = originalEnv;
});

// Import the module after mocks are set up
const cleanupScript = require('./cleanup-database');

describe('Database Cleanup Script', () => {
  
  describe('Database Connection', () => {
    test('should connect to database with credentials from Secrets Manager', async () => {
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      mockDbClient.connect.mockResolvedValue();
      mockDbClient.query.mockResolvedValue({ rows: [{ count: '0' }] });
      mockDbClient.end.mockResolvedValue();

      await cleanupScript.runCleanup();

      expect(mockSecretsManagerClient.send).toHaveBeenCalled();
      expect(mockDbClient.connect).toHaveBeenCalled();
      expect(mockDbClient.end).toHaveBeenCalled();
    });

    test('should handle Secrets Manager errors', async () => {
      mockSecretsManagerClient.send.mockRejectedValue(new Error('Secrets Manager error'));

      await expect(cleanupScript.runCleanup()).rejects.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Fatal error: Failed to retrieve database credentials')
      );
    });

    test('should handle database connection errors', async () => {
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      mockDbClient.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(cleanupScript.runCleanup()).rejects.toThrow();
    });
  });

  describe('Cleanup Operations', () => {
    beforeEach(() => {
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      mockDbClient.connect.mockResolvedValue();
      mockDbClient.end.mockResolvedValue();
    });

    test('should clean up old document chunks', async () => {
      mockDbClient.query
        .mockResolvedValueOnce({ rows: [{ count: '10', documents: '5', processingLogs: '3', databaseSize: '100MB' }] }) // Initial stats
        .mockResolvedValueOnce({ rowCount: 5 }) // Cleanup old chunks
        .mockResolvedValueOnce({ rowCount: 2 }) // Cleanup orphaned docs
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // Table exists check
        .mockResolvedValueOnce({ rowCount: 3 }) // Cleanup processing logs
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // Vacuum table check
        .mockResolvedValueOnce({}) // Vacuum documents
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // Vacuum table check
        .mockResolvedValueOnce({}) // Vacuum document_chunks
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // Vacuum table check
        .mockResolvedValueOnce({}) // Vacuum processing_logs
        .mockResolvedValueOnce({ rows: [{ count: '5', documents: '3', processingLogs: '0', databaseSize: '80MB' }] }); // Final stats

      const result = await cleanupScript.cleanupOldDocumentChunks(mockDbClient, 90);

      expect(result.rowCount).toBe(5);
      expect(mockDbClient.query).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM document_chunks")
      );
    });

    test('should clean up orphaned documents', async () => {
      mockDbClient.query.mockResolvedValue({ rowCount: 2 });

      const result = await cleanupScript.cleanupOrphanedDocuments(mockDbClient, 7);

      expect(result.rowCount).toBe(2);
      expect(mockDbClient.query).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM documents")
      );
    });

    test('should clean up processing logs', async () => {
      mockDbClient.query
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // Table exists
        .mockResolvedValueOnce({ rowCount: 3 }); // Cleanup logs

      const result = await cleanupScript.cleanupProcessingLogs(mockDbClient, 30);

      expect(result.rowCount).toBe(3);
      expect(mockDbClient.query).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM processing_logs")
      );
    });

    test('should skip processing logs cleanup when table does not exist', async () => {
      mockDbClient.query.mockResolvedValue({ rows: [{ exists: false }] });

      const result = await cleanupScript.cleanupProcessingLogs(mockDbClient, 30);

      expect(result.rowCount).toBe(0);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Processing logs table does not exist')
      );
    });

    test('should optimize database tables', async () => {
      mockDbClient.query
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // documents table exists
        .mockResolvedValueOnce({}) // VACUUM documents
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // document_chunks table exists
        .mockResolvedValueOnce({}) // VACUUM document_chunks
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // processing_logs table exists
        .mockResolvedValueOnce({}); // VACUUM processing_logs

      await cleanupScript.optimizeDatabase(mockDbClient);

      expect(mockDbClient.query).toHaveBeenCalledWith('VACUUM ANALYZE documents');
      expect(mockDbClient.query).toHaveBeenCalledWith('VACUUM ANALYZE document_chunks');
      expect(mockDbClient.query).toHaveBeenCalledWith('VACUUM ANALYZE processing_logs');
    });

    test('should handle vacuum errors gracefully', async () => {
      mockDbClient.query
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // Table exists
        .mockRejectedValueOnce(new Error('Vacuum failed')); // Vacuum fails

      await cleanupScript.optimizeDatabase(mockDbClient);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Warning: Failed to optimize table')
      );
    });
  });

  describe('Dry Run Mode', () => {
    beforeEach(() => {
      // Mock process.argv to include --dry-run
      process.argv = ['node', 'cleanup-database.js', '--dry-run'];
      
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      mockDbClient.connect.mockResolvedValue();
      mockDbClient.end.mockResolvedValue();
    });

    test('should show what would be deleted without making changes', async () => {
      mockDbClient.query
        .mockResolvedValueOnce({ rows: [{ count: '5' }] }) // Count query for chunks
        .mockResolvedValueOnce({ rows: [{ count: '2' }] }) // Count query for docs
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // Table exists check
        .mockResolvedValueOnce({ rows: [{ count: '3' }] }); // Count query for logs

      const result = await cleanupScript.cleanupOldDocumentChunks(mockDbClient, 90);

      expect(result.rowCount).toBe(5);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN] Would delete 5 old document chunks')
      );
      
      // Should not execute DELETE queries
      expect(mockDbClient.query).not.toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM document_chunks')
      );
    });

    test('should show vacuum operations without executing them', async () => {
      mockDbClient.query.mockResolvedValue({ rows: [{ exists: true }] });

      await cleanupScript.optimizeDatabase(mockDbClient);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN] Would run VACUUM ANALYZE on table: documents')
      );
      
      // Should not execute VACUUM queries
      expect(mockDbClient.query).not.toHaveBeenCalledWith('VACUUM ANALYZE documents');
    });
  });

  describe('Database Statistics', () => {
    beforeEach(() => {
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      mockDbClient.connect.mockResolvedValue();
      mockDbClient.end.mockResolvedValue();
    });

    test('should collect database statistics', async () => {
      mockDbClient.query
        .mockResolvedValueOnce({ rows: [{ count: '100' }] }) // document_chunks count
        .mockResolvedValueOnce({ rows: [{ count: '50' }] }) // documents count
        .mockResolvedValueOnce({ rows: [{ count: '25' }] }) // processing_logs count
        .mockResolvedValueOnce({ rows: [{ size: '500 MB' }] }); // database size

      const stats = await cleanupScript.getDatabaseStats(mockDbClient);

      expect(stats).toEqual({
        documentChunks: 100,
        documents: 50,
        processingLogs: 25,
        databaseSize: '500 MB'
      });
    });

    test('should handle missing tables gracefully', async () => {
      mockDbClient.query
        .mockResolvedValueOnce({ rows: [{ count: '100' }] }) // document_chunks count
        .mockRejectedValueOnce(new Error('Table does not exist')) // documents count fails
        .mockResolvedValueOnce({ rows: [{ count: '25' }] }) // processing_logs count
        .mockResolvedValueOnce({ rows: [{ size: '500 MB' }] }); // database size

      const stats = await cleanupScript.getDatabaseStats(mockDbClient);

      expect(stats.documentChunks).toBe(100);
      expect(stats.documents).toBe('N/A');
      expect(stats.processingLogs).toBe(25);
      expect(stats.databaseSize).toBe('500 MB');
    });
  });

  describe('Error Handling', () => {
    test('should handle missing DB_SECRET_ARN environment variable', async () => {
      delete process.env.DB_SECRET_ARN;

      await expect(cleanupScript.runCleanup()).rejects.toThrow(
        'DB_SECRET_ARN environment variable is required'
      );
    });

    test('should handle cleanup errors gracefully', async () => {
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      mockDbClient.connect.mockResolvedValue();
      mockDbClient.query.mockRejectedValue(new Error('Database error'));
      mockDbClient.end.mockResolvedValue();

      await expect(cleanupScript.runCleanup()).rejects.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error during cleanup')
      );
    });

    test('should ensure database connection is closed on error', async () => {
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      mockDbClient.connect.mockResolvedValue();
      mockDbClient.query.mockRejectedValue(new Error('Database error'));
      mockDbClient.end.mockResolvedValue();

      try {
        await cleanupScript.runCleanup();
      } catch (error) {
        // Expected to throw
      }

      expect(mockDbClient.end).toHaveBeenCalled();
    });
  });

  describe('Verbose Mode', () => {
    beforeEach(() => {
      process.argv = ['node', 'cleanup-database.js', '--verbose'];
    });

    test('should show detailed logging in verbose mode', async () => {
      mockSecretsManagerClient.send.mockResolvedValue({
        SecretString: JSON.stringify({
          host: 'localhost',
          port: 5432,
          dbname: 'testdb',
          username: 'testuser',
          password: 'testpass'
        })
      });

      mockDbClient.connect.mockResolvedValue();
      mockDbClient.end.mockResolvedValue();
      mockDbClient.query.mockResolvedValue({ rows: [{ count: '0' }] });

      await cleanupScript.runCleanup();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Database connection established')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Database connection closed')
      );
    });
  });
});
