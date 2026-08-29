---
description: Guidelines for editing and saving PowerShell scripts to prevent encoding errors
---

# PowerShell Encoding Guidelines

When editing or creating PowerShell scripts (`.ps1`) in this repository, you **MUST** ensure that the file is saved with a **UTF-8 with BOM (Byte Order Mark)** encoding.

## Why is this important?
The GitHub Actions workflows in this project run on `windows-latest` using Windows PowerShell 5.1 (`powershell`). If a script contains non-ASCII characters (such as Korean text, e.g., "변동인컴", "현금자산") and is saved as UTF-8 *without* a BOM, Windows PowerShell will read it using a legacy encoding (like Windows-1252 or EUC-KR). This corrupts the string literals and causes syntax parsing errors like `UnexpectedToken` or `ParserError` during execution.

## Rules for Agents
1. **DANGER - AI Text Tools Strip BOM**: Standard AI code editing tools (like `replace_file_content` or `multi_replace_file_content`) read and write files as standard UTF-8 without BOM. **If you use these tools to edit a `.ps1` file, the BOM WILL BE STRIPPED and the file WILL CORRUPT in GitHub Actions.**
2. **Mandatory BOM Restoration**: If you MUST edit a `.ps1` file using your text editing tools, you **MUST IMMEDIATELY** run the following PowerShell script to restore the BOM before committing or finishing your task. Do NOT wait for an error to happen.

   ```powershell
   $bytes = [System.IO.File]::ReadAllBytes("path/to/script.ps1")
   $utf8bom = [byte[]]@(0xEF,0xBB,0xBF)
   if ($bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) {
       [System.IO.File]::WriteAllBytes("path/to/script.ps1", $utf8bom + $bytes)
   }
   ```
3. **Avoid double encoding**: Do not use `Get-Content` and `Set-Content` to fix encoding if the file is already corrupted in memory, as it will double-encode the corrupted bytes. Use byte arrays `[IO.File]::ReadAllBytes` as shown above to safely prepend the BOM to valid UTF-8 text.
