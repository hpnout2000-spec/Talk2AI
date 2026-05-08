/* ════════════════════════════════════════════════════════════════════
   UI Manager — Window Stacking and Animations
   ════════════════════════════════════════════════════════════════════ */

class WindowManager {
  constructor() {
    this.stack = []; // elements currently open
    this.baseElements = ['sidebar', 'main-content'];
  }

  /**
   * Opens a window (modal or panel) and stacks current active windows
   */
  open(idOrElement) {
    const el = typeof idOrElement === 'string' ? document.getElementById(idOrElement) : idOrElement;
    if (!el) return;
    
    // Don't add if already in stack (unless we want to reorder, but let's keep it simple)
    if (this.stack.includes(el)) return;

    // Apply stacked class to current top elements
    if (this.stack.length > 0) {
      // The current top window becomes stacked
      this.stack[this.stack.length - 1].classList.add('ui-stacked');
    } else {
      // If stack is empty, the base app elements become stacked
      this.baseElements.forEach(id => {
        const baseEl = document.getElementById(id);
        if (baseEl) baseEl.classList.add('ui-stacked');
      });
    }

    // Show the new window
    el.classList.remove('hidden');
    this.stack.push(el);
    
    console.log('UI Stack:', this.stack.map(e => e.id));
  }

  /**
   * Closes a window and restores the previous one in stack
   */
  close(idOrElement) {
    const el = typeof idOrElement === 'string' ? document.getElementById(idOrElement) : idOrElement;
    if (!el || !this.stack.includes(el)) return;

    // Determine if it's a modal (needs closing animation)
    const isModal = el.classList.contains('modal');
    
    if (isModal) {
      el.classList.add('closing');
      setTimeout(() => {
        el.classList.add('hidden');
        el.classList.remove('closing');
        this._finalizeClose(el);
      }, 400); // Match animations.css duration
    } else {
      el.classList.add('hidden');
      this._finalizeClose(el);
    }
  }

  _finalizeClose(el) {
    const index = this.stack.indexOf(el);
    if (index > -1) {
      this.stack.splice(index, 1);
    }

    // Remove stacked class from the window that's now on top
    if (this.stack.length > 0) {
      this.stack[this.stack.length - 1].classList.remove('ui-stacked');
    } else {
      // If stack is empty, restore base app elements
      this.baseElements.forEach(id => {
        const baseEl = document.getElementById(id);
        if (baseEl) baseEl.classList.remove('ui-stacked');
      });
    }
    
    console.log('UI Stack:', this.stack.map(e => e.id));
  }

  /**
   * Closes the top-most window
   */
  closeTop() {
    if (this.stack.length > 0) {
      this.close(this.stack[this.stack.length - 1]);
    }
  }
  
  /**
   * Closes all windows
   */
  closeAll() {
    [...this.stack].reverse().forEach(el => this.close(el));
  }
}

export const uiManager = new WindowManager();
