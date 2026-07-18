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
export async function fetchAsBase64(url) {
  try {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (invoke) {
      try {
        return await invoke('fetch_image_base64', { url });
      } catch (tauriErr) {
        console.warn('Failed to fetch image as base64 via Tauri, falling back to standard fetch:', tauriErr);
      }
    }
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
 * Canvas-based background removal using BFS flood-fill from image edges.
 * Based on the Marinara Engine approach: marks background pixels starting from
 * the borders, then soft-erases them while preserving interior white areas
 * (teeth, eyes, clothes, etc.).
 *
 * @param {string} dataUrl - input image data URL
 * @param {number} strength - 0-100, cleanup aggressiveness (default 50)
 * @returns {Promise<string>} - PNG data URL with transparent background
 */
async function removeWhiteBackgroundCanvas(dataUrl, strength = 50) {
  const img = await loadImageFromDataUrl(dataUrl);
  const w = img.width;
  const h = img.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;

  // Thresholds based on strength
  const hardCutoff = 14 + (strength / 100) * 32;  // 14..46
  const softCutoff = hardCutoff + 30 + (strength / 100) * 42; // 44..118

  // Helper: is pixel near-white/matte?
  function isMattePixel(idx) {
    const r = d[idx], g = d[idx + 1], b = d[idx + 2];
    const brightness = (r + g + b) / 3;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    return brightness > (255 - softCutoff) && spread < 40;
  }

  // --- Phase 1: BFS flood-fill from edges to mark background ---
  const bgMask = new Uint8Array(w * h); // 0 = foreground, 1 = background
  const queue = new Int32Array(w * h);
  let qStart = 0, qEnd = 0;

  const enqueue = (px) => {
    if (bgMask[px] === 0 && isMattePixel(px * 4)) {
      bgMask[px] = 1;
      queue[qEnd++] = px;
    }
  };

  // Seed from all 4 edges
  for (let x = 0; x < w; x++) {
    enqueue(x);             // top row
    enqueue((h - 1) * w + x); // bottom row
  }
  for (let y = 0; y < h; y++) {
    enqueue(y * w);         // left col
    enqueue(y * w + w - 1); // right col
  }

  // BFS expand
  while (qStart < qEnd) {
    const px = queue[qStart++];
    const x = px % w;
    const y = Math.floor(px / w);
    if (x > 0)     enqueue(px - 1);
    if (x < w - 1) enqueue(px + 1);
    if (y > 0)     enqueue(px - w);
    if (y < h - 1) enqueue(px + w);
  }

  // --- Phase 2: Apply transparency + edge decontamination ---
  const edgeRestoreWeight = Math.max(0, (62 - strength) / 85) * 0.55;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const idx = (py * w + px) * 4;
      const pxIndex = py * w + px;

      if (bgMask[pxIndex] === 1) {
        // Background pixel: make transparent, softness based on distance from hard cutoff
        const brightness = (d[idx] + d[idx + 1] + d[idx + 2]) / 3;
        const t = Math.max(0, Math.min(1, (brightness - (255 - softCutoff)) / (softCutoff - hardCutoff)));
        d[idx + 3] = Math.round(d[idx + 3] * (1 - t));
      } else if (edgeRestoreWeight > 0) {
        // Foreground pixel near edge: slightly desaturate contamination from matte
        let hasBgNeighbor = false;
        if (px > 0 && bgMask[pxIndex - 1]) hasBgNeighbor = true;
        else if (px < w - 1 && bgMask[pxIndex + 1]) hasBgNeighbor = true;
        else if (py > 0 && bgMask[pxIndex - w]) hasBgNeighbor = true;
        else if (py < h - 1 && bgMask[pxIndex + w]) hasBgNeighbor = true;

        if (hasBgNeighbor) {
          // Slightly reduce alpha of edge pixels to remove matte halo
          d[idx + 3] = Math.max(0, Math.round(d[idx + 3] * (1 - edgeRestoreWeight * 0.4)));
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Removes background using ComfyUI + WAS Node Suite (Revised) rembg node.
 * Falls back to BFS canvas-based white background removal if the node is not installed.
 */
export async function removeBackgroundTool(imageId) {
  const entry = imageSessionStore.get(imageId);
  if (!entry) return { error: `Image "${imageId}" not found.` };

  try {
    const { removeBackgroundComfyUI } = await import('./comfyui-service.js');
    const resultDataUrl = await removeBackgroundComfyUI(entry.dataUrl, false);
    if (!resultDataUrl || !resultDataUrl.startsWith('data:image')) {
      throw new Error('Invalid result: not a valid data URL');
    }
    const imgEl = await loadImageFromDataUrl(resultDataUrl);
    const newEntry = imageSessionStore.add(resultDataUrl, 'bg_removed', `Transparent version of ${imageId}`, imgEl.width, imgEl.height);
    return { success: true, imageId: newEntry.id };
  } catch (err) {
    const isNodeMissing = err.message && (
      err.message.includes('missing_node_type') ||
      err.message.includes('not found') ||
      err.message.includes('not installed') ||
      err.message.includes('class_type') ||
      err.message.includes('Image Rembg')
    );

    if (isNodeMissing) {
      console.warn('[removeBackgroundTool] ComfyUI AI rembg node failed, trying Alpha node fallback...');
      try {
        const { removeBackgroundComfyUI } = await import('./comfyui-service.js');
        const alphaDataUrl = await removeBackgroundComfyUI(entry.dataUrl, true);
        if (!alphaDataUrl || !alphaDataUrl.startsWith('data:image')) {
          throw new Error('Invalid result from Alpha node');
        }
        const imgEl = await loadImageFromDataUrl(alphaDataUrl);
        const newEntry = imageSessionStore.add(alphaDataUrl, 'bg_removed_alpha', `Transparent version of ${imageId} (Alpha node)`, imgEl.width, imgEl.height);
        return { success: true, imageId: newEntry.id, note: 'Used ComfyUI Alpha fallback' };
      } catch (alphaErr) {
        console.warn('[removeBackgroundTool] ComfyUI Alpha node also failed, using BFS canvas fallback...');
        try {
          const resultDataUrl = await removeWhiteBackgroundCanvas(entry.dataUrl, 50);
          const imgEl = await loadImageFromDataUrl(resultDataUrl);
          const newEntry = imageSessionStore.add(resultDataUrl, 'bg_removed_canvas', `Transparent version of ${imageId} (canvas)`, imgEl.width, imgEl.height);
          return { success: true, imageId: newEntry.id, note: 'Used canvas BFS fallback (WAS nodes failed)' };
        } catch (fallbackErr) {
          return { error: `Background removal failed (canvas fallback): ${fallbackErr.message}` };
        }
      }
    }
    return { error: `Background removal failed: ${err.message}` };
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

/**
 * Crops an image
 */
export async function cropImageTool(imageId, x, y, width, height) {
  const entry = imageSessionStore.get(imageId);
  if (!entry) return { error: `Image "${imageId}" not found.` };

  try {
    const img = await loadImageFromDataUrl(entry.dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = Number(width);
    canvas.height = Number(height);
    const ctx = canvas.getContext('2d');

    ctx.drawImage(img, Number(x), Number(y), Number(width), Number(height), 0, 0, Number(width), Number(height));

    const newDataUrl = canvas.toDataURL('image/png');
    const newEntry = imageSessionStore.add(newDataUrl, "cropped", `Cropped to ${width}x${height}`, canvas.width, canvas.height);
    return { success: true, imageId: newEntry.id };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Flips an image horizontally or vertically
 */
export async function flipImageTool(imageId, direction) {
  const entry = imageSessionStore.get(imageId);
  if (!entry) return { error: `Image "${imageId}" not found.` };

  try {
    const img = await loadImageFromDataUrl(entry.dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');

    ctx.save();
    if (direction === 'horizontal' || direction === 'both') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    if (direction === 'vertical' || direction === 'both') {
      ctx.translate(0, canvas.height);
      ctx.scale(1, -1);
    }
    ctx.drawImage(img, 0, 0);
    ctx.restore();

    const newDataUrl = canvas.toDataURL('image/png');
    const newEntry = imageSessionStore.add(newDataUrl, "flipped", `Flipped ${direction}`, canvas.width, canvas.height);
    return { success: true, imageId: newEntry.id };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Fills the background of a transparent image with a color
 */
export async function fillBackgroundTool(imageId, color) {
  const entry = imageSessionStore.get(imageId);
  if (!entry) return { error: `Image "${imageId}" not found.` };

  try {
    const img = await loadImageFromDataUrl(entry.dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const newDataUrl = canvas.toDataURL('image/png');
    const newEntry = imageSessionStore.add(newDataUrl, "bg_filled", `Filled background with ${color}`, canvas.width, canvas.height);
    return { success: true, imageId: newEntry.id };
  } catch (err) {
    return { error: err.message };
  }
}

