/* ════════════════════════════════════════════════════════════════════
   ComfyUI Service — Image generation via Anima model
   ════════════════════════════════════════════════════════════════════ */

import { settingsStore } from './settings-store.js';

/**
 * Build the Anima workflow in ComfyUI API format
 */
function buildAnimaWorkflow(prompt, negPrompt, settings) {
  const seed = Math.floor(Math.random() * 2 ** 32);
  const steps = settings.comfyui_steps ?? 30;
  const cfg = settings.comfyui_cfg ?? 4.5;
  const width = settings.comfyui_width ?? 832;
  const height = settings.comfyui_height ?? 1216;
  const sampler = settings.comfyui_sampler ?? 'euler';
  const scheduler = settings.comfyui_scheduler ?? 'normal';
  const unetName = settings.comfyui_unet_name ?? 'anima_baseV10.safetensors';
  const clipName = settings.comfyui_clip_name ?? 'qwen_3_06b_base.safetensors';
  const vaeName = settings.comfyui_vae_name ?? 'qwen_image_vae.safetensors';

  return {
    "1": {
      "class_type": "UNETLoader",
      "inputs": {
        "unet_name": unetName,
        "weight_dtype": "default"
      }
    },
    "2": {
      "class_type": "CLIPLoader",
      "inputs": {
        "clip_name": clipName,
        "type": "stable_diffusion"
      }
    },
    "3": {
      "class_type": "VAELoader",
      "inputs": {
        "vae_name": vaeName
      }
    },
    "4": {
      "class_type": "CLIPTextEncode",
      "inputs": {
        "text": prompt,
        "clip": ["2", 0]
      }
    },
    "5": {
      "class_type": "CLIPTextEncode",
      "inputs": {
        "text": negPrompt || "lowres, bad anatomy, worst quality, blurry, watermark",
        "clip": ["2", 0]
      }
    },
    "6": {
      "class_type": "EmptyLatentImage",
      "inputs": {
        "width": width,
        "height": height,
        "batch_size": 1
      }
    },
    "7": {
      "class_type": "KSampler",
      "inputs": {
        "model": ["1", 0],
        "positive": ["4", 0],
        "negative": ["5", 0],
        "latent_image": ["6", 0],
        "seed": seed,
        "steps": steps,
        "cfg": cfg,
        "sampler_name": sampler,
        "scheduler": scheduler,
        "denoise": 1.0
      }
    },
    "8": {
      "class_type": "VAEDecode",
      "inputs": {
        "samples": ["7", 0],
        "vae": ["3", 0]
      }
    },
    "9": {
      "class_type": "SaveImage",
      "inputs": {
        "images": ["8", 0],
        "filename_prefix": "vibechat_"
      }
    }
  };
}

/**
 * Check if ComfyUI is reachable
 * @param {string} url - ComfyUI base URL
 * @returns {Promise<boolean>}
 */
export async function checkComfyUIConnection(url) {
  try {
    const baseUrl = (url || 'http://localhost:8188').replace(/\/$/, '');
    const resp = await fetch(`${baseUrl}/system_stats`, { method: 'GET' });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Generate an image via ComfyUI using the Anima workflow
 * @param {string} prompt - The positive text prompt
 * @param {object} [overrideSettings] - Optional settings override
 * @returns {Promise<string>} - Object URL of the generated image blob
 */
export async function generateImageComfyUI(prompt, overrideSettings = null, signal = null) {
  const settings = overrideSettings || settingsStore.get();
  const baseUrl = (settings.comfyui_url || 'http://localhost:8188').replace(/\/$/, '');
  const negPrompt = settings.comfyui_negative_prompt || 'lowres, bad anatomy, worst quality, blurry';
  const clientId = `vibechat_${Date.now()}`;

  if (signal?.aborted) throw new Error('Image generation stopped by user');

  // 1. Build workflow
  const workflow = buildAnimaWorkflow(prompt, negPrompt, settings);

  // 2. Queue the prompt
  const queueResp = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      prompt: workflow
    }),
    signal
  });

  if (!queueResp.ok) {
    const errText = await queueResp.text();
    throw new Error(`ComfyUI queue error: ${queueResp.status} — ${errText}`);
  }

  const { prompt_id: promptId } = await queueResp.json();
  if (!promptId) throw new Error('No prompt_id returned from ComfyUI');

  // 3. Poll /history until the image is ready (max 5 minutes)
  const maxWaitMs = 5 * 60 * 1000;
  const pollIntervalMs = 1000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    if (signal?.aborted) throw new Error('Image generation stopped by user');

    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, pollIntervalMs);
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Image generation stopped by user'));
        });
      }
    });

    if (signal?.aborted) throw new Error('Image generation stopped by user');

    const histResp = await fetch(`${baseUrl}/history/${promptId}`, { signal });
    if (!histResp.ok) continue;

    const hist = await histResp.json();
    const entry = hist[promptId];
    if (!entry) continue;

    // Check for error state
    if (entry.status?.status_str === 'error') {
      const errMsg = entry.status?.messages?.find(m => m[0] === 'error')?.[1]?.exception_message || 'Unknown ComfyUI error';
      throw new Error(`ComfyUI generation error: ${errMsg}`);
    }

    // Check if outputs exist
    if (entry.outputs) {
      // Find the SaveImage node output (node "9")
      const saveNode = entry.outputs['9'];
      if (saveNode && saveNode.images && saveNode.images.length > 0) {
        const img = saveNode.images[0];
        const imageUrl = `${baseUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`;

        // 4. Return the ComfyUI hosted image URL directly
        return imageUrl;
      }
    }
  }

  throw new Error('ComfyUI generation timed out after 5 minutes');
}

/**
 * Build an image generation prompt from scene context
 * @param {object} context - App context with character, scene, etc.
 * @returns {string}
 */
export function buildAutoPromptFromContext(context) {
  const parts = ['anime illustration, high quality, detailed'];

  if (context.characterName) {
    parts.push(`character: ${context.characterName}`);
  }
  if (context.characterDescription) {
    // Take first 120 chars to keep prompt concise
    parts.push(context.characterDescription.substring(0, 120));
  }
  if (context.sceneSummary) {
    parts.push(context.sceneSummary.substring(0, 150));
  }

  parts.push('best quality, masterpiece, 8k');
  return parts.join(', ');
}

/**
 * Upload a base64 data URL image to ComfyUI's /upload/image endpoint.
 * @param {string} baseUrl - ComfyUI server base URL
 * @param {string} dataUrl - base64 data URL of the image
 * @returns {Promise<string>} - filename returned by ComfyUI
 */
async function uploadImageToComfyUI(baseUrl, dataUrl) {
  // Convert data URL to Blob
  const res = await fetch(dataUrl);
  const blob = await res.blob();

  const formData = new FormData();
  const filename = `vibechat_rembg_${Date.now()}.png`;
  formData.append('image', blob, filename);
  formData.append('overwrite', 'true');
  formData.append('type', 'input');

  const resp = await fetch(`${baseUrl}/upload/image`, {
    method: 'POST',
    body: formData
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ComfyUI upload error: ${resp.status} — ${errText}`);
  }

  const json = await resp.json();
  // ComfyUI returns { name, subfolder, type }
  return json.name;
}

/**
 * Remove the background of an image using ComfyUI + WAS Node Suite rembg node.
 * @param {string} dataUrl - base64 image data URL
 * @param {object} [overrideSettings] - optional settings override
 * @param {AbortSignal} [signal] - optional abort signal
 * @returns {Promise<string>} - base64 data URL of the result image (transparent PNG)
 */
export async function removeBackgroundComfyUI(dataUrl, overrideSettings = null, signal = null) {
  const settings = overrideSettings || settingsStore.get();
  const baseUrl = (settings.comfyui_url || 'http://localhost:8188').replace(/\/$/, '');
  const clientId = `vibechat_rembg_${Date.now()}`;

  if (signal?.aborted) throw new Error('Background removal stopped by user');

  // 1. Upload image to ComfyUI
  const uploadedFilename = await uploadImageToComfyUI(baseUrl, dataUrl);

  // 2. Build workflow using WAS Node Suite (Revised):
  //    LoadImage → Image Rembg (Remove Background) → Image Save
  const workflow = {
    "1": {
      "class_type": "LoadImage",
      "inputs": {
        "image": uploadedFilename,
        "upload": "image"
      }
    },
    "2": {
      "class_type": "Image Rembg (Remove Background)",
      "inputs": {
        "images": ["1", 0],
        "transparency": true,
        "model": "isnet-anime",
        "post_processing": false,
        "only_mask": false,
        "alpha_matting": false,
        "alpha_matting_foreground_threshold": 240,
        "alpha_matting_background_threshold": 10,
        "alpha_matting_erode_size": 10,
        "background_color": "none"
      }
    },
    "3": {
      "class_type": "Image Save",
      "inputs": {
        "images": ["2", 0],
        "output_path": "",
        "filename_prefix": "vibechat_rembg_out",
        "filename_delimiter": "_",
        "filename_number_padding": 4,
        "filename_number_start": "false",
        "extension": "png",
        "dpi": 96,
        "quality": 100,
        "optimize_image": "false",
        "lossless_webp": "false",
        "overwrite_mode": "false",
        "show_history": "false",
        "show_history_by_prefix": "false",
        "embed_workflow": "false",
        "show_previews": "true"
      }
    }
  };

  // 3. Queue the prompt
  const queueResp = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, prompt: workflow }),
    signal
  });

  if (!queueResp.ok) {
    const errText = await queueResp.text();
    throw new Error(`ComfyUI rembg queue error: ${queueResp.status} — ${errText}`);
  }

  const { prompt_id: promptId } = await queueResp.json();
  if (!promptId) throw new Error('No prompt_id returned from ComfyUI for rembg');

  // 4. Poll /history until done (max 3 minutes)
  const maxWaitMs = 3 * 60 * 1000;
  const pollIntervalMs = 1000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    if (signal?.aborted) throw new Error('Background removal stopped by user');

    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, pollIntervalMs);
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Background removal stopped by user'));
        });
      }
    });

    if (signal?.aborted) throw new Error('Background removal stopped by user');

    const histResp = await fetch(`${baseUrl}/history/${promptId}`, { signal });
    if (!histResp.ok) continue;

    const hist = await histResp.json();
    const entry = hist[promptId];
    if (!entry) continue;

    if (entry.status?.status_str === 'error') {
      const errMsg = entry.status?.messages?.find(m => m[0] === 'error')?.[1]?.exception_message || 'Unknown ComfyUI rembg error';
      throw new Error(`ComfyUI rembg error: ${errMsg}`);
    }

    if (entry.outputs) {
      const saveNode = entry.outputs['3'];
      if (saveNode?.images?.length > 0) {
        const img = saveNode.images[0];
        const imageUrl = `${baseUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`;

        // Fetch and return as base64
        const imgResp = await fetch(imageUrl, { signal });
        if (!imgResp.ok) throw new Error(`Failed to fetch rembg result: ${imgResp.status}`);
        const blob = await imgResp.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
    }
  }

  throw new Error('ComfyUI background removal timed out after 3 minutes');
}
