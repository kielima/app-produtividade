#!/usr/bin/env python3
"""Renomeia imagens de uma pasta usando a API Gemini (visão).

Para cada imagem, pede ao Gemini um nome de arquivo curto e descritivo
(kebab-case, sem acentos) e renomeia o arquivo localmente. Respeita um
orçamento de tokens/requisições por minuto para não estourar o limite da
API — pausa automaticamente quando necessário.

Uso:
    export GEMINI_API_KEY="sua-chave"
    python3 rename_images.py ./minhas-fotos --dry-run
    python3 rename_images.py ./minhas-fotos

Requer: pip install -r requirements.txt
"""

from __future__ import annotations

import argparse
import mimetypes
import os
import re
import sys
import time
import unicodedata
from collections import deque
from pathlib import Path

from google import genai
from google.genai import types

DEFAULT_MODEL = "gemini-2.5-flash"
DEFAULT_LANGUAGE = "pt"
DEFAULT_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic"}
MAX_NAME_WORDS = 6

PROMPT_BY_LANGUAGE = {
    "pt": (
        "Descreva o conteúdo principal desta imagem em até "
        f"{MAX_NAME_WORDS} palavras, para usar como nome de arquivo. "
        "Responda SOMENTE com as palavras (sem pontuação, sem aspas, "
        "sem extensão de arquivo), em português."
    ),
    "en": (
        "Describe the main content of this image in up to "
        f"{MAX_NAME_WORDS} words, to use as a filename. "
        "Reply ONLY with the words (no punctuation, no quotes, "
        "no file extension), in English."
    ),
}


class RateBudget:
    """Controla requisições/tokens por minuto usando uma janela deslizante.

    Antes de cada chamada, `wait_for_request()` dorme o necessário para não
    ultrapassar `requests_per_minute`. Depois da resposta, `record(tokens)`
    registra os tokens gastos; se o total na janela ultrapassar
    `tokens_per_minute`, a próxima chamada dorme até a janela liberar espaço.
    """

    def __init__(self, requests_per_minute: int, tokens_per_minute: int):
        self.requests_per_minute = requests_per_minute
        self.tokens_per_minute = tokens_per_minute
        self._request_times: deque[float] = deque()
        self._token_events: deque[tuple[float, int]] = deque()

    def _prune(self, now: float) -> None:
        cutoff = now - 60.0
        while self._request_times and self._request_times[0] < cutoff:
            self._request_times.popleft()
        while self._token_events and self._token_events[0][0] < cutoff:
            self._token_events.popleft()

    def wait_for_request(self) -> None:
        while True:
            now = time.monotonic()
            self._prune(now)
            tokens_used = sum(t for _, t in self._token_events)
            over_requests = len(self._request_times) >= self.requests_per_minute
            over_tokens = tokens_used >= self.tokens_per_minute
            if not over_requests and not over_tokens:
                self._request_times.append(now)
                return
            oldest = min(
                self._request_times[0] if self._request_times else now,
                self._token_events[0][0] if self._token_events else now,
            )
            sleep_for = max(0.1, oldest + 60.0 - now)
            time.sleep(sleep_for)

    def record(self, tokens: int) -> None:
        self._token_events.append((time.monotonic(), tokens))


def slugify(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    ascii_text = ascii_text.lower()
    ascii_text = re.sub(r"[^a-z0-9]+", "-", ascii_text).strip("-")
    words = [w for w in ascii_text.split("-") if w][:MAX_NAME_WORDS]
    return "-".join(words) or "imagem"


def unique_path(directory: Path, stem: str, suffix: str) -> Path:
    candidate = directory / f"{stem}{suffix}"
    counter = 2
    while candidate.exists():
        candidate = directory / f"{stem}-{counter}{suffix}"
        counter += 1
    return candidate


def iter_images(root: Path, recursive: bool, extensions: set[str]) -> list[Path]:
    pattern_iter = root.rglob("*") if recursive else root.glob("*")
    return sorted(
        p for p in pattern_iter if p.is_file() and p.suffix.lower() in extensions
    )


def suggest_name(
    client: genai.Client,
    model: str,
    image_path: Path,
    language: str,
    budget: RateBudget,
) -> str:
    mime_type = mimetypes.guess_type(image_path.name)[0] or "image/jpeg"
    image_bytes = image_path.read_bytes()
    prompt = PROMPT_BY_LANGUAGE.get(language, PROMPT_BY_LANGUAGE["en"])

    budget.wait_for_request()
    response = client.models.generate_content(
        model=model,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            prompt,
        ],
    )
    total_tokens = 0
    if response.usage_metadata is not None:
        total_tokens = response.usage_metadata.total_token_count or 0
    budget.record(total_tokens)

    text = (response.text or "").strip()
    return slugify(text)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="Pasta com as imagens")
    parser.add_argument(
        "--recursive", action="store_true", help="Percorre subpastas também"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Só mostra o que faria, não renomeia"
    )
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Modelo Gemini")
    parser.add_argument(
        "--language",
        default=DEFAULT_LANGUAGE,
        choices=sorted(PROMPT_BY_LANGUAGE),
        help="Idioma do nome sugerido",
    )
    parser.add_argument(
        "--requests-per-minute",
        type=int,
        default=15,
        help="Limite de requisições por minuto (padrão do tier gratuito)",
    )
    parser.add_argument(
        "--tokens-per-minute",
        type=int,
        default=1_000_000,
        help="Orçamento de tokens por minuto",
    )
    parser.add_argument(
        "--extensions",
        default=",".join(sorted(DEFAULT_EXTENSIONS)),
        help="Extensões aceitas, separadas por vírgula",
    )
    args = parser.parse_args()

    if not args.directory.is_dir():
        print(f"Erro: {args.directory} não é uma pasta.", file=sys.stderr)
        return 1

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Erro: defina a variável de ambiente GEMINI_API_KEY.", file=sys.stderr)
        return 1

    extensions = {
        e if e.startswith(".") else f".{e}"
        for e in (ext.strip().lower() for ext in args.extensions.split(","))
        if e
    }
    images = iter_images(args.directory, args.recursive, extensions)
    if not images:
        print("Nenhuma imagem encontrada.")
        return 0

    print(f"{len(images)} imagem(ns) encontrada(s). Modelo: {args.model}\n")

    client = genai.Client(api_key=api_key)
    budget = RateBudget(args.requests_per_minute, args.tokens_per_minute)

    renamed = 0
    failed = 0
    for image_path in images:
        try:
            slug = suggest_name(client, args.model, image_path, args.language, budget)
        except Exception as exc:  # noqa: BLE001 — segue para a próxima imagem
            print(f"[erro] {image_path.name}: {exc}", file=sys.stderr)
            failed += 1
            continue

        target = unique_path(image_path.parent, slug, image_path.suffix.lower())
        if args.dry_run:
            print(f"[dry-run] {image_path.name} -> {target.name}")
        else:
            image_path.rename(target)
            print(f"{image_path.name} -> {target.name}")
        renamed += 1

    print(f"\nConcluído: {renamed} renomeada(s), {failed} com erro.")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
