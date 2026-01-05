import { SmartClient } from "@satoshibits/observability";
import cors from "cors";
import express from "express";

import { ordersRouter } from "./routes/orders.js";
import { paymentsRouter } from "./routes/payments.js";
import { productsRouter } from "./routes/products.js";
import { profileRouter } from "./routes/profile.js";

const app = express();
const PORT = process.env.PORT ?? 3001;

// observability configuration
const observabilityConfig = {
  serviceName: "web-store-backend",
  environment: "node" as const,
  endpoint: process.env.OBSERVABILITY_ENDPOINT ?? "http://localhost:4318",
  autoInstrument: true,

  // sampling configuration for cost control
  // see README for more examples
  sampling: {
    base: 0.1, // sample 10% of normal traffic

    rules: [
      // always capture important data
      { error: true, rate: 1.0 }, // 100% of errors
      { slow: true, rate: 1.0 }, // 100% of slow requests (>1s)

      // reduce noise from health checks
      { path: "/health", rate: 0 }, // 0% of health checks

      // sample by endpoint importance
      { path: "/api/orders", rate: 0.5 }, // 50% of orders (critical path)
      { path: "/api/payments", rate: 1.0 }, // 100% of payments (most critical)
    ],
  },
};

let observabilityClient: Awaited<
  ReturnType<typeof SmartClient.initialize>
> | null = null;

// initialize observability
async function initializeObservability() {
  try {
    observabilityClient = await SmartClient.initialize(observabilityConfig);

    // set service context using the business context API
    // note: setUser accepts (userId, attributes) or ({ id, email, name, ... })
    observabilityClient.context.business.setUser({
      id: "backend-service",
      name: "Web Store Backend",
    });

    observabilityClient.context.business.addBreadcrumb(
      "Backend service initialized",
      { category: "service_lifecycle" },
    );

    console.log("✅ Observability initialized successfully");
    return observabilityClient;
  } catch (error) {
    console.error("❌ Failed to initialize observability:", error);
    console.warn("⚠️ Backend will continue without observability telemetry");
    return null;
  }
}

// middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
    credentials: true,
  }),
);

app.use(express.json());

// observability middleware to add client to request context
app.use((req, res, next) => {
  req.observabilityClient = observabilityClient;
  next();
});

// context.business.run() middleware - creates scoped context for each request
// this is the recommended pattern from the README for request-level context
app.use((req, res, next) => {
  if (observabilityClient) {
    // context flows through all async operations automatically
    observabilityClient.context.business.run(
      {
        // add request-level context here
        // note: user context should be set after authentication
        requestId: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        method: req.method,
        path: req.path,
      },
      next,
    );
  } else {
    next();
  }
});

// request logging middleware
// note: HTTP metrics are automatically captured by autoInstrument: true
// this middleware only adds breadcrumbs and console logging
app.use((req, res, next) => {
  const startTime = Date.now();

  // add request breadcrumb if client available
  if (observabilityClient) {
    observabilityClient.context.business.addBreadcrumb(
      `HTTP ${req.method} ${req.path}`,
      {
        method: req.method,
        path: req.path,
        user_agent: req.headers["user-agent"],
        ip: req.ip,
      },
    );
  }

  res.on("finish", () => {
    const duration = Date.now() - startTime;
    console.log(
      `${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`,
    );
  });

  next();
});

// routes
app.use("/api/orders", ordersRouter);
app.use("/api/profile", profileRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/products", productsRouter);

// health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "web-store-backend",
    observability: observabilityClient ? "enabled" : "disabled",
    timestamp: new Date().toISOString(),
  });
});

// error handling middleware
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const client = req.observabilityClient;

    // capture error with context if client available
    if (client) {
      client.errors.record(err, {
        tags: {
          component: "express_error_handler",
          method: req.method,
          path: req.path,
        },
        extra: {
          body: req.body,
          query: req.query,
          params: req.params,
        },
      });

      client.context.business.addBreadcrumb(
        "Unhandled error in request",
        {
          error_message: err.message,
          method: req.method,
          path: req.path,
        },
      );
    }

    console.error("Unhandled error:", err);
    res.status(500).json({
      error: "Internal server error",
      message: err.message,
    });
  },
);

// start server
async function startServer() {
  // initialize observability first (non-blocking)
  await initializeObservability();

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(
      `📊 Observability: ${observabilityClient ? "enabled" : "disabled"}`,
    );
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
