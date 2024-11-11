# About

Note: This library does not extend Node's EventEmitter.

A library to emit events and register listeners with the ability to define the listeners' priority.

Use cases for this :

1.  Emits events and calls listeners sequentially in the order of their priority, but not wait for async listeners.
2.  Same as #1 but wait for async listeners.
3.  Define custom behavior for the listeners i.e. when calling `emit`, you can provide a `arrangeListeners` function to define how listeners are ordered, remove some listener by `key`, etc.

## Sample Usage

1. Basic usage with priority (default behavior is highest priority first):

```ts
interface MyClassEvents {
  add: (el: string) => void;
  delete: (changedCount: number) => void;
}
const manager = new OrderedEventEmitter<MyClassEvents>();

//add a listener with priority 1
manager.on(
  "add",
  (el) => {
    console.log("added", el);
  },
  1,
);

//add a listener with priority 2
manager.on(
  "add",
  (el) => {
    console.log("added", "nope");
  },
  2,
);

manager.emit({ event: "add", priorityBehavior: "highestFirst" }, "hello");

// Prints
// added nope
// added hello
```

2. Wait for async listeners

```ts
interface MyClassEvents {
  createdProfile: (profile: { email: string }) => Promise<void>;
}
const manager = new OrderedEventEmitter<MyClassEvents>();

//add a listener with priority 1
manager.on(
  "createdProfile",
  async (profile) => {
    //Send request to third-party service. This should be last.
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log("Sent request to third-party service");
        resolve();
      }, 5000);
    });
  },
  1,
);

//add a listener with priority 2
manager.on(
  "createdProfile",
  async (profile) => {
    //Notify user through email
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log("Sent password email to user: ", profile.email);
        resolve();
      }, 10000);
    });
  },
  2,
);

manager.emitAsync(
  { event: "createdProfile" },
  { email: "test_profile@test.com" },
);

// Prints
// Sent password email to user: test_profile@test.com
// Sent request to third-party service
```

3. Custom ordering of listeners

```ts
interface MyClassEvents {
  add: (el: string) => void;
  delete: (changedCount: number) => void;
}
const manager = new OrderedEventEmitter<MyClassEvents>();

//add a listener with priority 1
manager.on(
  "add",
  (el) => {
    console.log("added", el);
  },
  1,
  "add1",
);

//add a listener with priority 2
manager.on(
  "add",
  (el) => {
    console.log("added", "nope");
  },
  2,
  "add2",
);

manager.emit(
  {
    event: "add",
    arrangeListeners: (listeners) => {
      //remove listener with key of `add2`
      return listeners.filter((listener) => listener.key !== "add2");
    },
  },
  "hello",
);

// Prints
// added hello
```
