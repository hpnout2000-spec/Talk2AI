import { settingsStore } from './settings-store.js';

export const cowriterStore = {
  stories: [],
  activeStoryId: null,

  async load() {
    try {
      const settings = settingsStore.get();
      if (settings.cowriter_stories && settings.cowriter_stories.length > 0) {
        this.stories = settings.cowriter_stories;
      } else {
        // Fallback/migration from localStorage
        const data = localStorage.getItem('llm_chat_cowriter_stories');
        if (data) {
          this.stories = JSON.parse(data);
          await this.save(); // Migrate immediately to settings.json
        }
      }
    } catch (err) {
      console.error('Failed to load stories:', err);
      this.stories = [];
    }
  },

  async save() {
    try {
      // Save to filesystem settings
      await settingsStore.save({ cowriter_stories: this.stories });
      // Fallback
      localStorage.setItem('llm_chat_cowriter_stories', JSON.stringify(this.stories));
      window.dispatchEvent(new CustomEvent('stories-updated'));
    } catch (err) {
      console.error('Failed to save stories:', err);
    }
  },

  getAllStories() {
    return [...this.stories].sort((a, b) => b.updatedAt - a.updatedAt);
  },

  getStory(id) {
    return this.stories.find(s => s.id === id);
  },

  async createStory(title, content = '') {
    const story = {
      id: crypto.randomUUID(),
      title,
      content,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    this.stories.push(story);
    await this.save();
    return story;
  },

  async updateStoryContent(id, content) {
    const story = this.getStory(id);
    if (story) {
      story.content = content;
      story.updatedAt = Date.now();
      await this.save();
    }
  },

  async deleteStory(id) {
    this.stories = this.stories.filter(s => s.id !== id);
    if (this.activeStoryId === id) {
      this.activeStoryId = null;
    }
    await this.save();
  }
};
