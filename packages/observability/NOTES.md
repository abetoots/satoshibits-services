1. A span represents a unit of work or operation and may contain other metadata ([Attributes](https://opentelemetry.io/docs/concepts/signals/traces/#attributes), Events, etc.). It will always a `context` field to represent the [Span Context](https://opentelemetry.io/docs/concepts/signals/traces/#span-context).
   a. You can add attributes to spans during or after span creation. Prefer adding attributes at span creation to make the attributes available to SDK sampling.
   b. Attributes have the following rules: Keys must be non-null string values. Values must be a non-null string, boolean, floating point value, integer, or an array of these values.
   c. There are [Semantic Attributes](https://opentelemetry.io/docs/specs/semconv/general/trace/) so common kinds of metadata are standardized.
   d. Span events are used to denote a meaningful, singular point in time during the Span’s duration. Use a span to denote an operation that has A START and AN END (tracking a page load). An example is denoting when a page becomes interactive (singular point in time).
   e. when to use span attributes vs events: If the timestamp in which the operation completes is meaningful or relevant, attach the data to a span event, otherwise, attach the data as attributes.

2. Trace is made up of one or more spans. A root, children, and its sibling spans typically belong to a single `trace_id`
   a. Tracer Provider is initialized once and is typically the first [step](https://opentelemetry.io/docs/concepts/signals/traces/#tracer-provider). It will include Resource and Exporter initialization.
   b. The provider is a factory for Tracers. A tracer creates spans.
   c. Trace exporters send traces to a consumer (the back-end i.e. OpenCollector)
