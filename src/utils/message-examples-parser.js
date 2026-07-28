/* ════════════════════════════════════════════════════════════════════
   Message Examples Parser — SillyTavern / Character Card V2 & V3 spec
   ════════════════════════════════════════════════════════════════════ */

import { replaceCharUserMacros } from './text-completion-formatter.js';

function escapeRegExp(string) {
  return string ? string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
}

/**
 * Parses raw mes_example / message_examples string into structured chat messages
 * and formatted system prompt text according to SillyTavern V2/V3 spec.
 *
 * @param {string} rawExamples - The raw mes_example content from character card
 * @param {string} userName - Current user name
 * @param {string} charName - Current character name
 * @returns {Object} { messages: Array<{role: string, content: string}>, formattedSystemText: string }
 */
export function parseMessageExamples(rawExamples, userName = 'User', charName = 'Assistant') {
  if (!rawExamples || typeof rawExamples !== 'string' || !rawExamples.trim()) {
    return { messages: [], formattedSystemText: '' };
  }

  const uName = userName || 'User';
  const cName = charName || 'Assistant';

  // Split into blocks by <START> or <start>
  const rawBlocks = rawExamples
    .split(/<start>/i)
    .map(b => b.trim())
    .filter(b => b.length > 0);

  const messages = [];
  const systemBlocks = [];

  const uNameEsc = escapeRegExp(uName);
  const cNameEsc = escapeRegExp(cName);

  // Match prefixes like {{user}}:, <user>:, User:, [userName]:, userName:
  // Match prefixes like {{char}}:, <char>:, Assistant:, Char:, Bot:, [charName]:, charName:
  const userRegex = new RegExp(`^(?:\\{\\{user\\}\\}|<user>|User|${uNameEsc}|(?:\\[${uNameEsc}\\]))(?:\\s*:\\s*|\\s+-\\s+)`, 'i');
  const charRegex = new RegExp(`^(?:\\{\\{char\\}\\}|<char>|Assistant|Char|Bot|${cNameEsc}|(?:\\[${cNameEsc}\\]))(?:\\s*:\\s*|\\s+-\\s+)`, 'i');

  for (const block of rawBlocks) {
    const lines = block.split(/\r?\n/);
    let currentRole = null;
    let currentLines = [];
    const blockMessages = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (userRegex.test(line)) {
        if (currentRole && currentLines.length > 0) {
          blockMessages.push({
            role: currentRole,
            content: currentLines.join('\n').trim()
          });
        }
        currentRole = 'user';
        const contentWithoutPrefix = line.replace(userRegex, '');
        currentLines = [contentWithoutPrefix];
      } else if (charRegex.test(line)) {
        if (currentRole && currentLines.length > 0) {
          blockMessages.push({
            role: currentRole,
            content: currentLines.join('\n').trim()
          });
        }
        currentRole = 'assistant';
        const contentWithoutPrefix = line.replace(charRegex, '');
        currentLines = [contentWithoutPrefix];
      } else {
        // Line without explicit prefix
        if (currentRole) {
          currentLines.push(line);
        } else {
          // Check generic "Name: dialogue" pattern
          const colonMatch = line.match(/^([^:\n]+):\s*(.*)$/);
          if (colonMatch) {
            const speaker = colonMatch[1].trim().toLowerCase();
            const rest = colonMatch[2];
            if (speaker === uName.toLowerCase() || speaker === 'user') {
              currentRole = 'user';
              currentLines = [rest];
            } else if (speaker === cName.toLowerCase() || speaker === 'char' || speaker === 'assistant') {
              currentRole = 'assistant';
              currentLines = [rest];
            } else {
              currentRole = 'user';
              currentLines = [line];
            }
          } else {
            currentRole = 'user';
            currentLines = [line];
          }
        }
      }
    }

    if (currentRole && currentLines.length > 0) {
      blockMessages.push({
        role: currentRole,
        content: currentLines.join('\n').trim()
      });
    }

    // Process macros in message contents
    for (const msg of blockMessages) {
      msg.content = replaceCharUserMacros(msg.content, cName, uName);
      if (msg.content.trim()) {
        messages.push(msg);
      }
    }

    // System prompt block representation
    const cleanBlockLines = blockMessages.map(m => {
      const name = m.role === 'user' ? uName : cName;
      return `${name}: ${m.content}`;
    });
    if (cleanBlockLines.length > 0) {
      systemBlocks.push(cleanBlockLines.join('\n'));
    }
  }

  // Fallback if no structured blocks could be parsed
  if (messages.length === 0 && rawExamples.trim()) {
    const cleaned = replaceCharUserMacros(rawExamples, cName, uName)
      .replace(/<start>/gi, '')
      .replace(/<end>/gi, '')
      .trim();
    if (cleaned) {
      systemBlocks.push(cleaned);
    }
  }

  const formattedSystemText = systemBlocks.length > 0
    ? `[Example Dialogue]\n${systemBlocks.join('\n\n')}`
    : '';

  return { messages, formattedSystemText };
}
