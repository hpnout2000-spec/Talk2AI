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
    
    // Don't add if already in stack
    if (this.stack.includes(el)) return;

    // Show the new window first so it can be added to stack for depth calculation
    el.classList.remove('hidden');
    this.stack.push(el);
    
    this._updateDepths();
    
    console.log('UI Stack:', this.stack.map(e => e.id));
  }

  /**
   * Closes a window and restores the previous one in stack
   */
  close(idOrElement) {
    const el = typeof idOrElement === 'string' ? document.getElementById(idOrElement) : idOrElement;
    if (!el || !this.stack.includes(el)) return;

    const index = this.stack.indexOf(el);
    const isTop = index === this.stack.length - 1;

    // Determine if it's a modal (needs closing animation)
    const isModal = el.classList.contains('modal');
    
    if (isModal) {
      el.classList.add('closing');
      // If we are closing the top window, immediately start moving others forward
      if (isTop) {
        this._updateDepths(true); // true means "ignore top element in calculation"
      }
      
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

  _updateDepths(closingTop = false) {
    const stackSize = this.stack.length;
    const effectiveStackSize = closingTop ? stackSize - 1 : stackSize;

    // Update windows in stack
    this.stack.forEach((el, i) => {
      // If we are closing the top window, it shouldn't be counted in the depth calculation for others
      if (closingTop && i === stackSize - 1) return;

      const depth = effectiveStackSize - 1 - i;
      if (depth > 0) {
        el.style.setProperty('--ui-depth', depth);
        el.classList.add('ui-stacked');
      } else {
        el.style.removeProperty('--ui-depth');
        el.classList.remove('ui-stacked');
      }
    });

    // Update base elements (sidebar, main content)
    const baseDepth = effectiveStackSize;
    this.baseElements.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (baseDepth > 0) {
        el.style.setProperty('--ui-depth', baseDepth);
        el.classList.add('ui-stacked');
      } else {
        el.style.removeProperty('--ui-depth');
        el.classList.remove('ui-stacked');
      }
    });
  }

  _finalizeClose(el) {
    const index = this.stack.indexOf(el);
    if (index > -1) {
      this.stack.splice(index, 1);
    }
    this._updateDepths();
    
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
