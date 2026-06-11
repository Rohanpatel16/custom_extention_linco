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
