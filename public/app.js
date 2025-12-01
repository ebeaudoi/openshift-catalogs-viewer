// DOM elements
const catalogSelect = document.getElementById('catalog-select');
const versionSelect = document.getElementById('version-select');
const fetchButton = document.getElementById('fetch-button');
const operatorSelect = document.getElementById('operator-select');
const errorMessage = document.getElementById('error-message');
const successMessage = document.getElementById('success-message');
const logsContent = document.getElementById('logs-content');
const clearLogsButton = document.getElementById('clear-logs-button');
const toggleLogsButton = document.getElementById('toggle-logs-button');
const viewDetailsButton = document.getElementById('view-details-button');

// Event source for server-sent events
let eventSource = null;

// Cache for operators by catalog+version
const operatorsCache = new Map();

// Current cached catalog and version
let cachedCatalog = null;
let cachedVersion = null;

// Load cache from sessionStorage on page load
function loadCacheFromStorage() {
    try {
        const storedCache = sessionStorage.getItem('operatorsCache');
        if (storedCache) {
            const parsed = JSON.parse(storedCache);
            for (const [key, value] of Object.entries(parsed)) {
                operatorsCache.set(key, value);
            }
            console.log('Cache restored from sessionStorage:', operatorsCache.size, 'entries');
        }
        
        const storedCatalog = sessionStorage.getItem('cachedCatalog');
        const storedVersion = sessionStorage.getItem('cachedVersion');
        if (storedCatalog && storedVersion) {
            cachedCatalog = storedCatalog;
            cachedVersion = storedVersion;
        }
    } catch (error) {
        console.error('Error loading cache from storage:', error);
    }
}

// Save cache to sessionStorage
function saveCacheToStorage() {
    try {
        const cacheObj = {};
        for (const [key, value] of operatorsCache.entries()) {
            cacheObj[key] = value;
        }
        sessionStorage.setItem('operatorsCache', JSON.stringify(cacheObj));
        if (cachedCatalog) sessionStorage.setItem('cachedCatalog', cachedCatalog);
        if (cachedVersion) sessionStorage.setItem('cachedVersion', cachedVersion);
    } catch (error) {
        console.error('Error saving cache to storage:', error);
    }
}

// Enable/disable fetch button based on selections
function updateFetchButtonState() {
    const catalogSelected = catalogSelect.value !== '';
    const versionSelected = versionSelect.value !== '';
    fetchButton.disabled = !(catalogSelected && versionSelected);
}

// Clear cache when catalog or version changes
function clearCacheIfNeeded() {
    const currentCatalog = catalogSelect.value;
    const currentVersion = versionSelect.value;
    
    // Clear cache if catalog or version changed from what we have cached
    if (cachedCatalog && cachedVersion) {
        if (cachedCatalog !== currentCatalog || cachedVersion !== currentVersion) {
            const oldCatalog = cachedCatalog;
            const oldVersion = cachedVersion;
            operatorsCache.clear();
            cachedCatalog = null;
            cachedVersion = null;
            sessionStorage.removeItem('operatorsCache');
            sessionStorage.removeItem('cachedCatalog');
            sessionStorage.removeItem('cachedVersion');
            addLogEntry(`Cache cleared: ${oldCatalog}:${oldVersion} → ${currentCatalog || 'none'}:${currentVersion || 'none'}`, 'info');
            console.log('Cache cleared. Old:', oldCatalog, oldVersion, 'New:', currentCatalog, currentVersion);
        }
    }
}

// Get cache key for catalog+version
function getCacheKey(catalog, version) {
    return `${catalog}:${version}`;
}

// Check if operators are cached
function getCachedOperators(catalog, version) {
    const key = getCacheKey(catalog, version);
    return operatorsCache.get(key);
}

// Store operators in cache
function cacheOperators(catalog, version, operators) {
    const key = getCacheKey(catalog, version);
    // Make a copy of the array to avoid reference issues
    operatorsCache.set(key, [...operators]);
    cachedCatalog = catalog;
    cachedVersion = version;
    console.log('Cache stored:', { key, count: operators.length, cacheSize: operatorsCache.size });
    saveCacheToStorage();
}

// Event listeners for dropdown changes
catalogSelect.addEventListener('change', () => {
    clearCacheIfNeeded();
    updateFetchButtonState();
    saveStateToStorage();
    if (catalogSelect.value) {
        const catalogName = catalogSelect.options[catalogSelect.selectedIndex].text;
        addLogEntry(`Catalog selected: ${catalogName}`, 'info');
    }
});

versionSelect.addEventListener('change', () => {
    clearCacheIfNeeded();
    updateFetchButtonState();
    saveStateToStorage();
    if (versionSelect.value) {
        addLogEntry(`Version selected: ${versionSelect.value}`, 'info');
    }
});

// Hide messages
function hideMessages() {
    errorMessage.style.display = 'none';
    successMessage.style.display = 'none';
}

// Show error message
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    successMessage.style.display = 'none';
}

// Show success message
function showSuccess(message) {
    successMessage.textContent = message;
    successMessage.style.display = 'block';
    errorMessage.style.display = 'none';
}

// Set loading state
function setLoading(loading) {
    fetchButton.disabled = loading;
    if (loading) {
        fetchButton.classList.add('loading');
    } else {
        fetchButton.classList.remove('loading');
    }
}

// Populate operator dropdown
function populateOperatorDropdown(operators) {
    // Clear existing options except the first one
    operatorSelect.innerHTML = '<option value="">-- Select Operator --</option>';
    
    // Add operator options
    operators.forEach(operator => {
        const option = document.createElement('option');
        option.value = operator;
        option.textContent = operator;
        operatorSelect.appendChild(option);
    });
    
    // Enable the dropdown
    operatorSelect.disabled = false;
}

// Fetch operators from API or cache
async function fetchOperators() {
    const catalog = catalogSelect.value;
    const version = versionSelect.value;

    if (!catalog || !version) {
        showError('Please select both catalog and version');
        addLogEntry('Error: Please select both catalog and version', 'error');
        return;
    }

    const catalogName = catalogSelect.options[catalogSelect.selectedIndex].text;

    // Check cache first
    const cached = getCachedOperators(catalog, version);
    console.log('Cache check:', { catalog, version, cached: cached ? cached.length + ' operators' : 'not found', cacheSize: operatorsCache.size });
    
    if (cached && Array.isArray(cached) && cached.length > 0) {
        addLogEntry(`Using cached operators for ${catalogName} ${version}`, 'info');
        populateOperatorDropdown(cached);
        showSuccess(`Loaded ${cached.length} operator(s) from cache`);
        addLogEntry(`Loaded ${cached.length} operator(s) from cache`, 'success');
        return;
    }

    // Not in cache, fetch from server
    addLogEntry(`Starting fetch operation: ${catalogName} ${version}`, 'info');

    hideMessages();
    setLoading(true);
    operatorSelect.disabled = true;
    operatorSelect.innerHTML = '<option value="">-- Select Operator --</option>';
    viewDetailsButton.disabled = true;

    try {
        addLogEntry('Sending request to server...', 'info');
        const response = await fetch('/api/fetch-operators', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ catalog, version }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || data.message || 'Failed to fetch operators');
        }

        if (data.operators && data.operators.length > 0) {
            // Cache the operators
            cacheOperators(catalog, version, data.operators);
            console.log('Operators cached:', { catalog, version, count: data.operators.length, cacheSize: operatorsCache.size });
            
            populateOperatorDropdown(data.operators);
            showSuccess(`Successfully fetched ${data.operators.length} operator(s)`);
            addLogEntry(`Successfully fetched ${data.operators.length} operator(s)`, 'success');
        } else {
            showError('No operators found in the selected catalog');
            addLogEntry('No operators found in the selected catalog', 'warning');
            operatorSelect.disabled = true;
        }
    } catch (error) {
        console.error('Error fetching operators:', error);
        showError(error.message || 'An error occurred while fetching operators');
        addLogEntry(`Error: ${error.message || 'An error occurred while fetching operators'}`, 'error');
        operatorSelect.disabled = true;
    } finally {
        setLoading(false);
    }
}

// Logging functions
function getCurrentTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function addLogEntry(message, type = 'info') {
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-${type}`;
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = getCurrentTime();
    
    const messageSpan = document.createElement('span');
    messageSpan.className = 'log-message';
    messageSpan.textContent = message;
    
    logEntry.appendChild(timeSpan);
    logEntry.appendChild(messageSpan);
    
    logsContent.appendChild(logEntry);
    
    // Auto-scroll to bottom
    logsContent.scrollTop = logsContent.scrollHeight;
    
    // Limit to 500 log entries to prevent memory issues
    const logEntries = logsContent.querySelectorAll('.log-entry');
    if (logEntries.length > 500) {
        logEntries[0].remove();
    }
}

function clearLogs() {
    logsContent.innerHTML = '';
    addLogEntry('Logs cleared', 'info');
}

function toggleLogs() {
    logsContent.classList.toggle('collapsed');
    toggleLogsButton.textContent = logsContent.classList.contains('collapsed') ? '+' : '−';
}

// Connect to server-sent events for real-time logs
function connectToLogs() {
    if (eventSource) {
        eventSource.close();
    }
    
    eventSource = new EventSource('/api/logs');
    
    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            addLogEntry(data.message, data.type || 'server');
        } catch (error) {
            addLogEntry(event.data, 'server');
        }
    };
    
    eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);
        // Try to reconnect after 3 seconds
        setTimeout(() => {
            if (eventSource && eventSource.readyState === EventSource.CLOSED) {
                connectToLogs();
            }
        }, 3000);
    };
}

// Event listeners
fetchButton.addEventListener('click', fetchOperators);
clearLogsButton.addEventListener('click', clearLogs);
toggleLogsButton.addEventListener('click', toggleLogs);

// Note: Catalog and version change handlers are already defined above with cache clearing

operatorSelect.addEventListener('change', () => {
    saveStateToStorage();
    if (operatorSelect.value) {
        addLogEntry(`Operator selected: ${operatorSelect.value}`, 'info');
        viewDetailsButton.disabled = false;
    } else {
        viewDetailsButton.disabled = true;
    }
});

// View details button handler
viewDetailsButton.addEventListener('click', () => {
    const operator = operatorSelect.value;
    const catalog = catalogSelect.value;
    const version = versionSelect.value;

    if (operator && catalog && version) {
        // Save current state before navigating
        saveStateToStorage();
        const url = `/operator-details.html?catalog=${encodeURIComponent(catalog)}&version=${encodeURIComponent(version)}&operator=${encodeURIComponent(operator)}`;
        window.location.href = url;
        addLogEntry(`Navigating to operator details: ${operator}`, 'info');
    }
});

// Save current form state to sessionStorage
function saveStateToStorage() {
    try {
        sessionStorage.setItem('selectedCatalog', catalogSelect.value);
        sessionStorage.setItem('selectedVersion', versionSelect.value);
        sessionStorage.setItem('selectedOperator', operatorSelect.value);
        saveCacheToStorage();
    } catch (error) {
        console.error('Error saving state to storage:', error);
    }
}

// Restore form state from sessionStorage
function restoreStateFromStorage() {
    try {
        const savedCatalog = sessionStorage.getItem('selectedCatalog');
        const savedVersion = sessionStorage.getItem('selectedVersion');
        const savedOperator = sessionStorage.getItem('selectedOperator');
        
        if (savedCatalog) {
            catalogSelect.value = savedCatalog;
            addLogEntry('Catalog selection restored from previous session', 'info');
        }
        
        if (savedVersion) {
            versionSelect.value = savedVersion;
            addLogEntry('Version selection restored from previous session', 'info');
        }
        
        // If we have both catalog and version, try to restore operators
        if (savedCatalog && savedVersion) {
            const cached = getCachedOperators(savedCatalog, savedVersion);
            if (cached && Array.isArray(cached) && cached.length > 0) {
                populateOperatorDropdown(cached);
                addLogEntry(`Restored ${cached.length} operator(s) from cache`, 'success');
                
                // Restore operator selection if it was saved
                if (savedOperator) {
                    operatorSelect.value = savedOperator;
                    viewDetailsButton.disabled = false;
                    addLogEntry(`Operator selection restored: ${savedOperator}`, 'info');
                }
            }
        }
        
        updateFetchButtonState();
    } catch (error) {
        console.error('Error restoring state from storage:', error);
    }
}

// Initialize
loadCacheFromStorage();
restoreStateFromStorage();
updateFetchButtonState();
connectToLogs();

// Update initial log entry time
document.querySelector('.log-entry .log-time').textContent = getCurrentTime();

// ===== Feature 2 & 3: ImageSetConfiguration Creation and Update =====

// Tab switching
const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');

tabButtons.forEach(button => {
    button.addEventListener('click', () => {
        const targetTab = button.dataset.tab;
        
        // Update active states
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        
        button.classList.add('active');
        document.getElementById(`${targetTab}-tab`).classList.add('active');
    });
});

// Feature 2: Create ImageSetConfiguration
const configCatalogSelect = document.getElementById('config-catalog-select');
const configVersionSelect = document.getElementById('config-version-select');
const configFetchOperatorsButton = document.getElementById('config-fetch-operators-button');
const configOperatorSelect = document.getElementById('config-operator-select');
const configChannelSelect = document.getElementById('config-channel-select');
const defaultChannelIndicator = document.getElementById('default-channel-indicator');
const configVersionSelectOperator = document.getElementById('config-version-select-operator');
const configAddOperatorButton = document.getElementById('config-add-operator-button');
const configGenerateButton = document.getElementById('config-generate-button');
const selectedOperatorsList = document.getElementById('selected-operators-list');
const selectedOperatorsSection = document.getElementById('selected-operators-section');
const configResult = document.getElementById('config-result');
const configYamlOutput = document.getElementById('config-yaml-output');
const configDownloadButton = document.getElementById('config-download-button');

let selectedOperators = [];
let currentConfigCatalog = null;
let currentConfigVersion = null;
let currentOperatorChannels = null;
let currentOperatorDefaultChannel = null;

// Update fetch button state
function updateConfigFetchButtonState() {
    const catalogSelected = configCatalogSelect.value !== '';
    const versionSelected = configVersionSelect.value !== '';
    configFetchOperatorsButton.disabled = !(catalogSelected && versionSelected);
}

if (configCatalogSelect && configVersionSelect) {
    configCatalogSelect.addEventListener('change', updateConfigFetchButtonState);
    configVersionSelect.addEventListener('change', updateConfigFetchButtonState);
}

// Fetch operators for config creation
if (configFetchOperatorsButton) {
    configFetchOperatorsButton.addEventListener('click', async () => {
        const catalog = configCatalogSelect.value;
        const version = configVersionSelect.value;
        
        if (!catalog || !version) {
            showError('Please select both catalog and version');
            return;
        }
        
        // Disable button immediately
        configFetchOperatorsButton.disabled = true;
        
        currentConfigCatalog = catalog;
        currentConfigVersion = version;
        
        try {
            const response = await fetch('/api/fetch-operators', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ catalog, version })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to fetch operators');
            }
            
            // Populate operator dropdown
            configOperatorSelect.innerHTML = '<option value="">-- Select Operator --</option>';
            data.operators.forEach(op => {
                const option = document.createElement('option');
                option.value = op;
                option.textContent = op;
                configOperatorSelect.appendChild(option);
            });
            
            configOperatorSelect.disabled = false;
            showSuccess(`Fetched ${data.operators.length} operator(s)`);
        } catch (error) {
            showError(error.message);
        } finally {
            // Re-enable button after operation completes (success or error)
            configFetchOperatorsButton.disabled = false;
        }
    });
}

// Load operator details when operator is selected
if (configOperatorSelect) {
    configOperatorSelect.addEventListener('change', async () => {
        const operator = configOperatorSelect.value;
        
        // Clear default channel indicator if operator is cleared
        if (!operator) {
            if (defaultChannelIndicator) {
                defaultChannelIndicator.style.display = 'none';
            }
            if (configChannelSelect) {
                configChannelSelect.innerHTML = '<option value="">-- Select Channel --</option>';
                configChannelSelect.disabled = true;
            }
            return;
        }
        
        if (!currentConfigCatalog || !currentConfigVersion) return;
        
        try {
            const response = await fetch(`/api/operator-details?catalog=${encodeURIComponent(currentConfigCatalog)}&version=${encodeURIComponent(currentConfigVersion)}&operator=${encodeURIComponent(operator)}`);
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to get operator details');
            }
            
            // Populate channel dropdown
            configChannelSelect.innerHTML = '<option value="">-- Select Channel --</option>';
            data.channels.forEach(ch => {
                const option = document.createElement('option');
                option.value = ch.name;
                // Mark default channel with "(Default)" label
                if (data.defaultChannel && ch.name === data.defaultChannel) {
                    option.textContent = `${ch.name} (Default)`;
                } else {
                    option.textContent = ch.name;
                }
                configChannelSelect.appendChild(option);
            });
            
            configChannelSelect.disabled = false;
            currentOperatorChannels = data.channels;
            currentOperatorDefaultChannel = data.defaultChannel || null;
            
            // Pre-select default channel if available
            if (data.defaultChannel) {
                // Ensure the value is set
                configChannelSelect.value = data.defaultChannel;
                
                // Display default channel indicator
                if (defaultChannelIndicator) {
                    defaultChannelIndicator.textContent = `Default channel: ${data.defaultChannel}`;
                    defaultChannelIndicator.style.display = 'block';
                }
                
                // Force a visual update by triggering a focus/blur
                configChannelSelect.focus();
                setTimeout(() => {
                    configChannelSelect.blur();
                }, 100);
                
                // Trigger change event to automatically populate versions
                const changeEvent = new Event('change', { bubbles: true });
                configChannelSelect.dispatchEvent(changeEvent);
            } else {
                // Hide indicator if no default channel
                if (defaultChannelIndicator) {
                    defaultChannelIndicator.style.display = 'none';
                }
            }
        } catch (error) {
            showError(error.message);
        }
    });
}

// Load versions when channel is selected
if (configChannelSelect) {
    configChannelSelect.addEventListener('change', () => {
        const channelName = configChannelSelect.value;
        if (!channelName || !currentOperatorChannels) return;
        
        const channel = currentOperatorChannels.find(c => c.name === channelName);
        if (!channel) return;
        
        // Populate version dropdown
        configVersionSelectOperator.innerHTML = '<option value="">-- Select Version --</option>';
        channel.versions.forEach(ver => {
            const option = document.createElement('option');
            option.value = ver;
            option.textContent = ver;
            configVersionSelectOperator.appendChild(option);
        });
        
        configVersionSelectOperator.disabled = false;
        updateConfigAddButtonState();
    });
}

if (configVersionSelectOperator) {
    configVersionSelectOperator.addEventListener('change', updateConfigAddButtonState);
}

function updateConfigAddButtonState() {
    const operator = configOperatorSelect.value;
    const channel = configChannelSelect.value;
    const version = configVersionSelectOperator.value;
    if (configAddOperatorButton) {
        configAddOperatorButton.disabled = !(operator && channel && version);
    }
}

// Add operator to selection
if (configAddOperatorButton) {
    configAddOperatorButton.addEventListener('click', () => {
        const operator = configOperatorSelect.value;
        const channel = configChannelSelect.value;
        const version = configVersionSelectOperator.value;
        
        if (!operator || !channel || !version) return;
        
        // Check if already added
        if (selectedOperators.some(sel => sel.operator === operator && sel.channel === channel)) {
            showError('This operator and channel combination is already added');
            return;
        }
        
        // Include default channel information if available and different from selected channel
        const selection = {
            operator,
            channel,
            version
        };
        
        // Add defaultChannel if it exists and is different from selected channel
        if (currentOperatorDefaultChannel && currentOperatorDefaultChannel !== channel) {
            selection.defaultChannel = currentOperatorDefaultChannel;
        }
        
        selectedOperators.push(selection);
        updateSelectedOperatorsDisplay();
        if (configGenerateButton) {
            configGenerateButton.disabled = selectedOperators.length === 0;
        }
        
        // Reset form for next selection
        configOperatorSelect.value = '';
        configChannelSelect.value = '';
        configVersionSelectOperator.value = '';
        configChannelSelect.disabled = true;
        configVersionSelectOperator.disabled = true;
        currentOperatorDefaultChannel = null;
        if (defaultChannelIndicator) {
            defaultChannelIndicator.style.display = 'none';
        }
        updateConfigAddButtonState();
    });
}

function updateSelectedOperatorsDisplay() {
    if (selectedOperators.length === 0) {
        if (selectedOperatorsSection) {
            selectedOperatorsSection.style.display = 'none';
        }
        return;
    }
    
    if (selectedOperatorsSection) {
        selectedOperatorsSection.style.display = 'block';
    }
    if (selectedOperatorsList) {
        selectedOperatorsList.innerHTML = '';
        
        selectedOperators.forEach((sel, index) => {
            const div = document.createElement('div');
            div.className = 'selected-operator-item';
            div.innerHTML = `
                <div class="operator-info">
                    <strong>${sel.operator}</strong> - Channel: ${sel.channel} - Version: ${sel.version}
                </div>
                <button class="remove-operator-button" data-index="${index}">Remove</button>
            `;
            selectedOperatorsList.appendChild(div);
        });
        
        // Add remove handlers
        selectedOperatorsList.querySelectorAll('.remove-operator-button').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                selectedOperators.splice(index, 1);
                updateSelectedOperatorsDisplay();
                if (configGenerateButton) {
                    configGenerateButton.disabled = selectedOperators.length === 0;
                }
            });
        });
    }
}

// Generate ImageSetConfiguration
if (configGenerateButton) {
    configGenerateButton.addEventListener('click', async () => {
        if (selectedOperators.length === 0) {
            showError('Please add at least one operator');
            return;
        }
        
        try {
            const response = await fetch('/api/generate-imageset-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    catalog: currentConfigCatalog,
                    version: currentConfigVersion,
                    selections: selectedOperators
                })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to generate configuration');
            }
            
            if (configYamlOutput) {
                configYamlOutput.textContent = data.yaml;
            }
            if (configResult) {
                configResult.style.display = 'block';
            }
            showSuccess('ImageSetConfiguration generated successfully');
            
            // Store for download
            if (configDownloadButton) {
                configDownloadButton.dataset.yaml = data.yaml;
                configDownloadButton.dataset.filename = data.filename;
            }
        } catch (error) {
            showError(error.message);
        }
    });
}

// Download generated config
if (configDownloadButton) {
    configDownloadButton.addEventListener('click', () => {
        const yaml = configDownloadButton.dataset.yaml;
        const filename = configDownloadButton.dataset.filename || 'imageset-config.yaml';
        
        const blob = new Blob([yaml], { type: 'application/x-yaml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    });
}

// Feature 3: Update ImageSetConfiguration
const configFileInput = document.getElementById('config-file-input');
const configParseStatus = document.getElementById('config-parse-status');
const configUpdateSection = document.getElementById('config-update-section');
const operatorVersionsList = document.getElementById('operator-versions-list');
const configSelectAllButton = document.getElementById('config-select-all-button');
const configUpdateButton = document.getElementById('config-update-button');
const configUpdateResult = document.getElementById('config-update-result');
const configUpdateYamlOutput = document.getElementById('config-update-yaml-output');
const configUpdateDownloadButton = document.getElementById('config-update-download-button');

let parsedConfig = null;
let originalConfigContent = null;
let versionUpdates = [];

// Handle file upload
if (configFileInput) {
    configFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            originalConfigContent = await file.text();
            
            // Parse the config
            const response = await fetch('/api/parse-imageset-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ configContent: originalConfigContent })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to parse configuration');
            }
            
            parsedConfig = data;
            if (configParseStatus) {
                configParseStatus.textContent = `Parsed configuration: ${data.catalog}:${data.version}`;
                configParseStatus.className = 'status-message success';
                configParseStatus.style.display = 'block';
            }
            
            // Get latest versions
            const versionsResponse = await fetch('/api/get-latest-versions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    catalog: data.catalog,
                    version: data.version,
                    packages: data.packages
                })
            });
            
            const versionsData = await versionsResponse.json();
            
            if (!versionsResponse.ok) {
                throw new Error(versionsData.error || 'Failed to get latest versions');
            }
            
            // Display version comparison
            displayVersionComparison(versionsData.versionInfo);
            if (configUpdateSection) {
                configUpdateSection.style.display = 'block';
            }
            
        } catch (error) {
            if (configParseStatus) {
                configParseStatus.textContent = `Error: ${error.message}`;
                configParseStatus.className = 'status-message error';
                configParseStatus.style.display = 'block';
            }
        }
    });
}

function displayVersionComparison(versionInfo) {
    if (!operatorVersionsList) return;
    
    operatorVersionsList.innerHTML = '';
    versionUpdates = [];
    
    versionInfo.forEach(info => {
        const div = document.createElement('div');
        div.className = 'version-comparison-item';
        
        const hasUpdate = info.hasUpdate && !info.error;
        const updateClass = hasUpdate ? 'has-update' : '';
        
        div.innerHTML = `
            <div class="operator-version-info ${updateClass}">
                <div class="operator-name"><strong>${info.name}</strong></div>
                <div class="channel-info">Channel: ${info.channel}</div>
                <div class="version-info">
                    <span class="current-version">Current: ${info.currentVersion}</span>
                    <span class="latest-version">Latest: ${info.latestVersion}</span>
                </div>
                ${info.error ? `<div class="error-message">${info.error}</div>` : ''}
            </div>
            <div class="version-action">
                ${hasUpdate ? `
                    <label>
                        <input type="checkbox" class="update-checkbox" data-name="${info.name}" data-channel="${info.channel}" data-version="${info.latestVersion}">
                        Update to ${info.latestVersion}
                    </label>
                ` : '<span class="no-update">No update available</span>'}
            </div>
        `;
        
        operatorVersionsList.appendChild(div);
    });
    
    // Add checkbox handlers
    operatorVersionsList.querySelectorAll('.update-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const name = checkbox.dataset.name;
            const channel = checkbox.dataset.channel;
            const version = checkbox.dataset.version;
            
            if (e.target.checked) {
                const existing = versionUpdates.find(u => u.name === name && u.channel === channel);
                if (!existing) {
                    versionUpdates.push({ name, channel, newVersion: version });
                }
            } else {
                versionUpdates = versionUpdates.filter(u => !(u.name === name && u.channel === channel));
            }
        });
    });
}

// Select All button handler
if (configSelectAllButton) {
    configSelectAllButton.addEventListener('click', () => {
        if (!operatorVersionsList) return;
        
        const checkboxes = operatorVersionsList.querySelectorAll('.update-checkbox');
        versionUpdates = [];
        
        checkboxes.forEach(checkbox => {
            checkbox.checked = true;
            const name = checkbox.dataset.name;
            const channel = checkbox.dataset.channel;
            const version = checkbox.dataset.version;
            
            versionUpdates.push({
                name: name,
                channel: channel,
                newVersion: version
            });
        });
    });
}

// Update configuration
if (configUpdateButton) {
    configUpdateButton.addEventListener('click', async () => {
        if (versionUpdates.length === 0) {
            showError('Please select at least one operator to update');
            return;
        }
        
        try {
            const response = await fetch('/api/update-imageset-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    originalConfig: originalConfigContent,
                    updates: versionUpdates
                })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to update configuration');
            }
            
            if (configUpdateYamlOutput) {
                configUpdateYamlOutput.textContent = data.yaml;
            }
            if (configUpdateResult) {
                configUpdateResult.style.display = 'block';
            }
            showSuccess('ImageSetConfiguration updated successfully');
            
            // Store for download
            if (configUpdateDownloadButton) {
                configUpdateDownloadButton.dataset.yaml = data.yaml;
                configUpdateDownloadButton.dataset.filename = data.filename;
            }
        } catch (error) {
            showError(error.message);
        }
    });
}

// Download updated config
if (configUpdateDownloadButton) {
    configUpdateDownloadButton.addEventListener('click', () => {
        const yaml = configUpdateDownloadButton.dataset.yaml;
        const filename = configUpdateDownloadButton.dataset.filename || 'imageset-config-updated.yaml';
        
        const blob = new Blob([yaml], { type: 'application/x-yaml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    });
}

