#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const WebSocket = require('ws');

// Colors for output formatting
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const NC = '\x1b[0m'; // No Color

// Test configuration
const config = {
  stackName: 'ChatbotRagStack',
  region: process.env.AWS_REGION || 'us-east-1',
  testQuestions: [
    'What services do you offer?',
    'What are your business hours?',
    'How can I contact customer support?'
  ]
};

// Get stack outputs
async function getStackOutputs() {
  try {
    console.log(`${BLUE}Getting stack outputs...${NC}`);
    const output = execSync(`aws cloudformation describe-stacks --stack-name ${config.stackName} --region ${config.region} --query "Stacks[0].Outputs" --output json`);
    const outputs = JSON.parse(output);
    
    const result = {};
    outputs.forEach(output => {
      result[output.OutputKey] = output.OutputValue;
    });
    
    return result;
  } catch (error) {
    console.error(`${RED}Error getting stack outputs:${NC}`, error.message);
    throw error;
  }
}

// Get API key
async function getApiKey(apiKeyId) {
  try {
    console.log(`${BLUE}Getting API key...${NC}`);
    const output = execSync(`aws apigateway get-api-key --api-key ${apiKeyId} --include-value --region ${config.region} --query "value" --output text`);
    return output.toString().trim();
  } catch (error) {
    console.error(`${RED}Error getting API key:${NC}`, error.message);
    throw error;
  }
}

// Test REST API
async function testRestApi(apiEndpoint, apiKey) {
  console.log(`${BLUE}Testing REST API...${NC}`);
  
  try {
    const response = await fetch(apiEndpoint + '/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify({
        message: 'Test message',
        streaming: false
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.response) {
      console.log(`${GREEN}✓ REST API test successful${NC}`);
      return true;
    } else {
      console.log(`${RED}✗ REST API test failed: Invalid response format${NC}`);
      return false;
    }
  } catch (error) {
    console.error(`${RED}✗ REST API test failed:${NC}`, error.message);
    return false;
  }
}

// Test WebSocket API
async function testWebSocketApi(websocketUrl) {
  console.log(`${BLUE}Testing WebSocket API...${NC}`);
  
  return new Promise((resolve) => {
    try {
      const socket = new WebSocket(websocketUrl);
      let success = false;
      let timeout;
      
      // Set timeout for connection
      timeout = setTimeout(() => {
        console.log(`${RED}✗ WebSocket API test failed: Connection timeout${NC}`);
        socket.terminate();
        resolve(false);
      }, 10000);
      
      socket.onopen = () => {
        console.log(`${BLUE}WebSocket connection established${NC}`);
        
        // Send a test message
        socket.send(JSON.stringify({
          action: 'sendMessage',
          message: 'Test message'
        }));
      };
      
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'start' || data.type === 'chunk' || data.type === 'end') {
            success = true;
            clearTimeout(timeout);
            console.log(`${GREEN}✓ WebSocket API test successful${NC}`);
            socket.close();
            resolve(true);
          }
        } catch (error) {
          console.error(`${RED}Error parsing WebSocket message:${NC}`, error.message);
        }
      };
      
      socket.onclose = () => {
        if (!success) {
          console.log(`${RED}✗ WebSocket API test failed: Connection closed${NC}`);
          clearTimeout(timeout);
          resolve(false);
        }
      };
      
      socket.onerror = (error) => {
        console.error(`${RED}✗ WebSocket API test failed:${NC}`, error.message);
        clearTimeout(timeout);
        resolve(false);
      };
    } catch (error) {
      console.error(`${RED}✗ WebSocket API test failed:${NC}`, error.message);
      resolve(false);
    }
  });
}

// Test CloudFront distribution
async function testCloudFront(cloudFrontDomain) {
  console.log(`${BLUE}Testing CloudFront distribution...${NC}`);
  
  try {
    // Test widget.js
    const widgetResponse = await fetch(`https://${cloudFrontDomain}/widget.js`);
    if (!widgetResponse.ok) {
      throw new Error(`HTTP error! Status: ${widgetResponse.status}`);
    }
    
    // Test index.html
    const indexResponse = await fetch(`https://${cloudFrontDomain}/index.html`);
    if (!indexResponse.ok) {
      throw new Error(`HTTP error! Status: ${indexResponse.status}`);
    }
    
    console.log(`${GREEN}✓ CloudFront test successful${NC}`);
    return true;
  } catch (error) {
    console.error(`${RED}✗ CloudFront test failed:${NC}`, error.message);
    return false;
  }
}

// Test database connection
async function testDatabase(databaseEndpoint) {
  console.log(`${BLUE}Testing database connection...${NC}`);
  
  try {
    // This is a simple check to see if the database endpoint resolves
    const { promisify } = require('util');
    const dns = require('dns');
    const lookup = promisify(dns.lookup);
    
    await lookup(databaseEndpoint);
    console.log(`${GREEN}✓ Database endpoint resolves${NC}`);
    
    // Note: A full test would require credentials and a connection
    // which we don't want to do in a test script for security reasons
    
    return true;
  } catch (error) {
    console.error(`${RED}✗ Database endpoint test failed:${NC}`, error.message);
    return false;
  }
}

// Main function
async function main() {
  console.log(`${BLUE}=== Testing Chatbot RAG Deployment ===${NC}\n`);
  
  try {
    // Get stack outputs
    const outputs = await getStackOutputs();
    console.log(`${GREEN}✓ Stack outputs retrieved${NC}`);
    
    // Get API key
    const apiKey = await getApiKey(outputs.ApiKeyId);
    console.log(`${GREEN}✓ API key retrieved${NC}`);
    
    // Run tests
    const results = {
      restApi: await testRestApi(outputs.ApiEndpoint, apiKey),
      webSocket: await testWebSocketApi(outputs.WebSocketApiUrl),
      cloudFront: await testCloudFront(outputs.CloudFrontDomain),
      database: await testDatabase(outputs.DatabaseEndpoint)
    };
    
    // Print summary
    console.log(`\n${BLUE}=== Test Summary ===${NC}`);
    Object.entries(results).forEach(([test, passed]) => {
      console.log(`${test}: ${passed ? GREEN + '✓ PASSED' : RED + '✗ FAILED'}${NC}`);
    });
    
    const allPassed = Object.values(results).every(result => result);
    
    if (allPassed) {
      console.log(`\n${GREEN}All tests passed! Your deployment is working correctly.${NC}`);
    } else {
      console.log(`\n${YELLOW}Some tests failed. Please check the logs above for details.${NC}`);
    }
    
    // Print integration instructions
    console.log(`\n${BLUE}=== Integration Instructions ===${NC}`);
    console.log(`Add the following code to your website:`);
    console.log(`${YELLOW}<script src="https://${outputs.CloudFrontDomain}/widget.js"></script>`);
    console.log(`<script>`);
    console.log(`  SmallBizChatbot.init({`);
    console.log(`    containerId: 'chatbot-container',`);
    console.log(`    theme: {`);
    console.log(`      primaryColor: '#4287f5',`);
    console.log(`      fontFamily: 'Arial, sans-serif'`);
    console.log(`    }`);
    console.log(`  });`);
    console.log(`</script>`);
    console.log(`<div id="chatbot-container"></div>${NC}`);
    
    console.log(`\n${BLUE}=== Demo Page ===${NC}`);
    console.log(`View the demo page at: ${YELLOW}https://${outputs.CloudFrontDomain}/index.html${NC}`);
    
  } catch (error) {
    console.error(`${RED}Error:${NC}`, error.message);
    process.exit(1);
  }
}

main();
