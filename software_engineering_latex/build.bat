@echo off
setlocal
cd /d "%~dp0"
where xelatex >nul 2>nul
if errorlevel 1 goto noxelatex
where latexmk >nul 2>nul
if errorlevel 1 goto direct
latexmk -xelatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex
if errorlevel 1 goto failed
goto done
:direct
xelatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex
if errorlevel 1 goto failed
xelatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex
if errorlevel 1 goto failed
goto done
:noxelatex
echo XeLaTeX was not found. Install a TeX distribution with xeCJK.
pause
exit /b 1
:failed
echo Compilation failed. Please read main.log for details.
pause
exit /b 1
:done
echo Done: main.pdf
pause
exit /b 0
