# Linco — AI LinkedIn Profile Extractor & Sales Call Prep

Linco is a premium, visual-rich Chrome Extension that streamlines lead prospecting and sales preparation. It automatically extracts LinkedIn profile details and uses the official Google GenAI SDK to generate tailored outreach messages or live call prep sheets (including hiring triggers, spoken-friendly icebreakers, and customized elevator pitches) in real time.

---

## 🚀 Features

- **Profile Extractor**: Leverages a robust DOM scraper (and RSC rehydration fallbacks) to read profile headers, experience, education, skills, activity/posts, honors, certifications, and languages.
- **Message Generator**: Writes highly personalized connection requests, InMail, follow-ups, and cold outreach.
  - Supports configurable **Tones** (Professional, Casual, Friendly, Formal, Witty).
  - Supports custom **Lengths** and multi-lingual output.
  - Supports dynamic template placeholders: `{{my name}}`, `{{company name}}`, and `{{job title}}` inside custom prompt templates.
- **Interactive AI Chat Reply**: Injects a sparkle (`✨`) action button directly into LinkedIn chat windows.
  - Automatically extracts conversation history context (last 8 messages).
  - Displays a glassmorphic verification panel for reviewing drafts.
  - Allows manual editing or instruction-based regeneration (e.g., *"tweak to ask for a coffee next Tuesday"*).
  - Safely injects into LinkedIn input fields only after explicit user approval.
- **Sales Call Prep (On-Demand)**: Generates a prep guide specifically tailored to your company's service offerings.
  - **Hiring Signals**: Focuses on active triggers, team expansion, and tech growth.
  - **Live Icebreakers**: Structured as spoken-friendly hooks, ready to use on call.
  - **Elevator Pitch**: A 1-2 sentence peer-to-peer hook linking the lead's situation directly to your offer (supporting automatic placeholder substitution for your Name, Company, and Job Title).
- **Premium UI/UX**: Sleek, responsive interface supporting system-matched dark and light themes, and instant clipboard copying.

---

## 🛠️ Installation

Since this is a custom extension, you can install it locally in Developer Mode:

1. Clone or download this repository.
2. Open Google Chrome and go to `chrome://extensions/`.
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. Click **Load unpacked** in the top-left corner.
5. Select the `extension/` folder inside this project directory.
6. The Linco icon will now appear in your browser's toolbar. Pin it for quick access!

---

## ⚙️ Configuration & Usage

### 1. Set Up Your API Key & Services
1. Open the Linco popup.
2. Click the **Settings Gear Icon** in the top right.
3. Paste your **Gemini API Key**.
4. Set your **Name**, **Company Name**, **Job Title**, **Persona** (who you are), and your **Services / Offer Pitch** (what you sell, e.g. *"We provide tech recruitment and staffing services to help scale engineering teams"*).
5. (Optional) Customize the prompt template using placeholders like `{{my name}}`, `{{company name}}`, and `{{job title}}` to dynamically insert your identity.
6. Click **Save Settings**.

### 2. Message Outlining & Calling
1. Navigate to any LinkedIn profile page (e.g. `https://www.linkedin.com/in/username/`).
2. Click the Linco icon.
3. **Message Gen Tab**: Automatically extracts the profile and generates a context-rich connection request in under 5 seconds.
4. **Call Prep Tab**: Click **Generate Call Prep** to instantly get an actionable phone talking-track before you dial the lead.

### 3. AI Chat Reply Drawer (Verification & Approval)
1. Open any active LinkedIn messaging popup bubble or the full-screen messaging layout.
2. Locate the sparkle (`✨`) action button injected into the attachment footer tray of the chat composer.
3. Click the button. A glassmorphic **Linco AI Draft** panel will slide open above the compose box showing the generated reply (scraped from the last 8 messages of history).
4. **Edit & Approve**: Tweak the response inside the text area, and click **Approve & Insert** to load the text directly into LinkedIn's textbox.
5. **Regenerate with Instructions**: Type custom guidance (e.g. *"ask for coffee next week"*) inside the context input bar and click **Regenerate** to rewrite the draft.
6. **Cancel**: Click the **`×`** close button to dismiss the draft panel without modifying the textbox.

---

## 🧑‍💻 Local Development

The extension source files are located in `extension/src/`. To bundle the ESM imports and GenAI SDK for the browser, we use `esbuild`.

### Prerequisites
Make sure you have Node.js installed, then install the dependencies:
```bash
npm install
```

### Build Scripts
To bundle the extension popup script:
```bash
# Compile once
npm run build

# Watch mode for development
npm run watch
```

---

## 📂 Project Structure

```
├── extension/
│   ├── manifest.json       # Extension metadata and permissions
│   ├── popup.html          # Pop-up window interface
│   ├── popup.css           # Glassmorphism visual styles
│   ├── content.js          # LinkedIn DOM scraping script
│   ├── background.js       # Background service worker
│   ├── popup.js            # Compiled output (do not edit directly)
│   └── src/
│       └── popup.js        # Main popup source code (GenAI logic & Tab switching)
├── package.json
└── README.md
```

---

## 🔒 Security & Privacy

- **Local Storage**: Your Gemini API Key and settings are stored locally on your machine via `chrome.storage.local`.
- **No Middleman**: All GenAI calls go directly to the official Google Gemini API endpoint. No external analytics or proxy servers are used.
