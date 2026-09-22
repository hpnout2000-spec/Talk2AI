/* ════════════════════════════════════════════════════════════════════
   Character Card Parser & Serializer
   Supports SillyTavern V3, V2, V1, TavernAI, Chub, and Pygmalion formats.
   Parses PNG chunks (tEXt, iTXt, zTXt), WebP EXIF, and JSON cards.
   ════════════════════════════════════════════════════════════════════ */

// ─── CRC32 Table for PNG Generation ─────────────────────────────────
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c;
}

function calculateCrc32(buf, offset = 0, length = buf.length - offset) {
  let c = 0xffffffff;
  for (let i = offset; i < offset + length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ─── Decompression Helper (zlib / deflate) ──────────────────────────
async function decompressZlib(compressedBytes) {
  if (typeof DecompressionStream === 'undefined') {
    console.warn('[CharacterParser] DecompressionStream is not supported in this environment');
    return null;
  }

  // 1. Try standard zlib/deflate stream
  try {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(compressedBytes);
    writer.close();
    const output = [];
    const reader = ds.readable.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      output.push(value);
    }
    const totalLength = output.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of output) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder('utf-8').decode(result);
  } catch (err) {
    // 2. Fallback: raw deflate (strip 2-byte header and 4-byte adler32)
    try {
      if (compressedBytes.length > 6) {
        const rawBytes = compressedBytes.subarray(2, compressedBytes.length - 4);
        const dsRaw = new DecompressionStream('deflate-raw');
        const writer = dsRaw.writable.getWriter();
        writer.write(rawBytes);
        writer.close();
        const output = [];
        const reader = dsRaw.readable.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          output.push(value);
        }
        const totalLength = output.reduce((acc, chunk) => acc + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of output) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        return new TextDecoder('utf-8').decode(result);
      }
    } catch (e2) {
      console.warn('[CharacterParser] Zlib decompression failed:', err, e2);
    }
  }
  return null;
}

// ─── PNG Chunk Extractor ────────────────────────────────────────────
export async function extractPngChunks(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  // Check PNG signature: [137, 80, 78, 71, 13, 10, 26, 10]
  const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8) return null;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== pngSig[i]) return null;
  }

  const textChunks = {};
  let pos = 8;
  const totalLength = bytes.length;

  while (pos + 12 <= totalLength) {
    const chunkLength = view.getUint32(pos, false);
    const chunkType = String.fromCharCode(
      bytes[pos + 4],
      bytes[pos + 5],
      bytes[pos + 6],
      bytes[pos + 7]
    );

    const dataStart = pos + 8;
    const dataEnd = dataStart + chunkLength;

    if (dataEnd > totalLength) {
      console.warn('[CharacterParser] Corrupted PNG: chunk extends beyond file length');
      break;
    }

    const chunkData = bytes.subarray(dataStart, dataEnd);

    if (chunkType === 'tEXt') {
      // Format: Keyword (1-79 bytes) + Null (1 byte) + Text (Latin-1 / UTF-8)
      let nullIdx = -1;
      for (let i = 0; i < chunkData.length; i++) {
        if (chunkData[i] === 0) {
          nullIdx = i;
          break;
        }
      }
      if (nullIdx !== -1) {
        const keyword = new TextDecoder('latin1').decode(chunkData.subarray(0, nullIdx)).toLowerCase().trim();
        const text = new TextDecoder('utf-8').decode(chunkData.subarray(nullIdx + 1));
        textChunks[keyword] = text;
      }
    } else if (chunkType === 'zTXt') {
      // Format: Keyword + Null + CompressionMethod (1 byte: 0) + Compressed Data
      let nullIdx = -1;
      for (let i = 0; i < chunkData.length; i++) {
        if (chunkData[i] === 0) {
          nullIdx = i;
          break;
        }
      }
      if (nullIdx !== -1 && nullIdx + 2 <= chunkData.length) {
        const keyword = new TextDecoder('latin1').decode(chunkData.subarray(0, nullIdx)).toLowerCase().trim();
        const compressedData = chunkData.subarray(nullIdx + 2);
        const text = await decompressZlib(compressedData);
        if (text) textChunks[keyword] = text;
      }
    } else if (chunkType === 'iTXt') {
      // Format: Keyword + Null + CompFlag (1 byte) + CompMethod (1 byte) + LangTag + Null + TransKeyword + Null + Text
      let nullIdx1 = -1;
      for (let i = 0; i < chunkData.length; i++) {
        if (chunkData[i] === 0) {
          nullIdx1 = i;
          break;
        }
      }
      if (nullIdx1 !== -1 && nullIdx1 + 3 < chunkData.length) {
        const keyword = new TextDecoder('latin1').decode(chunkData.subarray(0, nullIdx1)).toLowerCase().trim();
        const compFlag = chunkData[nullIdx1 + 1];
        // Skip compMethod at nullIdx1 + 2
        let p = nullIdx1 + 3;
        // Skip LangTag null
        while (p < chunkData.length && chunkData[p] !== 0) p++;
        p++; // past LangTag null
        // Skip TransKeyword null
        while (p < chunkData.length && chunkData[p] !== 0) p++;
        p++; // past TransKeyword null

        if (p <= chunkData.length) {
          const rawTextBytes = chunkData.subarray(p);
          let text = null;
          if (compFlag === 1) {
            text = await decompressZlib(rawTextBytes);
          } else {
            text = new TextDecoder('utf-8').decode(rawTextBytes);
          }
          if (text) textChunks[keyword] = text;
        }
      }
    } else if (chunkType === 'IEND') {
      break;
    }

    // Advance to next chunk: 4 (len) + 4 (type) + chunkLength + 4 (crc)
    pos = dataEnd + 4;
  }

  return textChunks;
}

// ─── Robust Text & Base64 Decoder ───────────────────────────────────
export function decodeCardText(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  // 1. Direct JSON check
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {}
  }

  // 2. Base64 check
  let b64 = trimmed;
  if (b64.includes('base64,')) {
    b64 = b64.substring(b64.indexOf('base64,') + 7);
  }
  // Strip whitespace and newlines
  b64 = b64.replace(/[\r\n\s]/g, '');
  // Normalize base64url (- to +, _ to /)
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  // Fix missing padding
  const padLen = (4 - (b64.length % 4)) % 4;
  b64 = b64.padEnd(b64.length + padLen, '=');

  // Try decoding Base64 -> UTF-8 bytes
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const jsonStr = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(jsonStr);
  } catch (e) {
    // Fallback: decodeURIComponent escape
    try {
      const binary = atob(b64);
      const jsonStr = decodeURIComponent(escape(binary));
      return JSON.parse(jsonStr);
    } catch (e2) {}
  }

  // 3. URL-encoded JSON check
  try {
    const unescaped = decodeURIComponent(trimmed);
    if ((unescaped.startsWith('{') && unescaped.endsWith('}')) || (unescaped.startsWith('[') && unescaped.endsWith(']'))) {
      return JSON.parse(unescaped);
    }
  } catch (e) {}

  return null;
}

// ─── Character Data Normalizer (V3, V2, V1, Tavern, Pygmalion, Chub) ─
export function normalizeCharacterCard(rawObj) {
  if (!rawObj || typeof rawObj !== 'object') return null;

  // Extract nested data container if present
  // SillyTavern V3: { spec: 'chara_card_v3', spec_version: '3.0', data: { ... } }
  // SillyTavern V2: { spec: 'chara_card_v2', spec_version: '2.0', data: { ... } }
  // Chub/Pygmalion: { character: { ... } } or { data: { ... } }
  const data = rawObj.data || rawObj.character || rawObj;
  const char = data.data || data;

  const name = (char.name || char.char_name || rawObj.name || '').trim();
  const description = char.description || char.char_persona || rawObj.description || '';
  const personality = char.personality || '';
  const scenario = char.scenario || char.world_scenario || rawObj.scenario || '';
  const system_prompt = char.system_prompt || char.system || '';
  const post_history_instructions = char.post_history_instructions || '';
  const first_message = char.first_mes || char.first_message || char.char_greeting || rawObj.first_message || '';

  // Alternate Greetings
  let alternate_greetings = [];
  if (Array.isArray(char.alternate_greetings)) {
    alternate_greetings = char.alternate_greetings.filter(g => typeof g === 'string' && g.trim());
  } else if (Array.isArray(rawObj.alternate_greetings)) {
    alternate_greetings = rawObj.alternate_greetings.filter(g => typeof g === 'string' && g.trim());
  }

  // Message Examples
  const message_examples = char.mes_example || char.message_examples || char.example_dialogue || rawObj.message_examples || '';

  // Tags & Image Tags
  let tags = [];
  if (Array.isArray(char.tags)) {
    tags = char.tags.filter(t => typeof t === 'string' && t.trim());
  } else if (typeof char.tags === 'string' && char.tags.trim()) {
    tags = char.tags.split(',').map(t => t.trim()).filter(Boolean);
  } else if (Array.isArray(rawObj.tags)) {
    tags = rawObj.tags.filter(t => typeof t === 'string' && t.trim());
  }
  const image_tags = char.image_tags || (tags.length ? tags.join(', ') : '');

  // Creator notes
  const creator_notes = char.creator_notes || char.comment || char.creatorcomment || rawObj.creator_notes || '';

  // Embedded Lorebook (character_book / world_info)
  const character_book = char.character_book || char.world_info || rawObj.character_book || null;

  // Embedded avatar in JSON if available
  const avatar = char.avatar || rawObj.avatar || null;

  return {
    name,
    description,
    personality,
    scenario,
    system_prompt,
    post_history_instructions,
    first_message,
    alternate_greetings,
    message_examples,
    image_tags,
    creator_notes,
    character_book,
    avatar,
    raw: rawObj
  };
}

// ─── Convert Embedded SillyTavern Lorebook to VibeChatting Format ────
export function convertEmbeddedLorebook(characterBook, charName = 'Character') {
  if (!characterBook || typeof characterBook !== 'object') return null;

  const bookName = characterBook.name || `${charName} (Lorebook)`;
  const rawEntries = characterBook.entries;
  if (!rawEntries) return null;

  const entriesArray = Array.isArray(rawEntries) ? rawEntries : Object.values(rawEntries);
  if (!entriesArray.length) return null;

  const entries = entriesArray.map((ent, idx) => {
    let keys = ent.key || ent.keys || [];
    if (typeof keys === 'string') keys = keys.split(',').map(s => s.trim()).filter(Boolean);
    if (!Array.isArray(keys)) keys = [];

    let filter = ent.keysecondary || ent.filter || [];
    if (typeof filter === 'string') filter = filter.split(',').map(s => s.trim()).filter(Boolean);
    if (!Array.isArray(filter)) filter = [];

    let position = 'Before Char';
    if (ent.position === 1 || ent.position === 'after_char') position = 'After Char';
    if (ent.position === 2 || ent.position === 'top') position = 'Top';
    if (ent.position === 3 || ent.position === 'bottom') position = 'Bottom';

    let logic = 'AND ANY';
    if (ent.logic === 1 || ent.logic === 'AND ALL' || ent.logic === 'AND_ALL') logic = 'AND ALL';
    if (ent.logic === 2 || ent.logic === 'NOT ANY' || ent.logic === 'NOT_ANY') logic = 'NOT ANY';
    if (ent.logic === 3 || ent.logic === 'NOT ALL' || ent.logic === 'NOT_ALL') logic = 'NOT ALL';

    return {
      id: ent.uid != null ? String(ent.uid) : String(Date.now() + idx),
      keys,
      filter,
      content: ent.content || ent.text || '',
      enabled: ent.enabled !== false,
      memo: ent.comment || ent.name || ent.memo || '',
      strategy: ent.constant ? 'constant' : 'selective',
      position,
      logic,
      inclusionGroup: ent.group || ent.inclusionGroup || '',
      groupWeight: ent.weight ?? ent.groupWeight ?? 100,
      sticky: ent.sticky ?? 0,
      cooldown: ent.cooldown ?? 0,
      delay: ent.delay ?? 0,
      triggerPercent: ent.chance ?? ent.triggerPercent ?? 100,
      order: ent.insertion_order ?? ent.order ?? ent.priority ?? 100,
      depth: ent.depth ?? 4,
      constant: !!ent.constant
    };
  });

  return {
    name: bookName,
    description: characterBook.description || `Embedded lorebook for ${charName}`,
    entries,
    favorite: false
  };
}

// ─── Main File Parser: Handles PNG, WebP, and JSON Files ─────────────
export async function parseCharacterCardFile(file) {
  if (!file) throw new Error('No file provided');

  let normalized = null;
  let avatarDataUrl = '';

  const fileName = (file.name || '').toLowerCase();

  // Read arrayBuffer for inspection
  const arrayBuffer = await file.arrayBuffer();

  // 1. Check if PNG
  const pngChunks = await extractPngChunks(arrayBuffer);
  if (pngChunks) {
    avatarDataUrl = await readFileAsDataUrlAsync(file);

    // SillyTavern priority: 'ccv3' (V3 spec) > 'chara' (V2 spec) > other tags
    const candidateKeys = ['ccv3', 'chara', 'character', 'description', 'comment', 'card'];
    let decodedJson = null;

    for (const key of candidateKeys) {
      if (pngChunks[key]) {
        decodedJson = decodeCardText(pngChunks[key]);
        if (decodedJson) break;
      }
    }

    // If candidate keys didn't hit, check all extracted text chunks
    if (!decodedJson) {
      for (const [key, val] of Object.entries(pngChunks)) {
        if (!candidateKeys.includes(key)) {
          decodedJson = decodeCardText(val);
          if (decodedJson && (decodedJson.name || decodedJson.data?.name || decodedJson.char_name)) {
            break;
          }
        }
      }
    }

    if (decodedJson) {
      normalized = normalizeCharacterCard(decodedJson);
    }
  }

  // 2. Fallback: Check if WebP or EXIF image (or corrupted PNG header with EXIF metadata)
  if (!normalized && (fileName.endsWith('.png') || fileName.endsWith('.webp') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg'))) {
    try {
      const ExifReaderModule = await import('../vendor/exifreader.js');
      const ExifReader = ExifReaderModule.default || ExifReaderModule;
      if (ExifReader && ExifReader.load) {
        const tags = await ExifReader.load(arrayBuffer);
        const tagKeys = ['ccv3', 'chara', 'UserComment', 'ImageDescription', 'Description', 'Comment'];
        for (const tk of tagKeys) {
          const tag = tags[tk] || tags[tk.toLowerCase()];
          if (tag) {
            const rawVal = tag.description || tag.value;
            const decoded = decodeCardText(typeof rawVal === 'string' ? rawVal : (Array.isArray(rawVal) ? String.fromCharCode(...rawVal) : ''));
            if (decoded) {
              normalized = normalizeCharacterCard(decoded);
              if (normalized) break;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[CharacterParser] ExifReader fallback failed:', e);
    }

    if (normalized && !avatarDataUrl) {
      avatarDataUrl = await readFileAsDataUrlAsync(file);
    }
  }

  // 3. Check if JSON file
  if (!normalized && (fileName.endsWith('.json') || !normalized)) {
    try {
      const text = new TextDecoder('utf-8').decode(arrayBuffer);
      const decodedJson = JSON.parse(text);
      normalized = normalizeCharacterCard(decodedJson);
      if (normalized?.avatar && typeof normalized.avatar === 'string' && normalized.avatar.startsWith('data:image/')) {
        avatarDataUrl = normalized.avatar;
      }
    } catch (e) {}
  }

  if (!normalized || !normalized.name) {
    throw new Error('No valid character card data found in this file');
  }

  // Parse embedded lorebook if present
  let lorebook = null;
  if (normalized.character_book) {
    lorebook = convertEmbeddedLorebook(normalized.character_book, normalized.name);
  }

  return {
    character: normalized,
    avatarDataUrl: avatarDataUrl || normalized.avatar || '',
    lorebook
  };
}

// ─── Character Card Exporter (SillyTavern PNG & JSON) ────────────────
export function buildSillyTavernV3Payload(characterData, lorebook = null) {
  const payload = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: characterData.name || '',
      description: characterData.description || '',
      personality: characterData.personality || '',
      scenario: characterData.scenario || '',
      first_mes: characterData.first_message || '',
      mes_example: characterData.message_examples || '',
      creator_notes: characterData.creator_notes || '',
      system_prompt: characterData.system_prompt || '',
      post_history_instructions: characterData.post_history_instructions || '',
      alternate_greetings: characterData.alternate_greetings || [],
      tags: characterData.image_tags ? characterData.image_tags.split(',').map(s => s.trim()).filter(Boolean) : [],
      creator: characterData.creator || 'VibeChatting',
      character_version: '1.0',
      extensions: {},
      character_book: lorebook ? {
        name: lorebook.name || `${characterData.name} Lorebook`,
        description: lorebook.description || '',
        scan_depth: 50,
        token_budget: 500,
        recursive_scanning: true,
        entries: (lorebook.entries || []).map((ent, idx) => ({
          keys: ent.keys || [],
          secondary_keys: ent.filter || [],
          comment: ent.memo || '',
          content: ent.content || '',
          constant: ent.constant || ent.strategy === 'constant',
          selective: ent.strategy === 'selective',
          insertion_order: ent.order ?? 100,
          enabled: ent.enabled !== false,
          position: ent.position === 'Top' ? 2 : (ent.position === 'Bottom' ? 3 : (ent.position === 'After Char' ? 1 : 0)),
          id: idx
        }))
      } : undefined
    }
  };
  return payload;
}

export function buildSillyTavernV2Payload(characterData, lorebook = null) {
  const payload = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: characterData.name || '',
      description: characterData.description || '',
      personality: characterData.personality || '',
      scenario: characterData.scenario || '',
      first_mes: characterData.first_message || '',
      mes_example: characterData.message_examples || '',
      creator_notes: characterData.creator_notes || '',
      system_prompt: characterData.system_prompt || '',
      post_history_instructions: characterData.post_history_instructions || '',
      alternate_greetings: characterData.alternate_greetings || [],
      tags: characterData.image_tags ? characterData.image_tags.split(',').map(s => s.trim()).filter(Boolean) : [],
      creator: characterData.creator || 'VibeChatting',
      character_version: '1.0',
      extensions: {}
    }
  };
  return payload;
}

// Create a single PNG tEXt chunk
function createPngTextChunk(keyword, text) {
  const enc = new TextEncoder();
  const keyBytes = enc.encode(keyword);
  const textBytes = enc.encode(text);
  const chunkLen = keyBytes.length + 1 + textBytes.length;

  const chunk = new Uint8Array(4 + 4 + chunkLen + 4);
  const view = new DataView(chunk.buffer);

  // Length
  view.setUint32(0, chunkLen, false);
  // Type: 'tEXt'
  chunk[4] = 116; // 't'
  chunk[5] = 69;  // 'E'
  chunk[6] = 88;  // 'X'
  chunk[7] = 116; // 't'

  // Keyword
  chunk.set(keyBytes, 8);
  // Null separator
  chunk[8 + keyBytes.length] = 0;
  // Text
  chunk.set(textBytes, 8 + keyBytes.length + 1);

  // CRC32
  const crcVal = calculateCrc32(chunk, 4, 4 + chunkLen);
  view.setUint32(8 + chunkLen, crcVal, false);

  return chunk;
}

// Convert UTF-8 string to Base64
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Embed SillyTavern character metadata chunks into a PNG ArrayBuffer
export function embedCharacterInPng(pngArrayBuffer, characterData, lorebook = null) {
  const bytes = new Uint8Array(pngArrayBuffer);
  const view = new DataView(pngArrayBuffer);

  // Validate PNG
  const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== pngSig[i]) {
      throw new Error('Source image is not a valid PNG');
    }
  }

  // Build payloads
  const v3Obj = buildSillyTavernV3Payload(characterData, lorebook);
  const v2Obj = buildSillyTavernV2Payload(characterData, lorebook);

  const v3B64 = utf8ToBase64(JSON.stringify(v3Obj));
  const v2B64 = utf8ToBase64(JSON.stringify(v2Obj));

  const ccv3Chunk = createPngTextChunk('ccv3', v3B64);
  const charaChunk = createPngTextChunk('chara', v2B64);

  // Find IHDR chunk end to insert metadata chunks right after IHDR
  let insertPos = 8;
  if (insertPos + 8 <= bytes.length) {
    const ihdrLen = view.getUint32(insertPos, false);
    insertPos += 12 + ihdrLen; // 4 len + 4 type + data + 4 crc
  }

  // Combine: PNG start up to insertPos + ccv3Chunk + charaChunk + rest of PNG
  const newLength = bytes.length + ccv3Chunk.length + charaChunk.length;
  const newPng = new Uint8Array(newLength);

  newPng.set(bytes.subarray(0, insertPos), 0);
  newPng.set(ccv3Chunk, insertPos);
  newPng.set(charaChunk, insertPos + ccv3Chunk.length);
  newPng.set(bytes.subarray(insertPos), insertPos + ccv3Chunk.length + charaChunk.length);

  return newPng.buffer;
}

// Export Character as downloadable PNG or JSON
export async function exportCharacterCard(characterData, format = 'png', lorebook = null) {
  const safeName = (characterData.name || 'character').replace(/[/\\?%*:|"<>]/g, '_');

  if (format === 'json') {
    const payload = buildSillyTavernV3Payload(characterData, lorebook);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${safeName}.json`);
    return;
  }

  // PNG Export
  let pngBuffer = null;
  if (characterData.avatar && characterData.avatar.startsWith('data:image/png;base64,')) {
    const binary = atob(characterData.avatar.split(',')[1]);
    const u8 = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);
    pngBuffer = u8.buffer;
  } else if (characterData.avatar) {
    // Convert avatar image to PNG canvas
    pngBuffer = await createPngBufferFromImage(characterData.avatar);
  } else {
    // Generate default avatar canvas PNG
    pngBuffer = await createDefaultAvatarPng(characterData.name);
  }

  const finalPngBuffer = embedCharacterInPng(pngBuffer, characterData, lorebook);
  const blob = new Blob([finalPngBuffer], { type: 'image/png' });
  downloadBlob(blob, `${safeName}.png`);
}

// ─── Helpers ────────────────────────────────────────────────────────
function readFileAsDataUrlAsync(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createPngBufferFromImage(imageSrc) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width || 400;
      canvas.height = img.naturalHeight || img.height || 600;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Canvas toBlob failed'));
        blob.arrayBuffer().then(resolve).catch(reject);
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('Failed to load character image'));
    img.src = imageSrc;
  });
}

function createDefaultAvatarPng(name = 'Character') {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, 400, 600);
    grad.addColorStop(0, '#1e293b');
    grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 400, 600);

    // Initial letter avatar
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 120px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((name[0] || 'C').toUpperCase(), 200, 260);

    // Character Name
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(name.substring(0, 24), 200, 380);

    canvas.toBlob((blob) => {
      blob.arrayBuffer().then(resolve);
    }, 'image/png');
  });
}
