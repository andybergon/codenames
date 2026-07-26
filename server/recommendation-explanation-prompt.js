export const SEMANTIC_EXPLANATION_PROMPT_VERSION = 5;

export const SEMANTIC_EXPLANATION_DEVELOPER_PROMPT = `You explain why Codenames target words fit a proposed clue.

Goal:
- Write one natural sentence for each recommendation.
- Begin with "These words connect through [short shared concept]:".
- After the colon, give every target its own short clause explaining the relationship.

Constraints:
- Use common, broadly accepted meanings only.
- Mention every target exactly once.
- Do not group multiple targets into one clause, even when their relationships are similar.
- Write clue and target words in ordinary sentence case.
- Do not mention scores, embeddings, safety, danger words, guessing, or strategy.
- Do not invent a relationship when the connection is weak. State the weaker association plainly.
- Keep each explanation between 12 and 36 words.
- Return only schema-valid JSON.`;

const ITALIAN_SEMANTIC_EXPLANATION_DEVELOPER_PROMPT = `Spiega perché le parole obiettivo di Codenames sono adatte a un indizio proposto.

Obiettivo:
- Scrivi una frase naturale per ogni suggerimento.
- Inizia con "Queste parole si collegano tramite [breve concetto condiviso]:".
- Dopo i due punti, dedica a ogni obiettivo una breve proposizione che spiega il rapporto.

Vincoli:
- Usa solo significati comuni e ampiamente riconosciuti.
- Cita ogni obiettivo esattamente una volta.
- Non raggruppare più obiettivi nella stessa proposizione, anche quando i rapporti sono simili.
- Scrivi l'indizio e le parole obiettivo normalmente, senza tutto maiuscolo.
- Non menzionare punteggi, embedding, sicurezza, parole pericolose, tentativi o strategia.
- Non inventare un rapporto quando il collegamento è debole. Descrivi chiaramente l'associazione più debole.
- Mantieni ogni spiegazione tra 12 e 36 parole.
- Restituisci solo JSON valido secondo lo schema.`;

export function semanticExplanationDeveloperPrompt(language = "en") {
  return language === "it"
    ? ITALIAN_SEMANTIC_EXPLANATION_DEVELOPER_PROMPT
    : SEMANTIC_EXPLANATION_DEVELOPER_PROMPT;
}

export function buildSemanticExplanationInput(recommendations, language = "en") {
  const locale = language === "it" ? "it" : "en";
  return JSON.stringify({
    recommendations: recommendations.map(({ id, clue, targets }) => ({
      id,
      clue: clue.toLocaleLowerCase(locale),
      targets: targets.map((target) => target.toLocaleLowerCase(locale)),
    })),
  });
}

export function semanticExplanationSchema(count) {
  return {
    type: "object",
    properties: {
      explanations: {
        type: "array",
        minItems: count,
        maxItems: count,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            explanation: { type: "string" },
          },
          required: ["id", "explanation"],
          additionalProperties: false,
        },
      },
    },
    required: ["explanations"],
    additionalProperties: false,
  };
}
