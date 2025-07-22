#!/bin/bash
#
# Chatbot RAG Solution Deployment Script
# 
# This script automates the deployment of the RAG chatbot solution.
# It performs the following steps:
# 1. Validates prerequisites (AWS CLI, Node.js, npm)
# 2. Installs dependencies
# 3. Builds and deploys the infrastructure using CDK
# 4. Updates configuration files with deployment outputs
# 5. Uploads frontend assets to S3
# 6. Uploads documents to the knowledge base (if available)
#

# Exit immediately if a command exits with a non-zero status
set -e

# Colors for output formatting
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script variables
CONFIG_FILE="config.json"
STACK_NAME="ChatbotRagStack"
DOCS_FOLDER="documents"

# Function to display section headers
section() {
    echo -e "\n${BLUE}=== $1 ===${NC}"
}

# Function to display error messages and exit
error() {
    echo -e "${RED}Error: $1${NC}"
    exit 1
}

# Function to display warnings
warning() {
    echo -e "${YELLOW}Warning: $1${NC}"
}

# Function to display success messages
success() {
    echo -e "${GREEN}$1${NC}"
}

# Function to check if a command exists
command_exists() {
    command -v "$1" &> /dev/null
}

section "Checking Prerequisites"

# Check if config.json exists
if [ ! -f "$CONFIG_FILE" ]; then
    error "config.json not found. Please ensure the configuration file exists."
fi

# Parse region from config
REGION=$(cat "$CONFIG_FILE" | grep -o '"region": *"[^"]*"' | cut -d'"' -f4)
if [ -z "$REGION" ]; then
    warning "Region not found in config.json, using default us-east-1"
    REGION="us-east-1"
else
    echo "Using region: $REGION"
fi

# Validate region format
if [[ ! "$REGION" =~ ^[a-z]{2}-[a-z]+-[0-9]+$ ]]; then
    error "Invalid region format: $REGION. Expected format: us-east-1, eu-west-1, etc."
    exit 1
fi

# Check AWS CLI is installed
if ! command_exists aws; then
    error "AWS CLI is not installed. Please install it from https://aws.amazon.com/cli/"
fi

# Check AWS credentials
echo "Checking AWS credentials..."
if ! aws sts get-caller-identity --region "$REGION" &> /dev/null; then
    error "AWS credentials not configured or invalid. Please run 'aws configure' to set up your credentials."
fi
success "AWS credentials valid"

# Check Node.js is installed
if ! command_exists node; then
    error "Node.js is not installed. Please install it from https://nodejs.org/"
fi

# Check npm is installed
if ! command_exists npm; then
    error "npm is not installed. It should be included with Node.js."
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d 'v' -f 2)
NODE_MAJOR_VERSION=$(echo "$NODE_VERSION" | cut -d '.' -f 1)
if [ "$NODE_MAJOR_VERSION" -lt 18 ]; then
    warning "Node.js version $NODE_VERSION detected. This project recommends Node.js 18 or higher."
else
    echo "Node.js version: $NODE_VERSION"
fi

success "All prerequisites satisfied"

section "Installing Dependencies"
npm install || error "Failed to install dependencies"
success "Dependencies installed"

section "Building Project"
# Check if build script exists in package.json
if grep -q '"build"' package.json; then
    npm run build || error "Build failed"
    success "Build completed"
else
    warning "No build script found in package.json, skipping build step"
fi

section "Deploying Infrastructure"
echo "Deploying with CDK to region $REGION..."
npx cdk deploy --require-approval never --region "$REGION" || error "CDK deployment failed"
success "Infrastructure deployed"

section "Configuring Application"
echo "Getting deployment outputs..."
OUTPUTS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query "Stacks[0].Outputs" --output json)
if [ -z "$OUTPUTS" ]; then
    error "Failed to get stack outputs"
fi

# Extract values from outputs with better error handling
extract_output() {
    local output_name=$1
    local output_value=$(echo "$OUTPUTS" | grep -o "\"OutputKey\": *\"$output_name\".*\"OutputValue\": *\"[^\"]*\"" | grep -o "\"OutputValue\": *\"[^\"]*\"" | cut -d'"' -f4)
    if [ -z "$output_value" ]; then
        warning "Could not find $output_name in stack outputs"
        return 1
    fi
    echo "$output_value"
}

API_ENDPOINT=$(extract_output "ApiEndpoint")
CLOUDFRONT_DOMAIN=$(extract_output "CloudFrontDomain")
DOCUMENT_BUCKET=$(extract_output "DocumentBucketName")
WEBSITE_BUCKET=$(extract_output "WebsiteBucketName")
API_KEY_ID=$(extract_output "ApiKeyId")
WEBSOCKET_URL=$(extract_output "WebSocketApiUrl")

# Validate required outputs
if [ -z "$API_ENDPOINT" ] || [ -z "$CLOUDFRONT_DOMAIN" ] || [ -z "$DOCUMENT_BUCKET" ] || [ -z "$WEBSITE_BUCKET" ] || [ -z "$API_KEY_ID" ]; then
    error "Missing required stack outputs"
fi

# Get API key value
echo "Getting API key..."
API_KEY=$(aws apigateway get-api-key --api-key "$API_KEY_ID" --include-value --region "$REGION" --query "value" --output text)
if [ -z "$API_KEY" ]; then
    error "Failed to get API key"
fi

# Update widget.js with API endpoint, key, and WebSocket URL
echo "Updating widget.js with deployment values..."
if [ -f "src/frontend/widget.js" ]; then
    # Create a backup of the original file
    cp src/frontend/widget.js src/frontend/widget.js.bak
    
    # Replace placeholders
    sed -i "s|API_ENDPOINT_PLACEHOLDER|$API_ENDPOINT|g" src/frontend/widget.js
    sed -i "s|API_KEY_PLACEHOLDER|$API_KEY|g" src/frontend/widget.js
    
    # Only replace WebSocket URL if it exists
    if [ -n "$WEBSOCKET_URL" ]; then
        sed -i "s|WEBSOCKET_URL_PLACEHOLDER|$WEBSOCKET_URL|g" src/frontend/widget.js
    else
        warning "WebSocket URL not found in stack outputs, streaming may not work"
        sed -i "s|WEBSOCKET_URL_PLACEHOLDER||g" src/frontend/widget.js
    fi
    
    success "Widget configuration updated"
else
    error "src/frontend/widget.js not found"
fi

section "Uploading Frontend Assets"
echo "Uploading to S3 bucket: $WEBSITE_BUCKET"

# Upload frontend assets with content type
upload_with_content_type() {
    local file=$1
    local content_type=$2
    
    if [ -f "$file" ]; then
        aws s3 cp "$file" "s3://$WEBSITE_BUCKET/" --content-type "$content_type" --region "$REGION" || warning "Failed to upload $file"
        echo "Uploaded $file"
    else
        warning "$file not found, skipping"
    fi
}

upload_with_content_type "src/frontend/widget.js" "application/javascript"
upload_with_content_type "src/frontend/index.html" "text/html"

success "Frontend assets uploaded"

section "Processing Knowledge Base"
# Check if documents folder exists and has files
if [ -d "$DOCS_FOLDER" ] && [ "$(ls -A $DOCS_FOLDER 2>/dev/null)" ]; then
    echo "Uploading documents to knowledge base..."
    node scripts/upload-documents.js --folder "$DOCS_FOLDER" || warning "Document upload script encountered issues"
    success "Documents processed"
else
    warning "No documents folder found or folder is empty. Create a 'documents' folder and add your knowledge base files."
fi

section "Configuring Database Security"
echo "Adding security group rules for EC2 and Lambda services in $REGION region..."

# Get the security group ID from stack outputs
DB_SECURITY_GROUP=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query "Stacks[0].Outputs[?OutputKey=='DatabaseSecurityGroupId'].OutputValue" --output text)

if [ -z "$DB_SECURITY_GROUP" ]; then
    warning "Could not find database security group ID in stack outputs. Skipping security group configuration."
else
    echo "Found database security group: ${YELLOW}$DB_SECURITY_GROUP${NC}"
    
    # Add IPv4 rules for EC2 and Lambda services in the configured region
    echo "Adding IPv4 rules for EC2 and Lambda services in $REGION..."
    
    # Note: These CIDR blocks are specific to us-east-1
    # For other regions, you would need to update these ranges
    if [ "$REGION" = "us-east-1" ]; then
        # Large blocks for us-east-1
        for CIDR in "3.80.0.0/12" "3.208.0.0/12" "3.224.0.0/12" "34.192.0.0/12" "34.224.0.0/12" "44.192.0.0/11" "52.0.0.0/8" "54.0.0.0/8"; do
            echo "Adding rule for $CIDR..."
            aws ec2 authorize-security-group-ingress \
                --group-id "$DB_SECURITY_GROUP" \
                --protocol tcp \
                --port 5432 \
                --cidr "$CIDR" \
                --region "$REGION" || warning "Failed to add rule for $CIDR (it may already exist)"
        done
        
        # Medium blocks for us-east-1
        for CIDR in "13.216.0.0/13" "18.204.0.0/14" "18.208.0.0/13" "23.20.0.0/14" "35.168.0.0/13" "50.16.0.0/15" "98.80.0.0/12" "100.24.0.0/13" "107.20.0.0/14" "174.129.0.0/16" "184.73.0.0/16"; do
            echo "Adding rule for $CIDR..."
            aws ec2 authorize-security-group-ingress \
                --group-id "$DB_SECURITY_GROUP" \
                --protocol tcp \
                --port 5432 \
                --cidr "$CIDR" \
                --region "$REGION" || warning "Failed to add rule for $CIDR (it may already exist)"
        done
        
        # Add IPv6 rules for us-east-1
        echo "Adding IPv6 rules for EC2 and Lambda services in $REGION..."
        for IPV6_CIDR in "2600:1f00::/24" "2600:f0f0::/28" "2606:f40::/36"; do
            echo "Adding rule for $IPV6_CIDR..."
            aws ec2 authorize-security-group-ingress \
                --group-id "$DB_SECURITY_GROUP" \
                --ip-permissions "IpProtocol=tcp,FromPort=5432,ToPort=5432,Ipv6Ranges=[{CidrIpv6=$IPV6_CIDR}]" \
                --region "$REGION" || warning "Failed to add rule for $IPV6_CIDR (it may already exist)"
        done
    else
        warning "Security group rules are pre-configured for us-east-1 region only."
        warning "For region $REGION, you may need to manually configure security group rules."
        warning "Please refer to AWS documentation for Lambda IP ranges in your region."
        
        # Add a basic rule allowing all traffic (less secure but functional)
        echo "Adding basic rule to allow Lambda access (consider restricting this in production)..."
        aws ec2 authorize-security-group-ingress \
            --group-id "$DB_SECURITY_GROUP" \
            --protocol tcp \
            --port 5432 \
            --cidr "0.0.0.0/0" \
            --region "$REGION" || warning "Failed to add basic rule (it may already exist)"
    fi
    done
    
    success "Security group rules configured for region $REGION"
fi

section "Deployment Summary"
echo "API Endpoint: ${YELLOW}$API_ENDPOINT${NC}"
echo "CloudFront Domain: ${YELLOW}$CLOUDFRONT_DOMAIN${NC}"
echo "Document Bucket: ${YELLOW}$DOCUMENT_BUCKET${NC}"
echo "Website Bucket: ${YELLOW}$WEBSITE_BUCKET${NC}"
if [ -n "$WEBSOCKET_URL" ]; then
    echo "WebSocket URL: ${YELLOW}$WEBSOCKET_URL${NC}"
fi

section "Integration Instructions"
echo "Add the following code to your website:"
echo -e "${YELLOW}<script src=\"https://$CLOUDFRONT_DOMAIN/widget.js\"></script>"
echo "<script>"
echo "  SmallBizChatbot.init({"
echo "    containerId: 'chatbot-container',"
echo "    theme: {"
echo "      primaryColor: '#4287f5',"
echo "      fontFamily: 'Arial, sans-serif'"
echo "    }"
echo "  });"
echo "</script>"
echo -e "<div id=\"chatbot-container\"></div>${NC}"

section "Demo Page"
echo "View the demo page at: ${YELLOW}https://$CLOUDFRONT_DOMAIN/index.html${NC}"
echo -e "\n${YELLOW}Note: It may take a few minutes for the CloudFront distribution to fully deploy.${NC}"

section "Next Steps"
echo "1. Add more documents to the '${DOCS_FOLDER}' folder and run 'npm run upload-docs -- --folder ./${DOCS_FOLDER}'"
echo "2. Customize the widget appearance using the theme options"
echo "3. Monitor usage in the AWS CloudWatch console"

success "Deployment completed successfully!"
