import json
import re
from importlib.metadata import version
from pathlib import Path

import nltk
from nltk.corpus import wordnet
from wordfreq import top_n_list, zipf_frequency


SOURCE_LIMIT = 50_000
OUTPUT_LIMIT = 3_000
OUTPUT_PATH = Path(__file__).parent / "generated" / "clue-words.json"
NLTK_DATA_PATH = Path(__file__).parent.parent / ".cache" / "nltk_data"

STOPWORDS = {
    "about", "above", "after", "again", "against", "ain", "all", "also", "am", "an",
    "and", "any", "are", "aren", "as", "at", "be", "because", "been", "before", "being",
    "below", "between", "both", "but", "by", "can", "could", "couldn", "did", "didn", "do",
    "does", "doesn", "doing", "don", "down", "during", "each", "few", "for", "from", "further",
    "had", "hadn", "has", "hasn", "have", "haven", "having", "he", "her", "here", "hers",
    "herself", "him", "himself", "his", "how", "i", "if", "in", "into", "is", "isn", "it",
    "its", "itself", "just", "ll", "m", "ma", "me", "might", "more", "most", "must", "mustn",
    "my", "myself", "needn", "no", "nor", "not", "now", "o", "of", "off", "on", "once",
    "only", "or", "other", "our", "ours", "ourselves", "out", "over", "own", "re", "s", "same",
    "shan", "she", "should", "shouldn", "so", "some", "such", "t", "than", "that", "the", "their",
    "theirs", "them", "themselves", "then", "there", "these", "they", "this", "those", "through",
    "to", "too", "under", "until", "up", "ve", "very", "was", "wasn", "we", "were", "weren",
    "what", "when", "where", "which", "while", "who", "whom", "why", "will", "with", "won", "would",
    "wouldn", "y", "you", "your", "yours", "yourself", "yourselves",
}

BLOCKED_WORDS = {
    "fuck", "fucking", "porn", "porno", "pornography", "shit",
}


def is_candidate(word: str) -> bool:
    return (
        3 <= len(word) <= 18
        and word.isascii()
        and word.isalpha()
        and word not in STOPWORDS
        and word not in BLOCKED_WORDS
        and not re.search(r"(.)\1\1", word)
        and bool(wordnet.synsets(word))
    )


def main() -> None:
    NLTK_DATA_PATH.mkdir(parents=True, exist_ok=True)
    nltk.data.path.insert(0, str(NLTK_DATA_PATH))
    try:
        wordnet.ensure_loaded()
    except LookupError:
        nltk.download("wordnet", download_dir=NLTK_DATA_PATH, quiet=True)
        wordnet.ensure_loaded()

    words = []
    for word in top_n_list("en", SOURCE_LIMIT):
        normalized = word.lower()
        if not is_candidate(normalized):
            continue

        words.append(
            {
                "word": normalized,
                "zipf": round(zipf_frequency(normalized, "en"), 2),
            }
        )
        if len(words) == OUTPUT_LIMIT:
            break

    payload = {
        "source": "wordfreq",
        "sourceVersion": version("wordfreq"),
        "language": "en",
        "sourceLimit": SOURCE_LIMIT,
        "filters": "single ASCII words, 3-18 letters, WordNet content words, common function words removed",
        "words": words,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(words)} clue words to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
