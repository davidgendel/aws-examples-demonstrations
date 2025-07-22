const { Client } = require('pg');
const { Pool } = require('pg');
const { 
  BedrockRuntimeClient, 
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
  ApplyGuardrailCommand
} = require('@aws-sdk/client-bedrock-runtime');
const { 
  SecretsManagerClient, 
  GetSecretValueCommand 
} = require('@aws-sdk/client-secrets-manager');
const { 
  ApiGatewayManagementApiClient, 
  PostToConnectionCommand 
} = require('@aws-sdk/client-apigatewaymanagementapi');
const {
  CloudWatchLogsClient,
  PutLogEventsCommand,
  CreateLogStreamCommand
} = require('@aws-sdk/client-cloudwatch-logs');
const NodeCache = require('node-cache');
const { TextDecoder } = require('util');

// Import token utilities
const { optimizePrompt } = require('./token-utils');

// =============================================================================
// REGION CONFIGURATION
// =============================================================================

// Get AWS region from environment or config
function getAwsRegion() {
  // Priority: Environment variable > Lambda context > default
  return process.env.AWS_REGION || 
         process.env.REGION || 
         process.env.AWS_DEFAULT_REGION || 
         'us-east-1';
}

const AWS_REGION = getAwsRegion();
console.log(`Using AWS region: ${AWS_REGION}`);

// CloudWatch logging utilities
const cloudwatchlogs = new CloudWatchLogsClient({ region: AWS_REGION });
const logStreamCache = new Set(); // Cache to track created log streams

// Ensure log stream exists
async function ensureLogStream(logGroupName, logStreamName) {
  const streamKey = `${logGroupName}:${logStreamName}`;
  
  // Check cache first
  if (logStreamCache.has(streamKey)) {
    return;
  }
  
  try {
    await cloudwatchlogs.send(new CreateLogStreamCommand({
      logGroupName,
      logStreamName
    }));
    logStreamCache.add(streamKey);
  } catch (error) {
    // If stream already exists, that's fine
    if (error.name === 'ResourceAlreadyExistsException') {
      logStreamCache.add(streamKey);
    } else {
      console.error('Error creating log stream:', error);
      throw error;
    }
  }
}

// Safe CloudWatch logging function
async function logToCloudWatch(logGroupName, logStreamName, message) {
  try {
    await ensureLogStream(logGroupName, logStreamName);
    
    await cloudwatchlogs.send(new PutLogEventsCommand({
      logGroupName,
      logStreamName,
      logEvents: [
        {
          timestamp: Date.now(),
          message: typeof message === 'string' ? message : JSON.stringify(message)
        }
      ]
    }));
  } catch (error) {
    console.error('Error writing to CloudWatch logs:', error);
  }
}
const bedrockClient = new BedrockRuntimeClient({ 
  region: AWS_REGION,
  maxAttempts: 3, // Add retry configuration
  retryMode: 'standard'
});
const secretsManagerClient = new SecretsManagerClient({ 
  region: AWS_REGION 
});

// Initialize cache
const cache = new NodeCache({ 
  stdTTL: 3600, // 1 hour default TTL
  checkperiod: 120, // Check for expired keys every 2 minutes
  useClones: false // For better performance
});

// =============================================================================
// STANDARDIZED RESPONSE FUNCTIONS
// =============================================================================

// Standardized error response format
function createErrorResponse(statusCode, errorType, message, details = null, requestId = null) {
  const errorResponse = {
    success: false,
    error: {
      type: errorType,
      message: message,
      code: statusCode,
      timestamp: new Date().toISOString()
    }
  };
  
  // Add details if provided
  if (details) {
    errorResponse.error.details = details;
  }
  
  // Add request ID if provided
  if (requestId) {
    errorResponse.error.requestId = requestId;
  }
  
  return {
    statusCode: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(errorResponse)
  };
}

// Standardized success response format
function createSuccessResponse(data, statusCode = 200) {
  const successResponse = {
    success: true,
    data: data,
    timestamp: new Date().toISOString()
  };
  
  return {
    statusCode: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(successResponse)
  };
}

// =============================================================================
// DATABASE CLEANUP FUNCTIONS
// =============================================================================

// Clean up old chat logs and expired cache entries
async function cleanupDatabase() {
  try {
    const pool = await getDbPool();
    
    // Clean up old document chunks (older than 90 days)
    const cleanupOldChunks = `
      DELETE FROM document_chunks 
      WHERE created_at < NOW() - INTERVAL '90 days'
    `;
    
    // Clean up orphaned documents (no associated chunks)
    const cleanupOrphanedDocs = `
      DELETE FROM documents 
      WHERE id NOT IN (SELECT DISTINCT document_id FROM document_chunks WHERE document_id IS NOT NULL)
      AND created_at < NOW() - INTERVAL '7 days'
    `;
    
    // Clean up old processing logs (older than 30 days)
    const cleanupProcessingLogs = `
      DELETE FROM processing_logs 
      WHERE created_at < NOW() - INTERVAL '30 days'
    `;
    
    // Vacuum and analyze tables for performance
    const vacuumTables = [
      'VACUUM ANALYZE documents',
      'VACUUM ANALYZE document_chunks',
      'VACUUM ANALYZE processing_logs'
    ];
    
    console.log('Starting database cleanup...');
    
    // Execute cleanup queries
    const chunksResult = await pool.query(cleanupOldChunks);
    console.log(`Cleaned up ${chunksResult.rowCount} old document chunks`);
    
    const docsResult = await pool.query(cleanupOrphanedDocs);
    console.log(`Cleaned up ${docsResult.rowCount} orphaned documents`);
    
    // Check if processing_logs table exists before cleaning
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'processing_logs'
      )
    `);
    
    let logsResult = { rowCount: 0 };
    if (tableExists.rows[0].exists) {
      logsResult = await pool.query(cleanupProcessingLogs);
      console.log(`Cleaned up ${logsResult.rowCount} old processing logs`);
    }
    
    // Run vacuum operations
    for (const vacuumQuery of vacuumTables) {
      try {
        await pool.query(vacuumQuery);
        console.log(`Executed: ${vacuumQuery}`);
      } catch (vacuumError) {
        console.warn(`Vacuum operation failed: ${vacuumQuery}`, vacuumError.message);
      }
    }
    
    console.log('Database cleanup completed successfully');
    
    return {
      chunksDeleted: chunksResult.rowCount,
      documentsDeleted: docsResult.rowCount,
      logsDeleted: logsResult.rowCount
    };
    
  } catch (error) {
    console.error('Error during database cleanup:', error);
    throw error;
  }
}

// Clean up database connections
async function cleanupConnections() {
  try {
    if (dbPool) {
      console.log('Closing database connection pool...');
      await dbPool.end();
      dbPool = null;
      console.log('Database connection pool closed');
    }
  } catch (error) {
    console.error('Error closing database connections:', error);
  }
}

// Graceful shutdown handler
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, performing graceful shutdown...');
  await cleanupConnections();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, performing graceful shutdown...');
  await cleanupConnections();
  process.exit(0);
});

// =============================================================================
// WEBSOCKET INPUT VALIDATION
// =============================================================================

// Validate WebSocket message input
function validateWebSocketInput(body, action) {
  const errors = [];
  
  // Validate action-specific requirements
  switch (action) {
    case 'sendMessage':
      // Validate message field
      if (!body.message) {
        errors.push('Message is required');
      } else if (typeof body.message !== 'string') {
        errors.push('Message must be a string');
      } else if (body.message.trim().length === 0) {
        errors.push('Message cannot be empty');
      } else if (body.message.length > 4000) {
        errors.push('Message too long (maximum 4000 characters)');
      }
      
      // Validate message content
      const trimmedMessage = body.message.trim();
      if (trimmedMessage.length < 1) {
        errors.push('Message must contain at least 1 character');
      }
      
      // Check for potentially malicious content
      const suspiciousPatterns = [
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        /javascript:/gi,
        /on\w+\s*=/gi,
        /data:text\/html/gi
      ];
      
      for (const pattern of suspiciousPatterns) {
        if (pattern.test(trimmedMessage)) {
          errors.push('Message contains potentially unsafe content');
          break;
        }
      }
      break;
      
    case 'heartbeat':
      // Heartbeat doesn't require additional validation
      break;
      
    default:
      errors.push(`Unknown action: ${action}`);
  }
  
  // General validation
  if (body && typeof body !== 'object') {
    errors.push('Request body must be a valid JSON object');
  }
  
  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

// Database connection
let dbPool = null;

// Get database credentials from Secrets Manager
async function getDbCredentials() {
  const secretArn = process.env.DB_SECRET_ARN;
  const command = new GetSecretValueCommand({ SecretId: secretArn });
  
  try {
    const data = await secretsManagerClient.send(command);
    return JSON.parse(data.SecretString);
  } catch (error) {
    console.error('Error retrieving database credentials:', error);
    throw error;
  }
}

// Connect to the database using connection pool
async function getDbPool() {
  if (dbPool && dbPool.totalCount > 0) {
    return dbPool;
  }
  
  try {
    const credentials = await getDbCredentials();
    
    dbPool = new Pool({
      host: credentials.host,
      port: credentials.port,
      database: credentials.dbname,
      user: credentials.username,
      password: credentials.password,
      ssl: {
        rejectUnauthorized: false
      },
      max: 10, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
    });
    
    // Handle pool errors
    dbPool.on('error', (err, client) => {
      console.error('Unexpected error on idle client', err);
    });
    
    // Test the connection
    const client = await dbPool.connect();
    client.release();
    
    console.log('Database connection pool established');
    return dbPool;
  } catch (error) {
    console.error('Error connecting to database:', error);
    throw error;
  }
}

// Execute a database query using the pool
async function queryDatabase(query, params = []) {
  const pool = await getDbPool();
  const client = await pool.connect();
  
  try {
    return await client.query(query, params);
  } finally {
    client.release();
  }
}

// Structured logging with tiered log groups
const logger = {
  info: (message, context = {}) => {
    const logEntry = JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      message,
      ...context
    });
    console.log(logEntry);
    
    // Also log to standard log group
    if (process.env.STANDARD_LOG_GROUP) {
      const logStreamName = `${process.env.AWS_LAMBDA_FUNCTION_NAME}-${new Date().toISOString().split('T')[0]}`;
      logToCloudWatch(process.env.STANDARD_LOG_GROUP, logStreamName, logEntry).catch(err => 
        console.error('Error writing to standard logs:', err)
      );
    }
  },
  error: (message, error, context = {}) => {
    const logEntry = JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      message,
      errorName: error.name,
      errorMessage: error.message,
      stackTrace: error.stack,
      ...context
    });
    console.error(logEntry);
    
    // Also log to critical log group
    if (process.env.CRITICAL_LOG_GROUP) {
      const logStreamName = `${process.env.AWS_LAMBDA_FUNCTION_NAME}-${new Date().toISOString().split('T')[0]}`;
      logToCloudWatch(process.env.CRITICAL_LOG_GROUP, logStreamName, logEntry).catch(err => 
        console.error('Error writing to critical logs:', err)
      );
    }
  },
  warn: (message, context = {}) => {
    const logEntry = JSON.stringify({
      level: 'warn',
      timestamp: new Date().toISOString(),
      message,
      ...context
    });
    console.warn(logEntry);
    
    // Also log to standard log group
    if (process.env.STANDARD_LOG_GROUP) {
      const logStreamName = `${process.env.AWS_LAMBDA_FUNCTION_NAME}-${new Date().toISOString().split('T')[0]}`;
      logToCloudWatch(process.env.STANDARD_LOG_GROUP, logStreamName, logEntry).catch(err => 
        console.error('Error writing to standard logs:', err)
      );
    }
  },
  debug: (message, context = {}) => {
    if (process.env.DEBUG) {
      const logEntry = JSON.stringify({
        level: 'debug',
        timestamp: new Date().toISOString(),
        message,
        ...context
      });
      console.debug(logEntry);
      
      // Also log to debug log group
      if (process.env.DEBUG_LOG_GROUP) {
        const logStreamName = `${process.env.AWS_LAMBDA_FUNCTION_NAME}-${new Date().toISOString().split('T')[0]}`;
        logToCloudWatch(process.env.DEBUG_LOG_GROUP, logStreamName, logEntry).catch(err => 
          console.error('Error writing to debug logs:', err)
        );
      }
    }
  }
};

// Custom error classes
class DatabaseError extends Error {
  constructor(message, originalError) {
    super(message);
    this.name = 'DatabaseError';
    this.originalError = originalError;
  }
}

class BedrockError extends Error {
  constructor(message, originalError) {
    super(message);
    this.name = 'BedrockError';
    this.originalError = originalError;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Retry function with exponential backoff
async function withRetry(fn, maxRetries = 3) {
  let retries = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      retries++;
      if (retries > maxRetries || !isRetryableError(error)) {
        throw error;
      }
      
      // Calculate exponential backoff with jitter
      const delay = Math.min(100 * Math.pow(2, retries) + Math.random() * 100, 2000);
      logger.warn(`Retrying after ${delay}ms (attempt ${retries}/${maxRetries})`, { 
        error: error.message,
        errorName: error.name,
        retryCount: retries
      });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Check if error is retryable
function isRetryableError(error) {
  // Retry on throttling, timeout, or connection errors
  return error.name === 'ThrottlingException' || 
         error.name === 'ServiceUnavailableException' ||
         error.name === 'InternalServerException' ||
         error.name === 'TooManyRequestsException' ||
         error.message.includes('timeout') ||
         error.message.includes('connection');
}

// Generate embeddings using Bedrock
async function generateEmbeddings(text) {
  return withRetry(async () => {
    const params = {
      modelId: 'amazon.titan-embed-text-v1',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: text
      })
    };

    const command = new InvokeModelCommand(params);
    const response = await bedrockClient.send(command);
    const embedding = JSON.parse(new TextDecoder().decode(response.body)).embedding;
    return embedding;
  });
}

// Query vector database for relevant documents with caching
async function queryVectorDatabase(embedding, limit = 3, filters = null) {
  try {
    // Create a cache key based on query parameters
    const cacheKey = `vector_query_${JSON.stringify(embedding.slice(0, 10))}_${limit}_${JSON.stringify(filters)}`;
    
    // Check if result is in cache
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      console.log('Vector query result served from cache');
      return cachedResult;
    }
    
    // Check if the new schema is available
    const tableCheckResult = await queryDatabase(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'document_chunks'
      );
    `);
    
    const newSchemaExists = tableCheckResult.rows[0].exists;
    
    let result;
    if (newSchemaExists) {
      // Use the new schema with enhanced querying
      let query = `
        WITH ranked_chunks AS (
          SELECT 
            dc.id,
            dc.document_id,
            d.title as document_title,
            dc.chunk_index,
            dc.content,
            dc.heading,
            dc.chunk_type,
            dc.importance_score,
            dc.metadata,
            1 - (dc.embedding <=> $1) AS similarity
          FROM 
            document_chunks dc
          JOIN 
            documents d ON dc.document_id = d.id
      `;
      
      let queryParams = [embedding, limit];
      
      // Add filters if provided with parameterized queries
      if (filters) {
        query += ' WHERE ';
        const conditions = [];
        let paramIndex = 3; // Start from $3 since $1 and $2 are already used
        
        if (filters.documentIds && filters.documentIds.length > 0) {
          const placeholders = filters.documentIds.map(() => `$${paramIndex++}`).join(',');
          conditions.push(`d.id IN (${placeholders})`);
          queryParams.push(...filters.documentIds);
        }
        
        if (filters.fileTypes && filters.fileTypes.length > 0) {
          const placeholders = filters.fileTypes.map(() => `$${paramIndex++}`).join(',');
          conditions.push(`d.file_type IN (${placeholders})`);
          queryParams.push(...filters.fileTypes);
        }
        
        if (filters.minDate) {
          conditions.push(`d.created_at >= $${paramIndex++}`);
          queryParams.push(filters.minDate);
        }
        
        if (filters.maxDate) {
          conditions.push(`d.created_at <= $${paramIndex++}`);
          queryParams.push(filters.maxDate);
        }
        
        query += conditions.join(' AND ');
      }
      
      query += `
          ORDER BY 
            (dc.embedding <=> $1) * (1.0 / dc.importance_score) -- Adjust similarity by importance
          LIMIT $2
        )
        SELECT 
          id,
          document_id,
          document_title,
          chunk_index,
          content,
          heading,
          chunk_type,
          importance_score,
          metadata,
          similarity
        FROM 
          ranked_chunks
        ORDER BY 
          similarity DESC;
      `;
      
      result = await queryDatabase(query, queryParams);
      
      // Transform results to include metadata
      result = result.rows.map(row => ({
        id: row.id,
        document_id: row.document_id,
        document_title: row.document_title,
        content: row.content,
        heading: row.heading,
        chunk_type: row.chunk_type,
        importance_score: row.importance_score,
        metadata: row.metadata,
        similarity: row.similarity
      }));
    } else {
      // Fall back to the old schema for backward compatibility
      const query = `
        SELECT document_id, content, 1 - (embedding <=> $1) AS similarity
        FROM document_embeddings
        ORDER BY embedding <=> $1
        LIMIT $2;
      `;
      
      const queryResult = await queryDatabase(query, [embedding, limit]);
      result = queryResult.rows;
    }
    
    // Store in cache with TTL
    cache.set(cacheKey, result);
    
    return result;
  } catch (error) {
    console.error('Error querying vector database:', error);
    
    // Fall back to the old schema if there was an error
    try {
      const query = `
        SELECT document_id, content, 1 - (embedding <=> $1) AS similarity
        FROM document_embeddings
        ORDER BY embedding <=> $1
        LIMIT $2;
      `;
      
      const result = await queryDatabase(query, [embedding, limit]);
      return result.rows;
    } catch (fallbackError) {
      console.error('Error in fallback query:', fallbackError);
      throw error; // Throw the original error
    }
  }
}
}

// Apply guardrails to user input
async function applyGuardrails(text) {
  const guardrailId = process.env.BEDROCK_GUARDRAIL_ID;
  
  if (!guardrailId) {
    return { text, blocked: false };
  }
  
  try {
    return await withRetry(async () => {
      const params = {
        guardrailIdentifier: guardrailId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          inputText: text
        })
      };
      
      const response = await bedrock.applyGuardrail(params).promise();
      const result = JSON.parse(response.body);
      
      return {
        text: result.output.text,
        blocked: result.output.assessment.topicPolicy.blocked || 
                result.output.assessment.contentPolicy.blocked ||
                result.output.assessment.wordPolicy.blocked,
        reasons: result.output.assessment
      };
    });
  } catch (error) {
    console.error('Error applying guardrails:', error);
    return { text, blocked: false };
  }
}

// Generate response using Bedrock with Amazon Nova Lite
async function generateResponse(prompt, modelId) {
  return withRetry(async () => {
    // Optimize prompt to reduce token usage
    const optimizedPrompt = optimizePrompt(prompt, 4000); // 4000 token limit
    
    // Log token optimization results
    if (optimizedPrompt !== prompt) {
      logger.info('Prompt optimized to reduce token usage', {
        originalLength: prompt.length,
        optimizedLength: optimizedPrompt.length,
        reductionPercent: Math.round((1 - optimizedPrompt.length / prompt.length) * 100)
      });
    }
    
    // Format the request based on the model
    let body;
    
    if (modelId === 'amazon.nova-lite-v1') {
      // Amazon Nova Lite format
      body = JSON.stringify({
        inputText: optimizedPrompt,
        textGenerationConfig: {
          maxTokenCount: 1000,
          temperature: 0.7,
          topP: 0.9,
          stopSequences: []
        }
      });
    } else {
      // Default format for other models (Claude, etc.)
      body = JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1000,
        messages: [
          { role: 'user', content: optimizedPrompt }
        ]
      });
    }

    // Create the command
    const command = new InvokeModelCommand({
      modelId: modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: body,
      // Add prompt caching configuration
      cacheConfig: {
        ttlSeconds: 259200 // 3 days (72 hours) as specified
      }
    });

    // Log cache usage for monitoring
    logger.info('Calling Bedrock with prompt caching enabled', { ttlHours: 72 });
    
    // Send the command
    const response = await bedrockClient.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    
    // Check if response was from cache (for logging purposes)
    const cacheHit = response.headers && 
                     response.headers['x-amzn-bedrock-cache-hit'] === 'true';
    
    if (cacheHit) {
      logger.info('Response served from Bedrock cache');
    } else {
      logger.info('Response generated (not from cache)');
    }
    
    // Extract response text based on model
    if (modelId === 'amazon.nova-lite-v1') {
      return result.results[0].outputText;
    } else {
      return result.content[0].text;
    }
  });
}

// Input validation middleware
function validateInput(input) {
  // Check for empty input
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    throw new ValidationError('Input cannot be empty');
  }
  
  // Check for maximum length
  if (input.length > 2000) {
    throw new ValidationError('Input exceeds maximum length of 2000 characters');
  }
  
  // Check for potentially malicious content
  const suspiciousPatterns = [
    /(<script|javascript:|onclick=|onerror=)/i,
    /(eval\(|setTimeout\(|setInterval\()/i,
    /(\$\{|\`\$\{)/i // Template literal injection
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(input)) {
      throw new ValidationError('Input contains potentially unsafe content');
    }
  }
  
  return input.trim();
}

// Main handler function
exports.handler = async (event) => {
  try {
    // Check if this is a WebSocket connection
    if (event.requestContext && event.requestContext.connectionId) {
      return handleWebSocketEvent(event);
    }
    
    // Check if this is a cleanup request
    if (event.httpMethod === 'POST' && event.path === '/cleanup') {
      // Verify this is an internal request (e.g., from EventBridge)
      if (event.source === 'aws.events' || event.headers?.['x-cleanup-token'] === process.env.CLEANUP_TOKEN) {
        console.log('Starting scheduled database cleanup...');
        const cleanupResult = await cleanupDatabase();
        
        return createSuccessResponse({
          message: 'Database cleanup completed',
          results: cleanupResult
        });
      } else {
        return createErrorResponse(
          403,
          'FORBIDDEN',
          'Unauthorized cleanup request'
        );
      }
    }
    
    // Parse request body for chat requests
    const body = JSON.parse(event.body);
    
    // Validate input
    let message;
    try {
      message = validateInput(body.message);
    } catch (validationError) {
      logger.warn('Input validation failed', { error: validationError.message });
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Invalid input provided',
        validationError.message
      );
    }
    
    const { streaming = false } = body;
    
    // Apply guardrails to user input
    const guardrailResult = await applyGuardrails(message);
    
    if (guardrailResult.blocked) {
      return createErrorResponse(
        400,
        'CONTENT_BLOCKED',
        'Content blocked by safety guardrails',
        guardrailResult.reasons
      );
    }
    
    // Generate embeddings for the query
    const embedding = await generateEmbeddings(message);
    
    // Retrieve relevant documents
    const relevantDocs = await queryVectorDatabase(embedding);
    
    // Construct prompt with retrieved documents
    let context = '';
    if (relevantDocs.length > 0) {
      context = 'Here is some relevant information that might help answer the question:\n\n';
      
      relevantDocs.forEach((doc, index) => {
        // Check if we have enhanced metadata
        if (doc.document_title && doc.heading) {
          context += `Document ${index + 1}: "${doc.document_title}"\n`;
          if (doc.heading) {
            context += `Section: ${doc.heading}\n`;
          }
          context += `Content: ${doc.content}\n\n`;
          
          // Add relevant metadata if available
          if (doc.metadata) {
            try {
              const metadata = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata;
              
              // Add source information if available
              if (metadata.source) {
                context += `Source: ${metadata.source}\n`;
              }
              
              // Add author information if available
              if (metadata.author) {
                context += `Author: ${metadata.author}\n`;
              }
              
              // Add date information if available
              if (metadata.date) {
                context += `Date: ${metadata.date}\n`;
              }
              
              // Add table information if this chunk references a table
              if (doc.content.includes('[TABLE') && metadata.tables && metadata.tables.length > 0) {
                const tableMatch = doc.content.match(/\[TABLE (\d+)\]/);
                if (tableMatch && tableMatch[1]) {
                  const tableIndex = parseInt(tableMatch[1]) - 1;
                  if (metadata.tables[tableIndex]) {
                    context += 'Table content:\n';
                    const table = metadata.tables[tableIndex];
                    table.rows.forEach(row => {
                      context += row.join(' | ') + '\n';
                    });
                    context += '\n';
                  }
                }
              }
            } catch (error) {
              console.error('Error parsing document metadata:', error);
            }
          }
        } else {
          // Fallback for old schema
          context += `Document ${index + 1}:\n${doc.content}\n\n`;
        }
      });
    }
    
    const prompt = `${context}
User question: ${message}

Please provide a helpful, accurate, and concise response based on the information provided. If the information doesn't contain the answer, just say you don't have enough information to answer accurately.`;
    
    // Generate response
    const modelId = process.env.BEDROCK_MODEL_ID;
    
    // If streaming is requested and this is not a WebSocket connection, use non-streaming response
    if (!streaming) {
      const response = await generateResponse(prompt, modelId);
      
      // Return response
      return createSuccessResponse({
        response: response,
        cached: false,
        model: process.env.BEDROCK_MODEL_ID || 'amazon.nova-lite-v1'
      });
    } else {
      // For streaming, we'll use API Gateway WebSocket API
      // This is just a placeholder - the actual implementation would require setting up WebSocket API
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          message: "Streaming is not supported in this endpoint. Please use the WebSocket API for streaming.",
          streamingUrl: process.env.WEBSOCKET_API_URL
        })
      };
    }
  } catch (error) {
    console.error('Error:', error);
    
    return createErrorResponse(
      500,
      'INTERNAL_SERVER_ERROR',
      'An error occurred while processing your request',
      error.message
    );
  }
};

// Handle WebSocket events
async function handleWebSocketEvent(event) {
  const connectionId = event.requestContext.connectionId;
  const routeKey = event.requestContext.routeKey;
  
  // Get API Gateway Management API endpoint
  const domain = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  const apiGatewayManagementApi = new ApiGatewayManagementApiClient({
    endpoint: `https://${domain}/${stage}`,
    region: AWS_REGION
  });
  
  // Handle different WebSocket route keys
  switch (routeKey) {
    case '$connect':
      // Connection established
      return { statusCode: 200 };
      
    case '$disconnect':
      // Connection closed
      return { statusCode: 200 };
      
    case 'sendMessage':
      // Process message and stream response
      try {
        // Parse and validate input
        let body;
        try {
          body = JSON.parse(event.body);
        } catch (parseError) {
          await sendToConnection(apiGatewayManagementApi, connectionId, {
            type: 'error',
            error: 'Invalid JSON format',
            details: 'Request body must be valid JSON'
          });
          return { statusCode: 200 };
        }
        
        // Validate WebSocket input
        const validation = validateWebSocketInput(body, 'sendMessage');
        if (!validation.isValid) {
          await sendToConnection(apiGatewayManagementApi, connectionId, {
            type: 'error',
            error: 'Invalid input',
            details: validation.errors
          });
          return { statusCode: 200 };
        }
        
        const { message } = body;
        
        // Apply guardrails
        const guardrailResult = await applyGuardrails(message);
        if (guardrailResult.blocked) {
          await sendToConnection(apiGatewayManagementApi, connectionId, {
            type: 'error',
            error: 'Content blocked by guardrails',
            details: guardrailResult.reasons
          });
          return { statusCode: 200 };
        }
        
        // Generate embeddings and query vector database
        const embedding = await generateEmbeddings(message);
        const relevantDocs = await queryVectorDatabase(embedding);
        
        // Construct prompt
        let context = '';
        if (relevantDocs.length > 0) {
          context = 'Here is some relevant information that might help answer the question:\n\n';
          relevantDocs.forEach((doc, index) => {
            context += `Document ${index + 1}:\n${doc.content}\n\n`;
          });
        }
        
        const prompt = `${context}
User question: ${message}

Please provide a helpful, accurate, and concise response based on the information provided. If the information doesn't contain the answer, just say you don't have enough information to answer accurately.`;
        
        // Stream response using Bedrock streaming API
        await streamResponse(apiGatewayManagementApi, connectionId, prompt, process.env.BEDROCK_MODEL_ID);
        
        return { statusCode: 200 };
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
        
        try {
          await sendToConnection(apiGatewayManagementApi, connectionId, {
            type: 'error',
            error: 'An error occurred while processing your request',
            details: error.message
          });
        } catch (sendError) {
          console.error('Error sending error message to WebSocket client:', sendError);
        }
        
        return { statusCode: 500 };
      }
      
    case 'heartbeat':
      // Respond to heartbeat
      try {
        // Parse and validate input
        let body = {};
        if (event.body) {
          try {
            body = JSON.parse(event.body);
          } catch (parseError) {
            await sendToConnection(apiGatewayManagementApi, connectionId, {
              type: 'error',
              error: 'Invalid JSON format',
              details: 'Request body must be valid JSON'
            });
            return { statusCode: 200 };
          }
          
          // Validate WebSocket input
          const validation = validateWebSocketInput(body, 'heartbeat');
          if (!validation.isValid) {
            await sendToConnection(apiGatewayManagementApi, connectionId, {
              type: 'error',
              error: 'Invalid input',
              details: validation.errors
            });
            return { statusCode: 200 };
          }
        }
        
        await sendToConnection(apiGatewayManagementApi, connectionId, {
          type: 'heartbeat',
          timestamp: Date.now()
        });
        return { statusCode: 200 };
      } catch (error) {
        console.error('Error sending heartbeat response:', error);
        return { statusCode: 500 };
      }
          });
        } catch (sendError) {
          console.error('Error sending error message to WebSocket client:', sendError);
        }
        
        return { statusCode: 500 };
      }
      
    default:
      // Unknown route - send error via WebSocket
      try {
        await sendToConnection(apiGatewayManagementApi, connectionId, {
          type: 'error',
          error: 'Unknown route',
          details: `Route '${routeKey}' is not supported`
        });
      } catch (sendError) {
        console.error('Error sending unknown route error to WebSocket client:', sendError);
      }
      return { statusCode: 400 };
  }
}

// Send message to WebSocket connection
async function sendToConnection(apiGatewayManagementApi, connectionId, data) {
  try {
    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(data)
    });
    await apiGatewayManagementApi.send(command);
  } catch (error) {
    if (error.statusCode === 410) {
      console.log(`Connection ${connectionId} is stale`);
    } else if (error.name === 'LimitExceededException') {
      // Handle rate limiting by adding a small delay and retrying
      console.log(`Rate limit exceeded for connection ${connectionId}, retrying after delay`);
      await new Promise(resolve => setTimeout(resolve, 200));
      return sendToConnection(apiGatewayManagementApi, connectionId, data);
    } else {
      console.error(`Error sending message to connection ${connectionId}:`, error);
      throw error;
    }
  }
}

// Stream response using Bedrock streaming API
async function streamResponse(apiGatewayManagementApi, connectionId, prompt, modelId) {
  try {
    // Send initial message with connection ID
    await sendToConnection(apiGatewayManagementApi, connectionId, {
      type: 'start',
      connectionId: connectionId,
      message: 'Response streaming started'
    });
    
    // Format request based on model
    let body;
    if (modelId === 'amazon.nova-lite-v1') {
      body = JSON.stringify({
        inputText: prompt,
        textGenerationConfig: {
          maxTokenCount: 1000,
          temperature: 0.7,
          topP: 0.9,
          stopSequences: []
        }
      });
    } else {
      body = JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1000,
        messages: [
          { role: 'user', content: prompt }
        ]
      });
    }

    // Create streaming request with prompt caching enabled
    const params = {
      modelId: modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: body,
      cacheConfig: {
        ttlSeconds: 259200 // 3 days (72 hours) as specified
      }
    };

    // Log cache usage for monitoring
    console.log(`Calling Bedrock streaming with prompt caching enabled (TTL: 72 hours)`);

    // Use the streaming API with AWS SDK v3
    const command = new InvokeModelWithResponseStreamCommand(params);
    const response = await bedrockClient.send(command);
    
    // Check if response was from cache (for logging purposes)
    const cacheHit = response.responseMetadata && 
                     response.responseMetadata.headers && 
                     response.responseMetadata.headers['x-amzn-bedrock-cache-hit'] === 'true';
    
    if (cacheHit) {
      console.log('Streaming response served from Bedrock cache');
    } else {
      console.log('Streaming response generated (not from cache)');
    }
    
    // Process the streaming response
    const responseStream = response.body;
    
    // Send initial message
    await sendToConnection(apiGatewayManagementApi, connectionId, {
      type: 'start',
      message: 'Response streaming started'
    });
    
    // Process chunks as they arrive with proper error handling
    let accumulatedText = '';
    let lastSentTime = Date.now();
    const CHUNK_INTERVAL = 300; // Minimum time between chunks in ms
    
    // Handle streaming response with proper error handling
    try {
      for await (const chunk of responseStream) {
        try {
          if (chunk.chunk && chunk.chunk.bytes) {
            const parsedChunk = JSON.parse(new TextDecoder().decode(chunk.chunk.bytes));
            
            // Extract text based on model
            let chunkText = '';
            if (modelId === 'amazon.nova-lite-v1') {
              if (parsedChunk.outputText) {
                chunkText = parsedChunk.outputText;
              }
            } else {
              if (parsedChunk.completion) {
                chunkText = parsedChunk.completion;
              }
            }
            
            if (chunkText) {
              accumulatedText += chunkText;
              
              // Rate limit sending chunks to avoid overwhelming the connection
              const now = Date.now();
              if (now - lastSentTime >= CHUNK_INTERVAL) {
                // Send chunk to client with error handling
                try {
                  await sendToConnection(apiGatewayManagementApi, connectionId, {
                    type: 'chunk',
                    text: chunkText,
                    complete: false
                  });
                  lastSentTime = now;
                } catch (sendError) {
                  console.error('Error sending chunk to connection:', sendError);
                  // Don't break the stream for individual send errors
                }
              }
            }
          }
        } catch (chunkError) {
          console.error('Error processing chunk:', chunkError);
          // Continue processing other chunks
        }
      }
    } catch (streamError) {
      console.error('Error processing stream:', streamError);
      throw streamError;
    }
    
    // Send final message with complete response
    try {
      await sendToConnection(apiGatewayManagementApi, connectionId, {
        type: 'end',
        connectionId: connectionId,
        text: accumulatedText,
        complete: true
      });
    } catch (finalError) {
      console.error('Error sending final message:', finalError);
    }
    
  } catch (error) {
    console.error('Error streaming response:', error);
    
    // Send error message to client
    try {
      await sendToConnection(apiGatewayManagementApi, connectionId, {
        type: 'error',
        connectionId: connectionId,
        error: 'An error occurred while streaming the response',
        details: error.message
      });
    } catch (errorSendError) {
      console.error('Error sending error message to client:', errorSendError);
    }
    
    throw error;
  }
}
      details: error.message
    });
  }
}
