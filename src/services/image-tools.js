/**
 * Image Tools
 * 
 * Toolset for the AI Image Editor agent. Uses Canvas API for manipulations.
 */

import { imageSessionStore } from './image-session-store.js';
import { generateImageComfyUI } from './comfyui-service.js';

// Helper to load image from data URL
export function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// Helper to convert ComfyUI URL to base64 DataUrl to avoid Canvas tainting
async function fetchAsBase64(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.error('Failed to fetch image as base64:', err);
    throw err;
  }
}

/**
 * Generates a new image using ComfyUI.
 */
export async function generateImageTool(prompt, negPrompt, width, height) {
  try {
    const settings = {
      comfyui_width: width || 832,
      comfyui_height: height || 1216,
      comfyui_negative_prompt: negPrompt || "lowres, bad anatomy, worst quality, blurry"
    };

    // This returns the ComfyUI URL
    const imageUrl = await generateImageComfyUI(prompt, settings);
    
    // Fetch it as base64 to avoid CORS/Tainting issues in Canvas
    const dataUrl = await fetchAsBase64(imageUrl);
    
    const entry = imageSessionStore.add(dataUrl, "generated", prompt, settings.comfyui_width, settings.comfyui_height);
    return { success: true, imageId: entry.id, width: entry.width, height: entry.height };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

/**
 * Canvas-based white background removal fallback.
 * Works well for images generated with a white/near-white background.
 * @param {string} dataUrl - input image data URL
 * @param {number} threshold - 0-255, pixels brighter than this are removed (default 230)
 * @returns {Promise<string>} - PNG data URL with transparent background
 */
async function removeWhiteBackgroundCanvas(dataUrl, threshold = 230) {
  const img = await loadImageFromDataUrl(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Remove pixels that are near-white
    if (r > threshold && g > threshold && b > threshold) {
      // Soft edge: partially transparent for pixels in the 200-threshold range
      const brightness = (r + g + b) / 3;
      const alpha = Math.round(((255 - brightness) / (255 - threshold)) * 255 * 3);
      data[i + 3] = Math.max(0, Math.min(255, alpha));
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Removes background using ComfyUI + WAS Node Suite (Revised) rembg node.
 * Falls back to canvas-based white background removal if the ComfyUI node is not installed.
 */
export async function removeBackgroundTool(imageId) {
  const entry = imageSessionStore.get(imageId);
  if (!entry) return { error: `Image "${imageId}" not found.` };

  try {
    const { removeBackgroundComfyUI } = await import('./comfyui-service.js');
    const resultDataUrl = await removeBackgroundComfyUI(entry.dataUrl);
    const newEntry = imageSessionStore.add(resultDataUrl, "bg_removed", `Transparent version of ${imageId}`, entry.width, entry.height);
    return { success: true, imageId: newEntry.id };
  } catch (err) {
    // Fallback: canvas-based white background removal
    const isNodeMissing = err.message && (
      err.message.includes('missing_node_type') ||
      err.message.includes('not found') ||
      err.message.includes('not installed')
    );
    if (isNodeMissing) {
      console.warn('[removeBackgroundTool] ComfyUI rembg node not installed, using canvas fallback...');
      try {
        const resultDataUrl = await removeWhiteBackgroundCanvas(entry.dataUrl);
        const newEntry = imageSessionStore.add(resultDataUrl, "bg_removed_canvas", `Transparent version of ${imageId} (canvas)`, entry.width, entry.height);
        return { success: true, imageId: newEntry.id, note: 'Used canvas fallback (WAS node not installed)' };
      } catch (fallbackErr) {
        return { error: `Background removal failed (canvas fallback): ${fallbackErr.message}` };
      }
    }
    return { error: err.message || 'Background removal failed' };
  }
}

/**
 * Composites one image over another with support for relative positioning.
 * 
 * @param {string} baseImageId 
 * @param {string} overlayImageId 
 * @param {number|string} alignX - e.g. "center", "left", "right", or absolute X pixel
 * @param {number|string} alignY - e.g. "center", "top", "bottom", or absolute Y pixel
 * @param {number} scaleMode - e.g. "fit_height_80", "original", or specific width pixel
 */
export async function compositeImagesTool(baseImageId, overlayImageId, alignX = "center", alignY = "center", scaleMode = "original") {
  const baseEntry = imageSessionStore.get(baseImageId);
  const overlayEntry = imageSessionStore.get(overlayImageId);
  
  if (!baseEntry) return { error: `Base image "${baseImageId}" not found.` };
  if (!overlayEntry) return { error: `Overlay image "${overlayImageId}" not found.` };

  try {
    const baseImg = await loadImageFromDataUrl(baseEntry.dataUrl);
    const overlayImg = await loadImageFromDataUrl(overlayEntry.dataUrl);

    const canvas = document.createElement('canvas');
    canvas.width = baseImg.width;
    canvas.height = baseImg.height;
    const ctx = canvas.getContext('2d');

    // Draw base
    ctx.drawImage(baseImg, 0, 0);

    // Calculate overlay size
    let drawWidth = overlayImg.width;
    let drawHeight = overlayImg.height;
    const aspect = overlayImg.width / overlayImg.height;

    if (typeof scaleMode === 'string' && scaleMode.startsWith('fit_height_')) {
      const pct = parseInt(scaleMode.split('_')[2]) / 100;
      drawHeight = canvas.height * pct;
      drawWidth = drawHeight * aspect;
    } else if (typeof scaleMode === 'string' && scaleMode.startsWith('fit_width_')) {
      const pct = parseInt(scaleMode.split('_')[2]) / 100;
      drawWidth = canvas.width * pct;
      drawHeight = drawWidth / aspect;
    } else if (typeof scaleMode === 'number') {
      // Assuming scaleMode number implies specific width
      drawWidth = scaleMode;
      drawHeight = drawWidth / aspect;
    }

    // Calculate position
    let drawX = 0;
    let drawY = 0;

    if (alignX === "center") drawX = (canvas.width - drawWidth) / 2;
    else if (alignX === "left") drawX = 0;
    else if (alignX === "right") drawX = canvas.width - drawWidth;
    else drawX = Number(alignX) || 0;

    if (alignY === "center") drawY = (canvas.height - drawHeight) / 2;
    else if (alignY === "top") drawY = 0;
    else if (alignY === "bottom") drawY = canvas.height - drawHeight;
    else drawY = Number(alignY) || 0;

    ctx.drawImage(overlayImg, drawX, drawY, drawWidth, drawHeight);

    const newDataUrl = canvas.toDataURL('image/png');
    const newEntry = imageSessionStore.add(newDataUrl, "composited", `Composited ${overlayImageId} on ${baseImageId}`, canvas.width, canvas.height);
    
    return { success: true, imageId: newEntry.id };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Adds text to an image
 */
export async function addTextTool(imageId, text, alignX = "center", alignY = "bottom", fontSize = 64, color = "#FFFFFF", fontFamily = "sans-serif", bold = true, shadow = true) {
  const entry = imageSessionStore.get(imageId);
  if (!entry) return { error: `Image "${imageId}" not found.` };

  try {
    const img = await loadImageFromDataUrl(entry.dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');

    ctx.drawImage(img, 0, 0);

    const weight = bold ? "bold " : "";
    ctx.font = `${weight}${fontSize}px ${fontFamily}`;
    
    // Position parsing
    let x = 0;
    let y = 0;

    ctx.textAlign = (alignX === "center" || alignX === "left" || alignX === "right") ? alignX : "left";
    ctx.textBaseline = "middle";

    if (alignX === "center") x = canvas.width / 2;
    else if (alignX === "right") x = canvas.width - 20;
    else if (alignX === "left") x = 20;
    else x = Number(alignX) || 0;

    if (alignY === "center") y = canvas.height / 2;
    else if (alignY === "top") y = fontSize + 20;
    else if (alignY === "bottom") y = canvas.height - fontSize - 20;
    else y = Number(alignY) || 0;

    if (shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
    }

    ctx.fillStyle = color;
    ctx.fillText(text, x, y);

    const newDataUrl = canvas.toDataURL('image/png');
    const newEntry = imageSessionStore.add(newDataUrl, "text_added", `Added text "${text}"`, canvas.width, canvas.height);
    return { success: true, imageId: newEntry.id };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Resizes an image
 */
export async function resizeImageTool(imageId, width, height) {
  const entry = imageSessionStore.get(imageId);
  if (!entry) return { error: `Image "${imageId}" not found.` };

  try {
    const img = await loadImageFromDataUrl(entry.dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = Number(width);
    canvas.height = Number(height);
    const ctx = canvas.getContext('2d');

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const newDataUrl = canvas.toDataURL('image/png');
    const newEntry = imageSessionStore.add(newDataUrl, "resized", `Resized to ${width}x${height}`, canvas.width, canvas.height);
    return { success: true, imageId: newEntry.id };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Adjust brightness/contrast/saturation
 */
export async function adjustImageTool(imageId, brightness = 100, contrast = 100, saturation = 100, hue = 0) {
  const entry = imageSessionStore.get(imageId);
  if (!entry) return { error: `Image "${imageId}" not found.` };

  try {
    const img = await loadImageFromDataUrl(entry.dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');

    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) hue-rotate(${hue}deg)`;
    ctx.drawImage(img, 0, 0);

    const newDataUrl = canvas.toDataURL('image/png');
    const newEntry = imageSessionStore.add(newDataUrl, "adjusted", `Adjusted filters`, canvas.width, canvas.height);
    return { success: true, imageId: newEntry.id };
  } catch (err) {
    return { error: err.message };
  }
}
