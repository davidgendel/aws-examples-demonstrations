"""
Tests for token utilities.
"""
import unittest

from src.backend.token_utils import estimate_tokens, optimize_prompt


class TestTokenUtils(unittest.TestCase):
    """Test token utilities."""

    def test_estimate_tokens(self):
        """Test token estimation."""
        # Test empty string
        self.assertEqual(estimate_tokens(""), 0)
        
        # Test short string
        self.assertEqual(estimate_tokens("Hello, world!"), 3)
        
        # Test longer string
        text = "This is a longer text that should have more tokens. " * 10
        self.assertTrue(estimate_tokens(text) > 20)

    def test_optimize_prompt(self):
        """Test prompt optimization."""
        # Test short prompt (no optimization needed)
        short_prompt = "This is a short prompt."
        self.assertEqual(optimize_prompt(short_prompt), short_prompt)
        
        # Test prompt with user question
        prompt_with_question = "Some context.\n\nUser question: What is the answer?"
        self.assertEqual(optimize_prompt(prompt_with_question), prompt_with_question)
        
        # Test long prompt with context
        long_prompt = "Here is some relevant information that might help answer the question:\n\n"
        long_prompt += "Document 1:\nThis is document 1 content.\n\n"
        long_prompt += "Document 2:\nThis is document 2 content.\n\n"
        long_prompt += "Document 3:\nThis is document 3 content.\n\n"
        long_prompt += "User question: What is the answer?"
        
        # Set a very small max_tokens to force optimization
        optimized = optimize_prompt(long_prompt, max_tokens=10)
        
        # Verify user question is preserved
        self.assertIn("User question: What is the answer?", optimized)
        
        # Verify some context is preserved
        self.assertIn("Here is some relevant information", optimized)


if __name__ == "__main__":
    unittest.main()
