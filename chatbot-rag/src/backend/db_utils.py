"""
Database utilities for the chatbot backend.
"""
import json
import logging
import os
from typing import Any, Dict, List, Optional

import asyncio
from psycopg2.extras import RealDictCursor
from psycopg2.pool import SimpleConnectionPool

# For async database operations
import asyncpg

from .constants import (
    DB_BATCH_SIZE, DB_CONNECTION_TIMEOUT, DB_QUERY_TIMEOUT, 
    ROTATION_INTERVAL_DAYS, LOG_RETENTION_DAYS
)

from .aws_utils import get_secrets_manager_client

# Initialize logger
logger = logging.getLogger(__name__)

# Database connection pools
db_pool = None
async_pool = None


def get_db_credentials() -> Dict[str, str]:
    """
    Get database credentials from Secrets Manager.
    
    Returns:
        Dictionary containing database credentials
    """
    secret_arn = os.environ.get("DB_SECRET_ARN")
    if not secret_arn:
        raise ValueError("DB_SECRET_ARN environment variable not set")
    
    secrets_manager = get_secrets_manager_client()
    
    try:
        response = secrets_manager.get_secret_value(SecretId=secret_arn)
        return json.loads(response["SecretString"])
    except Exception as e:
        logger.error(f"Error retrieving database credentials: {e}")
        raise


def get_db_pool() -> SimpleConnectionPool:
    """
    Get a database connection pool.
    
    Returns:
        Database connection pool
    """
    global db_pool
    
    if db_pool and not getattr(db_pool, "closed", True):
        return db_pool
    
    try:
        credentials = get_db_credentials()
        
        db_pool = SimpleConnectionPool(
            minconn=2,
            maxconn=DB_BATCH_SIZE,
            host=credentials["host"],
            port=credentials["port"],
            dbname=credentials["dbname"],
            user=credentials["username"],
            password=credentials["password"],
            sslmode="require",
        )
        
        # Test the connection
        conn = db_pool.getconn()
        db_pool.putconn(conn)
        
        logger.info("Database connection pool established")
        return db_pool
    except Exception as e:
        logger.error(f"Error connecting to database: {e}")
        raise


async def get_async_pool() -> asyncpg.Pool:
    """
    Get an async database connection pool.
    
    Returns:
        Async database connection pool
    """
    global async_pool
    
    if async_pool:
        return async_pool
    
    try:
        credentials = get_db_credentials()
        
        async_pool = await asyncpg.create_pool(
            host=credentials["host"],
            port=credentials["port"],
            database=credentials["dbname"],
            user=credentials["username"],
            password=credentials["password"],
            min_size=2,
            max_size=DB_BATCH_SIZE,
            ssl="require",
            command_timeout=DB_CONNECTION_TIMEOUT,
            max_inactive_connection_lifetime=300.0,  # 5 minutes
        )
        
        # Test the connection
        async with async_pool.acquire() as conn:
            await conn.execute("SELECT 1")
        
        logger.info("Async database connection pool established")
        return async_pool
    except Exception as e:
        logger.error(f"Error connecting to async database: {e}")
        raise


def query_database(query: str, params: List[Any] = None) -> List[Dict[str, Any]]:
    """
    Execute a database query using the connection pool.
    
    Args:
        query: SQL query string
        params: Query parameters
        
    Returns:
        Query results as a list of dictionaries
    """
    pool = get_db_pool()
    conn = pool.getconn()
    
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(query, params or [])
            if cursor.description:
                return cursor.fetchall()
            return []
    finally:
        pool.putconn(conn)


async def query_database_async(query: str, params: List[Any] = None) -> List[Dict[str, Any]]:
    """
    Execute a database query using the async connection pool.
    
    Args:
        query: SQL query string
        params: Query parameters
        
    Returns:
        Query results as a list of dictionaries
    """
    pool = await get_async_pool()
    
    async with pool.acquire() as conn:
        try:
            # Use the safer prepare/execute pattern instead of direct fetch with parameters
            # This ensures proper parameter handling and prevents SQL injection
            stmt = await conn.prepare(query)
            results = await stmt.fetch(*(params or []))
            return [dict(row) for row in results]
        except Exception as e:
            logger.error(f"Error executing async database query: {e}")
            raise


def cleanup_database() -> Dict[str, int]:
    """
    Clean up old chat logs and expired cache entries.
    
    Returns:
        Dictionary with cleanup statistics
    """
    try:
        pool = get_db_pool()
        conn = pool.getconn()
        
        try:
            with conn.cursor() as cursor:
                # Clean up old document chunks (older than {ROTATION_INTERVAL_DAYS} days)
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
            pool.putconn(conn)
    except Exception as e:
        logger.error(f"Error during database cleanup: {e}")
        raise


def cleanup_connections() -> None:
    """
    Clean up database connections.
    """
    global db_pool, async_pool
    
    try:
        if db_pool:
            logger.info("Closing database connection pool...")
            db_pool.closeall()
            db_pool = None
            logger.info("Database connection pool closed")
        
        if async_pool:
            logger.info("Closing async database connection pool...")
            # Create and run a coroutine to properly close the async pool
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # If we're in an async context, create a task
                    future = asyncio.ensure_future(async_pool.close())
                    # Wait for a short time to allow the pool to close
                    loop.run_until_complete(asyncio.wait_for(future, timeout=2.0))
                else:
                    # If we're not in an async context, run the coroutine directly
                    loop.run_until_complete(async_pool.close())
            except Exception as async_error:
                logger.error(f"Error during async pool closure: {async_error}")
            
            async_pool = None
            logger.info("Async database connection pool closed")
    except Exception as e:
        logger.error(f"Error closing database connections: {e}")


def query_vector_database(
    embedding: List[float], limit: int = 3, filters: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """
    Query vector database for relevant documents.
    
    Args:
        embedding: Vector embedding
        limit: Maximum number of results to return
        filters: Optional filters for the query
        
    Returns:
        List of relevant documents
    """
    try:
        # Check if the new schema is available
        table_check_result = query_database(
            """
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'document_chunks'
            );
            """
        )
        
        new_schema_exists = table_check_result[0]["exists"]
        
        if new_schema_exists:
            # Use the new schema with enhanced querying
            query = """
                WITH ranked_chunks AS (
                    SELECT 
                        dc.id,
                        dc.document_id,
                        d.title as document_title,
                        dc.chunk_index,
                        dc.content,
                        dc.heading,
                        dc.chunk_type,
                        dc.importance_score,
                        dc.metadata,
                        1 - (dc.embedding <=> %s) AS similarity
                    FROM 
                        document_chunks dc
                    JOIN 
                        documents d ON dc.document_id = d.id
            """
            
            query_params = [embedding, limit]
            
            # Add filters if provided with parameterized queries
            if filters:
                query += " WHERE "
                conditions = []
                
                if filters.get("documentIds") and len(filters["documentIds"]) > 0:
                    placeholders = ", ".join(["%s" for _ in filters["documentIds"]])
                    conditions.append(f"d.id IN ({placeholders})")
                    query_params.extend(filters["documentIds"])
                
                if filters.get("fileTypes") and len(filters["fileTypes"]) > 0:
                    placeholders = ", ".join(["%s" for _ in filters["fileTypes"]])
                    conditions.append(f"d.file_type IN ({placeholders})")
                    query_params.extend(filters["fileTypes"])
                
                if filters.get("minDate"):
                    conditions.append("d.created_at >= %s")
                    query_params.append(filters["minDate"])
                
                if filters.get("maxDate"):
                    conditions.append("d.created_at <= %s")
                    query_params.append(filters["maxDate"])
                
                query += " AND ".join(conditions)
            
            query += """
                    ORDER BY 
                        (dc.embedding <=> %s) * (1.0 / dc.importance_score) -- Adjust similarity by importance
                    LIMIT %s
                )
                SELECT 
                    id,
                    document_id,
                    document_title,
                    chunk_index,
                    content,
                    heading,
                    chunk_type,
                    importance_score,
                    metadata,
                    similarity
                FROM 
                    ranked_chunks
                ORDER BY 
                    similarity DESC;
            """
            
            result = query_database(query, query_params)
            
            # Transform results to include metadata
            return [
                {
                    "id": row["id"],
                    "document_id": row["document_id"],
                    "document_title": row["document_title"],
                    "content": row["content"],
                    "heading": row["heading"],
                    "chunk_type": row["chunk_type"],
                    "importance_score": row["importance_score"],
                    "metadata": row["metadata"],
                    "similarity": row["similarity"],
                }
                for row in result
            ]
        else:
            # Fall back to the old schema for backward compatibility
            query = """
                SELECT document_id, content, 1 - (embedding <=> %s) AS similarity
                FROM document_embeddings
                ORDER BY embedding <=> %s
                LIMIT %s;
            """
            
            result = query_database(query, [embedding, embedding, limit])
            return result
    except Exception as e:
        logger.error(f"Error querying vector database: {e}")
        
        # Fall back to the old schema if there was an error
        try:
            query = """
                SELECT document_id, content, 1 - (embedding <=> %s) AS similarity
                FROM document_embeddings
                ORDER BY embedding <=> %s
                LIMIT %s;
            """
            
            result = query_database(query, [embedding, embedding, limit])
            return result
        except Exception as fallback_error:
            logger.error(f"Error in fallback query: {fallback_error}")
            raise e  # Throw the original error


async def query_vector_database_async(
    embedding: List[float], limit: int = 3, filters: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """
    Query vector database for relevant documents with caching (async version).
    
    Args:
        embedding: Vector embedding
        limit: Maximum number of results to return
        filters: Optional filters for the query
        
    Returns:
        List of relevant documents
    """
    try:
        # Check if the new schema is available
        table_check_result = await query_database_async(
            """
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'document_chunks'
            );
            """
        )
        
        new_schema_exists = table_check_result[0]["exists"]
        
        if new_schema_exists:
            # Use the new schema with enhanced querying
            query = """
                WITH ranked_chunks AS (
                    SELECT 
                        dc.id,
                        dc.document_id,
                        d.title as document_title,
                        dc.chunk_index,
                        dc.content,
                        dc.heading,
                        dc.chunk_type,
                        dc.importance_score,
                        dc.metadata,
                        1 - (dc.embedding <=> $1) AS similarity
                    FROM 
                        document_chunks dc
                    JOIN 
                        documents d ON dc.document_id = d.id
            """
            
            query_params = [embedding, limit]
            
            # Add filters if provided with parameterized queries
            if filters:
                query += " WHERE "
                conditions = []
                param_index = 3  # Start from $3 since $1 and $2 are already used
                
                if filters.get("documentIds") and len(filters["documentIds"]) > 0:
                    # Use positional parameters ($1, $2, etc.) instead of string formatting
                    placeholders = []
                    for i in range(len(filters["documentIds"])):
                        placeholders.append(f"${param_index}")
                        param_index += 1
                    conditions.append(f"d.id IN ({', '.join(placeholders)})")
                    query_params.extend(filters["documentIds"])
                
                if filters.get("fileTypes") and len(filters["fileTypes"]) > 0:
                    # Use positional parameters ($1, $2, etc.) instead of string formatting
                    placeholders = []
                    for i in range(len(filters["fileTypes"])):
                        placeholders.append(f"${param_index}")
                        param_index += 1
                    conditions.append(f"d.file_type IN ({', '.join(placeholders)})")
                    query_params.extend(filters["fileTypes"])
                
                if filters.get("minDate"):
                    conditions.append(f"d.created_at >= ${param_index}")
                    query_params.append(filters["minDate"])
                    param_index += 1
                
                if filters.get("maxDate"):
                    conditions.append(f"d.created_at <= ${param_index}")
                    query_params.append(filters["maxDate"])
                    param_index += 1
                
                query += " AND ".join(conditions)
            
            query += """
                    ORDER BY 
                        (dc.embedding <=> $1) * (1.0 / dc.importance_score) -- Adjust similarity by importance
                    LIMIT $2
                )
                SELECT 
                    id,
                    document_id,
                    document_title,
                    chunk_index,
                    content,
                    heading,
                    chunk_type,
                    importance_score,
                    metadata,
                    similarity
                FROM 
                    ranked_chunks
                ORDER BY 
                    similarity DESC;
            """
            
            result = await query_database_async(query, query_params)
            
            # Transform results to include metadata
            return [
                {
                    "id": row["id"],
                    "document_id": row["document_id"],
                    "document_title": row["document_title"],
                    "content": row["content"],
                    "heading": row["heading"],
                    "chunk_type": row["chunk_type"],
                    "importance_score": row["importance_score"],
                    "metadata": row["metadata"],
                    "similarity": row["similarity"],
                }
                for row in result
            ]
        else:
            # Fall back to the old schema for backward compatibility
            query = """
                SELECT document_id, content, 1 - (embedding <=> $1) AS similarity
                FROM document_embeddings
                ORDER BY embedding <=> $1
                LIMIT $2;
            """
            
            result = await query_database_async(query, [embedding, limit])
            return result
    except Exception as e:
        logger.error(f"Error querying vector database asynchronously: {e}")
        
        # Fall back to the old schema if there was an error
        try:
            query = """
                SELECT document_id, content, 1 - (embedding <=> $1) AS similarity
                FROM document_embeddings
                ORDER BY embedding <=> $1
                LIMIT $2;
            """
            
            result = await query_database_async(query, [embedding, limit])
            return result
        except Exception as fallback_error:
            logger.error(f"Error in async fallback query: {fallback_error}")
            raise e  # Throw the original error
