"""Offline I/O fault injection: no sockets, model processes or private input."""
import http.client
import json
import io
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

from core.open_deepl_core import OfflineEngine, TranslationRequest, LocalEngineError
from core.documents import _translate, _request, translate_document
from core.document_batch import translate_batch
from core import open_deepl_core as core

SOURCE = Path(__file__).parent/'fixtures/documents/sample.docx'

class Stream:
    def __init__(self, parts): self.parts=list(parts)
    def __enter__(self): return self
    def __exit__(self,*args): return False
    def read1(self,n):
        if not self.parts:return b''
        value=self.parts.pop(0)
        if isinstance(value,BaseException):raise value
        return value

def engine_with(parts):
    e=OfflineEngine();e._start_if_needed=lambda:None
    e._open=lambda *a,**k:Stream(parts)
    return e

class EngineFailureTests(unittest.TestCase):
    def test_read_faults_have_content_free_stable_diagnostics(self):
        for failure,code,retryable in [
            (TimeoutError('PRIVATE_BODY'),'LOCAL_TIMEOUT',True),
            (ConnectionResetError('PRIVATE_BODY'),'LOCAL_STREAM_INTERRUPTED',True),
            (http.client.IncompleteRead(b'PRIVATE_BODY'),'LOCAL_STREAM_INTERRUPTED',True),
            (http.client.RemoteDisconnected('PRIVATE_BODY'),'LOCAL_STREAM_INTERRUPTED',True),
            (b'\xff','LOCAL_STREAM_ENCODING',False),
            (b'\xe4\xbd','LOCAL_STREAM_ENCODING',False)]:
            with self.subTest(code=code,failure=type(failure).__name__):
                with self.assertRaises(LocalEngineError) as caught:
                    engine_with([failure]).translate(TranslationRequest('Hello'))
                self.assertEqual(caught.exception.code,code)
                self.assertEqual(caught.exception.retryable,retryable)
                self.assertNotIn('PRIVATE_BODY',str(caught.exception))

    def test_connect_faults_are_classified_without_http_body(self):
        for failure,code,retry in [
            (TimeoutError('PRIVATE_BODY'),'LOCAL_TIMEOUT',True),
            (urllib.error.URLError(TimeoutError('PRIVATE_BODY')),'LOCAL_TIMEOUT',True),
            (ConnectionResetError('PRIVATE_BODY'),'LOCAL_CONNECTION',True),
            (urllib.error.URLError('PRIVATE_BODY'),'LOCAL_CONNECTION',True),
            (urllib.error.HTTPError('http://127.0.0.1',503,'PRIVATE_BODY',{},None),'LOCAL_HTTP_ERROR',True),
            (urllib.error.HTTPError('http://127.0.0.1',400,'PRIVATE_BODY',{},None),'LOCAL_HTTP_ERROR',False)]:
            with self.subTest(code=code,failure=type(failure).__name__):
                e=OfflineEngine()
                with patch.object(e.opener,'open',side_effect=failure),self.assertRaises(LocalEngineError) as caught:
                    e._open('/v1/chat/completions',b'{}')
                self.assertEqual(caught.exception.code,code)
                self.assertEqual(caught.exception.retryable,retry)
                self.assertNotIn('PRIVATE_BODY',str(caught.exception))

    def test_document_transient_retry_completes_without_partial_text_duplication(self):
        e=OfflineEngine();e._start_if_needed=lambda:None;calls=[]
        def stream(*a,**k):
            calls.append(1)
            if len(calls)==1:
                return Stream([b'data: {"choices":[{"delta":{"content":"PARTIAL"}}]}\n\n',ConnectionResetError('PRIVATE_BODY')])
            return Stream(['data: '+json.dumps({'choices':[{'delta':{'content':'完整译文'}}]},ensure_ascii=False)+'\n\n','data: [DONE]\n\n'])
        # Stream returns bytes just as urllib does.
        def bytes_stream(*a,**k):
            s=stream(*a,**k);s.parts=[x.encode() if isinstance(x,str) else x for x in s.parts];return s
        e._open=bytes_stream
        report={'unresolved':[]}
        self.assertEqual(_translate('Hello world',_request(None),e,report,'p1'),'完整译文')
        self.assertEqual(len(calls),2);self.assertEqual(report['engineRetries'],1)

    def test_retry_budget_is_one_for_the_whole_document(self):
        calls=[];report={'unresolved':[]}
        def translator(req):
            calls.append(req.text)
            if len(calls) in (1,3):raise LocalEngineError('Local model request timed out.','LOCAL_TIMEOUT',True)
            return '译文'
        self.assertEqual(_translate('First paragraph',_request(None),translator,report,'p1'),'译文')
        with self.assertRaises(LocalEngineError):_translate('Second paragraph',_request(None),translator,report,'p2')
        self.assertEqual(len(calls),3);self.assertEqual(report['engineRetries'],1)

    def test_permanent_encoding_fault_is_not_retried(self):
        calls=[]
        def translator(req):
            calls.append(1);raise LocalEngineError('Local model returned invalid text encoding.','LOCAL_STREAM_ENCODING')
        with self.assertRaises(LocalEngineError):_translate('Hello',_request(None),translator,{'unresolved':[]},'p1')
        self.assertEqual(len(calls),1)

    def test_repeated_engine_failure_is_not_an_unknown_document_error(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d)/'out.docx'
            result=translate_batch([{'input':str(SOURCE),'output':str(out)}],translator=engine_with([TimeoutError('PRIVATE_BODY')]))
            item=result['items'][0]
            self.assertEqual(item['errorCode'],'LOCAL_TIMEOUT');self.assertEqual(item['phase'],'translating')
            self.assertNotIn('DOC_UNEXPECTED',item['message']);self.assertNotIn('PRIVATE_BODY',json.dumps(item))
            self.assertFalse(out.exists());self.assertEqual(list(Path(d).glob('*.tmp')),[])

    def test_unknown_diagnostic_keeps_class_and_phase_but_not_exception_body(self):
        def fail(req):raise RuntimeError('PRIVATE_BODY /Users/private/document')
        with tempfile.TemporaryDirectory() as d:
            result=translate_batch([{'input':str(SOURCE),'output':str(Path(d)/'out.docx')}],translator=fail)
        item=result['items'][0]
        self.assertEqual(item['errorCode'],'DOC_UNEXPECTED');self.assertEqual(item['errorType'],'RuntimeError')
        self.assertEqual(item['phase'],'translating');self.assertNotIn('PRIVATE_BODY',json.dumps(item))

    def test_text_stream_is_not_retried_after_emitting_a_delta(self):
        e=engine_with([b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',ConnectionResetError('PRIVATE_BODY')]);got=[]
        with patch.object(e,'_open',wraps=e._open) as opened,self.assertRaises(LocalEngineError):
            e.translate(TranslationRequest('Hello'),got.append)
        self.assertEqual(got,['partial']);self.assertEqual(opened.call_count,1)

    def test_protocol_error_keeps_fixed_engine_code(self):
        class Failed:
            def translate(self,*args):raise LocalEngineError('Local model request timed out.','LOCAL_TIMEOUT',True)
        output=io.StringIO()
        payload={'id':'timeout-test','action':'translate','request':{'text':'Hello'}}
        with patch.object(core,'DualModelEngine',return_value=Failed()),patch('sys.stdin',io.StringIO(json.dumps(payload)+'\n')),patch('sys.stdout',output),tempfile.TemporaryDirectory() as td,patch.object(core,'default_data_dir',return_value=Path(td)):
            core.serve_stdio()
        event=json.loads(output.getvalue())
        self.assertEqual(event['type'],'error');self.assertEqual(event['code'],'LOCAL_TIMEOUT')

    def test_generic_diagnostic_rejects_dynamic_non_ascii_exception_names(self):
        error=type('Hidden\nPRIVATE_BODY',(Exception,),{})
        def fail(req):raise error('PRIVATE_BODY')
        with tempfile.TemporaryDirectory() as d:
            result=translate_batch([{'input':str(SOURCE),'output':str(Path(d)/'out.docx')}],translator=fail)
        item=result['items'][0]
        self.assertEqual(item['errorType'],'UnknownError');self.assertNotIn('PRIVATE_BODY',json.dumps(item))

    def test_status_incomplete_http_response_is_offline_and_never_starts_model(self):
        class BrokenStatus(Stream):
            def read(self,*args):raise http.client.IncompleteRead(b'PRIVATE_BODY')
        e=OfflineEngine()
        with patch.object(e,'_open',return_value=BrokenStatus([])),patch.object(e,'_start_if_needed') as start:
            self.assertEqual(e.status(),'offline');start.assert_not_called()

    def test_callback_errors_are_not_misclassified_as_engine_io(self):
        payload=b'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n'
        for error in (OSError('CALLER_ONLY'),UnicodeError('CALLER_ONLY')):
            with self.subTest(kind=type(error).__name__):
                def callback(delta):raise error
                with self.assertRaises(type(error)) as caught:
                    engine_with([payload]).translate(TranslationRequest('Hello'),callback)
                self.assertIs(caught.exception,error)

if __name__=='__main__':unittest.main()
