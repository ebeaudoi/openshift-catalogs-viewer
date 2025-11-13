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

