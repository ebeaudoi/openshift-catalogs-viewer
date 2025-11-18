#!/bin/sh
set -e

echo "Initializing Podman in container..."

# Verify Podman is installed
if ! command -v podman >/dev/null 2>&1; then
    echo "ERROR: Podman is not installed"
    exit 1
fi

# Display Podman version
echo "Podman version:"
podman --version

# Initialize Podman storage (if needed)
# This creates the necessary storage directories
if [ ! -f /var/lib/containers/storage/libpod/bolt_state.db ]; then
    echo "Initializing Podman storage..."
    podman system migrate 2>/dev/null || true
fi

# Verify Podman can run basic commands
echo "Testing Podman..."
podman info >/dev/null 2>&1 || {
    echo "WARNING: Podman info check failed, but continuing..."
    echo "This may be normal in containerized environments"
}

echo "Podman initialization complete. Starting application..."

# Execute the main command
exec "$@"

