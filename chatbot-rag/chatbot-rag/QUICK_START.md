# RAG Chatbot Quick Start Guide

This guide will help you quickly deploy the RAG Chatbot solution on AWS.

## Prerequisites

The deployment script will automatically check for and install most dependencies, but you'll need:

1. **AWS Account** with appropriate permissions
2. **AWS CLI** installed and configured with credentials
3. **Python 3.12+** installed

## Deployment Steps

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/chatbot-rag.git
cd chatbot-rag
```

### 2. Run the Deployment Script

```bash
./deploy.sh
```

The script will:
- Check and install all required dependencies (Python packages, Node.js, npm, AWS CDK CLI)
- Guide you through configuration if needed
- Deploy the infrastructure to AWS
- Configure the frontend widget
- Process any documents in the `documents` folder

### 3. Add Knowledge Base Documents

Create a `documents` folder (if not already created) and add your knowledge base files:

```bash
mkdir -p documents
# Add your PDF, TXT, MD, HTML, PNG, JPG files to the documents folder
```

Then process the documents:

```bash
python -m scripts.upload_documents --folder ./documents
```

### 4. Integrate the Widget

After deployment completes, you'll receive integration instructions. Add the provided code to your website:

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

## Troubleshooting

If you encounter any issues during deployment:

1. Check the `deployment.log` file for detailed error messages
2. Run the deployment validator to check your environment:
   ```bash
   python -m scripts.deployment_validator --pre-deployment
   ```
3. Try running the deployment with the recovery option:
   ```bash
   ./deploy.sh --recover
   ```
4. See the `DEPLOYMENT_FIXES_SUMMARY.md` file for manual installation steps if needed

## Next Steps

1. **Customize the widget** appearance using the theme options
2. **Add more documents** to enhance your knowledge base
3. **Monitor usage** in the AWS CloudWatch console
4. **Optimize costs** by adjusting the configuration based on your usage patterns

For more detailed information, refer to the documentation in the `docs` folder.
