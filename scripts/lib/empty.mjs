// Stands in for the `server-only` marker package when the integration tests
// import a service directly. The marker exists to stop server code being
// bundled into a client component; running it in Node is exactly what these
// tests are for.
export {};
