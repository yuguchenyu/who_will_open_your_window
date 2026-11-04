@echo off
setlocal
cd /d "%~dp0"
set "target=report"
if not "%~1"=="" set "target=%~n1"
where xelatex >nul 2>nul
if errorlevel 1 goto noxelatex
where latexmk >nul 2>nul
if errorlevel 1 goto direct
latexmk -xelatex -interaction=nonstopmode -halt-on-error -file-line-error "%target%.tex"
if errorlevel 1 goto failed
goto done
:direct
xelatex -interaction=nonstopmode -halt-on-error -file-line-error "%target%.tex"
if errorlevel 1 goto failed
xelatex -interaction=nonstopmode -halt-on-error -file-line-error "%target%.tex"
if errorlevel 1 goto failed
goto done
:noxelatex
echo XeLaTeX was not found. Install a TeX distribution with xeCJK.
exit /b 1
:failed
echo Compilation failed. Please read %target%.log for details.
exit /b 1
:done
echo Done: %target%.pdf
exit /b 0
