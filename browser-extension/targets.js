(function () {
  const targets = [
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
      outputSelectors: ['.ds-markdown', '.markdown', '[class*="markdown"]']
    },
    {
      name: 'Kimi',
      icon: 'K',
      domains: ['kimi.moonshot.cn'],
      selectors: ['textarea', '[contenteditable="true"]'],
      outputSelectors: ['.markdown', '[class*="markdown"]', '[class*="assistant"]']
    },
    {
      name: 'Qwen',
      icon: 'Q',
      domains: ['chat.qwen.ai'],
      selectors: ['textarea', '[contenteditable="true"]'],
      outputSelectors: ['.markdown', '[class*="markdown"]', '[class*="assistant"]']
    },
    {
      name: 'Perplexity',
      icon: 'P',
      domains: ['www.perplexity.ai'],
      selectors: ['textarea', '[contenteditable="true"]'],
      outputSelectors: ['.prose', '.markdown', '[class*="answer"]']
    },
    {
      name: 'Poe',
      icon: 'Poe',
      domains: ['poe.com'],
      selectors: ['textarea', '[contenteditable="true"]'],
      outputSelectors: ['.Markdown_markdownContainer__Tz3HQ', '.markdown', '[class*="Message"]']
    },
    {
      name: 'Grok',
      icon: 'G',
      domains: ['grok.com'],
      selectors: ['textarea', '[contenteditable="true"]'],
      outputSelectors: ['.markdown', '[class*="markdown"]', '[class*="response"]']
    }
  ]

  globalThis.FORMAT_FLOW_AI_TARGETS = targets
})()
