"""
Token utilities for optimizing prompts and managing token usage.
"""
import re


def estimate_tokens(text: str) -> int:
    """
    Estimate the number of tokens in a text string.
    This is a rough approximation based on character count.
    
    Args:
        text: The input text
        
    Returns:
        Estimated token count
    """
    # A very rough approximation: 1 token ≈ 4 characters for English text
    return len(text) // 4


def optimize_prompt(prompt: str, max_tokens: int = 4000) -> str:
    """
    Optimize a prompt to reduce token usage while preserving important content.
    
    Args:
        prompt: The input prompt
        max_tokens: Maximum number of tokens allowed
        
    Returns:
        Optimized prompt
    """
    estimated_tokens = estimate_tokens(prompt)
    
    # If already under the limit, return as is
    if estimated_tokens <= max_tokens:
        return prompt
    
    # Split the prompt into sections
    sections = re.split(r'\n\n+', prompt)
    
    # Identify the user question (usually at the end)
    user_question = None
    for i in range(len(sections) - 1, -1, -1):
        if sections[i].lower().startswith('user question:'):
            user_question = sections[i]
            sections.pop(i)
            break
    
    # Identify the context section
    context_start = -1
    context_end = -1
    for i, section in enumerate(sections):
        if section.startswith('Here is some relevant information'):
            context_start = i
        elif context_start >= 0 and section.strip() == '':
            context_end = i
            break
    
    # If we found the context section
    if context_start >= 0:
        context_sections = sections[context_start:context_end] if context_end > 0 else sections[context_start:]
        other_sections = sections[:context_start] + (sections[context_end:] if context_end > 0 else [])
        
        # Calculate tokens for non-context parts
        other_text = '\n\n'.join(other_sections)
        other_tokens = estimate_tokens(other_text)
        
        # Calculate available tokens for context
        available_context_tokens = max_tokens - other_tokens
        if user_question:
            available_context_tokens -= estimate_tokens(user_question)
        
        # If we need to reduce context
        if available_context_tokens < estimate_tokens('\n\n'.join(context_sections)):
            # Extract individual documents from context
            documents = []
            current_doc = []
            
            for line in '\n\n'.join(context_sections).split('\n'):
                if line.startswith('Document '):
                    if current_doc:
                        documents.append('\n'.join(current_doc))
                    current_doc = [line]
                else:
                    current_doc.append(line)
            
            if current_doc:
                documents.append('\n'.join(current_doc))
            
            # Sort documents by relevance (assuming they're already sorted)
            # Keep adding documents until we hit the token limit
            optimized_context = []
            current_tokens = 0
            
            for doc in documents:
                doc_tokens = estimate_tokens(doc)
                if current_tokens + doc_tokens <= available_context_tokens:
                    optimized_context.append(doc)
                    current_tokens += doc_tokens
                else:
                    break
            
            # Rebuild the prompt
            result = []
            if context_start > 0:
                result.extend(sections[:context_start])
            
            if optimized_context:
                result.append('Here is some relevant information that might help answer the question:')
                result.extend(optimized_context)
            
            if context_end > 0:
                result.extend(sections[context_end:])
            
            if user_question:
                result.append(user_question)
            
            return '\n\n'.join(result)
    
    # Fallback: simple truncation while preserving the user question
    if user_question:
        # Calculate available tokens for the rest of the prompt
        available_tokens = max_tokens - estimate_tokens(user_question) - 100  # Buffer
        
        # Truncate the rest of the prompt
        rest_of_prompt = '\n\n'.join(sections)
        truncated_prompt = rest_of_prompt[:available_tokens * 4]  # Convert back to characters
        
        return truncated_prompt + '\n\n' + user_question
    
    # Last resort: just truncate
    return prompt[:max_tokens * 4]  # Convert tokens to approximate characters
