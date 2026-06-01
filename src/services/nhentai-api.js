/* ════════════════════════════════════════════════════════════════════
   nhentai API v2 Client Service
   ════════════════════════════════════════════════════════════════════ */

import { settingsStore } from './settings-store.js';

async function invokeTauri(cmd, args = {}) {
  if (window.__TAURI_INTERNALS__) {
    return await window.__TAURI_INTERNALS__.invoke(cmd, args);
  }
  throw new Error('Not running in Tauri environment');
}

let cachedCdn = null;

/**
 * Loads and caches CDN servers configuration from the nhentai API
 */
async function getCdnConfig(apiKey) {
  if (cachedCdn) return cachedCdn;
  
  const base = settingsStore.get().nhentai_api_url || 'https://nhentai.net';

  try {
    const responseText = await invokeTauri('nhentai_request', {
      url: `${base}/api/v2/cdn`,
      method: 'GET',
      body: null,
      apiKey: apiKey || null
    });
    cachedCdn = JSON.parse(responseText);
    return cachedCdn;
  } catch (e) {
    console.warn('Failed to load nhentai CDN config from /cdn via Rust, trying /config fallback:', e);
  }

  // Fallback to /config
  try {
    const responseText = await invokeTauri('nhentai_request', {
      url: `${base}/api/v2/config`,
      method: 'GET',
      body: null,
      apiKey: apiKey || null
    });
    const data = JSON.parse(responseText);
    cachedCdn = {
      image_servers: data.image_servers || [],
      thumb_servers: data.thumb_servers || []
    };
    return cachedCdn;
  } catch (e) {
    console.error('Failed to load nhentai config fallback via Rust:', e);
  }

  return {
    image_servers: ['https://i.nhentai.net'],
    thumb_servers: ['https://t.nhentai.net']
  };
}

/**
 * Makes a secure request to the nhentai API
 */
async function apiRequest(endpoint, method = 'GET', body = null) {
  const settings = settingsStore.get();
  const base = settings.nhentai_api_url || 'https://nhentai.net';
  const url = `${base.endsWith('/') ? base.slice(0, -1) : base}${endpoint}`;

  let key = '';
  try {
    key = await invokeTauri('load_credential', { provider: 'nhentai' });
  } catch (e) {
    key = localStorage.getItem('nhentai_api_key_fallback') || '';
  }

  // Route request via Rust Tauri command to completely bypass CORS!
  try {
    const responseText = await invokeTauri('nhentai_request', {
      url,
      method,
      body: body ? JSON.stringify(body) : null,
      apiKey: key || null
    });
    return JSON.parse(responseText);
  } catch (err) {
    throw new Error(err.message || err);
  }
}

export const nhentaiApi = {
  /**
   * Helper to construct a full image/thumbnail URL using returned CDN hostnames
   */
  async getFullImageUrl(path, isThumbnail = false) {
    let key = '';
    try {
      key = await invokeTauri('load_credential', { provider: 'nhentai' });
    } catch (e) {
      key = localStorage.getItem('nhentai_api_key_fallback') || '';
    }
    const cdn = await getCdnConfig(key);
    const servers = isThumbnail ? cdn.thumb_servers : cdn.image_servers;
    const server = servers[0] || (isThumbnail ? 'https://t.nhentai.net' : 'https://i.nhentai.net');
    const cleanServer = server.endsWith('/') ? server.slice(0, -1) : server;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanServer + cleanPath;
  },

  /**
   * Fetch cover image for a gallery as base64 data URL via Rust proxy.
   * Reads the actual image path from the gallery API response.
   */
  async getCoverImageBase64(gallery_id) {
    const gallery = await this.getGallery(gallery_id);
    console.log('[nhentai] getCoverImageBase64 gallery response keys:', Object.keys(gallery));

    // Try to extract a path from the API response
    // nhentai v2 may return cover path in various locations
    let imagePath = null;

    if (gallery.images?.cover?.path) {
      imagePath = gallery.images.cover.path;
    } else if (gallery.cover?.path) {
      imagePath = gallery.cover.path;
    } else if (gallery.media_id) {
      // Fallback: construct path from media_id (classic nhentai format)
      const coverImg = gallery.images?.cover;
      const ext = coverImg?.t === 'p' ? 'png' : coverImg?.t === 'g' ? 'gif' : 'jpg';
      imagePath = `/galleries/${gallery.media_id}/cover.${ext}`;
    }

    if (!imagePath) {
      console.error('[nhentai] getCoverImageBase64: no image path found. Gallery structure:', JSON.stringify(gallery).slice(0, 400));
      throw new Error('Could not extract cover image path from gallery data. Check console for structure details.');
    }

    const imageUrl = await this.getFullImageUrl(imagePath, true);
    console.log('[nhentai] getCoverImageBase64: fetching URL:', imageUrl);

    let key = '';
    try { key = await invokeTauri('load_credential', { provider: 'nhentai' }); } catch (e) { key = ''; }
    return await invokeTauri('nhentai_fetch_image_base64', { url: imageUrl, apiKey: key || null });
  },

  /**
   * Fetch a specific page image for a gallery as base64 data URL via Rust proxy.
   * page_num is 1-indexed.
   */
  async getPageImageBase64(gallery_id, page_num = 1) {
    const gallery = await this.getGallery(gallery_id);
    console.log('[nhentai] getPageImageBase64 gallery response keys:', Object.keys(gallery));

    let imagePath = null;
    const pageIndex = page_num - 1; // 0-based

    // Try to find page path in API response
    if (Array.isArray(gallery.images?.pages) && gallery.images.pages[pageIndex]) {
      const page = gallery.images.pages[pageIndex];
      if (page.path) {
        imagePath = page.path;
      } else if (gallery.media_id) {
        const ext = page.t === 'p' ? 'png' : page.t === 'g' ? 'gif' : 'jpg';
        imagePath = `/galleries/${gallery.media_id}/${page_num}.${ext}`;
      }
    } else if (Array.isArray(gallery.pages) && gallery.pages[pageIndex]) {
      const page = gallery.pages[pageIndex];
      imagePath = page.path || null;
    } else if (gallery.media_id) {
      // Fallback: construct path from media_id assuming jpg
      imagePath = `/galleries/${gallery.media_id}/${page_num}.jpg`;
    }

    if (!imagePath) {
      console.error('[nhentai] getPageImageBase64: no image path found. Gallery structure:', JSON.stringify(gallery).slice(0, 400));
      throw new Error(`Could not extract page ${page_num} image path. Check console for gallery structure.`);
    }

    const imageUrl = await this.getFullImageUrl(imagePath, false);
    console.log('[nhentai] getPageImageBase64: fetching URL:', imageUrl);

    let key = '';
    try { key = await invokeTauri('load_credential', { provider: 'nhentai' }); } catch (e) { key = ''; }
    return await invokeTauri('nhentai_fetch_image_base64', { url: imageUrl, apiKey: key || null });
  },



  /**
   * GET /api/v2
   * Simple check connection / index
   */
  async checkConnection() {
    return await apiRequest('/api/v2');
  },

  /**
   * GET /api/v2/pow
   * Get proof-of-work challenge
   */
  async getPow(action = '') {
    const query = action ? `?action=${encodeURIComponent(action)}` : '';
    return await apiRequest(`/api/v2/pow${query}`);
  },

  /**
   * GET /api/v2/config
   * Get app config (CDN nodes, announcements)
   */
  async getConfig() {
    return await apiRequest('/api/v2/config');
  },

  /**
   * GET /api/v2/captcha
   * Get CAPTCHA provider info
   */
  async getCaptcha() {
    return await apiRequest('/api/v2/captcha');
  },

  /**
   * GET /api/v2/cdn
   * Get CDN server configuration
   */
  async getCdn() {
    return await apiRequest('/api/v2/cdn');
  },

  /**
   * searchGalleries: Custom helper that searches galleries
   * 1. If query is a numeric ID, fetches that gallery directly and wraps in an array
   * 2. Searches tags prefix via POST /api/v2/tags/search
   * 3. Fetches galleries tagged with matching tag ID via GET /api/v2/galleries/tagged
   * 4. Fallback: GET /api/v2/galleries ordered by newest
   */
  async searchGalleries(query, page = 1, per_page = 25) {
    const cleanQuery = query ? String(query).trim() : '';

    // A. Direct numeric ID search
    if (/^\d+$/.test(cleanQuery)) {
      try {
        const gallery = await this.getGallery(cleanQuery);
        return {
          result: [gallery],
          num_pages: 1,
          per_page: 25,
          total: 1
        };
      } catch (err) {
        console.warn(`Numeric search for gallery ${cleanQuery} failed, falling back:`, err);
      }
    }

    // B. Tag-based prefix lookup
    if (cleanQuery) {
      try {
        const tags = await this.searchTags('tag', cleanQuery, 5);
        if (tags && tags.length > 0) {
          // Take the exact match or first match tag
          const tag = tags.find(t => t.name.toLowerCase() === cleanQuery.toLowerCase()) || tags[0];
          return await this.getGalleriesTagged(tag.id, 'date', page, per_page);
        }
      } catch (err) {
        console.warn('Tag search for galleries tag lookup failed, trying fallback:', err);
      }
    }

    // C. Fallback: GET /api/v2/galleries (newest first)
    return await this.getNewestGalleries(page, per_page);
  },

  /**
   * GET /api/v2/galleries
   * Get paginated galleries ordered by newest first
   */
  async getNewestGalleries(page = 1, per_page = 25) {
    return await apiRequest(`/api/v2/galleries?page=${page}&per_page=${Math.min(per_page, 100)}`);
  },

  /**
   * GET /api/v2/galleries/tagged
   * Get galleries with a specific tag
   */
  async getGalleriesTagged(tag_id, sort = 'date', page = 1, per_page = 25) {
    return await apiRequest(`/api/v2/galleries/tagged?tag_id=${tag_id}&sort=${sort}&page=${page}&per_page=${Math.min(per_page, 100)}`);
  },

  /**
   * GET /api/v2/galleries/popular
   * Get today's popular galleries
   */
  async getPopularGalleries() {
    return await apiRequest('/api/v2/galleries/popular');
  },

  /**
   * GET /api/v2/galleries/random
   * Get a random gallery object/data
   */
  async getRandomGallery() {
    return await apiRequest('/api/v2/galleries/random');
  },

  /**
   * GET /api/v2/galleries/{gallery_id}
   * Get a single gallery with full details
   */
  async getGallery(gallery_id, include = []) {
    const includeParam = include && include.length > 0 ? `?include=${include.join(',')}` : '';
    return await apiRequest(`/api/v2/galleries/${gallery_id}${includeParam}`);
  },

  /**
   * GET /api/v2/galleries/{gallery_id}/related
   * Get related galleries
   */
  async getRelatedGalleries(gallery_id) {
    return await apiRequest(`/api/v2/galleries/${gallery_id}/related`);
  },

  /**
   * GET /api/v2/galleries/{gallery_id}/favorite
   * Check if gallery is favorited
   */
  async getFavorite(gallery_id) {
    return await apiRequest(`/api/v2/galleries/${gallery_id}/favorite`);
  },

  /**
   * GET /api/v2/tags/ids
   * Look up multiple tags by ID
   */
  async getTagsByIds(ids) {
    const idsStr = Array.isArray(ids) ? ids.join(',') : ids;
    return await apiRequest(`/api/v2/tags/ids?ids=${idsStr}`);
  },

  /**
   * POST /api/v2/tags/search
   * Search tags by name prefix
   */
  async searchTags(type = 'tag', query = '', limit = 10) {
    return await apiRequest('/api/v2/tags/search', 'POST', {
      type,
      query,
      limit
    });
  },

  /**
   * GET /api/v2/tags/{tag_type}
   * Get tags of a specific type with pagination
   */
  async getTagsByType(tag_type, sort = 'name', page = 1, per_page = 25) {
    return await apiRequest(`/api/v2/tags/${tag_type}?sort=${sort}&page=${page}&per_page=${Math.min(per_page, 100)}`);
  },

  /**
   * GET /api/v2/tags/{tag_type}/{slug}
   * Get a specific tag by type and slug
   */
  async getTagBySlug(tag_type, slug) {
    return await apiRequest(`/api/v2/tags/${tag_type}/${slug}`);
  },

  /**
   * POST /api/v2/galleries/{gallery_id}/download
   * Get a download URL for a gallery archive
   */
  async getDownloadLink(gallery_id) {
    return await apiRequest(`/api/v2/galleries/${gallery_id}/download`, 'POST');
  }
};
