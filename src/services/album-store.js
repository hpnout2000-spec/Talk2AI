/* ════════════════════════════════════════════════════════════════════
   Album Store — Manages local storage of Albums and their node trees
   ════════════════════════════════════════════════════════════════════ */

export const albumStore = {
  albums: [],
  activeAlbumId: null,

  async load() {
    try {
      const data = localStorage.getItem('llm_chat_albums');
      if (data) {
        this.albums = JSON.parse(data);
      }
      const activeId = localStorage.getItem('llm_chat_active_album_id');
      if (activeId) {
        this.activeAlbumId = activeId;
      }
    } catch (err) {
      console.error('Failed to load albums from localStorage:', err);
      this.albums = [];
    }
  },

  async save() {
    try {
      localStorage.setItem('llm_chat_albums', JSON.stringify(this.albums));
      if (this.activeAlbumId) {
        localStorage.setItem('llm_chat_active_album_id', this.activeAlbumId);
      } else {
        localStorage.removeItem('llm_chat_active_album_id');
      }
      window.dispatchEvent(new CustomEvent('albums-updated'));
    } catch (err) {
      console.error('Failed to save albums:', err);
    }
  },

  getAllAlbums() {
    return [...this.albums].sort((a, b) => b.updatedAt - a.updatedAt);
  },

  getAlbum(id) {
    return this.albums.find(a => a.id === id);
  },

  getActiveAlbum() {
    if (!this.activeAlbumId) return null;
    return this.getBookmarkedActiveAlbum();
  },

  getBookmarkedActiveAlbum() {
    return this.albums.find(a => a.id === this.activeAlbumId) || null;
  },

  async setActiveAlbum(id) {
    this.activeAlbumId = id;
    await this.save();
  },

  async createAlbum(title, theme, description) {
    const album = {
      id: crypto.randomUUID(),
      title,
      theme,
      description,
      mandatoryTags: '', // user defined tags for this album
      language: 'Russian', // default description language
      allowNsfw: false, // default nsfw option
      sortMode: 'default', // default sort layout option
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nodes: []
    };

    this.albums.push(album);
    this.activeAlbumId = album.id;
    await this.save();
    return album;
  },

  async deleteAlbum(id) {
    this.albums = this.albums.filter(a => a.id !== id);
    if (this.activeAlbumId === id) {
      this.activeAlbumId = this.albums[0]?.id || null;
    }
    await this.save();
  },

  async updateAlbum(id, { title, theme, description }) {
    const album = this.getAlbum(id);
    if (album) {
      if (title !== undefined) album.title = title;
      if (theme !== undefined) album.theme = theme;
      if (description !== undefined) album.description = description;
      album.updatedAt = Date.now();
      await this.save();
    }
  },

  async updateAlbumSettings(id, { mandatoryTags, language, allowNsfw, sortMode }) {
    const album = this.getAlbum(id);
    if (album) {
      if (mandatoryTags !== undefined) album.mandatoryTags = mandatoryTags;
      if (language !== undefined) album.language = language;
      if (allowNsfw !== undefined) album.allowNsfw = allowNsfw;
      if (sortMode !== undefined) album.sortMode = sortMode;
      album.updatedAt = Date.now();
      await this.save();
    }
  },

  async addNode(albumId, nodeData) {
    const album = this.getAlbum(albumId);
    if (!album) return null;

    const node = {
      id: nodeData.id || crypto.randomUUID(),
      type: nodeData.type || 'image', // 'image', 'suggestion', 'input'
      x: nodeData.x ?? 2500,
      y: nodeData.y ?? 2500,
      prompt: nodeData.prompt || '',
      description: nodeData.description || '',
      imageUrl: nodeData.imageUrl || '',
      parentId: nodeData.parentId || null,
      status: nodeData.status || 'idle', // 'idle', 'working', 'generating', 'completed'
      createdAt: Date.now()
    };

    album.nodes.push(node);
    album.updatedAt = Date.now();
    await this.save();
    return node;
  },

  async updateNode(albumId, nodeId, updates) {
    const album = this.getAlbum(albumId);
    if (!album) return;

    const node = album.nodes.find(n => n.id === nodeId);
    if (node) {
      Object.assign(node, updates);
      album.updatedAt = Date.now();
      await this.save();
    }
  },

  async deleteNode(albumId, nodeId) {
    const album = this.getAlbum(albumId);
    if (!album) return;

    album.nodes = album.nodes.filter(n => n.id !== nodeId);
    album.updatedAt = Date.now();
    await this.save();
  },

  async clearNodes(albumId) {
    const album = this.getAlbum(albumId);
    if (album) {
      album.nodes = [];
      album.updatedAt = Date.now();
      await this.save();
    }
  }
};
