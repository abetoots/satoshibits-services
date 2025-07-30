/**
 * Zero-dependency EventEmitter implementation
 * 
 * A lightweight, type-safe event emitter that works in both Node.js and browsers.
 * Extracted and generalized from the cache-metrics implementation.
 */

export type EventListener<T> = (data: T) => void;

/**
 * Generic event emitter with type-safe event handling
 */
export class EventEmitter<Events extends Record<string, unknown> = Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<EventListener<unknown>>>();
  private onceWrappers = new WeakMap<EventListener<unknown>, EventListener<unknown>>();
  private maxListeners = 10;

  /**
   * Set the maximum number of listeners per event
   */
  setMaxListeners(n: number): this {
    this.maxListeners = n;
    return this;
  }

  /**
   * Get the current max listeners setting
   */
  getMaxListeners(): number {
    return this.maxListeners;
  }

  /**
   * Add an event listener
   */
  on<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): this {
    let eventListeners = this.listeners.get(event);
    
    if (!eventListeners) {
      eventListeners = new Set();
      this.listeners.set(event, eventListeners);
    }

    eventListeners.add(listener as EventListener<unknown>);

    // warn if we might have a memory leak
    if (eventListeners.size > this.maxListeners) {
      console.warn(
        `Possible EventEmitter memory leak detected. ${eventListeners.size} ${String(event)} listeners added. ` +
        `Use emitter.setMaxListeners() to increase limit`
      );
    }

    return this;
  }

  /**
   * Add a one-time event listener
   */
  once<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): this {
    const onceWrapper = (data: Events[K]): void => {
      this.off(event, onceWrapper);
      listener(data);
    };
    
    // store mapping so we can remove the wrapper if needed
    this.onceWrappers.set(listener as EventListener<unknown>, onceWrapper as EventListener<unknown>);
    
    return this.on(event, onceWrapper);
  }

  /**
   * Remove an event listener
   */
  off<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): this {
    const eventListeners = this.listeners.get(event);
    
    if (eventListeners) {
      // check if this is a once wrapper
      const wrapper = this.onceWrappers.get(listener as EventListener<unknown>);
      if (wrapper) {
        eventListeners.delete(wrapper);
        this.onceWrappers.delete(listener as EventListener<unknown>);
      } else {
        eventListeners.delete(listener as EventListener<unknown>);
      }
      
      if (eventListeners.size === 0) {
        this.listeners.delete(event);
      }
    }

    return this;
  }

  /**
   * Remove all listeners for an event, or all listeners if no event specified
   */
  removeAllListeners<K extends keyof Events>(event?: K): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    
    return this;
  }

  /**
   * Emit an event to all registered listeners
   */
  emit<K extends keyof Events>(event: K, data: Events[K]): boolean {
    const eventListeners = this.listeners.get(event);
    
    if (!eventListeners || eventListeners.size === 0) {
      return false;
    }

    // create a copy to avoid issues if listeners modify the set
    const listenersArray = Array.from(eventListeners);
    
    listenersArray.forEach(listener => {
      try {
        listener(data);
      } catch (error) {
        // log error - avoid recursive error emission
        console.error(`Error in event listener for "${String(event)}":`, error);
      }
    });

    return true;
  }

  /**
   * Get the number of listeners for an event
   */
  listenerCount<K extends keyof Events>(event: K): number {
    const eventListeners = this.listeners.get(event);
    return eventListeners ? eventListeners.size : 0;
  }

  /**
   * Get all events that have listeners
   */
  eventNames(): (keyof Events)[] {
    return Array.from(this.listeners.keys());
  }

  /**
   * Get all listeners for an event
   */
  getListeners<K extends keyof Events>(event: K): EventListener<Events[K]>[] {
    const eventListeners = this.listeners.get(event);
    return eventListeners ? Array.from(eventListeners) as EventListener<Events[K]>[] : [];
  }
}

/**
 * Factory function to create a new event emitter
 */
export function createEventEmitter<Events extends Record<string, unknown> = Record<string, unknown>>(): EventEmitter<Events> {
  return new EventEmitter<Events>();
}