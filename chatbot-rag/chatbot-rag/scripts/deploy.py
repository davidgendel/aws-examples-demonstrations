#!/usr/bin/env python3
"""
Deployment script for the chatbot RAG solution.
"""
import json
import logging
import os
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import boto3

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

# ANSI colors for output formatting
GREEN = "\033[0;32m"
YELLOW = "\033[1;33m"
RED = "\033[0;31m"
BLUE = "\033[0;34m"
NC = "\033[0m"  # No Color

# Script variables
CONFIG_FILE = "config.json"
STACK_NAME = "ChatbotRagStack"
DOCS_FOLDER = "documents"


def section(title: str):
    """Display section header."""
    print(f"\n{BLUE}=== {title} ==={NC}")


def error(message: str):
    """Display error message and exit."""
    print(f"{RED}Error: {message}{NC}")
    sys.exit(1)


def warning(message: str):
    """Display warning message."""
    print(f"{YELLOW}Warning: {message}{NC}")


def success(message: str):
    """Display success message."""
    print(f"{GREEN}{message}{NC}")


def command_exists(command: str) -> bool:
    """Check if a command exists."""
    return shutil.which(command) is not None


def run_command(command: str, check: bool = True) -> subprocess.CompletedProcess:
    """Run a shell command safely without shell=True."""
    # Parse the command string into a list of arguments
    args = shlex.split(command)
    return subprocess.run(args, check=check, text=True, capture_output=True)


def check_prerequisites():
    """Check prerequisites."""
    section("Checking Prerequisites")

    # Check if config.json exists
    if not Path(CONFIG_FILE).exists():
        error(f"{CONFIG_FILE} not found. Please ensure the configuration file exists.")

    # Parse region from config
    with open(CONFIG_FILE, "r") as f:
        config = json.load(f)
    
    region = config.get("region", "us-east-1")
    if not region:
        warning("Region not found in config.json, using default us-east-1")
        region = "us-east-1"
    else:
        print(f"Using region: {region}")

    # Validate region format
    import re
    if not re.match(r"^[a-z]{2}-[a-z]+-[0-9]+$", region):
        error(f"Invalid region format: {region}. Expected format: us-east-1, eu-west-1, etc.")

    # Check AWS CLI is installed
    if not command_exists("aws"):
        error("AWS CLI is not installed. Please install it from https://aws.amazon.com/cli/")

    # Check AWS credentials
    print("Checking AWS credentials...")
    try:
        run_command(f"aws sts get-caller-identity --region {region}")
    except subprocess.CalledProcessError:
        error("AWS credentials not configured or invalid. Please run 'aws configure' to set up your credentials.")
    success("AWS credentials valid")

    # Check Python is installed
    if not command_exists("python3"):
        error("Python 3 is not installed. Please install it from https://www.python.org/")

    # Check Python version
    python_version = run_command("python3 --version", check=False).stdout
    if python_version:
        import re
        version_match = re.search(r"Python (\d+)\.(\d+)\.(\d+)", python_version)
        if version_match:
            major, minor, patch = map(int, version_match.groups())
            if major < 3 or (major == 3 and minor < 12):
                warning(f"Python version {major}.{minor}.{patch} detected. This project recommends Python 3.12 or higher.")
            else:
                print(f"Python version: {major}.{minor}.{patch}")
        else:
            warning("Could not determine Python version.")
    else:
        warning("Could not determine Python version.")

    success("All prerequisites satisfied")


def install_dependencies():
    """Install dependencies."""
    section("Installing Dependencies")
    run_command("pip3 install -r requirements.txt")
    success("Dependencies installed")


def build_project():
    """Build the project."""
    section("Building Project")
    # Check if pyproject.toml exists (modern Python packaging)
    if Path("pyproject.toml").exists():
        run_command("pip3 install -e .")
        success("Build completed using pyproject.toml")
    else:
        warning("No pyproject.toml found, skipping build step")


def deploy_infrastructure(region: str):
    """Deploy infrastructure."""
    section("Deploying Infrastructure")
    print(f"Deploying with CDK to region {region}...")
    
    # First, ensure CDK app is properly built
    run_command(f"python3 -m src.infrastructure.app")
    
    # Check if CDK is bootstrapped in this account/region
    try:
        print("Checking if CDK is bootstrapped...")
        bootstrap_check = run_command(f"cdk doctor --region {region}", check=False)
        if "not bootstrapped" in bootstrap_check.stdout or "not bootstrapped" in bootstrap_check.stderr:
            print("CDK environment not bootstrapped. Bootstrapping now...")
            run_command(f"cdk bootstrap --region {region}")
        else:
            print("CDK environment already bootstrapped")
    except Exception as e:
        print(f"Warning: Could not check CDK bootstrap status: {e}")
        print("Attempting to bootstrap anyway...")
        try:
            run_command(f"cdk bootstrap --region {region}")
        except Exception as bootstrap_error:
            print(f"Bootstrap warning: {bootstrap_error}")
    
    # Deploy the stack
    try:
        run_command(f"cdk deploy --require-approval never --region {region}")
    except subprocess.CalledProcessError as e:
        error_message = e.stderr if e.stderr else e.stdout
        error(f"CDK deployment failed: {error_message}")
    
    success("Infrastructure deployed")


def configure_application(region: str):
    """Configure the application."""
    section("Configuring Application")
    print("Getting deployment outputs...")
    
    # Get stack outputs
    cf_client = boto3.client("cloudformation", region_name=region)
    try:
        response = cf_client.describe_stacks(StackName=STACK_NAME)
        outputs = {}
        
        if response["Stacks"] and response["Stacks"][0]["Outputs"]:
            for output in response["Stacks"][0]["Outputs"]:
                outputs[output["OutputKey"]] = output["OutputValue"]
    except Exception as e:
        error(f"Failed to get stack outputs: {e}")
    
    # Extract values from outputs
    api_endpoint = outputs.get("ApiEndpoint")
    cloudfront_domain = outputs.get("CloudFrontDomain")
    document_bucket = outputs.get("DocumentBucketName")
    website_bucket = outputs.get("WebsiteBucketName")
    api_key_id = outputs.get("ApiKeyId")
    websocket_url = outputs.get("WebSocketApiUrl")
    
    # Validate required outputs
    if not all([api_endpoint, cloudfront_domain, document_bucket, website_bucket, api_key_id]):
        error("Missing required stack outputs")
    
    # Get API key value
    print("Getting API key...")
    apigw_client = boto3.client("apigateway", region_name=region)
    try:
        response = apigw_client.get_api_key(
            apiKey=api_key_id,
            includeValue=True
        )
        api_key = response["value"]
    except Exception as e:
        error(f"Failed to get API key: {e}")
    
    # Update widget.js with API endpoint, key, and WebSocket URL
    print("Updating widget.js with deployment values...")
    widget_path = Path("src/frontend/widget.js")
    if widget_path.exists():
        # Create a backup of the original file
        shutil.copy(widget_path, f"{widget_path}.bak")
        
        # Read the file
        with open(widget_path, "r") as f:
            content = f.read()
        
        # Replace placeholders
        content = content.replace("API_ENDPOINT_PLACEHOLDER", api_endpoint)
        content = content.replace("API_KEY_PLACEHOLDER", api_key)
        
        # Only replace WebSocket URL if it exists
        if websocket_url:
            content = content.replace("WEBSOCKET_URL_PLACEHOLDER", websocket_url)
        else:
            warning("WebSocket URL not found in stack outputs, streaming may not work")
            content = content.replace("WEBSOCKET_URL_PLACEHOLDER", "")
        
        # Write the updated file
        with open(widget_path, "w") as f:
            f.write(content)
        
        success("Widget configuration updated")
    else:
        error(f"{widget_path} not found")
    
    return {
        "api_endpoint": api_endpoint,
        "cloudfront_domain": cloudfront_domain,
        "document_bucket": document_bucket,
        "website_bucket": website_bucket,
        "api_key": api_key,
        "websocket_url": websocket_url
    }


def upload_frontend_assets(website_bucket: str, region: str):
    """Upload frontend assets."""
    section("Uploading Frontend Assets")
    print(f"Uploading to S3 bucket: {website_bucket}")
    
    s3_client = boto3.client("s3", region_name=region)
    
    # Upload widget.js
    widget_path = Path("src/frontend/widget.js")
    if widget_path.exists():
        s3_client.upload_file(
            str(widget_path),
            website_bucket,
            "widget.js",
            ExtraArgs={"ContentType": "application/javascript"}
        )
        print(f"Uploaded {widget_path}")
    else:
        warning(f"{widget_path} not found, skipping")
    
    # Upload index.html
    index_path = Path("src/frontend/index.html")
    if index_path.exists():
        s3_client.upload_file(
            str(index_path),
            website_bucket,
            "index.html",
            ExtraArgs={"ContentType": "text/html"}
        )
        print(f"Uploaded {index_path}")
    else:
        warning(f"{index_path} not found, skipping")
    
    success("Frontend assets uploaded")


def process_knowledge_base(region: str):
    """Process knowledge base."""
    section("Processing Knowledge Base")
    
    # Check if documents folder exists and has files
    docs_folder = Path(DOCS_FOLDER)
    if docs_folder.exists() and any(docs_folder.iterdir()):
        print("Uploading documents to knowledge base...")
        try:
            run_command(f"python3 -m scripts.upload_documents --folder {DOCS_FOLDER}")
            success("Documents processed")
        except subprocess.CalledProcessError:
            warning("Document upload script encountered issues")
    else:
        warning("No documents folder found or folder is empty. Create a 'documents' folder and add your knowledge base files.")


def configure_database_security(db_security_group: str, region: str):
    """Configure database security."""
    section("Configuring Database Security")
    print(f"Adding security group rules for EC2 and Lambda services in {region} region...")
    
    if not db_security_group:
        warning("Could not find database security group ID in stack outputs. Skipping security group configuration.")
        return
    
    print(f"Found database security group: {YELLOW}{db_security_group}{NC}")
    
    # Add IPv4 rules for EC2 and Lambda services in the configured region
    print(f"Adding IPv4 rules for EC2 and Lambda services in {region}...")
    
    ec2_client = boto3.client("ec2", region_name=region)
    
    # Note: These CIDR blocks are specific to us-east-1
    # For other regions, you would need to update these ranges
    if region == "us-east-1":
        # Large blocks for us-east-1
        large_blocks = [
            "3.80.0.0/12", "3.208.0.0/12", "3.224.0.0/12", "34.192.0.0/12", 
            "34.224.0.0/12", "44.192.0.0/11", "52.0.0.0/8", "54.0.0.0/8"
        ]
        
        for cidr in large_blocks:
            print(f"Adding rule for {cidr}...")
            try:
                ec2_client.authorize_security_group_ingress(
                    GroupId=db_security_group,
                    IpProtocol="tcp",
                    FromPort=5432,
                    ToPort=5432,
                    CidrIp=cidr
                )
            except ec2_client.exceptions.ClientError as e:
                if e.response["Error"]["Code"] == "InvalidPermission.Duplicate":
                    warning(f"Rule for {cidr} already exists")
                else:
                    warning(f"Failed to add rule for {cidr}: {e}")
        
        # Medium blocks for us-east-1
        medium_blocks = [
            "13.216.0.0/13", "18.204.0.0/14", "18.208.0.0/13", "23.20.0.0/14", 
            "35.168.0.0/13", "50.16.0.0/15", "98.80.0.0/12", "100.24.0.0/13", 
            "107.20.0.0/14", "174.129.0.0/16", "184.73.0.0/16"
        ]
        
        for cidr in medium_blocks:
            print(f"Adding rule for {cidr}...")
            try:
                ec2_client.authorize_security_group_ingress(
                    GroupId=db_security_group,
                    IpProtocol="tcp",
                    FromPort=5432,
                    ToPort=5432,
                    CidrIp=cidr
                )
            except ec2_client.exceptions.ClientError as e:
                if e.response["Error"]["Code"] == "InvalidPermission.Duplicate":
                    warning(f"Rule for {cidr} already exists")
                else:
                    warning(f"Failed to add rule for {cidr}: {e}")
        
        # Add IPv6 rules for us-east-1
        print(f"Adding IPv6 rules for EC2 and Lambda services in {region}...")
        ipv6_blocks = ["2600:1f00::/24", "2600:f0f0::/28", "2606:f40::/36"]
        
        for ipv6_cidr in ipv6_blocks:
            print(f"Adding rule for {ipv6_cidr}...")
            try:
                ec2_client.authorize_security_group_ingress(
                    GroupId=db_security_group,
                    IpPermissions=[
                        {
                            "IpProtocol": "tcp",
                            "FromPort": 5432,
                            "ToPort": 5432,
                            "Ipv6Ranges": [{"CidrIpv6": ipv6_cidr}]
                        }
                    ]
                )
            except ec2_client.exceptions.ClientError as e:
                if e.response["Error"]["Code"] == "InvalidPermission.Duplicate":
                    warning(f"Rule for {ipv6_cidr} already exists")
                else:
                    warning(f"Failed to add rule for {ipv6_cidr}: {e}")
    else:
        warning(f"Security group rules are pre-configured for us-east-1 region only.")
        warning(f"For region {region}, you may need to manually configure security group rules.")
        warning(f"Please refer to AWS documentation for Lambda IP ranges in your region.")
        
        # Add a basic rule allowing all traffic (less secure but functional)
        print(f"Adding basic rule to allow Lambda access (consider restricting this in production)...")
        try:
            ec2_client.authorize_security_group_ingress(
                GroupId=db_security_group,
                IpProtocol="tcp",
                FromPort=5432,
                ToPort=5432,
                CidrIp="0.0.0.0/0"
            )
        except ec2_client.exceptions.ClientError as e:
            if e.response["Error"]["Code"] == "InvalidPermission.Duplicate":
                warning(f"Rule for 0.0.0.0/0 already exists")
            else:
                warning(f"Failed to add basic rule: {e}")
    
    success(f"Security group rules configured for region {region}")


def display_summary(outputs: Dict[str, str]):
    """Display deployment summary."""
    section("Deployment Summary")
    print(f"API Endpoint: {YELLOW}{outputs['api_endpoint']}{NC}")
    print(f"CloudFront Domain: {YELLOW}{outputs['cloudfront_domain']}{NC}")
    print(f"Document Bucket: {YELLOW}{outputs['document_bucket']}{NC}")
    print(f"Website Bucket: {YELLOW}{outputs['website_bucket']}{NC}")
    if outputs.get("websocket_url"):
        print(f"WebSocket URL: {YELLOW}{outputs['websocket_url']}{NC}")
    
    section("Integration Instructions")
    print("Add the following code to your website:")
    print(f"{YELLOW}<script src=\"https://{outputs['cloudfront_domain']}/widget.js\"></script>")
    print("<script>")
    print("  SmallBizChatbot.init({")
    print("    containerId: 'chatbot-container',")
    print("    theme: {")
    print("      primaryColor: '#4287f5',")
    print("      fontFamily: 'Arial, sans-serif'")
    print("    }")
    print("  });")
    print("</script>")
    print(f"<div id=\"chatbot-container\"></div>{NC}")
    
    section("Demo Page")
    print(f"View the demo page at: {YELLOW}https://{outputs['cloudfront_domain']}/index.html{NC}")
    print(f"\n{YELLOW}Note: It may take a few minutes for the CloudFront distribution to fully deploy.{NC}")
    
    section("Next Steps")
    print(f"1. Add more documents to the '{DOCS_FOLDER}' folder and run 'python3 -m scripts.upload_documents --folder ./{DOCS_FOLDER}'")
    print("2. Customize the widget appearance using the theme options")
    print("3. Monitor usage in the AWS CloudWatch console")
    
    success("Deployment completed successfully!")


def main():
    """Main entry point."""
    try:
        # Check prerequisites
        check_prerequisites()
        
        # Load configuration
        with open(CONFIG_FILE, "r") as f:
            config = json.load(f)
        
        region = config.get("region", "us-east-1")
        
        # Install dependencies
        install_dependencies()
        
        # Build project
        build_project()
        
        # Deploy infrastructure
        deploy_infrastructure(region)
        
        # Configure application
        outputs = configure_application(region)
        
        # Upload frontend assets
        upload_frontend_assets(outputs["website_bucket"], region)
        
        # Process knowledge base
        process_knowledge_base(region)
        
        # Configure database security
        db_security_group = outputs.get("db_security_group")
        if db_security_group:
            configure_database_security(db_security_group, region)
        
        # Display summary
        display_summary(outputs)
    except Exception as e:
        error(f"Deployment failed: {e}")


if __name__ == "__main__":
    main()
