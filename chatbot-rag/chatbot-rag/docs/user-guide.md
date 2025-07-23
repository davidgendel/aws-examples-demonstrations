# RAG Chatbot User Guide

This guide provides detailed instructions for setting up, configuring, and using the RAG Chatbot solution.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Deployment](#deployment)
3. [Configuration](#configuration)
4. [Managing Your Knowledge Base](#managing-your-knowledge-base)
5. [Customizing the Widget](#customizing-the-widget)
6. [Monitoring and Maintenance](#monitoring-and-maintenance)
7. [Troubleshooting](#troubleshooting)
8. [FAQ](#faq)

## Getting Started

### Prerequisites

Before deploying the RAG Chatbot solution, ensure you have:

1. **AWS Account**: An AWS account with appropriate permissions
2. **AWS CLI**: Installed and configured with credentials
3. **Node.js**: Version 18 or higher
4. **npm**: Latest version
5. **AWS CDK**: Installed globally (`npm install -g aws-cdk`)

### System Requirements

- **Operating System**: Linux, macOS, or Windows with WSL
- **Memory**: At least 4GB RAM
- **Disk Space**: At least 1GB free space

## Deployment

### Using the Setup Wizard

The easiest way to deploy the solution is using the setup wizard:

1. Open a terminal and navigate to the project directory
2. Run the setup wizard:
   ```bash
   node setup.js
   ```
3. Follow the prompts to configure and deploy the solution

### Manual Deployment

If you prefer manual deployment:

1. Edit the `config.json` file to set your preferences
2. Run the deployment script:
   ```bash
   ./deploy.sh
   ```

### Verifying Deployment

After deployment completes:

1. Run the test script to verify all components are working:
   ```bash
   node scripts/test-deployment.js
   ```
2. Visit the demo page at the CloudFront URL provided in the deployment output
3. Try asking a few test questions to ensure the chatbot is responding correctly

## Configuration

### Configuration File

The `config.json` file contains all the configuration options for the solution:

```json
{
  "region": "us-east-1",
  "bedrock": {
    "modelId": "amazon.nova-lite-v1",
    "guardrails": {
      "createDefault": true
    }
  },
  "database": {
    "instanceType": "db.t4g.micro",
    "allocatedStorage": 20
  },
  "api": {
    "throttling": {
      "ratePerMinute": 10,
      "ratePerHour": 100
    }
  },
  "lambda": {
    "chatbot": {
      "provisionedConcurrency": {
        "enabled": true,
        "concurrentExecutions": 1
      }
    }
  },
  "widget": {
    "defaultTheme": {
      "primaryColor": "#4287f5",
      "secondaryColor": "#f5f5f5",
      "fontFamily": "Arial, sans-serif",
      "fontSize": "16px",
      "borderRadius": "8px"
    }
  }
}
```

### Key Configuration Options

- **region**: AWS region for deployment
- **bedrock.modelId**: Bedrock model to use for text generation
- **database.instanceType**: RDS instance type
- **lambda.chatbot.provisionedConcurrency**: Lambda provisioned concurrency settings
- **widget.defaultTheme**: Default appearance settings for the widget

## Managing Your Knowledge Base

### Adding Documents

To add documents to your knowledge base:

1. Create a folder for your documents:
   ```bash
   mkdir documents
   ```

2. Add your documents to the folder (supported formats: PDF, TXT, MD, HTML, CSV, JSON, PNG, JPG)

3. Upload the documents:
   ```bash
   npm run upload-docs -- --folder ./documents
   ```

### Document Processing

When you upload documents:

1. The system extracts text using Amazon Textract for PDFs and images
2. Documents are split into chunks using semantic boundaries
3. Vector embeddings are generated for each chunk
4. Chunks and embeddings are stored in the database

### Updating Documents

To update existing documents:

1. Upload a new version with the same filename
2. The system will automatically replace the old version

### Removing Documents

To remove documents from your knowledge base:

1. Delete the document from the S3 bucket using the AWS Console or CLI
2. Run the cleanup script to remove associated database entries:
   ```bash
   npm run cleanup-docs -- --key document-name.pdf
   ```

## Customizing the Widget

### Basic Integration

Add this code to your HTML page:

```html
<script src="https://your-cloudfront-distribution.cloudfront.net/widget.js"></script>
<script>
  SmallBizChatbot.init({
    containerId: 'chatbot-container'
  });
</script>
<div id="chatbot-container"></div>
```

### Customizing Appearance

```html
<script>
  SmallBizChatbot.init({
    containerId: 'chatbot-container',
    theme: {
      primaryColor: '#FF5733',
      secondaryColor: '#F8F9FA',
      fontFamily: 'Roboto, sans-serif',
      fontSize: '18px',
      borderRadius: '12px'
    },
    welcomeMessage: 'Hello! I\'m your company\'s AI assistant. How can I help you today?',
    placeholderText: 'Type your question here...'
  });
</script>
```

### Advanced Configuration

```html
<script>
  SmallBizChatbot.init({
    containerId: 'chatbot-container',
    streaming: true,
    cache: {
      enabled: true,
      maxEntries: 50,
      ttl: 7200000 // 2 hours in milliseconds
    },
    websocket: {
      reconnectAttempts: 3,
      reconnectInterval: 2000,
      connectionTimeout: 10000,
      heartbeatInterval: 60000
    },
    mobileToggle: true,
    suggestedQuestions: true,
    feedback: true,
    accessibility: {
      announcements: true,
      highContrast: false
    }
  });
</script>
```

### JavaScript API

```javascript
// Get chat history
const history = SmallBizChatbot.getHistory();

// Clear cache
SmallBizChatbot.clearCache();

// Enable/disable caching
SmallBizChatbot.setCacheEnabled(true);

// Enable/disable streaming
SmallBizChatbot.setStreamingEnabled(true);

// Get connection state
const state = SmallBizChatbot.getConnectionState();

// Manually reconnect WebSocket
SmallBizChatbot.reconnectWebSocket();
```

## Monitoring and Maintenance

### CloudWatch Dashboards

The solution creates two CloudWatch dashboards:

1. **ChatbotMonitoring**: Overall system monitoring
2. **BedrockPromptCacheMonitoring**: Bedrock prompt cache performance

To access these dashboards:

1. Open the AWS Console
2. Navigate to CloudWatch > Dashboards
3. Select the dashboard you want to view

### CloudWatch Alarms

The solution sets up the following alarms:

1. **ApiErrorRateAlarm**: Triggers when API Gateway 5XX errors exceed threshold
2. **LambdaErrorAlarm**: Triggers when Lambda function errors exceed threshold
3. **DatabaseCpuAlarm**: Triggers when database CPU utilization is too high

### Log Groups

The solution uses tiered log retention:

1. **Critical Logs**: Kept for 7 days
2. **Standard Logs**: Kept for 3 days
3. **Debug Logs**: Kept for 12 hours

### Regular Maintenance Tasks

1. **Update Knowledge Base**: Regularly update documents as information changes
2. **Monitor Costs**: Check AWS Cost Explorer to monitor usage costs
3. **Review Logs**: Periodically review logs for errors or issues
4. **Test Performance**: Run the test script to verify system performance

## Troubleshooting

### Common Issues

#### Chatbot Not Responding

1. Check that the API key is valid
2. Verify that the Lambda function is running correctly
3. Check CloudWatch Logs for errors

#### Slow Responses

1. Consider enabling provisioned concurrency
2. Check database performance metrics
3. Optimize document chunking

#### WebSocket Connection Issues

1. Check browser console for WebSocket errors
2. Verify that the WebSocket API is deployed correctly
3. Try manually reconnecting with `SmallBizChatbot.reconnectWebSocket()`

#### Document Processing Failures

1. Check that the document format is supported
2. Verify that the document is not too large
3. Check CloudWatch Logs for document processing errors

### Getting Support

If you encounter issues:

1. Check the troubleshooting guide in `docs/troubleshooting.md`
2. Review AWS service documentation
3. Open an issue on GitHub

## FAQ

### General Questions

**Q: How much does this solution cost to run?**
A: The base cost is approximately $15-20/month, with additional costs based on usage.

**Q: Which AWS regions are supported?**
A: Any region where Amazon Bedrock is available.

**Q: Can I use my own domain name?**
A: Yes, you can set up a custom domain in API Gateway and CloudFront.

### Technical Questions

**Q: How are documents processed?**
A: Documents are processed using Amazon Textract, split into semantic chunks, and stored as vector embeddings.

**Q: How does the chatbot know which information to retrieve?**
A: The system uses vector similarity search to find the most relevant document chunks.

**Q: Can I customize the AI model?**
A: Yes, you can change the Bedrock model in the configuration file.

**Q: How secure is the solution?**
A: The solution includes API key authentication, WAF protection, and encrypted storage.
