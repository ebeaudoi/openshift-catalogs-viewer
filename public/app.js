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

// Initialize searchable dropdown
function initSearchableDropdown(inputId, selectId, dropdownId) {
    const input = document.getElementById(inputId);
    const select = document.getElementById(selectId);
    const dropdown = document.getElementById(dropdownId);
    
    if (!input || !select || !dropdown) {
        console.warn(`Searchable dropdown initialization failed: missing elements for ${inputId}, ${selectId}, or ${dropdownId}`);
        return false;
    }
    
    console.log(`Initializing searchable dropdown: ${inputId}`);
    
    let allOptions = [];
    let filteredOptions = [];
    let selectedIndex = -1;
    
    // Populate options from select element
    function updateOptions() {
        allOptions = [];
        Array.from(select.options).forEach((option, index) => {
            if (option.value !== '') {
                allOptions.push({
                    value: option.value,
                    text: option.textContent,
                    index: index
                });
            }
        });
        filteredOptions = [...allOptions];
        renderDropdown();
    }
    
    // Render dropdown items
    function renderDropdown() {
        dropdown.innerHTML = '';
        
        console.log('=== RENDERING DROPDOWN ===');
        console.log('Filtered options:', filteredOptions.length);
        console.log('All options:', allOptions.length);
        console.log('Dropdown element:', dropdown);
        console.log('Dropdown display:', window.getComputedStyle(dropdown).display);
        
        if (filteredOptions.length === 0) {
            const emptyItem = document.createElement('div');
            emptyItem.className = 'searchable-select-dropdown-empty';
            emptyItem.textContent = 'No operators found';
            dropdown.appendChild(emptyItem);
            return;
        }
        
        filteredOptions.forEach((option, index) => {
            const item = document.createElement('div');
            item.className = 'searchable-select-dropdown-item';
            if (index === selectedIndex) {
                item.classList.add('highlighted');
            }
            item.textContent = option.text;
            item.dataset.value = option.value;
            item.dataset.index = index;
            
            // Store option values in closure
            const optionValue = option.value;
            const optionText = option.text;
            
            // Make sure item is clickable - set styles first
            item.style.pointerEvents = 'auto';
            item.style.cursor = 'pointer';
            item.style.position = 'relative';
            item.style.zIndex = '1002';
            
            // Create click handler function - VERY SIMPLE
            const handleItemClick = function(e) {
                console.log('=== CLICK EVENT FIRED ===');
                console.log('Clicked option:', optionValue, optionText);
                console.log('Event:', e);
                console.log('Target:', e.target);
                console.log('Current target:', e.currentTarget);
                
                e.stopPropagation();
                e.preventDefault();
                
                // Set values immediately
                console.log('Setting select value to:', optionValue);
                if (select) {
                    select.value = optionValue;
                    console.log('Select value is now:', select.value);
                }
                if (input) {
                    input.value = optionText;
                    console.log('Input value is now:', input.value);
                }
                
                // Hide dropdown
                dropdown.style.display = 'none';
                selectedIndex = -1;
                mouseOverDropdown = false;
                isClickingDropdown = false;
                
                // Trigger change event immediately
                if (select) {
                    console.log('Dispatching change event...');
                    try {
                        const changeEvent = new Event('change', { bubbles: true, cancelable: true });
                        const result = select.dispatchEvent(changeEvent);
                        console.log('Change event dispatched, result:', result, 'select.value:', select.value);
                    } catch (err) {
                        console.error('Error dispatching change event:', err);
                    }
                }
                
                return false;
            };
            
            // CRITICAL: Use onclick directly - most reliable
            item.onclick = function(e) {
                console.log('=== ONCLICK FIRED ===');
                console.log('Option:', optionValue, optionText);
                handleItemClick(e);
                return false;
            };
            
            // Also add event listener as backup
            item.addEventListener('click', function(e) {
                console.log('=== ADD EVENT LISTENER CLICK FIRED ===');
                handleItemClick(e);
            }, false);
            
            // Also try mousedown - don't prevent default
            item.addEventListener('mousedown', (e) => {
                console.log('=== MOUSEDOWN on item ===', optionValue);
                isClickingDropdown = true;
                mouseOverDropdown = true;
                // CRITICAL: Don't prevent default - we need the click to fire
            }, false);
            
            // Also try mouseup
            item.addEventListener('mouseup', (e) => {
                console.log('=== MOUSEUP on item ===', optionValue);
            }, false);
            
            // Test if element is in DOM and visible
            console.log('Created item element:', item);
            console.log('Item styles:', window.getComputedStyle(item).pointerEvents);
            console.log('Item will be added to dropdown:', dropdown);
            
            item.addEventListener('mouseenter', () => {
                selectedIndex = index;
                // DON'T re-render on mouseenter - it removes event listeners!
                // Just update the highlighted class
                const items = dropdown.querySelectorAll('.searchable-select-dropdown-item');
                items.forEach((itm, idx) => {
                    if (idx === index) {
                        itm.classList.add('highlighted');
                    } else {
                        itm.classList.remove('highlighted');
                    }
                });
            });
            
            // Add a test - log when item is added
            console.log('Adding dropdown item to DOM:', optionText, 'Element:', item);
            dropdown.appendChild(item);
            
            // Verify it was added
            console.log('Item added. Dropdown now has', dropdown.children.length, 'children');
        });
    }
    
    // Filter options based on input
    function filterOptions(searchTerm) {
        const term = searchTerm.toLowerCase().trim();
        if (term === '') {
            filteredOptions = [...allOptions];
        } else {
            filteredOptions = allOptions.filter(option =>
                option.text.toLowerCase().includes(term) ||
                option.value.toLowerCase().includes(term)
            );
        }
        selectedIndex = -1;
        renderDropdown();
    }
    
    // Input event handlers
    input.addEventListener('input', (e) => {
        const searchTerm = e.target.value;
        filterOptions(searchTerm);
        dropdown.style.display = 'block';
    });
    
    input.addEventListener('focus', () => {
        console.log('Input focused, showing dropdown. Options:', filteredOptions.length, 'All options:', allOptions.length);
        // Always show dropdown if there are any options, even if filtered is empty (user can type to filter)
        if (allOptions.length > 0) {
            // Refresh options in case they changed
            updateOptions();
            dropdown.style.display = 'block';
            console.log('Dropdown shown');
        } else {
            console.log('No options available to show');
        }
    });
    
    input.addEventListener('click', (e) => {
        e.stopPropagation();
        console.log('Input clicked, showing dropdown. Options:', filteredOptions.length, 'All options:', allOptions.length);
        // Always show dropdown if there are any options
        if (allOptions.length > 0) {
            // Refresh options in case they changed
            updateOptions();
            dropdown.style.display = 'block';
            console.log('Dropdown shown on click');
        } else {
            console.log('No options available to show');
        }
    });
    
    // Track if mouse is over dropdown to prevent hiding on blur
    let mouseOverDropdown = false;
    let isClickingDropdown = false;
    
    dropdown.addEventListener('mouseenter', () => {
        mouseOverDropdown = true;
        console.log('Mouse entered dropdown');
    });
    
    dropdown.addEventListener('mouseleave', () => {
        mouseOverDropdown = false;
        console.log('Mouse left dropdown');
    });
    
    dropdown.addEventListener('mousedown', (e) => {
        isClickingDropdown = true;
        mouseOverDropdown = true;
        console.log('Mousedown on dropdown');
    });
    
    dropdown.addEventListener('mouseup', (e) => {
        console.log('Mouseup on dropdown');
        // Keep flag true for a bit longer to ensure click completes
        setTimeout(() => {
            isClickingDropdown = false;
        }, 200);
    });
    
    // CRITICAL: Don't hide dropdown on blur if clicking dropdown
    // Use a longer delay and check multiple times
    let blurTimeout = null;
    input.addEventListener('blur', (e) => {
        console.log('=== INPUT BLUR EVENT ===');
        console.log('mouseOverDropdown:', mouseOverDropdown);
        console.log('isClickingDropdown:', isClickingDropdown);
        
        // Clear any existing timeout
        if (blurTimeout) {
            clearTimeout(blurTimeout);
        }
        
        // Check if the related target (where focus is going) is the dropdown
        const relatedTarget = e.relatedTarget || document.activeElement;
        const isClickingDropdownItem = relatedTarget && (
            relatedTarget.closest('.searchable-select-dropdown') ||
            relatedTarget.classList.contains('searchable-select-dropdown-item')
        );
        
        console.log('relatedTarget:', relatedTarget, 'isClickingDropdownItem:', isClickingDropdownItem);
        
        // Check multiple times to ensure click completes
        let checkCount = 0;
        const checkAndHide = () => {
            checkCount++;
            console.log(`Blur check #${checkCount} - mouseOver: ${mouseOverDropdown}, isClicking: ${isClickingDropdown}`);
            
            // Only hide if we're absolutely sure the user isn't clicking on the dropdown
            if (!mouseOverDropdown && !isClickingDropdown && !isClickingDropdownItem) {
                console.log('Hiding dropdown on blur (check #' + checkCount + ')');
                dropdown.style.display = 'none';
            } else if (checkCount < 5) {
                // Check again in 100ms
                blurTimeout = setTimeout(checkAndHide, 100);
            } else {
                console.log('Stopped checking - keeping dropdown visible or click should have completed');
                isClickingDropdown = false;
            }
        };
        
        // Start checking after a delay
        blurTimeout = setTimeout(checkAndHide, 200);
    });
    
    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, filteredOptions.length - 1);
            renderDropdown();
            const items = dropdown.querySelectorAll('.searchable-select-dropdown-item');
            if (items[selectedIndex]) {
                items[selectedIndex].scrollIntoView({ block: 'nearest' });
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            renderDropdown();
            const items = dropdown.querySelectorAll('.searchable-select-dropdown-item');
            if (items[selectedIndex]) {
                items[selectedIndex].scrollIntoView({ block: 'nearest' });
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex >= 0 && filteredOptions[selectedIndex]) {
                const option = filteredOptions[selectedIndex];
                select.value = option.value;
                input.value = option.text;
                dropdown.style.display = 'none';
                selectedIndex = -1;
                mouseOverDropdown = false;
                
                // Trigger change event on select for compatibility
                // Use setTimeout to ensure it fires after dropdown is hidden
                setTimeout(() => {
                    const changeEvent = new Event('change', { bubbles: true, cancelable: true });
                    select.dispatchEvent(changeEvent);
                    
                    // Also trigger input event to ensure all listeners are notified
                    const inputEvent = new Event('input', { bubbles: true });
                    input.dispatchEvent(inputEvent);
                }, 0);
            }
        } else if (e.key === 'Escape') {
            dropdown.style.display = 'none';
            selectedIndex = -1;
        }
    });
    
    // Sync with select changes
    select.addEventListener('change', () => {
        const selectedOption = select.options[select.selectedIndex];
        if (selectedOption) {
            input.value = selectedOption.textContent;
        }
        // For operator select, also update the view details button state
        if (selectId === 'operator-select') {
            // Use setTimeout to ensure the change event has propagated
            setTimeout(() => {
                const viewDetailsBtn = document.getElementById('view-details-button');
                if (viewDetailsBtn && select.value) {
                    viewDetailsBtn.disabled = false;
                } else if (viewDetailsBtn) {
                    viewDetailsBtn.disabled = true;
                }
            }, 0);
        }
    });
    
    // Initialize
    updateOptions();
    
    // Watch for select changes (when options are added/removed)
    const observer = new MutationObserver((mutations) => {
        console.log('Select options changed, updating dropdown options');
        updateOptions();
    });
    observer.observe(select, { childList: true, subtree: true });
    
    // Also expose updateOptions for manual updates if needed
    console.log(`Searchable dropdown initialized successfully: ${inputId}`);
    console.log('Initial options count:', allOptions.length);
    
    return { updateOptions };
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
    
    // Enable searchable input
    const operatorInput = document.getElementById('operator-select-input');
    if (operatorInput) {
        operatorInput.disabled = false;
    }
    
    // Ensure button state is correct (should be disabled if no operator selected)
    updateViewDetailsButtonState();
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
    const operatorInput = document.getElementById('operator-select-input');
    if (operatorInput) {
        operatorInput.disabled = true;
        operatorInput.value = '';
    }
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

// Function to update view details button state
function updateViewDetailsButtonState() {
    if (operatorSelect && operatorSelect.value) {
        viewDetailsButton.disabled = false;
    } else {
        viewDetailsButton.disabled = true;
    }
}

operatorSelect.addEventListener('change', () => {
    saveStateToStorage();
    if (operatorSelect.value) {
        addLogEntry(`Operator selected: ${operatorSelect.value}`, 'info');
        updateViewDetailsButtonState();
    } else {
        updateViewDetailsButtonState();
    }
});

// Also listen to the searchable input for operator selection
const operatorInput = document.getElementById('operator-select-input');
if (operatorInput) {
    // Listen for when input value changes (user types or selects)
    operatorInput.addEventListener('input', () => {
        // Check if the select has a value (user selected from dropdown)
        if (operatorSelect && operatorSelect.value) {
            updateViewDetailsButtonState();
        }
    });
    
    // Also check on blur in case the value was set programmatically
    operatorInput.addEventListener('blur', () => {
        setTimeout(() => {
            if (operatorSelect && operatorSelect.value) {
                updateViewDetailsButtonState();
            }
        }, 100);
    });
}

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
    configCatalogSelect.addEventListener('change', () => {
        updateConfigFetchButtonState();
        // Clear operator and channel selections when catalog changes
        if (configOperatorSelect) configOperatorSelect.value = '';
        const configOperatorInput = document.getElementById('config-operator-select-input');
        if (configOperatorInput) {
            configOperatorInput.value = '';
            configOperatorInput.disabled = true;
        }
        if (configChannelSelect) configChannelSelect.value = '';
        if (configVersionSelectOperator) configVersionSelectOperator.value = '';
        if (configOperatorSelect) configOperatorSelect.disabled = true;
        if (configChannelSelect) configChannelSelect.disabled = true;
        if (configVersionSelectOperator) configVersionSelectOperator.disabled = true;
        if (defaultChannelIndicator) defaultChannelIndicator.style.display = 'none';
        currentOperatorDefaultChannel = null;
    });
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
        
        // Clear selected operators list when fetching new catalog
        selectedOperators = [];
        updateSelectedOperatorsDisplay();
        if (configGenerateButton) {
            configGenerateButton.disabled = true;
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
            
            // Enable searchable input
            const configOperatorInput = document.getElementById('config-operator-select-input');
            if (configOperatorInput) {
                configOperatorInput.disabled = false;
            }
            
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
        
        // Include default channel information if available
        const selection = {
            operator,
            channel,
            version
        };
        
        // Always store defaultChannel if it exists (for use in defaultChannel parameter when not selected)
        if (currentOperatorDefaultChannel) {
            selection.defaultChannel = currentOperatorDefaultChannel;
            
            // Store default channel version (not used when defaultChannel parameter is used, but kept for reference)
            if (currentOperatorChannels) {
                const defaultChannelObj = currentOperatorChannels.find(c => c.name === currentOperatorDefaultChannel);
                if (defaultChannelObj && defaultChannelObj.versions && defaultChannelObj.versions.length > 0) {
                    // Versions are sorted, first is latest
                    selection.defaultChannelVersion = defaultChannelObj.versions[0];
                }
            }
        }
        
        selectedOperators.push(selection);
        updateSelectedOperatorsDisplay();
        if (configGenerateButton) {
            configGenerateButton.disabled = selectedOperators.length === 0;
        }
        
        // Reset form for next selection
        configOperatorSelect.value = '';
        const configOperatorInput = document.getElementById('config-operator-select-input');
        if (configOperatorInput) {
            configOperatorInput.value = '';
        }
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
        
        // Get optional parameters
        const targetCatalogInput = document.getElementById('config-target-catalog-input');
        const archiveSizeInput = document.getElementById('config-archive-size-input');
        
        const targetCatalog = targetCatalogInput ? targetCatalogInput.value.trim() : '';
        const archiveSize = archiveSizeInput ? archiveSizeInput.value.trim() : '';
        
        // Validate archive size if provided
        if (archiveSize && (isNaN(archiveSize) || parseFloat(archiveSize) <= 0)) {
            showError('Archive size must be a positive number');
            return;
        }
        
        try {
            const response = await fetch('/api/generate-imageset-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    catalog: currentConfigCatalog,
                    version: currentConfigVersion,
                    selections: selectedOperators,
                    targetCatalog: targetCatalog || undefined,
                    archiveSize: archiveSize ? parseFloat(archiveSize) : undefined
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
let channelReplacements = new Map(); // Track channel replacements: operator -> newChannel
let defaultChannelAdditions = new Map(); // Track default channel additions: operator -> {channel, version}
let defaultChannelReplacements = new Map(); // Track default channel replacements: operator -> {channel, version} (replaces all channels)

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
            
            // Initially disable button if channel replacements are required
            checkChannelReplacementsComplete();
            
        } catch (error) {
            if (configParseStatus) {
                configParseStatus.textContent = `Error: ${error.message}`;
                configParseStatus.className = 'status-message error';
                configParseStatus.style.display = 'block';
            }
        }
    });
}

// Store versionInfo globally for channel replacement handler
let currentVersionInfo = [];

// Function to check if all required channel replacements are complete
function checkChannelReplacementsComplete() {
    if (!currentVersionInfo || currentVersionInfo.length === 0) {
        if (configUpdateButton) {
            configUpdateButton.disabled = false;
        }
        return;
    }
    
    // Find all operators that require channel replacement
    const operatorsRequiringReplacement = currentVersionInfo
        .filter(info => info.channelNotFound && !info.operatorNotFound)
        .map(info => info.name);
    
    // Check if all have been replaced
    const allReplaced = operatorsRequiringReplacement.every(operator => 
        channelReplacements.has(operator)
    );
    
    // Enable button only if all replacements are complete
    if (configUpdateButton) {
        configUpdateButton.disabled = !allReplaced;
    }
}

function displayVersionComparison(versionInfo) {
    if (!operatorVersionsList) return;
    
    operatorVersionsList.innerHTML = '';
    versionUpdates = [];
    channelReplacements.clear(); // Reset channel replacements
    defaultChannelAdditions.clear(); // Reset default channel additions
    defaultChannelReplacements.clear(); // Reset default channel replacements
    currentVersionInfo = versionInfo; // Store for channel replacement handler
    
    versionInfo.forEach(info => {
        const div = document.createElement('div');
        div.className = 'version-comparison-item';
        
        const hasUpdate = info.hasUpdate && !info.error;
        const updateClass = hasUpdate ? 'has-update' : '';
        const errorClass = info.error ? 'has-error' : '';
        
        // Check if current channel is not the default channel
        const isNonDefaultChannel = info.defaultChannel && info.channel !== info.defaultChannel;
        
        // Build default channel display
        const defaultChannelDisplay = info.defaultChannel 
            ? `<div class="default-channel-display">Default channel: <strong>${info.defaultChannel}</strong></div>` 
            : '';
        
        // Build error message
        let errorDisplay = '';
        if (info.operatorNotFound) {
            errorDisplay = '<div class="error-message">Operator not found.</div>';
        } else if (info.channelNotFound) {
            errorDisplay = `
                <div class="error-message">Channel "${info.channel}" not found.</div>
                <div class="channel-replacement-section">
                    <label>Select replacement channel:</label>
                    <select class="channel-replacement-select" data-operator="${info.name}" data-original-channel="${info.channel}">
                        <option value="">-- Select Channel --</option>
                        ${info.availableChannels ? info.availableChannels.map(ch => 
                            `<option value="${ch}">${ch}${ch === info.defaultChannel ? ' (Default)' : ''}</option>`
                        ).join('') : ''}
                    </select>
                </div>
            `;
        } else if (info.error) {
            errorDisplay = `<div class="error-message">${info.error}</div>`;
        }
        
        // Build default channel options (Add or Replace)
        let defaultChannelOption = '';
        if (info.defaultChannel && !info.operatorNotFound && !info.channelNotFound) {
            // Use defaultChannelLatestVersion from server response
            const defaultLatestVersion = info.defaultChannelLatestVersion || info.latestVersion;
            
            if (isNonDefaultChannel) {
                // New default channel detected (different from currently configured channel)
                // Show both "Add" and "Replace" options
                if (defaultLatestVersion) {
                    // Default to "Add" option (checked) - automatically add default channel alongside existing
                    defaultChannelAdditions.set(info.name, {
                        channel: info.defaultChannel,
                        version: defaultLatestVersion
                    });
                    
                    defaultChannelOption = `
                        <div class="default-channel-option">
                            <div class="default-channel-header" style="margin-bottom: 10px; font-weight: 600; color: #333;">
                                New default channel detected: <strong>${info.defaultChannel}</strong>
                            </div>
                            <div class="default-channel-choices" style="margin-left: 20px;">
                                <label style="display: block; margin-bottom: 8px;">
                                    <input type="radio" name="default-channel-action-${info.name}" 
                                           class="default-channel-action-radio" 
                                           data-operator="${info.name}" 
                                           data-action="add"
                                           data-channel="${info.defaultChannel}" 
                                           data-version="${defaultLatestVersion}"
                                           checked>
                                    <strong>Add:</strong> Add the new default channel "${info.defaultChannel}" (version ${defaultLatestVersion}) alongside the existing channel "${info.channel}"
                                </label>
                                <label style="display: block; margin-bottom: 8px;">
                                    <input type="radio" name="default-channel-action-${info.name}" 
                                           class="default-channel-action-radio" 
                                           data-operator="${info.name}" 
                                           data-action="replace"
                                           data-channel="${info.defaultChannel}" 
                                           data-version="${defaultLatestVersion}">
                                    <strong>Replace:</strong> Replace the current channel configuration with the new default channel "${info.defaultChannel}" (version ${defaultLatestVersion})
                                </label>
                                <label style="display: block; margin-bottom: 8px;">
                                    <input type="radio" name="default-channel-action-${info.name}" 
                                           class="default-channel-action-radio" 
                                           data-operator="${info.name}" 
                                           data-action="none">
                                    <strong>None:</strong> Keep current channel only (use defaultChannel parameter for reference)
                                </label>
                            </div>
                        </div>
                    `;
                }
            }
            // If current channel IS the default channel, no option is shown (already using default)
        }
        
        div.innerHTML = `
            <div class="operator-version-info ${updateClass} ${errorClass}">
                <div class="operator-name"><strong>${info.name}</strong></div>
                ${defaultChannelDisplay}
                <div class="channel-info">Channel: ${info.channel}</div>
                <div class="version-info">
                    <span class="current-version">Current: ${info.currentVersion}</span>
                    ${!info.operatorNotFound && !info.channelNotFound ? `<span class="latest-version">Latest: ${info.latestVersion}</span>` : ''}
                </div>
                ${errorDisplay}
                ${defaultChannelOption}
            </div>
            <div class="version-action">
                ${hasUpdate ? `
                    <label>
                        <input type="checkbox" class="update-checkbox" data-name="${info.name}" data-channel="${info.channel}" data-version="${info.latestVersion}">
                        Update to ${info.latestVersion}
                    </label>
                ` : info.operatorNotFound || info.channelNotFound ? '<span class="no-update">-</span>' : '<span class="no-update">No update available</span>'}
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
    
    // Add channel replacement handlers
    operatorVersionsList.querySelectorAll('.channel-replacement-select').forEach(select => {
        select.addEventListener('change', async (e) => {
            const operator = select.dataset.operator;
            const originalChannel = select.dataset.originalChannel;
            const newChannel = select.value;
            
            if (!newChannel) return;
            
            // Find the original info to get current version
            const originalInfo = currentVersionInfo.find(i => i.name === operator && i.channel === originalChannel);
            const currentVersion = originalInfo ? originalInfo.currentVersion : '';
            
            // Fetch operator details to get versions for the new channel
            try {
                const response = await fetch(`/api/operator-details?catalog=${encodeURIComponent(parsedConfig.catalog)}&version=${encodeURIComponent(parsedConfig.version)}&operator=${encodeURIComponent(operator)}`);
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.error || 'Failed to get operator details');
                }
                
                const channel = data.channels.find(c => c.name === newChannel);
                if (channel && channel.versions && channel.versions.length > 0) {
                    const latestVersion = channel.versions[0];
                    
                    // Update the display to show the new channel info
                    const itemDiv = select.closest('.version-comparison-item');
                    const channelInfoDiv = itemDiv.querySelector('.channel-info');
                    channelInfoDiv.textContent = `Channel: ${newChannel}`;
                    
                    const versionInfoDiv = itemDiv.querySelector('.version-info');
                    versionInfoDiv.innerHTML = `
                        <span class="current-version">Current: ${currentVersion}</span>
                        <span class="latest-version">Latest: ${latestVersion}</span>
                    `;
                    
                    // Update the action section to show update checkbox
                    const actionDiv = itemDiv.querySelector('.version-action');
                    actionDiv.innerHTML = `
                        <label>
                            <input type="checkbox" class="update-checkbox" data-name="${operator}" data-channel="${newChannel}" data-version="${latestVersion}" data-original-channel="${originalChannel}">
                            Update to ${latestVersion}
                        </label>
                    `;
                    
                    // Remove error display
                    const errorDiv = itemDiv.querySelector('.error-message');
                    if (errorDiv) errorDiv.remove();
                    const replacementDiv = itemDiv.querySelector('.channel-replacement-section');
                    if (replacementDiv) replacementDiv.remove();
                    
                    // Add checkbox handler
                    const newCheckbox = actionDiv.querySelector('.update-checkbox');
                    newCheckbox.addEventListener('change', (e) => {
                        if (e.target.checked) {
                            // Remove old entry if exists
                            versionUpdates = versionUpdates.filter(u => !(u.name === operator && u.originalChannel === originalChannel));
                            versionUpdates.push({ 
                                name: operator, 
                                channel: newChannel, 
                                newVersion: latestVersion,
                                originalChannel: originalChannel
                            });
                        } else {
                            versionUpdates = versionUpdates.filter(u => !(u.name === operator && u.channel === newChannel));
                        }
                    });
                    
                    // Update class to show it's now valid
                    const operatorInfoDiv = itemDiv.querySelector('.operator-version-info');
                    operatorInfoDiv.classList.remove('has-error');
                    if (latestVersion !== currentVersion) {
                        operatorInfoDiv.classList.add('has-update');
                    }
                    
                    // Track this channel replacement
                    channelReplacements.set(operator, newChannel);
                    
                    // Check if all required replacements are complete
                    checkChannelReplacementsComplete();
                }
            } catch (error) {
                showError(`Failed to load channel information: ${error.message}`);
            }
        });
    });
    
    // Add radio button handlers for default channel actions (Add/Replace/None)
    operatorVersionsList.querySelectorAll('.default-channel-action-radio').forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (!e.target.checked) return; // Only process when this radio is selected
            
            const operator = radio.dataset.operator;
            const action = radio.dataset.action;
            const channel = radio.dataset.channel;
            const version = radio.dataset.version;
            
            if (action === 'add') {
                // Add: Add default channel alongside existing channel
                defaultChannelAdditions.set(operator, { channel, version });
                defaultChannelReplacements.delete(operator);
            } else if (action === 'replace') {
                // Replace: Replace all channels with default channel only
                defaultChannelReplacements.set(operator, { channel, version });
                defaultChannelAdditions.delete(operator);
            } else if (action === 'none') {
                // None: Keep current channel only, use defaultChannel parameter
                defaultChannelAdditions.delete(operator);
                defaultChannelReplacements.delete(operator);
            }
        });
    });
    
    // Check initial state after rendering
    checkChannelReplacementsComplete();
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
        // Get list of operators that are not found
        const missingOperators = currentVersionInfo
            .filter(info => info.operatorNotFound)
            .map(info => info.name);
        
        // Show confirmation if there are missing operators
        if (missingOperators.length > 0) {
            const operatorList = missingOperators.join(', ');
            const confirmMessage = `The following operator(s) were not found and will be removed from the configuration:\n\n${operatorList}\n\nDo you want to continue?`;
            
            if (!confirm(confirmMessage)) {
                return; // User cancelled
            }
        }
        
        if (versionUpdates.length === 0 && missingOperators.length === 0) {
            showError('Please select at least one operator to update or there are no changes to apply');
            return;
        }
        
        // Collect default channel additions (Add option selected)
        const defaultChannelAdds = Array.from(defaultChannelAdditions.entries()).map(([operator, data]) => ({
            operator,
            channel: data.channel,
            version: data.version
        }));
        
        // Collect default channel replacements (Replace option selected)
        const defaultChannelReplaces = Array.from(defaultChannelReplacements.entries()).map(([operator, data]) => ({
            operator,
            channel: data.channel,
            version: data.version
        }));
        
        // Collect operators that need defaultChannel parameter (non-default channel, action is "none")
        const operatorsNeedingDefaultChannelParam = [];
        currentVersionInfo.forEach(info => {
            if (info.defaultChannel && 
                !info.operatorNotFound && 
                !info.channelNotFound && 
                info.channel !== info.defaultChannel) {
                // Operator uses non-default channel
                // Check if default channel is NOT in additions or replacements (action is "none")
                if (!defaultChannelAdditions.has(info.name) && !defaultChannelReplacements.has(info.name)) {
                    operatorsNeedingDefaultChannelParam.push({
                        operator: info.name,
                        defaultChannel: info.defaultChannel
                    });
                }
            }
        });
        
        try {
            const response = await fetch('/api/update-imageset-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    originalConfig: originalConfigContent,
                    updates: versionUpdates,
                    removeOperators: missingOperators,
                    addDefaultChannels: defaultChannelAdds,
                    replaceWithDefaultChannels: defaultChannelReplaces,
                    setDefaultChannelParam: operatorsNeedingDefaultChannelParam
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
            
            let successMessage = 'ImageSetConfiguration updated successfully';
            if (missingOperators.length > 0) {
                successMessage += `. Removed ${missingOperators.length} operator(s) that were not found.`;
            }
            showSuccess(successMessage);
            
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

// Initialize searchable dropdowns when DOM is ready
function initializeSearchableDropdowns() {
    // Initialize searchable dropdown for "Fetch Operators" tab
    const result1 = initSearchableDropdown('operator-select-input', 'operator-select', 'operator-select-dropdown');
    if (!result1) {
        console.warn('Failed to initialize operator select dropdown');
    }
    
    // Initialize searchable dropdown for "Create ImageSetConfiguration" tab
    const result2 = initSearchableDropdown('config-operator-select-input', 'config-operator-select', 'config-operator-select-dropdown');
    if (!result2) {
        console.warn('Failed to initialize config operator select dropdown');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSearchableDropdowns);
} else {
    // DOM is already loaded
    initializeSearchableDropdowns();
}

