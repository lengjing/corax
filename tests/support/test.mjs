import { test as bunTest, spyOn } from "bun:test";

// Per-test resources are released even when an assertion fails.
export default function test(name, options, body) {
  if (typeof options === "function") {
    body = options;
    options = {};
  }
  return bunTest(name, async () => {
    const cleanups = [];
    const context = {
      after(cleanup) { cleanups.push(cleanup); },
      mock: {
        method(object, key, implementation) {
          const spy = spyOn(object, key).mockImplementation(implementation);
          cleanups.push(() => spy.mockRestore());
          return { mock: {
            restore: () => spy.mockRestore(),
            mockImplementation: (fn) => spy.mockImplementation(fn),
            callCount: () => spy.mock.calls.length,
          } };
        },
      },
    };
    const errors = [];
    try { await body(context); } catch (error) { errors.push(error); }
    for (const cleanup of cleanups.reverse()) {
      try { await cleanup(); } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Test body or resource cleanup failed.");
  }, options.timeout);
}
