const fs = require('fs');
const path = require('path');

const logFile = 'C:\\Users\\fktrc\\.gemini\\antigravity\\brain\\b7293d01-28b9-4da9-aee0-13249b07db35\\.system_generated\\logs\\transcript.jsonl';
const scratchDir = 'C:\\Users\\fktrc\\.gemini\\antigravity\\brain\\04058ab5-51f5-49e0-a8d7-ffd9ed2b0aca\\scratch';

if (!fs.existsSync(scratchDir)) {
  fs.mkdirSync(scratchDir, { recursive: true });
}

const lines = fs.readFileSync(logFile, 'utf8').split('\n');
console.log(`Read ${lines.length} lines.`);

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  
  if (line.includes('renderSkillsList') && line.includes('ReplacementContent')) {
    try {
      const data = JSON.parse(line);
      console.log(`Found candidate in step ${data.step_index}`);
      
      if (data.tool_calls) {
        for (const tc of data.tool_calls) {
          if (tc.name === 'replace_file_content' || tc.name === 'multi_replace_file_content') {
            if (tc.args.ReplacementContent && tc.args.ReplacementContent.includes('renderSkillsList')) {
              const outPath = path.join(scratchDir, `skills_step_${data.step_index}.js`);
              fs.writeFileSync(outPath, tc.args.ReplacementContent, 'utf8');
              console.log(`Saved ReplacementContent to ${outPath}`);
            }
            if (tc.args.ReplacementChunks) {
              for (let j = 0; j < tc.args.ReplacementChunks.length; j++) {
                const chunk = tc.args.ReplacementChunks[j];
                if (chunk.ReplacementContent && chunk.ReplacementContent.includes('renderSkillsList')) {
                  const outPath = path.join(scratchDir, `skills_chunk_${data.step_index}_${j}.js`);
                  fs.writeFileSync(outPath, chunk.ReplacementContent, 'utf8');
                  console.log(`Saved Chunk to ${outPath}`);
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.error(`Error parsing line ${i}:`, e.message);
    }
  }
}
