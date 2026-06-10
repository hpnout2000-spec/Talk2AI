import { api } from '../services/api.js';
import { imageSessionStore } from '../services/image-session-store.js';
import * as tools from '../services/image-tools.js';

function buildImageEditorSystemPrompt() {
  return `You are an AI Image Editor. You work in a hidden workspace to fulfill image editing tasks.
You have access to tools via JSON commands. Respond with ONE tool call per message.

TOOLS (respond with ONLY the JSON, no other text):

Generate new image:
{"tool":"generate_image","prompt":"...","neg_prompt":"...","width":832,"height":1216}

Remove background (makes it transparent):
{"tool":"remove_background","imageId":"img_001"}

Composite/layer images:
{"tool":"composite_images","baseImageId":"img_001","overlayImageId":"img_002","alignX":"center","alignY":"bottom","scaleMode":"fit_height_80"}

Add text to image:
{"tool":"add_text","imageId":"img_001","text":"Hello World","alignX":"center","alignY":"bottom","fontSize":64,"color":"#FFFFFF","bold":true,"shadow":true}

Resize image:
{"tool":"resize_image","imageId":"img_001","width":1024,"height":1024}

Crop image:
{"tool":"crop_image","imageId":"img_001","x":0,"y":0,"width":800,"height":600}

Adjust image:
{"tool":"adjust_image","imageId":"img_001","brightness":120,"contrast":110,"saturation":100,"hue":0}

Flip image:
{"tool":"flip_image","imageId":"img_001","direction":"horizontal"}

Fill background:
{"tool":"fill_background","imageId":"img_001","color":"#1a1a2e"}

Send message to user (shown briefly while working, auto-removed when done):
{"tool":"show_msg_to_user","message":"Сгенерировал персонажей! Теперь приступаю к созданию фона..."}

Show final result to user (ends the session):
{"tool":"show_img","imageId":"img_007"}

Pass text result or analysis to the main GenAI without showing an image (ends the session):
{"tool":"exitred","message":"The character is wearing a red hat."}

RULES:
- Always generate_image before any editing operation if you need a base image.
- When calling generate_image, you MUST strictly avoid using generic quality tags or buzzwords in the prompt, such as "detailed texture", "highly detailed face", "volumetric lighting", or "vibrant colors".
- When compositing people on a background: 1) generate person WITH "pure white background" in prompt, 2) remove_background, 3) generate background, 4) composite person onto background.
- IMPORTANT: When generating a character for background removal, always add "white background, pure white background, simple white background" to the prompt and "complex background, detailed background" to neg_prompt. This ensures the canvas fallback works correctly if the AI rembg node is unavailable.
- remove_background always works: it uses AI rembg if available, or canvas-based white-bg removal as fallback. Never skip it.
- Use show_msg_to_user for significant milestones only (messages auto-disappear when done).
- End ALWAYS with either show_img or exitred
- Image IDs come from tool results, not invented.
- Current available images are provided after each tool result.`;
}

export async function runImageEditorAgent(task, onStatus, onMessage, onImage, signal, onExitRed) {
  const sentImageIds = new Set();

  function buildVisionContent(text) {
    const newImages = imageSessionStore.getAll().filter(entry => !sentImageIds.has(entry.id));
    if (newImages.length === 0) return text;

    const content = [{ type: 'text', text }];
    for (const img of newImages) {
      content.push({ type: 'image_url', image_url: { url: img.dataUrl } });
      sentImageIds.add(img.id);
    }
    return content;
  }

  const history = [
    { role: 'system', content: buildImageEditorSystemPrompt() },
    { role: 'user', content: buildVisionContent(`Task: ${task}\n\n${imageSessionStore.toContextString()}`) }
  ];
  
  let iterations = 0;
  const MAX_ITER = 12;
  let lastActionStr = '';

  while (iterations < MAX_ITER) {
    if (signal?.aborted) break;
    iterations++;

    onStatus('Thinking...');

    let response;
    try {
      response = await api.chatCompletion(history, { signal, temperature: 0.2 });
    } catch (e) {
      if (e.name === 'AbortError') break;
      throw e;
    }

    history.push({ role: 'assistant', content: response });

    let action;
    try {
      let jsonStr = response.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json/m, '').replace(/```$/m, '').trim();
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```/m, '').replace(/```$/m, '').trim();
      }
      
      if (jsonStr === lastActionStr) {
        throw new Error("Loop detected: you repeated the exact same tool call without modifying it. Please fix the parameters or stop.");
      }
      lastActionStr = jsonStr;
      
      action = JSON.parse(jsonStr);
    } catch (e) {
      history.push({ role: 'user', content: buildVisionContent(`Error parsing JSON tool call. Please respond ONLY with a valid JSON object matching the requested tool formats. Error: ${e.message}`)});
      continue;
    }

    if (!action || !action.tool) break;

    onStatus(`Running ${action.tool}...`);

    if (action.tool === 'show_msg_to_user') {
      onMessage(action.message);
      history.push({ role: 'user', content: buildVisionContent(`[User acknowledged message]\n\n${imageSessionStore.toContextString()}`) });
      continue;
    }

    if (action.tool === 'show_img') {
      const entry = imageSessionStore.get(action.imageId);
      if (entry) onImage(entry.dataUrl, action.imageId);
      break;
    }

    if (action.tool === 'exitred') {
      if (onExitRed) onExitRed(action.message);
      break;
    }

    let result;
    switch (action.tool) {
      case 'generate_image':
        result = await tools.generateImageTool(action.prompt, action.neg_prompt, action.width, action.height);
        break;
      case 'remove_background':
        result = await tools.removeBackgroundTool(action.imageId);
        break;
      case 'composite_images':
        result = await tools.compositeImagesTool(action.baseImageId, action.overlayImageId, action.alignX, action.alignY, action.scaleMode);
        break;
      case 'add_text':
        result = await tools.addTextTool(action.imageId, action.text, action.alignX, action.alignY, action.fontSize, action.color, action.fontFamily, action.bold, action.shadow);
        break;
      case 'resize_image':
        result = await tools.resizeImageTool(action.imageId, action.width, action.height);
        break;
      case 'crop_image':
        result = await tools.cropImageTool(action.imageId, action.x, action.y, action.width, action.height);
        break;
      case 'adjust_image':
        result = await tools.adjustImageTool(action.imageId, action.brightness, action.contrast, action.saturation, action.hue);
        break;
      case 'flip_image':
        result = await tools.flipImageTool(action.imageId, action.direction);
        break;
      case 'fill_background':
        result = await tools.fillBackgroundTool(action.imageId, action.color);
        break;
      default:
        result = { error: `Unknown tool: ${action.tool}` };
    }

    history.push({
      role: 'user',
      content: buildVisionContent(`Tool "${action.tool}" result: ${JSON.stringify(result)}\n\n${imageSessionStore.toContextString()}`)
    });
  }
}
