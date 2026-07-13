import json
import re
from importlib.metadata import version
from pathlib import Path

import nltk
from better_profanity import profanity
from nltk.corpus import stopwords, wordnet
from wordfreq import top_n_list, zipf_frequency


SOURCE_LIMIT = 500_000
OUTPUT_LIMIT = 100_000
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
    "fuck", "fucking", "libtards", "porn", "porno", "pornography", "shit", "tranny",
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


def is_fallback_candidate(word: str, nltk_stopwords: set[str]) -> bool:
    return (
        4 <= len(word) <= 18
        and word.isascii()
        and word.isalpha()
        and word not in STOPWORDS
        and word not in nltk_stopwords
        and word not in BLOCKED_WORDS
        and not profanity.contains_profanity(word)
        and not re.search(r"(.)\1\1", word)
    )


def main() -> None:
    NLTK_DATA_PATH.mkdir(parents=True, exist_ok=True)
    nltk.data.path.insert(0, str(NLTK_DATA_PATH))
    for corpus in ("wordnet", "stopwords"):
        try:
            nltk.data.find(f"corpora/{corpus}")
        except LookupError:
            nltk.download(corpus, download_dir=NLTK_DATA_PATH, quiet=True)
    wordnet.ensure_loaded()
    nltk_stopwords = set(stopwords.words("english"))
    profanity.load_censor_words()

    source_words = top_n_list("en", SOURCE_LIMIT)
    words = []
    seen = set()
    for word in source_words:
        normalized = word.lower()
        if normalized in seen or not is_candidate(normalized):
            continue
        seen.add(normalized)
        words.append(
            {
                "word": normalized,
                "zipf": round(zipf_frequency(normalized, "en"), 2),
            }
        )
    wordnet_count = len(words)

    for word in source_words:
        normalized = word.lower()
        if normalized in seen or not is_fallback_candidate(normalized, nltk_stopwords):
            continue
        seen.add(normalized)
        words.append(
            {
                "word": normalized,
                "zipf": round(zipf_frequency(normalized, "en"), 2),
            }
        )
        if len(words) == OUTPUT_LIMIT:
            break

    if len(words) < OUTPUT_LIMIT:
        raise RuntimeError(f"Need {OUTPUT_LIMIT} clue words, found {len(words)}")

    payload = {
        "source": "wordfreq",
        "sourceVersion": version("wordfreq"),
        "language": "en",
        "sourceLimit": SOURCE_LIMIT,
        "filters": "single ASCII words, 3-18 letters, common function words and profanity removed; WordNet content words first, then a 4-18 letter frequent-name/alphabetic fallback",
        "wordnetCount": wordnet_count,
        "fallbackCount": len(words) - wordnet_count,
        "words": words,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(words)} clue words to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
