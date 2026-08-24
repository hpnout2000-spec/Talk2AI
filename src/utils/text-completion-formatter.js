/* ════════════════════════════════════════════════════════════════════
   Text Completion Formatter — SillyTavern-style template & macro engine
   ════════════════════════════════════════════════════════════════════ */

/**
 * Handlebars-style template evaluator for simple conditionals and macro replacements.
 * Supports:
 * - {{#if key}}...{{/if}}
 * - {{#if key}}...{{else}}...{{/if}}
 * - {{key}}
 */
export function compileTemplate(template, data = {}) {
  if (!template || typeof template !== 'string') return '';

  let result = template;

  // 1. Strip Handlebars comments: {{!-- ... --}} and {{! ... }}
  // Match comments and optional trailing newline if the comment was on its own line
  result = result.replace(/\{\{!--[\s\S]*?--\}\}\r?\n?/g, '');
  result = result.replace(/\{\{![\s\S]*?\}\}\r?\n?/g, '');

  // 2. Process {{#if key}}...{{else}}...{{/if}} and {{#if key}}...{{/if}}
  const ifRegex = /\{\{#if\s+([a-zA-Z0-9_]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;

  // Evaluate nested or consecutive {{#if}} blocks up to 5 passes
  for (let pass = 0; pass < 5; pass++) {
    if (!ifRegex.test(result)) break;
    ifRegex.lastIndex = 0;

    result = result.replace(ifRegex, (_, key, ifContent, elseContent = '') => {
      const val = data[key];
      const isTruthy = val && (typeof val !== 'string' || val.trim().length > 0);
      return isTruthy ? ifContent : elseContent;
    });
  }

  // 3. Replace variable placeholders {{key}}
  result = result.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    if (key === 'trim') return ''; // handled separately or stripped
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      return data[key] !== undefined && data[key] !== null ? String(data[key]) : '';
    }
    return match;
  });

  // Handle {{trim}} tag by trimming trailing whitespace
  if (template.includes('{{trim}}')) {
    result = result.trimEnd();
  }

  return result;
}

/**
 * Replace character & user macros in string: {{char}}, {{user}}, <char>, <user>
 */
export function replaceCharUserMacros(text, charName = 'Assistant', userName = 'User') {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\{\{char\}\}/gi, charName)
    .replace(/\{\{user\}\}/gi, userName)
    .replace(/<char>/gi, charName)
    .replace(/<user>/gi, userName);
}

/**
 * Formats full chat messages and context into a raw string for Text Completion models,
 * using the provided Instruct Template and Context Template.
 *
 * @param {Array} messages - Array of { role, content, name }
 * @param {Object} contextTemplate - Selected context template object
 * @param {Object} instructTemplate - Selected instruct template object
 * @param {Object} options - Additional metadata { charName, userName, charDescription, charPersonality, scenario, persona, systemPrompt }
 * @returns {Object} { prompt: string, stop: Array<string> }
 */
export function formatTextCompletionPrompt(messages = [], contextTemplate = {}, instructTemplate = {}, options = {}) {
  const charName = options.charName || 'Assistant';
  const userName = options.userName || 'User';

  // 1. Extract system / story variables
  let systemMsgContent = options.systemPrompt || '';
  const messageHistory = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      if (systemMsgContent) {
        systemMsgContent += '\n\n' + msg.content;
      } else {
        systemMsgContent = msg.content;
      }
    } else {
      messageHistory.push(msg);
    }
  }

  // Build Context / Story String data
  const templateData = {
    char: charName,
    user: userName,
    system: systemMsgContent,
    description: options.charDescription || '',
    personality: options.charPersonality || '',
    scenario: options.scenario || '',
    persona: options.persona || '',
    mesExamples: options.mesExamples || options.mes_example || '',
    mes_example: options.mesExamples || options.mes_example || '',
    wiBefore: options.wiBefore || '',
    wiAfter: options.wiAfter || '',
    anchorBefore: options.anchorBefore || '',
    anchorAfter: options.anchorAfter || '',
  };

  // Compile story string from Context Template
  const storyStringRaw = contextTemplate.story_string ||
    '{{#if anchorBefore}}{{anchorBefore}}{{/if}}{{#if system}}{{system}}{{/if}}{{#if wiBefore}}{{wiBefore}}{{/if}}{{#if description}}{{description}}{{/if}}{{#if personality}}{{personality}}{{/if}}{{#if scenario}}{{scenario}}{{/if}}{{#if wiAfter}}{{wiAfter}}{{/if}}{{#if persona}}{{persona}}{{/if}}{{#if anchorAfter}}{{anchorAfter}}{{/if}}{{trim}}';

  let storyString = compileTemplate(storyStringRaw, templateData);
  storyString = replaceCharUserMacros(storyString, charName, userName);

  if (contextTemplate.trim_spaces) {
    storyString = storyString.trim();
  }

  // 2. Instruct Template sequence definitions
  const userPrefix = instructTemplate.user_prefix ?? '<start_of_turn>user\n';
  const userSuffix = instructTemplate.user_suffix ?? '<end_of_turn>\n';
  const assistantPrefix = instructTemplate.assistant_prefix ?? '<start_of_turn>model\n';
  const assistantSuffix = instructTemplate.assistant_suffix ?? '<end_of_turn>\n';
  const storyPrefix = instructTemplate.story_prefix ?? userPrefix;
  const storySuffix = instructTemplate.story_suffix ?? userSuffix;
  const systemPrefix = instructTemplate.system_prefix ?? userPrefix;
  const systemSuffix = instructTemplate.system_suffix ?? userSuffix;

  const replaceMacro = instructTemplate.replace_macro_in_sequences ?? true;
  const wrapNewline = instructTemplate.wrap_sequences_with_newline ?? false;
  const includeNames = instructTemplate.include_names || 'none'; // 'none' | 'user_assistant' | 'all'

  const formatSeq = (seq) => {
    let s = seq;
    if (replaceMacro) {
      s = replaceCharUserMacros(s, charName, userName);
    }
    if (wrapNewline && s && !s.startsWith('\n')) {
      s = '\n' + s;
    }
    return s;
  };

  // 3. Assemble Prompt
  let promptParts = [];

  // Story / System header
  if (storyString) {
    if (storyPrefix) {
      promptParts.push(formatSeq(storyPrefix) + storyString + (storySuffix ? formatSeq(storySuffix) : ''));
    } else {
      promptParts.push(storyString);
    }
  }

  // Conversation turns
  for (let i = 0; i < messageHistory.length; i++) {
    const msg = messageHistory[i];
    const isUser = msg.role === 'user';
    let text = msg.content || '';
    text = replaceCharUserMacros(text, charName, userName);

    if (contextTemplate.trim_spaces) {
      text = text.trim();
    }

    if (isUser) {
      let turnContent = text;
      if (contextTemplate.always_add_character_name || includeNames === 'user_assistant' || includeNames === 'all') {
        if (!turnContent.startsWith(userName + ':')) {
          turnContent = `${userName}: ${turnContent}`;
        }
      }

      let pfx = formatSeq(userPrefix);
      const sfx = formatSeq(userSuffix);
      
      // Ensure the prefix doesn't merge directly into the content if it lacks a separator
      if (pfx && !pfx.endsWith('\n') && !pfx.endsWith(' ')) {
        pfx += '\n';
      }
      
      promptParts.push(`${pfx}${turnContent}${sfx}`);
    } else {
      let turnContent = text;
      if (contextTemplate.always_add_character_name || includeNames === 'user_assistant' || includeNames === 'all') {
        if (!turnContent.startsWith(charName + ':')) {
          turnContent = `${charName}: ${turnContent}`;
        }
      }

      let pfx = formatSeq(assistantPrefix);
      
      // Ensure the prefix doesn't merge directly into the content
      if (pfx && !pfx.endsWith('\n') && !pfx.endsWith(' ')) {
        pfx += '\n';
      }

      const isLastMessage = i === messageHistory.length - 1;
      
      if (isLastMessage) {
        // This is a prefill, do not append suffix
        promptParts.push(`${pfx}${turnContent}`);
      } else {
        const sfx = formatSeq(assistantSuffix);
        promptParts.push(`${pfx}${turnContent}${sfx}`);
      }
    }
  }

  // Add Assistant Prefix prompt at the end to generate next completion turn
  // ONLY if the last message in history wasn't an assistant prefill
  const lastMsgIsAssistant = messageHistory.length > 0 && messageHistory[messageHistory.length - 1].role === 'assistant';
  
  if (!lastMsgIsAssistant) {
    let finalAssistantPrefix = formatSeq(assistantPrefix);
    
    // Ensure the prefix doesn't merge directly into the appended name
    if (finalAssistantPrefix && !finalAssistantPrefix.endsWith('\n') && !finalAssistantPrefix.endsWith(' ')) {
        finalAssistantPrefix += '\n';
    }

    if (contextTemplate.always_add_character_name || includeNames === 'user_assistant' || includeNames === 'all') {
      if (!finalAssistantPrefix.includes(charName + ':')) {
        finalAssistantPrefix += `${charName}: `;
      }
    }
    promptParts.push(finalAssistantPrefix);
  }

  let finalPrompt = promptParts.join('');

  if (contextTemplate.collapse_newlines) {
    finalPrompt = finalPrompt.replace(/\n{3,}/g, '\n\n');
  }

  // 4. Determine Stop Sequences
  const stopSet = new Set();

  if (userSuffix) stopSet.add(formatSeq(userSuffix).trim());
  if (assistantSuffix) stopSet.add(formatSeq(assistantSuffix).trim());
  if (userPrefix) stopSet.add(formatSeq(userPrefix).trim());

  if (contextTemplate.names_as_stop) {
    stopSet.add(`\n${userName}:`);
    // Removed \n${charName}: to prevent immediate stop sequence triggering
    // when the prompt ends with the character name or the model generates its own name.
  }

  if (contextTemplate.separators_as_stop && contextTemplate.example_separator) {
    stopSet.add(contextTemplate.example_separator.trim());
  }

  // Standard common tokens if sequences as stop strings
  if (instructTemplate.sequences_as_stop_strings) {
    stopSet.add('<end_of_turn>');
    stopSet.add('<|end_of_text|>');
    stopSet.add('<|eot_id|>');
    stopSet.add('<|im_end|>');
    stopSet.add('</s>');
  }

  const stopArray = Array.from(stopSet).filter(s => s && s.length > 0);

  return {
    prompt: finalPrompt,
    stop: stopArray
  };
}
