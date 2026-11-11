export class Emitter {
  constructor() {
    this.listeners = new Map();
  }

  on(type, fn) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (detail) => {
      off();
      fn(detail);
    });
    return off;
  }

  off(type, fn) {
    const set = this.listeners.get(type);
    if (set) set.delete(fn);
  }

  emit(type, detail) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(detail);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

export const bus = new Emitter();
