# Red Hat Operator Catalog Fetcher

A single-page web application that allows users to select a Red Hat operator catalog and version, fetch the corresponding container image, and list the operators available within that image.

## Features

- **Catalog Selection**: Choose from Red Hat, Certified, Community, or Marketplace operator catalogs
- **Version Selection**: Select from available versions (v4.15 through v4.20)
- **Operator Listing**: Automatically fetch and display all available operators from the selected catalog

## Prerequisites

- Node.js 18 or higher
- Podman installed and configured
- Access to `registry.redhat.io` (requires Red Hat credentials)

## Installation

1. Clone or download this repository

2. Install dependencies:
```bash
npm install
```

3. Ensure Podman is installed and configured:
```bash
podman --version
```

4. Login to Red Hat registry (if not already logged in):
```bash
podman login registry.redhat.io
```

## Running the Application

### Development Mode

Start the server:
```bash
npm start
```

The application will be available at `http://localhost:3000`

### Docker Deployment

**Important Note**: Running Podman inside a container requires special privileges and configuration. The Dockerfile is provided as a starting point, but you may need to adjust it based on your container runtime and security requirements.

Build the Docker image:
```bash
docker build -t operator-catalog-fetcher .
```

Run the container (with necessary privileges for Podman):
```bash
docker run -d \
  --name operator-fetcher \
  -p 3000:3000 \
  --privileged \
  -v /var/run/podman.sock:/var/run/podman.sock \
  operator-catalog-fetcher
```

**Alternative**: For production deployments, consider running the Node.js application directly on a host with Podman installed, rather than containerizing it.

## Usage

1. Open the web interface in your browser
2. Select a catalog from the "Select Catalog" dropdown
3. Select a version from the "Select Version" dropdown
4. Click "Fetch Operators" button
5. Wait for the operators to be fetched (this may take a few minutes as it pulls the container image)
6. Once complete, select an operator from the "Select Operator" dropdown

## API Endpoint

### POST /api/fetch-operators

Fetches operators from a specified catalog and version.

**Request Body:**
```json
{
  "catalog": "redhat-operator-index",
  "version": "v4.20"
}
```

**Response:**
```json
{
  "operators": [
    "operator-a",
    "operator-b",
    "operator-c"
  ]
}
```

**Error Response:**
```json
{
  "error": "Error message",
  "message": "Detailed error message"
}
```

## Available Catalogs

- `redhat-operator-index` - Red Hat
- `certified-operator-index` - Certified
- `community-operator-index` - Community
- `redhat-marketplace-index` - Marketplace

## Available Versions

- v4.20
- v4.19
- v4.18
- v4.17
- v4.16
- v4.15

## Project Structure

```
.
├── server.js          # Express server and API endpoints
├── package.json       # Node.js dependencies
├── Dockerfile         # Container definition
├── README.md          # This file
└── public/
    ├── index.html     # Frontend HTML
    ├── style.css      # Frontend styles
    └── app.js         # Frontend JavaScript
```

## Troubleshooting

### Podman not found
Ensure Podman is installed and available in your PATH:
```bash
which podman
```

### Registry authentication errors
Make sure you're logged into the Red Hat registry:
```bash
podman login registry.redhat.io
```

### Permission errors
If you encounter permission errors with Podman, you may need to run the application with appropriate permissions or configure rootless Podman.

### Container cleanup
The application automatically cleans up temporary containers and directories. If you notice leftover containers, you can manually remove them:
```bash
podman ps -a | grep catalog-temp
podman rm <container-id>
```

## License

ISC

