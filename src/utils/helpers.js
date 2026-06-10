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

  // Custom Image syntax: ![alt](url)
  html = html.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, url) => {
    const cleanUrl = url.replace(/&amp;/g, '&');
    const cleanAlt = alt.replace(/<[^>]+>/g, '').replace(/"/g, '&quot;');
    
    const isNhentai = /nhentai\.net/.test(cleanUrl);
    if (isNhentai) {
      return `<div class="generated-image-container nhentai-image-container" style="margin-top: 12px; animation: fadeIn 0.4s ease; min-height: 100px; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.15); border-radius: var(--radius-md);">
        <div class="chat-image-loader genai-image-loader-spinner" style="display: flex; align-items: center; gap: 8px;">
          <div class="genai-working-dots" style="display:flex; gap:3px;"><span></span><span></span><span></span></div>
          <span class="genai-working-text" style="font-size: var(--text-xs); font-style: italic; margin-left: 4px; color: var(--text-secondary);">Loading gallery image...</span>
        </div>
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-nhentai-src="${cleanUrl}" alt="${cleanAlt}" style="display: none; max-width: 360px; width: 100%; height: auto; border-radius: var(--radius-md); box-shadow: var(--shadow-md); border: 1px solid var(--border-light); cursor: pointer;" onclick="if(window.openLightbox){window.openLightbox(this.src)}else{window.open(this.src,'_blank')}" onload="if(!this.dataset.loaded){ this.dataset.loaded='1'; if(window.loadNhentaiImage){ window.loadNhentaiImage(this); } }">
      </div>`;
    }

    return `<div class="generated-image-container" style="margin-top: 12px; animation: fadeIn 0.4s ease;"><img src="${cleanUrl}" alt="${cleanAlt}" style="max-width: 360px; width: 100%; height: auto; border-radius: var(--radius-md); box-shadow: var(--shadow-md); display: block; border: 1px solid var(--border-light); cursor: pointer;" onclick="if(window.openLightbox){window.openLightbox(this.src)}else{window.open(this.src,'_blank')}" onload="if(window.scrollToBottom){window.scrollToBottom()}"></div>`;
  });

  // Custom Image Loader syntax: [[loader:status1|status2|...]]
  html = html.replace(/\[\[loader:(.*?)\]\]/g, (match, statusStr) => {
    const statuses = statusStr.split('|').map(s => s.trim()).filter(Boolean);
    let loaderHeaderHtml = '';
    
    if (statuses.length === 1) {
      loaderHeaderHtml = `<div style="display: flex; align-items: center; gap: 8px;">
        <div class="genai-working-dots" style="display:flex; gap:3px;"><span></span><span></span><span></span></div>
        <span class="genai-working-text" style="font-size: var(--text-xs); font-style: italic; margin-left: 4px;">${statuses[0]}</span>
      </div>`;
    } else {
      // Multi-status loader
      const spans = statuses.map((s, i) => `<span class="chat-image-loader-status ${i === 0 ? 'active' : ''}">${s}</span>`).join('');
      loaderHeaderHtml = `<div class="multi-status-loader" data-statuses-count="${statuses.length}" style="display: flex; align-items: center; gap: 8px;">
        <div class="genai-working-dots" style="display:flex; gap:3px;"><span></span><span></span><span></span></div>
        <div class="chat-image-loader-statuses" style="margin-left: 4px;">
          ${spans}
        </div>
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" onload="if(!this.dataset.inited && window.initStatusRotation){this.dataset.inited='1'; window.initStatusRotation(this.parentElement);}" style="display:none;">
      </div>`;
    }

    return `<div class="chat-image-loader" style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px; animation: fadeIn 0.3s ease;">
      ${loaderHeaderHtml}
      <div class="live-preview-container hidden" style="position: relative; max-width: 360px; width: 100%; border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--border-light); background: rgba(0,0,0,0.15);">
        <img class="live-preview-img" style="width: 100%; height: auto; filter: blur(8px); transition: filter 1s ease, transform 0.5s ease; display: block;">
      </div>
    </div>`;
  });

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
  // Matches: <|channel>thought...</channel|>  OR  <thought>...</thought>
  // AND legacy: <think>...</think>  <|think|>...</|think|>  <reasoning>...</reasoning>
  const thinkRegex = /(?:<\|channel>thought|<\|?think\|?>|<thought>|<reasoning>)([\s\S]*?)(?:<channel\|>|<\|?\/think\|?>|<\/thought>|<\/reasoning>)/;
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

  // Split by tags: <...> vs everything else
  const parts = htmlString.split(/(<[^>]+>)/g);
  let wordIndex = 0;
  let inSkipTag = false;

  const processedParts = parts.map(part => {
    if (part.startsWith('<')) {
      const lower = part.toLowerCase();
      // Handle skip tags (pre, code)
      if (lower.startsWith('<pre') || lower.startsWith('<code')) inSkipTag = true;
      if (lower.startsWith('</pre') || lower.startsWith('</code')) inSkipTag = false;
      return part;
    }

    // If inside a tag that shouldn't have words wrapped, or it's just whitespace
    if (inSkipTag || !part.trim()) return part;

    // Split into words and whitespace, then wrap words in spans
    return part.split(/(\s+)/).map(w => {
      if (!w || w.trim() === '') return w;
      return `<span class="word-blur" data-word-index="${wordIndex++}">${w}</span>`;
    }).join('');
  });

  return processedParts.join('');
}

/**
 * Injects a streaming cursor span safely before the last closing HTML tag
 */
export function injectCursor(html) {
  const cursorHtml = '<span class="streaming-cursor"></span>';
  if (html.includes('</')) {
    // Replaces the continuous sequence of closing tags at the very end of the string.
    // The cursor is inserted BEFORE all these closing tags.
    return html.replace(/(<\/[a-z0-9]+>\s*)+$/i, (match) => cursorHtml + match);
  }
  return html + cursorHtml;
}
