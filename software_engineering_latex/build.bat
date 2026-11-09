@echo off
setlocal
cd /d "%~dp0"
where xelatex >nul 2>nul
if errorlevel 1 (
  echo XeLaTeX was not found. Install a TeX distribution with xeCJK.
  exit /b 1
)
where latexmk >nul 2>nul
if errorlevel 1 (
  for /l %%i in (1,1,3) do (
    xelatex -interaction=nonstopmode -halt-on-error -file-line-error report.tex
    if errorlevel 1 exit /b 1
  )
) else (
  latexmk -xelatex -interaction=nonstopmode -halt-on-error -file-line-error report.tex
  if errorlevel 1 exit /b 1
)
echo Done: report.pdf
exit /b 0
