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

### Container Deployment

**Important Note**: Running Podman inside a container (Podman-in-Podman) requires the `--privileged` flag. For most use cases, it's recommended to run the application directly on the host.

#### Option 1: Run Directly on Host (Recommended)

This is the simplest and most reliable approach:

```bash
# Install dependencies
npm install

# Start the server
npm start
```

The application will be available at `http://localhost:3000`

#### Option 2: Container Deployment (Self-Contained Podman)

The container includes Podman and runs it internally, so no host Podman socket is required.

**Prerequisites**: 
- Podman installed
- Container must run with `--privileged` flag (required for Podman-in-Podman)

Build the container image:
```bash
podman build -t operator-catalog-fetcher .
```

Run the container:
```bash
podman run -d \
  --name operator-fetcher \
  -p 3000:3000 \
  --privileged \
  operator-catalog-fetcher
```

**Important Notes**:
- The `--privileged` flag is required for Podman to work inside the container
- No volume mounts are needed - Podman runs entirely inside the container
- The container will pull images from `registry.redhat.io` (requires Red Hat credentials)
- First run may take longer as Podman initializes its storage

**Registry Authentication**:

Before using the application, you must authenticate with the Red Hat registry inside the container:

```bash
# Login to Red Hat registry inside the container
podman exec -it operator-fetcher podman login registry.redhat.io
```

You will be prompted for:
- **Username**: Your Red Hat Customer Portal username
- **Password**: Your Red Hat Customer Portal password or token

Alternatively, you can pass credentials when starting the container by mounting your host's auth file:

```bash
# First, login on the host to create auth file
podman login registry.redhat.io

# Then run container with mounted auth file
podman run -d \
  --name operator-fetcher \
  -p 3000:3000 \
  --privileged \
  -v $HOME/.config/containers/auth.json:/root/.config/containers/auth.json:ro \
  operator-catalog-fetcher
```

**Troubleshooting Container Deployment**:

If you encounter issues:
1. **Authentication errors**: Make sure you've logged into the registry:
   ```bash
   podman exec -it operator-fetcher podman login registry.redhat.io
   ```
2. Check container logs: `podman logs operator-fetcher`
3. Verify Podman in container: `podman exec operator-fetcher podman --version`
4. Ensure `--privileged` flag is set (required for Podman-in-Podman)
5. Stop and remove container if needed:
   ```bash
   podman stop operator-fetcher
   podman rm operator-fetcher
   ```

#### Option 3: OpenShift Cluster Deployment

This section explains how to deploy the operator-catalog-fetcher application on an OpenShift cluster.

**Prerequisites**:
- Access to an OpenShift cluster (4.x or later)
- `oc` CLI tool installed and configured
- Cluster admin permissions (for creating SecurityContextConstraints)
- Red Hat Customer Portal credentials for registry authentication

**Step 1: Login to OpenShift Cluster**

```bash
oc login <your-openshift-cluster-url>
```

**Step 2: Create a New Project**

```bash
oc new-project operator-catalog-fetcher
# Or use an existing project
oc project <your-project-name>
```

**Step 3: Create SecurityContextConstraints (SCC)**

Podman-in-Podman requires privileged access. Create or use an existing privileged SCC:

```bash
# Check if you have cluster-admin permissions
oc get scc privileged

# If you don't have cluster-admin, ask your cluster administrator to grant you
# the 'privileged' SCC or create a custom SCC for your service account
```

**Step 4: Create ServiceAccount with Privileged Access**

```bash
# Create a service account
oc create serviceaccount operator-fetcher-sa

# Grant privileged SCC to the service account
oc adm policy add-scc-to-user privileged -z operator-fetcher-sa
```

**Step 5: Build and Push Container Image**

You have two options:

**Option A: Build in OpenShift (Recommended)**

```bash
# Create a BuildConfig
oc new-build --name operator-catalog-fetcher \
  --dockerfile - \
  --strategy docker \
  --binary

# Start the build from local source
oc start-build operator-catalog-fetcher --from-dir=. --follow
```

**Option B: Build Locally and Push to Registry**

```bash
# Build the image
podman build -t operator-catalog-fetcher .

# Tag for OpenShift internal registry
oc registry login
INTERNAL_REGISTRY=$(oc get route default-route -n openshift-image-registry --template='{{ .spec.host }}')
podman tag operator-catalog-fetcher ${INTERNAL_REGISTRY}/operator-catalog-fetcher/operator-catalog-fetcher:latest

# Push to OpenShift registry
podman push ${INTERNAL_REGISTRY}/operator-catalog-fetcher/operator-catalog-fetcher:latest
```

**Step 6: Configure ImagePullSecret for Red Hat Registry**

The application needs to pull images from `registry.redhat.io`. You have two options:

**Option A: Use OpenShift Default Pull-Secret (Recommended)**

OpenShift clusters have a default pull-secret in the `openshift-config` namespace that contains registry credentials, including Red Hat registry access. To use this pull-secret in your deployment:

```bash
# Step 1: Check if the default pull-secret exists
oc get secret pull-secret -n openshift-config

# Step 2: Extract the pull-secret data
# The pull-secret contains a .dockerconfigjson file with registry credentials
oc extract secret/pull-secret -n openshift-config --to=/tmp --confirm

# Step 3: Create the pull-secret in your project namespace
# This secret will contain the registry credentials needed to pull images
oc create secret generic pull-secret \
  --from-file=.dockerconfigjson=/tmp/.dockerconfigjson \
  --type=kubernetes.io/dockerconfigjson \
  -n operator-catalog-fetcher

# Step 4: Link the pull-secret to your service account
# The --for=pull flag indicates this secret is used for pulling container images
oc secrets link operator-fetcher-sa pull-secret --for=pull

# Step 5: Verify the secret is linked
oc describe serviceaccount operator-fetcher-sa
```

**What this pull-secret contains**:
- The pull-secret is a Kubernetes secret of type `kubernetes.io/dockerconfigjson`
- It contains registry credentials in the `.dockerconfigjson` field
- These credentials allow the deployment to authenticate with `registry.redhat.io` and other registries
- The secret must be linked to the service account so pods can use it when pulling images

**Option B: Create a New Pull-Secret**

If you prefer to create a dedicated secret with your Red Hat credentials:

```bash
# Create a secret with your Red Hat credentials
oc create secret docker-registry redhat-registry-secret \
  --docker-server=registry.redhat.io \
  --docker-username=<your-redhat-username> \
  --docker-password=<your-redhat-password> \
  --docker-email=<your-email>

# Link the secret to the service account
oc secrets link operator-fetcher-sa redhat-registry-secret --for=pull
```

**Important Notes about Pull-Secrets**:
- The pull-secret contains the registry credentials needed to authenticate with `registry.redhat.io`
- The secret must be linked to the service account used by the deployment
- The `--for=pull` flag specifies this secret is used for pulling images
- If using the default OpenShift pull-secret, it already contains Red Hat registry credentials
- The secret name used here must match the `imagePullSecrets` section in the deployment YAML

**Step 7: Create Deployment**

Create a deployment YAML file `deployment.yaml`. The deployment will use the pull-secret you configured in Step 6 to authenticate with `registry.redhat.io` when pulling container images:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: operator-catalog-fetcher
  labels:
    app: operator-catalog-fetcher
spec:
  replicas: 1
  selector:
    matchLabels:
      app: operator-catalog-fetcher
  template:
    metadata:
      labels:
        app: operator-catalog-fetcher
    spec:
      serviceAccountName: operator-fetcher-sa
      securityContext:
        runAsUser: 0
        fsGroup: 0
      containers:
      - name: operator-catalog-fetcher
        image: operator-catalog-fetcher:latest
        imagePullPolicy: Always
        ports:
        - containerPort: 3000
          name: http
        securityContext:
          privileged: true
          allowPrivilegeEscalation: true
        env:
        - name: PORT
          value: "3000"
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
        volumeMounts:
        - name: podman-storage
          mountPath: /var/lib/containers
        - name: podman-run
          mountPath: /run/podman
      volumes:
      - name: podman-storage
        emptyDir: {}
      - name: podman-run
        emptyDir: {}
      imagePullSecrets:
      - name: pull-secret  # Use 'pull-secret' if using OpenShift default, or 'redhat-registry-secret' if created manually
```

Apply the deployment:

```bash
oc apply -f deployment.yaml
```

**Step 8: Create Service**

```bash
oc expose deployment operator-catalog-fetcher --port=3000 --target-port=3000
```

**Step 9: Create Route**

```bash
oc expose service operator-catalog-fetcher
```

Or create a custom route with a specific hostname:

```yaml
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: operator-catalog-fetcher
spec:
  to:
    kind: Service
    name: operator-catalog-fetcher
  port:
    targetPort: http
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
```

Apply with: `oc apply -f route.yaml`

**Step 10: Get Application URL**

```bash
# Get the route URL
oc get route operator-catalog-fetcher

# Or view in OpenShift web console
```

**Step 11: Authenticate Podman Inside Container**

After the pod is running, authenticate Podman with Red Hat registry:

```bash
# Get the pod name
POD_NAME=$(oc get pods -l app=operator-catalog-fetcher -o jsonpath='{.items[0].metadata.name}')

# Login to Red Hat registry inside the pod
oc exec -it $POD_NAME -- podman login registry.redhat.io
```

**Step 12: Verify Deployment**

```bash
# Check pod status
oc get pods -l app=operator-catalog-fetcher

# View pod logs
oc logs -l app=operator-catalog-fetcher --tail=50

# Check service
oc get svc operator-catalog-fetcher

# Check route
oc get route operator-catalog-fetcher
```

**Troubleshooting OpenShift Deployment**:

1. **Pod not starting**: Check if SCC is properly assigned:
   ```bash
   oc describe pod <pod-name>
   oc get scc privileged -o yaml
   ```

2. **Image pull errors**: Verify image pull secret is properly configured:
   ```bash
   # Check if the pull-secret exists
   oc get secret pull-secret
   # Or if using custom secret:
   oc get secret redhat-registry-secret
   
   # Verify the secret is linked to the service account
   oc describe sa operator-fetcher-sa
   
   # Check if the secret contains the correct registry
   oc get secret pull-secret -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d | jq .
   ```

3. **Podman not working**: Ensure privileged SCC is granted:
   ```bash
   oc get scc privileged -o yaml | grep -A 5 users
   ```

4. **Authentication issues**: Re-authenticate inside the pod:
   ```bash
   oc exec -it <pod-name> -- podman login registry.redhat.io
   ```

5. **View detailed logs**:
   ```bash
   oc logs -f deployment/operator-catalog-fetcher
   ```

**Important Notes for OpenShift**:
- The deployment uses `privileged: true` which requires appropriate SCC permissions
- Storage is ephemeral (emptyDir) - cached catalogs will be lost on pod restart
- For persistent storage, consider using PersistentVolumeClaims
- Resource limits are set but may need adjustment based on your cluster capacity
- The application runs as root (UID 0) which is required for Podman-in-Podman

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
├── Dockerfile         # Container image definition
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

**When running directly on host:**
```bash
podman login registry.redhat.io
```

**When running in a container:**
```bash
# Login inside the container
podman exec -it operator-fetcher podman login registry.redhat.io
```

**Note**: You need Red Hat Customer Portal credentials. If you don't have an account, you can:
1. Sign up at https://access.redhat.com/
2. Or use a Red Hat service account token

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

