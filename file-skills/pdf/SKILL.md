---
name: pdf
description: Read, create, modify and visually verify PDF documents, including scanned pages.
---

# PDF files

- Inspect page count, metadata and extractable text with `pdfinfo`, `pdftotext -layout`, `pypdf` or `pdfplumber`. Never assume extraction preserves page layout.
- Render relevant pages with `pdftoppm -f N -l N -png -r 150`. If extraction is empty or clearly incomplete, run `pdftoppm` then `tesseract image stdout -l chi_sim+eng` for OCR. Mark OCR uncertainty in the answer.
- Use `pypdf` for page-level operations and forms, `reportlab` for new PDFs, or LibreOffice export from an editable source. Save final files under `output` and reopen with `pdfinfo`/`pypdf`.
- Render final pages and check legibility, alignment and missing content before `artifact.submit`. Preserve the source.
