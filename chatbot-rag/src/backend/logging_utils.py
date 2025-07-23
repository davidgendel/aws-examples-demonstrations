"""
Logging utilities for the chatbot backend.
"""
import json
import logging
import os
import time
from datetime import datetime
from typing import Any, Dict

import boto3
import structlog

from .aws_utils import get_aws_region

# Initialize logger
logger = logging.getLogger(__name__)


class CloudWatchLogger:
    """CloudWatch logging handler with stream caching."""
    
    def __init__(self):
        """Initialize CloudWatch logger."""
        try:
            self.region = get_aws_region()
            self.client = boto3.client("logs", region_name=self.region)
            self.log_stream_cache = set()
        except Exception as e:
            logger.error(f"Failed to initialize CloudWatch logger: {e}")
            # Fall back to basic logging
            self.client = None
            self.log_stream_cache = set()
    
    async def ensure_log_stream(self, log_group_name: str, log_stream_name: str) -> None:
        """
        Ensure log stream exists.
        
        Args:
            log_group_name: CloudWatch log group name
            log_stream_name: CloudWatch log stream name
        """
        stream_key = f"{log_group_name}:{log_stream_name}"
        
        # Check cache first
        if stream_key in self.log_stream_cache:
            return
        
        try:
            self.client.create_log_stream(
                logGroupName=log_group_name,
                logStreamName=log_stream_name
            )
            self.log_stream_cache.add(stream_key)
        except self.client.exceptions.ResourceAlreadyExistsException:
            self.log_stream_cache.add(stream_key)
        except Exception as e:
            logger.error(f"Error creating log stream: {e}")
            raise
    
    async def log_to_cloudwatch(
        self, log_group_name: str, log_stream_name: str, message: Any
    ) -> None:
        """
        Log message to CloudWatch.
        
        Args:
            log_group_name: CloudWatch log group name
            log_stream_name: CloudWatch log stream name
            message: Message to log
        """
        try:
            await self.ensure_log_stream(log_group_name, log_stream_name)
            
            self.client.put_log_events(
                logGroupName=log_group_name,
                logStreamName=log_stream_name,
                logEvents=[
                    {
                        "timestamp": int(time.time() * 1000),
                        "message": (
                            message if isinstance(message, str) else json.dumps(message)
                        )
                    }
                ]
            )
        except Exception as e:
            logger.error(f"Error writing to CloudWatch logs: {e}")


# Initialize CloudWatch logger
cloudwatch_logger = CloudWatchLogger()


def setup_logging() -> None:
    """Set up structured logging."""
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
    )


class Logger:
    """Structured logger with tiered log groups."""
    
    def __init__(self):
        """Initialize logger."""
        self.logger = structlog.get_logger()
    
    async def info(self, message: str, context: Dict[str, Any] = None) -> None:
        """
        Log info message.
        
        Args:
            message: Log message
            context: Additional context
        """
        log_entry = {
            "level": "info",
            "timestamp": datetime.utcnow().isoformat(),
            "message": message,
            **(context or {})
        }
        
        print(json.dumps(log_entry))
        
        # Also log to standard log group
        if os.environ.get("STANDARD_LOG_GROUP"):
            log_stream_name = f"{os.environ.get('AWS_LAMBDA_FUNCTION_NAME', 'chatbot')}-{datetime.utcnow().date().isoformat()}"
            await cloudwatch_logger.log_to_cloudwatch(
                os.environ["STANDARD_LOG_GROUP"], log_stream_name, log_entry
            )
    
    async def error(
        self, message: str, error: Exception, context: Dict[str, Any] = None
    ) -> None:
        """
        Log error message.
        
        Args:
            message: Log message
            error: Exception
            context: Additional context
        """
        log_entry = {
            "level": "error",
            "timestamp": datetime.utcnow().isoformat(),
            "message": message,
            "errorName": error.__class__.__name__,
            "errorMessage": str(error),
            "stackTrace": getattr(error, "__traceback__", None),
            **(context or {})
        }
        
        print(json.dumps(log_entry), file=os.sys.stderr)
        
        # Also log to critical log group
        if os.environ.get("CRITICAL_LOG_GROUP"):
            log_stream_name = f"{os.environ.get('AWS_LAMBDA_FUNCTION_NAME', 'chatbot')}-{datetime.utcnow().date().isoformat()}"
            await cloudwatch_logger.log_to_cloudwatch(
                os.environ["CRITICAL_LOG_GROUP"], log_stream_name, log_entry
            )
    
    async def warn(self, message: str, context: Dict[str, Any] = None) -> None:
        """
        Log warning message.
        
        Args:
            message: Log message
            context: Additional context
        """
        log_entry = {
            "level": "warn",
            "timestamp": datetime.utcnow().isoformat(),
            "message": message,
            **(context or {})
        }
        
        print(json.dumps(log_entry), file=os.sys.stderr)
        
        # Also log to standard log group
        if os.environ.get("STANDARD_LOG_GROUP"):
            log_stream_name = f"{os.environ.get('AWS_LAMBDA_FUNCTION_NAME', 'chatbot')}-{datetime.utcnow().date().isoformat()}"
            await cloudwatch_logger.log_to_cloudwatch(
                os.environ["STANDARD_LOG_GROUP"], log_stream_name, log_entry
            )
    
    async def debug(self, message: str, context: Dict[str, Any] = None) -> None:
        """
        Log debug message.
        
        Args:
            message: Log message
            context: Additional context
        """
        if not os.environ.get("DEBUG"):
            return
        
        log_entry = {
            "level": "debug",
            "timestamp": datetime.utcnow().isoformat(),
            "message": message,
            **(context or {})
        }
        
        print(json.dumps(log_entry))
        
        # Also log to debug log group
        if os.environ.get("DEBUG_LOG_GROUP"):
            log_stream_name = f"{os.environ.get('AWS_LAMBDA_FUNCTION_NAME', 'chatbot')}-{datetime.utcnow().date().isoformat()}"
            await cloudwatch_logger.log_to_cloudwatch(
                os.environ["DEBUG_LOG_GROUP"], log_stream_name, log_entry
            )


# Initialize logger
logger_instance = Logger()
