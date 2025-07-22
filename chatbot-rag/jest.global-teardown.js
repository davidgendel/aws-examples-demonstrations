/**
 * Jest global teardown file
 * Runs once after all tests
 */

module.exports = async () => {
  console.log('🧹 Cleaning up test environment...');
  
  // Clean up any global resources if needed
  // For example, close database connections, clear caches, etc.
  
  console.log('✅ Test cleanup completed');
};
