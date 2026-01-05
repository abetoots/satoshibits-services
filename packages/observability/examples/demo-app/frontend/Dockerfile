# --- Monorepo Builder Stage ---
# This stage understands the pnpm workspace and builds required packages.
FROM node:20-alpine AS monorepo-builder

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy files required for pnpm to resolve the workspace and install dependencies.
# This includes the root package.json (for devDependencies like typescript),
# the lockfile, and the workspace config.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all source code from the monorepo packages and tooling.
# The build context is the monorepo root, so this works.
COPY packages ./packages
COPY tooling ./tooling

# Install all dependencies for the entire workspace.
RUN pnpm install --frozen-lockfile

# Build the target package (@satoshibits/observability) and its dependencies.
# The "..." syntax ensures pnpm also builds any workspace dependencies first.
RUN pnpm --filter @satoshibits/observability... build

# After building, create a distributable tarball inside the package's directory.
RUN cd packages/observability && pnpm pack

# --- Final Application Stage ---
# This stage builds the final, lean application image using the artifact from above.
FROM node:20-alpine

WORKDIR /app

# Copy the built observability package from the monorepo-builder stage
COPY --from=monorepo-builder /app/packages/observability/*.tgz /tmp/observability.tgz

# Extract tarball and remove type-only dependencies that don't exist in npm registry
RUN cd /tmp && tar -xzf observability.tgz && \
    cd package && \
    sed -i '/"@satoshibits\/functional-errors":/d' package.json

# Copy frontend package files
COPY packages/observability/examples/demo-app/frontend/package*.json ./

# Replace the npm registry reference with local directory and remove package-lock
RUN sed -i 's|"@satoshibits/observability": "[^"]*"|"@satoshibits/observability": "file:/tmp/package"|' package.json && \
    rm -f package-lock.json

# Install dependencies for the frontend app
RUN npm install

# Copy frontend source code
COPY packages/observability/examples/demo-app/frontend/src ./src/
COPY packages/observability/examples/demo-app/frontend/index.html ./
COPY packages/observability/examples/demo-app/frontend/tsconfig*.json ./
COPY packages/observability/examples/demo-app/frontend/vite.config.ts ./

# Build the application
RUN npm run build

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
