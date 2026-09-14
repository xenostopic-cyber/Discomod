# DISCOMOD — Discord Moderation, Automation & Utility Bot

> A feature-rich Discord bot built with **discord.js v14** for moderation, server automation, AI-assisted tools, mathematical computing, welcome/leave automation, invitation tracking, Blox Fruits utilities, and a web dashboard.

DISCOMOD originally started as a moderation/utility project for **MonkeyVerseYT's server** and was later expanded for broader use. It is modular by design: optional AI providers, math backends, dashboard functionality, card rendering, verification, tickets, applications, appeals, leveling, invite tracking, and other systems can be enabled without requiring every subsystem to be used.

---

## 📚 Table of Contents

- [Overview](#-overview)
- [Feature Overview](#-feature-overview)
- [Moderation System](#-moderation-system)
- [Anti-Spam and Message Protection](#-anti-spam-and-message-protection)
- [Scam and Suspicious Content Detection](#-scam-and-suspicious-content-detection)
- [AI Systems](#-ai-systems)
- [Math and Scientific Computing](#-math-and-scientific-computing)
- [Welcome and Leave Systems](#-welcome-and-leave-systems)
- [Invite Attribution](#-invite-attribution)
- [Web Dashboard](#-web-dashboard)
- [Card Rendering](#-card-rendering)
- [Server Configuration](#-server-configuration)
- [Blox Fruits Utilities](#-blox-fruits-utilities)
- [Commands](#-commands)
- [Permissions and Access Control](#-permissions-and-access-control)
- [Environment Variables](#-environment-variables)
- [Requirements](#-requirements)
- [Installation](#-installation)
- [GitHub Codespaces](#-github-codespaces)
- [Running the Bot](#-running-the-bot)
- [Updating the Environment](#-updating-the-environment)
- [AI Provider Setup](#-ai-provider-setup)
- [Math Environment Setup](#-math-environment-setup)
- [Dashboard Setup](#-dashboard-setup)
- [Discord Developer Portal](#-discord-developer-portal)
- [Data and Persistence](#-data-and-persistence)
- [Troubleshooting](#-troubleshooting)
- [Security](#-security)
- [Development](#-development)
- [Testing](#-testing)
- [Project Structure](#-project-structure)
- [Credits](#-credits)
- [License](#-license)

---

# 🧭 Overview

DISCOMOD is intended to be a full-featured Discord community platform rather than only a basic moderation bot.

The project combines:

- Discord moderation
- anti-spam protection
- violation tracking
- configurable enforcement
- logging
- AI-assisted analysis/detection
- AI conversations and roasts
- multiple AI providers
- high-precision mathematical tooling
- multiple scientific-computing backends
- welcome messages and welcome cards
- leave messages and leave cards
- invite attribution and inviter leaderboards
- reaction roles
- leveling and level rewards
- verification/CAPTCHA tools
- tickets
- applications
- appeals
- Custom AutoMod
- Blox Fruits-related utilities
- a browser dashboard
- server-side card rendering
- owner-only global controls

Optional integrations can be left blank in `.env` when they are not required.

---

# 🚀 Feature Overview

## 🔒 Moderation System

DISCOMOD contains a configurable moderation workflow built around violations and escalating enforcement.

Features include:

- per-user violation tracking
- configurable violation thresholds
- automated punishment escalation
- temporary exile-style enforcement
- timeouts
- role stripping options
- warning-only mode
- log-only mode
- enforcement mode
- moderation logging

A server can therefore test a detection system before allowing it to automatically punish users.

Example policy concept:

```text
1st violation  → warning
2nd violation  → stronger warning / log
3rd violation  → timeout
N violations   → configured enforcement
```

The actual result depends on the server's saved settings.

---

# 🛡️ Anti-Spam and Message Protection

The monitoring system can detect abnormal message activity using multiple signals.

### Flood detection

Rapid bursts of messages can be detected using configurable time-window logic.

### Duplicate messages

Repeated copies of the same message can be detected and handled separately from normal conversation.

### Emoji spam

Excessive emoji-based spam can be flagged.

### Sensitivity controls

Detection thresholds can be adjusted rather than relying on one fixed value.

The system can also be configured to scan edited messages where supported by the enabled settings.

---

# 🚨 Scam and Suspicious Content Detection

DISCOMOD contains rule-based and optional AI-assisted detection for suspicious content.

Examples include:

- suspicious links
- scam-like wording
- exploit-oriented text
- suspicious content patterns
- off-topic command redirection
- service/trade redirection checks
- AI-assisted message analysis

Detection can be configured to operate in different modes:

```text
enforce
warn-only
log-only
```

This allows administrators to tune the system before enabling stronger automation.

---

# 🤖 AI Systems

DISCOMOD supports multiple AI providers instead of forcing the entire project onto one provider.

Supported provider integrations include:

- OpenAI
- Anthropic / Claude
- Groq
- Google Gemini
- Mistral
- DeepSeek
- xAI / Grok
- Wolfram Alpha-related tooling
- RoastedByAI-related functionality where configured

## BYOK configuration

The project is intended to use your own API credentials.

Example:

```env
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GROQ_API_KEY=
GEMINI_API_KEY=
MISTRAL_API_KEY=
DEEPSEEK_API_KEY=
XAI_API_KEY=
WOLFRAM_APPID=
```

Providers that have no key can remain disabled.

## AI conversations

Depending on enabled modules, AI functionality can support:

- general conversation
- Blox Fruits-specific conversation mode
- configurable prompts/instructions
- provider/model switching
- history management
- owner controls
- AI-assisted detection
- roast-style responses
- response splitting for Discord message limits

## Model configuration

The repository may contain provider/model mappings so administrators can switch among supported choices. Third-party model names and availability can change over time, so treat the project's current source as authoritative for the models supported by that particular release.

---

# 🧮 Math and Scientific Computing

DISCOMOD includes a dedicated `math_commands.js` subsystem for advanced mathematical and scientific work.

The module can integrate multiple backends and automatically report which ones are available on the host.

## Backend mapping

The user-facing `/math` command groups backends into readable categories:

| User-facing name | Backend |
|---|---|
| `precision` | Arb |
| `algebra` | CLN |
| `symbolic` | FriCAS |
| `geometry` | GiNaC |
| `integers` | GMP |
| `matrices` | LinBox |
| `floats` | MPFR |
| `analysis` | mpmath |
| `arrays` | NumPy |
| `theory` | PARI/GP |
| `advanced` | SageMath |
| `scientific` | SciPy |

Not every backend must be installed. `/math status` is intended to show what the current machine can actually use.

## `/math run`

Run a calculation/code block using one selected backend.

```text
/math run <backend> [expression]
```

Leaving the expression empty can open a multiline modal.

## `/math all`

Run the same input against every available backend and compare the results.

```text
/math all [expression]
```

## `/math status`

Shows which math backends are currently available.

## `/math ramset`

Adjust the math worker's RAM limit at runtime.

```text
/math ramset 1024
```

The value is validated before being applied.

## Multiline modal input

Large calculations can be entered in a Discord modal rather than forcing everything onto one command line.

Example:

```python
import numpy as np

A = np.array([
    [1, 2],
    [3, 4]
])

print(np.linalg.det(A))
```

## Long output

Discord messages have a hard size limit. The math subsystem therefore breaks large results into multiple safe messages.

This is useful for:

- large integers
- symbolic expansions
- matrices
- high-precision results
- long scientific output

## Arbitrary precision

Backends such as mpmath and MPFR-compatible tooling can be used for high-precision or arbitrary-precision calculations, depending on the installed environment and submitted computation.

---

# 👋 Welcome and Leave Systems

DISCOMOD provides join/leave automation with configurable text and visual output.

## Welcome

Welcome settings include options for:

- welcome channel
- welcome text
- embeds
- embed colour
- direct-message welcomes
- welcome cards
- placeholders
- automatic roles

Common placeholders include:

```text
{user}
{server}
{count}
```

## Leave

The leave system follows the same general design as the welcome system while adding functionality appropriate for departing members.

It can configure:

- leave channel
- leave message
- embed mode
- embed colour
- leave-card rendering
- saved visual schema
- test sending

Common placeholders include:

```text
{displayName}
{server}
{count}
```

Both systems can be tested from the bot/dashboard without requiring an actual member event.

---

# 🕵️ Invite Attribution

The invite tracker is designed to answer:

> Who invited this member?

and:

> Which members are responsible for the most joins?

Tracked information can include:

- invite code
- usage count
- inviter ID
- inviter tag
- invite channel
- member tag
- attribution time
- ambiguous-attribution status

## `/invites`

The command family includes operations such as:

```text
/invites who
/invites leaderboard
/invites refresh
/invites status
```

## Attribution limitations

Invite attribution is inherently best-effort.

If multiple invite counters change at approximately the same time, Discord may not provide enough information to identify one specific invite. In those cases the project can record the attribution as ambiguous rather than pretending certainty.

Vanity URL joins and other cases where the necessary information is not exposed may also prevent exact attribution.

---

# 🌐 Web Dashboard

The project includes an optional browser dashboard authenticated through Discord OAuth2.

The dashboard is intended to expose the same underlying configuration systems used by the bot rather than acting as a separate fake settings layer.

## Dashboard areas

Depending on the current project revision, the dashboard can manage:

- server settings
- moderation settings
- Custom AutoMod
- welcome messages
- leave messages
- channels
- roles
- reaction roles
- leveling
- XP settings
- level reward roles
- logging
- verification
- tickets
- applications
- appeals
- invite attribution
- Blox Fruits tools
- card designs
- AI configuration
- math owner controls
- health/status information

## Guild isolation

Dashboard APIs are intended to validate the selected guild and the authenticated user's ability to manage it. Sensitive operations must not rely only on whether a button is visible in the browser.

## Owner-only Math Lab

The dashboard can provide a global owner-only Math Lab for settings that affect the bot's shared math environment.

Examples include:

- default math precision
- math worker timeout
- backend status
- runtime math settings

The owner-only page is protected server-side through the bot's super-user/owner check.

---

# 🎨 Card Rendering

The project contains a shared server-side card-rendering system.

Current card concepts include:

- rank cards
- level-up cards
- welcome cards
- leave cards
- stock cards

Cards are driven by JSON-compatible schemas, making them suitable for a browser-based visual editor.

The important design goal is that a saved dashboard schema is actually used by the bot when it renders a card. Rendering failures should fall back to normal embeds/plain messages wherever the specific feature supports that fallback.

---

# ⚙️ Server Configuration

Settings are stored per guild.

Common configuration groups include:

### General

- prefixes
- enabled/disabled features
- channels
- roles

### Moderation

- thresholds
- enforcement mode
- exile duration
- role stripping
- logging

### Welcome / Leave

- channels
- messages
- embeds
- colours
- card schemas

### Logging

- event types
- webhook settings
- moderation events
- member events
- channel/role events
- invite events

### Leveling

- enabled state
- minimum XP
- maximum XP
- message cooldown
- level-up channel
- level-up message
- level reward roles

### Verification

- verification mode
- CAPTCHA settings
- attempt limits
- cooldowns
- web verification settings

### Reaction Roles

- target message
- emoji
- role mapping

### Custom AutoMod

- word rules
- regular-expression rules
- exemptions
- actions
- timeouts
- logging
- enable/disable
- test functionality

---

# 🍈 Blox Fruits Utilities

The project also contains Blox Fruits-oriented modules.

Depending on the configured source/modules, these can include:

- stock information
- stock notifications
- update/reference information
- carry-service workflows
- Blox Fruits-specific AI mode
- visual stock cards

Data sources and game information can change, so provider/source behaviour should be checked against the current project release before assuming a particular data feed is permanent.

---

# 🧰 `update_env`

The repository contains an `update_env` environment-maintenance script.

Its purpose is to simplify maintenance of the local Python/math/AI environment and can include operations such as:

- upgrading Python packages
- checking dependency consistency
- maintaining a vendored latest mpmath copy
- obtaining math-library source repositories
- obtaining AI SDK/source repositories
- keeping local source mirrors organized

The AI source synchronization currently covers provider/source families including:

- OpenAI
- Anthropic / Claude
- Google Gen AI
- Groq
- Mistral
- xAI
- DeepSeek
- roastedbyai
- Wolfram

The math source synchronization covers the configured mathematical libraries/backends.

> `update_env` is an environment maintenance tool. Installing/updating source repositories is separate from installing the runtime packages required to execute them.

---

# 🤖 Commands

The project contains both slash commands and prefix-style commands for legacy/feature compatibility.

Representative slash-command families include:

```text
/setup
/leave
/invites
/math
/level
/tag
/captcha
```

Additional commands are supplied by feature modules such as applications, appeals, Blox Fruits utilities, AI utilities, economy utilities, and other project components.

## Slash-command limits

Discord limits the number of top-level application commands. DISCOMOD uses subcommands/subcommand groups where appropriate so related functionality can be grouped instead of unnecessarily consuming a top-level command slot.

Keep command names, descriptions, option names, and descriptions within Discord's metadata constraints when adding new commands.

---

# 🔐 Permissions and Access Control

Access is determined by the specific feature and can include:

- normal member access
- Discord permissions
- moderator permissions
- administrator/server-management permissions
- bot-manager access
- bot owner/super-user access

Examples:

### Members

Public utility commands and features permitted by the server.

### Moderators

Moderation and moderation-management features for which they have the required permissions.

### Administrators / bot managers

Server configuration and privileged management functions.

### Bot owner / super user

Global owner-only controls, including the owner Math Lab.

Important: hiding a dashboard button is **not** a security boundary. Privileged APIs should always perform their own authorization checks.

---

# 🔑 Environment Variables

A `.env` file contains credentials and deployment-specific configuration.

Use `.env.example` as the public template.

Example variables:

```env
DISCORD_TOKEN=
CLIENT_ID=
CLIENT_SECRET=

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GROQ_API_KEY=
GEMINI_API_KEY=
MISTRAL_API_KEY=
DEEPSEEK_API_KEY=
XAI_API_KEY=
WOLFRAM_APPID=

DASHBOARD_ENABLED=
DASHBOARD_PORT=
DASHBOARD_REDIRECT_URI=
DASHBOARD_SESSION_SECRET=
DASHBOARD_BOT_PERMISSIONS=
DASHBOARD_TRUST_PROXY=
DASHBOARD_PUBLIC_URL=

TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=

MATH_RAM_LIMIT_MB=
MATH_TIMEOUT_S=
PYTHON_BIN=

OPENAI_MODEL=
CLAUDE_MODEL=
GROQ_MODEL=
GEMINI_MODEL=
MISTRAL_MODEL=
DEEPSEEK_MODEL=
XAI_MODEL=

OPENAI_BASE_URL=
GROQ_BASE_URL=
DEEPSEEK_BASE_URL=
MISTRAL_BASE_URL=
XAI_BASE_URL=
```

### Never commit secrets

Do not commit real:

- Discord bot tokens
- OAuth2 client secrets
- AI API keys
- dashboard session secrets
- other private deployment credentials

Use placeholders in `.env.example` and keep real secrets in `.env` or a proper secret manager.

---

# 📦 Requirements

A typical deployment needs:

- **Node.js**
- **npm**
- **Python 3**
- a Discord application and bot
- the bot token
- the application/client ID
- an OAuth2 client secret if using the dashboard
- API keys for whichever AI providers you intend to use
- project files and optional modules required by enabled features
- the Python/system dependencies for whichever math backends you want to use

## Discord intents

Depending on the enabled features, the bot may need:

- Guilds
- GuildMessages
- MessageContent
- GuildMembers
- DirectMessages, where applicable

Additional Discord permissions are also required for actions such as moderation, assigning roles, sending embeds/files, reading message history, or managing channels.

---

# 🛠️ Installation

## 1. Clone the repository

```bash
git clone https://github.com/xenostopic-cyber/Discomod
cd Discomod
```

If using a fork or another remote, use that repository URL instead.

## 2. Prepare the setup script

```bash
chmod +x setup.sh
```

## 3. Run setup

```bash
./setup.sh
```

Follow the setup prompts.

## 4. Create the environment file

```bash
cp .env.example .env
```

Then edit `.env` and supply your actual credentials/configuration.

For example:

```bash
nano .env
```

## 5. Install Node dependencies

```bash
npm install
```

## 6. Start DISCOMOD

```bash
npm start
```

---

# ☁️ GitHub Codespaces

DISCOMOD can be convenient to develop/test inside **GitHub Codespaces** because Codespaces provides a ready Linux-based development environment.

A typical flow is:

```bash
git clone <your-repository>
cd Discomod
npm install
cp .env.example .env
nano .env
npm start
```

Codespaces are useful for development, debugging, dependency setup, and testing.

For long-term production hosting, use a service intended for continuously running applications and make sure it permits long-running Node processes.

---

# ▶️ Running the Bot

The main entry point is:

```text
DISCOMOD.js
```

Start normally with:

```bash
npm start
```

or:

```bash
node DISCOMOD.js
```

If the optional dashboard is enabled, the dashboard can run alongside the bot through the project's dashboard integration.

A healthy deployment should generally have:

```text
Discord connection   → online
Node process          → running
Dashboard             → listening, if enabled
AI providers          → enabled where configured
Math worker           → available where Python/dependencies exist
```

---

# 🔄 Updating the Environment

Use the project's `update_env` script when you want to maintain the local dependency and source environment.

It can handle tasks such as:

- Python package updates
- dependency checks
- math environment maintenance
- mpmath vendoring
- math repository synchronization
- AI SDK/source synchronization

Always review what the updater is going to change before running it on a tightly managed production environment.

If a source-download step is optional, enable it only when you actually want a local source copy.

---

# 🧠 AI Provider Setup

### OpenAI

```env
OPENAI_API_KEY=...
```

### Anthropic / Claude

```env
ANTHROPIC_API_KEY=...
```

### Groq

```env
GROQ_API_KEY=...
```

### Google Gemini

```env
GEMINI_API_KEY=...
```

### Mistral

```env
MISTRAL_API_KEY=...
```

### DeepSeek

```env
DEEPSEEK_API_KEY=...
```

### xAI / Grok

```env
XAI_API_KEY=...
```

### Wolfram Alpha

```env
WOLFRAM_APPID=...
```

A provider may still fail even when its key is present because of account permissions, model availability, dependency problems, API changes, network issues, or service outages.

---

# 🧮 Math Environment Setup

The math subsystem can use libraries/backends such as:

```text
mpmath
numpy
scipy
gmpy2
symengine
python-flint
cypari2
linbox
cln
SageMath
FriCAS
```

The exact availability depends on the host operating system and installation.

Check the current state through:

```text
/math status
```

---

# 🌐 Dashboard Setup

The dashboard uses Discord OAuth2.

## Required configuration

```env
CLIENT_ID=...
CLIENT_SECRET=...
DASHBOARD_ENABLED=true
DASHBOARD_PORT=3000
DASHBOARD_REDIRECT_URI=http://localhost:3000/auth/callback
DASHBOARD_SESSION_SECRET=...
```

## Local testing

For local development, use:

```env
DASHBOARD_ENABLED=true
DASHBOARD_PORT=3000
DASHBOARD_REDIRECT_URI=http://localhost:3000/auth/callback
```

The exact same redirect URI must be registered in the Discord Developer Portal.

## Public deployment

For production, use your actual HTTPS callback URL:

```env
DASHBOARD_REDIRECT_URI=https://example.com/auth/callback
```

If deploying behind a trusted reverse proxy, configure:

```env
DASHBOARD_TRUST_PROXY=true
```

only when that reflects the actual network topology.

---

# 🧑‍💻 Discord Developer Portal

Open your Discord application in the Developer Portal.

## Bot token

Put the bot token into:

```env
DISCORD_TOKEN=
```

Never publish it.

## Application ID

Set:

```env
CLIENT_ID=
```

to the application's client/application ID.

## OAuth2 client secret

For dashboard login:

```env
CLIENT_SECRET=
```

This is the OAuth2 client secret and is distinct from the bot token.

## Redirect URL

For local testing:

```text
http://localhost:3000/auth/callback
```

For production, register the exact HTTPS URL configured in `.env`.

---

# 💾 Data and Persistence

DISCOMOD stores per-guild configuration and feature state in the project's persistent data mechanisms.

Depending on enabled modules, persisted information can include:

- guild settings
- moderation state
- invite tracking
- leveling data
- applications
- appeals
- reaction-role mappings
- dashboard configuration
- runtime settings
- feature-specific state

## Backups

Before major updates:

```text
1. Stop the bot.
2. Back up persistent data.
3. Update the code/dependencies.
4. Run tests.
5. Start the bot.
6. Check the important features.
```

Do not assume a package upgrade can never affect your stored data.

---

# 🧯 Troubleshooting

## Bot does not start

Check:

```bash
node --version
npm --version
python3 --version
```

Then verify `.env` has at least:

```env
DISCORD_TOKEN=...
CLIENT_ID=...
```

## An AI provider is disabled

Check that the relevant key exists and is non-empty.

For example:

```env
MISTRAL_API_KEY=...
```

## Dashboard does not start

Check:

```env
DASHBOARD_ENABLED=true
CLIENT_ID=...
CLIENT_SECRET=...
DASHBOARD_SESSION_SECRET=...
DASHBOARD_REDIRECT_URI=...
```

Then verify the Discord OAuth2 redirect URI is an exact match.

## Math backend unavailable

Run:

```text
/math status
```

Then install the dependency appropriate for the missing backend.

## Python cannot be found

Provide the path explicitly:

```env
PYTHON_BIN=/full/path/to/python
```

## Math output is split

That is expected for outputs larger than Discord's message size limit.

## Leave card is not rendered

Check:

- leave functionality is enabled
- the channel exists
- the bot has permission to send there
- the card renderer dependency is installed
- the saved card schema is valid

The relevant feature can fall back to a normal message/embed when visual rendering fails.

## Invite attribution is ambiguous

That can happen when several invite counters change near the same time or Discord does not provide enough information to identify the used invite. The tracker should prefer recording uncertainty over inventing a result.

---

# 🔒 Security

DISCOMOD handles Discord permissions, OAuth sessions, API credentials, server configuration, and optional third-party services.

## Keep secrets private

Never commit real secrets to GitHub.

Use `.env.example` for documentation and `.env` for local/private configuration.

## Protect dashboard sessions

Use a strong, unpredictable:

```env
DASHBOARD_SESSION_SECRET=
```

Do not reuse public or example values.

## Use HTTPS for public dashboards

Public OAuth dashboards should use HTTPS and a properly configured reverse proxy/hosting setup.

## Authorization must be server-side

Never assume that hiding a button prevents an unauthorized request. Privileged dashboard APIs and commands should always validate the authenticated user's permissions.

## AI API usage

Third-party AI services can charge for usage. Protect API keys and monitor provider-side usage and limits.

---

# 🧑‍💻 Development

Main entry point:

```text
DISCOMOD.js
```

Common development checks:

```bash
npm install
node --check DISCOMOD.js
npm start
```

Use a private test server while developing moderation, role-management, verification, ticketing, and automation changes.

---

# ✅ Testing

The project contains automated feature/regression tests for multiple subsystems.

Where the current project includes the feature test script, run:

```bash
npm run test:features
```

Automated tests are valuable but do not prove that:

- Discord's live API is available
- your bot token is valid
- every AI provider is online
- every Python math backend is installed
- production OAuth is configured correctly
- production networking/proxy configuration is correct

Those still need runtime/deployment testing.

---

# 📁 Project Structure

A normal checkout can contain files/modules such as:

```text
Discomod/
├── DISCOMOD.js
├── dashboard.js
├── script.js
├── style.css
├── index.html
├── card_renderer.js
├── math_commands.js
├── beli_commands.js
├── applications.js
├── appeals.js
├── carry_service.js
├── translation.js
├── bloxfruits_stock.js
├── bloxfruits_updates.js
├── update_env
├── setup.sh
├── package.json
├── .env.example
├── NOTICE
├── dashboard-public/
│   ├── index.html
│   ├── script.js
│   └── style.css
└── tests/
    └── ...
```

The exact file list can change between releases.

### Do not delete modules just because they look unused

Some files are optional integrations, compatibility layers, rendering systems, or feature modules that are loaded by the main application.

---

# 🧪 Recommended First Deployment

A safe first setup is:

```bash
git clone https://github.com/xenostopic-cyber/Discomod
cd Discomod
cp .env.example .env
npm install
chmod +x setup.sh
./setup.sh
npm start
```

Then test:

```text
✓ Bot login
✓ Slash command registration
✓ Permissions
✓ Moderation
✓ Anti-spam
✓ Welcome
✓ Leave
✓ Invite tracking
✓ AI provider(s)
✓ /math status
✓ /math run
✓ Dashboard login
✓ Dashboard guild isolation
✓ Card rendering
✓ Logging
```

Only move the bot into a production server after the important paths work correctly in a controlled test server.

---

# 🤝 Contributing

Useful contributions include:

- bug fixes
- security improvements
- performance improvements
- dashboard improvements
- command fixes
- additional regression tests
- better documentation
- AI provider compatibility
- math backend compatibility
- accessibility/UI improvements
- improved error handling

When submitting a change:

1. Explain what changed.
2. Mention affected modules.
3. Add or update tests where practical.
4. Do not submit secrets.
5. Avoid breaking existing guild configuration.
6. Document new environment variables.

---

# 🧾 Credits

Originally created for **MonkeyVerseYT's server**, then expanded for broader use.

If you use or redistribute this project, please credit the original author:

**CyberNovaX (Xenostopic)**

### Contact

Discord user ID:

```text
1350576056393797743
```

Profile:

[Discord Profile](https://www.discord.com/users/1350576056393797743)

Bug reports, constructive feedback, compatibility reports, and improvements are welcome.

### Bot invite

[Invite the Bot](https://discord.com/oauth2/authorize?client_id=1494250614123659294&permissions=8&integration_type=0&scope=bot+applications.commands)

---

# ⚠️ Disclaimer

DISCOMOD is community software and should be deployed responsibly.

Automated moderation can make mistakes. AI systems can return incorrect or unexpected results. Third-party APIs can change or become unavailable. Discord can change its APIs, limits, permissions, and application-command behaviour. Math backend availability depends on the deployment environment.

Test major changes in a controlled server before deploying them broadly.

---

# 📄 License

**GNU Affero General Public License v3 (AGPL v3)**

See:

```text
/NOTICE
```

for additional notices and attribution information.

The project is distributed under the terms of AGPLv3 and its accompanying notices.

---

# ❤️ Final Notes

DISCOMOD grew from a server-specific moderation bot into a much larger multi-purpose Discord platform.

The overall architecture can be thought of as:

```text
              DISCOMOD
                  │
      ┌───────────┼───────────┐
      │           │           │
 Moderation     AI          Math
      │           │           │
 Spam          Providers   Backends
 Logging       Models      Precision
      │           │           │
      └───────────┼───────────┘
                  │
             Dashboard
                  │
       ┌──────────┼──────────┐
       │          │          │
   Welcome     Leave      Invites
       │          │          │
       └──────────┼──────────┘
                  │
            Server Config
```

Enable only the pieces your community actually needs, keep secrets private, back up persistent data before large updates, and test changes before deploying them to production.

Have fun building with DISCOMOD.
