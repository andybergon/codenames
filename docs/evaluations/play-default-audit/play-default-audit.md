# English Play default one-factor audit

| 🧪 Setting | 📌 Local result | 🔧 Alternative | 🧾 Evidence | ✅ Improved | ⚠️ Regressed | ❓ Uncertain |
| --- | --- | --- | --- | ---: | ---: | ---: |
| 🧪 Embedding model | 🟢 Default justified | MiniLM-L6 | smoke 20 | 0 | 1 | 0 |
| 🧪 Embedding model | 🟢 Default justified | MiniLM-L3 | smoke 20 | 0 | 1 | 1 |
| 🧪 Clue vocabulary | 🟢 Default justified | 3,000 | smoke 20 | 0 | 1 | 1 |
| 🧪 Clue vocabulary | 🟢 Default justified | 10,000 | smoke 20 | 0 | 1 | 1 |
| 🧪 Clue vocabulary | 🟡 Alternative promising | 100,000 | development 128 | 1 | 0 | 0 |
| 🧪 Clue scoring | 🟢 Default justified | Conservative | smoke 20 | 0 | 1 | 0 |
| 🧪 Clue reuse | 🟠 Uncertain | Previous only | development 128 | 0 | 0 | 1 |
| 🧪 Clue reuse | 🟠 Uncertain | Allow repeats | development 128 | 0 | 0 | 1 |
| 🧪 Prefer multi-card clues | 🟢 Default justified | Off | smoke 20 | 0 | 1 | 0 |
| 🧪 Prefer multi-card clues | 🟡 Alternative promising | Strong | development 128 | 1 | 0 | 0 |
| 🧪 Retry missed targets | 🟠 Uncertain | Mid-game | development 128 | 0 | 0 | 2 |
| 🧪 Retry missed targets | 🟠 Uncertain | Immediately | development 128 | 0 | 0 | 2 |
| 🧪 Operative aggression | 🟢 Default justified | Conservative | smoke 20 | 0 | 1 | 0 |
| 🧪 Operative aggression | 🟡 Alternative promising | Aggressive | development 128 | 1 | 0 | 0 |
| 🧪 Concept bridges | 🟢 Default justified | Off | development 128 | 0 | 0 | 0 |
| 🧪 Guess variation | 🟠 Uncertain | Standard | development 128 | 0 | 0 | 2 |
| 🧪 Extra guess | 🟢 Default justified | Allow | smoke 20 | 0 | 2 | 1 |

## Boundaries

- The accepted baseline is cf888693ae7567c012460f8b697231911be13352d88a7e122d4cb19879c3633b.
- No held-out boards were used and no promotion is claimed.
- Candidates change one visible behavior setting at a time. Setting interactions and the Cartesian matrix remain untested, so this cannot establish global optimality.
- Six workers remain the recommended pool. The eight-worker trial stayed responsive but reduced per-worker throughput.
