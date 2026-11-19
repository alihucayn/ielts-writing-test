# IELTS Writing Test (Claude)

A local IELTS Writing practice platform. Claude writes a fresh exam-style paper every time. You sit it in an interface that mirrors the computer-delivered IELTS test, and Claude marks it like an examiner: a band for each criterion, highlighted mistakes with fixes, priorities to work on, and a Band 8–9 rewrite of your answer.

The app has no API keys and no dependencies. It talks to Claude through the **Claude Code CLI** (`claude`) on your own computer, so tests and marking count against **your own Claude subscription**.

---

## 1. Connect to Claude (one-time setup)

### Step 1: Install Node.js 20 or newer

Check your version:

```sh
node -v
```

If it's missing or older than 20, install the LTS version from https://nodejs.org (or `brew install node` on macOS).

### Step 2: Install the Claude Code CLI

macOS / Linux:

```sh
curl -fsSL https://claude.ai/install.sh | bash
```

Or with npm:

```sh
npm install -g @anthropic-ai/claude-code
```

Check that it installed:

```sh
claude --version
```

### Step 3: Log in with your Claude account

```sh
claude
```

On first launch it asks you to log in. Otherwise, type `/login` inside it. Choose **Claude account with subscription** (Pro or Max) and finish the sign-in in your browser. Then quit with `/exit` or Ctrl+C.

> You can also log in with an Anthropic Console (API) account instead. That bills API credits, and the account needs credit on it.

### Step 4: Check that it works

```sh
echo "say hi" | claude -p
```

If Claude replies with a greeting, you're connected. If it doesn't, see [Troubleshooting](#troubleshooting).

---

## 2. Run the platform

```sh
git clone https://github.com/<your-username>/ielts-writing-test.git
cd ielts-writing-test
npm start
```

Open **http://127.0.0.1:4000**. Keep the terminal open while you use the app; Ctrl+C stops it.

| Option | How |
| --- | --- |
| Different port | `PORT=5000 npm start` |
| Choose a model | `CLAUDE_MODEL=opus npm start` (left blank, the CLI's default model is used) |
| CLI not on PATH | `CLAUDE_BIN=/full/path/to/claude npm start` |
| Try the UI without Claude | `npm run mock` (canned test and marks) |

---

## 3. Using it

1. **Generate a test.** Pick Academic or General Training and optionally give a theme. Claude writes the paper in about 30–90 seconds.
2. **Confirm your details**, read the instructions, then press **Start test**. You have 60 minutes for both parts.
3. **Write.** The test screen works like the real one:
   - The question is on the left and your answer is on the right. Drag the divider to resize the panes.
   - A live word count is shown, and spell check is off.
   - Move between Part 1 and Part 2 using the footer or the arrows.
   - Right-click the question to highlight text.
   - ☰ opens the options for contrast and text size.
   - Click the clock to hide it. It flashes at 10 and 5 minutes left.
   - Answers autosave and the clock keeps running if you reload. When time runs out, your answers are submitted automatically.
4. **Submit** with ✓. Claude marks both tasks in about 1–3 minutes.
5. **Review** your feedback:
   - **Overall band:** (Task 1 + 2 × Task 2) ÷ 3, using IELTS rounding.
   - **Criterion bands:** TA/TR, CC, LR and GRA for each task.
   - **Examiner's summary.**
   - **What to work on:** ranked priorities, each with a practice exercise.
   - **Marked-up essay:** your answer with colour-coded highlights. Click a highlight to see the comment and the suggested fix.
   - **Band 8–9 rewrite** of your answer.
6. **History:** the dashboard lists every attempt with its band and your average. **Retake** lets you sit the same paper again.

Bands are Claude's practice estimates, not official IELTS scores.

---

## Troubleshooting

| Message | Fix |
| --- | --- |
| `Credit balance is too low` | The CLI is logged in with an API (Console) account that has no credit, or `ANTHROPIC_API_KEY` is set in your shell. Run `unset ANTHROPIC_API_KEY`, then run `claude`, type `/login` and choose your subscription account. |
| `Not logged in · Please run /login` | Run `claude`, then `/login`. |
| `Could not find the 'claude' CLI on PATH` | Install the CLI (Step 2), or run with `CLAUDE_BIN=$(which claude) npm start`. |
| `Claude took longer than 8 minutes` | Usually a network problem or a usage limit. Press **Retry**; your answers are kept. |
| Generation or marking failed after a restart | Jobs that were running when the server stopped are marked failed. Press **Retry**. |

---

## How it works

- `server.mjs` is a plain Node HTTP server (no dependencies). For each job it runs:
  `claude -p --output-format json --json-schema <schema> --tools "" --no-session-persistence`
  - It runs in an empty folder (`data/claude-work/`) with every tool disabled.
  - Your essay is sent as data, never as instructions.
  - Variables inherited from a parent Claude Code session are removed, so the CLI uses your own login.
- `prompts.mjs` holds the item-writer and examiner prompts and the JSON schemas.
- `public/` is the vanilla JS front end. `charts.js` draws the Task 1 visuals (line, bar, pie, table, process, map) from the JSON that Claude generates.
- Your attempts are stored locally as JSON files in `data/sessions/`, which git ignores.

### Why there's no hosted version

This app relies on a `claude` CLI that is logged in on the machine running the server. A hosted service such as Vercel can't sign in to each visitor's Claude subscription. Subscriptions are for your own personal use through Claude's apps and Claude Code, not for powering a third-party web service. A hosted version would have to call the Anthropic API with API keys and add a database. Running it locally keeps it free beyond your existing subscription and keeps your essays on your own machine.
