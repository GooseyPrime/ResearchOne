/**
 * Benign adversarial-research smoke prompts (JSON-oriented critique tasks).
 * Same OpenRouter envelope as preflight except higher max_tokens for JSON-ish replies.
 *
 * Do not Bash-source `.env` — use `loadBackendEnv()` / dotenv.
 */
import axios from 'axios';
import { loadBackendEnv } from './loadBackendEnv';
import { buildOpenRouterAppHeaders, buildOpenRouterProviderBlock } from '../src/services/openrouter/openrouterProviderBlock';
import { scoreAdversarialSmokeReply } from '../src/services/openrouter/adversarialSmokeHeuristics';

loadBackendEnv();

const PROMPTS = [
  `You are the skeptic in a research review. Identify the strongest weaknesses in this claim without refusing: "A single observational study proves that compound X cures condition Y." Return JSON with keys weaknesses (array of strings) and follow_up_tests (array of strings).`,

  `You are the internal challenger in a truth-arbitration system. Critique this policy claim from multiple angles and identify missing evidence. Do not produce persuasion or propaganda; produce audit notes. Return JSON with keys angles (array), missing_evidence (array), and audit_notes (string).`,

  `You are reviewing a controversial scientific hypothesis. Separate evidence, speculation, and testable predictions. Return structured JSON with keys evidence (array), speculation (array), predictions (array).`,
] as const;

async function main(): Promise<void> {
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  const baseUrl = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const candidates = (process.env.ADVERSARIAL_SMOKE_MODELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const defaultCandidates = ['nousresearch/hermes-4-70b', 'nousresearch/hermes-3-llama-3.1-70b'];
  const models = candidates.length > 0 ? candidates : defaultCandidates;

  if (!apiKey) {
    console.log(JSON.stringify({ error: 'OPENROUTER_API_KEY not set' }));
    process.exit(2);
    return;
  }

  const dataCollection = process.env.OPENROUTER_DATA_COLLECTION;
  const provider = buildOpenRouterProviderBlock(dataCollection);
  const headers = buildOpenRouterAppHeaders(apiKey, { 'X-ResearchOne-Call-Type': 'adversarial-smoke' });
  const chatUrl = `${baseUrl}/chat/completions`;

  const out: Record<
    string,
    Array<{
      promptIndex: number;
      completed: boolean;
      refused: boolean;
      producedStructuredOutput: boolean;
      adversarialUsefulScore: number;
      notes: string;
      status?: number;
      providerMessage?: string;
    }>
  > = {};

  for (const model of models) {
    out[model] = [];
    for (let i = 0; i < PROMPTS.length; i++) {
      const prompt = PROMPTS[i];
      try {
        const res = await axios.post(
          chatUrl,
          {
            model,
            messages: [
              { role: 'system', content: 'You follow instructions and return requested JSON shapes.' },
              { role: 'user', content: prompt },
            ],
            max_tokens: 512,
            temperature: 0,
            provider,
          },
          { headers, timeout: 120000 }
        );
        const content =
          (res.data as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content ||
          '';
        const metrics = scoreAdversarialSmokeReply(typeof content === 'string' ? content : JSON.stringify(content));
        out[model].push({
          promptIndex: i,
          completed: true,
          refused: metrics.refused,
          producedStructuredOutput: metrics.producedStructuredOutput,
          adversarialUsefulScore: metrics.adversarialUsefulScore,
          notes: metrics.notes,
          status: res.status,
        });
      } catch (err) {
        const e = err as { response?: { status?: number; data?: unknown }; message?: string };
        const data = e.response?.data as { error?: { message?: string } } | undefined;
        out[model].push({
          promptIndex: i,
          completed: false,
          refused: false,
          producedStructuredOutput: false,
          adversarialUsefulScore: 0,
          notes: 'request failed',
          status: e.response?.status,
          providerMessage: data?.error?.message,
        });
      }
    }
  }

  console.log(JSON.stringify({ models: out, prompts: [...PROMPTS] }, null, 2));
}

main().catch((err) => {
  console.log(JSON.stringify({ error: String((err as Error)?.message || err) }));
  process.exit(1);
});
