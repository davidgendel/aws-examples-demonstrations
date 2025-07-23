/**
 * SmallBizChatbot - A customizable chatbot widget for small businesses
 * 
 * This widget can be embedded into any website and customized to match the site's branding.
 */
(function() {
  'use strict';

  // Default configuration
  const DEFAULT_CONFIG = {
    containerId: 'chatbot-container',
    apiEndpoint: 'API_ENDPOINT_PLACEHOLDER', // Will be replaced during deployment
    apiKey: 'API_KEY_PLACEHOLDER', // Will be replaced during deployment
    websocketUrl: 'WEBSOCKET_URL_PLACEHOLDER', // Will be replaced during deployment
    streaming: true, // Enable streaming by default
    theme: {
      primaryColor: '#4287f5',
      secondaryColor: '#f5f5f5',
      fontFamily: 'Arial, sans-serif',
      fontSize: '16px',
      borderRadius: '8px'
    },
    placeholderText: 'Ask me anything...',
    welcomeMessage: 'Hello! How can I help you today?',
    cache: {
      enabled: true,
      maxEntries: 20,
      ttl: 3600000 // 1 hour in milliseconds
    },
    websocket: {
      reconnectAttempts: 5,
      reconnectInterval: 1000,
      connectionTimeout: 5000,
      heartbeatInterval: 30000
    },
    mobileToggle: true, // Show mobile toggle button
    suggestedQuestions: true, // Show suggested questions
    feedback: true, // Enable feedback buttons
    accessibility: {
      announcements: true, // Screen reader announcements
      highContrast: false // High contrast mode
    }
  };

  // HTML sanitization function to prevent XSS
  function sanitizeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Safe function to set HTML content with sanitization
  function safeSetHTML(element, content) {
    // For simple text content, use textContent
    if (typeof content === 'string' && !content.includes('<')) {
      element.textContent = content;
      return;
    }
    
    // For HTML content, sanitize it
    const sanitized = sanitizeHTML(content);
    element.innerHTML = sanitized;
  }

  // Widget state
  let config = {};
  let chatHistory = [];
  let isWaitingForResponse = false;
  let cache = {};
  let currentQuestion = null;
  let webSocket = null;
  let currentConnectionId = null;
  let reconnectCount = 0;
  let reconnectTimer = null;
  let connectionTimer = null;
  let heartbeatTimer = null;
  let messageQueue = [];
  let wsState = 'CLOSED'; // CONNECTING, OPEN, CLOSING, CLOSED
  let currentStreamingMessage = null;
  let isStreaming = false;

  // =============================================================================
  // UTILITY FUNCTIONS (defined first to avoid hoisting issues)
  // =============================================================================

  // Simple keyword extraction (would be more sophisticated in production)
  function extractKeywords(text) {
    if (!text) return [];
    
    // Remove common words and punctuation
    const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with', 'by'];
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    
    // Count word frequency
    const wordCounts = {};
    words.forEach(word => {
      if (word.length > 3 && !stopWords.includes(word)) {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      }
    });
    
    // Sort by frequency and return top keywords
    return Object.entries(wordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(entry => entry[0]);
  }

  // Generate suggested questions based on context
  function generateSuggestedQuestions(context) {
    // This is a simple implementation - in a real system, you might use
    // the Bedrock API to generate contextually relevant questions
    
    const commonFollowUps = [
      "Can you explain more about that?",
      "What are the benefits of this approach?",
      "Are there any alternatives?",
      "How does this compare to other options?"
    ];
    
    // Extract keywords from context to generate more specific questions
    const keywords = extractKeywords(context);
    
    const specificQuestions = keywords.map(keyword => 
      `Tell me more about ${keyword}`
    );
    
    // Combine and return up to 3 questions
    return [...specificQuestions, ...commonFollowUps].slice(0, 3);
  }

  // Announce message to screen readers
  function announceToScreenReader(message) {
    if (!config.accessibility.announcements) return;
    
    const statusElement = document.getElementById(`${config.containerId}-status`);
    if (statusElement) {
      statusElement.textContent = message;
      
      // Clear after a short delay to allow for new announcements
      setTimeout(() => {
        if (statusElement && statusElement.parentNode) { // Add null check and parent check
          statusElement.textContent = '';
        }
      }, 1000);
    }
  }

  // =============================================================================
  // CACHE MANAGEMENT FUNCTIONS
  // =============================================================================

  // Initialize cache from localStorage
  function initializeCache() {
    if (!config.cache.enabled) return;
    
    try {
      const storedCache = localStorage.getItem('smallBizChatbotCache');
      if (storedCache) {
        cache = JSON.parse(storedCache);
        
        // Clean expired entries
        const now = Date.now();
        Object.keys(cache).forEach(key => {
          if (cache[key].expires < now) {
            delete cache[key];
          }
        });
        
        // Limit cache size
        const entries = Object.entries(cache);
        if (entries.length > config.cache.maxEntries) {
          // Remove oldest entries
          entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
          const toRemove = entries.slice(0, entries.length - config.cache.maxEntries);
          toRemove.forEach(([key]) => delete cache[key]);
        }
        
        // Save cleaned cache
        localStorage.setItem('smallBizChatbotCache', JSON.stringify(cache));
      }
    } catch (error) {
      console.warn('Error initializing cache:', error);
      cache = {};
    }
  }

  // Get cached response
  function getCachedResponse(message) {
    if (!config.cache.enabled) return null;
    
    const key = message.toLowerCase().trim();
    const cached = cache[key];
    
    if (cached && cached.expires > Date.now()) {
      return cached.response;
    }
    
    return null;
  }

  // Cache response
  function cacheResponse(message, response) {
    if (!config.cache.enabled) return;
    
    try {
      const key = message.toLowerCase().trim();
      cache[key] = {
        response: response,
        timestamp: Date.now(),
        expires: Date.now() + config.cache.ttl
      };
      
      // Limit cache size
      const entries = Object.entries(cache);
      if (entries.length > config.cache.maxEntries) {
        // Remove oldest entry
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        delete cache[entries[0][0]];
      }
      
      localStorage.setItem('smallBizChatbotCache', JSON.stringify(cache));
    } catch (error) {
      console.warn('Error caching response:', error);
    }
  }

  // Clear cache
  function clearCache() {
    cache = {};
    try {
      localStorage.removeItem('smallBizChatbotCache');
    } catch (error) {
      console.warn('Error clearing cache:', error);
    }
  }

  // =============================================================================
  // BROWSER SUPPORT AND FEEDBACK FUNCTIONS
  // =============================================================================

  // Check for browser support and provide fallbacks
  function checkBrowserSupport() {
    const support = {
      webSockets: 'WebSocket' in window,
      fetch: 'fetch' in window,
      localStorage: (function() {
        try {
          localStorage.setItem('test', 'test');
          localStorage.removeItem('test');
          return true;
        } catch (e) {
          return false;
        }
      })(),
      json: (function() {
        try {
          JSON.parse('{}');
          return true;
        } catch (e) {
          return false;
        }
      })()
    };
    
    // Disable features based on browser support
    if (!support.webSockets) {
      config.streaming = false;
      console.warn('WebSockets not supported. Streaming disabled.');
    }
    
    if (!support.localStorage) {
      config.cache.enabled = false;
      console.warn('LocalStorage not supported. Caching disabled.');
    }
    
    if (!support.fetch) {
      // Provide XMLHttpRequest fallback
      window.fetch = function(url, options) {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(options.method || 'GET', url);
          
          if (options.headers) {
            Object.keys(options.headers).forEach(key => {
              xhr.setRequestHeader(key, options.headers[key]);
            });
          }
          
          xhr.onload = function() {
            resolve({
              ok: xhr.status >= 200 && xhr.status < 300,
              status: xhr.status,
              json: function() {
                return Promise.resolve(JSON.parse(xhr.responseText));
              },
              text: function() {
                return Promise.resolve(xhr.responseText);
              }
            });
          };
          
          xhr.onerror = function() {
            reject(new Error('Network request failed'));
          };
          
          xhr.send(options.body);
        });
      };
      
      console.warn('Fetch API not supported. Using XMLHttpRequest fallback.');
    }
    
    return support;
  }

  // Send feedback to the server
  function sendFeedback(responseId, rating, comment = '') {
    // Store feedback in localStorage for now since we don't have a feedback endpoint
    try {
      const feedback = {
        responseId,
        rating,
        comment,
        timestamp: new Date().toISOString()
      };
      
      let feedbackHistory = [];
      const storedFeedback = localStorage.getItem('smallBizChatbotFeedback');
      
      if (storedFeedback) {
        feedbackHistory = JSON.parse(storedFeedback);
      }
      
      feedbackHistory.push(feedback);
      localStorage.setItem('smallBizChatbotFeedback', JSON.stringify(feedbackHistory));
      
      console.log('Feedback stored:', feedback);
    } catch (error) {
      console.error('Error storing feedback:', error);
    }
  }

  // =============================================================================
  // DOM MANIPULATION FUNCTIONS (moved here to resolve dependencies)
  // =============================================================================

  // Update message content (for streaming)
  function updateMessage(messageElement, text) {
    if (messageElement && messageElement.parentNode) {
      messageElement.textContent = text;
      
      // Scroll to bottom
      const chatArea = document.getElementById(`${config.containerId}-chat-area`);
      if (chatArea) {
        chatArea.scrollTop = chatArea.scrollHeight;
      }
    }
  }

  // Show typing indicator
  function showTypingIndicator() {
    const chatArea = document.getElementById(`${config.containerId}-chat-area`);
    if (!chatArea) {
      console.error('Chat area not found for typing indicator');
      return null;
    }
    
    const typingElement = document.createElement('div');
    typingElement.id = `${config.containerId}-typing`;
    typingElement.className = 'chatbot-typing';
    typingElement.setAttribute('aria-label', 'Assistant is typing');
    
    // Create typing dots
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      dot.className = 'chatbot-typing-dot';
      typingElement.appendChild(dot);
    }
    
    chatArea.appendChild(typingElement);
    chatArea.scrollTop = chatArea.scrollHeight;
    
    return typingElement;
  }

  // Hide typing indicator
  function hideTypingIndicator() {
    const typingElement = document.getElementById(`${config.containerId}-typing`);
    if (typingElement) {
      typingElement.remove();
    }
  }

  // Add feedback buttons to responses
  function addFeedbackButtons(messageElement, responseId) {
    const feedbackContainer = document.createElement('div');
    feedbackContainer.className = 'chatbot-feedback';
    
    const feedbackText = document.createElement('span');
    feedbackText.textContent = 'Was this helpful? ';
    feedbackContainer.appendChild(feedbackText);
    
    const thumbsUp = document.createElement('button');
    thumbsUp.textContent = '👍';
    thumbsUp.style.background = 'none';
    thumbsUp.style.border = 'none';
    thumbsUp.style.cursor = 'pointer';
    thumbsUp.style.fontSize = '14px';
    thumbsUp.style.marginLeft = '5px';
    thumbsUp.setAttribute('aria-label', 'Yes, this was helpful');
    
    const thumbsDown = document.createElement('button');
    thumbsDown.textContent = '👎';
    thumbsDown.style.background = 'none';
    thumbsDown.style.border = 'none';
    thumbsDown.style.cursor = 'pointer';
    thumbsDown.style.fontSize = '14px';
    thumbsDown.style.marginLeft = '5px';
    thumbsDown.setAttribute('aria-label', 'No, this was not helpful');
    
    // Add click handlers
    thumbsUp.addEventListener('click', () => {
      sendFeedback(responseId, 'positive');
      feedbackContainer.textContent = 'Thanks for your feedback!';
    });
    
    thumbsDown.addEventListener('click', () => {
      sendFeedback(responseId, 'negative');
      
      // Show follow-up question for negative feedback
      feedbackContainer.textContent = '';
      
      const textArea = document.createElement('textarea');
      textArea.placeholder = 'How could this response be improved?';
      textArea.style.width = '100%';
      textArea.style.padding = '5px';
      textArea.style.marginTop = '5px';
      textArea.style.borderRadius = '4px';
      textArea.style.border = '1px solid #ccc';
      textArea.style.fontSize = '12px';
      textArea.style.resize = 'vertical';
      
      const submitButton = document.createElement('button');
      submitButton.textContent = 'Submit';
      submitButton.style.marginTop = '5px';
      submitButton.style.padding = '3px 8px';
      submitButton.style.backgroundColor = config.theme.primaryColor;
      submitButton.style.color = 'white';
      submitButton.style.border = 'none';
      submitButton.style.borderRadius = '4px';
      submitButton.style.cursor = 'pointer';
      submitButton.style.fontSize = '12px';
      
      submitButton.addEventListener('click', () => {
        sendFeedback(responseId, 'negative', textArea.value);
        feedbackContainer.textContent = 'Thanks for your feedback!';
      });
      
      feedbackContainer.appendChild(textArea);
      feedbackContainer.appendChild(submitButton);
      
      // Focus on textarea
      setTimeout(() => textArea.focus(), 100);
    });
    
    feedbackContainer.appendChild(thumbsUp);
    feedbackContainer.appendChild(thumbsDown);
    messageElement.appendChild(feedbackContainer);
  }

  // Add suggested questions after bot responses
  function addSuggestedQuestions(messageElement, context) {
    // Generate suggested follow-up questions based on the context
    const suggestedQuestions = generateSuggestedQuestions(context);
    
    if (suggestedQuestions.length === 0) return;
    
    const suggestionsContainer = document.createElement('div');
    suggestionsContainer.className = 'chatbot-suggestions';
    
    suggestedQuestions.forEach(question => {
      const suggestionButton = document.createElement('button');
      suggestionButton.textContent = question;
      suggestionButton.setAttribute('aria-label', `Suggested question: ${question}`);
      
      suggestionButton.addEventListener('click', () => {
        // Set the question in the input field
        const inputField = document.getElementById(`${config.containerId}-input`);
        if (inputField) {
          inputField.value = question;
          
          // Send the message
          sendMessage();
          
          // Remove suggestions after clicking
          suggestionsContainer.remove();
        }
      });
      
      suggestionsContainer.appendChild(suggestionButton);
    });
    
    messageElement.appendChild(suggestionsContainer);
  }

  // Add message to chat
  function addMessage(sender, text, isCached = false, isStreaming = false) {
    const chatArea = document.getElementById(`${config.containerId}-chat-area`);
    if (!chatArea) {
      console.error('Chat area not found');
      return null;
    }
    
    // Create message element
    const messageElement = document.createElement('div');
    messageElement.className = `chatbot-message chatbot-${sender}-message`;
    if (isCached) {
      messageElement.className += ' chatbot-cached';
    }
    if (isStreaming) {
      messageElement.className += ' chatbot-streaming';
    }
    messageElement.textContent = text;
    
    // Add ARIA attributes for accessibility
    messageElement.setAttribute('role', 'listitem');
    messageElement.setAttribute('aria-label', `${sender === 'user' ? 'You' : 'Assistant'}: ${text}`);
    
    // Add message to chat area
    chatArea.appendChild(messageElement);
    
    // Add feedback buttons for bot messages
    if (sender === 'bot' && !isCached && config.feedback) {
      const responseId = Date.now().toString();
      addFeedbackButtons(messageElement, responseId);
    }
    
    // Add suggested questions for bot messages
    if (sender === 'bot' && config.suggestedQuestions) {
      addSuggestedQuestions(messageElement, text);
    }
    
    // Scroll to bottom
    chatArea.scrollTop = chatArea.scrollHeight;
    
    // Add to history
    chatHistory.push({ sender, text, isCached, timestamp: Date.now() });
    
    // Announce new message to screen readers
    if (sender === 'bot' && config.accessibility.announcements) {
      announceToScreenReader(`New message: ${text}`);
    }
    
    return messageElement;
  }

  // =============================================================================
  // MESSAGING FUNCTIONS
  // =============================================================================

  // Send message function
  function sendMessage() {
    const inputField = document.getElementById(`${config.containerId}-input`);
    if (!inputField) {
      console.error('Input field not found');
      return;
    }
    
    const message = inputField.value.trim();
    
    if (!message || isWaitingForResponse) {
      return;
    }
    
    // Clear input field
    inputField.value = '';
    currentQuestion = message;
    
    // Add user message to chat
    addMessage('user', message);
    
    // Check cache first
    const cachedResponse = getCachedResponse(message);
    if (cachedResponse) {
      addMessage('bot', cachedResponse, true);
      isWaitingForResponse = false; // Reset waiting state
      return;
    }
    
    // Set waiting state
    isWaitingForResponse = true;
    
    // Show typing indicator
    showTypingIndicator();
    
    // Try WebSocket first if available and streaming is enabled
    if (config.streaming && webSocket && wsState === 'OPEN') {
      sendWebSocketMessage(message);
    } else {
      // Fall back to REST API
      sendRestMessage(message);
    }
  }

  // Send message via REST API
  async function sendRestMessage(message) {
    try {
      const response = await fetch(config.apiEndpoint + '/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey
        },
        body: JSON.stringify({
          message: message,
          streaming: false
        })
      });
      
      hideTypingIndicator();
      
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Handle standardized error response format
      if (!data.success || data.error) {
        const errorMessage = data.error ? 
          (data.error.message || data.error) : 
          'An unknown error occurred';
        addMessage('bot', `Sorry, I encountered an error: ${errorMessage}`);
      } else {
        // Handle success response
        const responseText = data.data ? data.data.response : data.response;
        addMessage('bot', responseText);
        cacheResponse(message, responseText);
      }
    } catch (error) {
      hideTypingIndicator();
      console.error('Error sending message:', error);
      addMessage('bot', 'Sorry, I\'m having trouble connecting right now. Please try again later.');
    } finally {
      isWaitingForResponse = false;
    }
  }

  // Send message via WebSocket
  function sendWebSocketMessage(message) {
    const messageData = {
      action: 'sendMessage',
      message: message
    };
    
    if (wsState === 'OPEN') {
      try {
        webSocket.send(JSON.stringify(messageData));
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
        // Fall back to REST API
        sendRestMessage(message);
      }
    } else {
      // Queue message for later
      messageQueue.push(messageData);
      
      // Try to reconnect
      if (wsState === 'CLOSED') {
        initWebSocket();
      }
    }
  }

  // =============================================================================
  // HTML CREATION AND STYLING FUNCTIONS
  // =============================================================================

  // Add CSS styles
  function addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .chatbot-message {
        margin-bottom: 10px;
        max-width: 80%;
        padding: 10px;
        border-radius: ${config.theme.borderRadius};
        word-wrap: break-word;
      }
      .chatbot-user-message {
        background-color: ${config.theme.primaryColor};
        color: white;
        margin-left: auto;
      }
      .chatbot-bot-message {
        background-color: ${config.theme.secondaryColor};
        color: #333;
      }
      .chatbot-cached {
        border-left: 3px solid #aaa;
      }
      .chatbot-streaming {
        border-left: 3px solid ${config.theme.primaryColor};
      }
      .chatbot-typing {
        display: flex;
        padding: 10px;
        background-color: ${config.theme.secondaryColor};
        border-radius: ${config.theme.borderRadius};
        width: fit-content;
      }
      .chatbot-typing-dot {
        width: 8px;
        height: 8px;
        background-color: #888;
        border-radius: 50%;
        margin: 0 2px;
        animation: chatbot-typing 1.4s infinite ease-in-out both;
      }
      .chatbot-typing-dot:nth-child(1) { animation-delay: -0.32s; }
      .chatbot-typing-dot:nth-child(2) { animation-delay: -0.16s; }
      @keyframes chatbot-typing {
        0%, 80%, 100% { transform: scale(0); }
        40% { transform: scale(1); }
      }
      
      .chatbot-feedback {
        margin-top: 5px;
        text-align: right;
        font-size: 12px;
      }
      
      .chatbot-suggestions {
        margin-top: 10px;
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }
      
      .chatbot-suggestions button {
        background-color: #f0f0f0;
        border: 1px solid #ddd;
        border-radius: 16px;
        padding: 5px 10px;
        font-size: 12px;
        cursor: pointer;
        transition: background-color 0.2s;
      }
      
      .chatbot-suggestions button:hover {
        background-color: #e0e0e0;
      }
      
      /* Accessibility focus styles */
      #${config.containerId}-input:focus,
      #${config.containerId}-send:focus {
        outline: 2px solid ${config.theme.primaryColor};
        outline-offset: 2px;
      }
      
      /* Mobile responsive styles */
      @media (max-width: 480px) {
        #${config.containerId} {
          width: 100% !important;
          max-width: 100% !important;
          height: 100vh !important;
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          border-radius: 0 !important;
          z-index: 9999 !important;
        }
        
        #${config.containerId}-header {
          padding: 15px !important;
        }
        
        #${config.containerId}-input {
          font-size: 16px !important; /* Prevent zoom on iOS */
        }
        
        .chatbot-message {
          max-width: 90% !important;
        }
      }
      
      /* Floating button for mobile */
      .chatbot-mobile-toggle {
        display: none;
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background-color: ${config.theme.primaryColor};
        color: white;
        text-align: center;
        line-height: 60px;
        font-size: 24px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        cursor: pointer;
        z-index: 9998;
        border: none;
        transition: transform 0.2s;
      }
      
      .chatbot-mobile-toggle:hover {
        transform: scale(1.1);
      }
      
      @media (max-width: 480px) {
        .chatbot-mobile-toggle {
          display: block;
        }
        
        #${config.containerId} {
          display: none;
        }
        
        #${config.containerId}.chatbot-mobile-open {
          display: flex;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Add mobile toggle button
  function addMobileToggle() {
    const toggleButton = document.createElement('button');
    toggleButton.className = 'chatbot-mobile-toggle';
    toggleButton.textContent = '💬';
    toggleButton.setAttribute('aria-label', 'Open chat');
    toggleButton.setAttribute('role', 'button');
    toggleButton.setAttribute('tabindex', '0');
    
    toggleButton.addEventListener('click', () => {
      const container = document.getElementById(config.containerId);
      if (!container) {
        console.error('Container not found for mobile toggle');
        return;
      }
      
      if (container.classList.contains('chatbot-mobile-open')) {
        container.classList.remove('chatbot-mobile-open');
        toggleButton.textContent = '💬';
        toggleButton.setAttribute('aria-label', 'Open chat');
        announceToScreenReader('Chat closed');
      } else {
        container.classList.add('chatbot-mobile-open');
        toggleButton.textContent = '✕';
        toggleButton.setAttribute('aria-label', 'Close chat');
        announceToScreenReader('Chat opened');
        
        // Focus on input when opened
        setTimeout(() => {
          const inputField = document.getElementById(`${config.containerId}-input`);
          if (inputField) {
            inputField.focus();
          }
        }, 100);
      }
    });
    
    // Add keyboard support
    toggleButton.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleButton.click();
      }
    });
    
    document.body.appendChild(toggleButton);
  }

  // Create widget HTML
  function createWidgetHTML() {
    const container = document.getElementById(config.containerId);
    if (!container) {
      console.error(`Container element with ID "${config.containerId}" not found.`);
      return;
    }

    // Apply container styles
    container.style.fontFamily = config.theme.fontFamily;
    container.style.fontSize = config.theme.fontSize;
    container.style.borderRadius = config.theme.borderRadius;
    container.style.overflow = 'hidden';
    container.style.border = `1px solid ${config.theme.primaryColor}`;
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.height = '500px';
    container.style.maxWidth = '400px';
    container.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.1)';
    
    // Add ARIA role for the chat widget
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', 'Chat Assistant');

    // Create header
    const header = document.createElement('div');
    header.id = `${config.containerId}-header`;
    header.style.backgroundColor = config.theme.primaryColor;
    header.style.color = 'white';
    header.style.padding = '10px 15px';
    header.style.fontWeight = 'bold';
    header.textContent = 'Chat Assistant';
    header.setAttribute('role', 'heading');
    header.setAttribute('aria-level', '1');
    container.appendChild(header);

    // Create chat area
    const chatArea = document.createElement('div');
    chatArea.id = `${config.containerId}-chat-area`;
    chatArea.style.flex = '1';
    chatArea.style.overflowY = 'auto';
    chatArea.style.padding = '15px';
    chatArea.style.backgroundColor = 'white';
    chatArea.setAttribute('role', 'log');
    chatArea.setAttribute('aria-live', 'polite');
    chatArea.setAttribute('aria-atomic', 'false');
    container.appendChild(chatArea);

    // Create input area
    const inputArea = document.createElement('div');
    inputArea.style.display = 'flex';
    inputArea.style.borderTop = '1px solid #e0e0e0';
    inputArea.style.padding = '10px';
    inputArea.style.backgroundColor = config.theme.secondaryColor;
    inputArea.setAttribute('role', 'form');
    inputArea.setAttribute('aria-label', 'Chat message form');

    // Create input field
    const inputField = document.createElement('input');
    inputField.id = `${config.containerId}-input`;
    inputField.type = 'text';
    inputField.placeholder = config.placeholderText;
    inputField.style.flex = '1';
    inputField.style.padding = '8px 12px';
    inputField.style.border = '1px solid #ccc';
    inputField.style.borderRadius = '4px';
    inputField.style.marginRight = '8px';
    inputField.setAttribute('aria-label', 'Type your message');
    inputField.setAttribute('role', 'textbox');
    inputArea.appendChild(inputField);

    // Create send button
    const sendButton = document.createElement('button');
    sendButton.id = `${config.containerId}-send`;
    sendButton.textContent = 'Send';
    sendButton.style.backgroundColor = config.theme.primaryColor;
    sendButton.style.color = 'white';
    sendButton.style.border = 'none';
    sendButton.style.borderRadius = '4px';
    sendButton.style.padding = '8px 16px';
    sendButton.style.cursor = 'pointer';
    sendButton.setAttribute('aria-label', 'Send message');
    inputArea.appendChild(sendButton);

    container.appendChild(inputArea);
    
    // Add status announcer for screen readers
    const statusAnnouncer = document.createElement('div');
    statusAnnouncer.id = `${config.containerId}-status`;
    statusAnnouncer.style.position = 'absolute';
    statusAnnouncer.style.width = '1px';
    statusAnnouncer.style.height = '1px';
    statusAnnouncer.style.padding = '0';
    statusAnnouncer.style.margin = '-1px';
    statusAnnouncer.style.overflow = 'hidden';
    statusAnnouncer.style.clip = 'rect(0, 0, 0, 0)';
    statusAnnouncer.style.whiteSpace = 'nowrap';
    statusAnnouncer.style.border = '0';
    statusAnnouncer.setAttribute('role', 'status');
    statusAnnouncer.setAttribute('aria-live', 'polite');
    container.appendChild(statusAnnouncer);

    // Add CSS styles
    addStyles();
    
    // Add mobile toggle button if needed
    if (config.mobileToggle !== false) {
      addMobileToggle();
    }
  }

  // Add event listeners
  function addEventListeners() {
    const inputField = document.getElementById(`${config.containerId}-input`);
    const sendButton = document.getElementById(`${config.containerId}-send`);
    
    if (inputField && sendButton) {
      // Send message on button click
      sendButton.addEventListener('click', sendMessage);
      
      // Send message on Enter key press
      inputField.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          sendMessage();
        }
      });
      
      // Auto-resize input field (if needed)
      inputField.addEventListener('input', () => {
        // Could add auto-resize logic here if needed
      });
    }
  }

  // =============================================================================
  // WEBSOCKET FUNCTIONS
  // =============================================================================

  // Initialize WebSocket connection
  function initWebSocket() {
    if (!config.websocketUrl || config.websocketUrl === 'WEBSOCKET_URL_PLACEHOLDER') {
      console.warn('WebSocket URL not configured');
      return;
    }
    
    if (webSocket && (wsState === 'CONNECTING' || wsState === 'OPEN')) {
      return; // Already connected or connecting
    }
    
    try {
      wsState = 'CONNECTING';
      webSocket = new WebSocket(config.websocketUrl);
      
      // Set connection timeout
      connectionTimer = setTimeout(() => {
        if (wsState === 'CONNECTING') {
          console.warn('WebSocket connection timeout');
          webSocket.close();
        }
      }, config.websocket.connectionTimeout);
      
      webSocket.onopen = () => {
        console.log('WebSocket connected');
        wsState = 'OPEN';
        reconnectCount = 0;
        
        if (connectionTimer) {
          clearTimeout(connectionTimer);
          connectionTimer = null;
        }
        
        // Start heartbeat
        startHeartbeat();
        
        // Process any queued messages
        processMessageQueue();
      };
      
      webSocket.onmessage = (event) => {
        handleWebSocketMessage(event);
      };
      
      webSocket.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        wsState = 'CLOSED';
        
        if (connectionTimer) {
          clearTimeout(connectionTimer);
          connectionTimer = null;
        }
        
        stopHeartbeat();
        
        // Attempt to reconnect if not a clean close
        if (event.code !== 1000 && reconnectCount < config.websocket.reconnectAttempts) {
          scheduleReconnect();
        }
      };
      
      webSocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        wsState = 'CLOSED';
      };
      
    } catch (error) {
      console.error('Error initializing WebSocket:', error);
      wsState = 'CLOSED';
    }
  }

  // Handle WebSocket messages
  function handleWebSocketMessage(event) {
    try {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'start':
          // Response streaming started
          if (isStreaming) {
            console.warn('Already streaming a message, ignoring new stream');
            break;
          }
          isStreaming = true;
          hideTypingIndicator();
          currentStreamingMessage = addMessage('bot', '', false, true);
          break;
          
        case 'chunk':
          // Streaming chunk received
          if (currentStreamingMessage && data.text) {
            const currentText = currentStreamingMessage.textContent + data.text;
            updateMessage(currentStreamingMessage, currentText);
          }
          break;
          
        case 'end':
          // Response complete
          isStreaming = false;
          if (currentStreamingMessage) {
            currentStreamingMessage.classList.remove('chatbot-streaming');
            
            // Cache the complete response
            if (currentQuestion && currentStreamingMessage.textContent) {
              cacheResponse(currentQuestion, currentStreamingMessage.textContent);
            }
            
            // Add feedback and suggestions
            if (config.feedback) {
              const responseId = Date.now().toString();
              addFeedbackButtons(currentStreamingMessage, responseId);
            }
            
            if (config.suggestedQuestions) {
              addSuggestedQuestions(currentStreamingMessage, currentStreamingMessage.textContent);
            }
          }
          currentStreamingMessage = null;
          isWaitingForResponse = false;
          break;
          
        case 'error':
          hideTypingIndicator();
          isStreaming = false;
          
          // Handle standardized error format
          let errorMessage = 'Unknown error';
          if (data.error) {
            if (typeof data.error === 'string') {
              errorMessage = data.error;
            } else if (data.error.message) {
              errorMessage = data.error.message;
            }
            
            // Add details if available
            if (data.details) {
              if (Array.isArray(data.details)) {
                errorMessage += ': ' + data.details.join(', ');
              } else if (typeof data.details === 'string') {
                errorMessage += ': ' + data.details;
              }
            }
          }
          
          addMessage('bot', `Sorry, I encountered an error: ${errorMessage}`);
          isWaitingForResponse = false;
          break;
          
        case 'heartbeat':
          // Heartbeat response - no action needed
          break;
          
        default:
          console.warn('Unknown WebSocket message type:', data.type);
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  }

  // Start heartbeat to keep connection alive
  function startHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    
    heartbeatTimer = setInterval(() => {
      if (wsState === 'OPEN' && webSocket) {
        try {
          webSocket.send(JSON.stringify({ action: 'heartbeat' }));
        } catch (error) {
          console.error('Error sending heartbeat:', error);
          // Connection might be broken, let it handle reconnection
        }
      }
    }, config.websocket.heartbeatInterval);
  }

  // Stop heartbeat
  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  // Schedule WebSocket reconnection
  function scheduleReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    
    if (reconnectCount >= config.websocket.reconnectAttempts) {
      console.warn('Maximum reconnection attempts reached');
      return;
    }
    
    reconnectCount++;
    const delay = config.websocket.reconnectInterval * Math.pow(2, reconnectCount - 1);
    
    console.log(`Scheduling WebSocket reconnect attempt ${reconnectCount} in ${delay}ms`);
    
    reconnectTimer = setTimeout(() => {
      if (wsState === 'CLOSED') {
        initWebSocket();
      }
    }, delay);
  }

  // Process queued messages
  function processMessageQueue() {
    while (messageQueue.length > 0 && wsState === 'OPEN' && webSocket) {
      const message = messageQueue.shift();
      try {
        webSocket.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending queued message:', error);
        // Put the message back at the front of the queue
        messageQueue.unshift(message);
        break;
      }
    }
  }

  // =============================================================================
  // INITIALIZATION AND PUBLIC API
  // =============================================================================

  // Initialize the widget
  function init(userConfig = {}) {
    // Merge user config with defaults safely
    config = { ...DEFAULT_CONFIG, ...userConfig };
    config.theme = { ...DEFAULT_CONFIG.theme, ...(userConfig.theme || {}) };
    config.cache = { ...DEFAULT_CONFIG.cache, ...(userConfig.cache || {}) };
    config.websocket = { ...DEFAULT_CONFIG.websocket, ...(userConfig.websocket || {}) };
    config.accessibility = { ...DEFAULT_CONFIG.accessibility, ...(userConfig.accessibility || {}) };

    // Check browser support and adjust features accordingly
    checkBrowserSupport();

    // Initialize cache from localStorage if available
    initializeCache();

    // Create widget HTML
    createWidgetHTML();

    // Add event listeners
    addEventListeners();

    // Add welcome message
    addMessage('bot', config.welcomeMessage);

    // Initialize WebSocket if streaming is enabled
    if (config.streaming && config.websocketUrl && config.websocketUrl !== 'WEBSOCKET_URL_PLACEHOLDER') {
      initWebSocket();
    }
    
    // Announce to screen readers that the chat is ready
    announceToScreenReader('Chat assistant is ready');
  }

  // Get chat history
  function getHistory() {
    return [...chatHistory];
  }

  // Get connection state
  function getConnectionState() {
    return {
      websocket: wsState,
      streaming: config.streaming,
      connected: wsState === 'OPEN'
    };
  }

  // Set cache enabled/disabled
  function setCacheEnabled(enabled) {
    config.cache.enabled = enabled;
    if (!enabled) {
      clearCache();
    }
  }

  // Set streaming enabled/disabled
  function setStreamingEnabled(enabled) {
    config.streaming = enabled;
    
    if (enabled && !webSocket && config.websocketUrl !== 'WEBSOCKET_URL_PLACEHOLDER') {
      initWebSocket();
    } else if (!enabled && webSocket) {
      webSocket.close();
      webSocket = null;
      wsState = 'CLOSED';
    }
  }

  // Manually reconnect WebSocket
  function reconnectWebSocket() {
    if (webSocket) {
      webSocket.close();
    }
    
    wsState = 'CLOSED';
    reconnectCount = 0;
    
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    
    initWebSocket();
  }

  // Cleanup function
  function cleanup() {
    // Close WebSocket connection
    if (webSocket) {
      wsState = 'CLOSING';
      webSocket.close(1000, 'Page unloading'); // Clean close
      webSocket = null;
    }
    
    // Clear all timers
    if (connectionTimer) {
      clearTimeout(connectionTimer);
      connectionTimer = null;
    }
    
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    
    stopHeartbeat();
    
    // Reset state
    wsState = 'CLOSED';
    isWaitingForResponse = false;
    isStreaming = false;
    currentStreamingMessage = null;
    messageQueue = [];
    reconnectCount = 0;
  }

  // Public API
  window.SmallBizChatbot = {
    init: init,
    getHistory: getHistory,
    clearCache: clearCache,
    setCacheEnabled: setCacheEnabled,
    setStreamingEnabled: setStreamingEnabled,
    getConnectionState: getConnectionState,
    reconnectWebSocket: reconnectWebSocket,
    cleanup: cleanup
  };

  // Cleanup on page unload
  window.addEventListener('beforeunload', cleanup);

})();
