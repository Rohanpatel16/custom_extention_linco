/**
 * Linco — Popup Orchestrator v2 (ESM/SDK version)
 * Coordinates between the popup UI and the content script.
 * Formats extracted data into clean Markdown.
 * Generates AI-powered connection requests via Gemini SDK.
 */

import { GoogleGenAI, ThinkingLevel } from '@google/genai';

// ─── Markdown Formatter ──────────────────────────────────────────────────────

function toMarkdown(data) {
  const lines = [];
  const now = new Date(data.extractedAt || Date.now()).toLocaleString();

  lines.push(`# ${data.name || 'LinkedIn Profile'}`);
  if (data.headline) lines.push(`\n> ${data.headline}`);
  lines.push('');

  if (data.profilePhoto) lines.push(`![Profile Photo](${data.profilePhoto})`);
  lines.push('');

  const meta = [];
  if (data.location) meta.push(`📍 ${data.location}`);
  if (data.followers) meta.push(`👥 ${data.followers} followers`);
  if (data.connections) meta.push(`🔗 ${data.connections} connections`);
  if (data.mutualConnections) meta.push(`🤝 ${data.mutualConnections} mutual`);
  if (meta.length) lines.push(meta.join('  ·  '));
  if (data.url) lines.push(`\n🔗 [View Profile](${data.url})`);
  lines.push('');
  lines.push(`*Extracted: ${now}*`);
  lines.push('\n---\n');

  if (data.about) {
    lines.push('## About');
    lines.push('');
    lines.push(data.about);
    lines.push('\n---\n');
  }

  if (data.experience && data.experience.length > 0) {
    lines.push('## Experience');
    lines.push('');
    data.experience.forEach(exp => {
      if (exp.title) lines.push(`### ${exp.title}`);
      if (exp.company) lines.push(`**${exp.company}**`);
      if (exp.dates) lines.push(`*${exp.dates}*`);
      if (exp.description) lines.push(`\n${exp.description}`);
      lines.push('');
    });
    lines.push('---\n');
  }

  if (data.education && data.education.length > 0) {
    lines.push('## Education');
    lines.push('');
    data.education.forEach(edu => {
      if (edu.school) lines.push(`### ${edu.school}`);
      if (edu.degree) lines.push(`*${edu.degree}*`);
      if (edu.years) lines.push(`${edu.years}`);
      lines.push('');
    });
    lines.push('---\n');
  }

  if (data.featured && data.featured.length > 0) {
    lines.push('## Featured');
    lines.push('');
    data.featured.forEach(f => {
      if (f.title) lines.push(`- **${f.title}**${f.subtitle ? ` — ${f.subtitle}` : ''}`);
    });
    lines.push('\n---\n');
  }

  if (data.skills && data.skills.length > 0) {
    lines.push('## Skills');
    lines.push('');
    lines.push(data.skills.map(s => `\`${s}\``).join('  '));
    lines.push('\n---\n');
  }

  if (data.certifications && data.certifications.length > 0) {
    lines.push('## Certifications & Licenses');
    lines.push('');
    data.certifications.forEach(c => {
      if (c.name) lines.push(`- **${c.name}**${c.issuer ? ` — ${c.issuer}` : ''}${c.date ? ` (${c.date})` : ''}`);
    });
    lines.push('\n---\n');
  }

  if (data.volunteering && data.volunteering.length > 0) {
    lines.push('## Volunteer Experience');
    lines.push('');
    data.volunteering.forEach(v => {
      if (v.role) lines.push(`### ${v.role}`);
      if (v.organization) lines.push(`**${v.organization}**`);
      if (v.dates) lines.push(`*${v.dates}*`);
      if (v.description) lines.push(`\n${v.description}`);
      lines.push('');
    });
    lines.push('---\n');
  }

  if (data.publications && data.publications.length > 0) {
    lines.push('## Publications');
    lines.push('');
    data.publications.forEach(p => {
      if (p.title) lines.push(`### ${p.title}`);
      if (p.publisher) lines.push(`*${p.publisher}*`);
      if (p.date) lines.push(`${p.date}`);
      if (p.description) lines.push(`\n${p.description}`);
      lines.push('');
    });
    lines.push('---\n');
  }

  if (data.honors && data.honors.length > 0) {
    lines.push('## Honors & Awards');
    lines.push('');
    data.honors.forEach(h => {
      if (h.title) lines.push(`- **${h.title}**${h.issuer ? ` — ${h.issuer}` : ''}${h.date ? ` (${h.date})` : ''}`);
    });
    lines.push('\n---\n');
  }

  if (data.languages && data.languages.length > 0) {
    lines.push('## Languages');
    lines.push('');
    data.languages.forEach(l => {
      if (l.language) lines.push(`- **${l.language}**${l.proficiency ? ` — ${l.proficiency}` : ''}`);
    });
    lines.push('\n---\n');
  }

  if (data.projects && data.projects.length > 0) {
    lines.push('## Projects');
    lines.push('');
    data.projects.forEach(p => {
      if (p.name) lines.push(`### ${p.name}`);
      if (p.dates) lines.push(`*${p.dates}*`);
      if (p.description) lines.push(`\n${p.description}`);
      lines.push('');
    });
    lines.push('---\n');
  }

  if (data.interests && data.interests.length > 0) {
    lines.push('## Interests');
    lines.push('');
    data.interests.forEach(i => lines.push(`- ${i}`));
    lines.push('');
  }

  if (data.activity && data.activity.length > 0) {
    lines.push('## Recent Activity');
    lines.push('');
    data.activity.forEach(act => {
      const emoji = act.isRepost ? '🔁' : '📝';
      const typeStr = act.isRepost ? 'Reposted' : 'Post';
      if (act.header) {
        lines.push(`### ${emoji} ${typeStr}: *${act.header}*`);
      } else {
        lines.push(`### ${emoji} ${typeStr}`);
      }
      if (act.text) {
        const blockedText = act.text.split('\n').map(line => `> ${line}`).join('\n');
        lines.push(blockedText);
      }
      lines.push('');
    });
    lines.push('---\n');
  }

  return lines.join('\n');
}

// ─── Export Helpers ───────────────────────────────────────────────────────────

function exportJSON() {
  if (!currentProfileData) return;
  const json = JSON.stringify(currentProfileData, null, 2);
  downloadFile(json, `${slugify(currentProfileData.name)}_profile.json`, 'application/json');
}

function exportCSV() {
  if (!currentProfileData) return;
  const d = currentProfileData;
  const rows = [
    ['Field', 'Value'],
    ['Name', d.name || ''],
    ['Headline', d.headline || ''],
    ['Location', d.location || ''],
    ['Followers', d.followers || ''],
    ['Connections', d.connections || ''],
    ['Mutual Connections', d.mutualConnections || ''],
    ['Profile URL', d.url || ''],
    ['Profile Photo', d.profilePhoto || ''],
    ['About', (d.about || '').replace(/\n/g, ' ')],
  ];

  if (d.experience) {
    d.experience.forEach((exp, i) => {
      rows.push([`Experience ${i + 1}`, `${exp.title || ''} at ${exp.company || ''} (${exp.dates || ''})`]);
    });
  }
  if (d.education) {
    d.education.forEach((edu, i) => {
      rows.push([`Education ${i + 1}`, `${edu.school || ''} — ${edu.degree || ''} (${edu.years || ''})`]);
    });
  }
  if (d.skills && d.skills.length > 0) {
    rows.push(['Skills', d.skills.join(', ')]);
  }
  if (d.certifications) {
    d.certifications.forEach((c, i) => {
      rows.push([`Certification ${i + 1}`, `${c.name || ''} — ${c.issuer || ''}`]);
    });
  }
  if (d.languages) {
    d.languages.forEach((l, i) => {
      rows.push([`Language ${i + 1}`, `${l.language || ''} (${l.proficiency || ''})`]);
    });
  }

  const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadFile(csv, `${slugify(d.name)}_profile.csv`, 'text/csv');
}

function slugify(text) {
  return (text || 'profile').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Toast Notification System ────────────────────────────────────────────────

function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    warning: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
  };

  toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-exit');
    toast.addEventListener('transitionend', () => toast.remove());
  }, duration);
}

// ─── Theme Toggle ─────────────────────────────────────────────────────────────

function initTheme() {
  chrome.storage.local.get(['theme'], (result) => {
    const theme = result.theme || 'dark';
    applyTheme(theme);
  });
}

function applyTheme(theme) {
  const html = document.documentElement;
  const darkIcon = document.querySelector('.theme-icon-dark');
  const lightIcon = document.querySelector('.theme-icon-light');

  if (theme === 'light') {
    html.classList.add('light');
    if (darkIcon) darkIcon.style.display = 'none';
    if (lightIcon) lightIcon.style.display = 'block';
  } else {
    html.classList.remove('light');
    if (darkIcon) darkIcon.style.display = 'block';
    if (lightIcon) lightIcon.style.display = 'none';
  }
}

function toggleTheme() {
  const isLight = document.documentElement.classList.contains('light');
  const newTheme = isLight ? 'dark' : 'light';
  applyTheme(newTheme);
  chrome.storage.local.set({ theme: newTheme });
  showToast(`Switched to ${newTheme} mode`, 'info', 1500);
}

// ─── UI State Machine ─────────────────────────────────────────────────────────

const states = {
  IDLE: 'idle',
  NOT_LINKEDIN: 'not-linkedin',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error'
};

let currentState = states.IDLE;
let currentMarkdown = '';
let currentProfileData = null;

function setState(state, message = '') {
  currentState = state;

  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');

  statusDot.className = 'status-dot';

  switch (state) {
    case states.IDLE:
      statusDot.classList.add('dot-idle');
      statusText.textContent = 'Ready';
      break;

    case states.NOT_LINKEDIN:
      statusDot.classList.add('dot-error');
      statusText.textContent = 'Not a profile page';
      break;

    case states.LOADING:
      statusDot.classList.add('dot-loading');
      statusText.textContent = 'Scanning…';
      break;

    case states.SUCCESS:
      statusDot.classList.add('dot-success');
      statusText.textContent = message || 'Profile ready';

      if (currentProfileData) {
        const loaded = currentProfileData._sectionsLoaded || {};
        const found = Object.values(loaded).filter(Boolean).length;
        const total = Object.keys(loaded).length;
        const pct = total > 0 ? Math.round((found / total) * 100) : 0;
        const scoreEl = document.getElementById('strength-score');
        if (scoreEl) {
          scoreEl.textContent = `${pct}%`;
          scoreEl.style.display = 'inline-flex';
          scoreEl.className = 'strength-badge ' + (pct >= 70 ? 'strength-good' : pct >= 40 ? 'strength-ok' : 'strength-low');
        }
      }
      break;

    case states.ERROR:
      statusDot.classList.add('dot-error');
      statusText.textContent = message || 'Error';
      break;
  }

  updateConnectTabState();
}

// ─── Core Actions ─────────────────────────────────────────────────────────────

async function extractProfile() {
  setState(states.LOADING);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url || !tab.url.includes('linkedin.com/in/')) {
      setState(states.NOT_LINKEDIN);
      return;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (injectErr) {
      // Script may already be injected
    }

    await new Promise(r => setTimeout(r, 150));

    chrome.tabs.sendMessage(tab.id, { action: 'extractProfile' }, (response) => {
      if (chrome.runtime.lastError) {
        setState(states.ERROR, chrome.runtime.lastError.message);
        return;
      }
      if (!response || !response.success) {
        setState(states.ERROR, response?.error || 'Content script did not respond.');
        return;
      }

      currentProfileData = response.data;
      currentMarkdown = toMarkdown(response.data);
      const loaded = response.data._sectionsLoaded || {};
      const found = Object.values(loaded).filter(Boolean).length;
      const total = Object.keys(loaded).length;
      const msg = total > 0
        ? `Extracted! ${found}/${total} sections found`
        : 'Profile extracted!';
      setState(states.SUCCESS, msg);
    });
  } catch (err) {
    setState(states.ERROR, err.message);
  }
}

async function copyToClipboard() {
  if (!currentMarkdown) return;
  const copyBtn = document.getElementById('copy-btn');
  const originalText = copyBtn.textContent;
  try {
    await navigator.clipboard.writeText(currentMarkdown);
    copyBtn.textContent = '✓ Copied!';
    copyBtn.classList.add('copied');
    setTimeout(() => { copyBtn.textContent = originalText; copyBtn.classList.remove('copied'); }, 2000);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = currentMarkdown;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    copyBtn.textContent = '✓ Copied!';
    setTimeout(() => { copyBtn.textContent = originalText; }, 2000);
  }
}

// ─── Settings Drawer ──────────────────────────────────────────────────────────

function initSettings() {
  const card = document.getElementById('settings-card');
  const toggle = document.getElementById('settings-toggle');
  const toggleKeyBtn = document.getElementById('toggle-key-visibility');
  const apiKeyInput = document.getElementById('api-key-input');
  const saveBtn = document.getElementById('save-settings-btn');

  toggle.addEventListener('click', () => card.classList.toggle('open'));

  const closeBtn = document.getElementById('settings-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      card.classList.remove('open');
    });
  }

  toggleKeyBtn.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'userPersona', 'customPrompt', 'servicesPitch'], (result) => {
    if (result.geminiApiKey) {
      apiKeyInput.value = result.geminiApiKey;
    }
    if (result.geminiModel) {
      document.getElementById('model-select').value = result.geminiModel;
    }
    if (result.userPersona) {
      document.getElementById('persona-input').value = result.userPersona;
    }
    if (result.servicesPitch) {
      document.getElementById('pitch-input').value = result.servicesPitch;
    }
    
    const defaultPrompt = `You are a world-class LinkedIn networking copywriter. Your messages get replies because they feel genuinely personal — never templated.

{{instruction}}

RULES:
- {{constraint}}
- Tone: {{tone}}
- {{length_guide}}
- Reference ONE specific, concrete detail from their profile (a recent post, a specific role, a project, a shared skill — NOT just their job title)
- If we have mutual connections, consider mentioning that naturally
- If their recent activity shows a post or article, reference it specifically
- Sound like a real human who actually read their profile, not a bot
- Don't start with "I" — lead with them, not yourself
- Don't use hollow phrases like "I came across your profile", "impressive background", "I'd love to connect", "I noticed that"
- Start with "Hi [First Name],"
- End with a specific, low-pressure next step or reason to connect
- Write ONLY the message, nothing else{{language_instruction}}

THEIR PROFILE:
{{profile_summary}}
{{persona_section}}
Write the message now.`;

    document.getElementById('prompt-input').value = result.customPrompt !== undefined ? result.customPrompt : defaultPrompt;
  });

  saveBtn.addEventListener('click', () => {
    const settings = {
      geminiApiKey: apiKeyInput.value.trim(),
      geminiModel: document.getElementById('model-select').value,
      userPersona: document.getElementById('persona-input').value.trim(),
      servicesPitch: document.getElementById('pitch-input').value.trim(),
      customPrompt: document.getElementById('prompt-input').value.trim()
    };
    chrome.storage.local.set(settings, () => {
      saveBtn.textContent = '✓ Saved!';
      saveBtn.classList.add('saved');
      setTimeout(() => {
        saveBtn.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Save Settings`;
        saveBtn.classList.remove('saved');
        card.classList.remove('open');
      }, 1000);
      updateConnectTabState();
    });
  });
}

// ─── AI Connect Tab State ─────────────────────────────────────────────────────

function updateConnectTabState() {
  const generateBtn = document.getElementById('generate-btn');
  const generatePrepBtn = document.getElementById('generate-prep-btn');
  const statusEl = document.getElementById('auto-extract-status');
  const statusDot = document.getElementById('auto-extract-dot');
  const statusText = document.getElementById('auto-extract-text');

  if (currentProfileData) {
    if (statusEl) {
      statusDot.className = 'auto-extract-dot dot-ready';
      const name = currentProfileData.name || 'Profile';
      statusText.textContent = `✓ ${name} loaded`;
      setTimeout(() => {
        statusEl.classList.add('fade-out');
      }, 2000);
    }
    if (generateBtn) generateBtn.disabled = false;
    if (generatePrepBtn) generatePrepBtn.disabled = false;
  } else {
    if (statusEl) {
      statusDot.className = 'auto-extract-dot dot-scanning';
      statusText.textContent = 'Scanning profile…';
      statusEl.classList.remove('fade-out');
    }
    if (generateBtn) generateBtn.disabled = true;
    if (generatePrepBtn) generatePrepBtn.disabled = true;
  }
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

function buildPrompt(profileData, persona, customPrompt) {
  let profileSummary = '';

  if (profileData.name) profileSummary += `Name: ${profileData.name}\n`;
  if (profileData.headline) profileSummary += `Headline: ${profileData.headline}\n`;
  if (profileData.location) profileSummary += `Location: ${profileData.location}\n`;
  if (profileData.connections) profileSummary += `Connections: ${profileData.connections}\n`;
  if (profileData.mutualConnections) profileSummary += `Mutual connections: ${profileData.mutualConnections}\n`;

  if (profileData.about) {
    profileSummary += `\nAbout:\n${profileData.about}\n`;
  }

  if (profileData.experience && profileData.experience.length > 0) {
    profileSummary += `\nRecent Experience:\n`;
    profileData.experience.slice(0, 4).forEach(exp => {
      profileSummary += `- ${exp.title || ''} at ${exp.company || ''} (${exp.dates || ''})\n`;
      if (exp.description) profileSummary += `  ${exp.description.substring(0, 150)}\n`;
    });
  }

  if (profileData.education && profileData.education.length > 0) {
    profileSummary += `\nEducation:\n`;
    profileData.education.slice(0, 2).forEach(edu => {
      profileSummary += `- ${edu.school || ''} — ${edu.degree || ''} (${edu.years || ''})\n`;
    });
  }

  if (profileData.skills && profileData.skills.length > 0) {
    profileSummary += `\nTop Skills: ${profileData.skills.slice(0, 10).join(', ')}\n`;
  }

  if (profileData.certifications && profileData.certifications.length > 0) {
    profileSummary += `\nCertifications: ${profileData.certifications.slice(0, 3).map(c => c.name).join(', ')}\n`;
  }

  if (profileData.languages && profileData.languages.length > 0) {
    profileSummary += `Languages: ${profileData.languages.map(l => l.language).join(', ')}\n`;
  }

  if (profileData.volunteering && profileData.volunteering.length > 0) {
    profileSummary += `Volunteering: ${profileData.volunteering.slice(0, 2).map(v => `${v.role} at ${v.organization}`).join(', ')}\n`;
  }

  if (profileData.publications && profileData.publications.length > 0) {
    profileSummary += `Publications: ${profileData.publications.slice(0, 2).map(p => p.title).join(', ')}\n`;
  }

  if (profileData.projects && profileData.projects.length > 0) {
    profileSummary += `Projects: ${profileData.projects.slice(0, 2).map(p => p.name).join(', ')}\n`;
  }

  if (profileData.activity && profileData.activity.length > 0) {
    const recentActivity = profileData.activity.slice(0, 3);
    profileSummary += `\nRecent Activity:\n`;
    recentActivity.forEach(act => {
      const type = act.isRepost ? 'Reposted' : 'Posted';
      profileSummary += `- ${type}: ${(act.text || act.header || '').substring(0, 150)}\n`;
    });
  }

  const personaSection = persona
    ? `\nAbout me (the sender):\n${persona}\n`
    : '';

  const msgType = document.getElementById('msg-type-select')?.value || 'connection';
  const tone = document.getElementById('tone-select')?.value || 'professional';
  const length = document.getElementById('length-select')?.value || 'medium';
  const language = document.getElementById('language-select')?.value || 'english';

  const messageTypes = {
    connection: {
      instruction: 'Write a personalized LinkedIn connection request.',
      constraint: 'MUST be under 300 characters (this is LinkedIn\'s hard limit)'
    },
    inmail: {
      instruction: 'Write a personalized LinkedIn InMail message.',
      constraint: 'Keep it under 1000 characters. Include a compelling subject line on the first line prefixed with "Subject: "'
    },
    followup: {
      instruction: 'Write a follow-up message to send AFTER already connecting with this person on LinkedIn.',
      constraint: 'Keep it under 500 characters. Reference that you recently connected.'
    },
    cold_outreach: {
      instruction: 'Write a cold outreach email to this person.',
      constraint: 'Keep it under 800 characters. Include a subject line on the first line prefixed with "Subject: "'
    },
    recruiter: {
      instruction: 'Write a recruiter pitch message for this person about an exciting opportunity.',
      constraint: 'Keep it under 600 characters. Be enthusiastic but not pushy.'
    },
    thank_you: {
      instruction: 'Write a thank-you note to send after a meeting or conversation with this person.',
      constraint: 'Keep it under 400 characters. Be warm and specific.'
    }
  };

  const selected = messageTypes[msgType] || messageTypes.connection;

  const lengthGuide = {
    short: 'Keep it very concise — 1-2 sentences maximum.',
    medium: 'Use a moderate length — 2-4 sentences.',
    long: 'Write a detailed message — a full paragraph is fine.'
  };

  const languageInstruction = language !== 'english'
    ? `\nIMPORTANT: Write the entire message in ${language}.`
    : '';

  let promptTemplate = customPrompt;
  if (!promptTemplate) {
    promptTemplate = `You are a world-class LinkedIn networking copywriter. Your messages get replies because they feel genuinely personal — never templated.

{{instruction}}

RULES:
- {{constraint}}
- Tone: {{tone}}
- {{length_guide}}
- Reference ONE specific, concrete detail from their profile (a recent post, a specific role, a project, a shared skill — NOT just their job title)
- If we have mutual connections, consider mentioning that naturally
- If their recent activity shows a post or article, reference it specifically
- Sound like a real human who actually read their profile, not a bot
- Don't start with "I" — lead with them, not yourself
- Don't use hollow phrases like "I came across your profile", "impressive background", "I'd love to connect", "I noticed that"
- Start with "Hi [First Name],"
- End with a specific, low-pressure next step or reason to connect
- Write ONLY the message, nothing else{{language_instruction}}

THEIR PROFILE:
{{profile_summary}}
{{persona_section}}
Write the message now.`;
  }

  return promptTemplate
    .replace(/\{\{instruction\}\}/g, selected.instruction)
    .replace(/\{\{constraint\}\}/g, selected.constraint)
    .replace(/\{\{tone\}\}/g, tone)
    .replace(/\{\{length_guide\}\}/g, lengthGuide[length] || lengthGuide.medium)
    .replace(/\{\{language_instruction\}\}/g, languageInstruction)
    .replace(/\{\{profile_summary\}\}/g, profileSummary)
    .replace(/\{\{persona_section\}\}/g, personaSection);
}

// ─── Generate Connection Request (SDK implementation) ─────────────────────────

let isGenerating = false;
let typewriterQueue = '';
let typewriterInterval = null;
let currentDisplayText = '';

function startTypewriter(targetElement, onCharTyped) {
  typewriterQueue = '';
  currentDisplayText = '';
  targetElement.textContent = '';
  
  if (typewriterInterval) clearInterval(typewriterInterval);
  
  typewriterInterval = setInterval(() => {
    if (typewriterQueue.length > 0) {
      const charsToType = Math.min(2, typewriterQueue.length);
      const chunk = typewriterQueue.substring(0, charsToType);
      typewriterQueue = typewriterQueue.substring(charsToType);
      
      currentDisplayText += chunk;
      targetElement.textContent = currentDisplayText;
      targetElement.scrollTop = targetElement.scrollHeight;
      
      if (onCharTyped) onCharTyped(currentDisplayText.length);
    }
  }, 12);
}

function feedTypewriter(text) {
  typewriterQueue += text;
}

function stopTypewriter() {
  if (typewriterInterval) {
    clearInterval(typewriterInterval);
    typewriterInterval = null;
  }
}

async function generateConnectionRequest() {
  if (isGenerating) return;
  if (!currentProfileData) return;

  const aiErrorBox = document.getElementById('ai-error-box');
  const connectionPanel = document.getElementById('connection-preview-panel');
  const connectionText = document.getElementById('connection-text');
  const charCount = document.getElementById('char-count');
  const generateBtn = document.getElementById('generate-btn');

  const settings = await new Promise(resolve => {
    chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'userPersona', 'customPrompt'], resolve);
  });

  if (!settings.geminiApiKey) {
    aiErrorBox.textContent = 'Please enter your Gemini API Key in Settings above.';
    aiErrorBox.style.display = 'block';
    const card = document.getElementById('settings-card');
    if (!card.classList.contains('open')) card.classList.add('open');
    return;
  }

  aiErrorBox.style.display = 'none';
  connectionPanel.style.display = 'flex';
  connectionText.textContent = '';
  connectionText.classList.add('streaming');
  charCount.textContent = '0 / 300';
  charCount.classList.remove('over-limit');
  isGenerating = true;

  startTypewriter(connectionText, (len) => {
    charCount.textContent = `${len} / 300`;
    if (len > 300) {
      charCount.classList.add('over-limit');
    } else {
      charCount.classList.remove('over-limit');
    }
  });

  setBtnText(generateBtn, ' Generating…');
  generateBtn.disabled = true;

  try {
    const ai = new GoogleGenAI({ apiKey: settings.geminiApiKey });
    const model = settings.geminiModel || 'gemma-4-31b-it';
    const persona = settings.userPersona || '';
    const prompt = buildPrompt(currentProfileData, persona, settings.customPrompt);

    const config = {};

    if (model === 'gemini-3.1-flash-lite') {
      config.thinkingConfig = {
        thinkingLevel: ThinkingLevel.LOW,
      };
      config.tools = [
        {
          googleSearch: {}
        }
      ];
    } else if (model === 'gemma-4-26b-a4b-it') {
      config.thinkingConfig = {
        thinkingLevel: ThinkingLevel.MINIMAL,
      };
      config.tools = [
        {
          googleSearch: {}
        }
      ];
    } else if (model.startsWith('gemma-') || model.startsWith('gemini-')) {
      config.thinkingConfig = {
        thinkingLevel: 'MINIMAL',
      };
    }

    const response = await ai.models.generateContentStream({
      model,
      config,
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
    });

    for await (const chunk of response) {
      if (chunk.text) {
        feedTypewriter(chunk.text);
      }
    }

    while (typewriterQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    stopTypewriter();
    connectionText.classList.remove('streaming');
  } catch (err) {
    stopTypewriter();
    connectionText.classList.remove('streaming');
    aiErrorBox.textContent = `Generation failed: ${err.message || 'Unknown error'}`;
    aiErrorBox.style.display = 'block';
    showToast('Generation failed', 'error', 3000);
  } finally {
    isGenerating = false;
    generateBtn.disabled = false;
    setBtnText(generateBtn, ' Generate Connection Request');
  }
}

function setBtnText(btn, text) {
  const span = btn.querySelector('.btn-text');
  if (span) {
    span.textContent = text;
  }
}

// ─── Call Prep Prompts & Generation ───────────────────────────────────────────

function buildPrepPrompt(profileData, servicesPitch) {
  let profileSummary = '';

  if (profileData.name) profileSummary += `Name: ${profileData.name}\n`;
  if (profileData.headline) profileSummary += `Headline: ${profileData.headline}\n`;
  if (profileData.location) profileSummary += `Location: ${profileData.location}\n`;
  if (profileData.connections) profileSummary += `Connections: ${profileData.connections}\n`;
  if (profileData.mutualConnections) profileSummary += `Mutual connections: ${profileData.mutualConnections}\n`;

  if (profileData.about) {
    profileSummary += `\nAbout:\n${profileData.about}\n`;
  }

  if (profileData.experience && profileData.experience.length > 0) {
    profileSummary += `\nRecent Experience:\n`;
    profileData.experience.slice(0, 4).forEach(exp => {
      profileSummary += `- ${exp.title || ''} at ${exp.company || ''} (${exp.dates || ''})\n`;
      if (exp.description) profileSummary += `  ${exp.description.substring(0, 150)}\n`;
    });
  }

  if (profileData.skills && profileData.skills.length > 0) {
    profileSummary += `\nTop Skills: ${profileData.skills.slice(0, 10).join(', ')}\n`;
  }

  if (profileData.activity && profileData.activity.length > 0) {
    const recentActivity = profileData.activity.slice(0, 3);
    profileSummary += `\nRecent Activity:\n`;
    recentActivity.forEach(act => {
      const type = act.isRepost ? 'Reposted' : 'Posted';
      profileSummary += `- ${type}: ${(act.text || act.header || '').substring(0, 150)}\n`;
    });
  }

  const pitch = servicesPitch || "Premium recruitment and staffing services.";

  return `You are an elite Sales Development Representative (SDR) and cold calling coach. 
Your goal is to prepare a sales manager with context-driven talking points, hiring triggers, and high-impact verbal icebreakers for a cold call based on a lead's LinkedIn profile.

OUR SERVICES & OFFERING:
${pitch}

THE LEAD's PROFILE DATA:
${profileSummary}

Analyze the profile to extract hiring signals, specific hooks, and a live call pitch.

RULES FOR THE OUTPUT:
- Write ONLY the requested sections. Do not include introductory or concluding remarks.
- Keep all suggestions conversation-friendly—write them exactly as they should be spoken (no formal corporate email phrases).
- Avoid low-status phrases like "I noticed that...", "I was wondering...", or "I'd love to help you...".
- Enforce the exact structure below.

### HIRING SIGNALS
- **[Trigger Name]:** [1-2 sentences. Extract concrete signals indicating growth, active hiring, new office openings, tech stack changes, or talent gaps. Be specific about the department or roles affected.]
- **[Operational/Role Context]:** [1-2 sentences. Explain how their specific role, background, or team structure makes them the right target for our offering.]

### ICEBREAKERS
1. "[Icebreaker 1: Spoken-friendly hook referencing a recent post, shared post, promotion, or company update. Keep it under 20 words.]"
2. "[Icebreaker 2: Spoken-friendly hook referencing their career history or a specific skill. Keep it under 20 words.]"

CALL TRACK PITCH
"[Suggested live call script. Keep it to 2-3 sentences max. State their probable challenge based on their hiring signals, introduce the value hook naturally, and close with a low-friction question.]"`;
}

let isPrepGenerating = false;

async function generateCallPrep() {
  if (isPrepGenerating) return;
  if (!currentProfileData) return;

  const prepErrorBox = document.getElementById('prep-error-box');
  const prepPanel = document.getElementById('prep-preview-panel');
  const prepText = document.getElementById('prep-text');
  const generatePrepBtn = document.getElementById('generate-prep-btn');

  // Get settings
  const settings = await new Promise(resolve => {
    chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'servicesPitch'], resolve);
  });

  if (!settings.geminiApiKey) {
    prepErrorBox.textContent = 'Please enter your Gemini API Key in Settings above.';
    prepErrorBox.style.display = 'block';
    const card = document.getElementById('settings-card');
    if (!card.classList.contains('open')) card.classList.add('open');
    return;
  }

  // Reset UI
  prepErrorBox.style.display = 'none';
  prepPanel.style.display = 'flex';
  prepText.textContent = '';
  prepText.classList.add('streaming');
  isPrepGenerating = true;

  // Update button text
  setBtnText(generatePrepBtn, ' Generating Prep…');
  generatePrepBtn.disabled = true;

  try {
    const ai = new GoogleGenAI({ apiKey: settings.geminiApiKey });
    const model = settings.geminiModel || 'gemma-4-31b-it';
    const prompt = buildPrepPrompt(currentProfileData, settings.servicesPitch);

    const config = {};
    if (model === 'gemini-3.1-flash-lite') {
      config.thinkingConfig = {
        thinkingLevel: ThinkingLevel.LOW,
      };
      config.tools = [
        {
          googleSearch: {}
        }
      ];
    } else if (model === 'gemma-4-26b-a4b-it') {
      config.thinkingConfig = {
        thinkingLevel: ThinkingLevel.MINIMAL,
      };
      config.tools = [
        {
          googleSearch: {}
        }
      ];
    } else if (model.startsWith('gemma-') || model.startsWith('gemini-')) {
      config.thinkingConfig = {
        thinkingLevel: 'MINIMAL',
      };
    }

    const response = await ai.models.generateContentStream({
      model,
      config,
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
    });

    for await (const chunk of response) {
      if (chunk.text) {
        prepText.textContent += chunk.text;
        prepText.scrollTop = prepText.scrollHeight;
      }
    }

    prepText.classList.remove('streaming');
  } catch (err) {
    prepText.classList.remove('streaming');
    prepErrorBox.textContent = `Prep generation failed: ${err.message || 'Unknown error'}`;
    prepErrorBox.style.display = 'block';
    showToast('Prep generation failed', 'error', 3000);
  } finally {
    isPrepGenerating = false;
    generatePrepBtn.disabled = false;
    setBtnText(generatePrepBtn, ' Generate Call Prep');
  }
}

async function copyCallPrep() {
  const prepText = document.getElementById('prep-text');
  const text = prepText.textContent;
  if (!text) return;

  const copyBtn = document.getElementById('copy-prep-btn');
  const originalText = copyBtn.textContent;

  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = '✓ Copied!';
    copyBtn.classList.add('copied');
    showToast('Call Prep copied!', 'success', 2000);
    setTimeout(() => { copyBtn.textContent = originalText; copyBtn.classList.remove('copied'); }, 2000);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    copyBtn.textContent = '✓ Copied!';
    setTimeout(() => { copyBtn.textContent = originalText; }, 2000);
  }
}

// ─── Copy Connection Request ──────────────────────────────────────────────────

async function copyConnectionRequest() {
  const connectionText = document.getElementById('connection-text');
  const text = connectionText.textContent;
  if (!text) return;

  const copyBtn = document.getElementById('copy-connection-btn');
  const originalText = copyBtn.textContent;

  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = '✓ Copied!';
    copyBtn.classList.add('copied');
    showToast('Copied to clipboard!', 'success', 2000);
    setTimeout(() => { copyBtn.textContent = originalText; copyBtn.classList.remove('copied'); }, 2000);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    copyBtn.textContent = '✓ Copied!';
    setTimeout(() => { copyBtn.textContent = originalText; }, 2000);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isLinkedIn = tab?.url?.includes('linkedin.com/in/');

  if (!isLinkedIn) {
    setState(states.NOT_LINKEDIN);
    // Hide controls and tabs when not on LinkedIn
    const controls = document.querySelector('.msg-controls');
    const genBtn = document.getElementById('generate-btn');
    const tabsNav = document.getElementById('tabs-nav');
    if (controls) controls.style.display = 'none';
    if (genBtn) genBtn.style.display = 'none';
    if (tabsNav) tabsNav.style.display = 'none';
    // Show a helpful message
    const statusEl = document.getElementById('auto-extract-status');
    if (statusEl) {
      const dot = document.getElementById('auto-extract-dot');
      const text = document.getElementById('auto-extract-text');
      dot.className = 'auto-extract-dot dot-not-linkedin';
      text.textContent = 'Navigate to a LinkedIn profile to get started';
    }
  } else {
    setState(states.IDLE);
    silentExtractAndGenerate();
  }

  initSettings();
  initTheme();

  // Tab switching setup
  const tabMessage = document.getElementById('tab-message');
  const tabCallPrep = document.getElementById('tab-call-prep');
  const messageTabContent = document.getElementById('message-tab-content');
  const callPrepTabContent = document.getElementById('call-prep-tab-content');

  tabMessage?.addEventListener('click', () => {
    tabMessage.classList.add('active');
    tabCallPrep.classList.remove('active');
    messageTabContent.classList.add('active');
    callPrepTabContent.classList.remove('active');
    messageTabContent.style.display = 'flex';
    callPrepTabContent.style.display = 'none';
  });

  tabCallPrep?.addEventListener('click', () => {
    tabCallPrep.classList.add('active');
    tabMessage.classList.remove('active');
    callPrepTabContent.classList.add('active');
    messageTabContent.classList.remove('active');
    callPrepTabContent.style.display = 'flex';
    messageTabContent.style.display = 'none';
  });

  // Load persisted dropdown selections
  chrome.storage.local.get(['savedTone', 'savedLength', 'savedLanguage', 'savedMsgType'], (result) => {
    if (result.savedTone) {
      const el = document.getElementById('tone-select');
      if (el) el.value = result.savedTone;
    }
    if (result.savedLength) {
      const el = document.getElementById('length-select');
      if (el) el.value = result.savedLength;
    }
    if (result.savedLanguage) {
      const el = document.getElementById('language-select');
      if (el) el.value = result.savedLanguage;
    }
    if (result.savedMsgType) {
      const el = document.getElementById('msg-type-select');
      if (el) el.value = result.savedMsgType;
    }
  });

  // Save dropdown choices when they change
  document.getElementById('tone-select')?.addEventListener('change', (e) => {
    chrome.storage.local.set({ savedTone: e.target.value });
  });
  document.getElementById('length-select')?.addEventListener('change', (e) => {
    chrome.storage.local.set({ savedLength: e.target.value });
  });
  document.getElementById('language-select')?.addEventListener('change', (e) => {
    chrome.storage.local.set({ savedLanguage: e.target.value });
  });
  document.getElementById('msg-type-select')?.addEventListener('change', (e) => {
    chrome.storage.local.set({ savedMsgType: e.target.value });
  });

  document.getElementById('generate-btn').addEventListener('click', generateConnectionRequest);
  document.getElementById('copy-connection-btn').addEventListener('click', copyConnectionRequest);
  document.getElementById('regenerate-btn').addEventListener('click', generateConnectionRequest);

  // Call Prep listeners
  document.getElementById('generate-prep-btn')?.addEventListener('click', generateCallPrep);
  document.getElementById('copy-prep-btn')?.addEventListener('click', copyCallPrep);
  document.getElementById('regenerate-prep-btn')?.addEventListener('click', generateCallPrep);

  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

  const connectionText = document.getElementById('connection-text');
  if (connectionText) {
    connectionText.addEventListener('input', () => {
      const charCount = document.getElementById('char-count');
      const len = connectionText.innerText.length;
      charCount.textContent = `${len} / 300`;
      charCount.classList.toggle('over-limit', len > 300);
    });
  }

  chrome.storage.local.get(['pendingExtract'], (result) => {
    if (result.pendingExtract) {
      chrome.storage.local.set({ pendingExtract: false });
      silentExtractAndGenerate();
    }
  });
});

async function silentExtractAndGenerate() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('linkedin.com/in/')) return;

    const statusEl = document.getElementById('auto-extract-status');
    const dot = document.getElementById('auto-extract-dot');
    const text = document.getElementById('auto-extract-text');
    if (dot) dot.className = 'auto-extract-dot dot-scanning';
    if (text) text.textContent = 'Scanning profile…';
    if (statusEl) statusEl.classList.remove('fade-out');

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch { /* already injected */ }

    await new Promise(r => setTimeout(r, 200));

    chrome.tabs.sendMessage(tab.id, { action: 'extractProfile' }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        if (dot) dot.className = 'auto-extract-dot dot-error';
        if (text) text.textContent = 'Could not scan profile';
        return;
      }

      currentProfileData = response.data;
      currentMarkdown = toMarkdown(response.data);
      updateConnectTabState();

      chrome.storage.local.get(['geminiApiKey'], (result) => {
        if (result.geminiApiKey) {
          setTimeout(() => generateConnectionRequest(), 300);
        } else {
          if (dot) dot.className = 'auto-extract-dot dot-ready';
          if (text) text.textContent = '✓ Profile loaded — set API key in Settings to generate';
          const card = document.getElementById('settings-card');
          if (card) card.classList.add('open');
          const body = document.getElementById('settings-body');
          if (body) body.style.display = 'flex';
        }
      });
    });
  } catch {
    /* silently fail */
  }
}
