const { Client, Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { TextractClient, AnalyzeDocumentCommand } = require('@aws-sdk/client-textract');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Readable } = require('stream');

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

// Initialize AWS clients
const s3Client = new S3Client({ region: AWS_REGION });
const bedrockClient = new BedrockRuntimeClient({ region: AWS_REGION });
const secretsManagerClient = new SecretsManagerClient({ region: AWS_REGION });
const textractClient = new TextractClient({ region: AWS_REGION });

// Database connection pool
let dbPool = null;

// Helper function to convert stream to string
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// Get database credentials from Secrets Manager
async function getDbCredentials() {
  const secretArn = process.env.DB_SECRET_ARN;
  const command = new GetSecretValueCommand({ SecretId: secretArn });
  const data = await secretsManagerClient.send(command);
  return JSON.parse(data.SecretString);
}

// Connect to the database
async function connectToDatabase() {
  if (dbPool && !dbPool.ended) {
    return dbPool;
  }

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
    // Connection pool configuration
    max: 10, // Maximum number of connections
    min: 2,  // Minimum number of connections
    idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
    connectionTimeoutMillis: 2000, // Return error after 2 seconds if connection could not be established
    maxUses: 7500, // Close connection after 7500 uses (helps with connection refresh)
  });

  // Test the connection
  const client = await dbPool.connect();
  
  try {
    // Ensure pgvector extension is installed
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
    
    // Create tables if they don't exist
    await client.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      document_key TEXT NOT NULL UNIQUE,
      title TEXT,
      source TEXT,
      author TEXT,
      file_type TEXT NOT NULL,
      file_size BIGINT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      metadata JSONB
    );
  `);
  
  await client.query(`
    CREATE TABLE IF NOT EXISTS document_chunks (
      id SERIAL PRIMARY KEY,
      document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding vector(1536) NOT NULL,
      chunk_type TEXT DEFAULT 'text',
      heading TEXT,
      importance_score FLOAT DEFAULT 1.0,
      metadata JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // Create index for vector similarity search
  await client.query(`
    CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx 
    ON document_chunks 
    USING ivfflat (embedding vector_cosine_ops) 
    WITH (lists = 100);
  `);
  
  // Create index for document lookup
  await client.query(`
    CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx
    ON document_chunks(document_id);
  `);
  
  // Create index for metadata search
  await client.query(`
    CREATE INDEX IF NOT EXISTS documents_metadata_idx
    ON documents USING GIN (metadata);
  `);
  
  // Create index for document_chunks metadata search
  await client.query(`
    CREATE INDEX IF NOT EXISTS document_chunks_metadata_idx
    ON document_chunks USING GIN (metadata);
  `);
  
  // For backward compatibility, create the old table if it doesn't exist
  await client.query(`
    CREATE TABLE IF NOT EXISTS document_embeddings (
      id SERIAL PRIMARY KEY,
      document_id TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding vector(1536) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // Create index for backward compatibility
  await client.query(`
    CREATE INDEX IF NOT EXISTS document_embeddings_embedding_idx 
    ON document_embeddings 
    USING ivfflat (embedding vector_cosine_ops) 
    WITH (lists = 100);
  `);
  
  } finally {
    // Release the client back to the pool
    client.release();
  }
  
  return dbPool;
}

// Generate embeddings using Bedrock
async function generateEmbeddings(text) {
  const params = {
    modelId: 'amazon.titan-embed-text-v1',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      inputText: text
    }),
    cacheConfig: {
      ttlSeconds: 259200 // 3 days (72 hours) as specified
    }
  };

  // Log cache usage for monitoring
  console.log(`Generating embeddings with prompt caching enabled (TTL: 72 hours)`);

  const command = new InvokeModelCommand(params);
  const response = await bedrockClient.send(command);
  
  // Check if response was from cache (for logging purposes)
  const cacheHit = response.responseMetadata && 
                   response.responseMetadata.headers && 
                   response.responseMetadata.headers['x-amzn-bedrock-cache-hit'] === 'true';
  
  if (cacheHit) {
    console.log('Embeddings served from Bedrock cache');
  } else {
    console.log('Embeddings generated (not from cache)');
  }
  
  const embedding = JSON.parse(response.body).embedding;
  return embedding;
}

// Extract text and metadata from document using Textract
async function extractTextFromDocument(bucket, key) {
  try {
    // Determine file type from key
    const fileExtension = key.split('.').pop().toLowerCase();
    const fileName = key.split('/').pop();
    
    // Get file metadata from S3
    const headResponse = await s3.headObject({ Bucket: bucket, Key: key }).promise();
    const fileSize = headResponse.ContentLength;
    const lastModified = headResponse.LastModified;
    const metadata = headResponse.Metadata || {};
    
    // Initialize document metadata
    const documentMetadata = {
      fileName,
      fileExtension,
      fileSize,
      lastModified,
      s3Metadata: metadata,
      source: bucket,
      extractionMethod: ''
    };
    
    let extractedContent = {
      text: '',
      title: fileName,
      metadata: documentMetadata,
      structure: []
    };
    
    if (['txt', 'md', 'html', 'htm', 'csv', 'json'].includes(fileExtension)) {
      // For text files, read directly from S3
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      const data = await s3Client.send(command);
      const content = await streamToString(data.Body);
      
      documentMetadata.extractionMethod = 'direct';
      
      // Extract title and structure based on file type
      if (fileExtension === 'md' || fileExtension === 'html' || fileExtension === 'htm') {
        // Extract headings for markdown or HTML
        const headings = extractHeadings(content, fileExtension);
        extractedContent.structure = headings;
        
        // Use first heading as title if available
        if (headings.length > 0 && headings[0].level === 1) {
          extractedContent.title = headings[0].text;
        }
      } else if (fileExtension === 'json') {
        try {
          // Try to parse JSON for potential metadata
          const jsonContent = JSON.parse(content);
          if (jsonContent.title) {
            extractedContent.title = jsonContent.title;
          }
          if (jsonContent.metadata) {
            documentMetadata.jsonMetadata = jsonContent.metadata;
          }
        } catch (e) {
          console.warn('Failed to parse JSON metadata:', e);
        }
      }
      
      extractedContent.text = content;
      extractedContent.metadata = documentMetadata;
      
      return extractedContent;
    } else if (['pdf', 'png', 'jpg', 'jpeg', 'tiff'].includes(fileExtension)) {
      documentMetadata.extractionMethod = 'textract';
      
      // For documents and images, use Textract with enhanced features
      const command = new AnalyzeDocumentCommand({
        Document: {
          S3Object: {
            Bucket: bucket,
            Name: key
          }
        },
        FeatureTypes: ['TABLES', 'FORMS', 'SIGNATURES'],
        QueriesConfig: {
          Queries: [
            { Text: "What is the document title?" },
            { Text: "Who is the author of this document?" },
            { Text: "What is the date of this document?" }
          ]
        }
      });
      
      const response = await textractClient.send(command);
      
      // Extract text from blocks
      let extractedText = '';
      let currentHeading = null;
      let structure = [];
      let pageNumber = 1;
      let tables = [];
      let forms = {};
      let queryResults = {};
      
      // Process Textract blocks
      response.Blocks.forEach(block => {
        if (block.BlockType === 'LINE') {
          // Check if this line might be a heading (based on font size or style)
          const isHeading = block.Text && (
            block.TextType === 'HEADING' || 
            (block.Page && block.Page !== pageNumber) || // New page might indicate section
            (block.Text.trim().length < 100 && block.Text.trim().endsWith(':')) // Potential heading with colon
          );
          
          if (isHeading) {
            currentHeading = {
              text: block.Text,
              level: estimateHeadingLevel(block),
              startPosition: extractedText.length
            };
            structure.push(currentHeading);
            
            // Use first heading as potential title
            if (structure.length === 1) {
              extractedContent.title = block.Text;
            }
          }
          
          if (block.Text) {
            extractedText += block.Text + '\n';
          }
          
          // Update page number if changed
          if (block.Page) {
            pageNumber = block.Page;
          }
        } else if (block.BlockType === 'TABLE') {
          // Process table data
          const table = processTable(block, response.Blocks);
          tables.push(table);
          extractedText += `[TABLE ${tables.length}]\n`;
        } else if (block.BlockType === 'KEY_VALUE_SET' && block.EntityTypes && block.EntityTypes.includes('KEY')) {
          // Process form fields
          const key = getTextFromBlock(block, response.Blocks);
          const valueBlock = getValueBlock(block, response.Blocks);
          const value = valueBlock ? getTextFromBlock(valueBlock, response.Blocks) : '';
          
          if (key && value) {
            forms[key] = value;
            
            // Check for common metadata fields
            const keyLower = key.toLowerCase();
            if (keyLower.includes('title')) {
              extractedContent.title = value;
            } else if (keyLower.includes('author')) {
              documentMetadata.author = value;
            } else if (keyLower.includes('date')) {
              documentMetadata.date = value;
            }
          }
        } else if (block.BlockType === 'QUERY_RESULT') {
          // Process query results
          if (block.Query && block.Query.Text && block.Text) {
            queryResults[block.Query.Text] = block.Text;
            
            // Use query results for metadata
            if (block.Query.Text === "What is the document title?") {
              extractedContent.title = block.Text;
            } else if (block.Query.Text === "Who is the author of this document?") {
              documentMetadata.author = block.Text;
            } else if (block.Query.Text === "What is the date of this document?") {
              documentMetadata.date = block.Text;
            }
          }
        }
      });
      
      // Add extracted data to metadata
      documentMetadata.tables = tables;
      documentMetadata.forms = forms;
      documentMetadata.queryResults = queryResults;
      documentMetadata.pageCount = pageNumber;
      
      extractedContent.text = extractedText;
      extractedContent.structure = structure;
      extractedContent.metadata = documentMetadata;
      
      return extractedContent;
    } else {
      throw new Error(`Unsupported file type: ${fileExtension}`);
    }
  } catch (error) {
    console.error('Error extracting text:', error);
    throw error;
  }
}

// Helper function to extract headings from markdown or HTML
function extractHeadings(content, fileType) {
  const headings = [];
  
  if (fileType === 'md') {
    // Extract markdown headings
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    let match;
    
    while ((match = headingRegex.exec(content)) !== null) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        startPosition: match.index
      });
    }
  } else if (fileType === 'html' || fileType === 'htm') {
    // Extract HTML headings
    const headingRegex = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi;
    let match;
    
    while ((match = headingRegex.exec(content)) !== null) {
      // Remove HTML tags from heading text
      const text = match[2].replace(/<[^>]*>/g, '').trim();
      
      headings.push({
        level: parseInt(match[1]),
        text: text,
        startPosition: match.index
      });
    }
  }
  
  return headings;
}

// Helper function to estimate heading level from Textract block
function estimateHeadingLevel(block) {
  // This is a simplified approach - in a real implementation,
  // you would use font size, style, and position to determine heading level
  if (block.TextType === 'HEADING') {
    return 1; // Assume it's a top-level heading
  } else if (block.Text && block.Text.trim().endsWith(':')) {
    return 2; // Assume it's a subheading
  } else {
    return 3; // Default level
  }
}

// Helper function to process table data from Textract
function processTable(tableBlock, allBlocks) {
  const table = {
    rows: [],
    rowCount: 0,
    columnCount: 0
  };
  
  // Find all cells belonging to this table
  const cellBlocks = allBlocks.filter(block => 
    block.BlockType === 'CELL' && 
    block.Relationships && 
    block.Relationships.some(rel => rel.Type === 'CHILD' && rel.Ids.includes(tableBlock.Id))
  );
  
  // Organize cells by row and column
  cellBlocks.forEach(cell => {
    const rowIndex = cell.RowIndex - 1;
    const colIndex = cell.ColumnIndex - 1;
    
    // Update table dimensions
    table.rowCount = Math.max(table.rowCount, rowIndex + 1);
    table.columnCount = Math.max(table.columnCount, colIndex + 1);
    
    // Ensure row exists
    if (!table.rows[rowIndex]) {
      table.rows[rowIndex] = [];
    }
    
    // Get cell text
    const cellText = getTextFromBlock(cell, allBlocks);
    
    // Add cell to table
    table.rows[rowIndex][colIndex] = cellText;
  });
  
  return table;
}

// Helper function to get text from a block
function getTextFromBlock(block, allBlocks) {
  if (block.Text) {
    return block.Text;
  }
  
  if (block.Relationships) {
    const childRelation = block.Relationships.find(rel => rel.Type === 'CHILD');
    if (childRelation) {
      return childRelation.Ids
        .map(id => allBlocks.find(b => b.Id === id))
        .filter(b => b && b.Text)
        .map(b => b.Text)
        .join(' ');
    }
  }
  
  return '';
}

// Helper function to get value block for a key block
function getValueBlock(keyBlock, allBlocks) {
  if (keyBlock.Relationships) {
    const valueRelation = keyBlock.Relationships.find(rel => rel.Type === 'VALUE');
    if (valueRelation && valueRelation.Ids.length > 0) {
      return allBlocks.find(b => b.Id === valueRelation.Ids[0]);
    }
  }
  
  return null;

// Process document and store embeddings
async function processDocument(bucket, key) {
  let client;
  try {
    // Extract text and metadata from document
    const extractedContent = await extractTextFromDocument(bucket, key);
    
    // Connect to database pool
    const pool = await connectToDatabase();
    
    // Get a client from the pool
    client = await pool.connect();
    
    // Insert document metadata
    const documentResult = await client.query(
      `INSERT INTO documents 
       (document_key, title, source, author, file_type, file_size, metadata) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (document_key) 
       DO UPDATE SET 
         title = $2,
         source = $3,
         author = $4,
         file_type = $5,
         file_size = $6,
         metadata = $7,
         last_updated = CURRENT_TIMESTAMP
       RETURNING id`,
      [
        key,
        extractedContent.title || key.split('/').pop(),
        extractedContent.metadata.source || bucket,
        extractedContent.metadata.author || null,
        extractedContent.metadata.fileExtension,
        extractedContent.metadata.fileSize,
        JSON.stringify(extractedContent.metadata)
      ]
    );
    
    const documentId = documentResult.rows[0].id;
    
    // Create chunks using advanced chunking strategy
    const chunks = createChunks(extractedContent);
    
    console.log(`Created ${chunks.length} chunks for document ${key}`);
    
    // Process each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      // Generate embedding for chunk
      const embedding = await generateEmbeddings(chunk.content);
      
      // Store in database
      await client.query(
        `INSERT INTO document_chunks 
         (document_id, chunk_index, content, embedding, chunk_type, heading, importance_score, metadata) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          documentId,
          i,
          chunk.content,
          embedding,
          chunk.type || 'text',
          chunk.heading || null,
          chunk.importanceScore || 1.0,
          JSON.stringify(chunk.metadata || {})
        ]
      );
      
      // For backward compatibility, also insert into the old table
      const legacyDocumentId = `${key}_chunk_${i + 1}`;
      await client.query(
        'INSERT INTO document_embeddings (document_id, content, embedding) VALUES ($1, $2, $3)',
        [legacyDocumentId, chunk.content, embedding]
      );
      
      console.log(`Processed chunk ${i + 1}/${chunks.length} for document ${key}`);
    }
    
    return {
      success: true,
      documentId: key,
      databaseId: documentId,
      chunks: chunks.length
    };
  } catch (error) {
    console.error('Error processing document:', error);
    throw error;
  } finally {
    // Always release the client back to the pool
    if (client) {
      client.release();
    }
  }
}

// Create chunks using advanced chunking strategies
function createChunks(extractedContent) {
  const { text, structure, metadata } = extractedContent;
  const chunks = [];
  
  // Configuration for chunking
  const config = {
    targetChunkSize: 1000,     // Target size for each chunk in characters
    maxChunkSize: 8000,        // Maximum size for any chunk
    minChunkSize: 100,         // Minimum size for any chunk
    overlapSize: 200,          // Number of characters to overlap between chunks
    sentenceEndingChars: ['.', '!', '?', '\n\n']  // Characters that indicate good break points
  };
  
  // If we have structure information, use it for semantic chunking
  if (structure && structure.length > 0) {
    return createStructuredChunks(text, structure, metadata, config);
  } else {
    // Fall back to semantic chunking without structure
    return createSemanticChunks(text, metadata, config);
  }
}

// Create chunks based on document structure (headings)
function createStructuredChunks(text, structure, metadata, config) {
  const chunks = [];
  
  // Sort structure elements by their position in the text
  const sortedStructure = [...structure].sort((a, b) => a.startPosition - b.startPosition);
  
  // Add end of document as the final position
  sortedStructure.push({
    startPosition: text.length,
    level: 0,
    text: 'END_OF_DOCUMENT'
  });
  
  // Process each section defined by headings
  for (let i = 0; i < sortedStructure.length - 1; i++) {
    const currentHeading = sortedStructure[i];
    const nextHeading = sortedStructure[i + 1];
    
    // Extract section text
    const sectionStart = currentHeading.startPosition;
    const sectionEnd = nextHeading.startPosition;
    const sectionText = text.substring(sectionStart, sectionEnd);
    
    // Skip empty sections
    if (sectionText.trim().length === 0) continue;
    
    // For very short sections, keep them as a single chunk
    if (sectionText.length <= config.maxChunkSize) {
      chunks.push({
        content: sectionText,
        type: 'section',
        heading: currentHeading.text,
        importanceScore: calculateImportanceScore(currentHeading, sectionText),
        metadata: {
          headingLevel: currentHeading.level,
          sectionIndex: i,
          ...metadata
        }
      });
    } else {
      // For longer sections, split into semantic chunks
      const sectionChunks = splitTextIntoChunks(sectionText, config);
      
      // Add heading and metadata to each chunk
      sectionChunks.forEach((chunk, chunkIndex) => {
        chunks.push({
          content: chunk,
          type: 'section_chunk',
          heading: currentHeading.text,
          importanceScore: calculateImportanceScore(currentHeading, chunk, chunkIndex),
          metadata: {
            headingLevel: currentHeading.level,
            sectionIndex: i,
            chunkIndex: chunkIndex,
            ...metadata
          }
        });
      });
    }
  }
  
  return chunks;
}

// Create semantic chunks without structure information
function createSemanticChunks(text, metadata, config) {
  const chunks = [];
  
  // Split text into semantic chunks
  const textChunks = splitTextIntoChunks(text, config);
  
  // Process each chunk
  textChunks.forEach((chunk, index) => {
    // Try to extract a title from the first chunk
    let chunkTitle = null;
    if (index === 0) {
      // Look for potential title in the first few lines
      const lines = chunk.split('\n').filter(line => line.trim().length > 0);
      if (lines.length > 0 && lines[0].length < 100) {
        chunkTitle = lines[0];
      }
    }
    
    chunks.push({
      content: chunk,
      type: 'text_chunk',
      heading: chunkTitle,
      importanceScore: 1.0,
      metadata: {
        chunkIndex: index,
        ...metadata
      }
    });
  });
  
  return chunks;
}

// Split text into chunks at semantic boundaries
function splitTextIntoChunks(text, config) {
  const chunks = [];
  let currentChunk = '';
  let lastBreakPoint = 0;
  
  // Process text character by character
  for (let i = 0; i < text.length; i++) {
    currentChunk += text[i];
    
    // Check if we're at a potential break point
    const isBreakPoint = config.sentenceEndingChars.includes(text[i]);
    
    if (isBreakPoint) {
      lastBreakPoint = currentChunk.length;
    }
    
    // If we've reached target chunk size and we have a break point, create a chunk
    if (currentChunk.length >= config.targetChunkSize && lastBreakPoint > 0) {
      // Create chunk up to the last break point
      const chunkText = currentChunk.substring(0, lastBreakPoint);
      chunks.push(chunkText);
      
      // Start new chunk with overlap
      const overlapStart = Math.max(0, lastBreakPoint - config.overlapSize);
      currentChunk = currentChunk.substring(overlapStart);
      lastBreakPoint = 0;
    }
    
    // If we've reached max chunk size, force a break
    if (currentChunk.length >= config.maxChunkSize) {
      chunks.push(currentChunk);
      currentChunk = '';
      lastBreakPoint = 0;
    }
  }
  
  // Add the final chunk if it's not empty and meets minimum size
  if (currentChunk.length >= config.minChunkSize) {
    chunks.push(currentChunk);
  } else if (currentChunk.length > 0 && chunks.length > 0) {
    // Append to the last chunk if it's too small
    chunks[chunks.length - 1] += currentChunk;
  } else if (currentChunk.length > 0) {
    // If it's the only chunk, keep it despite being small
    chunks.push(currentChunk);
  }
  
  return chunks;
}

// Calculate importance score for a chunk based on heading level and content
function calculateImportanceScore(heading, text, chunkIndex = 0) {
  let score = 1.0;
  
  // Higher score for higher-level headings (h1 > h2 > h3)
  if (heading && heading.level) {
    score += (7 - Math.min(heading.level, 6)) * 0.1;
  }
  
  // Higher score for first chunk in a section
  if (chunkIndex === 0) {
    score += 0.2;
  }
  
  // Higher score for chunks with keywords like "important", "key", "summary"
  const keywords = ['important', 'key', 'summary', 'conclusion', 'result', 'finding'];
  const textLower = text.toLowerCase();
  
  keywords.forEach(keyword => {
    if (textLower.includes(keyword)) {
      score += 0.1;
    }
  });
  
  // Cap the score at 2.0
  return Math.min(score, 2.0);
}

// Generate pre-signed URL for document upload
async function generateUploadUrl(key, contentType) {
  const command = new PutObjectCommand({
    Bucket: process.env.DOCUMENT_BUCKET,
    Key: key,
    ContentType: contentType
  });
  
  return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

// Main handler function
exports.handler = async (event) => {
  try {
    // Check if this is an S3 event (document uploaded)
    if (event.Records && event.Records[0]?.eventSource === 'aws:s3') {
      const bucket = event.Records[0].s3.bucket.name;
      const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));
      
      // Process the document
      const result = await processDocument(bucket, key);
      
      return {
        statusCode: 200,
        body: JSON.stringify(result)
      };
    } 
    // Check if this is an API request for upload URL
    else if (event.httpMethod === 'POST' && event.path === '/upload-url') {
      const body = JSON.parse(event.body);
      const { fileName, contentType } = body;
      
      // Generate a unique key
      const key = `documents/${Date.now()}-${fileName}`;
      
      // Generate pre-signed URL
      const uploadUrl = await generateUploadUrl(key, contentType);
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          uploadUrl,
          key
        })
      };
    }
    // Handle other API requests
    else {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'Invalid request'
        })
      };
    }
  } catch (error) {
    console.error('Error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'An error occurred while processing your request',
        details: error.message
      })
    };
  }
};

// =============================================================================
// DATABASE CLEANUP FUNCTIONS
// =============================================================================

// Clean up failed processing attempts and temporary data
async function cleanupProcessingData() {
  try {
    const pool = await getDbPool();
    
    // Clean up failed processing attempts (older than 24 hours)
    const cleanupFailedProcessing = `
      DELETE FROM processing_logs 
      WHERE status = 'failed' 
      AND created_at < NOW() - INTERVAL '24 hours'
    `;
    
    // Clean up temporary processing data
    const cleanupTempData = `
      DELETE FROM document_chunks 
      WHERE content IS NULL OR content = '' 
      AND created_at < NOW() - INTERVAL '1 hour'
    `;
    
    console.log('Starting document processing cleanup...');
    
    // Check if processing_logs table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'processing_logs'
      )
    `);
    
    let failedResult = { rowCount: 0 };
    if (tableExists.rows[0].exists) {
      failedResult = await pool.query(cleanupFailedProcessing);
      console.log(`Cleaned up ${failedResult.rowCount} failed processing attempts`);
    }
    
    const tempResult = await pool.query(cleanupTempData);
    console.log(`Cleaned up ${tempResult.rowCount} temporary document chunks`);
    
    console.log('Document processing cleanup completed');
    
    return {
      failedProcessingDeleted: failedResult.rowCount,
      tempDataDeleted: tempResult.rowCount
    };
    
  } catch (error) {
    console.error('Error during document processing cleanup:', error);
    throw error;
  }
}

// Clean up database connections
async function cleanupConnections() {
  try {
    if (dbPool) {
      console.log('Closing document processor database connection pool...');
      await dbPool.end();
      dbPool = null;
      console.log('Document processor database connection pool closed');
    }
  } catch (error) {
    console.error('Error closing document processor database connections:', error);
  }
}

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  console.log('SIGTERM received in document processor, performing graceful shutdown...');
  await cleanupConnections();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received in document processor, performing graceful shutdown...');
  await cleanupConnections();
  process.exit(0);
});

// Export cleanup functions for testing
exports.cleanupProcessingData = cleanupProcessingData;
exports.cleanupConnections = cleanupConnections;
