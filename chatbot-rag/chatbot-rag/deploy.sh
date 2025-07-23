#!/bin/bash
#
# RAG Chatbot Easy Deployment Script
# 
# This script provides a user-friendly deployment experience for non-developers.
# It includes comprehensive error handling, progress tracking, and recovery options.
#

# Exit immediately if a command exits with a non-zero status
set -e

# Colors for output formatting
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Script variables
CONFIG_FILE="config.json"
VENV_DIR=".venv"
PYTHON_CMD="python3"
LOG_FILE="deployment.log"
PROGRESS_FILE=".deployment_progress"
BACKUP_DIR=".deployment_backup"

# Progress tracking
TOTAL_STEPS=8
CURRENT_STEP=0

# Function to display progress
progress() {
    CURRENT_STEP=$((CURRENT_STEP + 1))
    local percentage=$((CURRENT_STEP * 100 / TOTAL_STEPS))
    echo -e "\n${CYAN}[Step $CURRENT_STEP/$TOTAL_STEPS - $percentage%] $1${NC}"
    echo "step_$CURRENT_STEP" > "$PROGRESS_FILE"
}

# Function to display section headers with better formatting
section() {
    echo -e "\n${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC} ${BOLD}$1${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
}

# Function to display error messages with helpful context
error() {
    echo -e "\n${RED}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║ ❌ DEPLOYMENT FAILED${NC}"
    echo -e "${RED}╠══════════════════════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${RED}║${NC} Error: $1"
    echo -e "${RED}║${NC}"
    echo -e "${RED}║${NC} 📋 What you can do:"
    echo -e "${RED}║${NC}   1. Check the troubleshooting guide: docs/troubleshooting.md"
    echo -e "${RED}║${NC}   2. Review the deployment log: $LOG_FILE"
    echo -e "${RED}║${NC}   3. Run './deploy.sh --recover' to resume from last step"
    echo -e "${RED}║${NC}   4. Run './deploy.sh --clean' to start fresh"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
    
    # Log error details
    echo "[$(date)] ERROR: $1" >> "$LOG_FILE"
    exit 1
}

# Function to display warnings with context
warning() {
    echo -e "${YELLOW}⚠️  Warning: $1${NC}"
    echo "[$(date)] WARNING: $1" >> "$LOG_FILE"
}

# Function to display success messages
success() {
    echo -e "${GREEN}✅ $1${NC}"
    echo "[$(date)] SUCCESS: $1" >> "$LOG_FILE"
}

# Function to display info messages
info() {
    echo -e "${CYAN}ℹ️  $1${NC}"
    echo "[$(date)] INFO: $1" >> "$LOG_FILE"
}

# Function to check if a command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Function to prompt user for input with validation
prompt_user() {
    local prompt="$1"
    local default="$2"
    local validation="$3"
    local response
    
    while true; do
        if [ -n "$default" ]; then
            echo -e "${CYAN}$prompt [default: $default]: ${NC}"
        else
            echo -e "${CYAN}$prompt: ${NC}"
        fi
        
        read -r response
        
        # Use default if no response
        if [ -z "$response" ] && [ -n "$default" ]; then
            response="$default"
        fi
        
        # Validate response if validation function provided
        if [ -n "$validation" ]; then
            if $validation "$response"; then
                echo "$response"
                return 0
            else
                echo -e "${RED}Invalid input. Please try again.${NC}"
                continue
            fi
        else
            echo "$response"
            return 0
        fi
    done
}

# Validation functions
validate_region() {
    local region="$1"
    if [[ "$region" =~ ^[a-z]{2}-[a-z]+-[0-9]+$ ]]; then
        return 0
    else
        echo -e "${RED}Invalid region format. Expected format: us-east-1, eu-west-1, etc.${NC}"
        return 1
    fi
}

validate_email() {
    local email="$1"
    if [[ "$email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
        return 0
    else
        echo -e "${RED}Invalid email format.${NC}"
        return 1
    fi
}

validate_business_name() {
    local name="$1"
    if [ ${#name} -ge 2 ]; then
        return 0
    else
        echo -e "${RED}Business name must be at least 2 characters long.${NC}"
        return 1
    fi
}

validate_color() {
    local color="$1"
    if [[ "$color" =~ ^#[0-9A-Fa-f]{6}$ ]]; then
        return 0
    else
        echo -e "${RED}Invalid color format. Use hex format like #4287f5${NC}"
        return 1
    fi
}

# Function to create backup of important files
create_backup() {
    info "Creating backup of configuration files..."
    mkdir -p "$BACKUP_DIR"
    
    if [ -f "$CONFIG_FILE" ]; then
        cp "$CONFIG_FILE" "$BACKUP_DIR/config.json.backup"
    fi
    
    if [ -f "src/frontend/widget.js" ]; then
        cp "src/frontend/widget.js" "$BACKUP_DIR/widget.js.backup"
    fi
    
    success "Backup created in $BACKUP_DIR"
}

# Function to restore from backup
restore_backup() {
    if [ -d "$BACKUP_DIR" ]; then
        info "Restoring from backup..."
        
        if [ -f "$BACKUP_DIR/config.json.backup" ]; then
            cp "$BACKUP_DIR/config.json.backup" "$CONFIG_FILE"
        fi
        
        if [ -f "$BACKUP_DIR/widget.js.backup" ]; then
            cp "$BACKUP_DIR/widget.js.backup" "src/frontend/widget.js"
        fi
        
        success "Files restored from backup"
    fi
}

# Function to clean up deployment artifacts
cleanup() {
    info "Cleaning up deployment artifacts..."
    rm -f "$PROGRESS_FILE"
    rm -rf "$BACKUP_DIR"
    rm -f "$LOG_FILE"
    
    if [ -d "$VENV_DIR" ]; then
        rm -rf "$VENV_DIR"
    fi
    
    success "Cleanup completed"
}

# Function to check AWS permissions
check_aws_permissions() {
    info "Checking AWS permissions..."
    
    # Test basic AWS access
    if ! aws sts get-caller-identity &> /dev/null; then
        error "AWS credentials not configured or invalid. Please run 'aws configure' first."
    fi
    
    # Get current user/role info
    local identity=$(aws sts get-caller-identity --output text --query 'Arn' 2>/dev/null)
    info "Deploying as: $identity"
    
    # Check if user has admin access (simplified check)
    local user_name=$(aws sts get-caller-identity --query 'Arn' --output text 2>/dev/null | cut -d'/' -f2 2>/dev/null || echo "")
    if [ -n "$user_name" ] && aws iam list-attached-user-policies --user-name "$user_name" 2>/dev/null | grep -q "AdministratorAccess"; then
        success "Administrator access detected"
    else
        warning "Cannot verify all required permissions. Deployment may fail if permissions are insufficient."
        warning "Consider using an IAM user/role with AdministratorAccess for initial deployment."
    fi
}

# Function to estimate deployment costs
estimate_costs() {
    local region="$1"
    
    info "Estimating monthly costs for your deployment..."
    
    echo -e "\n${CYAN}💰 Estimated Monthly Costs (USD):${NC}"
    echo -e "   Small Business (50 users/day):     ${GREEN}\$29.76${NC}"
    echo -e "   Growing Business (150 users/day):  ${GREEN}\$33.52${NC}"
    echo -e "   Medium Business (500 users/day):   ${GREEN}\$72.41${NC}"
    echo -e "\n${YELLOW}Note: Costs may vary based on actual usage and AWS pricing changes.${NC}"
    echo -e "${YELLOW}See docs/cost-analysis.md for detailed breakdown.${NC}"
    
    echo -e "\n${CYAN}Do you want to proceed with deployment? (y/n): ${NC}"
    read -r proceed
    
    if [[ ! "$proceed" =~ ^[Yy]$ ]]; then
        info "Deployment cancelled by user."
        exit 0
    fi
}

# Function to run interactive setup
interactive_setup() {
    section "🚀 RAG Chatbot Interactive Setup"
    
    echo -e "${CYAN}Welcome to the RAG Chatbot deployment wizard!${NC}"
    echo -e "${CYAN}This wizard will guide you through the setup process.${NC}\n"
    
    # Get user preferences
    local region=$(prompt_user "Enter your preferred AWS region" "us-east-1" "validate_region")
    local business_name=$(prompt_user "Enter your business name" "My Business" "validate_business_name")
    local contact_email=$(prompt_user "Enter your contact email" "" "validate_email")
    local primary_color=$(prompt_user "Enter your brand primary color (hex)" "#4287f5" "validate_color")
    
    # Create or update config.json
    cat > "$CONFIG_FILE" << EOF
{
  "region": "$region",
  "businessName": "$business_name",
  "contactEmail": "$contact_email",
  "bedrock": {
    "modelId": "amazon.nova-lite-v1",
    "guardrails": {
      "createDefault": true,
      "defaultGuardrailConfig": {
        "name": "ChatbotDefaultGuardrail",
        "description": "Default guardrail for $business_name chatbot",
        "contentPolicyConfig": {
          "filters": [
            {"type": "SEXUAL", "strength": "MEDIUM"},
            {"type": "VIOLENCE", "strength": "MEDIUM"},
            {"type": "HATE", "strength": "MEDIUM"},
            {"type": "INSULTS", "strength": "MEDIUM"}
          ]
        },
        "wordPolicyConfig": {
          "managedWordLists": [{"type": "PROFANITY"}],
          "customWordLists": []
        },
        "sensitiveInformationPolicyConfig": {
          "piiEntities": [{"type": "ALL", "action": "BLOCK"}]
        },
        "topicPolicyConfig": {
          "topics": [
            {"name": "Politics", "type": "DENY"},
            {"name": "Financial advice", "type": "DENY"},
            {"name": "Legal advice", "type": "DENY"}
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
      "primaryColor": "$primary_color",
      "secondaryColor": "#f5f5f5",
      "fontFamily": "Arial, sans-serif",
      "fontSize": "16px",
      "borderRadius": "8px"
    }
  }
}
EOF
    
    success "Configuration saved to $CONFIG_FILE"
    
    # Show cost estimate
    estimate_costs "$region"
}

# Function to check prerequisites with detailed guidance
check_prerequisites() {
    progress "Checking Prerequisites"
    
    # Check if config.json exists
    if [ ! -f "$CONFIG_FILE" ]; then
        warning "$CONFIG_FILE not found. Starting interactive setup..."
        interactive_setup
    fi
    
    # Parse region from config
    local region=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['region'])" 2>/dev/null || echo "us-east-1")
    info "Using region: $region"
    
    # Check AWS CLI
    if ! command_exists aws; then
        error "AWS CLI is not installed. Please install it from: https://aws.amazon.com/cli/
        
        Installation instructions:
        - macOS: brew install awscli
        - Ubuntu/Debian: sudo apt install awscli
        - Windows: Download from AWS website"
    fi
    
    # Check AWS CLI version
    local aws_version=$(aws --version 2>&1 | cut -d' ' -f1 | cut -d'/' -f2)
    info "AWS CLI version: $aws_version"
    
    # Check AWS credentials and permissions
    check_aws_permissions
    
    # Check Python
    if ! command_exists python3; then
        error "Python 3 is not installed. Please install it from: https://www.python.org/
        
        Installation instructions:
        - macOS: brew install python3
        - Ubuntu/Debian: sudo apt install python3 python3-pip python3-venv
        - Windows: Download from python.org"
    fi
    
    # Check Python version with better messaging
    local python_version=$(python3 --version 2>&1 | cut -d' ' -f2)
    local python_major=$(echo "$python_version" | cut -d'.' -f1)
    local python_minor=$(echo "$python_version" | cut -d'.' -f2)
    
    info "Python version: $python_version"
    
    if [ "$python_major" -lt 3 ] || ([ "$python_major" -eq 3 ] && [ "$python_minor" -lt 9 ]); then
        error "Python version $python_version is too old. This project requires Python 3.9 or higher.
        
        Please upgrade Python:
        - macOS: brew upgrade python3
        - Ubuntu/Debian: sudo apt update && sudo apt upgrade python3
        - Windows: Download latest version from python.org"
    fi
    
    # Check pip
    if ! command_exists pip3; then
        error "pip3 is not installed. Please install it:
        
        Installation instructions:
        - macOS: python3 -m ensurepip --upgrade
        - Ubuntu/Debian: sudo apt install python3-pip
        - Windows: Usually included with Python"
    fi
    
    # Check for Node.js and npm (required for AWS CDK)
    if ! command_exists node; then
        warning "Node.js is not installed. Installing Node.js (required for AWS CDK)..."
        
        # Detect OS and install Node.js
        if [ -f /etc/debian_version ]; then
            # Debian/Ubuntu
            info "Detected Debian/Ubuntu system"
            info "Installing Node.js using apt..."
            sudo apt-get update
            sudo apt-get install -y nodejs npm
        elif [ -f /etc/redhat-release ]; then
            # RHEL/CentOS/Fedora
            info "Detected RHEL/CentOS/Fedora system"
            info "Installing Node.js using yum..."
            sudo yum install -y nodejs npm
        elif command_exists brew; then
            # macOS with Homebrew
            info "Detected macOS with Homebrew"
            info "Installing Node.js using brew..."
            brew install node
        else
            error "Could not automatically install Node.js. Please install Node.js and npm manually:
            
            Installation instructions:
            - Ubuntu/Debian: sudo apt install nodejs npm
            - RHEL/CentOS: sudo yum install nodejs npm
            - macOS: brew install node
            - Windows: Download from https://nodejs.org/"
        fi
    fi
    
    # Verify Node.js installation
    if command_exists node; then
        local node_version=$(node --version 2>&1)
        info "Node.js version: $node_version"
    else
        error "Node.js installation failed. Please install it manually."
    fi
    
    # Verify npm installation
    if command_exists npm; then
        local npm_version=$(npm --version 2>&1)
        info "npm version: $npm_version"
    else
        error "npm is not installed. Please install it manually."
    fi
    
    # Check for AWS CDK CLI
    if ! command_exists cdk; then
        warning "AWS CDK CLI is not installed. Installing AWS CDK CLI globally..."
        npm install -g aws-cdk
        
        # Verify CDK installation
        if command_exists cdk; then
            local cdk_version=$(cdk --version 2>&1)
            info "AWS CDK CLI version: $cdk_version"
        else
            error "AWS CDK CLI installation failed. Please install it manually:
            
            Installation instructions:
            npm install -g aws-cdk"
        fi
    else
        local cdk_version=$(cdk --version 2>&1)
        info "AWS CDK CLI version: $cdk_version"
    fi
    
    # Check disk space
    local available_space=$(df . | tail -1 | awk '{print $4}')
    if [ "$available_space" -lt 1048576 ]; then  # 1GB in KB
        warning "Low disk space detected. At least 1GB free space is recommended."
    fi
    
    success "All prerequisites satisfied"
}

# Function to setup Python environment with progress tracking
setup_python_environment() {
    progress "Setting up Python Environment"
    
    # Create virtual environment if it doesn't exist
    if [ ! -d "$VENV_DIR" ]; then
        info "Creating Python virtual environment..."
        python3 -m venv "$VENV_DIR" || error "Failed to create virtual environment. Check Python installation."
    else
        info "Using existing virtual environment..."
    fi
    
    # Activate virtual environment
    info "Activating virtual environment..."
    source "$VENV_DIR/bin/activate" || error "Failed to activate virtual environment."
    
    # Verify virtual environment is active
    if [ -z "$VIRTUAL_ENV" ]; then
        error "Virtual environment activation failed."
    fi
    
    info "Virtual environment: $VIRTUAL_ENV"
    success "Python environment ready"
}

# Function to install dependencies with progress tracking
install_dependencies() {
    progress "Installing Dependencies"
    
    info "Upgrading pip..."
    pip install --upgrade pip --quiet || error "Failed to upgrade pip."
    
    info "Installing Python dependencies..."
    pip install -r requirements.txt --quiet || error "Failed to install dependencies. Check requirements.txt file."
    
    info "Installing project in development mode..."
    pip install -e . --quiet || error "Failed to install project."
    
    success "Dependencies installed successfully"
}

# Function to validate configuration
validate_configuration() {
    progress "Validating Configuration"
    
    info "Validating configuration file..."
    
    # Use Python to validate JSON
    python3 -c "
import json
import sys

try:
    with open('$CONFIG_FILE', 'r') as f:
        config = json.load(f)
    
    required_keys = ['region', 'bedrock', 'database', 'api', 'lambda', 'widget']
    missing_keys = [key for key in required_keys if key not in config]
    
    if missing_keys:
        print(f'Missing required configuration keys: {missing_keys}')
        sys.exit(1)
    
    print('Configuration validation passed')
except json.JSONDecodeError as e:
    print(f'Invalid JSON in config file: {e}')
    sys.exit(1)
except Exception as e:
    print(f'Configuration validation failed: {e}')
    sys.exit(1)
" || error "Configuration validation failed. Please check your config.json file."
    
    success "Configuration validated"
}

# Function to deploy infrastructure with better error handling
deploy_infrastructure() {
    progress "Deploying AWS Infrastructure"
    
    info "This step may take 10-15 minutes. Please be patient..."
    info "Deploying Lambda functions, database, API Gateway, and other AWS resources..."
    
    # Run the Python deployment script with better error handling
    if ! python3 -m scripts.deploy 2>&1 | tee -a "$LOG_FILE"; then
        error "Infrastructure deployment failed. Check the log file for details: $LOG_FILE
        
        Common causes:
        - Insufficient AWS permissions
        - Resource limits exceeded
        - Network connectivity issues
        - Invalid configuration
        
        Try running: ./deploy.sh --recover"
    fi
    
    success "Infrastructure deployed successfully"
}

# Function to verify deployment
verify_deployment() {
    progress "Verifying Deployment"
    
    info "Checking deployed resources..."
    
    # Check if stack exists
    local region=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['region'])")
    
    if aws cloudformation describe-stacks --stack-name "ChatbotRagStack" --region "$region" &> /dev/null; then
        success "CloudFormation stack found"
    else
        error "CloudFormation stack not found. Deployment may have failed."
    fi
    
    success "Deployment verification completed"
}

# Function to setup knowledge base
setup_knowledge_base() {
    progress "Setting up Knowledge Base"
    
    # Check if documents folder exists
    if [ -d "documents" ] && [ "$(ls -A documents)" ]; then
        info "Found documents folder with files. Processing knowledge base..."
        python3 -m scripts.upload_documents --folder ./documents || warning "Some documents may not have been processed correctly."
        success "Knowledge base setup completed"
    else
        info "No documents folder found or folder is empty."
        info "Create a 'documents' folder and add your knowledge base files, then run:"
        info "python3 -m scripts.upload_documents --folder ./documents"
        
        # Create empty documents folder
        mkdir -p documents
        echo "# Add your knowledge base documents here" > documents/README.md
        
        success "Documents folder created. Add your files and re-run the upload command."
    fi
}

# Function to display final instructions
display_final_instructions() {
    progress "Finalizing Setup"
    
    local region=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['region'])")
    
    section "🎉 Deployment Completed Successfully!"
    
    echo -e "${GREEN}Your RAG Chatbot is now ready to use!${NC}\n"
    
    echo -e "${CYAN}📋 Next Steps:${NC}"
    echo -e "   1. Add your knowledge base documents to the 'documents' folder"
    echo -e "   2. Run: ${YELLOW}python3 -m scripts.upload_documents --folder ./documents${NC}"
    echo -e "   3. Integrate the widget into your website using the code below"
    echo -e "   4. Test your chatbot and customize as needed\n"
    
    echo -e "${CYAN}🔗 Integration Code:${NC}"
    echo -e "${YELLOW}<!-- Add this to your website's HTML -->
<script src=\"https://YOUR_CLOUDFRONT_DOMAIN/widget.js\"></script>
<script>
  SmallBizChatbot.init({
    containerId: 'chatbot-container',
    theme: {
      primaryColor: '#4287f5',
      fontFamily: 'Arial, sans-serif'
    }
  });
</script>
<div id=\"chatbot-container\"></div>${NC}\n"
    
    echo -e "${CYAN}📚 Documentation:${NC}"
    echo -e "   • User Guide: ${YELLOW}docs/user-guide.md${NC}"
    echo -e "   • Troubleshooting: ${YELLOW}docs/troubleshooting.md${NC}"
    echo -e "   • Cost Analysis: ${YELLOW}docs/cost-analysis.md${NC}\n"
    
    echo -e "${CYAN}🔧 Management Commands:${NC}"
    echo -e "   • Upload documents: ${YELLOW}python3 -m scripts.upload_documents --folder ./documents${NC}"
    echo -e "   • Clean database: ${YELLOW}python3 -m scripts.cleanup_database${NC}"
    echo -e "   • View logs: ${YELLOW}tail -f $LOG_FILE${NC}\n"
    
    success "Setup completed! Your chatbot is ready to use."
}

# Function to handle recovery from failed deployment
recover_deployment() {
    section "🔄 Recovering from Failed Deployment"
    
    if [ ! -f "$PROGRESS_FILE" ]; then
        error "No previous deployment found to recover from."
    fi
    
    local last_step=$(cat "$PROGRESS_FILE")
    info "Resuming from: $last_step"
    
    case "$last_step" in
        "step_1"|"step_2"|"step_3")
            info "Resuming from dependency installation..."
            setup_python_environment
            install_dependencies
            validate_configuration
            deploy_infrastructure
            verify_deployment
            setup_knowledge_base
            display_final_instructions
            ;;
        "step_4"|"step_5")
            info "Resuming from infrastructure deployment..."
            deploy_infrastructure
            verify_deployment
            setup_knowledge_base
            display_final_instructions
            ;;
        "step_6"|"step_7")
            info "Resuming from final steps..."
            setup_knowledge_base
            display_final_instructions
            ;;
        *)
            warning "Unknown recovery point. Starting fresh deployment..."
            main_deployment
            ;;
    esac
}

# Main deployment function
main_deployment() {
    # Initialize logging
    echo "[$(date)] Starting deployment..." > "$LOG_FILE"
    
    # Create backup
    create_backup
    
    # Run deployment steps
    check_prerequisites
    setup_python_environment
    install_dependencies
    validate_configuration
    deploy_infrastructure
    verify_deployment
    setup_knowledge_base
    display_final_instructions
    
    # Cleanup progress file
    rm -f "$PROGRESS_FILE"
}

# Handle command line arguments
case "${1:-}" in
    --recover)
        recover_deployment
        ;;
    --clean)
        cleanup
        info "Cleanup completed. You can now run a fresh deployment."
        ;;
    --help|-h)
        echo -e "${CYAN}RAG Chatbot Deployment Script${NC}"
        echo -e ""
        echo -e "Usage: $0 [OPTIONS]"
        echo -e ""
        echo -e "Options:"
        echo -e "  (no args)    Run normal deployment"
        echo -e "  --recover    Recover from failed deployment"
        echo -e "  --clean      Clean up deployment artifacts"
        echo -e "  --help       Show this help message"
        echo -e ""
        echo -e "For more information, see: docs/deployment-guide.md"
        ;;
    *)
        section "🤖 RAG Chatbot Deployment"
        echo -e "${CYAN}Starting deployment process...${NC}"
        echo -e "${CYAN}This will take approximately 15-20 minutes.${NC}\n"
        
        main_deployment
        ;;
esac
