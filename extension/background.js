/**
 * Linco — Background Service Worker
 * Handles: context menu, keyboard shortcuts, auto-extract on navigate
 */

// ─── Context Menu ────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'linco-extract',
    title: 'Extract with Linco',
    contexts: ['link'],
    targetUrlPatterns: ['https://*.linkedin.com/in/*']
  });

  chrome.contextMenus.create({
    id: 'linco-extract-page',
    title: 'Extract this profile with Linco',
    contexts: ['page'],
    documentUrlPatterns: ['https://*.linkedin.com/in/*']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'linco-extract' && info.linkUrl) {
    // Open the profile in a new tab then trigger extract
    chrome.tabs.create({ url: info.linkUrl }, (newTab) => {
      // Wait for the page to load, then open the popup
      // We can't programmatically open popup, so we inject a notification
      chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
        if (tabId === newTab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          // Set a flag so popup knows to auto-extract
          chrome.storage.local.set({ pendingExtract: true });
          // Show badge to indicate ready
          chrome.action.setBadgeText({ text: '!', tabId: newTab.id });
          chrome.action.setBadgeBackgroundColor({ color: '#7c3aed', tabId: newTab.id });
        }
      });
    });
  }

  if (info.menuItemId === 'linco-extract-page' && tab) {
    chrome.storage.local.set({ pendingExtract: true });
    chrome.action.setBadgeText({ text: '!', tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#7c3aed', tabId: tab.id });
    // Open the popup (user will see the badge and click)
  }
});

// ─── Keyboard Shortcuts ──────────────────────────────────────────────────────

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'extract-profile') {
    // Set flag and flash the badge
    chrome.storage.local.set({ pendingExtract: true });
    if (tab?.id) {
      chrome.action.setBadgeText({ text: '!', tabId: tab.id });
      chrome.action.setBadgeBackgroundColor({ color: '#7c3aed', tabId: tab.id });
    }
    // Open the popup programmatically
    chrome.action.openPopup?.();
  }

  if (command === 'copy-profile') {
    // Inject content script and extract directly, copy to clipboard
    if (tab?.id && tab.url?.includes('linkedin.com/in/')) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      }).catch(() => {}).then(() => {
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, { action: 'extractProfile' }, (response) => {
            if (response?.success) {
              // Store the data for next popup open
              chrome.storage.local.set({
                lastExtraction: response.data,
                pendingExtract: false
              });
              chrome.action.setBadgeText({ text: '✓', tabId: tab.id });
              chrome.action.setBadgeBackgroundColor({ color: '#10b981', tabId: tab.id });
              setTimeout(() => {
                chrome.action.setBadgeText({ text: '', tabId: tab.id });
              }, 3000);
            }
          });
        }, 200);
      });
    }
  }
});

// ─── Auto-Extract on Navigate ────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !tab.url.includes('linkedin.com/in/')) return;

  // Check if auto-extract is enabled
  chrome.storage.local.get(['autoExtract'], (result) => {
    if (!result.autoExtract) return;

    // Inject content script and extract
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    }).catch(() => {}).then(() => {
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { action: 'extractProfile' }, (response) => {
          if (chrome.runtime.lastError) return;
          if (response?.success) {
            chrome.storage.local.set({ lastExtraction: response.data });

            // Update badge
            chrome.storage.local.get(['extractionCount'], (r) => {
              const count = (r.extractionCount || 0) + 1;
              chrome.storage.local.set({ extractionCount: count });
              chrome.action.setBadgeText({ text: count.toString() });
              chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' });
            });
          }
        });
      }, 2000); // Wait 2s for LinkedIn sections to hydrate
    });
  });
});
