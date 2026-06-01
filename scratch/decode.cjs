const fs = require('fs');
const path = require('path');

const srcPath = 'C:\\Users\\fktrc\\.gemini\\antigravity\\brain\\04058ab5-51f5-49e0-a8d7-ffd9ed2b0aca\\scratch\\skills_step_69.js';
const destPath = 'C:\\Users\\fktrc\\.gemini\\antigravity\\brain\\04058ab5-51f5-49e0-a8d7-ffd9ed2b0aca\\scratch\\skills_step_69_decoded.js';

let raw = fs.readFileSync(srcPath, 'utf8').trim();

// If it starts with double quotes and ends with double quotes, parse it as JSON
if (raw.startsWith('"') && raw.endsWith('"')) {
  try {
    const parsed = JSON.parse(raw);
    fs.writeFileSync(destPath, parsed, 'utf8');
    console.log('Successfully decoded JSON string to', destPath);
    process.exit(0);
  } catch (e) {
    console.log('Failed to parse as JSON:', e.message);
  }
}

// Fallback: manually replace escaped sequences
let decoded = raw
  .replace(/^"/, '')
  .replace(/"$/, '')
  .replace(/\\n/g, '\n')
  .replace(/\\r/g, '\r')
  .replace(/\\t/g, '\t')
  .replace(/\\"/g, '"')
  .replace(/\\\\/g, '\\');

fs.writeFileSync(destPath, decoded, 'utf8');
console.log('Manually decoded string to', destPath);
