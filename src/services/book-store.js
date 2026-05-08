/* ════════════════════════════════════════════════════════════════════
   Book Store — Manages local storage of books and chapters
   ════════════════════════════════════════════════════════════════════ */

export const bookStore = {
  books: [],
  activeBookId: null,

  async load() {
    try {
      const data = localStorage.getItem('llm_chat_books');
      if (data) {
        this.books = JSON.parse(data);
      }
    } catch (err) {
      console.error('Failed to load books from localStorage:', err);
      this.books = [];
    }
  },

  async save() {
    try {
      localStorage.setItem('llm_chat_books', JSON.stringify(this.books));
      window.dispatchEvent(new CustomEvent('books-updated'));
    } catch (err) {
      console.error('Failed to save books:', err);
    }
  },

  getAllBooks() {
    return [...this.books].sort((a, b) => b.updatedAt - a.updatedAt);
  },

  getBook(id) {
    return this.books.find(b => b.id === id);
  },

  async createBook(title, charCount, allowNewChars, initialPrompt) {
    const book = {
      id: crypto.randomUUID(),
      title,
      charCount,
      allowNewChars,
      initialPrompt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      chapters: []
    };
    
    this.books.push(book);
    await this.save();
    return book;
  },

  async deleteBook(id) {
    this.books = this.books.filter(b => b.id !== id);
    if (this.activeBookId === id) {
      this.activeBookId = null;
    }
    await this.save();
  },

  async addChapter(bookId, prompt, content, summary = null) {
    const book = this.getBook(bookId);
    if (!book) return null;

    const chapter = {
      id: crypto.randomUUID(),
      prompt,
      content,
      summary,
      timestamp: Date.now()
    };

    book.chapters.push(chapter);
    book.updatedAt = Date.now();
    await this.save();
    return chapter;
  },

  async updateChapterSummary(bookId, chapterId, summary) {
    const book = this.getBook(bookId);
    if (!book) return;

    const chapter = book.chapters.find(c => c.id === chapterId);
    if (chapter) {
      chapter.summary = summary;
      await this.save();
    }
  },

  async deleteLastChapter(bookId) {
    const book = this.getBook(bookId);
    if (book && book.chapters.length > 0) {
      book.chapters.pop();
      book.updatedAt = Date.now();
      await this.save();
      return true;
    }
    return false;
  }
};
