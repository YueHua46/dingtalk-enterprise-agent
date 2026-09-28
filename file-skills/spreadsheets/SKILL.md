---
name: spreadsheets
description: Read, analyze, create and edit XLSX workbooks with Linux Python libraries and LibreOffice checks.
---

# Spreadsheets

- Inspect sheet names, dimensions, merged cells, tables, charts, formulas and data types with `openpyxl.load_workbook(..., read_only=False, data_only=False)`. For computed values, open a second read-only copy with `data_only=True`; cached results may be stale.
- For `.xls` or `.ods`, convert a copy with headless LibreOffice to XLSX first. Report conversion failures.
- Use `openpyxl` to modify a copy or `xlsxwriter` to create a new workbook. Do not silently overwrite formulas, VBA macros, pivot caches or external data connections. If these features matter and cannot be preserved, explain the limitation.
- Save under `output`, reopen with `openpyxl`, verify formulas, sheets, dimensions and representative values. For visual checks, export selected sheets to PDF with LibreOffice and render with `pdftoppm`.
- Call `artifact.submit` for each final workbook.
