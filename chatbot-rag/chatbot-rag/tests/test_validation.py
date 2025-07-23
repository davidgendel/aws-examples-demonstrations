"""
Tests for validation utilities.
"""
import pytest

from src.backend.validation import ValidationError, validate_input, validate_websocket_input


class TestValidateInput:
    """Test cases for validate_input function."""

    def test_valid_input(self):
        """Test validation of valid input."""
        result = validate_input("Hello, world!")
        assert result == "Hello, world!"

    def test_empty_input(self):
        """Test validation of empty input."""
        with pytest.raises(ValidationError, match="Input cannot be empty"):
            validate_input("")

    def test_none_input(self):
        """Test validation of None input."""
        with pytest.raises(ValidationError, match="Input cannot be empty"):
            validate_input(None)

    def test_whitespace_only_input(self):
        """Test validation of whitespace-only input."""
        with pytest.raises(ValidationError, match="Input cannot be empty"):
            validate_input("   ")

    def test_non_string_input(self):
        """Test validation of non-string input."""
        with pytest.raises(ValidationError, match="Input cannot be empty"):
            validate_input(123)

    def test_input_too_long(self):
        """Test validation of input that exceeds maximum length."""
        long_input = "a" * 2001  # Exceeds MAX_MESSAGE_LENGTH (2000)
        with pytest.raises(ValidationError, match="Input exceeds maximum length"):
            validate_input(long_input)

    def test_script_injection(self):
        """Test detection of script injection attempts."""
        malicious_inputs = [
            "<script>alert('xss')</script>",
            "javascript:alert('xss')",
            "onclick=alert('xss')",
            "onerror=alert('xss')"
        ]
        
        for malicious_input in malicious_inputs:
            with pytest.raises(ValidationError, match="potentially unsafe content"):
                validate_input(malicious_input)

    def test_eval_injection(self):
        """Test detection of eval injection attempts."""
        malicious_inputs = [
            "eval(alert('xss'))",
            "setTimeout(alert('xss'), 1000)",
            "setInterval(alert('xss'), 1000)"
        ]
        
        for malicious_input in malicious_inputs:
            with pytest.raises(ValidationError, match="potentially unsafe content"):
                validate_input(malicious_input)

    def test_template_literal_injection(self):
        """Test detection of template literal injection attempts."""
        malicious_inputs = [
            "${alert('xss')}",
            "`${alert('xss')}`"
        ]
        
        for malicious_input in malicious_inputs:
            with pytest.raises(ValidationError, match="potentially unsafe content"):
                validate_input(malicious_input)

    def test_input_trimming(self):
        """Test that input is properly trimmed."""
        result = validate_input("  Hello, world!  ")
        assert result == "Hello, world!"


class TestValidateWebsocketInput:
    """Test cases for validate_websocket_input function."""

    def test_valid_websocket_input(self):
        """Test validation of valid WebSocket input."""
        body = {"message": "Hello, world!"}
        is_valid, errors = validate_websocket_input(body, "sendMessage")
        assert is_valid is True
        assert errors == []

    def test_missing_message(self):
        """Test validation when message is missing."""
        body = {}
        is_valid, errors = validate_websocket_input(body, "sendMessage")
        assert is_valid is False
        assert "Message is required" in errors

    def test_empty_message(self):
        """Test validation when message is empty."""
        body = {"message": ""}
        is_valid, errors = validate_websocket_input(body, "sendMessage")
        assert is_valid is False
        assert "Message cannot be empty" in errors

    def test_message_too_long(self):
        """Test validation when message is too long."""
        body = {"message": "a" * 4001}  # Exceeds MAX_TOKEN_LENGTH (4000)
        is_valid, errors = validate_websocket_input(body, "sendMessage")
        assert is_valid is False
        assert "Message too long" in errors[0]

    def test_non_string_message(self):
        """Test validation when message is not a string."""
        body = {"message": 123}
        is_valid, errors = validate_websocket_input(body, "sendMessage")
        assert is_valid is False
        assert "Message must be a string" in errors

    def test_unknown_action(self):
        """Test validation with unknown action."""
        body = {"message": "Hello"}
        is_valid, errors = validate_websocket_input(body, "unknownAction")
        assert is_valid is False
        assert "Unknown action" in errors

    def test_heartbeat_action(self):
        """Test validation for heartbeat action."""
        body = {}
        is_valid, errors = validate_websocket_input(body, "heartbeat")
        assert is_valid is True
        assert errors == []
