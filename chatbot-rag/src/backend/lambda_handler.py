"""
Main Lambda handler for the chatbot backend.
"""
import json
import logging
import os
import signal
import sys
import time
from datetime import datetime
from typing import Any, Dict

import boto3
from cachetools import TTLCache
from cachetools.locks import RLock

from .aws_utils import get_aws_region
from .bedrock_utils import apply_guardrails, generate_embeddings, generate_response
from .db_utils import cleanup_connections, cleanup_database, query_vector_database, query_vector_database_async
from .validation import ValidationError, validate_input, validate_websocket_input

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

# Initialize thread-safe in-memory cache
cache = TTLCache(maxsize=1000, ttl=3600)  # 1 hour TTL
cache_lock = RLock()  # Reentrant lock for thread safety


class DatabaseError(Exception):
    """Exception raised for database errors."""
    
    def __init__(self, message: str, original_error: Exception):
        self.message = message
        self.original_error = original_error
        super().__init__(self.message)


class BedrockError(Exception):
    """Exception raised for Bedrock errors."""
    
    def __init__(self, message: str, original_error: Exception):
        self.message = message
        self.original_error = original_error
        super().__init__(self.message)


def with_retry(func, max_retries: int = 3):
    """
    Retry function with exponential backoff.
    
    Args:
        func: Function to retry
        max_retries: Maximum number of retries
        
    Returns:
        Function result
    """
    import random
    import time
    
    retries = 0
    while True:
        try:
            return func()
        except Exception as error:
            retries += 1
            if retries > max_retries or not is_retryable_error(error):
                raise error
            
            # Calculate exponential backoff with jitter
            delay = min(100 * (2 ** retries) + random.random() * 100, 2000) / 1000.0
            logger.warning(
                f"Retrying after {delay}s (attempt {retries}/{max_retries}): "
                f"{error.__class__.__name__}: {str(error)}"
            )
            time.sleep(delay)


def is_retryable_error(error: Exception) -> bool:
    """
    Check if error is retryable.
    
    Args:
        error: Exception to check
        
    Returns:
        True if error is retryable, False otherwise
    """
    error_name = error.__class__.__name__
    error_message = str(error).lower()
    
    # Retry on throttling, timeout, or connection errors
    return (
        error_name in (
            "ThrottlingException",
            "ServiceUnavailableException",
            "InternalServerException",
            "TooManyRequestsException",
            "ClientError"  # boto3 specific error
        )
        or "throttling" in error_message
        or "throttled" in error_message
        or "timeout" in error_message
        or "connection" in error_message
        or "limit exceeded" in error_message
        or "too many requests" in error_message
    )


def create_error_response(
    status_code: int,
    error_type: str,
    message: str,
    details: Any = None,
    request_id: str = None
) -> Dict[str, Any]:
    """
    Create standardized error response.
    
    Args:
        status_code: HTTP status code
        error_type: Error type
        message: Error message
        details: Additional error details
        request_id: Request ID
        
    Returns:
        Error response dictionary
    """
    error_response = {
        "success": False,
        "error": {
            "type": error_type,
            "message": message,
            "code": status_code,
            "timestamp": datetime.utcnow().isoformat()
        }
    }
    
    # Add details if provided
    if details:
        error_response["error"]["details"] = details
    
    # Add request ID if provided
    if request_id:
        error_response["error"]["requestId"] = request_id
    
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        "body": json.dumps(error_response)
    }


def create_success_response(data: Any, status_code: int = 200) -> Dict[str, Any]:
    """
    Create standardized success response.
    
    Args:
        data: Response data
        status_code: HTTP status code
        
    Returns:
        Success response dictionary
    """
    success_response = {
        "success": True,
        "data": data,
        "timestamp": datetime.utcnow().isoformat()
    }
    
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        "body": json.dumps(success_response)
    }


def handle_chat_request(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle chat requests.
    
    Args:
        body: Request body
        
    Returns:
        Chat response
    """
    try:
        # Validate input
        try:
            message = validate_input(body.get("message", ""))
        except ValidationError as e:
            logger.warning(f"Input validation failed: {str(e)}")
            return create_error_response(
                400, "VALIDATION_ERROR", "Invalid input provided", str(e)
            )
        
        streaming = body.get("streaming", False)
        
        # Check cache for this request
        cache_key = f"chat:{message}:{os.environ.get('BEDROCK_MODEL_ID', 'amazon.nova-lite-v1')}"
        
        # Thread-safe cache access
        with cache_lock:
            cached_response = cache.get(cache_key)
            if cached_response:
                return create_success_response({
                    "response": cached_response,
                    "cached": True,
                    "model": os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-lite-v1")
                })
        
        # Apply guardrails to user input
        guardrail_result = apply_guardrails(message)
        
        if guardrail_result["blocked"]:
            return create_error_response(
                400,
                "CONTENT_BLOCKED",
                "Content blocked by safety guardrails",
                guardrail_result["reasons"]
            )
        
        # Generate embeddings for the query
        embedding = generate_embeddings(message)
        
        # Retrieve relevant documents
        relevant_docs = query_vector_database(embedding)
        
        # Construct prompt with retrieved documents
        context = ""
        if relevant_docs:
            context = "Here is some relevant information that might help answer the question:\n\n"
            
            for i, doc in enumerate(relevant_docs):
                # Check if we have enhanced metadata
                if doc.get("document_title") and doc.get("heading"):
                    context += f'Document {i + 1}: "{doc["document_title"]}"\n'
                    if doc["heading"]:
                        context += f'Section: {doc["heading"]}\n'
                    context += f'Content: {doc["content"]}\n\n'
                    
                    # Add relevant metadata if available
                    if doc.get("metadata"):
                        try:
                            metadata = (
                                json.loads(doc["metadata"])
                                if isinstance(doc["metadata"], str)
                                else doc["metadata"]
                            )
                            
                            # Add source information if available
                            if metadata.get("source"):
                                context += f'Source: {metadata["source"]}\n'
                            
                            # Add author information if available
                            if metadata.get("author"):
                                context += f'Author: {metadata["author"]}\n'
                            
                            # Add date information if available
                            if metadata.get("date"):
                                context += f'Date: {metadata["date"]}\n'
                            
                            # Add table information if this chunk references a table
                            if "[TABLE" in doc["content"] and metadata.get("tables") and metadata["tables"]:
                                import re
                                table_match = re.search(r"\[TABLE (\d+)\]", doc["content"])
                                if table_match:
                                    table_index = int(table_match.group(1)) - 1
                                    if 0 <= table_index < len(metadata["tables"]):
                                        context += "Table content:\n"
                                        table = metadata["tables"][table_index]
                                        for row in table["rows"]:
                                            context += " | ".join(row) + "\n"
                                        context += "\n"
                        except Exception as e:
                            logger.error(f"Error parsing document metadata: {e}")
                else:
                    # Fallback for old schema
                    context += f'Document {i + 1}:\n{doc["content"]}\n\n'
        
        prompt = f"""{context}
User question: {message}

Please provide a helpful, accurate, and concise response based on the information provided. If the information doesn't contain the answer, just say you don't have enough information to answer accurately."""
        
        # Generate response
        model_id = os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-lite-v1")
        
        # If streaming is requested and this is not a WebSocket connection, use non-streaming response
        if not streaming:
            response = generate_response(prompt, model_id)
            
            # Thread-safe cache update
            with cache_lock:
                cache[cache_key] = response
            
            # Return response
            return create_success_response({
                "response": response,
                "cached": False,
                "model": os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-lite-v1")
            })
        else:
            # For streaming, we'll use WebSocket API
            return {
                "statusCode": 200,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*"
                },
                "body": json.dumps({
                    "message": "Streaming is not supported in this endpoint. Please use the WebSocket API for streaming.",
                    "streamingUrl": os.environ.get("WEBSOCKET_API_URL")
                })
            }
    except Exception as e:
        logger.error(f"Error processing chat request: {e}", exc_info=True)
        
        return create_error_response(
            500,
            "INTERNAL_SERVER_ERROR",
            "An error occurred while processing your request",
            str(e)
        )


def handle_cleanup_request(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle cleanup requests.
    
    Args:
        event: Lambda event
        
    Returns:
        Cleanup response
    """
    try:
        # Verify this is an internal request (e.g., from EventBridge)
        if (
            event.get("source") == "aws.events"
            or event.get("headers", {}).get("x-cleanup-token") == os.environ.get("CLEANUP_TOKEN")
        ):
            logger.info("Starting scheduled database cleanup...")
            cleanup_result = cleanup_database()
            
            return create_success_response({
                "message": "Database cleanup completed",
                "results": cleanup_result
            })
        else:
            return create_error_response(
                403,
                "FORBIDDEN",
                "Unauthorized cleanup request"
            )
    except Exception as e:
        logger.error(f"Error during cleanup request: {e}")
        return create_error_response(
            500,
            "CLEANUP_ERROR",
            "Failed to complete database cleanup"
        )


def send_to_connection(api_client, connection_id: str, data: Dict[str, Any], raise_error: bool = False) -> bool:
    """
    Send message to WebSocket connection.
    
    Args:
        api_client: API Gateway Management API client
        connection_id: WebSocket connection ID
        data: Message data
        raise_error: Whether to raise exceptions (default: False)
        
    Returns:
        True if message was sent successfully, False otherwise
    """
    import time
    
    try:
        api_client.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(data).encode("utf-8")
        )
        return True
    except api_client.exceptions.GoneException:
        logger.info(f"Connection {connection_id} is stale")
        return False
    except api_client.exceptions.LimitExceededException:
        # Handle rate limiting by adding a small delay and retrying
        logger.info(f"Rate limit exceeded for connection {connection_id}, retrying after delay")
        time.sleep(0.2)
        return send_to_connection(api_client, connection_id, data, raise_error)
    except Exception as e:
        logger.error(f"Error sending message to connection {connection_id}: {e}")
        if raise_error:
            raise
        return False


def stream_response_to_connection(
    api_client, connection_id: str, prompt: str, model_id: str
) -> None:
    """
    Stream response to WebSocket connection.
    
    Args:
        api_client: API Gateway Management API client
        connection_id: WebSocket connection ID
        prompt: Input prompt
        model_id: Bedrock model ID
    """
    bedrock_client = boto3.client("bedrock-runtime", region_name=get_aws_region())
    
    try:
        # Send initial message with connection ID
        if not send_to_connection(
            api_client,
            connection_id,
            {
                "type": "start",
                "connectionId": connection_id,
                "message": "Response streaming started"
            }
        ):
            logger.warning(f"Failed to send initial message to connection {connection_id}")
            return
        
        # Format request based on model
        if model_id == "amazon.nova-lite-v1":
            body = json.dumps({
                "inputText": prompt,
                "textGenerationConfig": {
                    "maxTokenCount": 1000,
                    "temperature": 0.7,
                    "topP": 0.9,
                    "stopSequences": []
                }
            }).encode('utf-8')
        else:
            body = json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1000,
                "messages": [
                    {"role": "user", "content": prompt}
                ]
            }).encode('utf-8')
        
        # Create streaming request with prompt caching enabled
        try:
            response = bedrock_client.invoke_model_with_response_stream(
                modelId=model_id,
                contentType="application/json",
                accept="application/json",
                body=body,
                cacheConfig={"ttlSeconds": 259200}  # 3 days (72 hours)
            )
        except Exception as bedrock_error:
            logger.error(f"Error invoking Bedrock model: {bedrock_error}")
            send_to_connection(
                api_client,
                connection_id,
                {
                    "type": "error",
                    "error": "Failed to generate response",
                    "details": str(bedrock_error)
                }
            )
            return
        
        # Process the streaming response
        accumulated_text = ""
        last_sent_time = time.time()
        chunk_interval = 0.3  # 300ms between chunks to avoid overwhelming the connection
        
        try:
            for event in response["body"]:
                try:
                    if "chunk" in event and "bytes" in event["chunk"]:
                        chunk_data = json.loads(event["chunk"]["bytes"].decode("utf-8"))
                        
                        # Extract text based on model
                        chunk_text = ""
                        if model_id == "amazon.nova-lite-v1":
                            if "outputText" in chunk_data:
                                chunk_text = chunk_data["outputText"]
                        else:
                            if "completion" in chunk_data:
                                chunk_text = chunk_data["completion"]
                        
                        if chunk_text:
                            accumulated_text += chunk_text
                            
                            # Rate limit sending chunks to avoid overwhelming the connection
                            current_time = time.time()
                            if current_time - last_sent_time >= chunk_interval:
                                # Send chunk to client with error handling
                                send_to_connection(
                                    api_client,
                                    connection_id,
                                    {
                                        "type": "chunk",
                                        "text": chunk_text,
                                        "complete": False
                                    }
                                )
                                last_sent_time = current_time
                except Exception as chunk_error:
                    logger.error(f"Error processing chunk: {chunk_error}")
                    # Continue processing other chunks
        except Exception as stream_error:
            logger.error(f"Error processing stream: {stream_error}")
            send_to_connection(
                api_client,
                connection_id,
                {
                    "type": "error",
                    "error": "Error processing response stream",
                    "details": str(stream_error)
                }
            )
            return
        
        # Send final message with complete response
        send_to_connection(
            api_client,
            connection_id,
            {
                "type": "end",
                "connectionId": connection_id,
                "text": accumulated_text,
                "complete": True
            }
        )
    
    except Exception as e:
        logger.error(f"Error streaming response: {e}", exc_info=True)
        
        # Send error message to client
        send_to_connection(
            api_client,
            connection_id,
            {
                "type": "error",
                "connectionId": connection_id,
                "error": "An error occurred while streaming the response",
                "details": str(e)
            }
        )


def handle_websocket_event(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle WebSocket events.
    
    Args:
        event: WebSocket event
        
    Returns:
        WebSocket response
    """
    connection_id = event["requestContext"]["connectionId"]
    route_key = event["requestContext"]["routeKey"]
    
    # Initialize API Gateway Management API client
    api_client = _initialize_websocket_api_client(event)
    
    # Handle different WebSocket route keys
    if route_key == "$connect":
        return {"statusCode": 200}
    elif route_key == "$disconnect":
        return {"statusCode": 200}
    elif route_key == "sendMessage":
        return _handle_websocket_message(event, connection_id, api_client)
    elif route_key == "heartbeat":
        return _handle_websocket_heartbeat(connection_id, api_client)
    else:
        logger.warning(f"Unknown route key: {route_key}")
        return {"statusCode": 400}


def _initialize_websocket_api_client(event: Dict[str, Any]):
    """Initialize API Gateway Management API client."""
    domain = event["requestContext"]["domainName"]
    stage = event["requestContext"]["stage"]
    region = os.environ.get("AWS_REGION", "us-east-1")
    
    return boto3.client(
        "apigatewaymanagementapi",
        endpoint_url=f"https://{domain}/{stage}",
        region_name=region
    )


def _handle_websocket_message(event: Dict[str, Any], connection_id: str, api_client) -> Dict[str, Any]:
    """Handle WebSocket message processing."""
    try:
        # Parse and validate input
        body = json.loads(event.get("body", "{}"))
        message = body.get("message", "").strip()
        
        if not message:
            _send_websocket_error(api_client, connection_id, "Message cannot be empty")
            return {"statusCode": 400}
        
        # Validate WebSocket input
        is_valid, validation_error = validate_websocket_input(message)
        if not is_valid:
            _send_websocket_error(api_client, connection_id, validation_error)
            return {"statusCode": 400}
        
        # Apply guardrails
        guardrail_result = apply_guardrails(message)
        if guardrail_result["blocked"]:
            _send_websocket_error(api_client, connection_id, "Your message was blocked by content filters.")
            return {"statusCode": 400}
        
        # Process the message and stream response
        _process_websocket_message_and_stream(message, connection_id, api_client)
        
        return {"statusCode": 200}
        
    except Exception as e:
        logger.error(f"Error handling WebSocket message: {e}")
        _send_websocket_error(api_client, connection_id, "An error occurred processing your message")
        return {"statusCode": 500}


def _handle_websocket_heartbeat(connection_id: str, api_client) -> Dict[str, Any]:
    """Handle WebSocket heartbeat."""
    try:
        api_client.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps({
                "type": "heartbeat",
                "timestamp": datetime.utcnow().isoformat()
            })
        )
        return {"statusCode": 200}
    except Exception as e:
        logger.error(f"Error sending heartbeat: {e}")
        return {"statusCode": 500}


def _send_websocket_error(api_client, connection_id: str, error_message: str) -> None:
    """Send error message via WebSocket."""
    try:
        api_client.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps({
                "type": "error",
                "message": error_message
            })
        )
    except Exception as e:
        logger.error(f"Error sending WebSocket error: {e}")


def _process_websocket_message_and_stream(message: str, connection_id: str, api_client) -> None:
    """Process WebSocket message and stream the response."""
    try:
        # Generate embeddings and query vector database
        embeddings = generate_embeddings(message)
        relevant_docs = query_vector_database(embeddings, limit=5)
        
        # Construct prompt
        prompt = message
        if relevant_docs:
            context = "\n\n".join([doc["content"] for doc in relevant_docs])
            prompt = f"Context: {context}\n\nQuestion: {message}"
        
        # Stream response using Bedrock streaming API
        stream_response_to_connection(prompt, connection_id, api_client)
        
    except Exception as e:
        logger.error(f"Error processing WebSocket message: {e}")
        _send_websocket_error(api_client, connection_id, "An error occurred processing your message")
            try:
                embedding = generate_embeddings(message)
                relevant_docs = query_vector_database(embedding)
            except Exception as db_error:
                logger.error(f"Error querying vector database: {db_error}")
                send_to_connection(
                    api_client,
                    connection_id,
                    {
                        "type": "error",
                        "error": "Error retrieving relevant information",
                        "details": str(db_error)
                    }
                )
                return {"statusCode": 200}
            
            # Construct prompt
            context = ""
            if relevant_docs:
                context = "Here is some relevant information that might help answer the question:\n\n"
                for i, doc in enumerate(relevant_docs):
                    context += f'Document {i + 1}:\n{doc["content"]}\n\n'
            
            prompt = f"""{context}
User question: {message}

Please provide a helpful, accurate, and concise response based on the information provided. If the information doesn't contain the answer, just say you don't have enough information to answer accurately."""
            
            # Stream response using Bedrock streaming API
            stream_response_to_connection(
                api_client,
                connection_id,
                prompt,
                os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-lite-v1")
            )
            
            return {"statusCode": 200}
        
        except Exception as e:
            logger.error(f"Error processing WebSocket message: {e}", exc_info=True)
            
            send_to_connection(
                api_client,
                connection_id,
                {
                    "type": "error",
                    "error": "An error occurred while processing your request",
                    "details": str(e)
                }
            )
            
            return {"statusCode": 500}
    
    elif route_key == "heartbeat":
        # Respond to heartbeat
        try:
            # Parse and validate input
            body = {}
            if event.get("body"):
                try:
                    body = json.loads(event["body"])
                except json.JSONDecodeError:
                    send_to_connection(
                        api_client,
                        connection_id,
                        {
                            "type": "error",
                            "error": "Invalid JSON format",
                            "details": "Request body must be valid JSON"
                        }
                    )
                    return {"statusCode": 200}
                
                # Validate WebSocket input
                is_valid, errors = validate_websocket_input(body, "heartbeat")
                if not is_valid:
                    send_to_connection(
                        api_client,
                        connection_id,
                        {
                            "type": "error",
                            "error": "Invalid input",
                            "details": errors
                        }
                    )
                    return {"statusCode": 200}
            
            send_to_connection(
                api_client,
                connection_id,
                {
                    "type": "heartbeat",
                    "timestamp": int(datetime.now().timestamp() * 1000)
                }
            )
            return {"statusCode": 200}
        
        except Exception as e:
            logger.error(f"Error sending heartbeat response: {e}")
            return {"statusCode": 500}
    
    else:
        # Unknown route - send error via WebSocket
        send_to_connection(
            api_client,
            connection_id,
            {
                "type": "error",
                "error": "Unknown route",
                "details": f"Route '{route_key}' is not supported"
            }
        )
        
        return {"statusCode": 400}


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    AWS Lambda handler function.
    
    Args:
        event: Lambda event
        context: Lambda context
        
    Returns:
        Lambda response
    """
    # Check if this is a WebSocket connection
    if event.get("requestContext", {}).get("connectionId"):
        return handle_websocket_event(event)
    
    # Check if this is a cleanup request
    if event.get("httpMethod") == "POST" and event.get("path") == "/cleanup":
        return handle_cleanup_request(event)
    
    # Parse request body for chat requests
    try:
        body = json.loads(event["body"])
    except (json.JSONDecodeError, KeyError):
        return create_error_response(
            400,
            "INVALID_REQUEST",
            "Invalid request body"
        )
    
    return handle_chat_request(body)


# Register signal handlers for graceful shutdown
def handle_sigterm(*args):
    """Handle SIGTERM signal."""
    logger.info("SIGTERM received, performing graceful shutdown...")
    cleanup_connections()
    sys.exit(0)


def handle_sigint(*args):
    """Handle SIGINT signal."""
    logger.info("SIGINT received, performing graceful shutdown...")
    cleanup_connections()
    sys.exit(0)


signal.signal(signal.SIGTERM, handle_sigterm)
signal.signal(signal.SIGINT, handle_sigint)
