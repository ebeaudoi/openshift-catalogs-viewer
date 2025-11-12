const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

// Store active SSE connections
const sseClients = new Set();

// Helper function to broadcast log messages to all connected clients
function broadcastLog(message, type = 'server') {
    const data = JSON.stringify({ message, type, timestamp: new Date().toISOString() });
    sseClients.forEach(client => {
        try {
            client.write(`data: ${data}\n\n`);
        } catch (error) {
            console.error('Error sending SSE message:', error);
            sseClients.delete(client);
        }
    });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Helper function to execute shell commands
async function executeCommand(command, options = {}) {
  try {
    const { stdout, stderr } = await execAsync(command, {
      ...options,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), success: true };
  } catch (error) {
    return {
      stdout: error.stdout?.trim() || '',
      stderr: error.stderr?.trim() || error.message,
      success: false,
    };
  }
}

// Helper function to get image ID from image name
async function getImageId(imageName) {
  const { stdout, success } = await executeCommand(`podman images --format "{{.ID}}" ${imageName}`);
  if (!success || !stdout) {
    throw new Error(`Failed to get image ID for ${imageName}`);
  }
  // Get the first line (most recent image)
  return stdout.split('\n')[0].trim();
}

// Helper function to list directories in a path
async function listDirectories(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
  } catch (error) {
    throw new Error(`Failed to read directory ${dirPath}: ${error.message}`);
  }
}

// API endpoint to fetch operators
app.post('/api/fetch-operators', async (req, res) => {
  const { catalog, version } = req.body;

  // Validate input
  if (!catalog || !version) {
    return res.status(400).json({
      error: 'Missing required fields: catalog and version are required'
    });
  }

  const validCatalogs = [
    'redhat-operator-index',
    'certified-operator-index',
    'community-operator-index',
    'redhat-marketplace-index'
  ];

  if (!validCatalogs.includes(catalog)) {
    return res.status(400).json({
      error: `Invalid catalog. Must be one of: ${validCatalogs.join(', ')}`
    });
  }

  let tempDir = null;
  let containerId = null;
  let imageId = null;

  try {
    // Construct image name
    const imageName = `registry.redhat.io/redhat/${catalog}:${version}`;
    console.log(`Pulling image: ${imageName}`);
    broadcastLog(`Pulling image: ${imageName}`, 'info');

    // Step 1: Pull the image
    broadcastLog('Starting podman pull...', 'info');
    const pullResult = await executeCommand(`podman pull ${imageName}`);
    if (!pullResult.success) {
      broadcastLog(`Failed to pull image: ${pullResult.stderr}`, 'error');
      throw new Error(`Failed to pull image: ${pullResult.stderr}`);
    }
    console.log('Image pulled successfully');
    broadcastLog('Image pulled successfully', 'success');

    // Step 2: Get image ID
    broadcastLog('Getting image ID...', 'info');
    imageId = await getImageId(imageName);
    console.log(`Image ID: ${imageId}`);
    broadcastLog(`Image ID: ${imageId}`, 'info');

    // Step 3: Create temporary directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-extract-'));
    console.log(`Created temporary directory: ${tempDir}`);
    broadcastLog(`Created temporary directory: ${tempDir}`, 'info');

    // Step 4: Create a container from the image
    broadcastLog('Creating container from image...', 'info');
    const createResult = await executeCommand(`podman create --name catalog-temp-${Date.now()} ${imageId}`);
    if (!createResult.success) {
      broadcastLog(`Failed to create container: ${createResult.stderr}`, 'error');
      throw new Error(`Failed to create container: ${createResult.stderr}`);
    }
    containerId = createResult.stdout.trim();
    console.log(`Created container: ${containerId}`);
    broadcastLog(`Created container: ${containerId}`, 'info');

    // Step 5: Extract /configs directory from container
    broadcastLog('Extracting /configs directory from container...', 'info');
    const extractPath = path.join(tempDir, 'configs');
    const copyResult = await executeCommand(`podman cp ${containerId}:/configs ${tempDir}/`);
    if (!copyResult.success) {
      broadcastLog(`Failed to extract configs directory: ${copyResult.stderr}`, 'error');
      throw new Error(`Failed to extract configs directory: ${copyResult.stderr}`);
    }
    console.log('Configs directory extracted successfully');
    broadcastLog('Configs directory extracted successfully', 'success');

    // Step 6: List operator directories
    broadcastLog('Scanning for operators...', 'info');
    const operators = await listDirectories(extractPath);
    console.log(`Found ${operators.length} operators`);
    broadcastLog(`Found ${operators.length} operator(s)`, 'success');

    // Step 7: Cleanup container
    if (containerId) {
      broadcastLog('Cleaning up container...', 'info');
      await executeCommand(`podman rm ${containerId}`);
      console.log('Container removed');
      broadcastLog('Container removed', 'info');
    }

    // Step 8: Cleanup temporary directory
    if (tempDir) {
      broadcastLog('Cleaning up temporary directory...', 'info');
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log('Temporary directory cleaned up');
      broadcastLog('Temporary directory cleaned up', 'info');
    }

    // Return operators list
    res.json({ operators });

  } catch (error) {
    console.error('Error fetching operators:', error);
    broadcastLog(`Error: ${error.message}`, 'error');

    // Cleanup on error
    try {
      if (containerId) {
        broadcastLog('Cleaning up container after error...', 'warning');
        await executeCommand(`podman rm -f ${containerId}`);
      }
      if (tempDir) {
        broadcastLog('Cleaning up temporary directory after error...', 'warning');
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError);
      broadcastLog(`Cleanup error: ${cleanupError.message}`, 'error');
    }

    res.status(500).json({
      error: 'Failed to fetch operators',
      message: error.message
    });
  }
});

// Server-Sent Events endpoint for real-time logs
app.get('/api/logs', (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Add client to the set
  sseClients.add(res);

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ message: 'Connected to log stream', type: 'info' })}\n\n`);

  // Handle client disconnect
  req.on('close', () => {
    sseClients.delete(res);
    res.end();
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});

