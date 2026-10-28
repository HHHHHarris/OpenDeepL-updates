"""Sequential local document jobs; a failed input does not hide other results."""
from pathlib import Path
import re

from core.documents import translate_document
from core.open_deepl_core import TranslationError, LocalEngineError


def translate_batch(jobs, request=None, on_event=None, translator=None, temporary_path=None):
    if not isinstance(jobs, list) or not 1 <= len(jobs) <= 20:
        raise TranslationError('Select between 1 and 20 documents.')
    for job in jobs:
        if not isinstance(job, dict) or not all(isinstance(job.get(k), str) for k in ('input', 'output')):
            raise TranslationError('Invalid document queue.')
    emit = on_event or (lambda event: None)
    results = []
    for index, job in enumerate(jobs, 1):
        label = Path(job['input']).name
        context = {'fileIndex': index, 'fileCount': len(jobs), 'fileName': label}
        phase = 'validating'
        emit({'type': 'documentProgress', 'progress': {**context, 'phase': 'validating'}})

        def progress(value):
            nonlocal phase
            if value.get('phase') in ('validating', 'translating', 'assembling', 'complete'):
                phase = value['phase']
            emit({'type': 'documentProgress', 'progress': {**value, **context}})

        try:
            report = translate_document(job['input'], job['output'], request, progress,
                                        translator=translator, temporary_path=temporary_path)
            result = {'name': label, 'status': 'completed', 'report': report}
        except Exception as exc:
            # Parser exceptions may contain source text or local paths. Export only
            # the document API's fixed messages, never an arbitrary traceback.
            message = str(exc) if isinstance(exc, TranslationError) else 'Document processing failed (DOC_UNEXPECTED).'
            result = {'name': label, 'status': 'failed', 'message': message}
            if isinstance(exc, LocalEngineError):
                result.update({'errorCode': exc.code, 'phase': phase})
            elif not isinstance(exc, TranslationError):
                kind = type(exc).__name__
                result.update({'errorCode': 'DOC_UNEXPECTED', 'phase': phase,
                               'errorType': kind if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,63}', kind) else 'UnknownError'})
        results.append(result)
        emit({'type': 'documentBatchItem', 'item': result, 'fileIndex': index, 'fileCount': len(jobs)})
    return {'items': results, 'completed': sum(x['status'] == 'completed' for x in results),
            'failed': sum(x['status'] == 'failed' for x in results), 'total': len(jobs)}
