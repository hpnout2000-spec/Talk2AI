/* ════════════════════════════════════════════════════════════════════
   Helpers — Utility functions
   ════════════════════════════════════════════════════════════════════ */

import { settingsStore } from '../services/settings-store.js';

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
  html = html.replace(/&quot;(.*?)&quot;/g, '<span class="text-quotes">"$1"</span>');

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

  // Extract code blocks (pre-formatted HTML) to protect them from parsing
  const codeBlocks = [];
  html = html.replace(/<pre>[\s\S]*?<\/pre>/g, (match) => {
    const placeholder = `__CODE_BLOCK_PLACEHOLDER_${codeBlocks.length}__`;
    codeBlocks.push(match);
    return placeholder;
  });

  // Headings (### ...)
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');

  // Horizontal rules (***)
  html = html.replace(/^\s*(?:\*\s*){3,}$/gm, '<hr>');

  // Blockquotes (> ...)
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Table parser
  const lines = html.split('\n');
  const resultLines = [];
  let inTable = false;
  let alignments = [];

  const tableRowRegex = /^\|(.+)\|$/;
  const tableDelimiterRegex = /^\|\s*(?:\s*:?-+:?\s*\|)+\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!inTable) {
      const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
      if (tableRowRegex.test(line) && tableDelimiterRegex.test(nextLine)) {
        inTable = true;
        const delims = nextLine.split('|').map(s => s.trim()).filter((s, idx, arr) => idx > 0 && idx < arr.length - 1);
        alignments = delims.map(d => {
          if (d.startsWith(':') && d.endsWith(':')) return 'center';
          if (d.endsWith(':')) return 'right';
          return 'left';
        });

        const headers = line.split('|').map(s => s.trim()).filter((s, idx, arr) => idx > 0 && idx < arr.length - 1);
        let headerHtml = '<table><thead><tr>';
        for (let colIdx = 0; colIdx < headers.length; colIdx++) {
          const align = alignments[colIdx] || 'left';
          headerHtml += `<th style="text-align:${align}">${headers[colIdx]}</th>`;
        }
        headerHtml += '</tr></thead><tbody>';
        resultLines.push(headerHtml);
        i++;
      } else {
        resultLines.push(lines[i]);
      }
    } else {
      if (tableRowRegex.test(line)) {
        const cells = line.split('|').map(s => s.trim()).filter((s, idx, arr) => idx > 0 && idx < arr.length - 1);
        let rowHtml = '<tr>';
        for (let colIdx = 0; colIdx < cells.length; colIdx++) {
          const align = alignments[colIdx] || 'left';
          rowHtml += `<td style="text-align:${align}">${cells[colIdx]}</td>`;
        }
        rowHtml += '</tr>';
        resultLines.push(rowHtml);
      } else {
        inTable = false;
        resultLines.push('</tbody></table>');
        resultLines.push(lines[i]);
      }
    }
  }

  if (inTable) {
    resultLines.push('</tbody></table>');
  }

  html = resultLines.join('\n');

  // Multi-level list parser (unordered and ordered lists)
  const listLines = html.split('\n');
  const resultListLines = [];
  const listStack = []; // stores { indent: number, type: 'ul' | 'ol' }
  const listItemRegex = /^(\s*)([-*+]|(?:\d+\.))\s+(.*)$/;

  for (let i = 0; i < listLines.length; i++) {
    const line = listLines[i];
    const match = line.match(listItemRegex);
    
    if (match) {
      const indentStr = match[1];
      const marker = match[2];
      const content = match[3];
      
      // Calculate indent level (count spaces, treat tab as 4 spaces)
      let indent = 0;
      for (let char of indentStr) {
        if (char === '\t') indent += 4;
        else if (char === ' ') indent += 1;
      }
      
      const type = (marker === '-' || marker === '*' || marker === '+') ? 'ul' : 'ol';
      const startNum = type === 'ol' ? parseInt(marker, 10) : null;
      const startAttr = (type === 'ol' && !isNaN(startNum) && startNum !== 1) ? ` start="${startNum}"` : '';
      
      if (listStack.length === 0) {
        listStack.push({ indent, type });
        resultListLines.push(`<${type}${startAttr}><li>${content}`);
      } else {
        let top = listStack[listStack.length - 1];
        if (indent > top.indent) {
          listStack.push({ indent, type });
          resultListLines.push(`<${type}${startAttr}><li>${content}`);
        } else if (indent < top.indent) {
          while (listStack.length > 0 && listStack[listStack.length - 1].indent > indent) {
            const closed = listStack.pop();
            resultListLines.push(`</li></${closed.type}>`);
          }
          
          if (listStack.length === 0) {
            listStack.push({ indent, type });
            resultListLines.push(`<${type}${startAttr}><li>${content}`);
          } else {
            top = listStack[listStack.length - 1];
            if (top.type !== type) {
              listStack.pop();
              resultListLines.push(`</li></${top.type}><${type}${startAttr}><li>${content}`);
              listStack.push({ indent, type });
            } else {
              resultListLines.push(`</li><li>${content}`);
            }
          }
        } else {
          if (top.type !== type) {
            listStack.pop();
            resultListLines.push(`</li></${top.type}><${type}${startAttr}><li>${content}`);
            listStack.push({ indent, type });
          } else {
            resultListLines.push(`</li><li>${content}`);
          }
        }
      }
    } else {
      let shouldClose = true;
      if (line.trim() === '') {
        let nextNonEmpty = null;
        for (let j = i + 1; j < listLines.length; j++) {
          if (listLines[j].trim() !== '') {
            nextNonEmpty = listLines[j];
            break;
          }
        }
        if (nextNonEmpty && listItemRegex.test(nextNonEmpty)) {
          shouldClose = false;
        }
      }

      if (shouldClose) {
        while (listStack.length > 0) {
          const closed = listStack.pop();
          resultListLines.push(`</li></${closed.type}>`);
        }
      }
      resultListLines.push(line);
    }
  }
  
  while (listStack.length > 0) {
    const closed = listStack.pop();
    resultListLines.push(`</li></${closed.type}>`);
  }
  
  html = resultListLines.join('\n');

  // Inline code (`...`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold (**...**)
  html = html.replace(/\*\*(.+?)\*\*/g, '<span class="text-asterisks">$1</span>');

  // Italic (*...*)
  html = html.replace(/\*(.+?)\*/g, '<span class="text-asterisks">$1</span>');

  // Group lines into paragraphs and block elements
  const processedLines = html.split('\n');
  const finalBlocks = [];
  let inParagraph = false;
  let currentParagraph = [];

  const blockTags = /^(?:<table|<thead|<tbody|<tr|<th|<td|<\/table|<\/thead>|<\/tbody>|<\/tr>|<\/th>|<\/td>|<pre|<code|<\/pre>|<\/code>|<ul|<ol|<li|<\/ul>|<\/ol>|<\/li>|<blockquote>|<\/blockquote>|<h3>|<hr)/;

  for (let i = 0; i < processedLines.length; i++) {
    const line = processedLines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      if (inParagraph) {
        finalBlocks.push(`<p>${currentParagraph.join('<br>')}</p>`);
        currentParagraph = [];
        inParagraph = false;
      }
    } else if (blockTags.test(trimmed) || trimmed.startsWith('__CODE_BLOCK_PLACEHOLDER_')) {
      if (inParagraph) {
        finalBlocks.push(`<p>${currentParagraph.join('<br>')}</p>`);
        currentParagraph = [];
        inParagraph = false;
      }
      finalBlocks.push(line);
    } else {
      if (!inParagraph) {
        inParagraph = true;
      }
      currentParagraph.push(line);
    }
  }

  if (inParagraph) {
    finalBlocks.push(`<p>${currentParagraph.join('<br>')}</p>`);
  }

  html = finalBlocks.join('\n');

  // Clean up all newlines inside and around list/table tags to keep them compact
  html = html.replace(/(<\/?(?:ul|ol|li|table|thead|tbody|tr|th|td)>)\n+/g, '$1');
  html = html.replace(/\n+(<\/?(?:ul|ol|li|table|thead|tbody|tr|th|td)>)/g, '$1');

  // Restore code blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    html = html.split(`__CODE_BLOCK_PLACEHOLDER_${i}__`).join(codeBlocks[i]);
  }

  return html;
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Parse thinking blocks from response
 * Returns { thinking: string|null, content: string }
 */
export function parseThinking(text) {
  if (typeof text !== 'string') return { thinking: null, content: '' };
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
 * Extract clean snippets/short phrases from streaming thinking text
 */
export function extractThinkingSnippets(text) {
  if (typeof text !== 'string' || !text) return [];
  
  let cleanText = text
    .replace(/(?:<\|?think\|?>|<reasoning>|<thought>)/gi, '')
    .replace(/(?:<\|?\/think\|?>|<\/thought>|<\/reasoning>)/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/[*#_\[\]\(\)]/g, ' ')
    .replace(/\s+/g, ' ');
    
  const parts = cleanText.split(/[.,!?;\n:]+/);
  
  const snippets = [];
  for (let part of parts) {
    part = part.trim();
    if (part.length >= 8 && part.split(/\s+/).length >= 2) {
      let formatted = part.charAt(0).toUpperCase() + part.slice(1);
      // Truncate if too long to keep the UI clean
      if (formatted.length > 90) {
        // Find last space before 85 chars to not break words
        let spaceIdx = formatted.lastIndexOf(' ', 85);
        if (spaceIdx === -1) spaceIdx = 85;
        formatted = formatted.substring(0, spaceIdx) + '...';
      } else if (!formatted.endsWith('...')) {
        formatted += '...';
      }
      snippets.push(formatted);
    }
  }
  
  return snippets;
}

/**
 * Parse thinking block progress during streaming
 */
export function parseStreamThinking(text) {
  if (typeof text !== 'string') return { thinking: '', content: '', isInThinking: false };
  const startMatch = text.match(/<think>|<reasoning>|<thought>/);
  if (!startMatch) {
    return { thinking: '', content: text, isInThinking: false };
  }

  const startIdx = startMatch.index;
  const thinkStart = startMatch[0];
  const afterStart = startIdx + thinkStart.length;

  const endMatch = text.substring(afterStart).match(/<channel\|>|<\|?\/think\|?>|<\/thought>|<\/reasoning>/);

  if (!endMatch) {
    const thinking = text.substring(afterStart);
    const content = text.substring(0, startIdx);
    return { thinking, content, isInThinking: true };
  } else {
    const endIdx = afterStart + endMatch.index;
    const thinkEnd = endMatch[0];
    const thinking = text.substring(afterStart, endIdx);
    const content = text.substring(0, startIdx) + text.substring(endIdx + thinkEnd.length);
    return { thinking, content: content.trim(), isInThinking: false };
  }
}

/**
 * Generate thinking block HTML structure
 */
export function createThinkingBlockHTML(thinkingText, isActive) {
  if (isActive) {
    const escapedThoughts = escapeHtml(thinkingText || '');
    return `<div class="thinking-inline thinking-inline-active"><div class="thinking-inline-header"><thinking-snippets id="genai-thinking-snippets" thoughts="${escapedThoughts}"></thinking-snippets></div></div>`;
  }
  return '<div class="thinking-inline"><div class="thinking-inline-header thinking-toggle-header" onclick="this.closest(\'.thinking-inline\').classList.toggle(\'thinking-expanded\')"><span class="thinking-done-text">Done</span><span class="thinking-chevron"> ▸</span></div><div class="thinking-inline-content">' + escapeHtml(thinkingText) + '</div></div>';
}

/**
 * ThinkingSnippets Custom Element representing dynamic snippets from thinking stream
 */
class ThinkingSnippets extends HTMLElement {
  constructor() {
    super();
    this.intervalId = null;
    this.currentIndex = -1;
    this.extractedSnippets = [];
    this.placeholderPhrases = [];
  }

  static get observedAttributes() {
    return ['thoughts'];
  }

  connectedCallback() {
    this.placeholderPhrases = [];
    this.lastTransitionTime = 0;

    // Setup CSS Grid container for overlapping layers
    this.style.display = 'inline-grid';
    this.style.gridTemplateAreas = '"overlap"';
    this.style.alignItems = 'center';

    const initialThoughts = this.getAttribute('thoughts') || '';
    this.accumulateThoughts(initialThoughts);

    if (this.extractedSnippets.length > 0) {
      this.currentIndex = Math.floor(Math.random() * this.extractedSnippets.length);
      this.innerHTML = `<span class="thinking-snippet-layer" style="grid-area: overlap;">${this.extractedSnippets[this.currentIndex]}</span>`;
    } else {
      // Start with a static placeholder. It will be smoothly swept away when the first real snippet arrives.
      this.innerHTML = `<span class="thinking-snippet-layer" style="grid-area: overlap;">Working...</span>`;
    }
    
    this.intervalId = setInterval(() => {
      const activeList = this.extractedSnippets.length > 0 ? this.extractedSnippets : this.placeholderPhrases;
      if (activeList.length === 0) return;
      
      let nextIndex;
      if (activeList.length === 1) {
        nextIndex = 0;
      } else {
        do {
          nextIndex = Math.floor(Math.random() * activeList.length);
        } while (nextIndex === this.currentIndex);
      }
      
      this.currentIndex = nextIndex;
      this.transitionToSnippet(activeList[this.currentIndex]);
    }, 4000);

    this.adjustBubbleWidth();
  }


  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'thoughts' && newValue !== oldValue) {
      this.accumulateThoughts(newValue);
    }
  }

  accumulateThoughts(thoughtsText) {
    if (!thoughtsText) return;
    const hadRealThoughts = this.extractedSnippets.length > 0;
    const newSnippets = extractThinkingSnippets(thoughtsText);
    
    let addedNew = false;
    for (const snip of newSnippets) {
      if (!this.extractedSnippets.includes(snip)) {
        this.extractedSnippets.push(snip);
        addedNew = true;
      }
    }

    if (this.extractedSnippets.length > 0) {
      if (!hadRealThoughts) {
        this.currentIndex = 0;
        this.transitionToSnippet(this.extractedSnippets[0]);
      } else if (addedNew) {
        const latestIdx = this.extractedSnippets.length - 1;
        this.currentIndex = latestIdx;
        this.transitionToSnippet(this.extractedSnippets[latestIdx]);
      }
    }
  }

  adjustBubbleWidth() {
    const run = (retry) => {
      const bubble = this.closest('.genai-msg-bubble');
      if (!bubble || !bubble.classList.contains('thinking-only')) return;

      const activeLayer = this.querySelector('.thinking-snippet-layer:not(.layer-leaving)');
      if (!activeLayer) return;

      // offsetWidth is more reliable than getBoundingClientRect inside inline-grid
      const layerWidth = activeLayer.offsetWidth;
      if (layerWidth === 0) {
        if (retry < 3) requestAnimationFrame(() => run(retry + 1));
        return;
      }

      const style = window.getComputedStyle(bubble);
      const padH = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const borderH = (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
      const targetWidth = layerWidth + padH + borderH + 2; // +2 for subpixel safety

      const leavingLayer = this.querySelector('.thinking-snippet-layer.layer-leaving');
      if (leavingLayer) {
        // During transition: only grow, never shrink — leaving text is still visible
        const current = parseFloat(bubble.style.width) || 0;
        if (targetWidth > current) bubble.style.width = targetWidth + 'px';
      } else {
        bubble.style.width = targetWidth + 'px';
      }
    };
    requestAnimationFrame(() => run(0));
  }

  transitionToSnippet(text) {
    const now = Date.now();
    // Throttle transitions to ensure they don't happen faster than every 3 seconds
    if (now - this.lastTransitionTime < 3000) return;
    
    const currentLayer = this.querySelector('.thinking-snippet-layer:not(.layer-leaving)');
    if (currentLayer && currentLayer.textContent === text) return;
    
    this.lastTransitionTime = now;
    
    // Create new layer
    const newLayer = document.createElement('span');
    newLayer.className = 'thinking-snippet-layer layer-entering';
    newLayer.style.gridArea = 'overlap';
    newLayer.textContent = text;
    
    this.appendChild(newLayer);
    
    if (currentLayer) {
      currentLayer.classList.add('layer-leaving');
      currentLayer.classList.remove('layer-entering');
      
      // Remove old layer after animation completes, then re-settle bubble width
      setTimeout(() => {
        if (currentLayer.parentNode === this) {
          this.removeChild(currentLayer);
        }
        // Re-run width adjustment now that the leaving layer is gone (allows shrinking)
        this.adjustBubbleWidth();
      }, 800);
    }

    this.adjustBubbleWidth();
  }

  disconnectedCallback() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }
}

if (!customElements.get('thinking-snippets')) {
  customElements.define('thinking-snippets', ThinkingSnippets);
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
