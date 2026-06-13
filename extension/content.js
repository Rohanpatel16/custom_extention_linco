/**
 * Linco — LinkedIn Profile Content Script v2
 *
 * Root cause of v1 failure:
 *  - LinkedIn is a React Server Component (RSC) app.
 *  - The static HTML only contains the profile card (name, headline, location).
 *  - Experience, Education, About, Skills, Interests load via separate XHR/RSC
 *    calls AFTER React hydrates — typically 1-3 seconds after DOMContentLoaded.
 *  - LinkedIn uses obfuscated class names that change with deployments.
 *    NEVER rely on class selectors alone.
 *
 * Strategy v2:
 *  1. Profile card: use stable aria-label="<name>" div + known p tag order.
 *  2. Sections: locate by HEADING TEXT ("Experience", "Education", etc.) since
 *     the visible text is stable even when class names aren't.
 *  3. Wait: Use MutationObserver to detect when sections are injected.
 *  4. Fallback: Also parse window.__como_rehydration__ RSC payload for raw text.
 */

// ─── Constants ────────────────────────────────────────────────────────────────
const WAIT_TIMEOUT_MS = 8000;   // Give LinkedIn 8s to render sections
const SECTION_NAMES = [
  'About', 'Experience', 'Education', 'Featured', 'Skills', 'Interests', 'Activity',
  'Licenses & certifications', 'Volunteer Experience', 'Publications',
  'Honors & awards', 'Languages', 'Projects'
];

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Get trimmed text from first matching selector, or null */
function getElementText(el) {
  if (!el) return '';
  return (el.innerText || el.textContent || '').trim();
}

/** Get trimmed text from first matching selector, or null */
function getText(root, selector) {
  const el = root.querySelector(selector);
  return el ? getElementText(el) : null;
}

/** Walk DOM tree returning all text nodes whose trimmed content matches test */
function findByText(root, tagNames, testFn) {
  const results = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (tagNames.includes(node.tagName.toLowerCase())) {
      const t = getElementText(node);
      if (t && testFn(t)) results.push(node);
    }
    node = walker.nextNode();
  }
  return results;
}

/**
 * Find a profile section container by its visible heading text.
 * LinkedIn renders section headers as a heading element (h2/h3) or as a
 * prominent text element near the top of a card. We walk up from the
 * heading to find the enclosing card/section container.
 */
function findSectionByHeading(headingText) {
  // Walk all elements to find one whose direct text matches headingText
  const headingElements = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, span, p, div'));
  for (const el of headingElements) {
    if (el.children.length > 2) continue; // Heading is usually a leaf node
    const text = getElementText(el);
    if (text === headingText) {
      // 1. Walk up to the closest <section> element or artdeco-card container
      const section = el.closest('section, .artdeco-card, [data-member-relationship]');
      if (section) return section;

      // 2. Fallback: walk up parent tree up to 10 levels
      let parent = el.parentElement;
      for (let i = 0; i < 10 && parent; i++) {
        const tagName = parent.tagName.toLowerCase();
        if (tagName === 'section' || parent.classList.contains('artdeco-card') || parent.hasAttribute('componentkey')) {
          return parent;
        }
        // General backup container check
        if (parent.offsetHeight > 100 || parent.querySelectorAll('[componentkey*="item"]').length > 0) {
          return parent;
        }
        parent = parent.parentElement;
      }
    }
  }
  return null;
}

// ─── Profile Card Extraction ──────────────────────────────────────────────────

/**
 * Extract name, headline, location, followers from the initial rendered card.
 * Uses aria-label for stability since class names are obfuscated.
 */
function extractProfileCard() {
  const result = {
    name: null,
    headline: null,
    location: null,
    followers: null,
    connections: null,
    mutualConnections: null,
    profilePhoto: null,
    url: window.location.href,
    extractedAt: new Date().toISOString()
  };

  // ── Name: clean document.title or scan elements ──────────────────────────
  let cleanName = document.title.replace(/^\(\d+\+?\)\s*/, '').replace(/\| LinkedIn/i, '').replace(/- LinkedIn/i, '').trim();
  if (cleanName && cleanName.length > 2 && cleanName.length < 60) {
    result.name = cleanName;
  }

  // Fallbacks for Name
  const allDivs = document.querySelectorAll('div[aria-label]');
  for (const d of allDivs) {
    const label = d.getAttribute('aria-label');
    if (label && label.length > 2 && label.length < 60 && !label.includes(',')) {
      const text = getElementText(d);
      if (text && text.startsWith(label)) {
        result.name = label;
        break;
      }
    }
  }

  if (!result.name) {
    const h2s = document.querySelectorAll('h2');
    for (const h2 of h2s) {
      const t = getElementText(h2);
      if (t && t.length > 2 && t.length < 60 && !t.includes('Ad') && !t.includes('Premium')) {
        result.name = t;
        break;
      }
    }
  }

  // ── Headline: first p tag after name, or search common classes ───────────
  const allP = document.querySelectorAll('p');
  let nameIdx = -1;
  for (let i = 0; i < allP.length; i++) {
    if (getElementText(allP[i]) === result.name) {
      nameIdx = i;
      break;
    }
  }
  if (nameIdx !== -1 && allP[nameIdx + 1]) {
    result.headline = getElementText(allP[nameIdx + 1]) || null;
  }

  // Fallback Headline selectors
  if (!result.headline) {
    const headlineEl = document.querySelector('.text-body-medium, [class*="text-body-medium"]');
    if (headlineEl) result.headline = getElementText(headlineEl);
  }

  // ── Location: search around name, or look for specific text pattern ────────
  if (nameIdx !== -1) {
    for (let i = nameIdx + 2; i < Math.min(nameIdx + 8, allP.length); i++) {
      const t = getElementText(allP[i]);
      if (t && (t.includes(',') || /[A-Z][a-z]+ [A-Z][a-z]+/.test(t)) &&
          !t.includes('·') && !t.includes('follower') && !t.includes('http') &&
          !t.includes('University') && !t.includes('Foundation') &&
          t.length < 100) {
        result.location = t;
        break;
      }
    }
  }

  // ── Followers ─────────────────────────────────────────────────────────────
  for (const p of allP) {
    const t = getElementText(p);
    if (t && /[\d,.\s]+[KMB]?\s*followers?/i.test(t)) {
      const m = t.match(/([\d,.\s]+[KMB]?)\s*followers?/i);
      if (m) result.followers = m[1].trim();
      break;
    }
  }

  // ── Connections ───────────────────────────────────────────────────────────
  for (const p of allP) {
    const t = getElementText(p);
    if (t && /[\d,.\s]+\+?\s*connections?/i.test(t)) {
      const m = t.match(/([\d,.\s]+\+?)\s*connections?/i);
      if (m) result.connections = m[1].trim();
      break;
    }
  }

  // ── Mutual Connections ────────────────────────────────────────────────────
  for (const el of document.querySelectorAll('span, p, a')) {
    const t = getElementText(el);
    if (t && /\d+\s*mutual\s*connections?/i.test(t)) {
      const m = t.match(/(\d+)\s*mutual\s*connections?/i);
      if (m) result.mutualConnections = parseInt(m[1], 10);
      break;
    }
  }

  // ── Profile Photo ────────────────────────────────────────────────────────
  const photoSelectors = [
    'img.pv-top-card-profile-picture__image',
    'img[class*="profile-photo"]',
    'img[class*="pv-top-card"][class*="photo"]',
    'img[width="200"]',
    'img[width="160"]',
  ];
  for (const sel of photoSelectors) {
    const img = document.querySelector(sel);
    if (img && img.src && !img.src.includes('ghost') && !img.src.includes('default')) {
      result.profilePhoto = img.src;
      break;
    }
  }
  // Fallback: find large profile images near the top of the page
  if (!result.profilePhoto) {
    const allImgs = document.querySelectorAll('img[src*="profile-displayphoto"], img[src*="media.licdn"]');
    for (const img of allImgs) {
      if (img.width >= 100 && img.height >= 100 && img.src) {
        result.profilePhoto = img.src;
        break;
      }
    }
  }

  return result;
}

// ─── Section Content Extraction ───────────────────────────────────────────────

/**
 * Extract all visible list items within a section container.
 * LinkedIn renders each experience/education item as an <li> inside the section.
 * We collect all text from each <li> and parse it.
 */
function extractSectionItems(sectionContainer) {
  if (!sectionContainer) return [];
  const items = [];
  
  // Look for: list items, component items, or custom collection items
  const itemEls = Array.from(sectionContainer.querySelectorAll(
    'li, [componentkey*="entity-collection-item"], [componentkey*="entity-item"], [class*="entity-collection-item"]'
  ));

  // Filter out any nested item elements to keep only top-level list items
  const uniqueItemEls = itemEls.filter(el => {
    return !itemEls.some(otherEl => otherEl !== el && otherEl.contains(el));
  });

  uniqueItemEls.forEach(item => {
    // Collect all paragraph texts inside the item
    const ps = item.querySelectorAll('p');
    const texts = [];
    for (const p of ps) {
      const t = getElementText(p);
      if (t && !texts.includes(t)) texts.push(t);
    }

    // Also get span text not covered by p tags
    const spans = item.querySelectorAll('span[aria-hidden="true"], span:not([class])');
    for (const s of spans) {
      const t = getElementText(s);
      if (s.children.length === 0 && t && !texts.includes(t) && t.length > 1) {
        texts.push(t);
      }
    }

    // Fallback: direct text if nothing else was gathered
    if (texts.length === 0) {
      const directText = getElementText(item);
      if (directText) texts.push(directText);
    }

    // Clean up texts: filter out logo alt text references and UI actions
    const filteredTexts = [];
    for (const t of texts) {
      const clean = t.trim();
      if (!clean) continue;
      if (/logo$/i.test(clean)) continue; // e.g. "Gates Foundation logo"
      if (/^(see more|show all|show details|show more|view profile|connect)/i.test(clean)) continue;
      filteredTexts.push(clean);
    }

    if (filteredTexts.length > 0) {
      items.push(filteredTexts);
    }
  });

  return items;
}

/**
 * Extract plain text content of a section (for About, which is a block of text).
 */
function extractSectionText(sectionContainer) {
  if (!sectionContainer) return null;

  // Look for elements with class inline-show-more-text (dynamic About containers)
  const textContainers = sectionContainer.querySelectorAll('.inline-show-more-text, [class*="inline-show-more-text"]');
  if (textContainers.length > 0) {
    const t = getElementText(textContainers[0]);
    if (t) return t.replace(/\s*see more\s*$/i, '').trim();
  }

  // Fallback 1: gather all paragraphs and join them
  const ps = sectionContainer.querySelectorAll('p');
  if (ps.length > 0) {
    const textParts = [];
    ps.forEach(p => {
      const t = getElementText(p);
      if (t && t !== 'About' && !t.startsWith('Show all') && !/see more/i.test(t)) {
        textParts.push(t);
      }
    });
    if (textParts.length > 0) {
      return textParts.join('\n\n');
    }
  }

  // Fallback 2: find longest text element
  let longest = '';
  const candidates = sectionContainer.querySelectorAll('p, span');
  for (const c of candidates) {
    const style = window.getComputedStyle(c);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const t = getElementText(c);
    if (t && t.length > longest.length && t !== 'About' && !t.startsWith('Show all') && !t.startsWith('see more')) {
      longest = t;
    }
  }
  return longest || null;
}

// ─── RSC Payload Fallback ────────────────────────────────────────────────────

/**
 * Parse window.__como_rehydration__ to extract profile strings.
 * LinkedIn puts the RSC payload in this array as JSON-encoded strings.
 * We collect all unique meaningful strings from it.
 */
function extractFromRSC() {
  const strings = [];
  try {
    const rehydration = window.__como_rehydration__;
    if (!rehydration) return strings;

    const raw = JSON.stringify(rehydration);
    // Find all quoted strings of length 5-300 chars
    const matches = raw.matchAll(/"([^"]{5,300})"/g);
    for (const m of matches) {
      const s = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      // Filter for human-readable content
      if (!/^[A-Za-z0-9+/=]{20,}$/.test(s) && // not base64
          !/https?:\/\//.test(s) && // not URLs
          !/^[_a-z0-9]+ [_a-z0-9]+/.test(s) && // not CSS class lists
          !/proto\./.test(s) && // not protobuf type names
          !/com\.linkedin\./.test(s)) { // not component IDs
        strings.push(s);
      }
    }
  } catch (e) {
    // Ignore
  }
  return strings;
}

// ─── Main Scraper ────────────────────────────────────────────────────────────

function scrapeProfile() {
  const profileData = extractProfileCard();

  // Extract each named section
  const sectionData = {};
  for (const name of SECTION_NAMES) {
    const container = findSectionByHeading(name);
    sectionData[name] = container;
  }

  // About section
  if (sectionData['About']) {
    profileData.about = extractSectionText(sectionData['About']);
  }

  // Experience
  profileData.experience = [];
  if (sectionData['Experience']) {
    const items = extractSectionItems(sectionData['Experience']);
    items.forEach(cleanTexts => {
      if (cleanTexts.length === 0) return;

      const dateRegex = /(Present|\d{4}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|yr|mo|mos|yrs|·)/i;
      const dateIndices = [];
      for (let i = 0; i < cleanTexts.length; i++) {
        if (dateRegex.test(cleanTexts[i])) {
          dateIndices.push(i);
        }
      }

      if (dateIndices.length >= 2) {
        // Multi-role experience: Company is index 0
        const company = cleanTexts[0];
        // The first date might be a summary date range at index 1 (like "Full-time · 31 yrs")
        let startIndex = dateRegex.test(cleanTexts[1]) ? 2 : 1;

        let currentRole = null;
        for (let i = startIndex; i < cleanTexts.length; i++) {
          const txt = cleanTexts[i];
          if (dateRegex.test(txt)) {
            if (currentRole) {
              currentRole.dates = txt;
            }
          } else {
            if (!currentRole || currentRole.dates) {
              if (currentRole) {
                profileData.experience.push({
                  title: currentRole.title,
                  company: currentRole.company,
                  dates: currentRole.dates,
                  description: currentRole.description.join(' ') || null
                });
              }
              currentRole = { title: txt, company: company, dates: null, description: [] };
            } else {
              currentRole.description.push(txt);
            }
          }
        }
        if (currentRole) {
          profileData.experience.push({
            title: currentRole.title,
            company: currentRole.company,
            dates: currentRole.dates,
            description: currentRole.description.join(' ') || null
          });
        }
      } else {
        // Single-role experience
        profileData.experience.push({
          title: cleanTexts[0] || null,
          company: cleanTexts[1] || null,
          dates: cleanTexts[2] || null,
          description: cleanTexts.slice(3).join(' ') || null
        });
      }
    });
  }

  // Education
  profileData.education = [];
  if (sectionData['Education']) {
    const items = extractSectionItems(sectionData['Education']);
    items.forEach(texts => {
      if (texts.length >= 1) {
        let school = texts[0] || null;
        let degree = null;
        let years = null;

        if (texts.length === 2) {
          const second = texts[1];
          if (/(\d{4})/.test(second)) {
            years = second;
          } else {
            degree = second;
          }
        } else if (texts.length >= 3) {
          degree = texts[1] || null;
          years = texts[2] || null;
        }

        profileData.education.push({ school, degree, years });
      }
    });
  }

  // Featured
  profileData.featured = [];
  if (sectionData['Featured']) {
    const items = extractSectionItems(sectionData['Featured']);
    items.forEach(texts => {
      if (texts.length >= 1) {
        profileData.featured.push({ title: texts[0], subtitle: texts[1] || null });
      }
    });
  }

  // Skills
  profileData.skills = [];
  if (sectionData['Skills']) {
    const items = extractSectionItems(sectionData['Skills']);
    items.forEach(texts => {
      if (texts[0]) profileData.skills.push(texts[0]);
    });
  }

  // Interests
  profileData.interests = [];
  if (sectionData['Interests']) {
    const items = extractSectionItems(sectionData['Interests']);
    items.forEach(texts => {
      if (texts[0]) profileData.interests.push(texts[0]);
    });
  }

  // Activity
  profileData.activity = [];
  if (sectionData['Activity']) {
    const items = extractSectionItems(sectionData['Activity']);
    items.forEach(cleanTexts => {
      if (cleanTexts.length === 0) return;

      let isRepost = false;
      let headerText = '';
      let textStartIndex = 0;

      // Scan first few strings for a repost indicator
      for (let i = 0; i < Math.min(cleanTexts.length, 3); i++) {
        const txt = cleanTexts[i];
        if (/(reposted|shared|commented on) this/i.test(txt)) {
          isRepost = true;
          headerText = txt;
          textStartIndex = i + 1;
          break;
        }
      }

      // Fallback: use first string as header if no explicit action found
      if (!isRepost && cleanTexts.length > 0) {
        headerText = cleanTexts[0];
        textStartIndex = 1;
      }

      const textContent = cleanTexts.slice(textStartIndex).join('\n');
      profileData.activity.push({
        header: headerText || null,
        isRepost,
        text: textContent || null
      });
    });
  }

  // ── New sections: Certifications, Volunteering, Publications, Honors, Languages, Projects ──

  // Licenses & Certifications
  profileData.certifications = [];
  if (sectionData['Licenses & certifications']) {
    const items = extractSectionItems(sectionData['Licenses & certifications']);
    items.forEach(texts => {
      if (texts.length >= 1) {
        profileData.certifications.push({
          name: texts[0] || null,
          issuer: texts[1] || null,
          date: texts[2] || null
        });
      }
    });
  }

  // Volunteer Experience
  profileData.volunteering = [];
  if (sectionData['Volunteer Experience']) {
    const items = extractSectionItems(sectionData['Volunteer Experience']);
    items.forEach(texts => {
      if (texts.length >= 1) {
        profileData.volunteering.push({
          role: texts[0] || null,
          organization: texts[1] || null,
          dates: texts[2] || null,
          description: texts.slice(3).join(' ') || null
        });
      }
    });
  }

  // Publications
  profileData.publications = [];
  if (sectionData['Publications']) {
    const items = extractSectionItems(sectionData['Publications']);
    items.forEach(texts => {
      if (texts.length >= 1) {
        profileData.publications.push({
          title: texts[0] || null,
          publisher: texts[1] || null,
          date: texts[2] || null,
          description: texts.slice(3).join(' ') || null
        });
      }
    });
  }

  // Honors & Awards
  profileData.honors = [];
  if (sectionData['Honors & awards']) {
    const items = extractSectionItems(sectionData['Honors & awards']);
    items.forEach(texts => {
      if (texts.length >= 1) {
        profileData.honors.push({
          title: texts[0] || null,
          issuer: texts[1] || null,
          date: texts[2] || null
        });
      }
    });
  }

  // Languages
  profileData.languages = [];
  if (sectionData['Languages']) {
    const items = extractSectionItems(sectionData['Languages']);
    items.forEach(texts => {
      if (texts.length >= 1) {
        profileData.languages.push({
          language: texts[0] || null,
          proficiency: texts[1] || null
        });
      }
    });
  }

  // Projects
  profileData.projects = [];
  if (sectionData['Projects']) {
    const items = extractSectionItems(sectionData['Projects']);
    items.forEach(texts => {
      if (texts.length >= 1) {
        profileData.projects.push({
          name: texts[0] || null,
          dates: texts[1] || null,
          description: texts.slice(2).join(' ') || null
        });
      }
    });
  }

  // Count how many sections we found
  const sectionsFound = SECTION_NAMES.filter(n => sectionData[n]).length;
  profileData._sectionsFound = sectionsFound;
  profileData._sectionsLoaded = Object.fromEntries(
    SECTION_NAMES.map(n => [n, !!sectionData[n]])
  );

  return profileData;
}

// ─── Wait for sections to render ──────────────────────────────────────────────

/**
 * Wait until at least one non-card section (About/Experience/Education) is
 * visible in the DOM, then resolve. Times out after WAIT_TIMEOUT_MS.
 */
function waitForSections() {
  return new Promise((resolve) => {
    // Check immediately first
    const check = () => {
      // LinkedIn renders sections lazily. We detect their presence by
      // looking for any of our section heading texts in the page.
      for (const name of ['About', 'Experience', 'Education']) {
        const section = findSectionByHeading(name);
        if (section) return true;
      }
      return false;
    };

    if (check()) {
      resolve();
      return;
    }

    // Watch for DOM changes
    const observer = new MutationObserver(() => {
      if (check()) {
        observer.disconnect();
        clearTimeout(timer);
        resolve();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Timeout fallback — extract whatever we have
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve();
    }, WAIT_TIMEOUT_MS);
  });
}

// ─── Message Listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractProfile') {
    waitForSections()
      .then(() => {
        try {
          const data = scrapeProfile();
          sendResponse({ success: true, data });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      });
    return true; // Keep message channel open for async
  }
});

// ─── Messaging Popup Integration (Linco v2 Prototype) ──────────────────────

function initMessagingIntegration() {
  console.log('[Linco] Initializing messaging integration observer...', {
    url: window.location.href,
    isTopFrame: window.parent === window,
    documentTitle: document.title,
    hasBody: !!document.body
  });

  // Periodic check as a backup and initial run
  setInterval(checkAndInjectButtons, 1000);

  // Mutation observer for real-time injection
  const observer = new MutationObserver((mutations) => {
    let shouldCheck = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldCheck = true;
        break;
      }
    }
    if (shouldCheck) {
      checkAndInjectButtons();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// Deep DOM Query Helpers (traverses Same-Origin Iframes)
function querySelectorAllDeep(selector, root = document) {
  if (!root) return [];
  let elements = Array.from(root.querySelectorAll(selector));

  // Traverse Same-Origin Iframes
  try {
    const iframes = root.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        if (iframe.contentDocument) {
          elements = elements.concat(querySelectorAllDeep(selector, iframe.contentDocument));
        }
      } catch (e) {}
    }
  } catch (e) {}

  return elements;
}

let diagnosticRunCount = 0;

function checkAndInjectButtons() {
  diagnosticRunCount++;
  
  const currentUrl = window.location.href;
  const isTop = window.parent === window;

  if (diagnosticRunCount % 5 === 0) {
    // Collect all iframe details on page
    const iframesInfo = [];
    try {
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach((iframe, i) => {
        let isSameOrigin = false;
        let iframeUrl = '';
        try {
          if (iframe.contentDocument) {
            isSameOrigin = true;
            iframeUrl = iframe.contentWindow.location.href;
          }
        } catch (e) {
          iframeUrl = iframe.src || 'cross-origin';
        }
        iframesInfo.push({
          index: i,
          id: iframe.id || 'no-id',
          className: iframe.className || 'no-class',
          src: iframeUrl,
          sameOrigin: isSameOrigin
        });
      });
    } catch (e) {}

    // Find all contenteditable elements
    const editablesInfo = [];
    try {
      const editables = querySelectorAllDeep('[contenteditable="true"]');
      editables.forEach((el, i) => {
        editablesInfo.push({
          index: i,
          tagName: el.tagName,
          id: el.id || 'no-id',
          className: el.className || 'no-class',
          ariaLabel: el.getAttribute('aria-label') || 'no-label',
          placeholder: el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || 'no-placeholder'
        });
      });
    } catch (e) {}

    // Find sample elements with msg/convo classes
    const msgClassesInfo = [];
    try {
      const allElements = document.querySelectorAll('*');
      let count = 0;
      for (const el of allElements) {
        const classes = Array.from(el.classList);
        const hasMsgClass = classes.some(c => c.toLowerCase().includes('msg') || c.toLowerCase().includes('convo'));
        if (hasMsgClass && count < 20) {
          msgClassesInfo.push({
            tagName: el.tagName,
            id: el.id || 'no-id',
            className: el.className
          });
          count++;
        }
      }
    } catch (e) {}

    console.log('[Linco] Deep Diagnostics:', {
      url: currentUrl,
      isTopFrame: isTop,
      documentTitle: document.title,
      totalIframes: iframesInfo.length,
      iframes: iframesInfo,
      totalContenteditables: editablesInfo.length,
      editables: editablesInfo,
      sampleMsgElements: msgClassesInfo,
      convoWrappers: querySelectorAllDeep('.msg-convo-wrapper').length,
      msgForms: querySelectorAllDeep('.msg-form').length
    });
  }

  // 1. Find all contenteditable candidates
  const allEditables = querySelectorAllDeep('[contenteditable="true"]');

  // 2. Filter for LinkedIn message composer candidates
  const msgEditors = allEditables.filter(el => {
    // Match by class names
    if (el.classList.contains('msg-form__contenteditable')) return true;

    // Match by aria-label or placeholder
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    const placeholder = (el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || '').toLowerCase();
    if (label.includes('message') || placeholder.includes('message')) return true;
    if (label.includes('write a') || placeholder.includes('write a')) return true;

    // Check parent or grandparent class names
    let parent = el.parentElement;
    for (let i = 0; i < 4 && parent; i++) {
      if (parent.classList.contains('msg-form') || parent.classList.contains('msg-convo-wrapper')) {
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  });

  console.log('[Linco] checkAndInjectButtons tick. Message editors found:', msgEditors.length);

  // 3. Process each editor and inject button
  msgEditors.forEach((editor, idx) => {
    // Find closest container that has the action footer or attachments
    let container = editor.closest('form, .msg-form, .msg-convo-wrapper, [role="dialog"]');
    if (!container) {
      // Fallback: use grandparent
      container = editor.parentElement ? editor.parentElement.parentElement : null;
    }

    if (!container) {
      console.warn(`[Linco] Editor ${idx}: Could not find container for editor!`);
      return;
    }

    // Try to find the left actions attachment tray or footer
    let leftActions = container.querySelector('.msg-form__left-actions');
    let expandBtnWrapper = container.querySelector('.msg-form__expand-btn-wrapper');
    let footer = container.querySelector('.msg-form__footer, footer');

    // Fallback: If not found by class, query for any attachment icon/button container
    if (!leftActions && footer) {
      const buttonContainers = Array.from(footer.querySelectorAll('div, span')).filter(div => {
        return div.querySelectorAll('button, input[type="file"]').length > 0;
      });
      if (buttonContainers.length > 0) {
        buttonContainers.sort((a, b) => {
          const aCount = a.querySelectorAll('button, input[type="file"]').length;
          const bCount = b.querySelectorAll('button, input[type="file"]').length;
          return bCount - aCount;
        });
        leftActions = buttonContainers[0];
      }
    }

    // Fallback 2: Check if there's any file input container or button container inside the entire container
    if (!leftActions) {
      const attachmentDivs = Array.from(container.querySelectorAll('div[class*="attachment"], div[class*="actions"], div[class*="footer"]'));
      if (attachmentDivs.length > 0) {
        leftActions = attachmentDivs[0];
      }
    }

    const targetContainer = leftActions || expandBtnWrapper || editor.parentElement;
    if (!targetContainer) {
      console.warn(`[Linco] Editor ${idx}: Could not find target container for injection!`);
      return;
    }

    // Check if we already injected our button in this target container
    if (targetContainer.querySelector('.linco-inject-btn')) {
      return;
    }

    // Create Linco button
    const lincoBtn = document.createElement('button');
    lincoBtn.type = 'button';
    lincoBtn.className = 'msg-form__footer-action artdeco-button artdeco-button--tertiary artdeco-button--circle artdeco-button--muted m0 artdeco-button--2 linco-inject-btn';
    lincoBtn.title = 'Generate AI Reply (Linco)';
    lincoBtn.innerHTML = '✨';

    // Style the button to match LinkedIn toolbar size and spacing
    if (targetContainer === leftActions || targetContainer.classList.contains('msg-form__left-actions')) {
      Object.assign(lincoBtn.style, {
        fontSize: '16px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        border: 'none',
        background: 'linear-gradient(135deg, #6366f1, #0ea5e9)',
        color: 'white',
        outline: 'none',
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        margin: '0 4px',
        boxShadow: '0 2px 8px rgba(99, 102, 241, 0.4)',
        padding: '0',
        alignSelf: 'center',
        transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s'
      });

      // Add hover/active micro-animations
      lincoBtn.addEventListener('mouseenter', () => {
        lincoBtn.style.transform = 'scale(1.08)';
        lincoBtn.style.boxShadow = '0 4px 12px rgba(99, 102, 241, 0.5)';
      });
      lincoBtn.addEventListener('mouseleave', () => {
        lincoBtn.style.transform = 'scale(1)';
        lincoBtn.style.boxShadow = '0 2px 8px rgba(99, 102, 241, 0.3)';
      });
    } else {
      Object.assign(lincoBtn.style, {
        border: 'none',
        background: 'linear-gradient(135deg, #6366f1, #0ea5e9)',
        color: 'white',
        borderRadius: '50%',
        width: '28px',
        height: '28px',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
        fontSize: '12px',
        outline: 'none',
        transition: 'transform 0.2s, box-shadow 0.2s'
      });

      // Add hover/active micro-animations for the fallback button ONLY
      lincoBtn.addEventListener('mouseenter', () => {
        lincoBtn.style.transform = 'scale(1.1)';
        lincoBtn.style.boxShadow = '0 4px 10px rgba(99, 102, 241, 0.4)';
      });
      lincoBtn.addEventListener('mouseleave', () => {
        lincoBtn.style.transform = 'scale(1)';
        lincoBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.15)';
      });
    }

    // Click handler
    lincoBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleLincoBtnClick(editor, container);
    });

    // Append/Insert
    if (leftActions) {
      leftActions.appendChild(lincoBtn);
      console.log(`[Linco] Editor ${idx}: Injected button into action tray successfully.`);
    } else if (expandBtnWrapper) {
      expandBtnWrapper.insertBefore(lincoBtn, expandBtnWrapper.firstChild);
      console.log(`[Linco] Editor ${idx}: Injected button into expand wrapper successfully.`);
    } else {
      editor.parentElement.appendChild(lincoBtn);
      console.log(`[Linco] Editor ${idx}: Injected button into editor parent fallback successfully.`);
    }
  });
}

function handleLincoBtnClick(editor, container) {
  // 1. Read API Key & settings from storage
  chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'userName', 'userCompany', 'servicesPitch'], async (settings) => {
    if (!settings.geminiApiKey) {
      alert("Please enter your Gemini API Key in Linco Extension Settings first.");
      return;
    }

    // Find or create approval panel
    let panel = container.querySelector('.linco-approval-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'linco-approval-panel';
      
      panel.innerHTML = `
        <div class="linco-approval-header">
          <div class="linco-logo">
            <div class="linco-logo-icon">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="white"/>
              </svg>
            </div>
            <span class="linco-logo-text">Linco</span>
          </div>
          <button class="linco-close-btn" type="button" title="Close AI Draft">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <textarea class="linco-approval-textarea" placeholder="Generating reply draft..."></textarea>
        <input class="linco-instruction-input" type="text" placeholder="Add custom context / what you want to say..." />
        <div class="linco-approval-btn-container">
          <div class="linco-status-badge">
            <span class="linco-status-dot linco-dot-loading"></span>
            <span class="linco-status-text">Analyzing...</span>
          </div>
          <button class="linco-btn linco-btn-secondary linco-regen-btn" type="button" disabled>Regenerate</button>
          <button class="linco-btn linco-btn-primary linco-approve-btn" type="button" disabled>Approve & Insert</button>
        </div>
      `;
      
      // Position panel inside container (closest positioning parent)
      container.style.position = 'relative';
      container.appendChild(panel);
    }

    // Set dynamic theme class depending on LinkedIn state
    if (isDarkMode()) {
      panel.classList.add('linco-dark-mode');
      panel.classList.remove('linco-light-mode');
    } else {
      panel.classList.add('linco-light-mode');
      panel.classList.remove('linco-dark-mode');
    }

    const textarea = panel.querySelector('.linco-approval-textarea');
    const instructionInput = panel.querySelector('.linco-instruction-input');
    const statusDot = panel.querySelector('.linco-status-dot');
    const statusText = panel.querySelector('.linco-status-text');
    const regenBtn = panel.querySelector('.linco-regen-btn');
    const approveBtn = panel.querySelector('.linco-approve-btn');
    const closeBtn = panel.querySelector('.linco-close-btn');

    // Disable buttons while generating
    regenBtn.disabled = true;
    approveBtn.disabled = true;
    textarea.disabled = true;
    if (instructionInput) instructionInput.disabled = true;
    statusDot.className = 'linco-status-dot linco-dot-loading';
    statusText.textContent = "Extracting...";

    const closePanel = () => {
      panel.remove();
    };

    closeBtn.onclick = (e) => {
      e.preventDefault();
      closePanel();
    };

    const generateDraft = async (customInstruction) => {
      statusDot.className = 'linco-status-dot linco-dot-loading';
      statusText.textContent = "Generating...";
      regenBtn.disabled = true;
      approveBtn.disabled = true;
      textarea.disabled = true;
      if (instructionInput) instructionInput.disabled = true;
      textarea.placeholder = "Generating reply draft...";

      try {
        const history = getChatHistory(container);
        let chatHistoryText = '';
        history.forEach(h => {
          chatHistoryText += `[${h.timestamp}] ${h.sender}: ${h.text}\n`;
        });

        let titleEl = container.querySelector('.msg-overlay-bubble-header__title a span, .msg-thread__link span');
        if (!titleEl) {
          const commonParent = container.closest('.msg-overlay-conversation-bubble, .msg-thread, .messaging-thread-layout');
          if (commonParent) {
            titleEl = commonParent.querySelector('.msg-overlay-bubble-header__title a span, .msg-entity-lockup__title');
          }
        }
        if (!titleEl) {
          titleEl = document.querySelector('.msg-thread__title, .msg-entity-lockup__title');
        }
        const leadName = titleEl ? titleEl.innerText.trim() : "this connection";

        const prompt = `You are an elite, human-like sales professional drafting a reply in a LinkedIn chat thread.
Your goal is to write a warm, brief, and contextually relevant reply that continues the conversation naturally.

[SENDER PROFILE (YOU)]
- Name: ${settings.userName || 'Representative'}
- Company: ${settings.userCompany || 'our company'}
- Offer/Services: ${settings.servicesPitch || 'business collaboration'}

[RECIPIENT PROFILE]
- Name: ${leadName}

[CHAT HISTORY]
${chatHistoryText || '(No history yet)'}
${customInstruction ? `\n[USER DIRECTION / CONTEXT]\n- ${customInstruction}\n` : ''}
[DIRECTIVES]
1. STYLE: Speak conversationally, exactly as a human typing in a chat window. 
2. FORMAT: 
   - Start directly (e.g., "Hi ${leadName.split(' ')[0]}," or respond to their last point).
   - Write ONLY the message content itself.
   - NO subject lines, NO email sign-offs (like "Best regards", "Sincerely"), NO signature blocks (like "[My Name] | [My Title]").
3. LENGTH: Keep it between 1 to 3 short sentences.
4. CALL TO ACTION: If appropriate, end with a low-friction, conversational next step.

[EXAMPLES]
Input History:
[5:54 PM] Lead: "Sounds interesting"
Instruction: "ask if they want a short call on Tuesday"
Output: "Great. Do you have 10 minutes for a quick call this coming Tuesday afternoon?"

Input History:
[2:30 PM] Lead: "Yes, we are currently hiring designers."
Instruction: "offer help with our styling staffing service"
Output: "Awesome. We have a few vetted UX designers ready to start. Would you be open to seeing a couple of portfolios?"
`;

        const model = settings.geminiModel || 'gemma-4-31b-it';
        const draft = await callGeminiAPI(settings.geminiApiKey, model, prompt);
        
        textarea.value = draft.trim();
        textarea.disabled = false;
        if (instructionInput) {
          instructionInput.disabled = false;
        }
        statusDot.className = 'linco-status-dot linco-dot-success';
        statusText.textContent = "Draft ready.";
        regenBtn.disabled = false;
        approveBtn.disabled = false;
      } catch (err) {
        console.error('[Linco] Generation failed:', err);
        textarea.value = '';
        textarea.placeholder = `Failed to generate: ${err.message}`;
        statusDot.className = 'linco-status-dot linco-dot-error';
        statusText.textContent = "Error.";
        regenBtn.disabled = false;
        if (instructionInput) instructionInput.disabled = false;
      }
    };

    approveBtn.onclick = (e) => {
      e.preventDefault();
      const finalReply = textarea.value.trim();
      if (!finalReply) return;

      // Ingress text to LinkedIn
      editor.focus();
      editor.innerHTML = `<p>${finalReply}</p>`;

      // Hide LinkedIn placeholder
      let placeholder = container.querySelector('.msg-form__placeholder');
      if (!placeholder) {
        placeholder = Array.from(container.querySelectorAll('div, span')).find(el => {
          const txt = (el.textContent || '').trim();
          const pText = el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || '';
          return txt.includes('Write a message') || pText.includes('Write a message');
        });
      }
      if (placeholder) {
        placeholder.style.display = 'none';
        placeholder.classList.add('is-hidden');
      }

      triggerInputEvents(editor);
      closePanel();
    };

    regenBtn.onclick = (e) => {
      e.preventDefault();
      const customInstruction = instructionInput ? instructionInput.value.trim() : '';
      generateDraft(customInstruction);
    };

    // Start generation
    generateDraft();
  });
}

function triggerInputEvents(element) {
  // 1. Dispatch beforeinput event
  const beforeInputEvent = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: element.textContent
  });
  element.dispatchEvent(beforeInputEvent);

  // 2. Dispatch input event
  const inputEvent = new Event('input', {
    bubbles: true,
    cancelable: true
  });
  element.dispatchEvent(inputEvent);

  // 3. Dispatch change event
  const changeEvent = new Event('change', {
    bubbles: true,
    cancelable: true
  });
  element.dispatchEvent(changeEvent);

  // 4. Dispatch keydown/keyup events as a backup for text listeners
  const keydownEvent = new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  });
  element.dispatchEvent(keydownEvent);

  const keyupEvent = new KeyboardEvent('keyup', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  });
  element.dispatchEvent(keyupEvent);
}

function isDarkMode() {
  return document.documentElement.classList.contains('theme--dark') || 
         document.documentElement.getAttribute('data-theme') === 'dark' ||
         window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function getChatHistory(container) {
  // Try to find the message list container
  let listContainer = container.querySelector('ul.msg-s-message-list-content, .msg-s-message-list');
  
  // If not found in the container, walk up to search in a common parent
  if (!listContainer) {
    const commonParent = container.closest('.msg-overlay-conversation-bubble__content-wrapper, .msg-thread, .messaging-thread-layout, [role="main"]');
    if (commonParent) {
      listContainer = commonParent.querySelector('ul.msg-s-message-list-content, .msg-s-message-list');
    }
  }

  // If still not found, search globally in the document (especially for full-screen messages)
  if (!listContainer) {
    listContainer = document.querySelector('ul.msg-s-message-list-content, .msg-s-message-list');
  }

  if (!listContainer) {
    console.warn('[Linco] Could not find message list container.');
    return [];
  }

  const messageItems = listContainer.querySelectorAll('li.msg-s-message-list__event');
  const chatHistory = [];

  messageItems.forEach(item => {
    const senderNameEl = item.querySelector('.msg-s-message-group__name');
    const timestampEl = item.querySelector('.msg-s-message-group__timestamp');
    const sender = senderNameEl ? senderNameEl.innerText.trim() : "Connection";
    const timestamp = timestampEl ? timestampEl.innerText.trim() : "Unknown";

    const messageBodies = item.querySelectorAll('p.msg-s-event-listitem__body');
    messageBodies.forEach(p => {
      chatHistory.push({
        sender: sender,
        timestamp: timestamp,
        text: p.innerText.trim()
      });
    });
  });
  
  return chatHistory.slice(-8);
}

async function callGeminiAPI(apiKey, model, promptText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  const config = {};
  if (model === 'gemini-3.1-flash-lite') {
    config.thinkingConfig = {
      thinkingLevel: 'LOW',
    };
  } else if (model === 'gemma-4-26b-a4b-it' || model === 'gemma-4-31b-it') {
    config.thinkingConfig = {
      thinkingLevel: 'MINIMAL',
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: promptText
        }]
      }],
      generationConfig: config
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    let parsedErr;
    try {
      parsedErr = JSON.parse(errText);
    } catch(e) {}
    throw new Error(parsedErr?.error?.message || `HTTP ${response.status}: ${errText}`);
  }

  const resData = await response.json();
  const candidates = resData.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error("API returned no response candidates.");
  }
  
  const content = candidates[0].content;
  if (!content || !content.parts || content.parts.length === 0) {
    throw new Error("No parts in candidates response.");
  }

  const textParts = content.parts
    .filter(part => !part.thought)
    .map(part => part.text)
    .join('');
  
  if (!textParts) {
    return content.parts[0].text;
  }
  return textParts;
}

// Inject CSS Styles for Linco Approval Box
const lincoStyle = document.createElement('style');
lincoStyle.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@500;600;700;800&display=swap');

  .linco-approval-panel {
    /* Design Tokens (Dark Theme by default) */
    --linco-h: 224;
    --linco-s: 30%;
    
    --linco-bg-base: hsl(var(--linco-h), 30%, 6%);
    --linco-bg-surface: hsl(var(--linco-h), 28%, 10%);
    --linco-bg-card: hsl(var(--linco-h), 25%, 14%);
    --linco-bg-hover: hsl(var(--linco-h), 24%, 18%);
    
    --linco-accent-primary: #6366f1; /* Vibrant Indigo */
    --linco-accent-secondary: #0ea5e9; /* Cyan */
    --linco-accent-glow: rgba(99, 102, 241, 0.3);
    --linco-accent-gradient: linear-gradient(135deg, var(--linco-accent-primary) 0%, var(--linco-accent-secondary) 100%);
    
    --linco-success: #10b981;
    --linco-error: #ef4444;
    --linco-warning: #f59e0b;
    
    --linco-text-primary: hsl(var(--linco-h), 20%, 95%);
    --linco-text-secondary: hsl(var(--linco-h), 15%, 75%);
    --linco-text-muted: hsl(var(--linco-h), 12%, 50%);
    
    --linco-border: rgba(255, 255, 255, 0.08);
    --linco-border-accent: rgba(99, 102, 241, 0.25);
    
    --linco-radius-sm: 8px;
    --linco-radius-md: 12px;
    --linco-radius-lg: 16px;
    
    --linco-font-display: 'Outfit', 'Inter', system-ui, -apple-system, sans-serif;
    --linco-font-body: 'Inter', system-ui, -apple-system, sans-serif;
    
    --linco-transition: 240ms cubic-bezier(0.16, 1, 0.3, 1);
    --linco-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
    --linco-shadow-md: 0 8px 24px rgba(0, 0, 0, 0.4);
    
    /* Input contrast background (defaults to dark base) */
    --linco-input-bg: var(--linco-bg-base);

    /* Positioning and Core Styles */
    position: absolute;
    bottom: 85px;
    left: 8px;
    right: 8px;
    background: radial-gradient(circle at top right, rgba(99, 102, 241, 0.08) 0%, transparent 60%),
                radial-gradient(circle at bottom left, rgba(14, 165, 233, 0.05) 0%, transparent 60%),
                var(--linco-bg-surface) !important;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--linco-border) !important;
    border-radius: var(--linco-radius-lg) !important;
    box-shadow: var(--linco-shadow-md) !important;
    z-index: 10000 !important;
    padding: 14px 16px 16px !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 10px !important;
    font-family: var(--linco-font-body) !important;
    box-sizing: border-box !important;
    animation: linco-slide-up var(--linco-transition) ease-out;
    transition: background var(--linco-transition), border var(--linco-transition), box-shadow var(--linco-transition);
  }
  
  .linco-approval-panel.linco-light-mode {
    /* Light Theme Overrides */
    --linco-bg-base: #f3f4f6;
    --linco-bg-surface: #ffffff;
    --linco-bg-card: #f9fafb;
    --linco-bg-hover: #e5e7eb;
    
    --linco-text-primary: #111827;
    --linco-text-secondary: #4b5563;
    --linco-text-muted: #9ca3af;
    
    --linco-border: rgba(0, 0, 0, 0.08);
    --linco-border-accent: rgba(99, 102, 241, 0.2);
    --linco-accent-glow: rgba(99, 102, 241, 0.15);
    
    --linco-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.05);
    --linco-shadow-md: 0 8px 24px rgba(0, 0, 0, 0.08);
    
    /* Input background in light mode (contrasting light grey) */
    --linco-input-bg: #e5e7eb;
  }
  
  .linco-approval-header {
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    padding-bottom: 8px !important;
    border-bottom: 1px solid var(--linco-border) !important;
    background: transparent !important;
  }
  
  .linco-logo {
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
  }
  
  .linco-logo-icon {
    width: 24px !important;
    height: 24px !important;
    border-radius: 6px !important;
    background: var(--linco-accent-gradient) !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    box-shadow: 0 0 10px var(--linco-accent-glow) !important;
  }
  
  .linco-logo-text {
    font-family: var(--linco-font-display) !important;
    font-size: 15px !important;
    font-weight: 700 !important;
    letter-spacing: -0.02em !important;
    background: var(--linco-accent-gradient) !important;
    -webkit-background-clip: text !important;
    -webkit-text-fill-color: transparent !important;
    background-clip: text !important;
  }
  
  .linco-close-btn {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 24px !important;
    height: 24px !important;
    border-radius: 50% !important;
    border: 1px solid var(--linco-border) !important;
    background: transparent !important;
    color: var(--linco-text-secondary) !important;
    cursor: pointer !important;
    transition: var(--linco-transition) !important;
    padding: 0 !important;
    margin: 0 !important;
    outline: none !important;
  }
  
  .linco-close-btn:hover {
    background: var(--linco-bg-hover) !important;
    color: var(--linco-text-primary) !important;
    border-color: var(--linco-border-accent) !important;
    box-shadow: 0 0 8px var(--linco-accent-glow) !important;
  }
  
  .linco-approval-panel .linco-approval-textarea {
    width: 100% !important;
    height: 90px !important;
    background: var(--linco-input-bg) !important;
    background-color: var(--linco-input-bg) !important;
    border: 1px solid var(--linco-border) !important;
    border-radius: var(--linco-radius-sm) !important;
    padding: 10px 12px !important;
    font-size: 13px !important;
    line-height: 1.5 !important;
    font-family: var(--linco-font-body) !important;
    resize: none !important;
    outline: none !important;
    color: var(--linco-text-primary) !important;
    box-sizing: border-box !important;
    transition: var(--linco-transition) !important;
  }
  
  .linco-approval-panel .linco-approval-textarea:focus,
  .linco-approval-panel .linco-approval-textarea:active {
    background: var(--linco-input-bg) !important;
    background-color: var(--linco-input-bg) !important;
    color: var(--linco-text-primary) !important;
    border-color: var(--linco-border-accent) !important;
    box-shadow: 0 0 0 3px var(--linco-accent-glow) !important;
    outline: none !important;
  }
  
  .linco-approval-panel .linco-approval-textarea:disabled {
    opacity: 0.6 !important;
    cursor: not-allowed !important;
  }
  
  .linco-approval-panel .linco-approval-textarea::placeholder {
    color: var(--linco-text-muted) !important;
  }

  .linco-approval-panel .linco-instruction-input {
    width: 100% !important;
    background: var(--linco-input-bg) !important;
    background-color: var(--linco-input-bg) !important;
    border: 1px solid var(--linco-border) !important;
    border-radius: var(--linco-radius-sm) !important;
    padding: 8px 12px !important;
    font-size: 12px !important;
    font-family: var(--linco-font-body) !important;
    outline: none !important;
    color: var(--linco-text-primary) !important;
    box-sizing: border-box !important;
    transition: var(--linco-transition) !important;
  }
  
  .linco-approval-panel .linco-instruction-input:focus,
  .linco-approval-panel .linco-instruction-input:active {
    background: var(--linco-input-bg) !important;
    background-color: var(--linco-input-bg) !important;
    color: var(--linco-text-primary) !important;
    border-color: var(--linco-border-accent) !important;
    box-shadow: 0 0 0 3px var(--linco-accent-glow) !important;
    outline: none !important;
  }
  
  .linco-approval-panel .linco-instruction-input:disabled {
    opacity: 0.6 !important;
    cursor: not-allowed !important;
  }
  
  .linco-approval-panel .linco-instruction-input::placeholder {
    color: var(--linco-text-muted) !important;
  }
  
  .linco-approval-btn-container {
    display: flex !important;
    justify-content: flex-end !important;
    align-items: center !important;
    gap: 10px !important;
    margin-top: 2px !important;
  }
  
  .linco-status-badge {
    display: flex !important;
    align-items: center !important;
    gap: 6px !important;
    height: 32px !important;
    padding: 0 10px !important;
    background: var(--linco-bg-surface) !important;
    border: 1px solid var(--linco-border) !important;
    border-radius: 99px !important;
    margin-right: auto !important;
    box-sizing: border-box !important;
    transition: var(--linco-transition) !important;
  }
  
  .linco-status-dot {
    width: 6px !important;
    height: 6px !important;
    border-radius: 50% !important;
    flex-shrink: 0 !important;
    transition: var(--linco-transition) !important;
  }
  
  .linco-dot-idle {
    background: var(--linco-text-muted) !important;
  }
  
  .linco-dot-loading {
    background: var(--linco-warning) !important;
    animation: linco-pulse-dot 1s ease-in-out infinite !important;
  }
  
  .linco-dot-success {
    background: var(--linco-success) !important;
    box-shadow: 0 0 6px var(--linco-success) !important;
  }
  
  .linco-dot-error {
    background: var(--linco-error) !important;
    box-shadow: 0 0 6px var(--linco-error) !important;
  }
  
  .linco-status-text {
    font-size: 11px !important;
    font-weight: 600 !important;
    color: var(--linco-text-secondary) !important;
    font-family: var(--linco-font-body) !important;
  }
  
  @keyframes linco-pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: 0.4; transform: scale(0.8); }
  }
  
  .linco-btn {
    height: 32px !important;
    box-sizing: border-box !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    white-space: nowrap !important;
    font-size: 12px !important;
    border-radius: var(--linco-radius-sm) !important;
    cursor: pointer !important;
    transition: var(--linco-transition) !important;
    outline: none !important;
    border: none;
  }
  
  .linco-btn-primary {
    gap: 8px !important;
    padding: 0 14px !important;
    font-family: var(--linco-font-display) !important;
    font-weight: 700 !important;
    color: #ffffff !important;
    background: var(--linco-accent-gradient) !important;
    box-shadow: 0 2px 10px var(--linco-accent-glow) !important;
    position: relative !important;
    overflow: hidden !important;
    border: 1px solid transparent !important;
  }
  
  .linco-btn-primary::before {
    content: '' !important;
    position: absolute !important;
    top: 0 !important;
    left: -100% !important;
    width: 100% !important;
    height: 100% !important;
    background: linear-gradient(
      120deg,
      transparent,
      rgba(255, 255, 255, 0.2),
      transparent
    ) !important;
    transition: all 600ms !important;
  }
  
  .linco-btn-primary:hover:not(:disabled)::before {
    left: 100% !important;
  }
  
  .linco-btn-primary:hover:not(:disabled) {
    transform: translateY(-1px) !important;
    box-shadow: 0 4px 14px rgba(99, 102, 241, 0.45) !important;
  }
  
  .linco-btn-primary:active:not(:disabled) {
    transform: translateY(1px) !important;
  }
  
  .linco-btn-primary:disabled {
    opacity: 0.35 !important;
    cursor: not-allowed !important;
    box-shadow: none !important;
  }
  
  .linco-btn-secondary {
    gap: 8px !important;
    padding: 0 14px !important;
    font-family: var(--linco-font-display) !important;
    font-weight: 700 !important;
    background: rgba(99, 102, 241, 0.08) !important;
    color: var(--linco-accent-primary) !important;
    border: 1px solid rgba(99, 102, 241, 0.3) !important;
    box-shadow: none !important;
  }
  
  .linco-dark-mode .linco-btn-secondary {
    background: rgba(99, 102, 241, 0.15) !important;
    color: var(--linco-text-primary) !important;
    border-color: rgba(99, 102, 241, 0.4) !important;
  }
  
  .linco-btn-secondary:hover:not(:disabled) {
    background: rgba(99, 102, 241, 0.15) !important;
    color: var(--linco-accent-primary) !important;
    border-color: var(--linco-accent-primary) !important;
    transform: translateY(-1px) !important;
  }
  
  .linco-dark-mode .linco-btn-secondary:hover:not(:disabled) {
    background: rgba(99, 102, 241, 0.25) !important;
    color: var(--linco-text-primary) !important;
    border-color: var(--linco-accent-primary) !important;
    transform: translateY(-1px) !important;
  }
  
  .linco-btn-secondary:active:not(:disabled) {
    transform: translateY(1px) !important;
  }
  
  .linco-btn-secondary:disabled {
    opacity: 0.35 !important;
    cursor: not-allowed !important;
    box-shadow: none !important;
    transform: none !important;
  }
  
  .linco-status-msg {
    font-size: 11px;
    color: #666;
    margin-right: auto;
    align-self: center;
  }
  
  .linco-dark-mode .linco-status-msg {
    color: #aaa !important;
  }

  @keyframes linco-slide-up {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;
document.head.appendChild(lincoStyle);

// Start the messaging integration automatically
initMessagingIntegration();



