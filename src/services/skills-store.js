/* ════════════════════════════════════════════════════════════════════
   Skills Store — Service to manage GenAI Skills
   ════════════════════════════════════════════════════════════════════ */

async function invokeTauri(cmd, args = {}) {
  if (window.__TAURI_INTERNALS__) {
    return await window.__TAURI_INTERNALS__.invoke(cmd, args);
  }
  throw new Error('Not running in Tauri environment');
}

const DEFAULT_GUIDE_CONTENT = `VibeChatting Application Guide:
- Characters: Users can chat with individual character cards. Each character has a unique description, personality, scenario, system prompt, and alternate greetings.
- Group Chats: Multiple characters can be added to a group chat. The response mode can be Auto (AI chooses who speaks) or Round-robin.
- RPG Game Mode: Interactive text-based RPG adventures where a Game Master (GM) guides the story, tracks stats (HP, Stress, Lust, Money), manages scene choices, and maintains a story chronicle.
- Settings: Customizable parameters including API URL, font size, AI comments, AI suggestions, Thinking Mode, Auto Memory, and translation options.`;

const DEFAULT_FEATURES_CONTENT = `{
  "name": "GenAI Features",
  "capabilities": [
    "Personal Memory: Can remember facts about the user across sessions using 'add_memory', 'delete_memory', and 'list_memories' commands.",
    "Character Customization: Can create or refine character cards step-by-step using 'save_character' or via GenAI Creator panel facts/final texts.",
    "Interface Controls: Can change app settings (like font size, safe mode, suggestions, AI comments) on request via 'set_setting'.",
    "Active Roleplay Interventions: Can send messages in individual chats, orchestrate group chats, or take actions in interactive games."
  ]
}`;

const DEFAULT_INTERNET_CONTENT = `{
  "name": "Web Search",
  "capabilities": [
    "Web Search: Can search the web for real-time information, weather, news, facts, and website details using 'web_search' command.",
    "Web Page Reader: Can read and fetch the text content of a specific webpage or URL using 'web_fetch' command."
  ],
  "instructions": "Whenever the user asks about current events, facts you don't know, or requests web data, use the following tools on a new line and nothing else: \n1. {\"genai_action\":\"web_search\",\"query\":\"your search query\"}\n2. {\"genai_action\":\"web_fetch\",\"url\":\"https://...\"}"
}`;

let userSkillsLocal = [];

export const skillsStore = {
  async getSkills() {
    // 1. Try Tauri
    try {
      const result = await invokeTauri('load_skills');
      if (result) {
        return JSON.parse(result);
      }
    } catch (e) {
      console.warn('Tauri load skills failed, using fallback:', e);
    }

    // 2. Browser fallback: Merge defaults with local storage skills
    const defaults = [
      {
        name: 'VibeChatting Guide',
        filename: 'VibeChatting Guide.txt',
        is_default: true,
        content: DEFAULT_GUIDE_CONTENT
      },
      {
        name: 'nhentai',
        filename: 'nhentai',
        is_default: true,
        content: `nhentai Skill: Tag Search Assistant\nPurpose: Help user search and browse galleries, tags, and related content from the nhentai API v2.\nUsage: Activate this skill for the current chat to enable nhentai-specific tool calls (search_galleries, get_gallery, get_cover, get_page, search_tags, etc.). Do NOT expose API keys in chat text.`
      },
      {
        name: 'Gelbooru',
        filename: 'gelbooru',
        is_default: true,
        content: `Gelbooru Skill: Image Search Assistant\nPurpose: Help user search and browse posts, tags, and related comments from the Gelbooru API.\nUsage: Activate this skill for the current chat to enable Gelbooru-specific tool calls (gelbooru_search_posts, gelbooru_get_post, gelbooru_get_image, gelbooru_search_tags, gelbooru_get_comments, etc.). Do NOT expose API keys in chat text.`
      },
      {
        name: 'GenAI Features',
        filename: 'GenAI Features.json',
        is_default: true,
        content: DEFAULT_FEATURES_CONTENT
      },
      {
        name: 'Web Search',
        filename: 'Internet Browser.json',
        is_default: true,
        content: DEFAULT_INTERNET_CONTENT
      }
    ];

    try {
      const saved = localStorage.getItem('vibechat_user_skills');
      if (saved) {
        userSkillsLocal = JSON.parse(saved);
      }
    } catch (e) {
      console.warn('LocalStorage load skills failed:', e);
    }

    return [...defaults, ...userSkillsLocal];
  },

  async getSkill(filename) {
    const list = await this.getSkills();
    return list.find(s => s.filename === filename) || null;
  },

  async saveSkill(filename, content) {
    const name = filename.replace(/\.(txt|json)$/i, '');
    
    // Check if default
    if (filename === 'VibeChatting Guide.txt' || filename === 'GenAI Features.json' || filename === 'Internet Browser.json') {
      throw new Error('Cannot overwrite default skills');
    }

    // 1. Always update local cache & localStorage
    try {
      const list = await this.getSkills();
      const userList = list.filter(s => !s.is_default);
      
      const existingIdx = userList.findIndex(s => s.filename === filename);
      const newSkill = {
        name,
        filename,
        is_default: false,
        content
      };

      if (existingIdx >= 0) {
        userList[existingIdx] = newSkill;
      } else {
        userList.push(newSkill);
      }

      userSkillsLocal = userList;
      localStorage.setItem('vibechat_user_skills', JSON.stringify(userSkillsLocal));
    } catch (e) {
      console.error('LocalStorage save skill failed:', e);
    }

    // 2. Try Tauri
    try {
      await invokeTauri('save_skill', { filename, content });
    } catch (e) {
      console.warn('Tauri save skill failed:', e);
    }
  },

  async deleteSkill(filename) {
    if (filename === 'VibeChatting Guide.txt' || filename === 'GenAI Features.json' || filename === 'Internet Browser.json') {
      throw new Error('Cannot delete default skills');
    }

    // 1. Always update local cache & localStorage
    try {
      const list = await this.getSkills();
      userSkillsLocal = list.filter(s => !s.is_default && s.filename !== filename);
      localStorage.setItem('vibechat_user_skills', JSON.stringify(userSkillsLocal));
    } catch (e) {
      console.error('LocalStorage delete skill failed:', e);
    }

    // 2. Try Tauri
    try {
      await invokeTauri('delete_skill', { filename });
    } catch (e) {
      console.warn('Tauri delete skill failed:', e);
    }
  }
};
