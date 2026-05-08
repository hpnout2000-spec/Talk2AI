class PerfLogger {
  constructor() {
    this.logs = [];
    this.activeMarkers = new Map();
    this.isMonitoringFPS = false;
    this.lastFrameTime = performance.now();
    
    // Automatic Long Task Detection
    if (window.PerformanceObserver) {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.logAction('LONG_TASK_DETECTION', { 
            duration: entry.duration.toFixed(2) + 'ms',
            startTime: entry.startTime.toFixed(2) + 'ms'
          });
        }
      });
      this.observer.observe({ entryTypes: ['longtask'] });
    }
  }

  start(label) {
    this.activeMarkers.set(label, performance.now());
  }

  end(label, metadata = {}) {
    const startTime = this.activeMarkers.get(label);
    if (startTime === undefined) return;

    const duration = performance.now() - startTime;
    this.activeMarkers.delete(label);

    this.record('measure', label, duration, metadata);
  }

  logAction(label, metadata = {}) {
    this.record('action', label, metadata.durationNum || 0, metadata);
  }

  record(type, label, duration, metadata = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type,
      label,
      duration: duration > 0 ? duration.toFixed(3) + 'ms' : (metadata.duration || '-'),
      durationNum: duration,
      ...metadata
    };

    this.logs.push(logEntry);

    if (duration > 16 || (type === 'action' && label === 'LONG_TASK_DETECTION')) {
      console.warn(`[PERF] ⚠️ ${label}: ${duration > 0 ? duration.toFixed(3) + 'ms' : (metadata.duration || '-')}`, metadata);
    } else if (type === 'action') {
      console.log(`[ACTION] ${label}`, metadata);
    }

    if (this.logs.length > 3000) this.logs.shift();
  }

  startFPSMonitor() {
    if (this.isMonitoringFPS) return;
    this.isMonitoringFPS = true;
    
    const checkFPS = () => {
      const now = performance.now();
      const delta = now - this.lastFrameTime;
      this.lastFrameTime = now;

      if (delta > 32) {
        this.logAction('FRAME_DROP', { 
          delta: delta.toFixed(2) + 'ms',
          durationNum: delta 
        });
      }
      
      if (this.isMonitoringFPS) requestAnimationFrame(checkFPS);
    };
    requestAnimationFrame(checkFPS);
  }

  async measure(label, fn, metadata = {}) {
    this.start(label);
    try {
      const result = await fn();
      this.end(label, metadata);
      return result;
    } catch (err) {
      this.activeMarkers.delete(label);
      throw err;
    }
  }

  getLogs() { return this.logs; }
  clear() { this.logs = []; }
}

export const perf = new PerfLogger();
perf.startFPSMonitor();

// Global activity trackers with timing and hover-disable optimization
let lastScrollTime = 0;
window.addEventListener('scroll', (e) => {
  const now = performance.now();
  const target = e.target === document ? 'window' : (e.target.id || e.target.className);
  
  if (lastScrollTime > 0) {
    const gap = now - lastScrollTime;
    perf.logAction('SCROLL_TICK', { target, gap: gap.toFixed(2) + 'ms' });
  } else {
    perf.logAction('SCROLL_START', { target });
    document.body.classList.add('disable-hover');
  }
  
  lastScrollTime = now;
  // Reset scroll timer after 150ms of inactivity
  clearTimeout(window._scrollResetTimer);
  window._scrollResetTimer = setTimeout(() => {
    perf.logAction('SCROLL_END', { target });
    lastScrollTime = 0;
    document.body.classList.remove('disable-hover');
  }, 150);
}, true);

window.addEventListener('mousemove', () => {
  if (!window._mouseMoveThrottled) {
    window._mouseMoveThrottled = true;
    perf.logAction('MOUSE_MOVE_CHECK');
    setTimeout(() => window._mouseMoveThrottled = false, 200);
  }
}, true);

window.addEventListener('click', (e) => {
  perf.logAction('CLICK', { 
    tag: e.target.tagName, 
    id: e.target.id, 
    class: e.target.className 
  });
}, true);

window.exportPerfLogs = () => {
  const data = JSON.stringify(perf.getLogs(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `perf-logs-${new Date().getTime()}.json`;
  a.click();
};
