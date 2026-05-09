(function () {
  const targets = [
    {
      name: 'Format Flow Test AI',
      icon: 'T',
      domains: ['127.0.0.1', 'localhost'],
      pathPrefixes: ['/extension-test-ai'],
      selectors: ['#test-ai-input', 'textarea', '[contenteditable="true"]'],
      sendSelectors: ['#test-ai-send'],
      outputSelectors: ['#test-ai-output']
    },
    {
      name: 'ChatGPT',
      icon: '◎',
      domains: ['chatgpt.com', 'chat.openai.com'],
      selectors: [
        '#prompt-textarea',
        '[data-testid="composer-text-input"]',
        'textarea[data-id="root"]',
        'textarea',
        '[contenteditable="true"]'
      ],
      sendSelectors: [
        '[data-testid="send-button"]',
        'button[data-testid="send-button"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="发送"]',
        'button[type="submit"]'
      ],
      outputSelectors: [
        '[data-message-author-role="assistant"]',
        '[data-testid^="conversation-turn-"] .markdown',
        '.markdown'
      ]
    },
    {
      name: 'Claude',
      icon: '✦',
      domains: ['claude.ai'],
      selectors: [
        '[contenteditable="true"]',
        'div.ProseMirror',
        'textarea',
        '[data-testid="chat-input"]'
      ],
      sendSelectors: [
        'button[aria-label*="Send"]',
        'button[aria-label*="发送"]',
        '[data-testid="send-button"]',
        'button[type="submit"]'
      ],
      outputSelectors: [
        '[data-testid="assistant-message"]',
        '.font-claude-message',
        '.prose'
      ]
    },
    {
      name: 'Gemini',
      icon: '✧',
      domains: ['gemini.google.com'],
      selectors: [
        'rich-textarea div[contenteditable="true"]',
        '[contenteditable="true"]',
        'textarea'
      ],
      sendSelectors: [
        'button[aria-label*="Send"]',
        'button[aria-label*="发送"]',
        'button.send-button',
        'button:has(mat-icon[data-mat-icon-name="send"])',
        'button:has(mat-icon[fonticon="send"])',
        'button[type="submit"]'
      ],
      outputSelectors: [
        'message-content',
        '.model-response-text',
        '.markdown'
      ]
    },
    {
      name: 'DeepSeek',
      icon: '深',
      domains: ['chat.deepseek.com'],
      selectors: ['textarea', '[contenteditable="true"]'],
      sendSelectors: [
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        '[role="button"][aria-label*="发送"]',
        '[role="button"][aria-label*="Send"]',
        'button[type="submit"]'
      ],
      outputSelectors: ['.ds-markdown', '.markdown', '[class*="markdown"]']
    },
    {
      name: 'Kimi',
      icon: 'K',
      domains: ['kimi.moonshot.cn'],
      selectors: ['textarea', '[contenteditable="true"]'],
      sendSelectors: ['button[aria-label*="发送"]', 'button[aria-label*="Send"]', 'button[type="submit"]'],
      outputSelectors: ['.markdown', '[class*="markdown"]', '[class*="assistant"]']
    },
    {
      name: 'Qwen',
      icon: 'Q',
      domains: ['chat.qwen.ai'],
      selectors: ['textarea', '[contenteditable="true"]'],
      sendSelectors: ['button[aria-label*="发送"]', 'button[aria-label*="Send"]', 'button[type="submit"]'],
      outputSelectors: ['.markdown', '[class*="markdown"]', '[class*="assistant"]']
    },
    {
      name: 'Perplexity',
      icon: 'P',
      domains: ['www.perplexity.ai'],
      selectors: ['textarea', '[contenteditable="true"]'],
      sendSelectors: ['button[aria-label*="Submit"]', 'button[aria-label*="Send"]', 'button[aria-label*="发送"]', 'button[type="submit"]'],
      outputSelectors: ['.prose', '.markdown', '[class*="answer"]']
    },
    {
      name: 'Poe',
      icon: 'Poe',
      domains: ['poe.com'],
      selectors: ['textarea', '[contenteditable="true"]'],
      sendSelectors: ['button[aria-label*="Send"]', 'button[aria-label*="发送"]', 'button[type="submit"]'],
      outputSelectors: ['.Markdown_markdownContainer__Tz3HQ', '.markdown', '[class*="Message"]']
    },
    {
      name: 'Grok',
      icon: 'G',
      domains: ['grok.com'],
      selectors: ['textarea', '[contenteditable="true"]'],
      sendSelectors: ['button[aria-label*="Submit"]', 'button[aria-label*="Send"]', 'button[aria-label*="发送"]', 'button[type="submit"]'],
      outputSelectors: ['.markdown', '[class*="markdown"]', '[class*="response"]']
    }
  ]

  globalThis.FORMAT_FLOW_AI_TARGETS = targets
})()
