#!/usr/bin/env python3
"""
Script to clean up the database.
"""
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import boto3
import psycopg2
from psycopg2.extras import RealDictCursor

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)


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


def get_db_credentials(secret_arn: str, region: str):
    """
    Get database credentials from Secrets Manager.
    
    Args:
        secret_arn: Secret ARN
        region: AWS region
        
    Returns:
        Database credentials
    """
    secrets_manager = boto3.client("secretsmanager", region_name=region)
    
    try:
        response = secrets_manager.get_secret_value(SecretId=secret_arn)
        return json.loads(response["SecretString"])
    except Exception as e:
        logger.error(f"Error retrieving database credentials: {e}")
        raise


def cleanup_database(db_credentials: Dict[str, str]):
    """
    Clean up the database.
    
    Args:
        db_credentials: Database credentials
        
    Returns:
        Cleanup statistics
    """
    try:
        # Connect to the database
        conn = psycopg2.connect(
            host=db_credentials["host"],
            port=db_credentials["port"],
            dbname=db_credentials["dbname"],
            user=db_credentials["username"],
            password=db_credentials["password"],
            sslmode="require"
        )
        
        try:
            with conn.cursor() as cursor:
                # Clean up old document chunks (older than 90 days)
                cursor.execute(
                    "DELETE FROM document_chunks WHERE created_at < NOW() - INTERVAL '90 days'"
                )
                chunks_deleted = cursor.rowcount
                
                # Clean up orphaned documents (no associated chunks)
                cursor.execute(
                    """
                    DELETE FROM documents 
                    WHERE id NOT IN (SELECT DISTINCT document_id FROM document_chunks WHERE document_id IS NOT NULL)
                    AND created_at < NOW() - INTERVAL '7 days'
                    """
                )
                docs_deleted = cursor.rowcount
                
                # Check if processing_logs table exists before cleaning
                cursor.execute(
                    """
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_name = 'processing_logs'
                    )
                    """
                )
                table_exists = cursor.fetchone()[0]
                
                logs_deleted = 0
                if table_exists:
                    cursor.execute(
                        "DELETE FROM processing_logs WHERE created_at < NOW() - INTERVAL '30 days'"
                    )
                    logs_deleted = cursor.rowcount
                
                # Run vacuum operations
                vacuum_tables = [
                    "VACUUM ANALYZE documents",
                    "VACUUM ANALYZE document_chunks",
                    "VACUUM ANALYZE processing_logs",
                ]
                
                for vacuum_query in vacuum_tables:
                    try:
                        cursor.execute(vacuum_query)
                        logger.info(f"Executed: {vacuum_query}")
                    except Exception as e:
                        logger.warning(f"Vacuum operation failed: {vacuum_query} - {e}")
                
                conn.commit()
                
                return {
                    "chunksDeleted": chunks_deleted,
                    "documentsDeleted": docs_deleted,
                    "logsDeleted": logs_deleted,
                }
        finally:
            conn.close()
    except Exception as e:
        logger.error(f"Error during database cleanup: {e}")
        raise


def main():
    """Main entry point."""
    try:
        logger.info("Starting database cleanup...")
        
        # Load configuration
        config = load_config()
        region = config.get("region", "us-east-1")
        
        # Get database credentials from stack outputs
        outputs = get_stack_outputs("ChatbotRagStack", region)
        db_secret_arn = outputs.get("DatabaseCredentialsArn")
        
        if not db_secret_arn:
            raise ValueError("Database credentials ARN not found in stack outputs. Make sure the stack is deployed.")
        
        # Get database credentials
        db_credentials = get_db_credentials(db_secret_arn, region)
        
        # Clean up the database
        result = cleanup_database(db_credentials)
        
        logger.info(f"Database cleanup completed: {result}")
    except Exception as e:
        logger.error(f"Error: {e}")
        import sys
        sys.exit(1)


if __name__ == "__main__":
    main()
