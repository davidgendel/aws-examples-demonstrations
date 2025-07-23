"""
Input validation utilities for the chatbot backend.
"""
import re
from typing import Dict, List

from .constants import MAX_MESSAGE_LENGTH, MAX_TOKEN_LENGTH


class ValidationError(Exception):
    """Exception raised for validation errors."""
    pass


def validate_input(input_text: str) -> str:
    """
    Validate user input.
    
    Args:
        input_text: User input text
        
    Returns:
        Validated input text
        
    Raises:
        ValidationError: If input is invalid
    """
    # Check for empty input
    if not input_text or not isinstance(input_text, str) or not input_text.strip():
        raise ValidationError("Input cannot be empty")
    
    # Check for maximum length
    if len(input_text) > MAX_MESSAGE_LENGTH:
        raise ValidationError(f"Input exceeds maximum length of {MAX_MESSAGE_LENGTH} characters")
    
    # Check for potentially malicious content
    suspicious_patterns = [
        r"(<script|javascript:|onclick=|onerror=)",
        r"(eval\(|setTimeout\(|setInterval\()",
        r"(\$\{|\`\$\{)"  # Template literal injection
    ]
    
    for pattern in suspicious_patterns:
        if re.search(pattern, input_text, re.IGNORECASE):
            raise ValidationError("Input contains potentially unsafe content")
    
    return input_text.strip()


def validate_websocket_input(body: Dict, action: str) -> Tuple[bool, List[str]]:
    """
    Validate WebSocket message input.
    
    Args:
        body: Message body
        action: WebSocket action
        
    Returns:
        Tuple of (is_valid, error_messages)
    """
    errors = []
    
    # Validate action-specific requirements
    if action == "sendMessage":
        # Validate message field
        if "message" not in body:
            errors.append("Message is required")
        elif not isinstance(body["message"], str):
            errors.append("Message must be a string")
        elif not body["message"].strip():
            errors.append("Message cannot be empty")
        elif len(body["message"]) > MAX_TOKEN_LENGTH:
            errors.append(f"Message too long (maximum {MAX_TOKEN_LENGTH} characters)")
        
        # Validate message content
        trimmed_message = body["message"].strip()
        if len(trimmed_message) < 1:
            errors.append("Message must contain at least 1 character")
        
        # Check for potentially malicious content
        suspicious_patterns = [
            r"<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>",
            r"javascript:",
            r"on\w+\s*=",
            r"data:text\/html"
        ]
        
        for pattern in suspicious_patterns:
            if re.search(pattern, trimmed_message, re.IGNORECASE):
                errors.append("Message contains potentially unsafe content")
                break
    
    elif action == "heartbeat":
        # Heartbeat doesn't require additional validation
        pass
    
    else:
        errors.append(f"Unknown action: {action}")
    
    # General validation
    if body is not None and not isinstance(body, dict):
        errors.append("Request body must be a valid JSON object")
    
    return (len(errors) == 0, errors)
