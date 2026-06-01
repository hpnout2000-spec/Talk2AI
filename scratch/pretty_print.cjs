const fs = require('fs');
const path = require('path');

const srcPath = 'C:\\Users\\fktrc\\.gemini\\antigravity\\brain\\04058ab5-51f5-49e0-a8d7-ffd9ed2b0aca\\scratch\\skills_step_69.js';
const destPath = 'C:\\Users\\fktrc\\.gemini\\antigravity\\brain\\04058ab5-51f5-49e0-a8d7-ffd9ed2b0aca\\scratch\\skills_step_69_pretty.js';

let raw = fs.readFileSync(srcPath, 'utf8');

// It's a JSON string representing the replacement content
try {
  // If it is wrapped in quotes, it might be a JSON string
  const parsed = JSON.parse(raw);
  fs.writeFileSync(destPath, parsed, 'utf8');
  console.log('Successfully pretty printed to', destPath);
} catch (e) {
  // If parsing as JSON fails, it might be raw JS already
  fs.writeFileSync(destPath, raw, 'utf8');
  console.log('Could not parse as JSON, saved raw to', destPath);
}
