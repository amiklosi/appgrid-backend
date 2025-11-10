FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy source code and configs
COPY tsconfig.json ./
COPY src ./src
COPY prisma.config.ts ./

# Copy Prisma schema and migrations
COPY prisma ./prisma

# Switch to PostgreSQL for production
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma

# Generate Prisma Client (use dummy DATABASE_URL for build)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npx prisma generate

# Build TypeScript
RUN yarn build

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose port
EXPOSE 3000

# Use entrypoint to run migrations before starting
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["yarn", "start"]