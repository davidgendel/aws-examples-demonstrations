"""
Utilities for interacting with Amazon Bedrock.
"""
import json
import logging
import os
from typing import Any, Dict, List

from .aws_utils import get_bedrock_client
from .token_utils import optimize_prompt

# Initialize logger
logger = logging.getLogger(__name__)


def generate_embeddings(text: str) -> List[float]:
    """
    Generate embeddings using Bedrock.
    
    Args:
        text: Input text
        
    Returns:
        Vector embedding
    """
    bedrock_client = get_bedrock_client()
    
    try:
        response = bedrock_client.invoke_model(
            modelId="amazon.titan-embed-text-v1",
            contentType="application/json",
            accept="application/json",
            body=json.dumps({"inputText": text}).encode('utf-8'),
            cacheConfig={"ttlSeconds": 259200}  # 3 days (72 hours)
        )
        
        # Check if response was from cache (for logging purposes)
        cache_hit = response.get("ResponseMetadata", {}).get("HTTPHeaders", {}).get("x-amzn-bedrock-cache-hit") == "true"
        
        if cache_hit:
            logger.info("Embeddings served from Bedrock cache")
        else:
            logger.info("Embeddings generated (not from cache)")
        
        embedding = json.loads(response["body"].read())["embedding"]
        return embedding
    except Exception as e:
        logger.error(f"Error generating embeddings: {e}")
        raise


def apply_guardrails(text: str) -> Dict[str, Any]:
    """
    Apply guardrails to user input.
    
    Args:
        text: Input text
        
    Returns:
        Dictionary with guardrail results
    """
    guardrail_id = os.environ.get("BEDROCK_GUARDRAIL_ID")
    
    if not guardrail_id:
        return {"text": text, "blocked": False}
    
    try:
        bedrock_client = get_bedrock_client()
        
        response = bedrock_client.apply_guardrail(
            guardrailIdentifier=guardrail_id,
            contentType="application/json",
            accept="application/json",
            body=json.dumps({"inputText": text}).encode('utf-8')
        )
        
        result = json.loads(response["body"].read())
        
        return {
            "text": result["output"]["text"],
            "blocked": (
                result["output"]["assessment"]["topicPolicy"]["blocked"] or
                result["output"]["assessment"]["contentPolicy"]["blocked"] or
                result["output"]["assessment"]["wordPolicy"]["blocked"]
            ),
            "reasons": result["output"]["assessment"]
        }
    except Exception as e:
        logger.error(f"Error applying guardrails: {e}")
        return {"text": text, "blocked": False}


def generate_response(prompt: str, model_id: str) -> str:
    """
    Generate response using Bedrock with Amazon Nova Lite.
    
    Args:
        prompt: Input prompt
        model_id: Bedrock model ID
        
    Returns:
        Generated response text
    """
    bedrock_client = get_bedrock_client()
    
    # Optimize prompt to reduce token usage
    optimized_prompt = optimize_prompt(prompt, 4000)  # 4000 token limit
    
    # Log token optimization results
    if optimized_prompt != prompt:
        logger.info(
            "Prompt optimized to reduce token usage",
            extra={
                "originalLength": len(prompt),
                "optimizedLength": len(optimized_prompt),
                "reductionPercent": round((1 - len(optimized_prompt) / len(prompt)) * 100)
            }
        )
    
    # Format the request based on the model
    if model_id == "amazon.nova-lite-v1":
        # Amazon Nova Lite format
        body = json.dumps({
            "inputText": optimized_prompt,
            "textGenerationConfig": {
                "maxTokenCount": 1000,
                "temperature": 0.7,
                "topP": 0.9,
                "stopSequences": []
            }
        }).encode('utf-8')
    else:
        # Default format for other models (Claude, etc.)
        body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 1000,
            "messages": [
                {"role": "user", "content": optimized_prompt}
            ]
        }).encode('utf-8')
    
    try:
        # Create the request
        response = bedrock_client.invoke_model(
            modelId=model_id,
            contentType="application/json",
            accept="application/json",
            body=body,
            cacheConfig={"ttlSeconds": 259200}  # 3 days (72 hours)
        )
        
        # Check if response was from cache (for logging purposes)
        cache_hit = response.get("ResponseMetadata", {}).get("HTTPHeaders", {}).get("x-amzn-bedrock-cache-hit") == "true"
        
        if cache_hit:
            logger.info("Response served from Bedrock cache")
        else:
            logger.info("Response generated (not from cache)")
        
        # Extract response text based on model
        result = json.loads(response["body"].read())
        
        if model_id == "amazon.nova-lite-v1":
            return result["results"][0]["outputText"]
        else:
            return result["content"][0]["text"]
    except Exception as e:
        logger.error(f"Error generating response: {e}")
        raise


def stream_response(websocket, prompt: str, model_id: str) -> None:
    """
    Stream response using Bedrock streaming API.
    
    Args:
        websocket: WebSocket connection
        prompt: Input prompt
        model_id: Bedrock model ID
    """
    import asyncio
    
    bedrock_client = get_bedrock_client()
    
    async def send_message(message):
        await websocket.send_json(message)
    
    async def process_stream():
        try:
            # Send initial message
            await send_message({
                "type": "start",
                "message": "Response streaming started"
            })
            
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
            response = bedrock_client.invoke_model_with_response_stream(
                modelId=model_id,
                contentType="application/json",
                accept="application/json",
                body=body,
                cacheConfig={"ttlSeconds": 259200}  # 3 days (72 hours)
            )
            
            # Check if response was from cache (for logging purposes)
            cache_hit = response.get("ResponseMetadata", {}).get("HTTPHeaders", {}).get("x-amzn-bedrock-cache-hit") == "true"
            
            if cache_hit:
                logger.info("Streaming response served from Bedrock cache")
            else:
                logger.info("Streaming response generated (not from cache)")
            
            # Process the streaming response
            accumulated_text = ""
            
            for event in response["body"]:
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
                        
                        # Send chunk to client
                        await send_message({
                            "type": "chunk",
                            "text": chunk_text,
                            "complete": False
                        })
            
            # Send final message with complete response
            await send_message({
                "type": "end",
                "text": accumulated_text,
                "complete": True
            })
            
        except Exception as e:
            logger.error(f"Error streaming response: {e}")
            
            # Send error message to client
            await send_message({
                "type": "error",
                "error": "An error occurred while streaming the response",
                "details": str(e)
            })
            
            raise
    
    # Run the async function
    loop = asyncio.get_event_loop()
    loop.run_until_complete(process_stream())
