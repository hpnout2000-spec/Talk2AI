/* ════════════════════════════════════════════════════════════════════
   Helpers — Utility functions
   ════════════════════════════════════════════════════════════════════ */

/**
 * Generate a random UUID-like ID
 */
export function generateId() {
  return 'xxxx-xxxx-xxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
}

/**
 * Format a date string to a friendly format
 */
export function formatTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Simple Markdown to HTML converter
 * Handles: bold, italic, code blocks, inline code, links, lists, blockquotes
 */
export function renderMarkdown(text) {
  if (!text) return '';

  let html = escapeHtml(text);

  // Quotes ("...") - Must be first to avoid matching quotes in HTML tags
  html = html.replace(/"([^"]+)"/g, '<span class="text-quotes">"$1"</span>');

  // Code blocks (```...```)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
  });

  // Inline code (`...`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold (**...**)
  html = html.replace(/\*\*(.+?)\*\*/g, '<span class="text-asterisks">$1</span>');

  // Italic (*...*)
  html = html.replace(/\*(.+?)\*/g, '<span class="text-asterisks">$1</span>');

  // Blockquotes (> ...)
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered lists (- ...)
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Paragraphs (double newline)
  html = html.replace(/\n\n/g, '</p><p>');
  
  // Single newlines to <br>
  html = html.replace(/\n/g, '<br>');

  // Wrap in paragraph if not already wrapped
  if (!html.startsWith('<')) {
    html = `<p>${html}</p>`;
  }

  return html;
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Parse thinking blocks from response
 * Returns { thinking: string|null, content: string }
 */
export function parseThinking(text) {
  const thinkRegex = /(?:<\|?think\|?>|<reasoning>)([\s\S]*?)(?:<\|?\/think\|?>|<\/reasoning>)/;
  const match = text.match(thinkRegex);

  if (match) {
    const thinking = match[1] ? match[1].trim() : '';
    const content = text.replace(thinkRegex, '').trim();
    return { thinking, content };
  }

  return { thinking: null, content: text };
}

/**
 * Auto-resize a textarea to fit content
 */
export function autoResizeTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
}

/**
 * Debounce a function
 */
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Read file as base64 data URL
 */
export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Wraps words in text nodes with span.word-blur for streaming animations
 */
export function wrapWordsInSpans(htmlString) {
  if (!htmlString) return '';
  const div = document.createElement('div');
  div.innerHTML = htmlString;
  
  const walk = document.createTreeWalker(div, NodeFilter.SHOW_TEXT, null, false);
  const nodesToReplace = [];
  let node;
  while((node = walk.nextNode())) {
    // Skip if parent is code or pre to avoid breaking code blocks
    const parentName = node.parentNode?.nodeName;
    if (parentName === 'CODE' || parentName === 'PRE') continue;
    if (node.textContent.trim() === '') continue;
    nodesToReplace.push(node);
  }
  
  let wordIndex = 0;
  for (const n of nodesToReplace) {
    // Split by whitespace but keep the whitespace
    const words = n.textContent.split(/(\s+)/);
    const fragment = document.createDocumentFragment();
    for (const w of words) {
      if (w.trim() === '') {
        fragment.appendChild(document.createTextNode(w));
      } else {
        const span = document.createElement('span');
        span.className = 'word-blur';
        span.dataset.wordIndex = wordIndex++;
        span.textContent = w;
        fragment.appendChild(span);
      }
    }
    n.parentNode.replaceChild(fragment, n);
  }
  
  return div.innerHTML;
}
