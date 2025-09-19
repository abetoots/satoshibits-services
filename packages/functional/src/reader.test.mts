import { describe, expect, it } from "vitest";

import { Reader } from "./reader.mjs";

interface Config {
  apiUrl: string;
  timeout: number;
  debug: boolean;
}

interface AppConfig {
  region: string;
  service: {
    config: Config;
  };
}

describe("Reader", () => {
  const testConfig: Config = {
    apiUrl: "https://test.api",
    timeout: 5000,
    debug: true,
  };

  describe("of", () => {
    it("should create a Reader that returns the value ignoring environment", () => {
      const reader = Reader.of<Config, number>(42);
      expect(Reader.run(testConfig)(reader)).toBe(42);
    });

    it("should work with any environment", () => {
      const reader = Reader.of<Config, string>("constant");
      const config1: Config = { apiUrl: "url1", timeout: 1000, debug: false };
      const config2: Config = { apiUrl: "url2", timeout: 2000, debug: true };

      expect(Reader.run(config1)(reader)).toBe("constant");
      expect(Reader.run(config2)(reader)).toBe("constant");
    });
  });

  describe("ask", () => {
    it("should provide the full environment", () => {
      const reader = Reader.ask<Config>();
      expect(Reader.run(testConfig)(reader)).toEqual(testConfig);
    });

    it("should return different environments when run with different configs", () => {
      const reader = Reader.ask<Config>();
      const config1: Config = { apiUrl: "url1", timeout: 1000, debug: false };
      const config2: Config = { apiUrl: "url2", timeout: 2000, debug: true };

      expect(Reader.run(config1)(reader)).toEqual(config1);
      expect(Reader.run(config2)(reader)).toEqual(config2);
    });
  });

  describe("asks", () => {
    it("should select a part of the environment", () => {
      const getApiUrl = Reader.asks<Config, string>((c) => c.apiUrl);
      expect(Reader.run(testConfig)(getApiUrl)).toBe("https://test.api");
    });

    it("should work with nested selections", () => {
      const appConfig: AppConfig = {
        region: "us-east",
        service: {
          config: testConfig,
        },
      };

      const getTimeout = Reader.asks<AppConfig, number>(
        (ac) => ac.service.config.timeout,
      );
      expect(Reader.run(appConfig)(getTimeout)).toBe(5000);
    });
  });

  describe("map", () => {
    it("should transform the value", () => {
      const getTimeout = Reader.asks<Config, number>((c) => c.timeout);
      const inSeconds = Reader.map<Config, number, number>((ms) => ms / 1000);
      const reader = inSeconds(getTimeout);

      expect(Reader.run(testConfig)(reader)).toBe(5);
    });

    it("should chain transformations", () => {
      const getDebug = Reader.asks<Config, boolean>((c) => c.debug);
      const reader = Reader.map<Config, string, number>((s) => s.length)(
        Reader.map<Config, boolean, string>((b) => b.toString())(getDebug),
      );

      expect(Reader.run(testConfig)(reader)).toBe(4); // "true".length
    });
  });

  describe("chain / flatMap", () => {
    it("should sequence dependent computations", () => {
      const getUrl = Reader.asks<Config, string>((c) => c.apiUrl);
      const createRequest = (url: string) =>
        Reader.asks<Config, { url: string; timeout: number }>((c) => ({
          url,
          timeout: c.timeout,
        }));

      const program = Reader.chain(createRequest)(getUrl);
      const result = Reader.run(testConfig)(program);

      expect(result).toEqual({
        url: "https://test.api",
        timeout: 5000,
      });
    });

    it("flatMap should be an alias for chain", () => {
      const reader1 = Reader.of<Config, number>(5);
      const reader2 = (n: number) => Reader.of<Config, number>(n * 2);

      const chained = Reader.chain(reader2)(reader1);
      const flatMapped = Reader.flatMap(reader2)(reader1);

      expect(Reader.run(testConfig)(chained)).toBe(10);
      expect(Reader.run(testConfig)(flatMapped)).toBe(10);
    });
  });

  describe("ap", () => {
    it("should apply a Reader of a function to a Reader of a value", () => {
      const add = (a: number) => (b: number) => a + b;
      const getTimeout = Reader.asks<Config, number>((c) => c.timeout);
      const readerAdd = Reader.map<Config, number, (b: number) => number>(add)(
        getTimeout,
      );
      const readerValue = Reader.of<Config, number>(1000);

      const result = Reader.ap(readerValue)(readerAdd);
      expect(Reader.run(testConfig)(result)).toBe(6000);
    });

    it("should work with multiple dependencies", () => {
      interface Config2 {
        x: number;
        y: number;
      }
      const config2: Config2 = { x: 5, y: 3 };

      const add = (a: number) => (b: number) => a + b;
      const getX = Reader.asks<Config2, number>((c) => c.x);
      const getY = Reader.asks<Config2, number>((c) => c.y);

      const sum = Reader.ap<Config2, number, number>(getY)(
        Reader.map<Config2, number, (b: number) => number>(add)(getX),
      );

      expect(Reader.run(config2)(sum)).toBe(8);
    });
  });

  describe("local", () => {
    it("should modify the environment for a sub-computation", () => {
      const appConfig: AppConfig = {
        region: "us-east",
        service: {
          config: testConfig,
        },
      };

      const getTimeout = Reader.asks<Config, number>((c) => c.timeout);
      const program = Reader.local<AppConfig, Config>(
        (ac) => ac.service.config,
      )(getTimeout);

      expect(Reader.run(appConfig)(program)).toBe(5000);
    });

    it("should work with nested local transformations", () => {
      interface GlobalConfig {
        regions: Record<string, AppConfig>;
        activeRegion: string;
      }

      const globalConfig: GlobalConfig = {
        regions: {
          "us-east": {
            region: "us-east",
            service: { config: testConfig },
          },
        },
        activeRegion: "us-east",
      };

      const getApiUrl = Reader.asks<Config, string>((c) => c.apiUrl);

      const program = Reader.local<GlobalConfig, AppConfig>(
        (gc) => gc.regions[gc.activeRegion]!,
      )(Reader.local<AppConfig, Config>((ac) => ac.service.config)(getApiUrl));

      expect(Reader.run(globalConfig)(program)).toBe("https://test.api");
    });
  });

  describe("sequence", () => {
    it("should convert array of Readers to Reader of array", () => {
      const readers: Reader<Config, string>[] = [
        Reader.asks((c) => c.apiUrl),
        Reader.asks((c) => c.timeout.toString()),
        Reader.asks((c) => c.debug.toString()),
      ];

      const sequenced = Reader.sequence(readers);
      const result = Reader.run(testConfig)(sequenced);

      expect(result).toEqual(["https://test.api", "5000", "true"]);
    });

    it("should handle empty array", () => {
      const sequenced = Reader.sequence<Config, unknown>([]);
      expect(Reader.run(testConfig)(sequenced)).toEqual([]);
    });
  });

  describe("traverse", () => {
    it("should map and sequence", () => {
      const keys: (keyof Config)[] = ["apiUrl", "timeout", "debug"];
      const fn = (key: keyof Config) =>
        Reader.asks<Config, string>((c) => String(c[key]));

      const traverse = Reader.traverse(fn);
      const result = Reader.run(testConfig)(traverse(keys));

      expect(result).toEqual(["https://test.api", "5000", "true"]);
    });

    it("should handle empty array", () => {
      const fn = (n: number) => Reader.of<Config, number>(n * 2);
      const traverse = Reader.traverse(fn);
      const result = Reader.run(testConfig)(traverse([]));
      expect(result).toEqual([]);
    });
  });

  describe("sequenceT", () => {
    it("should combine tuple of Readers", () => {
      const r1 = Reader.asks<Config, string>((c) => c.apiUrl);
      const r2 = Reader.asks<Config, number>((c) => c.timeout);
      const r3 = Reader.asks<Config, boolean>((c) => c.debug);

      const combined = Reader.sequenceT<Config, [string, number, boolean]>(r1, r2, r3);
      const result = Reader.run(testConfig)(combined);

      expect(result).toEqual(["https://test.api", 5000, true]);
    });

    it("should handle empty tuple", () => {
      const result = Reader.run(testConfig)(Reader.sequenceT());
      expect(result).toEqual([]);
    });
  });

  describe("sequenceS", () => {
    it("should combine record of Readers", () => {
      const readers = {
        url: Reader.asks<Config, string>((c) => c.apiUrl),
        timeout: Reader.asks<Config, number>((c) => c.timeout),
        isDebug: Reader.asks<Config, boolean>((c) => c.debug),
      };

      const combined = Reader.sequenceS<Config, { url: string; timeout: number; isDebug: boolean }>(readers);
      const result = Reader.run(testConfig)(combined);

      expect(result).toEqual({
        url: "https://test.api",
        timeout: 5000,
        isDebug: true,
      });
    });

    it("should handle empty record", () => {
      const result = Reader.run(testConfig)(Reader.sequenceS({}));
      expect(result).toEqual({});
    });
  });

  describe("chainFirst", () => {
    it("should execute side effect but return original value", () => {
      const log: string[] = [];
      const logReader =
        (msg: string): Reader<Config, void> =>
        () => {
          log.push(msg);
        };

      const getApiUrl = Reader.asks<Config, string>((c) => c.apiUrl);
      const withLogging = Reader.chainFirst<Config, string>((url) =>
        logReader(`Got URL: ${url}`),
      )(getApiUrl);

      expect(log).toEqual([]);
      const result = Reader.run(testConfig)(withLogging);
      expect(log).toEqual(["Got URL: https://test.api"]);
      expect(result).toBe("https://test.api");
    });
  });

  describe("Reader laws", () => {
    it("should satisfy ask law: run(env)(ask) ≅ env", () => {
      const reader = Reader.ask<Config>();
      expect(Reader.run(testConfig)(reader)).toEqual(testConfig);
    });

    it("should satisfy asks law: run(env)(asks(f)) ≅ f(env)", () => {
      const f = (c: Config) => c.apiUrl + ":" + c.timeout;
      const reader = Reader.asks(f);
      expect(Reader.run(testConfig)(reader)).toBe(f(testConfig));
    });

    it("should satisfy local law: run(env)(local(f)(r)) ≅ run(f(env))(r)", () => {
      const appConfig: AppConfig = {
        region: "us-east",
        service: { config: testConfig },
      };

      const getTimeout = Reader.asks<Config, number>((c) => c.timeout);
      const f = (ac: AppConfig) => ac.service.config;

      const localReader = Reader.local(f)(getTimeout);
      const result1 = Reader.run(appConfig)(localReader);
      const result2 = Reader.run(f(appConfig))(getTimeout);

      expect(result1).toEqual(result2);
    });
  });

  describe("Functor laws", () => {
    it("should satisfy identity law: map(id) ≅ id", () => {
      const reader = Reader.asks<Config, string>((c) => c.apiUrl);
      const id = <T,>(x: T) => x;
      const mapped = Reader.map<Config, string, string>(id)(reader);

      expect(Reader.run(testConfig)(reader)).toEqual(
        Reader.run(testConfig)(mapped),
      );
    });

    it("should satisfy composition law: map(g∘f) ≅ map(g)∘map(f)", () => {
      const reader = Reader.asks<Config, number>((c) => c.timeout);
      const f = (n: number) => n / 1000;
      const g = (n: number) => n.toString();

      const composed1 = Reader.map<Config, number, string>((x) => g(f(x)))(
        reader,
      );
      const composed2 = Reader.map<Config, number, string>(g)(
        Reader.map<Config, number, number>(f)(reader),
      );

      expect(Reader.run(testConfig)(composed1)).toEqual(
        Reader.run(testConfig)(composed2),
      );
    });
  });

  describe("Monad laws", () => {
    it("should satisfy left identity: chain(f)(of(x)) ≅ f(x)", () => {
      const x = 42;
      const f = (n: number) =>
        Reader.asks<Config, string>((c) => `${c.apiUrl}/${n}`);

      const result1 = Reader.run(testConfig)(
        Reader.chain(f)(Reader.of<Config, number>(x)),
      );
      const result2 = Reader.run(testConfig)(f(x));
      expect(result1).toEqual(result2);
    });

    it("should satisfy right identity: chain(of)(m) ≅ m", () => {
      const reader = Reader.asks<Config, string>((c) => c.apiUrl);
      const chained = Reader.chain<Config, string, string>(Reader.of)(reader);

      expect(Reader.run(testConfig)(reader)).toEqual(
        Reader.run(testConfig)(chained),
      );
    });

    it("should satisfy associativity", () => {
      const reader = Reader.asks<Config, number>((c) => c.timeout);
      const f = (n: number) =>
        Reader.asks<Config, number>((c) => (c.debug ? n * 2 : n));
      const g = (n: number) =>
        Reader.asks<Config, string>((c) => `${c.apiUrl}/${n}`);

      const left = Reader.chain(g)(Reader.chain(f)(reader));
      const right = Reader.chain((x: number) => Reader.chain(g)(f(x)))(reader);

      expect(Reader.run(testConfig)(left)).toEqual(
        Reader.run(testConfig)(right),
      );
    });
  });
});
