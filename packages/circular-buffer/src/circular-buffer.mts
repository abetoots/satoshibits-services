/**
 * Circular buffer implementation for efficient fixed-size collections
 * 
 * Provides O(1) operations for adding and removing elements from both ends,
 * making it ideal for sliding window operations in metrics collection.
 */

/**
 * A fixed-size circular buffer that overwrites oldest elements when full
 */
export class CircularBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private tail = 0;
  private size = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error('Capacity must be positive');
    }
    this.capacity = capacity;
    this.buffer = new Array<T | undefined>(capacity);
  }

  /**
   * Add an element to the buffer
   * O(1) operation
   */
  push(item: T): void {
    this.buffer[this.tail] = item;
    
    if (this.size < this.capacity) {
      this.size++;
    } else {
      // overwrite oldest element
      this.head = (this.head + 1) % this.capacity;
    }
    
    this.tail = (this.tail + 1) % this.capacity;
  }

  /**
   * Remove and return the oldest element
   * O(1) operation
   */
  shift(): T | undefined {
    if (this.size === 0) {
      return undefined;
    }

    const item = this.buffer[this.head];
    this.buffer[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.size--;

    return item;
  }

  /**
   * Get the oldest element without removing it
   * O(1) operation
   */
  peekFirst(): T | undefined {
    if (this.size === 0) {
      return undefined;
    }
    return this.buffer[this.head];
  }

  /**
   * Get the newest element without removing it
   * O(1) operation
   */
  peekLast(): T | undefined {
    if (this.size === 0) {
      return undefined;
    }
    const lastIndex = (this.tail - 1 + this.capacity) % this.capacity;
    return this.buffer[lastIndex];
  }

  /**
   * Get all elements as an array
   * O(n) operation
   */
  toArray(): T[] {
    const result: T[] = [];
    
    if (this.size === 0) {
      return result;
    }

    let index = this.head;
    for (let i = 0; i < this.size; i++) {
      const item = this.buffer[index];
      if (item !== undefined) {
        result.push(item);
      }
      index = (index + 1) % this.capacity;
    }

    return result;
  }

  /**
   * Remove elements that don't match the predicate
   * O(n) operation
   */
  filter(predicate: (item: T) => boolean): void {
    const filtered = this.toArray().filter(predicate);
    this.clear();
    filtered.forEach(item => this.push(item));
  }

  /**
   * Get the current number of elements
   */
  get length(): number {
    return this.size;
  }

  /**
   * Check if the buffer is empty
   */
  isEmpty(): boolean {
    return this.size === 0;
  }

  /**
   * Check if the buffer is full
   */
  isFull(): boolean {
    return this.size === this.capacity;
  }

  /**
   * Clear all elements
   */
  clear(): void {
    this.buffer = new Array<T | undefined>(this.capacity);
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }

  /**
   * Get the maximum capacity
   */
  getCapacity(): number {
    return this.capacity;
  }
}