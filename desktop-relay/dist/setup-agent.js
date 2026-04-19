"use strict";
/**
 * One-time setup: creates the "jarvis" OpenClaw agent configured on Gemma 4
 * via Google AI Studio. Run once before starting the relay.
 *
 *   npm run setup-agent
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const dotenv_1 = require("dotenv");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
(0, dotenv_1.config)();
const AGENT_ID = 'jarvis';
const MODEL_ID = 'gemma-4-27b-it';
const OPENCLAW_MODEL = `google/${MODEL_ID}`;
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? process.env.GEMMA_API_KEY ?? '';
function run(args, opts) {
    const result = (0, child_process_1.spawnSync)('openclaw', args, {
        encoding: 'utf-8',
        env: { ...process.env, GEMINI_API_KEY: GEMINI_KEY },
    });
    if (result.status !== 0 && !opts?.silent) {
        const err = result.stderr?.trim();
        if (err)
            console.error(' ', err);
    }
    return { stdout: (result.stdout ?? '').trim(), ok: result.status === 0 };
}
function step(msg) {
    console.log(`\n→ ${msg}`);
}
async function main() {
    if (!GEMINI_KEY) {
        console.error('ERROR: GEMINI_API_KEY (or GEMMA_API_KEY) not set in .env');
        process.exit(1);
    }
    console.log('🦞 Setting up Jarvis agent in OpenClaw...');
    // Check if agent already exists
    const { stdout: listOut } = run(['agents', 'list'], { silent: true });
    const alreadyExists = listOut.includes(`- ${AGENT_ID}`);
    if (!alreadyExists) {
        step(`Creating agent "${AGENT_ID}"`);
        const { ok } = run(['agents', 'add', AGENT_ID]);
        if (ok)
            console.log(`  created "${AGENT_ID}"`);
    }
    else {
        step(`Agent "${AGENT_ID}" already exists — reconfiguring`);
    }
    // Find the agent dir from agents list output
    const agentBaseDir = path_1.default.join(os_1.default.homedir(), '.openclaw', 'agents', AGENT_ID, 'agent');
    // Write models.json directly — same format as the main agent
    step(`Writing models.json → Google Gemma 4 (${OPENCLAW_MODEL})`);
    fs_1.default.mkdirSync(agentBaseDir, { recursive: true });
    const modelsJson = {
        providers: {
            google: {
                baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
                apiKey: GEMINI_KEY,
                api: 'google-generative-ai',
                models: [
                    {
                        id: MODEL_ID,
                        name: 'Gemma 4 27B',
                        reasoning: true,
                        inputTypes: ['text'],
                        contextWindow: 131072,
                    },
                ],
            },
        },
        default: OPENCLAW_MODEL,
    };
    fs_1.default.writeFileSync(path_1.default.join(agentBaseDir, 'models.json'), JSON.stringify(modelsJson, null, 2), 'utf-8');
    console.log(`  written to ${path_1.default.join(agentBaseDir, 'models.json')}`);
    // Write IDENTITY.md (system prompt for the agent)
    step('Writing IDENTITY.md (Jarvis system prompt)');
    const identity = `# Jarvis — Desktop Execution Agent

You are Jarvis's desktop execution agent. You run on the user's laptop via OpenClaw,
receiving tasks dispatched from the user's iPhone through their Meta Ray-Ban glasses.

## Your job
Complete the task the user describes using whatever tools and computer access you have.

## Output protocol (always follow)
- Before any irreversible action (send email, delete file, make payment, submit form, post anything):
  output exactly: CONFIRM_REQUIRED: <one sentence describing what you are about to do>
  Then stop and wait for CONFIRMED or CANCELLED before proceeding.
- After each major step, output: PROGRESS: <short status> — the user hears this through their glasses.
- Keep all responses short and spoken-aloud-friendly.

## Model
Powered by Gemma 4 27B (${OPENCLAW_MODEL}) via Google AI Studio.
`;
    fs_1.default.writeFileSync(path_1.default.join(agentBaseDir, 'IDENTITY.md'), identity, 'utf-8');
    console.log(`  written to ${path_1.default.join(agentBaseDir, 'IDENTITY.md')}`);
    // Verify — openclaw models --agent jarvis status
    step('Verifying');
    const { stdout: statusOut } = run(['models', '--agent', AGENT_ID, 'status', '--plain'], { silent: true });
    if (statusOut) {
        console.log(' ', statusOut.split('\n')[0]);
    }
    else {
        // Fallback: list the file we wrote
        console.log(`  models.json written — run: openclaw models --agent ${AGENT_ID} status`);
    }
    console.log(`\n✅ Done. Start the relay: npm run dev\n`);
}
main().catch(e => { console.error(e); process.exit(1); });
