"""
Document chunking utilities for the chatbot backend.
"""
import logging
import re
from typing import Any, Dict, List

import nltk
from nltk.tokenize import sent_tokenize

from .constants import (
    DEFAULT_CHUNK_SIZE, MAX_CHUNK_SIZE, MIN_CHUNK_SIZE, CHUNK_OVERLAP_SIZE
)

# Initialize logger
logger = logging.getLogger(__name__)

# Download NLTK data if not already downloaded
try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt', quiet=True)


def create_chunks(extracted_content: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Create chunks using advanced chunking strategies.
    
    Args:
        extracted_content: Extracted document content
        
    Returns:
        List of document chunks
    """
    text = extracted_content["text"]
    structure = extracted_content.get("structure", [])
    metadata = extracted_content.get("metadata", {})
    
    # Configuration for chunking
    config = {
        "targetChunkSize": DEFAULT_CHUNK_SIZE,     # Target size for each chunk in characters
        "maxChunkSize": MAX_CHUNK_SIZE,        # Maximum size for any chunk
        "minChunkSize": MIN_CHUNK_SIZE,         # Minimum size for any chunk
        "overlapSize": CHUNK_OVERLAP_SIZE,          # Number of characters to overlap between chunks
        "sentenceEndingChars": ['.', '!', '?', '\n\n']  # Characters that indicate good break points
    }
    
    # If we have structure information, use it for semantic chunking
    if structure:
        return create_structured_chunks(text, structure, metadata, config)
    else:
        # Fall back to semantic chunking without structure
        return create_semantic_chunks(text, metadata, config)


def create_structured_chunks(
    text: str, structure: List[Dict[str, Any]], metadata: Dict[str, Any], config: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """
    Create chunks based on document structure (headings).
    
    Args:
        text: Document text
        structure: Document structure
        metadata: Document metadata
        config: Chunking configuration
        
    Returns:
        List of document chunks
    """
    chunks = []
    
    # Sort structure elements by their position in the text
    sorted_structure = sorted(structure, key=lambda x: x["startPosition"])
    
    # Add end of document as the final position
    sorted_structure.append({
        "startPosition": len(text),
        "level": 0,
        "text": "END_OF_DOCUMENT"
    })
    
    # Process each section defined by headings
    for i in range(len(sorted_structure) - 1):
        current_heading = sorted_structure[i]
        next_heading = sorted_structure[i + 1]
        
        # Extract section text
        section_start = current_heading["startPosition"]
        section_end = next_heading["startPosition"]
        section_text = text[section_start:section_end]
        
        # Skip empty sections
        if not section_text.strip():
            continue
        
        # For very short sections, keep them as a single chunk
        if len(section_text) <= config["maxChunkSize"]:
            chunks.append({
                "content": section_text,
                "type": "section",
                "heading": current_heading["text"],
                "importanceScore": calculate_importance_score(current_heading, section_text),
                "metadata": {
                    "headingLevel": current_heading["level"],
                    "sectionIndex": i,
                    **metadata
                }
            })
        else:
            # For longer sections, split into semantic chunks
            section_chunks = split_text_into_chunks_nlp(section_text, config)
            
            # Add heading and metadata to each chunk
            for chunk_index, chunk in enumerate(section_chunks):
                chunks.append({
                    "content": chunk,
                    "type": "section_chunk",
                    "heading": current_heading["text"],
                    "importanceScore": calculate_importance_score(current_heading, chunk, chunk_index),
                    "metadata": {
                        "headingLevel": current_heading["level"],
                        "sectionIndex": i,
                        "chunkIndex": chunk_index,
                        **metadata
                    }
                })
    
    return chunks


def create_semantic_chunks(
    text: str, metadata: Dict[str, Any], config: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """
    Create semantic chunks without structure information.
    
    Args:
        text: Document text
        metadata: Document metadata
        config: Chunking configuration
        
    Returns:
        List of document chunks
    """
    chunks = []
    
    # Split text into semantic chunks using NLP
    text_chunks = split_text_into_chunks_nlp(text, config)
    
    # Process each chunk
    for index, chunk in enumerate(text_chunks):
        # Try to extract a title from the first chunk
        chunk_title = None
        if index == 0:
            # Look for potential title in the first few lines
            lines = [line for line in chunk.split('\n') if line.strip()]
            if lines and len(lines[0]) < MIN_CHUNK_SIZE:
                chunk_title = lines[0]
        
        chunks.append({
            "content": chunk,
            "type": "text_chunk",
            "heading": chunk_title,
            "importanceScore": 1.0,
            "metadata": {
                "chunkIndex": index,
                **metadata
            }
        })
    
    return chunks


def split_text_into_chunks_nlp(text: str, config: Dict[str, Any]) -> List[str]:
    """
    Split text into chunks at semantic boundaries using NLP.
    
    Args:
        text: Document text
        config: Chunking configuration
        
    Returns:
        List of text chunks
    """
    # Tokenize text into sentences using NLTK
    try:
        sentences = sent_tokenize(text)
    except Exception as e:
        # Fall back to simple splitting if NLTK fails
        logger.warning(f"NLTK sentence tokenization failed: {e}. Falling back to simple splitting.")
        return split_text_into_chunks(text, config)
    
    chunks = []
    current_chunk = ""
    
    for sentence in sentences:
        # If adding this sentence would exceed the max chunk size, start a new chunk
        if len(current_chunk) + len(sentence) > config["maxChunkSize"] and current_chunk:
            chunks.append(current_chunk)
            
            # Start new chunk with overlap
            # Find a good sentence boundary for overlap
            overlap_text = current_chunk[-config["overlapSize"]:] if config["overlapSize"] < len(current_chunk) else current_chunk
            
            # Try to find a sentence boundary in the overlap
            overlap_sentences = sent_tokenize(overlap_text)
            if len(overlap_sentences) > 1:
                # Use the last sentence(s) as overlap
                current_chunk = overlap_sentences[-1]
            else:
                # Just use the overlap text
                current_chunk = overlap_text
        
        # Add the sentence to the current chunk
        current_chunk += " " + sentence if current_chunk else sentence
        
        # If we've reached target chunk size, create a chunk
        if len(current_chunk) >= config["targetChunkSize"]:
            chunks.append(current_chunk)
            current_chunk = ""
    
    # Add the final chunk if it's not empty and meets minimum size
    if current_chunk and len(current_chunk) >= config["minChunkSize"]:
        chunks.append(current_chunk)
    elif current_chunk and chunks:
        # Append to the last chunk if it's too small
        chunks[-1] += " " + current_chunk
    elif current_chunk:
        # If it's the only chunk, keep it despite being small
        chunks.append(current_chunk)
    
    return chunks


def split_text_into_chunks(text: str, config: Dict[str, Any]) -> List[str]:
    """
    Split text into chunks at semantic boundaries (fallback method).
    
    Args:
        text: Document text
        config: Chunking configuration
        
    Returns:
        List of text chunks
    """
    chunks = []
    current_chunk = ""
    last_break_point = 0
    
    # Process text character by character
    for i in range(len(text)):
        current_chunk += text[i]
        
        # Check if we're at a potential break point
        is_break_point = text[i] in config["sentenceEndingChars"]
        
        if is_break_point:
            last_break_point = len(current_chunk)
        
        # If we've reached target chunk size and we have a break point, create a chunk
        if len(current_chunk) >= config["targetChunkSize"] and last_break_point > 0:
            # Create chunk up to the last break point
            chunk_text = current_chunk[:last_break_point]
            chunks.append(chunk_text)
            
            # Start new chunk with overlap
            overlap_start = max(0, last_break_point - config["overlapSize"])
            current_chunk = current_chunk[overlap_start:]
            last_break_point = 0
        
        # If we've reached max chunk size, force a break
        if len(current_chunk) >= config["maxChunkSize"]:
            chunks.append(current_chunk)
            current_chunk = ""
            last_break_point = 0
    
    # Add the final chunk if it's not empty and meets minimum size
    if len(current_chunk) >= config["minChunkSize"]:
        chunks.append(current_chunk)
    elif current_chunk and chunks:
        # Append to the last chunk if it's too small
        chunks[-1] += current_chunk
    elif current_chunk:
        # If it's the only chunk, keep it despite being small
        chunks.append(current_chunk)
    
    return chunks


def calculate_importance_score(
    heading: Dict[str, Any], text: str, chunk_index: int = 0
) -> float:
    """
    Calculate importance score for a chunk based on heading level and content.
    
    Args:
        heading: Section heading
        text: Chunk text
        chunk_index: Chunk index within section
        
    Returns:
        Importance score
    """
    score = 1.0
    
    # Higher score for higher-level headings (h1 > h2 > h3)
    if heading and heading.get("level"):
        score += (7 - min(heading["level"], 6)) * 0.1
    
    # Higher score for first chunk in a section
    if chunk_index == 0:
        score += 0.2
    
    # Higher score for chunks with keywords like "important", "key", "summary"
    keywords = ["important", "key", "summary", "conclusion", "result", "finding"]
    text_lower = text.lower()
    
    for keyword in keywords:
        if keyword in text_lower:
            score += 0.1
    
    # Analyze text density and information content
    # More sentences and fewer filler words indicate higher information density
    try:
        sentences = sent_tokenize(text)
        sentence_count = len(sentences)
        avg_sentence_length = len(text) / max(sentence_count, 1)
        
        # Reward moderate sentence length (not too short, not too long)
        if 10 <= avg_sentence_length <= 30:
            score += 0.1
        
        # Reward appropriate number of sentences
        if 3 <= sentence_count <= 10:
            score += 0.1
    except Exception:
        # If NLTK fails, don't adjust the score
        pass
    
    # Cap the score at 2.0
    return min(score, 2.0)
