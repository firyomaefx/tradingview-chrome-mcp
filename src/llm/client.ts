/**
 * Optional LLM client used by the autonomous Pine Script repair loop.
 *
 * Set one of:
 *   OPENAI_API_KEY  -> calls https://api.openai.com/v1/chat/completions
 *   ANTHROPIC_API_KEY -> calls https://api.anthropic.com/v1/messages
 *
 * Configure the model with TV_AUTOFIX_MODEL (defaults depend on provider).
 */
import { logger } from "../logging/logger.js";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

export interface LlmClientConfig {
  provider: "openai" | "anthropic" | null;
  apiKey: string | null;
  model: string;
}

function configuredProvider(): LlmClientConfig["provider"] {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

function defaultModel(provider: LlmClientConfig["provider"]): string {
  if (provider === "anthropic") return process.env.TV_AUTOFIX_MODEL ?? "claude-3-5-sonnet-20241022";
  if (provider === "openai") return process.env.TV_AUTOFIX_MODEL ?? "gpt-4o";
  return "";
}

export function llmConfig(): LlmClientConfig {
  const provider = configuredProvider();
  return {
    provider,
    apiKey: provider === "openai" ? (process.env.OPENAI_API_KEY ?? null) : provider === "anthropic" ? (process.env.ANTHROPIC_API_KEY ?? null) : null,
    model: defaultModel(provider),
  };
}

export function isLlmConfigured(): boolean {
  return configuredProvider() !== null;
}

function extractCode(responseText: string): string {
  // Prefer fenced code blocks, otherwise assume the whole response is Pine.
  const fence = responseText.match(/```(?:pine|javascript|js)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  return responseText.trim();
}

async function callOpenai(prompt: string, model: string, apiKey: string): Promise<string> {
  const res = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are an expert Pine Script v6 assistant. Return ONLY the corrected Pine Script source code inside a single ```pine fenced code block. Do not include explanations outside the block.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 4000,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI response missing content");
  return content;
}

async function callAnthropic(prompt: string, model: string, apiKey: string): Promise<string> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system:
        "You are an expert Pine Script v6 assistant. Return ONLY the corrected Pine Script source code inside a single ```pine fenced code block. Do not include explanations outside the block.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  const text = json.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Anthropic response missing text content");
  return text;
}

export interface PineFixRequest {
  goal: string;
  source: string;
  errors: string[];
  warnings: string[];
  attempt: number;
}

export interface PineFixResult {
  source: string | null;
  error?: string;
}

/**
 * Ask the configured LLM for a corrected Pine Script source.
 */
export async function generatePineFix(request: PineFixRequest): Promise<PineFixResult> {
  const cfg = llmConfig();
  if (!cfg.provider || !cfg.apiKey) {
    return { source: null, error: "No LLM API key configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY." };
  }

  const prompt = buildFixPrompt(request);
  try {
    const raw =
      cfg.provider === "openai"
        ? await callOpenai(prompt, cfg.model, cfg.apiKey)
        : await callAnthropic(prompt, cfg.model, cfg.apiKey);
    return { source: extractCode(raw) };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    logger.error({ err: msg }, "LLM fix generation failed");
    return { source: null, error: msg };
  }
}

function buildFixPrompt({ goal, source, errors, warnings, attempt }: PineFixRequest): string {
  return `Goal: ${goal}

Current Pine Script v6 source:
\`\`\`pine
${source}
\`\`\`
${errors.length ? `\nCompile errors:\n${errors.map((e) => `- ${e}`).join("\n")}\n` : ""}${warnings.length ? `\nWarnings:\n${warnings.map((w) => `- ${w}`).join("\n")}\n` : ""}
Attempt ${attempt}: fix all compilation errors, preserve existing functionality unless the goal asks otherwise, and return the complete corrected source code.`;
}
