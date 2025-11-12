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

// Event source for server-sent events
let eventSource = null;

// Enable/disable fetch button based on selections
function updateFetchButtonState() {
    const catalogSelected = catalogSelect.value !== '';
    const versionSelected = versionSelect.value !== '';
    fetchButton.disabled = !(catalogSelected && versionSelected);
}

// Event listeners for dropdown changes
catalogSelect.addEventListener('change', updateFetchButtonState);
versionSelect.addEventListener('change', updateFetchButtonState);

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

// Fetch operators from API
async function fetchOperators() {
    const catalog = catalogSelect.value;
    const version = versionSelect.value;

    if (!catalog || !version) {
        showError('Please select both catalog and version');
        addLogEntry('Error: Please select both catalog and version', 'error');
        return;
    }

    const catalogName = catalogSelect.options[catalogSelect.selectedIndex].text;
    addLogEntry(`Starting fetch operation: ${catalogName} ${version}`, 'info');

    hideMessages();
    setLoading(true);
    operatorSelect.disabled = true;
    operatorSelect.innerHTML = '<option value="">-- Select Operator --</option>';

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

// Log client-side events
catalogSelect.addEventListener('change', () => {
    updateFetchButtonState();
    if (catalogSelect.value) {
        const catalogName = catalogSelect.options[catalogSelect.selectedIndex].text;
        addLogEntry(`Catalog selected: ${catalogName}`, 'info');
    }
});

versionSelect.addEventListener('change', () => {
    updateFetchButtonState();
    if (versionSelect.value) {
        addLogEntry(`Version selected: ${versionSelect.value}`, 'info');
    }
});

operatorSelect.addEventListener('change', () => {
    if (operatorSelect.value) {
        addLogEntry(`Operator selected: ${operatorSelect.value}`, 'info');
    }
});

// Initialize
updateFetchButtonState();
connectToLogs();

// Update initial log entry time
document.querySelector('.log-entry .log-time').textContent = getCurrentTime();

