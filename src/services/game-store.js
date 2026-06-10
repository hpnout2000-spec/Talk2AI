/* ════════════════════════════════════════════════════════════════════
   Game Store — Game mode state management
   ════════════════════════════════════════════════════════════════════ */
import { generateId } from '../utils/helpers.js';

function cleanCharacterName(name) {
  if (!name) return '';
  return name.replace(/\{\{char:/g, '').replace(/\}\}/g, '').replace(/char:/g, '').trim();
}

let gamesState = {
  games: [],
  activeGameId: null
};

// Tauri IPC wrapper
async function invokeTauri(cmd, args = {}) {
  if (window.__TAURI_INTERNALS__) {
    return await window.__TAURI_INTERNALS__.invoke(cmd, args);
  }
  return null;
}

export const gameStore = {
  async load() {
    let parsedTauri = null;
    let parsedLocal = null;

    try {
      const result = await invokeTauri('load_game_state');
      if (result) parsedTauri = JSON.parse(result);
    } catch (e) {
      // Ignore
    }

    try {
      const saved = localStorage.getItem('llmchat_games_state');
      if (saved) parsedLocal = JSON.parse(saved);
    } catch (e) {
      // Ignore
    }

    if (parsedTauri) {
      gamesState = parsedTauri;
    } else if (parsedLocal) {
      gamesState = parsedLocal;
    }
    
    // Ensure structure
    if (!gamesState.games) gamesState.games = [];
    
    return gamesState;
  },

  get() {
    if (!gamesState.activeGameId) return null;
    return gamesState.games.find(g => g.id === gamesState.activeGameId) || null;
  },
  
  getAllGames() {
    return gamesState.games;
  },
  
  setActiveGame(id) {
    gamesState.activeGameId = id;
    this.save();
  },

  async save() {
    const dataStr = JSON.stringify(gamesState);
    try {
      localStorage.setItem('llmchat_games_state', dataStr);
    } catch (e) {
      console.warn('Failed to save game state to localStorage', e);
    }
    try {
      await invokeTauri('save_game_state', { data: dataStr });
    } catch (e) {
      console.error('Failed to save game state via Tauri', e);
    }
  },

  createGame(title) {
    const newGame = {
      id: generateId(),
      title: title || 'New Game',
      stats: { hp: 100, stress: 0, lust: 0, money: 50 },
      inventory: [],
      currentScene: null,
      history: [],
      story_prompt: '',
      characters: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    gamesState.games.unshift(newGame);
    gamesState.activeGameId = newGame.id;
    this.save();
    return newGame;
  },
  
  deleteGame(id) {
    gamesState.games = gamesState.games.filter(g => g.id !== id);
    if (gamesState.activeGameId === id) {
      gamesState.activeGameId = gamesState.games.length > 0 ? gamesState.games[0].id : null;
    }
    this.save();
  },

  renameGame(id, newTitle) {
    const game = gamesState.games.find(g => g.id === id);
    if (game) {
      game.title = newTitle || 'Untitled Game';
      game.updated_at = new Date().toISOString();
      this.save();
    }
  },

  updateGameSettings(id, settings) {
    const game = gamesState.games.find(g => g.id === id);
    if (!game) return;
    if (settings.title !== undefined) game.title = settings.title || 'Untitled Game';
    if (settings.story_prompt !== undefined) game.story_prompt = settings.story_prompt;
    game.updated_at = new Date().toISOString();
    this.save();
  },

  upsertCharacter(charData) {
    const game = this.get();
    if (!game) return;
    if (!game.characters) game.characters = [];
    
    const cleanedName = cleanCharacterName(charData.name);
    charData.name = cleanedName;

    const idx = game.characters.findIndex(c => cleanCharacterName(c.name).toLowerCase() === cleanedName.toLowerCase());
    if (idx >= 0) {
      game.characters[idx] = { ...game.characters[idx], ...charData };
    } else {
      game.characters.push(charData);
    }
    game.updated_at = new Date().toISOString();
    this.save();
  },

  removeCharacter(name) {
    const game = this.get();
    if (!game || !game.characters) return;
    const cleanedName = cleanCharacterName(name);
    game.characters = game.characters.filter(c => cleanCharacterName(c.name).toLowerCase() !== cleanedName.toLowerCase());
    game.updated_at = new Date().toISOString();
    this.save();
  },

  getCharacter(name) {
    const game = this.get();
    if (!game || !game.characters) return null;
    return game.characters.find(c => c.name === name) || null;
  },


  applyStatChanges(changes) {
    const game = this.get();
    if (!game || !changes) return;
    
    for (const [key, value] of Object.entries(changes)) {
      if (game.stats.hasOwnProperty(key)) {
        game.stats[key] += value;
        
        // Boundaries
        if (key === 'hp' && game.stats[key] > 100) game.stats[key] = 100;
        if (game.stats[key] < 0) game.stats[key] = 0;
      }
    }
    
    game.updated_at = new Date().toISOString();
    this.save();
  },

  setCurrentScene(sceneData) {
    const game = this.get();
    if (!game) return;
    
    if (game.currentScene) {
      game.history.push(game.currentScene);
    }
    
    // Save snapshot of stats for undo capability
    sceneData.stats_snapshot = { ...game.stats };
    
    game.currentScene = sceneData;
    game.updated_at = new Date().toISOString();
    this.save();
  },

  undoLastMove() {
    const game = this.get();
    if (!game) return false;

    if (game.history.length > 0) {
      // Revert to the previous scene in history
      const prevScene = game.history.pop();
      game.currentScene = prevScene;
      if (prevScene.stats_snapshot) {
        game.stats = { ...prevScene.stats_snapshot };
      }
      
      // Prevent index out of bounds on summarized_count
      if (game.summarized_count && game.summarized_count > game.history.length) {
        game.summarized_count = game.history.length;
      }
      
      game.updated_at = new Date().toISOString();
      this.save();
      return true;
    } else if (game.currentScene) {
      // Revert to start screen (no scene yet)
      game.currentScene = null;
      game.stats = { hp: 100, stress: 0, lust: 0, money: 50 };
      
      if (game.summarized_count) {
        game.summarized_count = 0;
      }
      
      game.updated_at = new Date().toISOString();
      this.save();
      return true;
    }

    return false;
  }
};
