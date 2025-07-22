/**
 * Jest global setup file
 * Runs once before all tests
 */

module.exports = async () => {
  console.log('🚀 Starting test suite...');
  
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.AWS_REGION = 'us-east-1';
  process.env.REGION = 'us-east-1';
  process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-secret';
  process.env.BEDROCK_MODEL_ID = 'amazon.nova-lite-v1';
  process.env.DOCUMENT_BUCKET = 'test-document-bucket';
  process.env.CLEANUP_TOKEN = 'test-cleanup-token';
  
  // Suppress AWS SDK warnings in tests
  process.env.AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE = '1';
  
  console.log('✅ Test environment configured');
};
