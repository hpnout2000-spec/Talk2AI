const fs = require('fs');
const path = require('path');

const logFile = 'C:\\Users\\fktrc\\.gemini\\antigravity\\brain\\b7293d01-28b9-4da9-aee0-13249b07db35\\.system_generated\\logs\\transcript.jsonl';

const lines = fs.readFileSync(logFile, 'utf8').split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  
  if (line.includes('renderSkillsList')) {
    try {
      const data = JSON.parse(line);
      console.log(`Step ${data.step_index}: Type: ${data.type}`);
      if (data.tool_calls) {
        data.tool_calls.forEach((tc, tcIdx) => {
          console.log(`  Tool call ${tcIdx}: ${tc.name}`);
          if (tc.args) {
            console.log(`    Args keys: ${Object.keys(tc.args).join(', ')}`);
            if (tc.args.Instruction) console.log(`    Instruction: ${tc.args.Instruction}`);
            if (tc.args.ReplacementContent) {
              const len = tc.args.ReplacementContent.length;
              const isTruncated = tc.args.ReplacementContent.includes('<truncated');
              console.log(`    ReplacementContent length: ${len}, truncated: ${isTruncated}`);
            }
            if (tc.args.ReplacementChunks) {
              tc.args.ReplacementChunks.forEach((chunk, chunkIdx) => {
                const len = chunk.ReplacementContent.length;
                const isTruncated = chunk.ReplacementContent.includes('<truncated');
                console.log(`      Chunk ${chunkIdx} length: ${len}, truncated: ${isTruncated}`);
              });
            }
          }
        });
      }
      if (data.content) {
        const len = data.content.length;
        const isTruncated = data.content.includes('<truncated');
        console.log(`  Content length: ${len}, truncated: ${isTruncated}`);
      }
    } catch (e) {
      console.log(`  Line ${i} parse error: ${e.message}`);
    }
  }
}
