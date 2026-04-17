// Stub for "server-only" package in Vitest environment.
// The real package throws at import time if used in a browser context;
// tests run under jsdom so we replace it with a no-op.
export {}
