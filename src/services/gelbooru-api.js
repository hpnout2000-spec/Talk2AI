/* ════════════════════════════════════════════════════════════════════
   Gelbooru API Client Service
   ════════════════════════════════════════════════════════════════════ */

import { settingsStore } from './settings-store.js';

async function invokeTauri(cmd, args = {}) {
  if (window.__TAURI_INTERNALS__) {
    return await window.__TAURI_INTERNALS__.invoke(cmd, args);
  }
  throw new Error('Not running in Tauri environment');
}

/**
 * Makes an authenticated request to Gelbooru API using Rust Tauri Proxy to bypass CORS.
 */
async function apiRequest(endpoint, params = {}) {
  const settings = settingsStore.get();
  const base = settings.gelbooru_api_url || 'https://gelbooru.com';
  
  let key = '';
  let uid = '';
  try {
    key = await invokeTauri('load_credential', { provider: 'gelbooru_api_key' });
    uid = await invokeTauri('load_credential', { provider: 'gelbooru_user_id' });
  } catch (e) {
    console.warn('Failed to load credentials from Tauri, using localStorage:', e);
  }

  // Dual-load fallback: if empty, try localStorage
  if (!key) {
    key = localStorage.getItem('gelbooru_api_key_fallback') || '';
  }
  if (!uid) {
    uid = localStorage.getItem('gelbooru_user_id_fallback') || '';
  }

  console.log('[gelbooru] Loaded credentials:', {
    hasKey: !!key,
    keyLength: key ? key.length : 0,
    userId: uid || 'EMPTY'
  });

  // Construct URL with query parameters
  const queryParams = new URLSearchParams({
    json: '1',
    ...params
  });
  
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const url = `${cleanBase}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}?${queryParams.toString()}`;

  try {
    // Pass camelCase keys to match Tauri's generated argument structure
    const responseText = await invokeTauri('gelbooru_request', {
      url,
      apiKey: key || null,
      userId: uid || null
    });
    
    const trimmed = responseText.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      throw new Error(`Gelbooru Server Error: "${trimmed.substring(0, 120)}..."`);
    }
    
    return JSON.parse(responseText);
  } catch (err) {
    throw new Error(err.message || err);
  }
}

export const gelbooruApi = {
  /**
   * Search posts using tags
   * page: 0-based page index (pid)
   */
  async searchPosts(tags = '', page = 0, limit = 20) {
    const params = {
      page: 'dapi',
      s: 'post',
      q: 'index',
      limit: String(limit),
      pid: String(page)
    };
    if (tags && tags.trim().length > 0) {
      params.tags = tags.trim();
    }
    const data = await apiRequest('/index.php', params);
    
    if (data && data.post) {
      const posts = Array.isArray(data.post) ? data.post : [data.post];
      return {
        posts,
        attributes: data['@attributes'] || { limit, offset: page * limit, count: posts.length }
      };
    }
    if (Array.isArray(data)) {
      return {
        posts: data,
        attributes: { limit, offset: page * limit, count: data.length }
      };
    }
    
    return { posts: [], attributes: { limit, offset: page * limit, count: 0 } };
  },

  /**
   * Get single post details by its ID
   */
  async getPost(post_id) {
    const params = {
      page: 'dapi',
      s: 'post',
      q: 'index',
      id: String(post_id)
    };
    const data = await apiRequest('/index.php', params);
    
    let post = null;
    if (data && data.post) {
      post = Array.isArray(data.post) ? data.post[0] : data.post;
    } else if (Array.isArray(data) && data.length > 0) {
      post = data[0];
    }
    
    if (!post) {
      throw new Error(`Post with ID ${post_id} not found.`);
    }
    return post;
  },

  /**
   * Fetch image as base64 data URL via Rust proxy.
   */
  async getPostImageBase64(post_id) {
    const post = await this.getPost(post_id);
    const imageUrl = post.file_url || post.sample_url;
    if (!imageUrl) {
      throw new Error(`No file image URL found for post ID ${post_id}.`);
    }

    console.log('[gelbooru] Fetching base64 image URL:', imageUrl);
    return await invokeTauri('gelbooru_fetch_image_base64', { url: imageUrl });
  },

  /**
   * Search tags by pattern
   */
  async searchTags(query = '', limit = 10, orderby = 'count') {
    const params = {
      page: 'dapi',
      s: 'tag',
      q: 'index',
      limit: String(limit),
      orderby: orderby
    };

    if (query) {
      if (query.includes('%') || query.includes('_')) {
        params.name_pattern = query;
      } else {
        params.name_pattern = `%${query}%`;
      }
    }

    const data = await apiRequest('/index.php', params);
    
    if (data && data.tag) {
      return Array.isArray(data.tag) ? data.tag : [data.tag];
    }
    if (Array.isArray(data)) {
      return data;
    }
    return [];
  },

  /**
   * Get comments for a post
   */
  async getComments(post_id) {
    const params = {
      page: 'dapi',
      s: 'comment',
      q: 'index',
      post_id: String(post_id)
    };
    const data = await apiRequest('/index.php', params);
    
    if (data && data.comment) {
      return Array.isArray(data.comment) ? data.comment : [data.comment];
    }
    if (Array.isArray(data)) {
      return data;
    }
    return [];
  },

  /**
   * Fetch a random post matching tag query
   */
  async getRandomPost(tags = '') {
    const initData = await this.searchPosts(tags, 0, 1);
    const count = parseInt(initData.attributes?.count || 0);
    
    if (count === 0) {
      throw new Error(`No posts found matching tags: "${tags}"`);
    }

    // Gelbooru restricts query page offsets (too deep) to prevent database overload.
    // Capping the random index offset to 1000 ensures we never exceed Gelbooru's maximum page limit.
    const maxCount = Math.min(count, 1000);
    const randomIdx = Math.floor(Math.random() * maxCount);
    const pageData = await this.searchPosts(tags, randomIdx, 1);
    if (pageData.posts && pageData.posts.length > 0) {
      return pageData.posts[0];
    }
    throw new Error('Failed to retrieve random post.');
  }
};
