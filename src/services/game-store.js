/* ════════════════════════════════════════════════════════════════════
   Game Store — Game mode state management
   ════════════════════════════════════════════════════════════════════ */
import { generateId } from '../utils/helpers.js';

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
    try {
      const dataStr = JSON.stringify(gamesState);
      localStorage.setItem('llmchat_games_state', dataStr);
      await invokeTauri('save_game_state', { data: dataStr });
    } catch (e) {
      console.warn('Failed to save game state', e);
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
    game.currentScene = sceneData;
    game.updated_at = new Date().toISOString();
    this.save();
  }
};
