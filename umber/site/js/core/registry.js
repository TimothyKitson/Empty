import { bus } from './events.js';

export class Registry {
  constructor(kind) {
    this.kind = kind;
    this.items = new Map();
  }

  register(def) {
    if (!def || !def.id) throw new Error(this.kind + ' registration needs an id');
    this.items.set(def.id, def);
    bus.emit('registry:change', { kind: this.kind, id: def.id });
    return def;
  }

  get(id) {
    return this.items.get(id) || null;
  }

  has(id) {
    return this.items.has(id);
  }

  list() {
    return [...this.items.values()].sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000));
  }
}

export const layerTypes = new Registry('layerTypes');
export const adjustments = new Registry('adjustments');
export const filters = new Registry('filters');
export const hooks = { styles: null, snap: null, fonts: null };
