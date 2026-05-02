# Talk2AI — Native LLM Chat Interface

Talk2AI is a high-performance, desktop-native AI chat application built with **Tauri**, **Rust**, and **JavaScript**. It provides a premium, aesthetic interface for interacting with local or remote LLMs, focusing on long-term character consistency and memory management.

![Talk2AI Interface](src/assets/logo.jpg)

## 🌟 Key Features

### 🧠 Advanced Memory System
Unlike standard chat interfaces, Talk2AI implements a sophisticated memory extraction layer:
- **Long-Term Memory (LTM):** Automatically extracts important facts, preferences, and events from conversations.
- **Contextual Recall:** Feeds relevant memories back into the model to maintain consistency across long sessions.
- **Memory Management:** View and edit what the AI "remembers" about you and the world through the integrated Memory Viewer.

### 🎭 Character Persona System
Create and manage unique AI personalities with ease:
- **Custom Personas:** Define name, description, personality traits, and world scenarios.
- **System Prompting:** Fine-tune how the AI behaves using dedicated system instructions for each character.
- **Visual Identity:** Support for custom avatars and unique greeting messages.
- **Dynamic Switching:** Switch between different characters instantly without losing context.

### ⚡ Quick Response & Aesthetic UI
Built for speed and comfort:
- **Glassmorphism Design:** A modern, dark-themed interface with smooth animations and high-quality typography.
- **Streaming Responses:** Real-time text generation with a dedicated "Thinking" mode visualization.
- **Optimized Performance:** Minimal resource footprint thanks to the Rust-based Tauri core.
- **Responsive Layout:** Works perfectly across different window sizes.

## 🛠️ Tech Stack
- **Frontend:** Vanilla JavaScript, CSS3 (Custom Animations), HTML5.
- **Backend:** Rust (Tauri).
- **Communication:** Async JSON-RPC / REST API integration.

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (latest LTS)
- [Rust](https://www.rust-lang.org/tools/install)
- A running LLM backend (compatible with the configured API URL)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/hpnout2000-spec/Talk2AI.git
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run in development mode:
   ```bash
   npm run tauri dev
   ```
4. Build for production:
   ```bash
   npm run tauri build
   ```

## 📄 License
This project is licensed under the MIT License.
