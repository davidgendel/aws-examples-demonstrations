# Low-Cost RAG Chatbot Solution (Python 3.12)

A serverless, cost-effective generative AI chatbot solution with Retrieval-Augmented Generation (RAG) capabilities for small to medium businesses. **Starting at just $29.76/month** with Graviton3 ARM64 architecture. Built with Python 3.12 for improved performance and modern language features.

## Solution Overview

This solution provides a customizable chatbot that can be embedded into existing websites. It leverages AWS serverless and managed services with **Graviton3 processors** to minimize costs while delivering superior performance and high availability.

### Key Features

- **Embedded JavaScript Widget**: Easily integrate into any website with customizable appearance
- **RAG Capabilities**: Enhance responses with your business-specific knowledge base
- **Real-time Streaming**: WebSocket-based streaming responses for better user experience
- **Cost-Effective**: Serverless architecture minimizes costs during low-usage periods
- **Highly Available**: Built on AWS managed services for reliability
- **Secure**: Includes rate limiting, content moderation, WAF protection, and AWS security best practices
- **Customizable**: Easily modify appearance to match your brand
- **Client-Side Caching**: Reduces API calls for repeated questions with configurable TTL
- **Multi-format Document Support**: Process PDF, text, images, and more using Amazon Textract
- **Automatic Database Setup**: PostgreSQL with pgvector extension for vector similarity search

### Architecture

The solution uses the following AWS services:

- **Amazon API Gateway**: REST API for chat requests with API key authentication
- **API Gateway WebSocket API**: Real-time streaming responses
- **AWS Lambda**: 
  - Main chatbot function (handles chat logic and streaming) - **Graviton3 ARM64 architecture**
  - Document processor function (processes uploaded documents) - **Graviton3 ARM64 architecture**
- **Amazon Bedrock**: 
  - Amazon Nova Lite for cost-effective, high-quality text generation
  - Amazon Titan Embeddings for vector generation
  - Bedrock Guardrails for comprehensive content moderation
- **Amazon RDS (PostgreSQL)**: Vector database with pgvector extension for similarity search
- **Amazon S3**: 
  - Document storage bucket for knowledge base files
  - Website assets bucket for frontend files
- **Amazon CloudFront**: CDN for frontend asset delivery
- **Amazon Textract**: Extract text from documents and images
- **AWS Secrets Manager**: Automatic database credential management and rotation
- **AWS WAF**: Web application firewall with managed rule sets and rate limiting
- **AWS CloudWatch**: Monitoring, logging, and metrics (7-day log retention)

## Cost Estimation

This solution is designed to be cost-effective for small to medium businesses, with **significant cost savings from Graviton3 ARM64 architecture**. Below are detailed cost estimates for three realistic usage scenarios, assuming 15-25 documents with 60MB total storage.

### **Detailed Cost Analysis by Usage Scenario**

| **Usage Scenario** | **Daily Users** | **Interactions/User** | **Monthly Cost** | **Annual Cost** | **Cost/User/Month** |
|-------------------|-----------------|----------------------|------------------|-----------------|-------------------|
| **Small Business** | 50 | 10 | **$29.76** | **$357.12** | **$0.60** |
| **Growing Business** | 150 | 12 | **$33.52** | **$402.24** | **$0.22** |
| **Medium Business** | 500 | 15 | **$72.41** | **$868.92** | **$0.14** |

### **Cost Breakdown by Scenario**

#### **Small Business (50 users, 500 daily interactions)**
- **Database (RDS t4g.micro)**: $19.38/month (65.1%)
- **Security (WAF)**: $8.01/month (26.9%)
- **AI/ML (Bedrock)**: $0.94/month (3.1%)
- **Compute (Lambda)**: $1.11/month (3.7%)
- **Other Services**: $0.32/month (1.2%)

#### **Growing Business (150 users, 1,800 daily interactions)**
- **Database (RDS t4g.micro)**: $19.38/month (57.8%)
- **Security (WAF)**: $8.03/month (24.0%)
- **AI/ML (Bedrock)**: $3.35/month (10.0%)
- **Compute (Lambda)**: $1.61/month (4.8%)
- **Other Services**: $1.15/month (3.4%)

#### **Medium Business (500 users, 7,500 daily interactions)**
- **Database (RDS t4g.small)**: $40.87/month (56.4%)
- **AI/ML (Bedrock)**: $13.96/month (19.3%)
- **Security (WAF)**: $8.14/month (11.2%)
- **Compute (Lambda)**: $4.69/month (6.5%)
- **Other Services**: $4.75/month (6.6%)

### **Graviton3 Architecture Cost Savings**

**Compared to traditional x86_64 architecture:**
- **Small Business**: $12.60/year savings (40% Lambda cost reduction)
- **Growing Business**: $15.00/year savings
- **Medium Business**: $30.12/year savings

### **Cost Efficiency at Scale**

The solution becomes significantly more cost-effective as usage increases:
- **Cost per interaction**: Decreases from $0.00198 to $0.00032 (84% reduction)
- **Cost per user**: Decreases from $0.60 to $0.14 per month (77% reduction)

### **Service-Specific Pricing**

**AWS Lambda (Graviton3 ARM64):**
- Requests: $0.20 per 1M requests
- Duration: $0.0000133333 per GB-second (20% discount vs x86_64)
- Provisioned Concurrency: $0.0000033333 per GB-hour (20% discount vs x86_64)

**Amazon Bedrock:**
- Nova Lite Input: $0.00006 per 1K tokens
- Nova Lite Output: $0.00024 per 1K tokens
- Titan Embeddings: $0.0001 per 1K tokens

**Amazon RDS PostgreSQL:**
- t4g.micro: $15.18/month (suitable for up to 150 users)
- t4g.small: $30.37/month (recommended for 500+ users)
- Storage: $0.115 per GB/month
- Backup: $0.095 per GB/month

**Other Services:**
- API Gateway: $3.50 per 1M requests + $0.09 per GB data transfer
- S3 Standard: $0.023 per GB/month
- CloudFront: $0.085 per GB transferred
- WAF: $8.00/month + $0.60 per 1M requests
- CloudWatch: $0.50 per GB ingested, $0.03 per GB stored

*Note: All costs are based on US-East-1 pricing as of 2024. Actual costs may vary based on usage patterns, document size, AWS pricing changes, and regional differences. Graviton3 ARM64 architecture provides significant cost savings through improved performance and efficiency.*

### **Cost Optimization Recommendations**

#### **For Small Business (50 users/day):**
- **Database**: t4g.micro RDS is sufficient
- **Provisioned Concurrency**: 1 execution recommended
- **Alternative**: Consider on-demand only to save $0.91/month (total: $28.85/month)
- **Total Cost**: $29.76/month

#### **For Growing Business (150 users/day):**
- **Database**: t4g.micro RDS adequate, monitor performance
- **Provisioned Concurrency**: 1-2 executions based on peak usage
- **Consider**: Upgrading to 2 executions during high-traffic periods
- **Total Cost**: $33.52/month

#### **For Medium Business (500+ users/day):**
- **Database**: Upgrade to t4g.small RDS (included in cost estimate)
- **Provisioned Concurrency**: 2 executions recommended
- **Consider**: ElastiCache for improved performance (+$15-20/month)
- **Consider**: Read replicas for database scaling
- **Total Cost**: $72.41/month

### **3-Year Total Cost of Ownership**

| **Business Size** | **Monthly** | **Annual** | **3-Year Total** |
|-------------------|-------------|------------|------------------|
| **Small (50 users)** | $29.76 | $357.12 | **$1,071.36** |
| **Growing (150 users)** | $33.52 | $402.24 | **$1,206.72** |
| **Medium (500 users)** | $72.41 | $868.92 | **$2,606.76** |

> 📊 **For detailed cost breakdowns, service-specific pricing, and optimization strategies, see [docs/cost-analysis.md](docs/cost-analysis.md)**

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI installed and configured
- Python 3.12+ (recommended) or Python 3.9+
- AWS CDK v2 installed globally (`pip install aws-cdk-lib`)
- Basic knowledge of AWS services

## Deployment Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/chatbot-rag.git
cd chatbot-rag
```

### 2. Create a Python Virtual Environment (Optional but Recommended)

```bash
python3.13 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure the Solution

Edit the `config.json` file to set your preferences:

```json
{
  "region": "us-east-1",
  "bedrock": {
    "modelId": "amazon.nova-lite-v1",
    "guardrails": {
      "createDefault": true,
      "defaultGuardrailConfig": {
        "name": "ChatbotDefaultGuardrail",
        "description": "Default guardrail for small business chatbot",
        "contentPolicyConfig": {
          "filters": [
            {
              "type": "SEXUAL",
              "strength": "MEDIUM"
            },
            {
              "type": "VIOLENCE",
              "strength": "MEDIUM"
            },
            {
              "type": "HATE",
              "strength": "MEDIUM"
            },
            {
              "type": "INSULTS",
              "strength": "MEDIUM"
            }
          ]
        },
        "wordPolicyConfig": {
          "managedWordLists": [
            {
              "type": "PROFANITY"
            }
          ],
          "customWordLists": []
        },
        "sensitiveInformationPolicyConfig": {
          "piiEntities": [
            {
              "type": "ALL",
              "action": "BLOCK"
            }
          ]
        },
        "topicPolicyConfig": {
          "topics": [
            {
              "name": "Politics",
              "type": "DENY"
            },
            {
              "name": "Financial advice",
              "type": "DENY"
            },
            {
              "name": "Legal advice",
              "type": "DENY"
            }
          ]
        }
      }
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

#### Lambda Configuration

The solution uses **Graviton3 ARM64 architecture** for all Lambda functions, providing superior performance and cost efficiency:

**Architecture Benefits:**
- **25% better compute performance** than Graviton2
- **Up to 2x better floating-point performance** for ML/AI workloads
- **20% better memory performance** with DDR5 support
- **Significant cost savings** through improved efficiency

**Provisioned Concurrency:**
- **enabled**: Set to `true` to enable provisioned concurrency
- **concurrentExecutions**: Number of concurrent executions to keep warm (minimum: 1, recommended: 1-2 for small business)

**Cost Impact with Graviton3:**
- 1 concurrent execution: ~$0.91/month additional (60% reduction from x86_64)
- 2 concurrent executions: ~$1.83/month additional (60% reduction from x86_64)

**Note**: Provisioned concurrency is only applied to the chatbot function, not the document processor.

#### Guardrail Configuration

The solution includes comprehensive Bedrock Guardrail configuration with the following policies:

- **Content Policy**: Filter harmful content (SEXUAL, VIOLENCE, HATE, INSULTS)
- **Word Policy**: Block profanity and custom word lists
- **Sensitive Information Policy**: Prevent PII leakage (blocks ALL PII types)
- **Topic Policy**: Block specific topics (politics, financial advice, legal advice)

Adjust the strength levels (LOW, MEDIUM, HIGH) and policies based on your requirements.

### 4. Bootstrap CDK (First Time Only)

If you haven't used CDK in your AWS account/region before:

```bash
cdk bootstrap
```

### 5. Deploy the Infrastructure

```bash
./deploy.sh
```

This automated deployment script will:
- Validate prerequisites
- Install dependencies
- Deploy infrastructure using CDK
- Configure the widget with deployment outputs
- Upload frontend assets to S3
- Process any documents in the `documents` folder

### 6. Upload Knowledge Base Documents

Create a `documents` folder and add your knowledge base files:

```bash
mkdir documents
# Add your PDF, TXT, MD, HTML, PNG, JPG files to the documents folder
python -m scripts.upload_documents --folder ./documents
```

Supported file formats:
- Text files: `.txt`, `.md`, `.html`, `.htm`, `.csv`, `.json`
- Documents: `.pdf`
- Images: `.png`, `.jpg`, `.jpeg`, `.tiff`

### 7. Integrate the Widget

Add the following code to your website:

```html
<script src="https://your-cloudfront-distribution.cloudfront.net/widget.js"></script>
<script>
  SmallBizChatbot.init({
    containerId: 'chatbot-container',
    theme: {
      primaryColor: '#4287f5',
      fontFamily: 'Arial, sans-serif'
    }
  });
</script>
<div id="chatbot-container"></div>
```

The deployment script will provide you with the exact CloudFront URL to use.

## Customization

### Widget Appearance

You can customize the appearance of the chatbot by modifying the theme options:

```javascript
SmallBizChatbot.init({
  containerId: 'chatbot-container',
  theme: {
    primaryColor: '#your-brand-color',
    secondaryColor: '#your-secondary-color',
    fontFamily: 'Your-Font, sans-serif',
    fontSize: '16px',
    borderRadius: '8px'
  }
});
```

### Client-Side Caching

The widget includes client-side caching to reduce API calls for repeated questions. You can customize the caching behavior:

```javascript
SmallBizChatbot.init({
  containerId: 'chatbot-container',
  cache: {
    enabled: true,           // Enable/disable caching
    maxEntries: 20,          // Maximum number of cached responses
    ttl: 3600000             // Time-to-live in milliseconds (1 hour default)
  }
});
```

To clear the cache programmatically:

```javascript
SmallBizChatbot.clearCache();
```

### Response Streaming

The widget supports response streaming for a better user experience. You can enable or disable streaming:

```javascript
SmallBizChatbot.init({
  containerId: 'chatbot-container',
  streaming: true            // Enable/disable streaming
});
```

To toggle streaming programmatically:

```javascript
SmallBizChatbot.setStreamingEnabled(true); // or false
```

### Knowledge Base Management

To update your knowledge base:

1. Add new documents to your documents folder
2. Run the upload script:
   ```bash
   python -m scripts.upload_documents --folder ./your-documents-folder
   ```

## Implementation Details

### Amazon Nova Lite Model

This solution uses Amazon Nova Lite, a cost-effective foundation model from AWS that provides high-quality responses while keeping costs low. Nova Lite offers:

- Excellent performance for general knowledge questions
- Good context understanding for RAG applications
- Lower cost compared to larger models
- Fast response times

### WebSocket Streaming

The chatbot supports real-time response streaming through WebSocket connections:

- Responses begin appearing immediately as they're generated
- Uses API Gateway WebSocket API for real-time communication
- Falls back to standard REST API if WebSocket is not available
- Provides better user experience with immediate feedback

### Vector Database

The solution uses PostgreSQL with the pgvector extension for efficient similarity search:

- Automatic setup of pgvector extension
- Optimized indexing for fast vector similarity queries
- Supports up to 1536-dimensional embeddings (Amazon Titan)
- Configurable similarity thresholds

### Document Processing Pipeline

Documents are processed automatically when uploaded to S3:

1. **Text Extraction**: Uses Amazon Textract for PDFs and images, direct reading for text files
2. **Metadata Extraction**: Extracts document metadata including title, author, date, and structure
3. **Semantic Chunking**: Intelligently splits documents based on semantic boundaries and structure
4. **Embedding Generation**: Creates vector embeddings using Amazon Titan
5. **Storage**: Stores embeddings and metadata in PostgreSQL with pgvector
6. **Indexing**: Automatically creates vector similarity indexes

#### Advanced Chunking Strategies

The solution implements several advanced chunking strategies:

1. **Structure-Based Chunking**: Uses document headings and sections to create semantically meaningful chunks
2. **Semantic Boundary Detection**: Splits text at natural boundaries like paragraph ends and sentence breaks
3. **Chunk Overlap**: Maintains context between chunks with configurable overlap
4. **Importance Scoring**: Assigns higher importance to chunks with headings, introductions, and conclusions
5. **Metadata Enrichment**: Each chunk includes relevant metadata about its source and context

#### Metadata Extraction

The solution extracts and stores rich metadata from documents:

1. **Document Structure**: Headings, sections, and hierarchical organization
2. **Content Types**: Identifies tables, forms, and special content
3. **Source Information**: Tracks document origin, author, and creation date
4. **File Properties**: Size, type, and modification dates
5. **Custom Attributes**: Supports custom metadata for domain-specific information

### Security Features

The solution implements multiple layers of security:

- **API Key Authentication**: All API requests require valid API keys
- **Rate Limiting**: Configurable throttling at API Gateway level
- **WAF Protection**: AWS WAF with managed rule sets and custom rate limiting
- **Content Moderation**: Bedrock Guardrails filter inappropriate content
- **Database Security**: Security groups restrict access to the database
- **Encryption**: All data encrypted at rest and in transit
- **Credential Rotation**: Automatic database credential rotation every 90 days

### Retry Logic and Error Handling

The Lambda functions include comprehensive error handling:

- **Exponential Backoff**: Automatic retries with increasing delays
- **Circuit Breaker Pattern**: Prevents cascading failures
- **Graceful Degradation**: Falls back to cached responses when possible
- **Detailed Logging**: CloudWatch logs for debugging and monitoring

### Bedrock Prompt Caching

The solution leverages Amazon Bedrock's built-in prompt caching feature to reduce costs and improve response times:

- **Automatic Caching**: Identical prompts are cached for 3 days (72 hours)
- **Cost Savings**: You're only charged for the initial model invocation, not for subsequent cached responses
- **Improved Latency**: Cached responses are returned more quickly than generating new responses
- **Monitoring**: CloudWatch dashboard tracks cache hit rates and performance metrics

Prompt caching is enabled for both text generation and embedding generation, providing cost savings across all aspects of the solution.

**Expected Cost Savings:**
- Small Business (50 users/day): ~$0.10-0.15/month savings
- Growing Business (150 users/day): ~$0.35-0.50/month savings
- Medium Business (500 users/day): ~$1.40-2.00/month savings

### Provisioned Concurrency

The solution includes optional provisioned concurrency for the chatbot Lambda function only:

- **Eliminates Cold Starts**: Keeps Lambda functions warm and ready to respond
- **Consistent Performance**: Provides predictable response times
- **Configurable**: Can be enabled/disabled via configuration
- **Cost-Effective**: Only provisions the minimum needed capacity (default: 1 concurrent execution)
- **Auto-Scaling**: Can scale up to 2x the provisioned capacity during traffic spikes
- **Targeted**: Only applied to chatbot function, not document processor (which doesn't need immediate response)

When enabled, the solution creates a Lambda alias with provisioned concurrency, ensuring immediate response times for chat requests.

**Cost Analysis with Graviton3:**
- **1 concurrent execution**: $0.91/month (60% reduction from x86_64)
- **2 concurrent executions**: $1.83/month (60% reduction from x86_64)
- **Document processor**: No provisioned concurrency (cost-optimized for background processing)

**Usage Recommendations:**
- **Small Business (50 users)**: 1 concurrent execution
- **Growing Business (150 users)**: 1-2 concurrent executions
- **Medium Business (500+ users)**: 2 concurrent executions

### Performance Optimizations

Several optimizations ensure good performance:

- **Connection Pooling**: Reuses database connections across Lambda invocations
- **Client-Side Caching**: Reduces API calls for repeated questions
- **CloudFront CDN**: Fast delivery of frontend assets
- **Optimized Queries**: Efficient vector similarity searches
- **Memory Configuration**: Right-sized Lambda memory allocation

## Monitoring and Maintenance

- View CloudWatch dashboards to monitor usage and performance
- Check CloudWatch Logs for error messages and debugging (logs retained for 7 days)
- Regularly update your knowledge base as information changes
- Monitor costs through AWS Cost Explorer
- Review security logs and WAF metrics

## Security Considerations

- The solution implements rate limiting to prevent abuse
- Content moderation is applied through Bedrock guardrails
- All data is encrypted at rest and in transit
- API Gateway protected by AWS WAF
- Database credentials automatically rotated every 90 days
- CloudWatch logs retained for 7 days to minimize exposure
- Database security groups restrict access
- Least privilege IAM roles and policies

### Database Security Group Configuration

The deployment script automatically configures security group rules to allow access from EC2 and Lambda services in the us-east-1 region. This ensures that your Lambda functions can connect to the database while maintaining security.

**Note:** The provided security group rules are specifically for us-east-1 region. If you're deploying to a different region, you'll need to modify the CIDR blocks in the deployment script.

If you need to manually configure these rules, you can use the following AWS CLI commands:

```bash
# Replace sg-xxxxxxxx with your database security group ID
# Replace region with your deployment region

# IPv4 rules for EC2 and Lambda services in us-east-1
# Large blocks
for CIDR in "3.80.0.0/12" "3.208.0.0/12" "3.224.0.0/12" "34.192.0.0/12" "34.224.0.0/12" "44.192.0.0/11" "52.0.0.0/8" "54.0.0.0/8"; do
    aws ec2 authorize-security-group-ingress \
        --group-id sg-xxxxxxxx \
        --protocol tcp \
        --port 5432 \
        --cidr "$CIDR" \
        --region us-east-1
done

# Medium blocks
for CIDR in "13.216.0.0/13" "18.204.0.0/14" "18.208.0.0/13" "23.20.0.0/14" "35.168.0.0/13" "50.16.0.0/15" "98.80.0.0/12" "100.24.0.0/13" "107.20.0.0/14" "174.129.0.0/16" "184.73.0.0/16"; do
    aws ec2 authorize-security-group-ingress \
        --group-id sg-xxxxxxxx \
        --protocol tcp \
        --port 5432 \
        --cidr "$CIDR" \
        --region us-east-1
done

# IPv6 rules
for IPV6_CIDR in "2600:1f00::/24" "2600:f0f0::/28" "2606:f40::/36"; do
    aws ec2 authorize-security-group-ingress \
        --group-id sg-xxxxxxxx \
        --ip-permissions "IpProtocol=tcp,FromPort=5432,ToPort=5432,Ipv6Ranges=[{CidrIpv6=$IPV6_CIDR}]" \
        --region us-east-1
done
```

These rules consolidate the numerous IP ranges used by AWS EC2 and Lambda services in us-east-1 into a manageable set of CIDR blocks, reducing the number of security group rules from over 400 to just 22.

## File Structure

```
chatbot-rag/
├── src/
│   ├── backend/
│   │   ├── __init__.py
│   │   ├── lambda_handler.py         # Main chatbot Lambda function (Graviton3)
│   │   ├── document_processor.py     # Document processing Lambda function (Graviton3)
│   │   ├── bedrock_utils.py          # Utilities for Amazon Bedrock
│   │   ├── db_utils.py               # Database utilities
│   │   ├── document_utils.py         # Document processing utilities
│   │   ├── chunking.py               # Document chunking utilities
│   │   ├── token_utils.py            # Token utilities
│   │   └── validation.py             # Input validation utilities
│   ├── frontend/
│   │   ├── widget.js                 # Embeddable chatbot widget
│   │   └── index.html                # Demo page
│   └── infrastructure/
│       ├── __init__.py
│       ├── app.py                    # CDK app entry point
│       └── cdk_stack.py              # CDK stack definition
├── scripts/
│   ├── __init__.py
│   ├── upload_documents.py           # Document upload utility
│   └── cleanup_database.py           # Database cleanup utility
├── docs/
│   ├── cost-analysis.md              # Comprehensive cost analysis
│   ├── troubleshooting.md            # Troubleshooting guide
│   └── architecture.txt              # Architecture diagram
├── config.json                       # Configuration file
├── pyproject.toml                    # Python project configuration
├── requirements.txt                  # Python dependencies
├── deploy.sh                         # Deployment script
└── README.md                         # This file
```

## API Reference

### REST API Endpoints

#### POST /chat
Send a message to the chatbot.

**Headers:**
- `Content-Type: application/json`
- `x-api-key: YOUR_API_KEY`

**Request Body:**
```json
{
  "message": "Your question here",
  "streaming": false
}
```

**Response:**
```json
{
  "response": "Chatbot response here"
}
```

### WebSocket API

#### Connection URL
`wss://your-websocket-api-id.execute-api.region.amazonaws.com/prod`

#### Send Message
```json
{
  "action": "sendMessage",
  "message": "Your question here"
}
```

#### Response Format
```json
{
  "type": "start|chunk|end|error",
  "text": "Response text",
  "complete": true|false
}
```

### Widget JavaScript API

#### Initialize Widget
```javascript
SmallBizChatbot.init(config)
```

#### Get Chat History
```javascript
const history = SmallBizChatbot.getHistory();
```

#### Clear Cache
```javascript
SmallBizChatbot.clearCache();
```

#### Toggle Cache
```javascript
SmallBizChatbot.setCacheEnabled(true|false);
```

#### Toggle Streaming
```javascript
SmallBizChatbot.setStreamingEnabled(true|false);
```

## Troubleshooting

See the [Troubleshooting Guide](docs/troubleshooting.md) for common issues and solutions.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For issues and questions:
1. Check the troubleshooting guide
2. Review AWS service documentation
3. Open an issue on GitHub
4. Contact AWS Support (if you have a support plan)
