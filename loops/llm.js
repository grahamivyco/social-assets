// How every loop talks to LM Studio: one place for the sampling settings, so a model switch is one edit.
// Qwen 3.5 model card (huggingface.co/Qwen/Qwen3.5-9B), non-thinking mode: temperature 0.7, top_p 0.8, top_k 20, presence_penalty 1.5.
// Writing (temperature 0.5 and up) gets that. Picks, labels and checks (below 0.5) stay tight, with no penalty, so JSON fields come back plain.
// Thinking is switched off: the loops want the answer, and thinking eats the token budget and leaves content empty.
const NO_THINK = { reasoning_effort: 'none', chat_template_kwargs: { enable_thinking: false } };

function sampling(temperature = 0.4) {
  const write = temperature >= 0.5;
  return { temperature: write ? Math.max(temperature, 0.7) : Math.min(temperature, 0.2), top_p: write ? 0.8 : 0.9, top_k: 20,
    presence_penalty: write ? 1.5 : 0, ...NO_THINK };
}

// A reply that still starts with a <think> block (older LM Studio builds ignore the switch): keep only what comes after it.
const content = msg => String(msg.content || '').replace(/^[\s\S]*?<\/think>\s*/, '').trim();

module.exports = { sampling, content, NO_THINK };
