/**
 * BigQuery Release Hub - Frontend Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    // State management
    let releases = [];
    let currentFilter = 'all';
    let searchQuery = '';
    let sortAscending = false; // Default: Newest first (descending by date)
    
    // Tweet composer state
    let selectedRelease = null;
    let currentTweetStyle = 'standard';
    
    // Constants
    const CHAR_LIMIT = 280;
    const TWITTER_URL_LEN = 23; // Twitter counts any link as 23 characters

    // Cache circumference of the circular indicator (r=11, circumference = 2 * pi * 11 = 69.115)
    const RING_CIRCUMFERENCE = 2 * Math.PI * 11;
    
    // DOM Elements
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const refreshSpinner = document.getElementById('refresh-spinner');
    const cacheTimeText = document.getElementById('cache-time');
    const resultsCountText = document.getElementById('results-count-text');
    const sortOrderBtn = document.getElementById('sort-order-btn');
    const sortLabel = document.getElementById('sort-label');
    const releasesFeed = document.getElementById('releases-feed');
    const shimmerLoader = document.getElementById('shimmer-loader');
    const emptyState = document.getElementById('empty-state');
    const resetFiltersBtn = document.getElementById('reset-filters-btn');
    
    // Category Counts
    const counts = {
        all: document.getElementById('count-all'),
        Feature: document.getElementById('count-feature'),
        Announcement: document.getElementById('count-announcement'),
        Issue: document.getElementById('count-issue'),
        Breaking: document.getElementById('count-breaking'),
        Change: document.getElementById('count-change')
    };
    
    // Modal Elements
    const tweetModal = document.getElementById('tweet-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const tweetTextarea = document.getElementById('tweet-textarea');
    const copyTweetBtn = document.getElementById('copy-tweet-btn');
    const copyStatusText = document.getElementById('copy-status-text');
    const charCounter = document.getElementById('char-counter');
    const progressRingValue = document.getElementById('progress-ring-value');
    const tweetSubmitBtn = document.getElementById('tweet-submit-btn');
    const previewTag = document.getElementById('modal-preview-tag');
    const previewDate = document.getElementById('modal-preview-date');
    const previewText = document.getElementById('modal-preview-text');
    
    // Toast Notification
    const toast = document.getElementById('toast-notification');
    const toastMessage = document.getElementById('toast-message');

    // Initialize circular progress ring settings
    if (progressRingValue) {
        progressRingValue.style.strokeDasharray = RING_CIRCUMFERENCE;
        progressRingValue.style.strokeDashoffset = RING_CIRCUMFERENCE;
    }

    // -----------------------------------------------------------------
    // Data Fetching & Caching
    // -----------------------------------------------------------------
    
    async function fetchReleases(forceRefresh = false) {
        setLoadingState(true);
        try {
            const response = await fetch(`/api/releases?refresh=${forceRefresh}`);
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const data = await response.json();
            
            if (data.status === 'success') {
                releases = data.releases;
                updateStats(releases);
                updateCacheTime(data.cached_at);
                renderFeed();
                showToast(forceRefresh ? 'Fetched fresh updates!' : 'Release notes loaded');
            } else {
                throw new Error(data.message || 'Unknown error occurred');
            }
        } catch (error) {
            console.error('Error fetching release notes:', error);
            showToast('Failed to fetch release notes: ' + error.message);
            releasesFeed.innerHTML = `<div class="empty-state">
                <div class="empty-icon-wrapper" style="color: var(--tag-break-text); border-color: var(--tag-break-border)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                </div>
                <h2>Error Loading Feed</h2>
                <p>We encountered an error contacting the Google Cloud RSS feed. Please try again later.</p>
                <button class="btn btn-secondary" onclick="window.location.reload()">Retry Connection</button>
            </div>`;
        } finally {
            setLoadingState(false);
        }
    }
    
    function setLoadingState(isLoading) {
        if (isLoading) {
            refreshBtn.classList.add('loading');
            refreshBtn.disabled = true;
            shimmerLoader.style.display = 'flex';
            emptyState.style.display = 'none';
            // If it's a pull refresh, dim the active list, but don't clear it
            const cards = document.querySelectorAll('.releases-day-group');
            cards.forEach(c => c.style.opacity = '0.4');
        } else {
            refreshBtn.classList.remove('loading');
            refreshBtn.disabled = false;
            shimmerLoader.style.display = 'none';
        }
    }
    
    function updateCacheTime(timestamp) {
        if (!timestamp) {
            cacheTimeText.textContent = '';
            return;
        }
        
        const cacheDate = new Date(timestamp * 1000);
        
        function formatRelativeTime() {
            const diffMs = new Date() - cacheDate;
            const diffMins = Math.floor(diffMs / 60000);
            
            if (diffMins < 1) {
                cacheTimeText.textContent = 'Last updated: Just now';
            } else if (diffMins === 1) {
                cacheTimeText.textContent = 'Last updated: 1 min ago';
            } else if (diffMins < 60) {
                cacheTimeText.textContent = `Last updated: ${diffMins} mins ago`;
            } else {
                cacheTimeText.textContent = `Last updated: ${cacheDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            }
        }
        
        formatRelativeTime();
        // Clear previous interval if any and set up periodic refresh
        if (window.cacheTimeInterval) clearInterval(window.cacheTimeInterval);
        window.cacheTimeInterval = setInterval(formatRelativeTime, 30000);
    }
    
    function updateStats(items) {
        const countsData = {
            all: items.length,
            Feature: 0,
            Announcement: 0,
            Issue: 0,
            Breaking: 0,
            Change: 0
        };
        
        items.forEach(item => {
            if (countsData[item.type] !== undefined) {
                countsData[item.type]++;
            } else {
                // If type is not mapped, put in Change/General
                countsData.Change++;
            }
        });
        
        // Update elements
        for (const [key, el] of Object.entries(counts)) {
            if (el) el.textContent = countsData[key];
        }
    }

    // Helper: calculate relative date label (e.g., Today, Yesterday, 3 days ago)
    function getRelativeDateLabel(dateStr, updatedIso) {
        try {
            const targetDate = new Date(updatedIso);
            const today = new Date();
            
            // Set times to midnight for date-only comparison
            targetDate.setHours(0,0,0,0);
            today.setHours(0,0,0,0);
            
            const diffTime = today - targetDate;
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays === 0) return 'Today';
            if (diffDays === 1) return 'Yesterday';
            if (diffDays > 1 && diffDays < 7) return `${diffDays} days ago`;
            return '';
        } catch (e) {
            return '';
        }
    }

    // -----------------------------------------------------------------
    // Rendering & Filtering
    // -----------------------------------------------------------------
    
    function renderFeed() {
        // Clear previous feed content
        const groups = document.querySelectorAll('.releases-day-group');
        groups.forEach(g => g.remove());
        
        // Filter items
        let filtered = releases.filter(item => {
            // Category filter
            const matchesCategory = currentFilter === 'all' || item.type === currentFilter;
            
            // Search text filter
            let matchesSearch = true;
            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                const inText = item.content_text.toLowerCase().includes(query);
                const inType = item.type.toLowerCase().includes(query);
                const inDate = item.date.toLowerCase().includes(query);
                matchesSearch = inText || inType || inDate;
            }
            
            return matchesCategory && matchesSearch;
        });
        
        // Update summary text
        if (searchQuery || currentFilter !== 'all') {
            resultsCountText.textContent = `Found ${filtered.length} matching update${filtered.length === 1 ? '' : 's'}`;
        } else {
            resultsCountText.textContent = `Showing all ${filtered.length} updates`;
        }
        
        if (filtered.length === 0) {
            emptyState.style.display = 'flex';
            return;
        } else {
            emptyState.style.display = 'none';
        }
        
        // Group filtered releases by Date
        const grouped = {};
        filtered.forEach(item => {
            if (!grouped[item.date]) {
                grouped[item.date] = {
                    date: item.date,
                    updatedIso: item.updated,
                    items: []
                };
            }
            grouped[item.date].items.push(item);
        });
        
        // Convert grouped object to array and sort dates
        const groupedArray = Object.values(grouped);
        groupedArray.sort((a, b) => {
            const timeA = new Date(a.updatedIso).getTime() || 0;
            const timeB = new Date(b.updatedIso).getTime() || 0;
            return sortAscending ? timeA - timeB : timeB - timeA;
        });
        
        // Create fragments for high performance DOM insertion
        const fragment = document.createDocumentFragment();
        
        groupedArray.forEach(group => {
            const dayGroup = document.createElement('div');
            dayGroup.className = 'releases-day-group';
            
            // Timeline nodes
            const node = document.createElement('div');
            node.className = 'releases-day-node';
            dayGroup.appendChild(node);
            
            // Day Header
            const header = document.createElement('div');
            header.className = 'day-header';
            
            const title = document.createElement('h2');
            title.className = 'day-title';
            title.textContent = group.date;
            header.appendChild(title);
            
            const relativeLabel = getRelativeDateLabel(group.date, group.updatedIso);
            if (relativeLabel) {
                const relativeSpan = document.createElement('span');
                relativeSpan.className = 'day-relative';
                relativeSpan.textContent = `(${relativeLabel})`;
                header.appendChild(relativeSpan);
            }
            
            dayGroup.appendChild(header);
            
            // Updates Sub-cards List
            const list = document.createElement('div');
            list.className = 'day-updates-list';
            
            group.items.forEach(item => {
                const card = document.createElement('div');
                card.className = `release-card type-${item.type.toLowerCase()}`;
                card.id = `card-${item.id}`;
                
                // Card Header
                const cardHeader = document.createElement('div');
                cardHeader.className = 'card-header';
                
                const typeTag = document.createElement('span');
                typeTag.className = `release-tag tag-${item.type.toLowerCase()}`;
                typeTag.textContent = item.type;
                cardHeader.appendChild(typeTag);
                
                // Actions
                const actions = document.createElement('div');
                actions.className = 'card-actions';
                
                // Link button
                if (item.link) {
                    const linkBtn = document.createElement('a');
                    linkBtn.href = item.link;
                    linkBtn.target = '_blank';
                    linkBtn.rel = 'noopener noreferrer';
                    linkBtn.className = 'btn-action btn-docs-link';
                    linkBtn.title = 'View in Google Cloud Docs';
                    linkBtn.innerHTML = `
                        <span>Docs</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                    `;
                    actions.appendChild(linkBtn);
                }
                
                // Tweet share button
                const tweetBtn = document.createElement('button');
                tweetBtn.className = 'btn-action btn-share-tweet';
                tweetBtn.title = 'Tweet about this update';
                tweetBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path>
                    </svg>
                    <span>Share</span>
                `;
                tweetBtn.addEventListener('click', () => openTweetModal(item));
                actions.appendChild(tweetBtn);

                // Copy button
                const copyCardBtn = document.createElement('button');
                copyCardBtn.className = 'btn-action btn-copy-card';
                copyCardBtn.title = 'Copy update content to clipboard';
                copyCardBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    <span>Copy</span>
                `;
                copyCardBtn.addEventListener('click', async () => {
                    try {
                        await navigator.clipboard.writeText(item.content_text);
                        showToast('Update copied to clipboard');
                    } catch (err) {
                        console.error('Failed to copy card text: ', err);
                        showToast('Failed to copy');
                    }
                });
                actions.appendChild(copyCardBtn);
                
                cardHeader.appendChild(actions);
                card.appendChild(cardHeader);
                
                // Card Body
                const cardBody = document.createElement('div');
                cardBody.className = 'card-body';
                
                // Apply search highlights if search exists
                if (searchQuery) {
                    cardBody.innerHTML = highlightSearchText(item.content_html, searchQuery);
                } else {
                    cardBody.innerHTML = item.content_html;
                }
                
                card.appendChild(cardBody);
                list.appendChild(card);
            });
            
            dayGroup.appendChild(list);
            fragment.appendChild(dayGroup);
        });
        
        releasesFeed.appendChild(fragment);
    }
    
    // Search highlighter utility
    function highlightSearchText(htmlContent, query) {
        if (!query) return htmlContent;
        
        // Escape query regex symbols
        const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`(${escapedQuery})`, 'gi');
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');
        
        // Recursive text node highlighter
        function highlightNode(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.nodeValue;
                if (regex.test(text)) {
                    const span = document.createElement('span');
                    span.innerHTML = text.replace(regex, '<span class="search-highlight">$1</span>');
                    node.parentNode.replaceChild(span, node);
                }
            } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'A' && node.tagName !== 'CODE') {
                // Skip highlighting inside links hrefs or raw code blocks elements directly, but scan children
                Array.from(node.childNodes).forEach(highlightNode);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                Array.from(node.childNodes).forEach(highlightNode);
            }
        }
        
        Array.from(doc.body.childNodes).forEach(highlightNode);
        return doc.body.innerHTML;
    }
    
    // -----------------------------------------------------------------
    // Filters & Sorting Actions
    // -----------------------------------------------------------------
    
    // Setup category filters click
    document.querySelectorAll('.filter-item').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.filter-item').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            currentFilter = button.dataset.category;
            renderFeed();
        });
    });
    
    // Setup search input
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        if (searchQuery) {
            clearSearchBtn.style.display = 'flex';
        } else {
            clearSearchBtn.style.display = 'none';
        }
        renderFeed();
    });
    
    // Search keyboard shortcut ('/' to focus)
    window.addEventListener('keydown', (e) => {
        if (e.key === '/' && document.activeElement !== searchInput) {
            e.preventDefault();
            searchInput.focus();
            searchInput.select();
        }
        if (e.key === 'Escape' && document.activeElement === searchInput) {
            searchInput.blur();
        }
    });
    
    // Clear search action
    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchQuery = '';
        clearSearchBtn.style.display = 'none';
        searchInput.focus();
        renderFeed();
    });
    
    // Sorting toggles
    sortOrderBtn.addEventListener('click', () => {
        sortAscending = !sortAscending;
        sortOrderBtn.classList.toggle('desc', sortAscending);
        sortLabel.textContent = sortAscending ? 'Oldest First' : 'Newest First';
        renderFeed();
    });
    
    // Reset filters empty state helper
    resetFiltersBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchQuery = '';
        clearSearchBtn.style.display = 'none';
        
        document.querySelectorAll('.filter-item').forEach(btn => btn.classList.remove('active'));
        const allBtn = document.querySelector('[data-category="all"]');
        if (allBtn) allBtn.classList.add('active');
        currentFilter = 'all';
        
        renderFeed();
    });
    
    // Manual trigger Refresh Button
    refreshBtn.addEventListener('click', () => {
        fetchReleases(true);
    });

    // -----------------------------------------------------------------
    // Tweet Share Composer Model
    // -----------------------------------------------------------------
    
    function openTweetModal(item) {
        selectedRelease = item;
        currentTweetStyle = 'standard';
        
        // Toggle chips active state
        document.querySelectorAll('.template-chip').forEach(chip => {
            chip.classList.remove('active');
            if (chip.dataset.style === 'standard') chip.classList.add('active');
        });
        
        // Set Preview Information
        previewTag.className = `release-tag tag-${item.type.toLowerCase()}`;
        previewTag.textContent = item.type;
        previewDate.textContent = item.date;
        previewText.textContent = item.content_text;
        
        // Generate draft text area
        updateTweetDraftText();
        
        // Toggle modal classes
        tweetModal.style.display = 'flex';
        // Add tiny timeout to ensure display transitions kick in
        setTimeout(() => tweetModal.classList.add('active'), 10);
        tweetTextarea.focus();
    }
    
    function closeTweetModal() {
        tweetModal.classList.remove('active');
        setTimeout(() => {
            tweetModal.style.display = 'none';
            selectedRelease = null;
        }, 250);
    }
    
    modalCloseBtn.addEventListener('click', closeTweetModal);
    modalCancelBtn.addEventListener('click', closeTweetModal);
    
    // Click outside modal card to close
    tweetModal.addEventListener('click', (e) => {
        if (e.target === tweetModal) {
            closeTweetModal();
        }
    });
    
    // Style chip click triggers
    document.querySelectorAll('.template-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.template-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentTweetStyle = chip.dataset.style;
            updateTweetDraftText();
        });
    });

    // Generate specific text templates for selected update
    function updateTweetDraftText() {
        if (!selectedRelease) return;
        
        const type = selectedRelease.type;
        const date = selectedRelease.date;
        const plainText = selectedRelease.content_text;
        const link = selectedRelease.link || 'https://cloud.google.com/bigquery';
        
        let draft = '';
        
        switch (currentTweetStyle) {
            case 'highlight':
                draft = `New #BigQuery update: ${date}\n\n[${type}]: ${plainText}\n\nRead more details here:\n${link} #GoogleCloud #DataWarehousing`;
                break;
            case 'minimal':
                draft = `Google BigQuery Changelog [${type}]: ${plainText} ${link}`;
                break;
            case 'standard':
            default:
                draft = `BigQuery Release Note - ${date}\n\n[${type}]: ${plainText}\n\nDetails: ${link} #BigQuery #GoogleCloud`;
                break;
        }
        
        // Truncate plainText dynamic part if it exceeds 280 chars total
        const textExcludingContent = draft.replace(plainText, '');
        // Replace URL in character math with a fixed size 23 chars for accurate Twitter calculations
        const charsUsedByFixed = calculateTwitterLength(textExcludingContent);
        
        const maxContentLength = CHAR_LIMIT - charsUsedByFixed - 4; // safety threshold
        
        if (plainText.length > maxContentLength) {
            const truncatedContent = plainText.substring(0, maxContentLength - 3) + '...';
            draft = draft.replace(plainText, truncatedContent);
        }
        
        tweetTextarea.value = draft;
        handleCharCount();
    }
    
    // Exact character length counting matching Twitter URL length formatting rules
    function calculateTwitterLength(str) {
        // Simple regex to extract urls
        const urlRegex = /https?:\/\/[^\s]+/g;
        const urls = str.match(urlRegex) || [];
        
        // Strip URLs to get text length
        let textOnly = str;
        urls.forEach(url => {
            textOnly = textOnly.replace(url, '');
        });
        
        // Twitter count is text length + 23 per url
        return textOnly.length + (urls.length * TWITTER_URL_LEN);
    }
    
    // Character counter ring updates
    function handleCharCount() {
        const text = tweetTextarea.value;
        const count = calculateTwitterLength(text);
        const remaining = CHAR_LIMIT - count;
        
        charCounter.textContent = remaining;
        
        // Update styling classes on threshold warnings
        charCounter.classList.remove('warning', 'danger');
        tweetSubmitBtn.disabled = false;
        
        if (remaining <= 20 && remaining >= 0) {
            charCounter.classList.add('warning');
        } else if (remaining < 0) {
            charCounter.classList.add('danger');
            tweetSubmitBtn.disabled = true;
        }
        
        // Update circle indicator dash offsets
        const percentage = Math.min(count / CHAR_LIMIT, 1);
        const offset = RING_CIRCUMFERENCE - (percentage * RING_CIRCUMFERENCE);
        
        progressRingValue.style.strokeDashoffset = offset;
        
        // Update progress ring colors dynamically
        if (remaining < 0) {
            progressRingValue.style.stroke = '#ef4444'; // Red danger
        } else if (remaining <= 20) {
            progressRingValue.style.stroke = '#f59e0b'; // Amber warning
        } else {
            progressRingValue.style.stroke = '#3b82f6'; // Blue default
        }
    }
    
    tweetTextarea.addEventListener('input', handleCharCount);
    
    // Clipboard copy action
    copyTweetBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(tweetTextarea.value);
            
            // Temporary success indicator
            copyStatusText.textContent = 'Copied!';
            copyTweetBtn.style.color = '#10b981';
            
            showToast('Tweet copied to clipboard!');
            
            setTimeout(() => {
                copyStatusText.textContent = 'Copy';
                copyTweetBtn.style.color = 'var(--text-secondary)';
            }, 2000);
        } catch (err) {
            console.error('Failed to copy text: ', err);
            showToast('Failed to copy. Please select and copy manually.');
        }
    });
    
    // Redirect web intent on Submit
    tweetSubmitBtn.addEventListener('click', () => {
        const text = encodeURIComponent(tweetTextarea.value);
        const twitterIntentUrl = `https://twitter.com/intent/tweet?text=${text}`;
        
        window.open(twitterIntentUrl, '_blank', 'noopener,noreferrer');
        closeTweetModal();
        showToast('Redirected to X (Twitter)');
    });
    
    // Toast Notification utility
    function showToast(message) {
        toastMessage.textContent = message;
        toast.style.display = 'block';
        
        // Trigger show animation
        setTimeout(() => toast.classList.add('show'), 10);
        
        // Clear previous timeouts
        if (window.toastTimeout) clearTimeout(window.toastTimeout);
        
        window.toastTimeout = setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.style.display = 'none', 300);
        }, 3000);
    }
    
    // -----------------------------------------------------------------
    // Theme Switcher & Export Features
    // -----------------------------------------------------------------
    
    // Theme Switcher Logic
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
    }
    
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const isLight = document.body.classList.toggle('light-theme');
            localStorage.setItem('theme', isLight ? 'light' : 'dark');
            showToast(isLight ? 'Swapped to light mode' : 'Swapped to dark mode');
        });
    }

    // Export to CSV Logic
    const exportCsvBtn = document.getElementById('export-csv-btn');
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', () => {
            const activeFilter = currentFilter;
            const query = searchQuery ? searchQuery.toLowerCase() : '';
            
            // Get currently filtered releases matching layout view
            const filtered = releases.filter(item => {
                const matchesCategory = activeFilter === 'all' || item.type === activeFilter;
                let matchesSearch = true;
                if (query) {
                    const inText = item.content_text.toLowerCase().includes(query);
                    const inType = item.type.toLowerCase().includes(query);
                    const inDate = item.date.toLowerCase().includes(query);
                    matchesSearch = inText || inType || inDate;
                }
                return matchesCategory && matchesSearch;
            });
            
            if (filtered.length === 0) {
                showToast('No releases found to export');
                return;
            }
            
            // CSV columns header & escape formatting
            const headers = ['Date', 'Category', 'Link', 'Update Details'];
            const rows = filtered.map(item => [
                item.date,
                item.type,
                item.link,
                item.content_text
            ]);
            
            const csvContent = [
                headers.join(','),
                ...rows.map(row => row.map(val => `"${(val || '').replace(/"/g, '""')}"`).join(','))
            ].join('\n');
            
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `bigquery_releases_${activeFilter}_${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            showToast(`Exported ${filtered.length} updates to CSV`);
        });
    }

    // -----------------------------------------------------------------
    // App Initialization
    // -----------------------------------------------------------------
    fetchReleases();
});
