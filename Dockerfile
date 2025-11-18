FROM node:18-alpine

# Install podman and required dependencies
# Podman in containers requires additional packages for storage and networking
RUN apk add --no-cache \
    podman \
    shadow \
    fuse-overlayfs \
    slirp4netns \
    crun \
    iptables \
    && rm -rf /var/cache/apk/*

# Create necessary directories for Podman storage
# Running as root with --privileged, so no need for separate podman user
RUN mkdir -p /var/lib/containers/storage \
    /var/lib/containers/storage/overlay \
    /var/lib/containers/storage/volumes \
    /run/podman \
    /etc/containers

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY server.js ./
COPY public ./public

# Create entrypoint script to initialize Podman
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use entrypoint to initialize Podman before starting the app
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]

