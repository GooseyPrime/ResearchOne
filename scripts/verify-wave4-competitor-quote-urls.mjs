#!/usr/bin/env node
/**
 * Wave 4 — optional live check that competitor pages still contain verbatim quote substrings.
 * Does not run in CI by default. Usage: `node scripts/verify-wave4-competitor-quote-urls.mjs`
 * Exit 0 always; prints PASS/WARN per URL.
 */
const checks = [
  {
    url: 'https://sequoiacap.com/podcast/training-data-daniel-nadler/',
    needle: 'the evidence is peer-reviewed medical literature',
  },
  {
    url: 'https://consensus.app/',
    needle: 'Verifiable Evidence',
  },
  {
    url: 'https://elicit.com/blog/systematic-review-for-prisma-2020',
    needle: 'where evidence must be fast and rigorous enough',
  },
  {
    url: 'https://openai.com/index/deep-research-system-card/',
    needle: 'may struggle with distinguishing authoritative information from rumors',
  },
  {
    url: 'https://storm-project.stanford.edu/research/storm/',
    needle: 'source bias transfer and over-association of unrelated facts',
  },
];

async function main() {
  for (const { url, needle } of checks) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'ResearchOne-Wave4-Quote-Verifier/1.0' },
        redirect: 'follow',
      });
      const text = await res.text();
      const ok = res.ok && text.toLowerCase().includes(needle.toLowerCase());
      console.log(`${ok ? 'PASS' : 'WARN'}\t${url}\t${needle.slice(0, 48)}…`);
      if (!ok) {
        console.warn(`  HTTP ${res.status}; substring not found — snapshot may be needed (Rule 31).`);
      }
    } catch (e) {
      console.warn(`WARN\t${url}\tfetch failed: ${e?.message ?? e}`);
    }
  }
}

main();
