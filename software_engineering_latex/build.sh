#!/usr/bin/env sh
set -eu
cd -- "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v xelatex >/dev/null 2>&1; then
  printf '%s\n' 'XeLaTeX was not found. Install a TeX distribution with xeCJK.' >&2
  exit 1
fi
if command -v latexmk >/dev/null 2>&1; then
  latexmk -xelatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex
else
  xelatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex
  xelatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex
fi
printf '%s\n' 'Done: main.pdf'
