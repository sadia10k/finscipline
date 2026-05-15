import json
import logging
import os
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
RAG_DIR = ROOT / "data" / "rag"
CHUNKS_FILE = RAG_DIR / "chunks.json"
EMBEDDINGS_FILE = RAG_DIR / "embeddings.npy"
EMBED_MODEL = "text-embedding-3-small"

_logger = logging.getLogger("finscipline.tools.rag")
_chunks: list[str] | None = None
_embeddings = None  # np.ndarray, loaded lazily
_client = None      # OpenAI, created lazily


def _get_client():
    global _client
    if _client is None:
        from openai import OpenAI
        _client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _client


def _load_index() -> None:
    global _chunks, _embeddings
    if _chunks is not None:
        return
    if not CHUNKS_FILE.exists() or not EMBEDDINGS_FILE.exists():
        _logger.warning("RAG index not found at %s — run scripts/ingest_rag.py", RAG_DIR)
        _chunks = []
        return
    import numpy as np
    _chunks = json.loads(CHUNKS_FILE.read_text(encoding="utf-8"))
    _embeddings = np.load(str(EMBEDDINGS_FILE))
    _logger.info("RAG index loaded: %d chunks", len(_chunks))


def _cosine_top_k(query_vec, matrix, k: int) -> list[int]:
    import numpy as np
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1.0, norms)
    scores = (matrix / norms) @ (query_vec / (np.linalg.norm(query_vec) or 1.0))
    top_k = min(k, len(scores))
    return list(np.argsort(scores)[::-1][:top_k])


def get_rag_advice(topic: str, n_results: int = 3) -> dict:
    """Retrieve relevant finance guidance using OpenAI embeddings + cosine similarity."""
    _load_index()
    if not _chunks:
        return {"chunks": [], "note": "Knowledge base is empty. Run scripts/ingest_rag.py first."}

    import numpy as np
    response = _get_client().embeddings.create(input=topic, model=EMBED_MODEL)
    query_vec = np.array(response.data[0].embedding, dtype=np.float32)

    indices = _cosine_top_k(query_vec, _embeddings, n_results)
    chunks = [_chunks[i] for i in indices]
    _logger.debug("rag query=%r returned %d chunks", topic, len(chunks))
    return {"chunks": chunks}
