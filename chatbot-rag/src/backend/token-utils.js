/**
 * Utility functions for token counting and prompt optimization
 */

// Simple token counting approximation
// For more accurate counting, use a proper tokenizer library
function countTokens(text) {
  if (!text) return 0;
  
  // Rough approximation: 4 characters per token (average for English text)
  // This is a simplification - in production, use a proper tokenizer
  return Math.ceil(text.length / 4);
}

// Optimize prompt to reduce token usage
function optimizePrompt(prompt, maxTokens = 4000) {
  // Count tokens in the prompt
  const promptTokens = countTokens(prompt);
  
  if (promptTokens <= maxTokens) {
    return prompt;
  }
  
  // If prompt exceeds max tokens, we need to truncate it
  console.log(`Prompt exceeds token limit (${promptTokens}/${maxTokens}). Optimizing...`);
  
  // Parse the prompt to identify components
  const parts = parsePrompt(prompt);
  
  // Calculate how many tokens we need to remove
  const tokensToRemove = promptTokens - maxTokens + 200; // Add buffer
  
  // Prioritize which parts to truncate
  return truncatePromptParts(parts, tokensToRemove);
}

// Parse prompt into components
function parsePrompt(prompt) {
  // Simple parsing - in a real system this would be more sophisticated
  const lines = prompt.split('\n\n');
  const parts = [];
  
  let currentPart = { type: 'context', content: '', tokens: 0 };
  
  for (const line of lines) {
    if (line.startsWith('Document ')) {
      // Start a new document part
      if (currentPart.content) {
        currentPart.tokens = countTokens(currentPart.content);
        parts.push(currentPart);
      }
      currentPart = { type: 'document', content: line + '\n', tokens: 0 };
    } else if (line.startsWith('User question:')) {
      // User question part
      if (currentPart.content) {
        currentPart.tokens = countTokens(currentPart.content);
        parts.push(currentPart);
      }
      currentPart = { type: 'question', content: line + '\n', tokens: 0 };
    } else if (line.startsWith('Please provide')) {
      // Instructions part
      if (currentPart.content) {
        currentPart.tokens = countTokens(currentPart.content);
        parts.push(currentPart);
      }
      currentPart = { type: 'instructions', content: line, tokens: 0 };
    } else {
      // Append to current part
      currentPart.content += line + '\n\n';
    }
  }
  
  // Add the last part
  if (currentPart.content) {
    currentPart.tokens = countTokens(currentPart.content);
    parts.push(currentPart);
  }
  
  return parts;
}

// Truncate prompt parts based on priority
function truncatePromptParts(parts, tokensToRemove) {
  // Prioritize parts to truncate (documents first, then context, never question or instructions)
  const documentParts = parts.filter(p => p.type === 'document');
  
  // Sort documents by relevance (assuming later documents are less relevant)
  documentParts.sort((a, b) => {
    // Extract similarity score if available
    const getScore = (part) => {
      const match = part.content.match(/similarity: (0\.\d+)/);
      return match ? parseFloat(match[1]) : 0;
    };
    
    return getScore(b) - getScore(a);
  });
  
  let removedTokens = 0;
  let truncatedParts = [...parts];
  
  // Remove least relevant documents first
  while (removedTokens < tokensToRemove && documentParts.length > 0) {
    const leastRelevantDoc = documentParts.pop();
    removedTokens += leastRelevantDoc.tokens;
    
    // Remove this document from truncatedParts
    truncatedParts = truncatedParts.filter(p => p !== leastRelevantDoc);
  }
  
  // If we still need to remove tokens, truncate remaining documents
  if (removedTokens < tokensToRemove) {
    truncatedParts = truncatedParts.map(part => {
      if (part.type === 'document' && removedTokens < tokensToRemove) {
        // Truncate this document
        const currentTokens = part.tokens;
        const tokensToRemoveFromThisPart = Math.min(
          Math.floor(currentTokens * 0.5), // Remove up to 50% of tokens
          tokensToRemove - removedTokens
        );
        
        if (tokensToRemoveFromThisPart > 0) {
          // Truncate content
          const words = part.content.split(' ');
          const truncatedWords = words.slice(0, Math.floor(words.length * 0.5));
          const truncatedContent = truncatedWords.join(' ') + '... [truncated]';
          
          const newTokens = countTokens(truncatedContent);
          removedTokens += (currentTokens - newTokens);
          
          return {
            ...part,
            content: truncatedContent,
            tokens: newTokens
          };
        }
      }
      return part;
    });
  }
  
  // Reassemble the prompt
  return truncatedParts.map(p => p.content).join('\n\n');
}

module.exports = {
  countTokens,
  optimizePrompt
};
