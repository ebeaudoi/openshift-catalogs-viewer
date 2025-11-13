// Get URL parameters
const urlParams = new URLSearchParams(window.location.search);
const catalog = urlParams.get('catalog');
const version = urlParams.get('version');
const operator = urlParams.get('operator');

// DOM elements
const operatorNameEl = document.getElementById('operator-name');
const operatorCatalogEl = document.getElementById('operator-catalog');
const operatorVersionEl = document.getElementById('operator-version');
const defaultChannelEl = document.getElementById('default-channel');
const channelSelect = document.getElementById('channel-select');
const versionList = document.getElementById('version-list');
const errorMessage = document.getElementById('error-message');
const loadingMessage = document.getElementById('loading-message');
const backButton = document.getElementById('back-button');

// Store operator data
let operatorData = null;

// Initialize page
async function init() {
    // Validate URL parameters
    if (!catalog || !version || !operator) {
        showError('Missing required parameters. Please select an operator from the main page.');
        return;
    }

    // Set operator name
    operatorNameEl.textContent = operator;
    operatorCatalogEl.textContent = catalog;
    operatorVersionEl.textContent = version;

    // Load operator details
    await loadOperatorDetails();
}

// Load operator details from API
async function loadOperatorDetails() {
    showLoading(true);
    hideError();

    try {
        const response = await fetch(`/api/operator-details?catalog=${encodeURIComponent(catalog)}&version=${encodeURIComponent(version)}&operator=${encodeURIComponent(operator)}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || data.message || 'Failed to load operator details');
        }

        operatorData = data;

        // Populate UI
        populateChannels(data);
        showLoading(false);

    } catch (error) {
        console.error('Error loading operator details:', error);
        showError(error.message || 'An error occurred while loading operator details');
        showLoading(false);
    }
}

// Populate channels dropdown and default channel
function populateChannels(data) {
    // Set default channel
    if (data.defaultChannel) {
        defaultChannelEl.textContent = data.defaultChannel;
    } else {
        defaultChannelEl.textContent = 'Not specified';
    }

    // Populate channel dropdown
    channelSelect.innerHTML = '<option value="">-- Select Channel --</option>';
    
    if (data.channels && data.channels.length > 0) {
        data.channels.forEach(channel => {
            const option = document.createElement('option');
            option.value = channel.name;
            option.textContent = channel.name;
            if (channel.name === data.defaultChannel) {
                option.selected = true;
            }
            channelSelect.appendChild(option);
        });

        // Enable dropdown
        channelSelect.disabled = false;

        // If default channel exists, show its versions
        if (data.defaultChannel) {
            const defaultChannelData = data.channels.find(c => c.name === data.defaultChannel);
            if (defaultChannelData) {
                displayVersions(defaultChannelData.versions);
            }
        }
    } else {
        channelSelect.disabled = true;
        versionList.innerHTML = '<div class="version-list-placeholder">No channels available</div>';
    }
}

// Display versions for selected channel
function displayVersions(versions) {
    if (!versions || versions.length === 0) {
        versionList.innerHTML = '<div class="version-list-placeholder">No versions available for this channel</div>';
        return;
    }

    versionList.innerHTML = '';
    versions.forEach(version => {
        const versionItem = document.createElement('div');
        versionItem.className = 'version-item';
        versionItem.innerHTML = `<span class="version-name">${version}</span>`;
        versionList.appendChild(versionItem);
    });
}

// Handle channel selection change
channelSelect.addEventListener('change', (e) => {
    const selectedChannelName = e.target.value;
    
    if (!selectedChannelName) {
        versionList.innerHTML = '<div class="version-list-placeholder">Select a channel to view versions</div>';
        return;
    }

    const selectedChannel = operatorData.channels.find(c => c.name === selectedChannelName);
    if (selectedChannel) {
        displayVersions(selectedChannel.versions);
    }
});

// Show/hide loading message
function showLoading(show) {
    loadingMessage.style.display = show ? 'block' : 'none';
}

// Show error message
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
}

// Hide error message
function hideError() {
    errorMessage.style.display = 'none';
}

// Back button handler
backButton.addEventListener('click', () => {
    // Navigate back to main page - state will be restored from sessionStorage
    window.location.href = '/';
});

// Initialize on page load
init();

