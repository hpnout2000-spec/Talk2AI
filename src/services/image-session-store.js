/**
 * Image Session Store
 * 
 * In-memory registry for keeping track of all generated and edited images
 * during a single Sub-AI (Image Editor) session.
 */

class ImageSessionStore {
  constructor() {
    this.images = new Map();
    this.idCounter = 1;
  }

  /**
   * Clears the session store. Called at the start of a new editing task.
   */
  clear() {
    this.images.clear();
    this.idCounter = 1;
  }

  /**
   * Generates a new incremental ID.
   */
  _generateId() {
    const id = `img_${this.idCounter.toString().padStart(3, '0')}`;
    this.idCounter++;
    return id;
  }

  /**
   * Adds a new image to the session store.
   * 
   * @param {string} dataUrl - Base64 data URL of the image
   * @param {string} source - Origin of the image (e.g., 'generated', 'bg_removed', 'composited', etc.)
   * @param {string} description - Brief description of what this image contains
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @returns {object} The created image entry containing the new id
   */
  add(dataUrl, source, description, width, height) {
    const id = this._generateId();
    const entry = {
      id,
      dataUrl,
      source,
      description,
      width,
      height,
      createdAt: Date.now()
    };
    this.images.set(id, entry);
    return entry;
  }

  /**
   * Retrieves an image entry by ID.
   * 
   * @param {string} id - The image ID (e.g., 'img_001')
   * @returns {object|null} The image entry or null if not found
   */
  get(id) {
    return this.images.get(id) || null;
  }

  /**
   * Returns all images currently in the store.
   * 
   * @returns {Array<object>} Array of all image entries
   */
  getAll() {
    return Array.from(this.images.values());
  }

  /**
   * Generates a formatted string of available images to be injected 
   * into the Sub-AI's system context.
   * 
   * @returns {string} Formatted context string
   */
  toContextString() {
    if (this.images.size === 0) {
      return "No images currently available.";
    }

    let output = "AVAILABLE IMAGES:\n";
    for (const [id, entry] of this.images.entries()) {
      output += `- [${id}] (Size: ${entry.width}x${entry.height}, Source: ${entry.source}) Description: ${entry.description}\n`;
    }
    return output;
  }
}

export const imageSessionStore = new ImageSessionStore();
