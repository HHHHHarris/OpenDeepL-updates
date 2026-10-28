import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import uuid
from unittest.mock import patch

from core.documents import _translate, _request
from core.open_deepl_core import TranslationError, build_messages, TranslationRequest

ROOT = Path(__file__).resolve().parents[1]

class DocumentProtocolTests(unittest.TestCase):
    def test_existing_output_error_is_json_not_process_crash(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'existing.docx';output.write_bytes(b'KEEP')
            payload={'id':'existing','action':'translateDocument','input':str(ROOT/'Tests/fixtures/documents/sample.docx'),'output':str(output),'request':{}}
            result=subprocess.run([sys.executable,'-u','-m','core.open_deepl_core'],cwd=ROOT,input=json.dumps(payload)+'\n',capture_output=True,text=True,timeout=15)
            self.assertEqual(result.returncode,0,result.stderr)
            event=json.loads(result.stdout);self.assertEqual(event['type'],'error');self.assertIn('new file',event['message']);self.assertEqual(output.read_bytes(),b'KEEP')

    def test_protocol_batch_finishes_when_every_file_is_bad(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory);bad=folder/'bad.docx';bad.write_bytes(b'bad')
            jobs=[{'input':str(bad),'output':str(folder/f'out-{n}.docx')} for n in range(2)]
            payload={'id':'batch','action':'translateDocumentBatch','jobs':jobs,'temporary':str(folder/f'.OpenDeepL-{uuid.uuid4()}.tmp'),'request':{}}
            result=subprocess.run([sys.executable,'-u','-m','core.open_deepl_core'],cwd=ROOT,input=json.dumps(payload)+'\n',capture_output=True,text=True,timeout=15)
            self.assertEqual(result.returncode,0,result.stderr);events=[json.loads(x) for x in result.stdout.splitlines()];self.assertEqual(events[-1]['type'],'documentBatchFinal');self.assertEqual(events[-1]['report']['failed'],2);self.assertEqual(len(list(folder.glob('*.tmp'))),0)

    def test_known_marker_bracket_repairs_preserve_exact_original_values(self):
        report={'unresolved':[]}
        text=_translate('Price: $19.99, not $9.99.',_request({'targetLanguage':'Chinese'}),lambda req:'价格：$⟨OD000⟩，不是$【OD001】。',report,'test')
        self.assertEqual(text,'价格：$19.99，不是$9.99。');self.assertEqual(sum(x['count'] for x in report['markerRepairs']),2)

    def test_duplicate_missing_and_invented_markers_still_fail(self):
        for text in ['译文', '⟦OD000⟧ ⟦OD000⟧','⟦OD000⟧ ⟦OD999⟧']:
            with self.assertRaisesRegex(TranslationError,'Placeholder mismatch'):
                _translate('Price 19.99',_request(None),lambda req:text,{'unresolved':[]},'test')

    def test_restoration_is_one_pass_and_avoids_literal_marker_collisions(self):
        seen=[]
        source='Hello {{name}}, value ⟦OD000⟧ costs 19.99.'
        value=_translate(source,_request(None),lambda req:seen.append(req.text) or req.text,{'unresolved':[]},'test')
        self.assertEqual(value,source);self.assertIn('ODZ',seen[0])

    def test_document_prompt_preserves_markers_without_changing_plain_translation(self):
        self.assertIn('immutable',build_messages(TranslationRequest(text='Value ⟦OD000⟧'))[0]['content'])
        self.assertNotIn('immutable',build_messages(TranslationRequest(text='Hello'))[0]['content'])

    def test_document_protocol_literals_survive_model_translation(self):
        seen=[]
        value=_translate('If <SKU_ID> is marked FAIL, do not record PASS.',_request(None),
                         lambda req:seen.append(req.text) or '若⟦OD000⟧标为⟦OD001⟧，不要记录⟦OD002⟧。',
                         {'unresolved':[]},'test')
        self.assertEqual(value,'若<SKU_ID>标为FAIL，不要记录PASS。')
        self.assertNotIn('FAIL',seen[0])
        self.assertNotIn('PASS',seen[0])

    def test_source_echo_is_reported_for_the_document_review_warning(self):
        report={'unresolved':[]}
        source='Do not ship before Friday.'
        self.assertEqual(_translate(source,_request(None),lambda req:req.text,report,'body:p1'),source)
        self.assertEqual(report['unresolved'],['body:p1'])

    def test_protocol_only_paragraph_needs_no_model_or_untranslated_warning(self):
        for text in ('PASS', 'FAIL', '<SKU_ID>', 'PASS FAIL', '${ORDER} {{DATE}} $19.99', 'https://example.invalid/file'):
            with self.subTest(text=text):
                calls=[]
                report={'unresolved':[]}
                self.assertEqual(_translate(text,_request(None),lambda req:calls.append(req.text) or req.text,report,'body:p1'),text)
                self.assertEqual(calls,[])
                self.assertEqual(report['unresolved'],[])

    def test_long_source_echo_counts_one_paragraph_not_each_model_chunk(self):
        report={'unresolved':[]}
        source='Translate this long paragraph. '*90
        self.assertEqual(_translate(source,_request(None),lambda req:req.text,report,'body:p1'),source)
        self.assertEqual(report['unresolved'],['body:p1'])
