# Subscription CLI clue reranker screen

| 🧠 Candidate | 🚦 Overall | 💳 Cost/game | 🔬 Smoke | 🛠️ Development | 🛡️ Transfer | 🔢 Requests | ⏱️ P50 | ⚠️ Error rate |
| --- | --- | ---: | --- | --- | --- | ---: | ---: | ---: |
| 🤖 GPT-5.6 Luna Low | 🔴 Block | $0.042 est · 1.06 credits | 🔴 Block | ⚪ Not run | ⚪ Not run | 10 | 5516.2 ms | 0.00% |
| 🤖 GPT-5.6 Luna High | 🔴 Block | $0.042 est · 1.05 credits | 🔴 Block | ⚪ Not run | ⚪ Not run | 36 | 4955.4 ms | 0.00% |
| 🤖 GPT-5.6 Sol | 🔴 Block | $0.822 est · 20.55 credits | 🔴 Block | 🔴 Block | 🟡 Needs data | 245 | 4838.6 ms | 1.22% |
| 🤖 GPT-5.6 Terra | 🔴 Block | $0.301 est · 7.52 credits | 🔴 Block | 🔴 Block | 🟡 Needs data | 1012 | 4544.3 ms | 0.20% |
| 🤖 Claude Opus | 🔴 Block | N/A | 🔴 Block | ⚫ Interrupted | ⚪ Not run | 233 | 5774.4 ms | 0.00% |

These are subscription CLI research signals. No API request, API key, sealed test board, promotion decision, or production-runtime claim is part of this report.

## 👥 Human and gold evidence

🚫 Unavailable. No reviewed source contains paired baseline and CLI-candidate judgments for selecting one clue from the same frozen embedding shortlist. The sealed 30-task calibration round was not consumed. Existing listener and operative artifacts remain source references only and are not attached as clue-selection evidence.

## 🤖 GPT-5.6 Luna Low

- Selector: `gpt-5.6-luna` resolved to `gpt-5.6-luna` through `codex-cli 0.146.0` on the `codex-subscription` surface.
- Prompt: v1, shortlist `play-safe-shortlist-v1`, one case per request, concurrency 1, no tools, no fallback.
- Completed-screen execution usage: 256,944 input, 108,288 cached input, 0 cache-creation input, 0 cache-read input, and 646 output tokens.
- Durable request corpus: 222 unique content-addressed records, 5,753,313 input tokens, 1,818,624 cached input tokens, and 21,700 output tokens.
- Cost: 1.06 ChatGPT credits per completed game (21.23 credits across 20 games), using the [official ChatGPT rate card](https://learn.chatgpt.com/docs/pricing#what-are-tokens-and-credits) verified 2026-08-05. The same measured tokens are an estimated $0.042 per game at [standard short-context API prices](https://developers.openai.com/api/docs/pricing), but no API charge occurred.
- Attempt interruption: `smoke` stopped after 579.91 s (subscription-transport-refused). Reconnecting... 2/5 (stream disconnected before completion: Connection refused (os error 61))
- Attempt interruption: `smoke` stopped after 630.20 s (subscription-transport-refused). Reconnecting... 2/5 (stream disconnected before completion: Connection refused (os error 61))
- Attempt interruption: `smoke` stopped after 284.74 s (subscription-transport-refused). Reconnecting... 2/5 (stream disconnected before completion: Connection refused (os error 61))
- Same-model smoke: 🔴 Block, 20 boards, 10 requests, p50 5516.2 ms, 100.19 s, peak RSS 786.1 MiB. Clue ambition changed from 60.00% to 41.89% multi-card clues, first-half clue number 2.03 to 1.70, and 8.50 to 10.10 passes per game.

## 🤖 GPT-5.6 Luna High

- Selector: `gpt-5.6-luna` resolved to `gpt-5.6-luna` through `codex-cli 0.146.0` on the `codex-subscription` surface.
- Prompt: v1, shortlist `play-safe-shortlist-v1`, one case per request, concurrency 1, no tools, no fallback.
- Completed-screen execution usage: 926,281 input, 372,992 cached input, 0 cache-creation input, 0 cache-read input, and 3,740 output tokens.
- Durable request corpus: 223 unique content-addressed records, 5,782,637 input tokens, 1,997,312 cached input tokens, and 36,583 output tokens.
- Cost: 1.05 ChatGPT credits per completed game (21.02 credits across 20 games), using the [official ChatGPT rate card](https://learn.chatgpt.com/docs/pricing#what-are-tokens-and-credits) verified 2026-08-05. The same measured tokens are an estimated $0.042 per game at [standard short-context API prices](https://developers.openai.com/api/docs/pricing), but no API charge occurred.
- Attempt interruption: `smoke` stopped after unknown time (cli-interruption). The subscription CLI stopped before producing a complete screen.
- Attempt interruption: `smoke` stopped after 670.98 s (subscription-transport-refused). Reconnecting... 2/5 (stream disconnected before completion: Connection refused (os error 61))
- Same-model smoke: 🔴 Block, 20 boards, 36 requests, p50 4955.4 ms, 246.35 s, peak RSS 837.3 MiB. Clue ambition changed from 60.00% to 38.56% multi-card clues, first-half clue number 2.03 to 1.66, and 8.50 to 10.15 passes per game.

## 🤖 GPT-5.6 Sol

- Selector: `gpt-5.6-sol` resolved to `gpt-5.6-sol` through `codex-cli 0.145.0` on the `codex-subscription` surface.
- Prompt: v1, shortlist `play-safe-shortlist-v1`, one case per request, concurrency 1, no tools, no fallback.
- Completed-screen execution usage: 6,902,670 input, 5,896,192 cached input, 0 cache-creation input, 0 cache-read input, and 10,649 output tokens.
- Durable request corpus: 1,876 unique content-addressed records, 53,738,276 input tokens, 29,671,936 cached input tokens, and 96,719 output tokens.
- Cost: 20.55 ChatGPT credits per completed game (3451.73 credits across 168 games), using the [official ChatGPT rate card](https://learn.chatgpt.com/docs/pricing#what-are-tokens-and-credits) verified 2026-08-05. The same measured tokens are an estimated $0.822 per game at [standard short-context API prices](https://developers.openai.com/api/docs/pricing), but no API charge occurred.
- Attempt interruption: `development` stopped after 3591.86 s (subscription-transport-refused). Reconnecting... 2/5 (stream disconnected before completion: Connection refused (os error 61))
- Attempt interruption: `development` stopped after 4733.51 s (subscription-transport-refused). Reconnecting... 2/5 (stream disconnected before completion: Connection refused (os error 61))
- Attempt interruption: `transfer-smoke` stopped after 630.98 s (subscription-transport-refused). Reconnecting... 2/5 (stream disconnected before completion: Connection refused (os error 61))
- Measurement limitation: A resume attempt overwrote the original Sol smoke report with a cache-only replay. The exact comparison metrics remain reproducible, but the original per-request latency array is unavailable.
- Same-model smoke: 🔴 Block, 20 boards, 0 requests, p50 N/A, 41.51 s, peak RSS 796.3 MiB.
- Same-model development: 🔴 Block, 128 boards, 89 requests, p50 4633.3 ms, 731.07 s, peak RSS 824.3 MiB.
- MiniLM-L6 transfer smoke: 🟡 Needs data, 20 boards, 156 requests, p50 4991.2 ms, 928.48 s, peak RSS 718.7 MiB.

## 🤖 GPT-5.6 Terra

- Selector: `gpt-5.6-terra` resolved to `gpt-5.6-terra` through `codex-cli 0.145.0` on the `codex-subscription` surface.
- Prompt: v1, shortlist `play-safe-shortlist-v1`, one case per request, concurrency 1, no tools, no fallback.
- Completed-screen execution usage: 26,912,912 input, 20,008,704 cached input, 0 cache-creation input, 0 cache-read input, and 65,682 output tokens.
- Durable request corpus: 2,019 unique content-addressed records, 53,956,700 input tokens, 32,894,720 cached input tokens, and 152,438 output tokens.
- Cost: 7.52 ChatGPT credits per completed game (1263.30 credits across 168 games), using the [official ChatGPT rate card](https://learn.chatgpt.com/docs/pricing#what-are-tokens-and-credits) verified 2026-08-05. The same measured tokens are an estimated $0.301 per game at [standard short-context API prices](https://developers.openai.com/api/docs/pricing), but no API charge occurred.
- Attempt interruption: `development` stopped after 437.90 s (subscription-transport-refused). Reconnecting... 2/5 (stream disconnected before completion: Connection refused (os error 61))
- Attempt interruption: `development` stopped after 1626.84 s (subscription-transport-refused). Reconnecting... 2/5 (stream disconnected before completion: Connection refused (os error 61))
- Attempt interruption: `development` stopped after 670.54 s (subscription-transport-refused). Reconnecting... 2/5 (stream disconnected before completion: Connection refused (os error 61))
- Attempt interruption: `development` stopped after 444.71 s (subscription-transport-refused). Reconnecting... 2/5 (stream disconnected before completion: Connection refused (os error 61))
- Attempt interruption: `development` stopped after 2895.81 s (subscription-transport-refused). Reconnecting... 2/5 (stream disconnected before completion: Connection refused (os error 61))
- Same-model smoke: 🔴 Block, 20 boards, 236 requests, p50 4657.9 ms, 1213.03 s, peak RSS 666.2 MiB.
- Same-model development: 🔴 Block, 128 boards, 533 requests, p50 4474.9 ms, 2952.37 s, peak RSS 830.3 MiB.
- MiniLM-L6 transfer smoke: 🟡 Needs data, 20 boards, 243 requests, p50 4538.9 ms, 1280.01 s, peak RSS 650.5 MiB.

## 🤖 Claude Opus

- Selector: `opus` resolved to `claude-opus-5` through `2.1.220 (Claude Code)` on the `claude-code-subscription` surface.
- Prompt: v1, shortlist `play-safe-shortlist-v1`, one case per request, concurrency 2, no tools, no fallback.
- Completed-screen execution usage: 466 input, 0 cached input, 298,992 cache-creation input, 744,288 cache-read input, and 54,865 output tokens.
- Durable request corpus: 1,344 unique content-addressed records, 2,688 input tokens, 0 cached input tokens, and 339,457 output tokens.
- Cost: unavailable. No matching official ChatGPT credit rate is attached to this provider model.
- Interruption: `development` stopped without fallback (monthly-subscription-limit). You've hit your monthly spend limit · raise it at claude.ai/settings/usage?from=cc_cli_limit_message
- Attempt interruption: `development` stopped after 3916.97 s (monthly-subscription-limit). You've hit your monthly spend limit · raise it at claude.ai/settings/usage?from=cc_cli_limit_message
- Same-model smoke: 🔴 Block, 20 boards, 233 requests, p50 5774.4 ms, 808.98 s, peak RSS 680.4 MiB.

## 📌 Boundary

- The safe embedding engine generated every six-item shortlist and the selected clue continued through the existing game engine.
- Same-model self-play, development comparison, and MiniLM-L6 transfer remain separate.
- A gate failure blocks even if another headline metric rises.
- Cost per game uses exact content-addressed token usage, the official ChatGPT credit rate card, and the standard short-context OpenAI API rate card. USD is an API-equivalent estimate, not incurred spend.
- The web application cannot call these coding CLIs in normal play.
- Any future provider API implementation remains separate and keeps the absolute $5 total spend cap.
