import { localTraces } from "corax/instrumentation/otel";

// Writes OpenTelemetry traces for every run into `.corax/`, where
// `corax traces` and the `/traces` TUI command read them.
export default localTraces();
