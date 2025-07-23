#!/usr/bin/env python3
"""
Script to upload documents to the chatbot knowledge base.
"""
import argparse
import json
import logging
import mimetypes
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import boto3

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)


def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="Upload documents to the chatbot knowledge base")
    parser.add_argument(
        "--folder",
        type=str,
        default="./documents",
        help="Folder containing documents to upload (default: ./documents)"
    )
    return parser.parse_args()


def load_config():
    """Load configuration from config.json."""
    config_path = Path(__file__).parent.parent / "config.json"
    with open(config_path, "r") as f:
        return json.load(f)


def get_stack_outputs(stack_name: str, region: str):
    """
    Get CloudFormation stack outputs.
    
    Args:
        stack_name: Stack name
        region: AWS region
        
    Returns:
        Dictionary of stack outputs
    """
    cf_client = boto3.client("cloudformation", region_name=region)
    
    try:
        response = cf_client.describe_stacks(StackName=stack_name)
        outputs = {}
        
        if response["Stacks"] and response["Stacks"][0]["Outputs"]:
            for output in response["Stacks"][0]["Outputs"]:
                outputs[output["OutputKey"]] = output["OutputValue"]
        
        return outputs
    except Exception as e:
        logger.error(f"Error getting stack outputs: {e}")
        raise


async def extract_file_metadata(file_path: Path):
    """
    Extract metadata from file.
    
    Args:
        file_path: Path to file
        
    Returns:
        File metadata
    """
    file_name = file_path.name
    file_ext = file_path.suffix.lower()
    file_stat = file_path.stat()
    
    # Basic metadata
    metadata = {
        "fileName": file_name,
        "fileSize": file_stat.st_size,
        "lastModified": file_stat.st_mtime,
        "fileType": file_ext[1:]  # Remove the dot
    }
    
    # Try to extract more metadata based on file type
    try:
        if file_ext in [".md", ".txt"]:
            # For markdown and text files, try to extract title from first line
            with open(file_path, "r", encoding="utf-8") as f:
                first_line = f.readline().strip()
            
            if first_line and len(first_line) < 100:
                metadata["title"] = first_line
        
        # Add more metadata extraction for other file types as needed
        
    except Exception as e:
        logger.warning(f"Warning: Could not extract additional metadata from {file_path}: {e}")
    
    return metadata


def upload_file(file_path: Path, bucket_name: str, region: str):
    """
    Upload a file to S3.
    
    Args:
        file_path: Path to file
        bucket_name: S3 bucket name
        region: AWS region
        
    Returns:
        Upload result
    """
    try:
        # Extract metadata from file
        metadata = extract_file_metadata(file_path)
        
        # Read file content
        with open(file_path, "rb") as f:
            file_content = f.read()
        
        file_name = file_path.name
        
        # Convert metadata to S3 metadata format (all values must be strings)
        s3_metadata = {}
        for key, value in metadata.items():
            if value is not None:
                s3_metadata[key] = str(value)
        
        # Get content type
        content_type = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
        
        # Upload to S3
        s3_client = boto3.client("s3", region_name=region)
        s3_client.put_object(
            Bucket=bucket_name,
            Key=f"documents/{file_name}",
            Body=file_content,
            ContentType=content_type,
            Metadata=s3_metadata
        )
        
        logger.info(f"Uploaded {file_name} to s3://{bucket_name}/documents/{file_name} with metadata")
        return True
    except Exception as e:
        logger.error(f"Error uploading {file_path}: {e}")
        raise


def process_directory(dir_path: Path, bucket_name: str, region: str):
    """
    Process all files in a directory.
    
    Args:
        dir_path: Directory path
        bucket_name: S3 bucket name
        region: AWS region
    """
    try:
        for file_path in dir_path.iterdir():
            if file_path.is_dir():
                process_directory(file_path, bucket_name, region)
            else:
                upload_file(file_path, bucket_name, region)
    except Exception as e:
        logger.error(f"Error processing directory {dir_path}: {e}")
        raise


def main():
    """Main entry point."""
    args = parse_args()
    
    try:
        logger.info(f"Processing documents from {args.folder}...")
        
        # Load configuration
        config = load_config()
        region = config.get("region", "us-east-1")
        
        # Get bucket name from stack outputs
        outputs = get_stack_outputs("ChatbotRagStack", region)
        bucket_name = outputs.get("DocumentBucketName")
        
        if not bucket_name:
            raise ValueError("Document bucket name not found in stack outputs. Make sure the stack is deployed.")
        
        # Process the directory
        process_directory(Path(args.folder), bucket_name, region)
        
        logger.info("Document upload complete!")
    except Exception as e:
        logger.error(f"Error: {e}")
        import sys
        sys.exit(1)


if __name__ == "__main__":
    main()
