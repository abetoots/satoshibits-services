/**
 * Simple mutex implementation for preventing race conditions
 */

export class Mutex {
  private locked = false;
  private queue: (() => void)[] = [];

  /**
   * Acquire the mutex lock
   */
  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }

    // wait for lock to be available
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.locked = true;
        resolve(() => this.release());
      });
    });
  }

  /**
   * Release the mutex lock
   */
  private release(): void {
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        try {
          // attempt to hand off the lock
          next();
          // lock successfully handed off, exit
          return;
        } catch (e) {
          console.error('Mutex: error waking up waiter, trying next.', e);
          // this waiter failed, loop will try the next one in the queue
        }
      }
    }
    // queue is empty or all waiters failed
    this.locked = false;
  }

  /**
   * Execute a function with mutex protection
   */
  async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Check if mutex is currently locked
   */
  isLocked(): boolean {
    return this.locked;
  }
}

/**
 * Decorator for protecting methods with a mutex
 */
export function synchronized(_target: unknown, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor {
  const originalMethod = descriptor.value as (...args: unknown[]) => unknown;
  const mutexKey = `__mutex_${propertyKey}`;

  descriptor.value = async function(this: Record<string, unknown>, ...args: unknown[]): Promise<unknown> {
    // ensure mutex exists
    if (!this[mutexKey]) {
      this[mutexKey] = new Mutex();
    }

    const mutex = this[mutexKey] as Mutex;
    return mutex.withLock(() => originalMethod.apply(this, args));
  };

  return descriptor;
}