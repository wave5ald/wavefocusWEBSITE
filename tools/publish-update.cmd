@echo off
rem Wrapper so the PowerShell publish script can run even when script
rem execution is disabled on the machine.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-update.ps1" %*
