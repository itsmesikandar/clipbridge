/** Set that forgets its oldest entries beyond `capacity`. Used to drop duplicate clip ids. */
export class BoundedSet<T> {
  private readonly items = new Set<T>();

  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new Error('BoundedSet capacity must be at least 1');
  }

  has(item: T): boolean {
    return this.items.has(item);
  }

  /** Adds `item`; returns false if it was already present. */
  add(item: T): boolean {
    if (this.items.has(item)) return false;
    this.items.add(item);
    if (this.items.size > this.capacity) {
      const oldest = this.items.values().next();
      if (!oldest.done) this.items.delete(oldest.value);
    }
    return true;
  }

  get size(): number {
    return this.items.size;
  }
}
