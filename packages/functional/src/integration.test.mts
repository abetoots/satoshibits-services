import { describe, expect, it } from "vitest";

import { pipe } from "./composition.mjs";
import { IO } from "./io.mjs";
import { none, Option, some } from "./option.mjs";
import { Reader } from "./reader.mjs";
import { Result } from "./result.mjs";
import { Task } from "./task.mjs";

/**
 * Integration tests for cross-module functionality.
 * These tests verify that different functional types work well together.
 */

describe("Cross-Module Integration", () => {
  describe("Task with Result", () => {
    it("should compose Task<Result> naturally", async () => {
      const taskResult: Task<Result<number, string>> = Task.of(Result.ok(42));

      const transformed = pipe(
        taskResult,
        Task.map(Result.map((n: number) => n * 2)),
      );

      const result = await Task.run(transformed);
      expect(result).toEqual(Result.ok(84));
    });

    it("should handle async operations that can fail", async () => {
      const fetchUser = (id: number): Task<Result<{ name: string }, string>> =>
        Task.fromPromise(async () => {
          if (id <= 0) {
            return Result.err("Invalid ID");
          }
          // simulate async fetch
          await new Promise((resolve) => setTimeout(resolve, 10));
          return Result.ok({ name: `User${id}` });
        });

      const result1 = await Task.run(fetchUser(1));
      expect(result1).toEqual(Result.ok({ name: "User1" }));

      const result2 = await Task.run(fetchUser(-1));
      expect(result2).toEqual(Result.err("Invalid ID"));
    });

    it("should chain Task<Result> operations", async () => {
      const parseNumber = (s: string): Result<number, string> => {
        const n = Number(s);
        return isNaN(n) ? Result.err("Not a number") : Result.ok(n);
      };

      const fetchMultiplier = (n: number): Task<Result<number, string>> =>
        Task.of(n > 0 ? Result.ok(n * 2) : Result.err("Must be positive"));

      const program = (input: string): Task<Result<number, string>> =>
        pipe(
          Task.of(parseNumber(input)),
          Task.chain((result: Result<number, string>) =>
            Result.isOk(result)
              ? fetchMultiplier(result.data)
              : Task.of(result as Result<number, string>),
          ),
        );

      expect(await Task.run(program("5"))).toEqual(Result.ok(10));
      expect(await Task.run(program("-5"))).toEqual(
        Result.err("Must be positive"),
      );
      expect(await Task.run(program("abc"))).toEqual(
        Result.err("Not a number"),
      );
    });
  });

  describe("Task with Option", () => {
    it("should compose Task<Option> for nullable async operations", async () => {
      const findUser = (id: number): Task<Option<{ name: string }>> =>
        Task.of(id > 0 ? some({ name: `User${id}` }) : none());

      const getUserName = (id: number): Task<Option<string>> =>
        pipe(
          findUser(id),
          Task.map(Option.map((user: { name: string }) => user.name)),
        );

      expect(await Task.run(getUserName(1))).toEqual(some("User1"));
      expect(await Task.run(getUserName(-1))).toEqual(none());
    });
  });

  describe("Reader with Result", () => {
    interface Config {
      maxRetries: number;
      apiKey: string;
    }

    it("should combine Reader and Result for config-dependent operations", () => {
      const validateApiKey = Reader.asks<Config, Result<string, string>>(
        (config) =>
          config.apiKey.length > 0
            ? Result.ok(config.apiKey)
            : Result.err("API key is required"),
      );

      const config1: Config = { maxRetries: 3, apiKey: "secret123" };
      const config2: Config = { maxRetries: 3, apiKey: "" };

      expect(Reader.run(config1)(validateApiKey)).toEqual(
        Result.ok("secret123"),
      );
      expect(Reader.run(config2)(validateApiKey)).toEqual(
        Result.err("API key is required"),
      );
    });

    it("should chain Reader<Result> operations", () => {
      const getApiKey = Reader.asks<Config, Result<string, string>>((c) =>
        c.apiKey ? Result.ok(c.apiKey) : Result.err("No API key"),
      );

      const getRetries = Reader.asks<Config, Result<number, string>>((c) =>
        c.maxRetries > 0
          ? Result.ok(c.maxRetries)
          : Result.err("Invalid retries"),
      );

      const buildRequest = Reader.chain<
        Config,
        Result<string, string>,
        Result<{ key: string; retries: number }, string>
      >((keyResult: Result<string, string>) =>
        Reader.chain<
          Config,
          Result<number, string>,
          Result<{ key: string; retries: number }, string>
        >((retriesResult: Result<number, string>) =>
          Reader.of(
            Result.isOk(keyResult) && Result.isOk(retriesResult)
              ? Result.ok({ key: keyResult.data, retries: retriesResult.data })
              : Result.err(
                  Result.isErr(keyResult)
                    ? keyResult.error
                    : Result.isErr(retriesResult)
                    ? retriesResult.error
                    : "Unknown error",
                ),
          ),
        )(getRetries),
      )(getApiKey);

      const config: Config = { maxRetries: 3, apiKey: "key123" };
      expect(Reader.run(config)(buildRequest)).toEqual(
        Result.ok({ key: "key123", retries: 3 }),
      );
    });

    it("should handle errors in Reader<Result> chains", () => {
      const getApiKey = Reader.asks<Config, Result<string, string>>((c) =>
        c.apiKey ? Result.ok(c.apiKey) : Result.err("No API key"),
      );

      const getRetries = Reader.asks<Config, Result<number, string>>((c) =>
        c.maxRetries > 0
          ? Result.ok(c.maxRetries)
          : Result.err("Invalid retries"),
      );

      const buildRequest = Reader.chain<
        Config,
        Result<string, string>,
        Result<{ key: string; retries: number }, string>
      >((keyResult: Result<string, string>) =>
        Reader.chain<
          Config,
          Result<number, string>,
          Result<{ key: string; retries: number }, string>
        >((retriesResult: Result<number, string>) =>
          Reader.of(
            Result.isOk(keyResult) && Result.isOk(retriesResult)
              ? Result.ok({ key: keyResult.data, retries: retriesResult.data })
              : Result.err(
                  Result.isErr(keyResult)
                    ? keyResult.error
                    : Result.isErr(retriesResult)
                    ? retriesResult.error
                    : "Unknown error",
                ),
          ),
        )(getRetries),
      )(getApiKey);

      // test missing api key
      const configNoKey: Config = { maxRetries: 3, apiKey: "" };
      expect(Reader.run(configNoKey)(buildRequest)).toEqual(
        Result.err("No API key"),
      );

      // test invalid retries
      const configBadRetries: Config = { maxRetries: 0, apiKey: "key123" };
      expect(Reader.run(configBadRetries)(buildRequest)).toEqual(
        Result.err("Invalid retries"),
      );

      // test both failures (should return first error)
      const configBothBad: Config = { maxRetries: -1, apiKey: "" };
      expect(Reader.run(configBothBad)(buildRequest)).toEqual(
        Result.err("No API key"),
      );
    });
  });

  describe("Reader with Task", () => {
    interface AsyncConfig {
      baseUrl: string;
      timeout: number;
    }

    it("should combine Reader and Task for async config-dependent operations", async () => {
      const fetchData = Reader.asks<AsyncConfig, Task<string>>((config) =>
        Task.fromPromise(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return `Data from ${config.baseUrl}`;
        }),
      );

      const config: AsyncConfig = {
        baseUrl: "https://api.example.com",
        timeout: 5000,
      };
      const task = Reader.run(config)(fetchData);
      const result = await Task.run(task);

      expect(result).toBe("Data from https://api.example.com");
    });
  });

  describe("IO with Result", () => {
    it("should combine IO and Result for synchronous fallible operations", () => {
      let counter = 0;
      const incrementAndCheck: IO<Result<number, string>> = () => {
        counter++;
        return counter <= 3 ? Result.ok(counter) : Result.err("Too many calls");
      };

      expect(IO.run(incrementAndCheck)).toEqual(Result.ok(1));
      expect(IO.run(incrementAndCheck)).toEqual(Result.ok(2));
      expect(IO.run(incrementAndCheck)).toEqual(Result.ok(3));
      expect(IO.run(incrementAndCheck)).toEqual(Result.err("Too many calls"));
    });
  });

  describe("Complex composition scenarios", () => {
    it("should handle Task<Reader<Config, Result<T, E>>>", async () => {
      interface AppConfig {
        feature: {
          enabled: boolean;
          limit: number;
        };
      }

      const checkFeature = (
        value: number,
      ): Task<Reader<AppConfig, Result<number, string>>> =>
        Task.of(
          Reader.asks<AppConfig, Result<number, string>>((config) => {
            if (!config.feature.enabled) {
              return Result.err("Feature disabled");
            }
            if (value > config.feature.limit) {
              return Result.err(
                `Value ${value} exceeds limit ${config.feature.limit}`,
              );
            }
            return Result.ok(value * 2);
          }),
        );

      const config: AppConfig = { feature: { enabled: true, limit: 100 } };

      const result1 = await Task.run(
        Task.map(Reader.run(config))(checkFeature(50)),
      );
      expect(result1).toEqual(Result.ok(100));

      const result2 = await Task.run(
        Task.map(Reader.run(config))(checkFeature(150)),
      );
      expect(result2).toEqual(Result.err("Value 150 exceeds limit 100"));
    });

    it("should handle IO<Option<Result<T, E>>>", () => {
      const complexOperation =
        (input: string): IO<Option<Result<number, string>>> =>
        () => {
          if (!input) {
            return none();
          }
          const n = Number(input);
          if (isNaN(n)) {
            return some(Result.err("Invalid number"));
          }
          return some(Result.ok(n));
        };

      expect(IO.run(complexOperation(""))).toEqual(none());
      expect(IO.run(complexOperation("42"))).toEqual(some(Result.ok(42)));
      expect(IO.run(complexOperation("abc"))).toEqual(
        some(Result.err("Invalid number")),
      );
    });

    it("should handle nested transformations across types", async () => {
      // Task<Option<Result<T, E>>>
      const fetchOptionalData = (
        id: number,
      ): Task<Option<Result<string, string>>> =>
        Task.fromPromise(() => Promise.resolve(
          id === 0 ? none() :
          id < 0 ? some(Result.err("Invalid ID")) :
          some(Result.ok(`Data${id}`))
        ));

      // transform the deeply nested value
      const transformed = pipe(
        fetchOptionalData(1),
        Task.map(Option.map(Result.map((s: string) => s.toUpperCase()))),
      );

      const result = await Task.run(transformed);
      expect(result).toEqual(some(Result.ok("DATA1")));
    });
  });

  describe("Error propagation across types", () => {
    it("should propagate errors correctly through Task<Result>", async () => {
      const errorTask: Task<Result<number, string>> = Task.fromPromise(() =>
        Promise.reject(new Error("Network error")),
      );

      await expect(Task.run(errorTask)).rejects.toThrow("Network error");
    });

    it("should handle Option.none() in different contexts", () => {
      const noneToResult = (opt: Option<number>): Result<number, string> =>
        Option.isSome(opt) ? Result.ok(opt.value) : Result.err("No value");

      expect(noneToResult(some(42))).toEqual(Result.ok(42));
      expect(noneToResult(none())).toEqual(Result.err("No value"));
    });

    it("should chain operations with mixed success/failure", async () => {
      const step1 = (n: number): Task<Result<number, string>> =>
        Task.of(n > 0 ? Result.ok(n * 2) : Result.err("Must be positive"));

      const step2 = (n: number): Result<Option<number>, string> =>
        n > 10 ? Result.ok(some(n)) : Result.ok(none());

      const program = async (input: number) => {
        const r1 = await Task.run(step1(input));
        if (Result.isErr(r1)) return r1;
        return step2(r1.data);
      };

      expect(await program(5)).toEqual(Result.ok(none())); // 5 * 2 = 10, not > 10
      expect(await program(10)).toEqual(Result.ok(some(20))); // 10 * 2 = 20, > 10
      expect(await program(-5)).toEqual(Result.err("Must be positive"));
    });
  });

  describe("Real-world patterns", () => {
    it("should handle API request pattern with retries", async () => {
      interface ApiConfig {
        baseUrl: string;
        maxRetries: number;
      }

      let attempts = 0;
      const apiCall = Reader.asks<ApiConfig, Task<Result<string, string>>>(
        (config) =>
          Task.fromPromise(() => {
            attempts++;
            return Promise.resolve(
              attempts < config.maxRetries
                ? Result.err(`Attempt ${attempts} failed`)
                : Result.ok(`Success after ${attempts} attempts`)
            );
          }),
      );

      const withRetry = (
        task: Task<Result<string, string>>,
        retries: number,
      ): Task<Result<string, string>> =>
        Task.chain((result: Result<string, string>) =>
          Result.isErr(result) && retries > 0
            ? withRetry(task, retries - 1)
            : Task.of(result),
        )(task);

      const config: ApiConfig = {
        baseUrl: "https://api.example.com",
        maxRetries: 3,
      };
      const task = Reader.run(config)(apiCall);
      const result = await Task.run(withRetry(task, config.maxRetries));

      expect(result).toEqual(Result.ok("Success after 3 attempts"));
      expect(attempts).toBe(3);
    });

    it("should handle form validation pattern", () => {
      interface FormData {
        username: string;
        email: string;
        age: string;
      }

      const validateUsername = (username: string): Result<string, string> =>
        username.length >= 3
          ? Result.ok(username)
          : Result.err("Username too short");

      const validateEmail = (email: string): Result<string, string> =>
        email.includes("@") ? Result.ok(email) : Result.err("Invalid email");

      const validateAge = (age: string): Result<number, string> => {
        const n = Number(age);
        if (isNaN(n)) return Result.err("Age must be a number");
        if (n < 18) return Result.err("Must be 18 or older");
        return Result.ok(n);
      };

      const validateForm = (data: FormData) =>
        Result.Do<string>()
          .bind("username", validateUsername(data.username))
          .bind("email", validateEmail(data.email))
          .bind("age", validateAge(data.age))
          .map(({ username, email, age }) => ({
            username,
            email,
            age,
          }));

      const validData: FormData = {
        username: "john",
        email: "john@example.com",
        age: "25",
      };
      const invalidData: FormData = {
        username: "jo",
        email: "john@example.com",
        age: "25",
      };

      expect(validateForm(validData)).toEqual(
        Result.ok({ username: "john", email: "john@example.com", age: 25 }),
      );
      expect(validateForm(invalidData)).toEqual(
        Result.err("Username too short"),
      );
    });
  });
});
