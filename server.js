const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');
const { glob } = require('glob');

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

// Store active SSE connections
const sseClients = new Set();

// Catalog cache directory
const CATALOG_CACHE_DIR = path.join(os.tmpdir(), 'operator-catalog-cache');

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

    // Step 3: Create cache directory structure
    const cacheKey = `${catalog}-${version}`;
    const cacheDir = path.join(CATALOG_CACHE_DIR, cacheKey);
    
    // Check if already cached
    let extractPath;
    try {
      await fs.access(cacheDir);
      console.log(`Using cached catalog: ${cacheKey}`);
      broadcastLog(`Using cached catalog: ${cacheKey}`, 'info');
      extractPath = path.join(cacheDir, 'configs');
    } catch {
      // Not cached, need to extract
      await fs.mkdir(cacheDir, { recursive: true });
      console.log(`Created cache directory: ${cacheDir}`);
      broadcastLog(`Created cache directory: ${cacheDir}`, 'info');
      extractPath = path.join(cacheDir, 'configs');
      tempDir = cacheDir; // Mark for potential cleanup on error
    }

    // Step 4: Create a container from the image (only if not cached)
    if (tempDir) {
      broadcastLog('Creating container from image...', 'info');
      const createResult = await executeCommand(`podman create --name catalog-temp-${Date.now()} ${imageId}`);
      if (!createResult.success) {
        broadcastLog(`Failed to create container: ${createResult.stderr}`, 'error');
        throw new Error(`Failed to create container: ${createResult.stderr}`);
      }
      containerId = createResult.stdout.trim();
      console.log(`Created container: ${containerId}`);
      broadcastLog(`Created container: ${containerId}`, 'info');
    }

    // Step 5: Extract /configs directory from container (if not cached)
    if (tempDir) {
      broadcastLog('Extracting /configs directory from container...', 'info');
      const copyResult = await executeCommand(`podman cp ${containerId}:/configs ${tempDir}/`);
      if (!copyResult.success) {
        broadcastLog(`Failed to extract configs directory: ${copyResult.stderr}`, 'error');
        throw new Error(`Failed to extract configs directory: ${copyResult.stderr}`);
      }
      console.log('Configs directory extracted successfully');
      broadcastLog('Configs directory extracted successfully', 'success');
    }

    // Step 6: List operator directories
    broadcastLog('Scanning for operators...', 'info');
    const operators = await listDirectories(extractPath);
    console.log(`Found ${operators.length} operators`);
    broadcastLog(`Found ${operators.length} operator(s)`, 'success');

    // Step 7: Cleanup container (only if we created one)
    if (containerId && tempDir) {
      broadcastLog('Cleaning up container...', 'info');
      await executeCommand(`podman rm ${containerId}`);
      console.log('Container removed');
      broadcastLog('Container removed', 'info');
    }

    // Step 8: Don't cleanup - keep cached for operator details view
    // Catalog is now cached in CATALOG_CACHE_DIR for later use

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

// Helper function to parse FBC (File-Based Catalog) directory
async function parseFBCDirectory(operatorDir) {
  try {
    // Find all JSON and YAML files in the operator directory
    const jsonFiles = await glob('**/*.json', { cwd: operatorDir, absolute: true });
    const yamlFiles = await glob('**/*.yaml', { cwd: operatorDir, absolute: true });
    const ymlFiles = await glob('**/*.yml', { cwd: operatorDir, absolute: true });
    
    const allFiles = [...jsonFiles, ...yamlFiles, ...ymlFiles];
    
    if (allFiles.length === 0) {
      throw new Error(`No catalog files (json/yaml) found in ${operatorDir}`);
    }

    const parsedObjects = [];
    const hasYaml = yamlFiles.length > 0 || ymlFiles.length > 0;

    // Parse all files
    for (const file of allFiles) {
      try {
        const content = await fs.readFile(file, 'utf8');
        let parsed;
        
        if (file.endsWith('.json')) {
          // Try parsing as single JSON first
          try {
            parsed = JSON.parse(content);
          } catch (parseError) {
            // If that fails, try parsing as JSON stream
            // FBC format can have multiple JSON objects separated by newlines or on same line
            const streamObjects = [];
            let remainingContent = content.trim();
            let position = 0;
            
            // Try to parse JSON objects from the content
            while (position < remainingContent.length) {
              // Skip whitespace
              while (position < remainingContent.length && /\s/.test(remainingContent[position])) {
                position++;
              }
              
              if (position >= remainingContent.length) break;
              
              // Try to find the end of a JSON object
              let braceCount = 0;
              let bracketCount = 0;
              let inString = false;
              let escapeNext = false;
              let startPos = position;
              let endPos = -1;
              
              for (let i = position; i < remainingContent.length; i++) {
                const char = remainingContent[i];
                
                if (escapeNext) {
                  escapeNext = false;
                  continue;
                }
                
                if (char === '\\') {
                  escapeNext = true;
                  continue;
                }
                
                if (char === '"' && !escapeNext) {
                  inString = !inString;
                  continue;
                }
                
                if (!inString) {
                  if (char === '{') braceCount++;
                  if (char === '}') braceCount--;
                  if (char === '[') bracketCount++;
                  if (char === ']') bracketCount--;
                  
                  // If we've closed all braces and brackets, we found an object
                  if (braceCount === 0 && bracketCount === 0 && (char === '}' || char === ']')) {
                    endPos = i + 1;
                    break;
                  }
                }
              }
              
              if (endPos > startPos) {
                try {
                  const jsonStr = remainingContent.substring(startPos, endPos).trim();
                  if (jsonStr) {
                    const obj = JSON.parse(jsonStr);
                    streamObjects.push(obj);
                  }
                  position = endPos;
                } catch (objError) {
                  // If parsing this object failed, try to skip to next potential object
                  // Look for next '{' or '[' that might start a new object
                  const nextBrace = remainingContent.indexOf('{', position + 1);
                  const nextBracket = remainingContent.indexOf('[', position + 1);
                  const nextStart = Math.min(
                    nextBrace === -1 ? Infinity : nextBrace,
                    nextBracket === -1 ? Infinity : nextBracket
                  );
                  
                  if (nextStart !== Infinity && nextStart > position) {
                    position = nextStart;
                  } else {
                    // Can't find next object, break
                    break;
                  }
                }
              } else {
                // Couldn't find a complete object, break
                break;
              }
            }
            
            if (streamObjects.length > 0) {
              parsed = streamObjects;
            } else {
              // Last resort: try splitting by newlines and parsing each
              const lines = content.trim().split('\n').filter(line => line.trim());
              for (const line of lines) {
                try {
                  const lineObj = JSON.parse(line.trim());
                  streamObjects.push(lineObj);
                } catch (lineError) {
                  // Skip invalid lines
                }
              }
              
              if (streamObjects.length > 0) {
                parsed = streamObjects;
              } else {
                throw parseError; // Re-throw original error if all parsing attempts failed
              }
            }
          }
        } else {
          // YAML file
          parsed = yaml.load(content);
        }
        
        // Handle both single objects and arrays
        if (Array.isArray(parsed)) {
          parsedObjects.push(...parsed);
        } else {
          parsedObjects.push(parsed);
        }
      } catch (error) {
        console.warn(`Failed to parse ${file}: ${error.message}`);
        // Continue with other files
      }
    }

    return parsedObjects;
  } catch (error) {
    throw new Error(`Failed to parse FBC directory: ${error.message}`);
  }
}

// Helper function to extract channels and versions from parsed FBC data
// Based on FBC format: olm.package, olm.channel, and olm.bundle schemas
function extractChannelsAndVersions(parsedObjects) {
  const channels = new Map();
  let defaultChannel = null;

  // Find the package object (schema == "olm.package")
  const packageObj = parsedObjects.find(obj => obj && obj.schema === 'olm.package');
  
  if (packageObj) {
    // Get default channel from package
    if (packageObj.defaultChannel) {
      defaultChannel = packageObj.defaultChannel;
    }
  }

  // Find all channel objects (schema == "olm.channel")
  const channelObjects = parsedObjects.filter(obj => obj && obj.schema === 'olm.channel');
  
  // Create a map of bundle names to versions
  const bundleVersions = new Map();
  
  // Process all bundle objects (schema == "olm.bundle") to extract versions
  const bundleObjects = parsedObjects.filter(obj => obj && obj.schema === 'olm.bundle');
  
  for (const bundle of bundleObjects) {
    if (bundle.name && bundle.properties && Array.isArray(bundle.properties)) {
      // Find the olm.package property to get the version
      const packageProperty = bundle.properties.find(prop => prop.type === 'olm.package');
      if (packageProperty && packageProperty.value && packageProperty.value.version) {
        bundleVersions.set(bundle.name, packageProperty.value.version);
      }
    }
  }

  // Process each channel
  for (const channelObj of channelObjects) {
    const channelName = channelObj.name;
    
    if (!channelName) continue;

    // Initialize channel if not exists
    if (!channels.has(channelName)) {
      channels.set(channelName, {
        name: channelName,
        versions: []
      });
    }

    const channelData = channels.get(channelName);

    // Extract versions from channel entries
    if (channelObj.entries && Array.isArray(channelObj.entries)) {
      for (const entry of channelObj.entries) {
        // Entry name is the bundle name
        const bundleName = entry.name;
        
        if (bundleName) {
          // Get version from bundleVersions map
          const version = bundleVersions.get(bundleName);
          if (version && !channelData.versions.includes(version)) {
            channelData.versions.push(version);
          } else if (!version) {
            // If no version found in bundle properties, use bundle name as fallback
            if (!channelData.versions.includes(bundleName)) {
              channelData.versions.push(bundleName);
            }
          }
        }
      }
    }
  }

  // Sort versions for each channel
  for (const [channelName, channelData] of channels) {
    channelData.versions.sort((a, b) => {
      // Try to sort semantically if possible
      return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  return {
    defaultChannel: defaultChannel || (channels.size > 0 ? Array.from(channels.keys())[0] : null),
    channels: Array.from(channels.values())
  };
}

// API endpoint to get operator details
app.get('/api/operator-details', async (req, res) => {
  const { catalog, version, operator } = req.query;

  // Validate input
  if (!catalog || !version || !operator) {
    return res.status(400).json({
      error: 'Missing required parameters: catalog, version, and operator are required'
    });
  }

  try {
    // Construct path to operator directory
    const cacheKey = `${catalog}-${version}`;
    const cacheDir = path.join(CATALOG_CACHE_DIR, cacheKey);
    const operatorDir = path.join(cacheDir, 'configs', operator);

    // Check if operator directory exists
    try {
      await fs.access(operatorDir);
    } catch {
      // Try to extract if not cached
      broadcastLog(`Operator directory not found, attempting to fetch catalog...`, 'warning');
      
      // Trigger catalog fetch (this will cache it)
      const imageName = `registry.redhat.io/redhat/${catalog}:${version}`;
      const pullResult = await executeCommand(`podman pull ${imageName}`);
      if (!pullResult.success) {
        throw new Error(`Failed to pull image: ${pullResult.stderr}`);
      }

      const imageId = await getImageId(imageName);
      const containerId = (await executeCommand(`podman create --name catalog-temp-${Date.now()} ${imageId}`)).stdout.trim();
      
      await fs.mkdir(cacheDir, { recursive: true });
      await executeCommand(`podman cp ${containerId}:/configs ${cacheDir}/`);
      await executeCommand(`podman rm ${containerId}`);
      
      // Check again
      try {
        await fs.access(operatorDir);
      } catch {
        throw new Error(`Operator '${operator}' not found in catalog ${catalog}:${version}`);
      }
    }

    // Parse FBC directory
    broadcastLog(`Parsing FBC directory for operator: ${operator}`, 'info');
    const parsedObjects = await parseFBCDirectory(operatorDir);
    
    console.log(`Parsed ${parsedObjects.length} objects from FBC directory`);
    
    // Extract channels and versions
    const { defaultChannel, channels } = extractChannelsAndVersions(parsedObjects);

    console.log(`Extracted ${channels.length} channel(s), default: ${defaultChannel || 'none'}`);
    broadcastLog(`Found ${channels.length} channel(s) for operator ${operator}`, 'success');
    
    // If no channels found, log the structure for debugging
    if (channels.length === 0) {
      console.log('No channels found. Sample object keys:', parsedObjects.slice(0, 3).map(obj => Object.keys(obj || {})));
      broadcastLog(`Warning: No channels extracted. Check server logs for details.`, 'warning');
    }

    res.json({
      operator,
      catalog,
      version,
      defaultChannel,
      channels,
      rawData: parsedObjects // Include raw parsed data for debugging/advanced use
    });

  } catch (error) {
    console.error('Error getting operator details:', error);
    broadcastLog(`Error getting operator details: ${error.message}`, 'error');
    res.status(500).json({
      error: 'Failed to get operator details',
      message: error.message
    });
  }
});

// Helper function to generate ImageSetConfiguration YAML
function generateImageSetConfig(catalog, version, selections) {
  const imageName = `registry.redhat.io/redhat/${catalog}:${version}`;
  
  const config = {
    apiVersion: 'mirror.openshift.io/v2alpha1',
    kind: 'ImageSetConfiguration',
    mirror: {
      operators: [
        {
          catalog: imageName,
          packages: selections.map(sel => {
            const packageConfig = {
              name: sel.operator,
              channels: [
                {
                  name: sel.channel,
                  minVersion: sel.version
                }
              ]
            };
            
            // Use defaultChannel parameter only when default channel is NOT selected
            if (sel.defaultChannel && sel.defaultChannel !== sel.channel) {
              // User selected a non-default channel
              // Correction 1: Add defaultChannel parameter (top-level field)
              packageConfig.defaultChannel = sel.defaultChannel;
              // Correction 2: Do NOT add default channel as a standard channel entry
              // (default channel is not in channels array, only referenced via defaultChannel parameter)
            } else if (sel.defaultChannel && sel.defaultChannel === sel.channel) {
              // User selected the default channel - it's already explicitly configured in channels array
              // Do NOT add defaultChannel parameter to avoid redundancy
            }
            
            return packageConfig;
          })
        }
      ]
    }
  };
  
  return yaml.dump(config);
}

// Helper function to parse ImageSetConfiguration
function parseImageSetConfig(configContent) {
  try {
    const config = yaml.load(configContent);
    
    if (!config || config.kind !== 'ImageSetConfiguration') {
      throw new Error('Invalid ImageSetConfiguration file');
    }
    
    // Extract catalog and operators
    const mirror = config.mirror || {};
    const operators = mirror.operators || [];
    
    if (operators.length === 0) {
      throw new Error('No operators found in configuration');
    }
    
    // Get the first operator catalog (assuming single catalog per config)
    const firstOperator = operators[0];
    const catalogImage = firstOperator.catalog || '';
    
    // Extract catalog name and version from image
    const catalogMatch = catalogImage.match(/redhat\/([^:]+):(.+)/);
    const catalogName = catalogMatch ? catalogMatch[1] : '';
    const catalogVersion = catalogMatch ? catalogMatch[2] : '';
    
    // Extract packages
    const packages = [];
    for (const op of operators) {
      if (op.packages && Array.isArray(op.packages)) {
        for (const pkg of op.packages) {
          if (pkg.channels && Array.isArray(pkg.channels) && pkg.channels.length > 0) {
            const channel = pkg.channels[0];
            const packageInfo = {
              name: pkg.name,
              channel: channel.name || '',
              version: channel.minVersion || channel.maxVersion || ''
            };
            
            // Extract defaultChannel if present (at package level in ImageSetConfiguration)
            if (pkg.defaultChannel) {
              packageInfo.defaultChannel = pkg.defaultChannel;
            }
            
            packages.push(packageInfo);
          }
        }
      }
    }
    
    return {
      catalog: catalogName,
      version: catalogVersion,
      catalogImage: catalogImage,
      packages: packages
    };
  } catch (error) {
    throw new Error(`Failed to parse ImageSetConfiguration: ${error.message}`);
  }
}

// API endpoint to generate ImageSetConfiguration
app.post('/api/generate-imageset-config', async (req, res) => {
  const { catalog, version, selections } = req.body;
  
  if (!catalog || !version || !selections || !Array.isArray(selections)) {
    return res.status(400).json({
      error: 'Missing required fields: catalog, version, and selections array are required'
    });
  }
  
  try {
    const yamlContent = generateImageSetConfig(catalog, version, selections);
    
    res.json({
      success: true,
      yaml: yamlContent,
      filename: `imageset-config-${Date.now()}.yaml`
    });
  } catch (error) {
    console.error('Error generating ImageSetConfiguration:', error);
    res.status(500).json({
      error: 'Failed to generate ImageSetConfiguration',
      message: error.message
    });
  }
});

// API endpoint to parse and analyze existing ImageSetConfiguration
app.post('/api/parse-imageset-config', async (req, res) => {
  const { configContent } = req.body;
  
  if (!configContent) {
    return res.status(400).json({
      error: 'Missing required field: configContent'
    });
  }
  
  try {
    const parsed = parseImageSetConfig(configContent);
    res.json({
      success: true,
      ...parsed
    });
  } catch (error) {
    console.error('Error parsing ImageSetConfiguration:', error);
    res.status(500).json({
      error: 'Failed to parse ImageSetConfiguration',
      message: error.message
    });
  }
});

// API endpoint to get latest versions for operators in a config
app.post('/api/get-latest-versions', async (req, res) => {
  const { catalog, version, packages } = req.body;
  
  if (!catalog || !version || !packages || !Array.isArray(packages)) {
    return res.status(400).json({
      error: 'Missing required fields: catalog, version, and packages array are required'
    });
  }
  
  try {
    // Ensure catalog is cached
    const cacheKey = `${catalog}-${version}`;
    const cacheDir = path.join(CATALOG_CACHE_DIR, cacheKey);
    const extractPath = path.join(cacheDir, 'configs');
    
    // Check if cached, if not, fetch it
    try {
      await fs.access(extractPath);
    } catch {
      // Need to fetch catalog
      const imageName = `registry.redhat.io/redhat/${catalog}:${version}`;
      broadcastLog(`Pulling catalog ${imageName} for version comparison...`, 'info');
      
      const pullResult = await executeCommand(`podman pull ${imageName}`);
      if (!pullResult.success) {
        throw new Error(`Failed to pull image: ${pullResult.stderr}`);
      }
      
      const imageId = await getImageId(imageName);
      const containerId = (await executeCommand(`podman create --name catalog-temp-${Date.now()} ${imageId}`)).stdout.trim();
      
      await fs.mkdir(cacheDir, { recursive: true });
      await executeCommand(`podman cp ${containerId}:/configs ${cacheDir}/`);
      await executeCommand(`podman rm ${containerId}`);
    }
    
    // Get latest versions for each package
    const versionInfo = [];
    
    for (const pkg of packages) {
      try {
        const operatorDir = path.join(extractPath, pkg.name);
        
        // Check if operator directory exists
        try {
          await fs.access(operatorDir);
        } catch {
          // Operator not found
          versionInfo.push({
            name: pkg.name,
            channel: pkg.channel,
            currentVersion: pkg.version,
            latestVersion: pkg.version,
            hasUpdate: false,
            error: 'Operator not found',
            operatorNotFound: true
          });
          continue;
        }
        
        const parsedObjects = await parseFBCDirectory(operatorDir);
        const { defaultChannel, channels } = extractChannelsAndVersions(parsedObjects);
        
        // Get latest version for default channel if it exists
        let defaultChannelLatestVersion = null;
        if (defaultChannel) {
          const defaultChannelObj = channels.find(c => c.name === defaultChannel);
          if (defaultChannelObj && defaultChannelObj.versions && defaultChannelObj.versions.length > 0) {
            defaultChannelLatestVersion = defaultChannelObj.versions[0];
          }
        }
        
        // Find the channel
        const channel = channels.find(c => c.name === pkg.channel);
        if (channel && channel.versions && channel.versions.length > 0) {
          const latestVersion = channel.versions[0]; // Already sorted, first is latest
          versionInfo.push({
            name: pkg.name,
            channel: pkg.channel,
            currentVersion: pkg.version,
            latestVersion: latestVersion,
            hasUpdate: latestVersion !== pkg.version,
            defaultChannel: defaultChannel || null,
            defaultChannelLatestVersion: defaultChannelLatestVersion,
            availableChannels: channels.map(c => c.name)
          });
        } else {
          // Channel not found, but operator exists
          versionInfo.push({
            name: pkg.name,
            channel: pkg.channel,
            currentVersion: pkg.version,
            latestVersion: pkg.version,
            hasUpdate: false,
            error: 'Channel not found',
            channelNotFound: true,
            defaultChannel: defaultChannel || null,
            defaultChannelLatestVersion: defaultChannelLatestVersion,
            availableChannels: channels.map(c => c.name)
          });
        }
      } catch (error) {
        // General error - try to determine if it's operator not found
        const operatorDir = path.join(extractPath, pkg.name);
        try {
          await fs.access(operatorDir);
          // Directory exists but parsing failed
          versionInfo.push({
            name: pkg.name,
            channel: pkg.channel,
            currentVersion: pkg.version,
            latestVersion: pkg.version,
            hasUpdate: false,
            error: error.message
          });
        } catch {
          // Operator not found
          versionInfo.push({
            name: pkg.name,
            channel: pkg.channel,
            currentVersion: pkg.version,
            latestVersion: pkg.version,
            hasUpdate: false,
            error: 'Operator not found',
            operatorNotFound: true
          });
        }
      }
    }
    
    res.json({
      success: true,
      versionInfo: versionInfo
    });
  } catch (error) {
    console.error('Error getting latest versions:', error);
    broadcastLog(`Error getting latest versions: ${error.message}`, 'error');
    res.status(500).json({
      error: 'Failed to get latest versions',
      message: error.message
    });
  }
});

// API endpoint to update ImageSetConfiguration with new versions
app.post('/api/update-imageset-config', async (req, res) => {
  const { originalConfig, updates, removeOperators, addDefaultChannels, setDefaultChannelParam } = req.body;
  
  if (!originalConfig || !updates || !Array.isArray(updates)) {
    return res.status(400).json({
      error: 'Missing required fields: originalConfig and updates array are required'
    });
  }
  
  try {
    const config = yaml.load(originalConfig);
    
    if (!config || config.kind !== 'ImageSetConfiguration') {
      throw new Error('Invalid ImageSetConfiguration file');
    }
    
    // Update versions in the config
    const mirror = config.mirror || {};
    const operators = mirror.operators || [];
    
    for (const op of operators) {
      if (op.packages && Array.isArray(op.packages)) {
        // Remove missing operators if specified
        if (removeOperators && Array.isArray(removeOperators) && removeOperators.length > 0) {
          op.packages = op.packages.filter(pkg => !removeOperators.includes(pkg.name));
        }
        
        for (const pkg of op.packages) {
          // Check for channel replacement (originalChannel specified) or regular update
          const update = updates.find(u => 
            u.name === pkg.name && 
            (u.originalChannel ? u.originalChannel === pkg.channels[0]?.name : u.channel === pkg.channels[0]?.name)
          );
          
          if (update && pkg.channels && pkg.channels.length > 0) {
            // If originalChannel is specified, this is a channel replacement
            if (update.originalChannel) {
              // Update channel name
              pkg.channels[0].name = update.channel;
            }
            // Update version
            pkg.channels[0].minVersion = update.newVersion;
            // Remove maxVersion if it exists
            if (pkg.channels[0].maxVersion !== undefined) {
              delete pkg.channels[0].maxVersion;
            }
          }
        }
      }
    }
    
    // Add default channels (Fix 1: automatic for non-default, Fix 2: user-selected)
    if (addDefaultChannels && Array.isArray(addDefaultChannels)) {
      for (const op of operators) {
        if (op.packages && Array.isArray(op.packages)) {
          for (const pkg of op.packages) {
            // Process all default channel additions for this operator
            for (const defaultAdd of addDefaultChannels) {
              if (defaultAdd.operator === pkg.name) {
                // Check if this default channel is already in channels array (before any modifications)
                const hasChannel = pkg.channels.some(ch => ch.name === defaultAdd.channel);
                
                if (!hasChannel) {
                  // Default channel is not in channels array - add it
                  pkg.channels.push({
                    name: defaultAdd.channel,
                    minVersion: defaultAdd.version
                  });
                  // Only set defaultChannel parameter if default channel is NOT in channels array
                  // Since we just added it, we should NOT set defaultChannel parameter
                  // The defaultChannel parameter is only for reference when default is not explicitly configured
                } else {
                  // Default channel is already explicitly configured in channels array
                  // Update existing default channel version if needed
                  const existingChannel = pkg.channels.find(ch => ch.name === defaultAdd.channel);
                  if (existingChannel) {
                    existingChannel.minVersion = defaultAdd.version;
                    // Remove maxVersion if it exists
                    if (existingChannel.maxVersion !== undefined) {
                      delete existingChannel.maxVersion;
                    }
                  }
                }
                
                // Always remove defaultChannel parameter if default channel is in channels array
                // This prevents redundancy when default channel is explicitly configured
                if (pkg.channels.some(ch => ch.name === defaultAdd.channel)) {
                  if (pkg.defaultChannel === defaultAdd.channel) {
                    delete pkg.defaultChannel;
                  }
                }
              }
            }
          }
        }
      }
    }
    
    // Set defaultChannel parameter for operators where checkbox was unchecked
    // (default channel is NOT in channels array, so we use defaultChannel parameter)
    if (setDefaultChannelParam && Array.isArray(setDefaultChannelParam)) {
      for (const op of operators) {
        if (op.packages && Array.isArray(op.packages)) {
          for (const pkg of op.packages) {
            for (const defaultParam of setDefaultChannelParam) {
              if (defaultParam.operator === pkg.name) {
                // Check if default channel is NOT in channels array
                const hasDefaultInChannels = pkg.channels.some(ch => ch.name === defaultParam.defaultChannel);
                if (!hasDefaultInChannels) {
                  // Default channel is not in channels array, so set defaultChannel parameter
                  pkg.defaultChannel = defaultParam.defaultChannel;
                }
              }
            }
          }
        }
      }
    }
    
    // Final cleanup: Remove defaultChannel parameter for any package where default channel is in channels array
    for (const op of operators) {
      if (op.packages && Array.isArray(op.packages)) {
        for (const pkg of op.packages) {
          if (pkg.defaultChannel && pkg.channels && Array.isArray(pkg.channels)) {
            // Check if defaultChannel is already in channels array
            const hasDefaultInChannels = pkg.channels.some(ch => ch.name === pkg.defaultChannel);
            if (hasDefaultInChannels) {
              // Remove defaultChannel parameter to avoid redundancy
              delete pkg.defaultChannel;
            }
          }
        }
      }
    }
    
    // Remove empty operator entries (if all packages were removed)
    config.mirror.operators = operators.filter(op => 
      op.packages && Array.isArray(op.packages) && op.packages.length > 0
    );
    
    const updatedYaml = yaml.dump(config);
    
    res.json({
      success: true,
      yaml: updatedYaml,
      filename: `imageset-config-updated-${Date.now()}.yaml`
    });
  } catch (error) {
    console.error('Error updating ImageSetConfiguration:', error);
    res.status(500).json({
      error: 'Failed to update ImageSetConfiguration',
      message: error.message
    });
  }
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

