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

  // Normalize smart/typographical double quotes (curly, guillemets, low-9) to standard double quotes
  html = html.replace(/[“”«»„]/g, '&quot;');

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

  // Extract inline code blocks to protect them from parsing
  const inlineCodeBlocks = [];
  html = html.replace(/`([^`]+)`/g, (match, code) => {
    const placeholder = `__INLINE_CODE_PLACEHOLDER_${inlineCodeBlocks.length}__`;
    inlineCodeBlocks.push(`<code>${code}</code>`);
    return placeholder;
  });

  // Headings (#, ##, ###, ####, #####, ######)
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

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

  // Standard Markdown links: [text](url)
  // We use a regex that supports balanced parentheses in the URL: ([^)]*?(?:\([^)]*?\)[^)]*?)*)
  const linkUrls = [];
  html = html.replace(/\[(.*?)\]\(([^)]*?(?:\([^)]*?\)[^)]*?)*)\)/g, (match, text, url) => {
    let targetUrl = url.trim();
    // Support titles in quotes, including quotes already replaced by quotes span helper
    const titleMatch = targetUrl.match(/^([^\s]+)\s+(?:<span class="text-quotes">"([^"]*)"<\/span>|'([^']*)')$/);
    let titleAttr = '';
    if (titleMatch) {
      targetUrl = titleMatch[1];
      const title = titleMatch[2] || titleMatch[3] || '';
      titleAttr = ` title="${escapeHtml(title)}"`;
    }
    let cleanUrl = targetUrl.replace(/&amp;/g, '&');
    if (/^\s*javascript:/i.test(cleanUrl)) {
      cleanUrl = '#';
    }
    const urlPlaceholder = `__LINK_URL_PLACEHOLDER_${linkUrls.length}__`;
    linkUrls.push(cleanUrl);
    return `<a href="${urlPlaceholder}" target="_blank"${titleAttr}>${text}</a>`;
  });

  // Raw URLs formatting (converting to 🌐 hostname links)
  html = html.replace(/(<[^>]+>)|(https?:\/\/[^\s<]+)/gi, (match, tag, url) => {
    if (tag) return tag;
    const urlMatch = url.match(/^(.*?)([.,;!?')]*)$/);
    const cleanUrl = urlMatch[1];
    const trailing = urlMatch[2];
    try {
      const urlObj = new URL(cleanUrl.replace(/&amp;/g, '&'));
      const siteName = urlObj.hostname.replace(/^www\./i, '');
      const urlPlaceholder = `__LINK_URL_PLACEHOLDER_${linkUrls.length}__`;
      linkUrls.push(cleanUrl.replace(/&amp;/g, '&'));
      return `<a href="${urlPlaceholder}" target="_blank">${siteName}</a>${trailing}`;
    } catch (e) {
      return match;
    }
  });

  // Bold and Italic parsing using custom flanking rules (CommonMark compliant)
  html = (() => {
    const chars = [];
    let i = 0;
    while (i < html.length) {
      if (html[i] === '<') {
        const closeIdx = html.indexOf('>', i);
        if (closeIdx !== -1) {
          i = closeIdx + 1;
          continue;
        }
      }
      if (html.startsWith('__', i)) {
        const match = html.substring(i).match(/^__[A-Z0-9_]+_PLACEHOLDER_\d+__/);
        if (match) {
          i += match[0].length;
          continue;
        }
      }
      chars.push({ char: html[i], index: i });
      i++;
    }

    const delimiters = [];
    let j = 0;
    while (j < chars.length) {
      if (chars[j].char === '*') {
        const start = j;
        while (j < chars.length && chars[j].char === '*') {
          j++;
        }
        const length = j - start;
        
        const prevChar = start > 0 ? chars[start - 1].char : null;
        const nextChar = j < chars.length ? chars[j].char : null;
        
        const isWhitespace = (c) => !c || /\s/.test(c);
        const isPunctuation = (c) => {
          if (!c) return true;
          try {
            return /[\p{P}\p{S}]/u.test(c);
          } catch (e) {
            return /[\!\@\#\$\%\^\&\*\(\)\-\_\+\=\[\]\{\}\;\:\'\"\,\.\<\>\/\?\|\~\`\\⟫⟪«»“”‘’]/.test(c);
          }
        };
        
        const nextIsWhitespace = isWhitespace(nextChar);
        const prevIsWhitespace = isWhitespace(prevChar);
        const nextIsPunctuation = isPunctuation(nextChar);
        const prevIsPunctuation = isPunctuation(prevChar);
        
        const leftFlanking = !nextIsWhitespace && (!nextIsPunctuation || (nextIsPunctuation && (prevIsWhitespace || prevIsPunctuation)));
        const rightFlanking = !prevIsWhitespace && (!prevIsPunctuation || (prevIsPunctuation && (nextIsWhitespace || nextIsPunctuation)));
        
        const canOpen = leftFlanking;
        const canClose = rightFlanking;
        
        if (length === 1) {
          delimiters.push({
            type: '*',
            startIndex: chars[start].index,
            endIndex: chars[start].index,
            canOpen,
            canClose
          });
        } else if (length === 2) {
          delimiters.push({
            type: '**',
            startIndex: chars[start].index,
            endIndex: chars[start + 1].index,
            canOpen,
            canClose
          });
        } else if (length >= 3) {
          if (canClose) {
            delimiters.push({
              type: '*',
              startIndex: chars[start].index,
              endIndex: chars[start].index,
              canOpen,
              canClose
            });
            delimiters.push({
              type: '**',
              startIndex: chars[start + 1].index,
              endIndex: chars[start + length - 1].index,
              canOpen,
              canClose
            });
          } else {
            delimiters.push({
              type: '**',
              startIndex: chars[start].index,
              endIndex: chars[start + 1].index,
              canOpen,
              canClose
            });
            delimiters.push({
              type: '*',
              startIndex: chars[start + 2].index,
              endIndex: chars[start + length - 1].index,
              canOpen,
              canClose
            });
          }
        }
      } else {
        j++;
      }
    }

    const openers = [];
    const replacements = [];
    
    for (let dIdx = 0; dIdx < delimiters.length; dIdx++) {
      const delim = delimiters[dIdx];
      let matched = false;
      
      if (delim.canClose) {
        for (let oIdx = openers.length - 1; oIdx >= 0; oIdx--) {
          const opener = openers[oIdx];
          if (opener.type === delim.type) {
            const openTag = delim.type === '**' ? '<strong class="text-asterisks">' : '<span class="text-asterisks">';
            const closeTag = delim.type === '**' ? '</strong>' : '</span>';
            replacements.push({
              start: opener.startIndex,
              end: opener.endIndex,
              text: openTag
            });
            replacements.push({
              start: delim.startIndex,
              end: delim.endIndex,
              text: closeTag
            });
            openers.splice(oIdx);
            matched = true;
            break;
          }
        }
      }
      
      if (!matched && delim.canOpen) {
        openers.push(delim);
      }
    }
    
    replacements.sort((a, b) => b.start - a.start);
    
    let result = html;
    for (const r of replacements) {
      result = result.substring(0, r.start) + r.text + result.substring(r.end + 1);
    }
    
    return result;
  })();

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

  // Restore link URLs
  for (let i = 0; i < linkUrls.length; i++) {
    html = html.split(`__LINK_URL_PLACEHOLDER_${i}__`).join(linkUrls[i]);
  }

  // Restore inline code blocks
  for (let i = 0; i < inlineCodeBlocks.length; i++) {
    html = html.split(`__INLINE_CODE_PLACEHOLDER_${i}__`).join(inlineCodeBlocks[i]);
  }

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
export function parseThinking(text, customOpen = null, customClose = null) {
  if (typeof text !== 'string') return { thinking: null, content: '' };
  
  const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const defaultOpen = '<\\|channel>thought|<\\|?think\\|?>|<thought>|<reasoning>';
  const openPattern = customOpen ? escapeRegExp(customOpen) + '|' + defaultOpen : defaultOpen;
  
  const defaultClose = '<channel\\|>|<\\|?\\/think\\|?>|<\\/thought>|<\\/reasoning>';
  const closePattern = customClose ? escapeRegExp(customClose) + '|' + defaultClose : defaultClose;

  const thinkRegex = new RegExp(`(?:${openPattern})([\\s\\S]*?)(?:${closePattern})`, 'i');
  const match = text.match(thinkRegex);
  const cleanOpenRegex = new RegExp(`^(?:${openPattern})\\s*`, 'gi');

  if (match) {
    let thinking = match[1] ? match[1].trim() : '';
    thinking = thinking.replace(cleanOpenRegex, '').trim();
    let content = text.replace(thinkRegex, '').trim();
    content = content.replace(cleanOpenRegex, '').trim();
    return { thinking, content };
  }

  // If no closing tag was found, but text starts with an open tag:
  const startMatch = text.match(new RegExp(`^(?:${openPattern})\\s*`, 'i'));
  if (startMatch) {
    let thinking = text.substring(startMatch[0].length);
    thinking = thinking.replace(cleanOpenRegex, '').trim();
    return { thinking, content: '' };
  }

  return { thinking: null, content: text };
}

/**
 * Extract clean snippets/short phrases from streaming thinking text
 */
export function extractThinkingSnippets(text) {
  if (typeof text !== 'string' || !text) return [];
  
  let cleanText = text
    .replace(/(?:<\|channel>thought|<\|?think\|?>|<reasoning>|<thought>)/gi, '')
    .replace(/(?:<channel\|>|<\|?\/think\|?>|<\/thought>|<\/reasoning>)/gi, '')
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
export function parseStreamThinking(text, customOpen = null, customClose = null) {
  if (typeof text !== 'string') return { thinking: '', content: '', rawContent: '', isInThinking: false, thinkingStartIdx: -1, thinkingEndIdx: -1 };
  
  const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const defaultOpen = '<\\|channel>thought|<\\|?think\\|?>|<thought>|<reasoning>';
  const openPattern = customOpen ? escapeRegExp(customOpen) + '|' + defaultOpen : defaultOpen;
  const startMatch = text.match(new RegExp(openPattern, 'i'));
  
  if (!startMatch) {
    return { thinking: '', content: text, rawContent: text, isInThinking: false, thinkingStartIdx: -1, thinkingEndIdx: -1 };
  }

  const startIdx = startMatch.index;
  const thinkStart = startMatch[0];
  const afterStart = startIdx + thinkStart.length;

  const defaultClose = '<channel\\|>|<\\|?\\/think\\|?>|<\\/thought>|<\\/reasoning>';
  const closePattern = customClose ? escapeRegExp(customClose) + '|' + defaultClose : defaultClose;
  const endMatch = text.substring(afterStart).match(new RegExp(closePattern, 'i'));

  const cleanOpenRegex = new RegExp(`^(?:${openPattern})\\s*`, 'gi');

  if (!endMatch) {
    let thinking = text.substring(afterStart);
    thinking = thinking.replace(cleanOpenRegex, '');
    let content = text.substring(0, startIdx);
    content = content.replace(cleanOpenRegex, '');
    return { thinking, content, rawContent: content, isInThinking: true, thinkingStartIdx: startIdx, thinkingEndIdx: -1 };
  } else {
    const endIdx = afterStart + endMatch.index;
    const thinkEnd = endMatch[0];
    let thinking = text.substring(afterStart, endIdx);
    thinking = thinking.replace(cleanOpenRegex, '').trim();
    const rawContent = text.substring(0, startIdx) + text.substring(endIdx + thinkEnd.length);
    let content = rawContent.trim().replace(cleanOpenRegex, '');
    return { thinking, content, rawContent, isInThinking: false, thinkingStartIdx: startIdx, thinkingEndIdx: endIdx + thinkEnd.length };
  }
}

/**
 * Check if the thinking text represents a system budget exceeded message
 */
export function isBudgetExceededMessage(text) {
  if (typeof text !== 'string') return false;
  const clean = text.trim().toLowerCase();
  if (!clean) return false;

  // Exact or containing matches for known warnings
  if (clean.includes('reasoning budget exceeded') || 
      clean.includes('time to respond now.')) {
    return true;
  }

  // Prefix matching to prevent UI flicker while streaming these warnings
  // Only match prefixes of length >= 2 to avoid blocking real short thoughts like "("
  if (clean.length >= 2) {
    const patterns = [
      "(reasoning budget exceeded)",
      "(reasoning budget exceeded)\ntime to respond now.",
      "(reasoning budget exceeded) time to respond now.",
      "reasoning budget exceeded",
      "reasoning budget exceeded\ntime to respond now.",
      "reasoning budget exceeded time to respond now."
    ];
    for (const p of patterns) {
      if (p.startsWith(clean)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Generate thinking block HTML structure
 */
export function createThinkingBlockHTML(thinkingText, isActive, isGLM = false, thinkingTime = 0, reasoningEffortSetting = null) {
  const settings = settingsStore.get() || {};
  const effort = reasoningEffortSetting || settings.reasoning_effort;
  if (effort === 'none') {
    return '';
  }

  if (isBudgetExceededMessage(thinkingText)) {
    return '';
  }

  const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const defaultOpen = '<\\|channel>thought|<\\|?think\\|?>|<thought>|<reasoning>';
  const openPattern = settings.reasoning_tag_open ? escapeRegExp(settings.reasoning_tag_open) + '|' + defaultOpen : defaultOpen;
  const cleanOpenRegex = new RegExp(`^(?:${openPattern})\\s*`, 'gi');

  let cleanThinking = (thinkingText || '').replace(cleanOpenRegex, '').trim();

  if (isGLM) {
    if (isActive) {
      const escapedThoughts = escapeHtml(cleanThinking);
      return `<div class="thinking-inline thinking-inline-active"><glm-thinking-snippets thoughts="${escapedThoughts}"></glm-thinking-snippets></div>`;
    }
    const sections = parseGLMThinkingSections(cleanThinking);
    const timeText = thinkingTime > 0 ? `Thought for ${thinkingTime} seconds` : 'Thought finished';
    
    const sectionsHtml = sections.map((sec) => {
      const hasContent = sec.content.length > 0;
      const escapedTitle = escapeHtml(sec.title);
      const formattedContent = renderMarkdown(sec.content);
      
      if (hasContent) {
        return `<div class="glm-nested-item">
                  <div class="glm-nested-toggle" onclick="this.closest('.glm-nested-item').classList.toggle('glm-nested-expanded')">
                    <span class="glm-nested-title">${sec.number}. ${escapedTitle}</span>
                  </div>
                  <div class="glm-nested-content">${formattedContent}</div>
                </div>`;
      } else {
        return `<div class="glm-nested-item no-content">
                  <div class="glm-nested-toggle">
                    <span class="glm-nested-title">${sec.number}. ${escapedTitle}</span>
                  </div>
                </div>`;
      }
    }).join('\n');

    return `<div class="thinking-inline glm-thinking-expanded-container">
              <div class="glm-thinking-toggle" onclick="this.closest('.glm-thinking-expanded-container').classList.toggle('glm-thinking-expanded')">
                <span class="thinking-done-text">${timeText}</span>
              </div>
              <div class="glm-thinking-content">
                <div class="glm-nested-accordion">${sectionsHtml}</div>
              </div>
            </div>`;
  }

  if (isActive) {
    const escapedThoughts = escapeHtml(cleanThinking);
    return `<div class="thinking-inline thinking-inline-active"><div class="thinking-inline-header"><thinking-snippets id="genai-thinking-snippets" thoughts="${escapedThoughts}"></thinking-snippets></div></div>`;
  }
  let doneText = '';
  if (thinkingTime >= 5) {
    doneText = `Thought for ${thinkingTime}s`;
  } else {
    doneText = `thought for a few seconds.`;
  }
  return '<div class="thinking-inline"><div class="thinking-inline-header thinking-toggle-header" onclick="this.closest(\'.thinking-inline\').classList.toggle(\'thinking-expanded\')"><span class="thinking-done-text">' + escapeHtml(doneText) + '</span><span class="thinking-chevron"> ▸</span></div><div class="thinking-inline-content">' + escapeHtml(cleanThinking).replace(/\n/g, '<br>') + '</div></div>';
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
 * Wraps words in text nodes with span.word-blur or span.word-reveal for streaming animations
 */
export function wrapWordsInSpans(htmlString, useNewAnimation = false, revealedWordsCount = 0, streamingSpeed = 45) {
  if (!htmlString) return '';
  const parts = htmlString.split(/(<[^>]+>)/g);
  let wordIndex = 0;
  let charIndex = 0;
  let inSkipTag = false;
  let inTableTag = false;
  let inSkipBlock = false;
  let skipBlockTag = '';
  let skipBlockDepth = 0;
  const limit = useNewAnimation ? (revealedWordsCount + 10) : Infinity;
  const processedParts = parts.map(part => {
    if (part.startsWith('<')) { 
      const lower = part.toLowerCase();
      
      // If we are beyond the limit, only allow closing tags to keep HTML valid
      if (useNewAnimation && charIndex >= limit) {
        if (lower.startsWith('</')) {
          return part;
        }
        return '';
      }
      
      if (lower.startsWith('<pre') || lower.startsWith('<code')) inSkipTag = true;
      if (lower.startsWith('</pre') || lower.startsWith('</code')) inSkipTag = false;
      if (lower.startsWith('<table')) inTableTag = true;
      if (lower.startsWith('</table')) inTableTag = false;
      
      if (lower.startsWith('<div') && (lower.includes('thinking-inline') || lower.includes('genai-tool-capsule') || lower.includes('genai-inline-tool') || lower.includes('generated-image-container') || lower.includes('chat-image-loader'))) {
        inSkipBlock = true;
        skipBlockTag = 'div';
        skipBlockDepth = 1;
      } else if (inSkipBlock) {
        if (lower.startsWith('<' + skipBlockTag)) {
          skipBlockDepth++;
        } else if (lower.startsWith('</' + skipBlockTag)) {
          skipBlockDepth--;
          if (skipBlockDepth <= 0) {
            inSkipBlock = false;
          }
        }
      }
      return part;
    }
    if (inSkipTag || inTableTag || inSkipBlock) return part;
    
    
    if (!part.trim()) {
      charIndex += part.length;
      return part;
    }
    
    return part.split(/(\s+)/).map(w => {
      if (!w) return '';
      if (/^\s+$/.test(w)) {
        charIndex += w.length;
        return w;
      }
      
      const charStart = charIndex;
      const charLen = w.length;
      charIndex += charLen;
      
      // If the word starts beyond the limit, don't render it
      if (useNewAnimation && charStart >= limit) {
        return '';
      }
      
      if (useNewAnimation) {
        // Here, revealedWordsCount represents the revealed characters count
        const isRevealed = charStart < revealedWordsCount;
        const clazz = isRevealed ? 'word-reveal revealed' : 'word-reveal';
        return `<span class="${clazz}" data-word-index="${wordIndex++}" style="--char-start: ${charStart}ch; --char-len: ${charLen}ch;">${w}</span>`;
      } else {
        const isRevealed = wordIndex < revealedWordsCount;
        const duration = Math.round(w.length * (1000 / (streamingSpeed || 45)));
        const clazz = isRevealed ? 'word-blur revealed' : 'word-blur';
        return `<span class="${clazz}" data-word-index="${wordIndex++}" style="--dur: ${duration}ms">${w}</span>`;
      }
    }).join('');
  });
  wrapWordsInSpans.lastTotalChars = charIndex;
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


export function extractGLMThinkingSnippets(text) {
  if (typeof text !== 'string' || !text) return [];
  const lines = text.split('\n');
  const snippets = [];
  for (let line of lines) {
    line = line.trim();
    const match = line.match(/^\d+\.\s*(.*)/);
    if (match) {
      let snippetText = match[1].replace(/[*_~`]/g, '').trim();
      if (snippetText.endsWith(':')) {
        snippetText = snippetText.slice(0, -1) + '.';
      }
      if (snippetText) snippets.push(snippetText);
    }
  }
  return snippets;
}

export function parseGLMThinkingSections(thinkingText) {
  if (!thinkingText) return [];
  
  const lines = thinkingText.split('\n');
  const sections = [];
  let currentSection = null;
  
  for (let line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(\d+)\.\s*(.*)/);
    
    if (match) {
      if (currentSection) {
        sections.push(currentSection);
      }
      
      let rawTitle = match[2];
      let initialContent = '';
      const colonIdx = rawTitle.indexOf(': ');
      if (colonIdx !== -1) {
        initialContent = rawTitle.substring(colonIdx + 2).trim();
        rawTitle = rawTitle.substring(0, colonIdx).trim();
      }
      
      let title = rawTitle.replace(/[*_~`]/g, '').trim();
      if (title.endsWith(':')) {
        title = title.slice(0, -1) + '.';
      }
      
      currentSection = {
        number: match[1],
        title: title,
        contentLines: []
      };
      
      if (initialContent) {
        currentSection.contentLines.push(initialContent);
      }
    } else {
      if (currentSection) {
        currentSection.contentLines.push(line);
      }
    }
  }
  
  if (currentSection) {
    sections.push(currentSection);
  }
  
  return sections.map(sec => {
    let rawContent = sec.contentLines.join('\n').trim();
    return {
      number: sec.number,
      title: sec.title,
      content: rawContent
    };
  });
}

export function parseGLMThinking(text) {
  if (typeof text !== 'string' || !text) {
    return { thinking: '', content: '', isInThinking: false };
  }
  
  const lines = text.split('\n');
  const thinkingLines = [];
  const contentLines = [];
  let inContent = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (inContent) {
      contentLines.push(line);
      continue;
    }
    
    const isNumbered = /^\d+\.\s/.test(trimmed);
    
    if (isNumbered) {
      thinkingLines.push(line);
    } else if (trimmed === '') {
      let hasMoreNumberedAhead = false;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() !== '') {
          if (/^\d+\.\s/.test(lines[j].trim())) {
            hasMoreNumberedAhead = true;
          }
          break;
        }
      }
      if (hasMoreNumberedAhead) {
        thinkingLines.push(line);
      } else {
        if (i === lines.length - 1) {
          thinkingLines.push(line);
        } else {
          inContent = true;
          contentLines.push(line);
        }
      }
    } else {
      inContent = true;
      contentLines.push(line);
    }
  }
  
  const thinking = thinkingLines.join('\n');
  const content = contentLines.join('\n');
  const isInThinking = !inContent;
  
  return { thinking, content, isInThinking };
}

class GLMThinkingSnippets extends HTMLElement {
  constructor() {
    super();
    this.extractedSnippets = [];
  }

  static get observedAttributes() {
    return ['thoughts'];
  }

  connectedCallback() {
    this.innerHTML = '';
    const initialThoughts = this.getAttribute('thoughts') || '';
    this.updateThoughts(initialThoughts);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'thoughts' && newValue !== oldValue) {
      this.updateThoughts(newValue);
    }
  }

  updateThoughts(thoughtsText) {
    if (!thoughtsText) return;
    const newSnippets = extractGLMThinkingSnippets(thoughtsText);
    
    let addedNew = false;
    for (const snip of newSnippets) {
      if (!this.extractedSnippets.includes(snip)) {
        this.extractedSnippets.push(snip);
        addedNew = true;
      }
    }

    this.render();
  }

  render() {
    if (this.extractedSnippets.length === 0) {
      this.innerHTML = '<span class="glm-snippet active">Thinking...</span>';
      return;
    }

    const html = this.extractedSnippets.map((snip, index) => {
      const isActive = index === this.extractedSnippets.length - 1;
      const activeClass = isActive ? 'active' : '';
      return `<span class="glm-snippet ${activeClass}">${index + 1}. ${escapeHtml(snip)}</span>`;
    }).join('\n');

    this.innerHTML = html;
  }
}

if (!customElements.get('glm-thinking-snippets')) {
  customElements.define('glm-thinking-snippets', GLMThinkingSnippets);
}
