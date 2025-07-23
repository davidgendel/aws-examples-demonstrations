"""
Document processor Lambda function for the chatbot backend.
"""
import json
import logging
import os
from datetime import datetime
from typing import Any, Dict

import boto3

from .bedrock_utils import generate_embeddings
from .aws_utils import get_aws_region
from .chunking import create_chunks
from .db_utils import cleanup_connections, get_db_pool
from .document_utils import extract_text_from_document

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)


def process_document(bucket: str, key: str) -> Dict[str, Any]:
    """
    Process document and store embeddings.
    
    Args:
        bucket: S3 bucket name
        key: S3 object key
        
    Returns:
        Processing result
    """
    conn = None
    try:
        # Extract text and metadata from document
        extracted_content = extract_text_from_document(bucket, key)
        
        # Connect to database pool
        pool = get_db_pool()
        
        # Get a connection from the pool
        conn = pool.getconn()
        
        # Insert document metadata
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO documents 
                (document_key, title, source, author, file_type, file_size, metadata) 
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (document_key) 
                DO UPDATE SET 
                  title = %s,
                  source = %s,
                  author = %s,
                  file_type = %s,
                  file_size = %s,
                  metadata = %s,
                  last_updated = CURRENT_TIMESTAMP
                RETURNING id
                """,
                [
                    key,
                    extracted_content["title"] or key.split("/")[-1],
                    extracted_content["metadata"].get("source") or bucket,
                    extracted_content["metadata"].get("author"),
                    extracted_content["metadata"].get("fileExtension"),
                    extracted_content["metadata"].get("fileSize"),
                    json.dumps(extracted_content["metadata"]),
                    extracted_content["title"] or key.split("/")[-1],
                    extracted_content["metadata"].get("source") or bucket,
                    extracted_content["metadata"].get("author"),
                    extracted_content["metadata"].get("fileExtension"),
                    extracted_content["metadata"].get("fileSize"),
                    json.dumps(extracted_content["metadata"])
                ]
            )
            document_id = cursor.fetchone()[0]
        
        # Create chunks using advanced chunking strategy
        chunks = create_chunks(extracted_content)
        
        logger.info(f"Created {len(chunks)} chunks for document {key}")
        
        # Process chunks in batches for better performance
        batch_size = 10  # Process 10 chunks at a time
        total_chunks = len(chunks)
        
        for batch_start in range(0, total_chunks, batch_size):
            batch_end = min(batch_start + batch_size, total_chunks)
            batch_chunks = chunks[batch_start:batch_end]
            
            # Generate embeddings for all chunks in the batch
            batch_embeddings = []
            for chunk in batch_chunks:
                embedding = generate_embeddings(chunk["content"])
                batch_embeddings.append(embedding)
            
            # Store all chunks in the batch in a single transaction
            with conn.cursor() as cursor:
                # Prepare batch insert for document_chunks
                for i, (chunk, embedding) in enumerate(zip(batch_chunks, batch_embeddings)):
                    chunk_index = batch_start + i
                    cursor.execute(
                        """
                        INSERT INTO document_chunks 
                        (document_id, chunk_index, content, embedding, chunk_type, heading, importance_score, metadata) 
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        [
                            document_id,
                            chunk_index,
                            chunk["content"],
                            embedding,
                            chunk.get("type") or "text",
                            chunk.get("heading"),
                            chunk.get("importanceScore") or 1.0,
                            json.dumps(chunk.get("metadata") or {})
                        ]
                    )
                    
                    # For backward compatibility, also insert into the old table
                    legacy_document_id = f"{key}_chunk_{chunk_index + 1}"
                    cursor.execute(
                        'INSERT INTO document_embeddings (document_id, content, embedding) VALUES (%s, %s, %s)',
                        [legacy_document_id, chunk["content"], embedding]
                    )
            
            # Commit the batch
            conn.commit()
            
            logger.info(f"Processed chunks {batch_start+1}-{batch_end}/{total_chunks} for document {key}")
        
        return {
            "success": True,
            "documentId": key,
            "databaseId": document_id,
            "chunks": len(chunks)
        }
    except Exception as e:
        # Rollback in case of error
        if conn:
            conn.rollback()
        logger.error(f"Error processing document: {e}", exc_info=True)
        raise
    finally:
        # Always release the connection back to the pool
        if conn:
            pool.putconn(conn)


def generate_upload_url(key: str, content_type: str) -> str:
    """
    Generate pre-signed URL for document upload.
    
    Args:
        key: S3 object key
        content_type: Content type
        
    Returns:
        Pre-signed URL
    """
    try:
        s3_client = boto3.client("s3", region_name=get_aws_region())
        
        return s3_client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": os.environ["DOCUMENT_BUCKET"],
                "Key": key,
                "ContentType": content_type
            },
            ExpiresIn=3600
        )
    except Exception as e:
        logger.error(f"Failed to generate upload URL for {key}: {e}")
        raise


def cleanup_processing_data() -> Dict[str, int]:
    """
    Clean up failed processing attempts and temporary data.
    
    Returns:
        Cleanup statistics
    """
    try:
        pool = get_db_pool()
        conn = pool.getconn()
        
        try:
            with conn.cursor() as cursor:
                # Clean up failed processing attempts (older than 24 hours)
                cursor.execute(
                    """
                    DELETE FROM processing_logs 
                    WHERE status = 'failed' 
                    AND created_at < NOW() - INTERVAL '24 hours'
                    """
                )
                failed_result = cursor.rowcount
                
                # Clean up temporary processing data
                cursor.execute(
                    """
                    DELETE FROM document_chunks 
                    WHERE (content IS NULL OR content = '') 
                    AND created_at < NOW() - INTERVAL '1 hour'
                    """
                )
                temp_result = cursor.rowcount
                
                conn.commit()
                
                return {
                    "failedProcessingDeleted": failed_result,
                    "tempDataDeleted": temp_result
                }
        finally:
            pool.putconn(conn)
    except Exception as e:
        logger.error(f"Error during document processing cleanup: {e}", exc_info=True)
        raise


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    AWS Lambda handler function.
    
    Args:
        event: Lambda event
        context: Lambda context
        
    Returns:
        Lambda response
    """
    try:
        # Check if this is an S3 event (document uploaded)
        if event.get("Records") and event["Records"][0].get("eventSource") == "aws:s3":
            bucket = event["Records"][0]["s3"]["bucket"]["name"]
            key = event["Records"][0]["s3"]["object"]["key"].replace("+", " ")
            
            # Process the document
            result = process_document(bucket, key)
            
            return {
                "statusCode": 200,
                "body": json.dumps(result)
            }
        # Check if this is an API request for upload URL
        elif event.get("httpMethod") == "POST" and event.get("path") == "/upload-url":
            body = json.loads(event["body"])
            file_name = body["fileName"]
            content_type = body["contentType"]
            
            # Generate a unique key
            key = f"documents/{int(datetime.now().timestamp())}-{file_name}"
            
            # Generate pre-signed URL
            upload_url = generate_upload_url(key, content_type)
            
            return {
                "statusCode": 200,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*"
                },
                "body": json.dumps({
                    "uploadUrl": upload_url,
                    "key": key
                })
            }
        # Handle other API requests
        else:
            return {
                "statusCode": 400,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*"
                },
                "body": json.dumps({
                    "error": "Invalid request"
                })
            }
    except Exception as e:
        logger.error(f"Error: {e}", exc_info=True)
        
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            "body": json.dumps({
                "error": "An error occurred while processing your request",
                "details": str(e)
            })
        }


# Register signal handlers for graceful shutdown
def handle_sigterm(*args):
    """Handle SIGTERM signal."""
    logger.info("SIGTERM received in document processor, performing graceful shutdown...")
    cleanup_connections()
    import sys
    sys.exit(0)


def handle_sigint(*args):
    """Handle SIGINT signal."""
    logger.info("SIGINT received in document processor, performing graceful shutdown...")
    cleanup_connections()
    import sys
    sys.exit(0)


import signal
signal.signal(signal.SIGTERM, handle_sigterm)
signal.signal(signal.SIGINT, handle_sigint)
