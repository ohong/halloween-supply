// Minimal typings for bun:test (bun-types is not a dependency of this repo).
declare module "bun:test" {
  interface Matchers {
    not: Matchers;
    rejects: Matchers;
    toBe(v: unknown): void;
    toEqual(v: unknown): void;
    toMatchObject(v: unknown): void;
    toContain(v: unknown): void;
    toHaveLength(n: number): void;
    toBeNull(): void;
    toBeLessThan(n: number): void;
    toBeGreaterThan(n: number): void;
    toBeCloseTo(n: number, digits?: number): void;
    toThrow(msg?: unknown): void | Promise<void>;
  }
  type Each = <T extends readonly unknown[] | unknown>(
    cases: readonly T[],
  ) => (name: string, fn: (...args: T extends readonly unknown[] ? [...T] : [T]) => unknown) => void;
  type Test = ((name: string, fn: () => unknown | Promise<unknown>) => void) & { each: Each };
  export const describe: (name: string, fn: () => void) => void;
  export const test: Test;
  export const it: Test;
  export const expect: (v: unknown) => Matchers;
  export const beforeAll: (fn: () => unknown | Promise<unknown>) => void;
  export const afterAll: (fn: () => unknown | Promise<unknown>) => void;
}
