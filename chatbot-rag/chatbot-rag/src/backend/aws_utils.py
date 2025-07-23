"""
AWS utilities for the chatbot backend.
"""
import logging
import os
import threading
from typing import Any, Optional

import boto3

# Initialize logger
logger = logging.getLogger(__name__)

# Thread-local storage for AWS clients
_thread_local = threading.local()


def get_aws_region() -> str:
    """
    Get AWS region from environment or config.
    
    Returns:
        AWS region string
    """
    return (
        os.environ.get("AWS_REGION")
        or os.environ.get("REGION")
        or os.environ.get("AWS_DEFAULT_REGION")
        or "us-east-1"
    )


def get_aws_client(service_name: str, region: Optional[str] = None) -> Any:
    """
    Get an AWS client with lazy loading.
    
    Args:
        service_name: AWS service name
        region: AWS region (optional)
        
    Returns:
        AWS client
    """
    try:
        # Use thread-local storage to cache clients
        if not hasattr(_thread_local, "aws_clients"):
            _thread_local.aws_clients = {}
        
        # Use provided region or default
        region = region or get_aws_region()
        
        # Create a unique key for this client
        client_key = f"{service_name}:{region}"
        
        # Return cached client if it exists
        if client_key in _thread_local.aws_clients:
            return _thread_local.aws_clients[client_key]
        
        # Create and cache a new client
        logger.debug(f"Creating new AWS client for {service_name} in {region}")
        client = boto3.client(service_name, region_name=region)
        _thread_local.aws_clients[client_key] = client
        
        return client
    except Exception as e:
        logger.error(f"Failed to create AWS client for {service_name}: {e}")
        raise


def get_aws_resource(service_name: str, region: Optional[str] = None) -> Any:
    """
    Get an AWS resource with lazy loading.
    
    Args:
        service_name: AWS service name
        region: AWS region (optional)
        
    Returns:
        AWS resource
    """
    try:
        # Use thread-local storage to cache resources
        if not hasattr(_thread_local, "aws_resources"):
            _thread_local.aws_resources = {}
        
        # Use provided region or default
        region = region or get_aws_region()
        
        # Create a unique key for this resource
        resource_key = f"{service_name}:{region}"
        
        # Return cached resource if it exists
        if resource_key in _thread_local.aws_resources:
            return _thread_local.aws_resources[resource_key]
        
        # Create and cache a new resource
        logger.debug(f"Creating new AWS resource for {service_name} in {region}")
        resource = boto3.resource(service_name, region_name=region)
        _thread_local.aws_resources[resource_key] = resource
        
        return resource
    except Exception as e:
        logger.error(f"Failed to create AWS resource for {service_name}: {e}")
        raise


# Specific client getters for commonly used services
def get_bedrock_client() -> Any:
    """
    Get a Bedrock client.
    
    Returns:
        Bedrock client
    """
    return get_aws_client("bedrock-runtime")


def get_s3_client() -> Any:
    """
    Get an S3 client.
    
    Returns:
        S3 client
    """
    return get_aws_client("s3")


def get_s3_resource() -> Any:
    """
    Get an S3 resource.
    
    Returns:
        S3 resource
    """
    return get_aws_resource("s3")


def get_dynamodb_client() -> Any:
    """
    Get a DynamoDB client.
    
    Returns:
        DynamoDB client
    """
    return get_aws_client("dynamodb")


def get_dynamodb_resource() -> Any:
    """
    Get a DynamoDB resource.
    
    Returns:
        DynamoDB resource
    """
    return get_aws_resource("dynamodb")


def get_secrets_manager_client() -> Any:
    """
    Get a Secrets Manager client.
    
    Returns:
        Secrets Manager client
    """
    return get_aws_client("secretsmanager")


def get_textract_client() -> Any:
    """
    Get a Textract client.
    
    Returns:
        Textract client
    """
    return get_aws_client("textract")


def get_cloudwatch_client() -> Any:
    """
    Get a CloudWatch client.
    
    Returns:
        CloudWatch client
    """
    return get_aws_client("logs")
