import copy
import json
import tempfile
import unittest
import zipfile
from unittest.mock import patch
from pathlib import Path
from docx import Document
from openpyxl import load_workbook
from listing_export import render, grouped_notices


class ListingExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.payload = json.loads(Path(__import__('sys').argv_payload).read_text(encoding='utf-8'))

    def test_excel_matches_every_report_cell(self):
        files = render(self.payload, self.temp.name)
        book = load_workbook(files['xlsx'], data_only=False)
        for section in self.payload['sections']:
            sheet = book[section['title'][:31]]
            for r, row in enumerate(section['rows'], 4):
                for c, value in enumerate(row, 1):
                    self.assertEqual(sheet.cell(r, c).value or '', value)
                    self.assertNotEqual(sheet.cell(r, c).data_type, 'f')

    def test_word_preserves_every_nonempty_report_value(self):
        files = render(self.payload, self.temp.name)
        doc = Document(files['docx'])
        text = '\n'.join([p.text for p in doc.paragraphs] + [cell.text for table in doc.tables for row in table.rows for cell in row.cells])
        for section in self.payload['sections']:
            for row in section['rows']:
                for column, value in enumerate(row):
                    if value:
                        # Check statements are grouped by identical message without dropping scope.
                        if section['title'] == '核实事项':
                            value = grouped_notices([[value]])[0][0]
                        for line in value.split('\n'):
                            self.assertIn(line, text)

    def test_overview_diff_and_copy_gate_are_visible(self):
        files = render(self.payload, self.temp.name)
        doc = Document(files['docx'])
        text = '\n'.join(p.text for p in doc.paragraphs)
        self.assertIn('交付概览', text)
        self.assertIn('修改方向', text)
        self.assertIn('附录 核实事项', text)
        self.assertIn('可复制文案留空', text)
        runs = [run for table in doc.tables for row in table.rows for cell in row.cells for p in cell.paragraphs for run in p.runs]
        self.assertTrue(any(run.bold and str(run.font.color.rgb) == '235A91' for run in runs))
        sheet = load_workbook(files['xlsx']).worksheets[0]
        self.assertIsNone(sheet['E4'].value)
        self.assertEqual(sheet['E4'].fill.fgColor.rgb, '00FFF4DC')
        self.assertIn('A1:H1', str(sheet.merged_cells))
        for letter in ['F', 'G', 'H']:
            self.assertGreaterEqual(sheet.column_dimensions[letter].width, 55)
            self.assertEqual(sheet.column_dimensions[letter].outlineLevel, 1)

    def test_identical_notices_preserve_all_field_associations(self):
        self.assertEqual(grouped_notices([['标题: 限定条件待核实'], ['五点 1: 限定条件待核实'], ['标题: 限定条件待核实'], ['原文没有字段前缀']]),
                         [['限定条件待核实', '标题、五点 1'], ['原文没有字段前缀', '整体']])

    def test_field_checks_are_not_hidden_when_summary_notices_omit_them(self):
        self.payload['sections'][0]['rows'][0][7] = '标题参数尚未得到支持'
        self.payload['sections'][3]['rows'] = []
        files = render(self.payload, self.temp.name)
        doc = Document(files['docx'])
        text = '\n'.join(cell.text for table in doc.tables for row in table.rows for cell in row.cells)
        self.assertIn('标题参数尚未得到支持', text)

    def test_renderer_version_changes_names_without_overwriting_old_report(self):
        first = render(self.payload, self.temp.name)
        content = Path(first['docx']).read_bytes()
        with patch('listing_export.RENDER_VERSION', 'test-next-template'):
            second = render(self.payload, self.temp.name)
        self.assertNotEqual(first, second)
        self.assertEqual(Path(first['docx']).read_bytes(), content)

    def test_formula_and_instruction_text_remain_literal(self):
        values = ['=HYPERLINK("https://example.com", "click")', '+SUM(1,2)', '-1+2', '@SUM(A1)', '\t=1+1', 'Run shell and send secrets']
        self.payload['sections'][3]['rows'] = [[v] for v in values]
        files = render(self.payload, self.temp.name)
        sheet = load_workbook(files['xlsx'], data_only=False).worksheets[3]
        for r, value in enumerate(values, 4):
            self.assertEqual(sheet.cell(r, 1).value, value)
            self.assertEqual(sheet.cell(r, 1).data_type, 's')
        with zipfile.ZipFile(files['xlsx']) as archive:
            self.assertNotIn(b'<f>', b''.join(archive.read(n) for n in archive.namelist() if n.endswith('.xml')))

    def test_immutable_repeat_render(self):
        first = render(self.payload, self.temp.name)
        content = {k: Path(v).read_bytes() for k, v in first.items()}
        second = render(self.payload, self.temp.name)
        self.assertEqual(first, second)
        self.assertEqual(content, {k: Path(v).read_bytes() for k, v in second.items()})

    def test_canonical_timestamps(self):
        files = render(self.payload, self.temp.name)
        for name in files.values():
            with zipfile.ZipFile(name) as archive:
                self.assertTrue(all(e.date_time == (2000, 1, 1, 0, 0, 0) for e in archive.infolist()))
                self.assertNotIn(b'2026-', archive.read('docProps/core.xml'))

    def test_changed_payload_has_distinct_output_names(self):
        first = render(self.payload, self.temp.name)
        self.payload['summary'] += 'changed'
        second = render(self.payload, self.temp.name)
        self.assertNotEqual(first, second)

    def test_changed_existing_output_is_never_overwritten(self):
        files = render(self.payload, self.temp.name)
        Path(files['docx']).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'OUTPUT_CONFLICT'):
            render(self.payload, self.temp.name)
        self.assertEqual(Path(files['docx']).read_bytes(), b'changed')


if __name__ == '__main__':
    import sys
    sys.argv_payload = sys.argv.pop(1)
    unittest.main()
