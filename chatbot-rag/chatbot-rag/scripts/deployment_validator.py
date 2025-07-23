#!/usr/bin/env python3
"""
Deployment validation script for RAG Chatbot.
Performs comprehensive pre-deployment checks and post-deployment validation.
"""
import json
import logging
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import boto3
import requests
from botocore.exceptions import ClientError, NoCredentialsError

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class Colors:
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    RED = '\033[0;31m'
    BLUE = '\033[0;34m'
    CYAN = '\033[0;36m'
    BOLD = '\033[1m'
    NC = '\033[0m'

class DeploymentValidator:
    def __init__(self, config_file: str = "config.json"):
        self.config_file = config_file
        self.config = {}
        self.region = "us-east-1"
        self.stack_name = "ChatbotRagStack"
        
    def load_config(self) -> bool:
        """Load configuration from file."""
        try:
            with open(self.config_file, 'r') as f:
                self.config = json.load(f)
            self.region = self.config.get('region', 'us-east-1')
            return True
        except FileNotFoundError:
            self.print_error(f"Configuration file {self.config_file} not found")
            return False
        except json.JSONDecodeError as e:
            self.print_error(f"Invalid JSON in {self.config_file}: {e}")
            return False
    
    def print_success(self, message: str):
        """Print success message."""
        print(f"{Colors.GREEN}✅ {message}{Colors.NC}")
    
    def print_error(self, message: str):
        """Print error message."""
        print(f"{Colors.RED}❌ {message}{Colors.NC}")
    
    def print_warning(self, message: str):
        """Print warning message."""
        print(f"{Colors.YELLOW}⚠️  {message}{Colors.NC}")
    
    def print_info(self, message: str):
        """Print info message."""
        print(f"{Colors.CYAN}ℹ️  {message}{Colors.NC}")
    
    def print_section(self, title: str):
        """Print section header."""
        print(f"\n{Colors.BLUE}{'='*60}{Colors.NC}")
        print(f"{Colors.BLUE}{title}{Colors.NC}")
        print(f"{Colors.BLUE}{'='*60}{Colors.NC}")
    
    def check_system_requirements(self) -> bool:
        """Check system requirements."""
        self.print_section("System Requirements Check")
        
        checks_passed = 0
        total_checks = 8  # Updated to include npm and CDK CLI
        
        # Check Python version
        try:
            result = subprocess.run(['python3', '--version'], capture_output=True, text=True)
            if result.returncode == 0:
                version = result.stdout.strip().split()[1]
                major, minor = map(int, version.split('.')[:2])
                if major >= 3 and minor >= 12:
                    self.print_success(f"Python {version} (meets minimum requirement)")
                    checks_passed += 1
                else:
                    self.print_error(f"Python {version} is too old (need 3.12+)")
            else:
                self.print_error("Python 3 not found")
        except FileNotFoundError:
            self.print_error("Python 3 not installed")
        
        # Check pip
        try:
            result = subprocess.run(['pip3', '--version'], capture_output=True, text=True)
            if result.returncode == 0:
                self.print_success("pip3 available")
                checks_passed += 1
            else:
                self.print_error("pip3 not found")
        except FileNotFoundError:
            self.print_error("pip3 not installed")
        
        # Check AWS CLI
        try:
            result = subprocess.run(['aws', '--version'], capture_output=True, text=True)
            if result.returncode == 0:
                version = result.stdout.strip().split()[0]
                self.print_success(f"AWS CLI {version}")
                checks_passed += 1
            else:
                self.print_error("AWS CLI not working")
        except FileNotFoundError:
            self.print_error("AWS CLI not installed")
        
        # Check Node.js
        try:
            result = subprocess.run(['node', '--version'], capture_output=True, text=True)
            if result.returncode == 0:
                version = result.stdout.strip()
                self.print_success(f"Node.js {version}")
                checks_passed += 1
            else:
                self.print_error("Node.js not working")
        except FileNotFoundError:
            self.print_error("Node.js not installed (required for AWS CDK)")
        
        # Check npm
        try:
            result = subprocess.run(['npm', '--version'], capture_output=True, text=True)
            if result.returncode == 0:
                version = result.stdout.strip()
                self.print_success(f"npm {version}")
                checks_passed += 1
            else:
                self.print_error("npm not working")
        except FileNotFoundError:
            self.print_error("npm not installed (required for AWS CDK)")
        
        # Check AWS CDK CLI
        try:
            result = subprocess.run(['cdk', '--version'], capture_output=True, text=True)
            if result.returncode == 0:
                version = result.stdout.strip()
                self.print_success(f"AWS CDK CLI {version}")
                checks_passed += 1
            else:
                self.print_error("AWS CDK CLI not working")
        except FileNotFoundError:
            self.print_error("AWS CDK CLI not installed")
        
        # Check disk space (need at least 1GB)
        try:
            result = subprocess.run(['df', '.'], capture_output=True, text=True)
            if result.returncode == 0:
                lines = result.stdout.strip().split('\n')
                if len(lines) > 1:
                    available_kb = int(lines[1].split()[3])
                    available_gb = available_kb / (1024 * 1024)
                    if available_gb >= 1.0:
                        self.print_success(f"Disk space: {available_gb:.1f}GB available")
                        checks_passed += 1
                    else:
                        self.print_warning(f"Low disk space: {available_gb:.1f}GB available (recommend 1GB+)")
                        checks_passed += 1  # Warning, but not blocking
        except:
            self.print_warning("Could not check disk space")
            checks_passed += 1  # Don't block on this
        
        # Check internet connectivity
        try:
            response = requests.get('https://aws.amazon.com', timeout=10)
            if response.status_code == 200:
                self.print_success("Internet connectivity to AWS")
                checks_passed += 1
            else:
                self.print_error("Cannot reach AWS services")
        except requests.RequestException:
            self.print_error("No internet connectivity or AWS blocked")
        
        success_rate = (checks_passed / total_checks) * 100
        print(f"\n{Colors.CYAN}System Requirements: {checks_passed}/{total_checks} checks passed ({success_rate:.0f}%){Colors.NC}")
        
        return checks_passed >= 6  # Allow 2 failures
    
    def check_aws_credentials(self) -> bool:
        """Check AWS credentials and permissions."""
        self.print_section("AWS Credentials & Permissions Check")
        
        try:
            # Test basic AWS access
            sts = boto3.client('sts', region_name=self.region)
            identity = sts.get_caller_identity()
            
            self.print_success(f"AWS credentials valid")
            self.print_info(f"Account: {identity.get('Account')}")
            self.print_info(f"User/Role: {identity.get('Arn')}")
            
            # Test required service access
            services_to_test = [
                ('cloudformation', 'CloudFormation'),
                ('lambda', 'Lambda'),
                ('apigateway', 'API Gateway'),
                ('s3', 'S3'),
                ('rds', 'RDS'),
                ('secretsmanager', 'Secrets Manager'),
                ('bedrock', 'Bedrock'),
                ('ec2', 'EC2')
            ]
            
            permissions_ok = True
            for service, display_name in services_to_test:
                try:
                    client = boto3.client(service, region_name=self.region)
                    
                    # Test basic access with a safe operation
                    if service == 'cloudformation':
                        client.list_stacks(MaxItems=1)
                    elif service == 'lambda':
                        client.list_functions(MaxItems=1)
                    elif service == 'apigateway':
                        client.get_rest_apis(limit=1)
                    elif service == 's3':
                        client.list_buckets()
                    elif service == 'rds':
                        client.describe_db_instances(MaxRecords=1)
                    elif service == 'secretsmanager':
                        client.list_secrets(MaxResults=1)
                    elif service == 'bedrock':
                        client.list_foundation_models()
                    elif service == 'ec2':
                        client.describe_regions()
                    
                    self.print_success(f"{display_name} access confirmed")
                    
                except ClientError as e:
                    error_code = e.response['Error']['Code']
                    if error_code in ['AccessDenied', 'UnauthorizedOperation']:
                        self.print_error(f"{display_name} access denied")
                        permissions_ok = False
                    else:
                        self.print_warning(f"{display_name} access uncertain: {error_code}")
                except Exception as e:
                    self.print_warning(f"{display_name} test failed: {str(e)[:50]}")
            
            return permissions_ok
            
        except NoCredentialsError:
            self.print_error("AWS credentials not configured")
            self.print_info("Run 'aws configure' to set up credentials")
            return False
        except ClientError as e:
            self.print_error(f"AWS credentials invalid: {e}")
            return False
        except Exception as e:
            self.print_error(f"AWS access test failed: {e}")
            return False
    
    def check_bedrock_access(self) -> bool:
        """Check Bedrock model access."""
        self.print_section("Bedrock Model Access Check")
        
        try:
            bedrock = boto3.client('bedrock', region_name=self.region)
            
            # List available models
            models = bedrock.list_foundation_models()
            
            required_models = [
                'amazon.nova-lite-v1',
                'amazon.titan-embed-text-v1'
            ]
            
            available_models = [model['modelId'] for model in models['modelSummaries']]
            
            all_models_available = True
            for model in required_models:
                if model in available_models:
                    self.print_success(f"Model {model} available")
                else:
                    self.print_error(f"Model {model} not available")
                    all_models_available = False
            
            if not all_models_available:
                self.print_info("You may need to request access to these models in the Bedrock console")
            
            return all_models_available
            
        except ClientError as e:
            if e.response['Error']['Code'] == 'AccessDeniedException':
                self.print_error("Bedrock access denied - check IAM permissions")
            else:
                self.print_error(f"Bedrock access failed: {e}")
            return False
        except Exception as e:
            self.print_error(f"Bedrock check failed: {e}")
            return False
    
    def validate_configuration(self) -> bool:
        """Validate configuration file."""
        self.print_section("Configuration Validation")
        
        if not self.load_config():
            return False
        
        required_keys = [
            'region',
            'bedrock',
            'database',
            'api',
            'lambda',
            'widget'
        ]
        
        validation_passed = True
        
        for key in required_keys:
            if key in self.config:
                self.print_success(f"Configuration key '{key}' present")
            else:
                self.print_error(f"Missing required configuration key: {key}")
                validation_passed = False
        
        # Validate region format
        region = self.config.get('region', '')
        if region and len(region.split('-')) == 3:
            self.print_success(f"Region format valid: {region}")
        else:
            self.print_error(f"Invalid region format: {region}")
            validation_passed = False
        
        # Validate database config
        db_config = self.config.get('database', {})
        if 'instanceType' in db_config and 'allocatedStorage' in db_config:
            self.print_success("Database configuration valid")
        else:
            self.print_error("Invalid database configuration")
            validation_passed = False
        
        return validation_passed
    
    def check_resource_limits(self) -> bool:
        """Check AWS resource limits."""
        self.print_section("AWS Resource Limits Check")
        
        try:
            # Check Lambda limits
            lambda_client = boto3.client('lambda', region_name=self.region)
            
            # Check concurrent executions limit
            account_settings = lambda_client.get_account_settings()
            concurrent_limit = account_settings['AccountLimit']['ConcurrentExecutions']
            
            if concurrent_limit >= 10:  # Need at least 10 for deployment
                self.print_success(f"Lambda concurrent executions limit: {concurrent_limit}")
            else:
                self.print_warning(f"Low Lambda concurrent executions limit: {concurrent_limit}")
            
            # Check RDS limits
            rds_client = boto3.client('rds', region_name=self.region)
            
            # This is a simplified check - in practice you'd need to check quotas
            self.print_info("RDS limits check - manual verification recommended")
            
            return True
            
        except Exception as e:
            self.print_warning(f"Could not check all resource limits: {e}")
            return True  # Don't block deployment on this
    
    def run_pre_deployment_checks(self) -> bool:
        """Run all pre-deployment checks."""
        print(f"{Colors.BOLD}🔍 Pre-Deployment Validation{Colors.NC}")
        print(f"{Colors.CYAN}Checking system readiness for deployment...{Colors.NC}")
        
        checks = [
            ("System Requirements", self.check_system_requirements),
            ("AWS Credentials", self.check_aws_credentials),
            ("Bedrock Access", self.check_bedrock_access),
            ("Configuration", self.validate_configuration),
            ("Resource Limits", self.check_resource_limits)
        ]
        
        passed_checks = 0
        total_checks = len(checks)
        
        for check_name, check_func in checks:
            try:
                if check_func():
                    passed_checks += 1
                else:
                    self.print_error(f"{check_name} check failed")
            except Exception as e:
                self.print_error(f"{check_name} check error: {e}")
        
        success_rate = (passed_checks / total_checks) * 100
        
        self.print_section("Pre-Deployment Summary")
        print(f"{Colors.CYAN}Checks passed: {passed_checks}/{total_checks} ({success_rate:.0f}%){Colors.NC}")
        
        if passed_checks == total_checks:
            self.print_success("All checks passed! Ready for deployment.")
            return True
        elif passed_checks >= total_checks - 1:
            self.print_warning("Most checks passed. Deployment may succeed with warnings.")
            return True
        else:
            self.print_error("Multiple checks failed. Please fix issues before deployment.")
            return False
    
    def check_deployment_status(self) -> Dict:
        """Check deployment status."""
        self.print_section("Deployment Status Check")
        
        try:
            cf_client = boto3.client('cloudformation', region_name=self.region)
            
            # Check if stack exists
            try:
                response = cf_client.describe_stacks(StackName=self.stack_name)
                stack = response['Stacks'][0]
                
                status = stack['StackStatus']
                self.print_info(f"Stack status: {status}")
                
                if status in ['CREATE_COMPLETE', 'UPDATE_COMPLETE']:
                    self.print_success("Stack deployment successful")
                    
                    # Get outputs
                    outputs = {}
                    if 'Outputs' in stack:
                        for output in stack['Outputs']:
                            outputs[output['OutputKey']] = output['OutputValue']
                    
                    return {
                        'status': 'success',
                        'stack_status': status,
                        'outputs': outputs
                    }
                elif status in ['CREATE_IN_PROGRESS', 'UPDATE_IN_PROGRESS']:
                    self.print_info("Stack deployment in progress")
                    return {'status': 'in_progress', 'stack_status': status}
                else:
                    self.print_error(f"Stack in failed state: {status}")
                    return {'status': 'failed', 'stack_status': status}
                    
            except cf_client.exceptions.ClientError as e:
                if 'does not exist' in str(e):
                    self.print_warning("Stack not found - not yet deployed")
                    return {'status': 'not_deployed'}
                else:
                    raise
                    
        except Exception as e:
            self.print_error(f"Could not check deployment status: {e}")
            return {'status': 'error', 'error': str(e)}
    
    def test_api_endpoint(self, api_endpoint: str, api_key: str) -> bool:
        """Test API endpoint."""
        self.print_section("API Endpoint Test")
        
        try:
            headers = {
                'Content-Type': 'application/json',
                'x-api-key': api_key
            }
            
            data = {
                'message': 'Hello, this is a test message'
            }
            
            self.print_info(f"Testing endpoint: {api_endpoint}")
            
            response = requests.post(
                f"{api_endpoint}/chat",
                headers=headers,
                json=data,
                timeout=30
            )
            
            if response.status_code == 200:
                self.print_success("API endpoint responding correctly")
                return True
            else:
                self.print_error(f"API endpoint returned status {response.status_code}")
                self.print_info(f"Response: {response.text[:200]}")
                return False
                
        except requests.RequestException as e:
            self.print_error(f"API endpoint test failed: {e}")
            return False
    
    def run_post_deployment_validation(self) -> bool:
        """Run post-deployment validation."""
        print(f"{Colors.BOLD}🔍 Post-Deployment Validation{Colors.NC}")
        print(f"{Colors.CYAN}Validating deployed resources...{Colors.NC}")
        
        # Check deployment status
        deployment_status = self.check_deployment_status()
        
        if deployment_status['status'] != 'success':
            self.print_error("Deployment not successful")
            return False
        
        outputs = deployment_status.get('outputs', {})
        
        # Test API endpoint if available
        api_endpoint = outputs.get('ApiEndpoint')
        api_key_id = outputs.get('ApiKeyId')
        
        if api_endpoint and api_key_id:
            try:
                # Get API key value
                apigw_client = boto3.client('apigateway', region_name=self.region)
                api_key_response = apigw_client.get_api_key(
                    apiKey=api_key_id,
                    includeValue=True
                )
                api_key = api_key_response['value']
                
                if self.test_api_endpoint(api_endpoint, api_key):
                    self.print_success("Post-deployment validation passed")
                    return True
                else:
                    self.print_error("API endpoint test failed")
                    return False
                    
            except Exception as e:
                self.print_error(f"Could not test API endpoint: {e}")
                return False
        else:
            self.print_warning("API endpoint not found in outputs")
            return False

def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description='RAG Chatbot Deployment Validator')
    parser.add_argument('--pre-deployment', action='store_true', 
                       help='Run pre-deployment checks')
    parser.add_argument('--post-deployment', action='store_true',
                       help='Run post-deployment validation')
    parser.add_argument('--config', default='config.json',
                       help='Configuration file path')
    
    args = parser.parse_args()
    
    validator = DeploymentValidator(args.config)
    
    if args.pre_deployment:
        success = validator.run_pre_deployment_checks()
    elif args.post_deployment:
        success = validator.run_post_deployment_validation()
    else:
        # Run both by default
        print("Running comprehensive deployment validation...")
        pre_success = validator.run_pre_deployment_checks()
        
        if pre_success:
            print(f"\n{Colors.GREEN}Pre-deployment checks passed!{Colors.NC}")
            print(f"{Colors.CYAN}You can now run the deployment script.{Colors.NC}")
        else:
            print(f"\n{Colors.RED}Pre-deployment checks failed!{Colors.NC}")
            print(f"{Colors.CYAN}Please fix the issues above before deploying.{Colors.NC}")
        
        success = pre_success
    
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
